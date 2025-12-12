// scraper.js
// Mercari 新着監視（Playwright）→ Telegram通知
// Node.js 18+ / Playwright

const { chromium } = require('playwright');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ====== 設定 ======
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID  = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID (GitHub Secrets)');
}


// 監視対象（ここを増やせます）
const TARGETS = [
  {
    name: '通常るるぶ（昭和）',
    url: 'https://jp.mercari.com/search?keyword=%E3%82%8B%E3%82%8B%E3%81%B6%20%E6%98%AD%E5%92%8C&sort=created_time&order=desc&status=on_sale'
  },
  {
    name: 'るるぶ情報版（昭和）',
    url: 'https://jp.mercari.com/search?keyword=%E3%82%8B%E3%82%8B%E3%81%B6%20%E6%83%85%E5%A0%B1%E7%89%88%20-最新版%20-改訂&status=on_sale'
  }
];

// 前回ID保存（簡易：メモリ。GitHub Actionsなら永続化も可）
const lastSeen = {};

// ====== Telegram通知 ======
async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: false
    })
  });
}

// ====== メイン処理 ======
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: 'ja-JP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });

  for (const t of TARGETS) {
    console.log(`チェック開始: ${t.name}`);
    // （例）ここで page を作った直後に入れるのが理想
page.setDefaultNavigationTimeout(90000);
page.setDefaultTimeout(90000);

// 重いリソースを止めて高速化（任意だが効果大）
await page.route('**/*', (route) => {
  const type = route.request().resourceType();
  if (['image', 'media', 'font'].includes(type)) return route.abort();
  return route.continue();
});

// ここを修正：networkidle → domcontentloaded
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

// アイテムが出るまで待つ（メルカリは遅延描画がある）
await page.waitForSelector('a[href^="/item/"]', { timeout: 90000 });


    // 商品リンクを上から取得
    const itemUrls = await page.$$eval(
      'a[href^="/item/"]',
      as => as.map(a => 'https://jp.mercari.com' + a.getAttribute('href'))
    );

    if (!itemUrls.length) {
      console.log('商品取得0件');
      continue;
    }

    const latest = itemUrls[0];
    const latestId = latest.split('/').pop();

    if (!lastSeen[t.name]) {
      // 初回は記録のみ
      lastSeen[t.name] = latestId;
      console.log('初回記録:', latestId);
      continue;
    }

    if (lastSeen[t.name] !== latestId) {
      const msg =
        `【るるぶ新着】\n` +
        `対象: ${t.name}\n` +
        `URL: ${latest}`;

      await sendTelegram(msg);
      console.log('通知送信:', latest);

      lastSeen[t.name] = latestId;
    } else {
      console.log('新着なし');
    }
  }

  await browser.close();
})();
