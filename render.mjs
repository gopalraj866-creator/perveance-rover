#!/usr/bin/env node
// Deterministic frame renderer: loads the Three.js page in headless Chrome, steps time frame by frame,
// screenshots each frame (WebGL + HTML overlays) and encodes the chunk with ffmpeg.
//
//   node render.mjs --format 1080p|4k|shorts|test --start 0 --end 40 --out out/chunk --workers 3
//   node render.mjs --thumbnail --out out/thumbnail.jpg
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));

const FORMATS = {
  '1080p': { w: 1920, h: 1080, mode: 'main', crf: 17 },
  '4k': { w: 3840, h: 2160, mode: 'main', crf: 18, aa: 0 },
  shorts: { w: 1080, h: 1920, mode: 'shorts', crf: 17 },
  test: { w: 640, h: 360, mode: 'main', crf: 24, shadow: 1024 }
};
const FPS = +(args.fps || 30);

function findChrome() {
  const c = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  throw new Error('No Chrome/Chromium found. Set CHROME_PATH.');
}

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--force-color-profile=srgb', '--disable-dev-shm-usage',
  '--font-render-hinting=none', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];

async function openPage(browser, url, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__ready === true', { timeout: 300000 });
  return page;
}

const srv = await serve();
const port = srv.address().port;
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: CHROME_ARGS, protocolTimeout: 600000 });

try {
  if (args.thumbnail) {
    const w = 1280, h = 720;
    const page = await openPage(browser, `http://127.0.0.1:${port}/index.html?w=${w}&h=${h}&mode=main&thumb=1&shadow=2048`, w, h);
    await page.evaluate(() => window.__render(125.2));
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    await page.screenshot({ path: args.out, type: 'jpeg', quality: 95 });
    console.log('thumbnail written', args.out);
  } else if (args.still) {
    const f = FORMATS[args.format || 'test'];
    const page = await openPage(browser, `http://127.0.0.1:${port}/index.html?w=${f.w}&h=${f.h}&mode=${f.mode}${f.shadow ? '&shadow=' + f.shadow : ''}`, f.w, f.h);
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    for (const t of String(args.still).split(',')) {
      await page.evaluate((x) => window.__render(x), +t);
      await page.screenshot({ path: args.out.replace('%t', t), type: 'jpeg', quality: 92 });
      console.log('still', t);
    }
  } else {
    const f = FORMATS[args.format || '1080p'];
    if (!f) throw new Error('unknown --format');
    const total = f.mode === 'shorts' ? 58 : 480;
    const start = +(args.start ?? 0), end = Math.min(+(args.end ?? total), total);
    const workers = +(args.workers ?? 2);
    const out = args.out || `out/${args.format}`;
    const frameDir = path.join(out, 'frames');
    fs.rmSync(frameDir, { recursive: true, force: true }); fs.mkdirSync(frameDir, { recursive: true });
    const first = Math.round(start * FPS), last = Math.round(end * FPS), N = last - first;
    console.log(`format=${args.format} ${f.w}x${f.h} frames ${first}..${last} (${N}) workers=${workers}`);
    const t0 = Date.now(); let done = 0;
    const url = `http://127.0.0.1:${port}/index.html?w=${f.w}&h=${f.h}&mode=${f.mode}${f.shadow ? '&shadow=' + f.shadow : ''}${f.aa === 0 ? '&aa=0' : ''}`;
    await Promise.all(Array.from({ length: workers }, async (_, wi) => {
      const page = await openPage(browser, url, f.w, f.h);
      for (let i = wi; i < N; i += workers) {
        const t = (first + i) / FPS;
        await page.evaluate((x) => window.__render(x), t);
        await page.screenshot({ path: path.join(frameDir, String(i + 1).padStart(6, '0') + '.jpg'), type: 'jpeg', quality: f.w > 2000 ? 90 : 93, optimizeForSpeed: true });
        if (++done % 60 === 0) { const el = (Date.now() - t0) / 1000; console.log(`${done}/${N} frames, ${(done / el).toFixed(2)} fps, eta ${Math.round((N - done) / (done / el))}s`); }
      }
      await page.close();
    }));
    const mp4 = path.join(out, 'video.mp4');
    const r = spawnSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(frameDir, '%06d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(f.crf),
      '-pix_fmt', 'yuv420p', '-g', '60', '-bf', '2', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', mp4], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
    if (!args.keep) fs.rmSync(frameDir, { recursive: true, force: true });
    console.log('chunk encoded:', mp4, `in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
} finally {
  await browser.close(); srv.close();
}
