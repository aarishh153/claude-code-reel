const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getChromePath() {
  const commonPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    return execSync('which google-chrome || which chromium || which chromium-browser').toString().trim();
  } catch (e) {
    return null;
  }
}

// Simple HTTP server for index.html
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.mp3': 'audio/mpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png'
    };
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8080, async () => {
  console.log('HTTP Server listening on port 8080');
  const chromePath = getChromePath();
  console.log('Using Chrome:', chromePath);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  page.on('console', msg => console.log('[PAGE CONSOLE]', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('[PAGE ERROR]', err.message));

  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  // Check state at t = 1.0s using the exact seek method Hyperframes calls
  const diag = await page.evaluate(() => {
    if (window.__timelines && window.__timelines.main) {
      window.__timelines.main.totalTime(1.0, true);
    } else if (typeof updateTimeline === 'function') {
      updateTimeline(1.0);
    }
    const reel = document.getElementById('reel');
    const pill = document.getElementById('topSeriesPill');
    const cap = document.getElementById('captionStage');
    const wm = document.querySelector('.watermark');

    const getElInfo = (el, name) => {
      if (!el) return { name, error: 'Element not found!' };
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const centerEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        name,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        zIndex: style.zIndex,
        color: style.color,
        background: style.backgroundColor,
        border: style.border,
        elementOnCenter: centerEl ? (centerEl.id ? '#' + centerEl.id : centerEl.className) : null,
        innerHTML: el.innerHTML.slice(0, 300)
      };
    };

    return {
      windowSize: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
      fitVar: reel ? reel.style.getPropertyValue('--fit') : null,
      reel: getElInfo(reel, 'reel'),
      pill: getElInfo(pill, 'topSeriesPill'),
      captionStage: getElInfo(cap, 'captionStage'),
      watermark: getElInfo(wm, 'watermark')
    };
  });

  console.log('=== DIAGNOSTIC REPORT (t=1.0s) ===');
  console.log(JSON.stringify(diag, null, 2));

  await page.screenshot({ path: 'diagnose_screenshot_1s.png' });
  console.log('Screenshot saved to diagnose_screenshot_1s.png');

  await browser.close();
  server.close();
  process.exit(0);
});
