// Сервер игры «Кёниг Магнат»: раздаёт файлы игры и пересылает ходы между игроками комнаты.
// Сама партия по-прежнему живёт в браузере создателя комнаты, сервер только передаёт сообщения.
// Запуск: npm install && npm start  (порт берётся из переменной PORT, по умолчанию 8080)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const HIDDEN = new Set(['server.js', 'package.json', 'package-lock.json', 'node_modules']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    return res.end('ok ' + rooms.size);
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const top = rel.split('/')[0];
  if (!file.startsWith(ROOT + path.sep) || HIDDEN.has(top) || top.startsWith('.')) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : ext === '.woff2' ? 'public, max-age=604800' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

// room -> { host: ws|null, key, clients: Map<cid, ws>, emptySince }
const rooms = new Map();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const valid = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;

wss.on('connection', (ws) => {
  ws.alive = true; ws.cids = new Set(); ws.hosting = null;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    ws.alive = true;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') return;

    if (m.t === 'host' && valid(m.room, 64) && valid(m.key, 64)) {
      let r = rooms.get(m.room);
      if (r && r.host && r.host !== ws && r.host.readyState === 1 && r.key !== m.key) return send(ws, { t: 'taken' });
      if (r && r.key !== m.key && r.host === null && Date.now() - r.emptySince < 30 * 60 * 1000) return send(ws, { t: 'taken' });
      if (!r) { if (rooms.size > 2000) return send(ws, { t: 'taken' }); r = { host: null, key: m.key, clients: new Map(), emptySince: 0 }; rooms.set(m.room, r); }
      if (r.host && r.host !== ws) { const old = r.host; old.hosting = null; dropClients(r); try { old.close(); } catch (e) {} }
      r.host = ws; r.key = m.key; ws.hosting = m.room;
      return send(ws, { t: 'hosted' });
    }
    if (m.t === 'join' && valid(m.room, 64) && valid(m.cid, 32)) {
      const r = rooms.get(m.room);
      if (!r || !r.host || r.host.readyState !== 1) return send(ws, { t: 'noroom', cid: m.cid });
      if (r.clients.size >= 24) return send(ws, { t: 'noroom', cid: m.cid });
      r.clients.set(m.cid, ws); ws.cids.add(m.room + '\n' + m.cid);
      send(r.host, { t: 'conn', cid: m.cid });
      return send(ws, { t: 'opened', cid: m.cid });
    }
    if ((m.t === 'msg' || m.t === 'close') && valid(m.cid, 32)) {
      if (ws.hosting) {
        const r = rooms.get(ws.hosting), target = r && r.clients.get(m.cid);
        if (!target) return;
        send(target, m.t === 'msg' ? { t: 'msg', cid: m.cid, d: m.d } : { t: 'close', cid: m.cid });
        if (m.t === 'close') { r.clients.delete(m.cid); target.cids.delete(ws.hosting + '\n' + m.cid); }
        return;
      }
      for (const key of ws.cids) {
        const [room, cid] = key.split('\n');
        if (cid !== m.cid) continue;
        const r = rooms.get(room);
        if (!r || r.clients.get(cid) !== ws) continue;
        send(r.host, m.t === 'msg' ? { t: 'msg', cid, d: m.d } : { t: 'close', cid });
        if (m.t === 'close') { r.clients.delete(cid); ws.cids.delete(key); }
      }
    }
  });
  ws.on('close', () => {
    if (ws.hosting) {
      const r = rooms.get(ws.hosting);
      if (r && r.host === ws) { r.host = null; r.emptySince = Date.now(); dropClients(r); }
    }
    for (const key of ws.cids) {
      const [room, cid] = key.split('\n');
      const r = rooms.get(room);
      if (r && r.clients.get(cid) === ws) { r.clients.delete(cid); send(r.host, { t: 'close', cid }); }
    }
  });
});
function dropClients(r) {
  for (const [cid, c] of r.clients) { send(c, { t: 'close', cid }); }
  r.clients.clear();
}
// Пинги держат соединения живыми за прокси; пустые комнаты чистим через 30 минут
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) {} }
  const now = Date.now();
  for (const [id, r] of rooms) if (!r.host && now - r.emptySince > 30 * 60 * 1000) rooms.delete(id);
}, 30000);

server.listen(PORT, () => console.log('Кёниг Магнат: http://localhost:' + PORT));
