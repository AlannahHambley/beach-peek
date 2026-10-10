// Local preview. Run: node build-beaches.js && node serve.js  →  http://localhost:8744/
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, PORT = 8744;
const types = { '.html':'text/html; charset=utf-8', '.json':'application/json; charset=utf-8', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.png':'image/png' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(root, p), (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d);
  });
}).listen(PORT, () => console.log('Beach Peek → http://localhost:' + PORT + '/'));
