const puppeteer = require('puppeteer-core');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function getChromePath() {
  const commonPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  // Try finding with which
  try {
    return execSync('which google-chrome || which chromium || which chromium-browser').toString().trim();
  } catch (e) {
    return null;
  }
}

async function render() {
  const chromePath = await getChromePath();
  if (!chromePath) {
    console.error("Chrome executable not found on system.");
    process.exit(1);
  }

  const DURATION = 65.8;
  const FPS = 30;
  const TOTAL_FRAMES = Math.round(DURATION * FPS);
  const WIDTH = 1080;
  const HEIGHT = 1920;

  console.log(`Starting CDP Deterministic Render: ${WIDTH}x${HEIGHT} @ ${FPS}fps (${TOTAL_FRAMES} frames)...`);

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

  const htmlPath = path.resolve(__dirname, 'index.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  // Prepare scale for 1080x1920 canvas
  await page.evaluate(() => {
    window.__IS_SCRUBBING__ = true;
    document.documentElement.style.setProperty('--fit', '2.7');
    if (typeof updateTimeline === 'function') updateTimeline(0);
  });

  // Start FFmpeg process piping raw images
  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', `${FPS}`,
    '-i', '-',
    '-i', path.resolve(__dirname, 'master_audio.mp3'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    path.resolve(__dirname, 'Claude_Code_Master_Reel.mp4')
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);
  ffmpeg.stderr.on('data', (d) => {
    // suppress verbose output
  });

  for (let i = 0; i <= TOTAL_FRAMES; i++) {
    const t = i / FPS;
    await page.evaluate((time) => {
      if (window.__timelines && window.__timelines.main) {
        window.__timelines.main.seek(time);
      } else if (typeof updateTimeline === 'function') {
        updateTimeline(time);
      }
    }, t);

    const frame = await page.screenshot({ type: 'png', omitBackground: false });
    ffmpeg.stdin.write(frame);

    if (i % 150 === 0 || i === TOTAL_FRAMES) {
      const pct = Math.round((i / TOTAL_FRAMES) * 100);
      console.log(`Render Progress: ${pct}% (${i}/${TOTAL_FRAMES} frames) at ${t.toFixed(1)}s`);
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
  console.log("CDP Deterministic Render completed successfully!");
}

render().catch((err) => {
  console.error("CDP Render error:", err);
  process.exit(1);
});
