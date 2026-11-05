const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 5500);
const clients = new Set();
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
};
const reloadScript = '<script>new EventSource("/__live").onmessage=()=>location.reload()</script>';

http.createServer((request, response) => {
  if (request.url === '/__live') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    response.write(': connected\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405).end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  const file = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
  if (file !== root && !file.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(); return; }
    const html = path.extname(file).toLowerCase() === '.html';
    if (html) data = Buffer.from(data.toString('utf8').replace(/<\/body>/i, reloadScript + '</body>'));
    response.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Live server: http://127.0.0.1:${port}/`));

fs.watch(root, { recursive: true }, (_event, filename) => {
  if (!filename || filename.startsWith('artifacts\\') || filename.startsWith('artifacts/')) return;
  for (const client of clients) client.write('data: reload\n\n');
});
