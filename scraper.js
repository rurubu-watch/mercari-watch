// scraper.js
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// =====================
// 設定
// =====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID  = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
}

// 監視対象（必要に応じて増やせます）
const TARGETS = [
  {
    key: 'rurubu_showa',
    name: '通常るるぶ（昭和）',
    url: 'https://jp.mercari.com/search?keyword=%E3%82%8B%E3%82%8B%E3%81%B6%20%E6%98%AD%E5%92%8C&sort=created_time&order=desc&status=on_sale'
  },
  {
    key: 'rurubu_johoban_showa',
    name: 'るるぶ情報版（昭和）',
    url: 'https://jp.mercari.com/search?keyword=%E3%82%8B%E3%82%8B%E3%81%B6%20%E6%83%85%E5%A0%B1%E7%89%88%20%E6%98%AD%E5%92%8C&sort=created_time&order=desc&status=on_sale'
  }
];

// state保存先（リポジトリ内に置く）
const STATE_DIR  = '.data';
const STATE_PATH = path.join(STATE_DIR, 'last_seen.json');

// =====================
// Telegram通知
// =====================
async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: false
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram send failed: HTTP ${res.status} ${body}`);
  }
}

// =====================
// state 読み書き
// =====================
function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveState(state) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

// =====================
// メイン処理
// =====================
(async () => {
  const state = loadState(); // { key: { lastUrl, lastAt } }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: 'ja-JP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });

  // 重いリソースをブロック（高速化・タイムアウト防止）
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'font', 'media'].includes(type)) return route.abort();
    return route.continue();
  });

  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);

  let anyStateChanged = false;

  for (const t of TARGETS) {
    console.log(`チェック開始: ${t.name}`);

    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('a[href^="/item/"]', { timeout: 90000 });

    // 先頭の商品URLを取る
    const itemUrl = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/item/"]');
      return a ? a.href : null;
    });

    if (!itemUrl) {
      console.log(`[${t.key}] 商品URLが取れませんでした`);
      continue;
    }

    const prev = state[t.key]?.lastUrl;

    if (prev && prev === itemUrl) {
      console.log(`[${t.key}] 変化なし（通知なし）: ${itemUrl}`);
      continue;
    }

    // 新着（または初回）→ 通知
    const msg =
      `【るるぶウォッチ】新着\n` +
      `対象: ${t.name}\n` +
      `URL: ${itemUrl}`;

    await sendTelegram(msg);
    console.log(`[${t.key}] 通知送信: ${itemUrl}`);

    // state更新
    state[t.key] = { lastUrl: itemUrl, lastAt: new Date().toISOString() };
    anyStateChanged = true;
  }

  await browser.close();

  if (anyStateChanged) {
    saveState(state);
    console.log(`state保存: ${STATE_PATH}`);
  } else {
    console.log('state変更なし（保存なし）');
  }
})();
