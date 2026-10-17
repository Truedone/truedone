import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
