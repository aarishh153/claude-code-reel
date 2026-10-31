const puppeteer = require('puppeteer-core');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

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

// Local HTTP Server to serve assets and fonts flawlessly
function startServer() {
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    let filePath = path.join(__dirname, reqPath === '/' ? 'index.html' : reqPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.mp3': 'audio/mpeg',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(8080, () => {
      console.log('HTTP Asset Server listening on port 8080');
      resolve(server);
    });
  });
}

async function render() {
  const chromePath = getChromePath();
  if (!chromePath) {
    console.error("Chrome executable not found on system.");
    process.exit(1);
  }

  const server = await startServer();

  const DURATION = 65.8;
  const FPS = 30;
  const TOTAL_FRAMES = Math.round(DURATION * FPS);
  const WIDTH = 1080;
  const HEIGHT = 1920;

  console.log(`Starting Studio Master CDP Render: ${WIDTH}x${HEIGHT} @ ${FPS}fps (${TOTAL_FRAMES} frames)...`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--window-size=${WIDTH},${HEIGHT}`
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('error') || text.includes('Error')) console.log('[PAGE ERROR]', text);
  });

  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  // Initialize and freeze scrubbing state
  await page.evaluate(() => {
    window.__IS_SCRUBBING__ = true;
    const reel = document.getElementById('reel');
    if (reel) reel.style.setProperty('--fit', '2.7');
    if (typeof updateTimeline === 'function') updateTimeline(0);
  });

  // Setup FFmpeg image pipe with audio muxing
  const outputPath = path.resolve(__dirname, 'Claude_Code_Master_Reel.mp4');
  const audioPath = path.resolve(__dirname, 'master_audio.mp3');

  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', `${FPS}`,
    '-i', '-',
    '-i', audioPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '17',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputPath
  ];

  console.log('Spawning FFmpeg pipeline...');
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stderr.on('data', (d) => {
    const msg = d.toString();
    if (msg.toLowerCase().includes('error')) console.error('[FFMPEG ERROR]', msg);
  });

  const startTime = Date.now();

  for (let i = 0; i <= TOTAL_FRAMES; i++) {
    const t = i / FPS;

    await page.evaluate((time) => {
      if (typeof updateTimeline === 'function') updateTimeline(time);
      if (window.__timelines && window.__timelines.main) {
        window.__timelines.main.totalTime(time, true);
      }
    }, t);

    const frame = await page.screenshot({ type: 'png', omitBackground: false });
    ffmpeg.stdin.write(frame);

    // Save frame 30 (t=1.0s) for immediate visual verification artifact
    if (i === 30) {
      fs.writeFileSync(path.resolve(__dirname, 'final_video_frame_1s.png'), frame);
      console.log('Saved frame t=1.0s verification image.');
    }

    if (i % 150 === 0 || i === TOTAL_FRAMES) {
      const pct = Math.round((i / TOTAL_FRAMES) * 100);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Render Progress: ${pct}% (${i}/${TOTAL_FRAMES} frames) at ${t.toFixed(1)}s [${elapsed}s elapsed]`);
    }
  }

  ffmpeg.stdin.end();

  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });

  await browser.close();
  server.close();
  console.log("CDP Studio Master Render completed successfully!");
}

render().catch((err) => {
  console.error("Fatal Render Error:", err);
  process.exit(1);
});
