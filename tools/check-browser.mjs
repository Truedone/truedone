// node tools/check-browser.mjs: two checks in system Chromium (CHROMIUM_BIN, else chromium on PATH) with --headless
// --dump-dom. No dependencies.
// - No arguments (CORE-05-AC04): packages/web/core.mjs loads in a page as an ES module and analyse() returns
//   no_evidence for a one-line source change.
// - --page <html> [--fixture <dir>] (WEB-01-AC08): loads a page of the site and checks what it rendered. It serves the
//   page's directory on 127.0.0.1. When --fixture is given, it answers the page's GitHub reads from that directory's
//   index.json ({ pr, api: { path: { status, file } }, raw: { ... } }): the served index.html gets the two <meta> tags
//   app.mjs reads for its API and raw hosts, pointing at this server, and the content security policy from _headers
//   with this server's origin added to connect-src. Exit 0 when the page reached data-state="done" with a verdict and
//   no error.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

if (process.argv.includes('--page')) process.exit(await checkPage());

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const coreFile = path.join(root, 'packages/web/core.mjs');
if (!existsSync(coreFile)) {
  console.error('packages/web/core.mjs is missing');
  process.exit(1);
}
const core = readFileSync(coreFile);
const html = `<!doctype html><meta charset="utf-8"><div id="v"></div><script type="module">
import { analyse } from "./core.mjs";
const o = analyse({files:[{path:"src/a.js",status:"modified",patch:"@@ -1 +1 @@\\n-a\\n+b"}],pr:{title:"",body:"",author:{login:"a",type:"User"}},releases:[]});
document.querySelector("#v").textContent = o.verdict;
</script>`;

let requests = 0;
const server = createServer((req, res) => {
  requests += 1;
  const u = (req.url || '/').split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (u === '/core.mjs') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(core);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const bin = process.env.CHROMIUM_BIN || 'chromium';
const profile = mkdtempSync(path.join(tmpdir(), 'td-browser-'));

function launch(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let dumped = false;
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr, error });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!dumped && stdout.includes('</html>')) {
        dumped = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(null, error));
    child.on('close', (status) => {
      if (timedOut) {
        const error = new Error(`chromium did not exit within ${timeoutMs} ms; requests ${requests}`);
        error.code = 'ETIMEDOUT';
        finish(status, error);
        return;
      }
      finish(status, null);
    });
  });
}

let result;
try {
  result = await launch([
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=15000',
    '--dump-dom',
    `http://127.0.0.1:${port}/`,
  ], 60000);
} finally {
  server.close();
  server.closeAllConnections?.();
  rmSync(profile, { recursive: true, force: true });
}
if (result.error && result.error.code === 'ENOENT') {
  console.error(process.env.CHROMIUM_BIN ? `CHROMIUM_BIN is not a file: ${bin}` : 'chromium is not on PATH and CHROMIUM_BIN is unset');
  process.exit(1);
}
if (result.error && result.error.code === 'ETIMEDOUT') {
  console.error(result.error.message);
  if (result.stderr) console.error(result.stderr.slice(-1500));
  process.exit(1);
}
const dump = result.stdout || '';
if (!dump.includes('no_evidence')) {
  if (result.stderr) console.error(result.stderr);
  if (dump) console.error(dump);
  process.exit(result.status || 1);
}

// The --page check (WEB-01-AC08); resolves to the exit code.
function checkPage() {
  return new Promise((done) => {
    const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
    const page = arg('--page'), fixture = arg('--fixture');
    if (!page) { console.error('usage: node tools/check-browser.mjs [--page <html> [--fixture <dir>]]'); return done(2); }
    const site = path.dirname(path.resolve(page));
    const rec = fixture ? JSON.parse(fs.readFileSync(path.join(fixture, 'index.json'), 'utf8')) : null;
    const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

    const csp = (origin) => {
      const h = fs.readFileSync(path.join(site, '_headers'), 'utf8').match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? '';
      return h.replace(/connect-src 'self'/, `connect-src 'self' ${origin}`);
    };
    const chromium = () => {
      if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
      try { return execFileSync('sh', ['-c', 'command -v chromium || command -v chromium-browser'], { encoding: 'utf8' }).trim().split('\n')[0]; } catch { return null; }
    };

    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const origin = `http://${req.headers.host}`;
      const send = (status, body, type, extra = {}) => { res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', ...extra }); res.end(body); };
      if (rec && (u.pathname.startsWith('/__api/') || u.pathname.startsWith('/__raw/'))) {
        const table = u.pathname.startsWith('/__api/') ? rec.api : rec.raw;
        const hit = table[u.pathname.replace(/^\/__(api|raw)/, '') + u.search];
        if (!hit) return send(404, '{"message":"Not Found"}', 'application/json');
        return send(hit.status, fs.readFileSync(path.join(fixture, hit.file)), 'application/json');
      }
      let f = path.join(site, decodeURIComponent(u.pathname));
      if (!f.startsWith(site) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.resolve(page);   // the single-page fallback
      let body = fs.readFileSync(f);
      const type = TYPES[path.extname(f)] ?? 'application/octet-stream';
      if (f === path.resolve(page) && rec) {
        const tags = `<meta name="truedone-api" content="${origin}/__api"><meta name="truedone-raw" content="${origin}/__raw">`;
        body = Buffer.from(String(body).replace('<head>', `<head>${tags}`));
      }
      send(200, body, type, f === path.resolve(page) ? { 'content-security-policy': csp(origin) } : {});
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const bin = chromium();
      if (!bin) { console.error('check-browser: no Chromium (set CHROMIUM_BIN or put chromium on PATH)'); server.close(); return done(1); }
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'check-browser-'));
      const target = `http://127.0.0.1:${port}${rec?.pr ?? '/'}`;
      const c = spawn(bin, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--virtual-time-budget=15000', '--dump-dom', target], { stdio: ['ignore', 'pipe', 'pipe'] });
      let dom = '', err = '', dumped = false;
      // Chrome can stay up after it has written the dump. The dump is complete once </html> is on stdout, so the
      // check ends Chrome there instead of waiting for it to exit; the 60 s kill is for a dump that never comes.
      c.stdout.on('data', (d) => { dom += d; if (!dumped && dom.includes('</html>')) { dumped = true; c.kill('SIGKILL'); } });
      c.stderr.on('data', (d) => { err += d; });
      const kill = setTimeout(() => c.kill('SIGKILL'), 60000);
      c.on('close', () => {
        clearTimeout(kill);
        server.close();
        fs.rmSync(profile, { recursive: true, force: true });
        const checks = {
          done: /<html[^>]*data-state="done"/.test(dom),
          verdict: /Verdict: /.test(dom),
          next_rung: /executes that PR's code/.test(dom),
          no_error: !/This page could not be shown/.test(dom),
        };
        console.log(JSON.stringify({ target, checks }));
        if (!Object.values(checks).every(Boolean)) { console.error(dom.slice(0, 2000) || err.slice(-2000)); return done(1); }
        done(0);
      });
    });
  });
}
