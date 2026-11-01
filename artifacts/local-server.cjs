const http = require('http'), fs = require('fs'), path = require('path');
const root = process.cwd();
const port = Number(process.argv[2]) || 5500;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
http.createServer((req,res) => { let p; try { p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; } const file = path.resolve(root, '.' + (p === '/' ? '/index.html' : p)); if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } fs.readFile(file, (err,data) => { if(err) { res.writeHead(404).end('Not found'); return; } res.writeHead(200, {'Content-Type':types[path.extname(file).toLowerCase()] || 'application/octet-stream'}); res.end(data); }); }).listen(port, '127.0.0.1');
