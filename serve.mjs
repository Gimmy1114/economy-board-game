import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav']
]);

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const target = normalize(join(ROOT, pathname));
  if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) { res.writeHead(403); res.end(); return; }
  let info;
  try { info = await stat(target); } catch { res.writeHead(404); res.end(); return; }
  if (info.isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = MIME.get(extname(target).toLowerCase()) || 'application/octet-stream';
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end(); }
}

const server = createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); }
  catch { res.writeHead(400); res.end(); return; }
  try {
    await serveStatic(req, res, url);
  } catch (err) {
    if (!res.writableEnded) { res.writeHead(500); res.end(); }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`派對大富翁：http://${HOST}:${PORT}/`);
});
