// scraper.js
// Mercari Watcher (Playwright + Telegram)

import { chromium } from 'playwright';

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
    name: '通常るるぶ（昭和）',
    url: 'https://jp.mercari.com/search?keyword=%E3%82%8B%E3%82%8B%E3%81%B6%20%E6%98%AD%E5%92%8C&sort=created_time&order=desc&status=on_sale'
  },
  {
    name: 'るるぶ情報版（昭和）',
    url: 'https://jp.mercari.com/search?keyword=%E3%82%8B%E3%82%8B%E3%81%B6%20%E6%83%85%E5%A0%B1%E7%89%88%20%E6%98%AD%E5%92%8C&sort=created_time&order=desc&status=on_sale'
  }
];

// =====================
// Telegram通知
// =====================
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

// =====================
// メイン処理
// =====================
(async () => {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    locale: 'ja-JP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });

  // 重いリソースをブロック（高速化・タイムアウト防止）
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'font', 'media'].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });

  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(90000);

  for (const t of TARGETS) {
    console.log(`チェック開始: ${t.name}`);

    await page.goto(t.url, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    // 商品リンクが出るまで待つ
    await page.waitForSelector('a[href^="/item/"]', {
      timeout: 90000
    });

    // 一番上の商品URLを取得
    const itemUrl = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/item/"]');
      return a ? a.href : null;
    });

    if (!itemUrl) {
      console.log('商品が見つかりませんでした');
      continue;
    }

    const message =
      `【るるぶウォッチ】新着確認\n` +
      `対象: ${t.name}\n` +
      `URL: ${itemUrl}`;

    await sendTelegram(message);
    console.log('通知送信:', itemUrl);
  }

  await browser.close();
})();
