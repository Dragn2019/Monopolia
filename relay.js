/* Связь через сервер игры вместо прямого соединения браузеров (PeerJS/WebRTC).
   Повторяет ту часть интерфейса PeerJS, которой пользуется app.js: new Peer(id), peer.connect(id),
   события open / connection / data / close / disconnected / error. Все сообщения идут через
   обычное защищённое WebSocket-соединение с сервером, как у любого сайта. */
(function () {
  var meta = document.querySelector('meta[name="km-server"]');
  var BASE = ((meta && meta.content) || '').trim().replace(/\/+$/, '');
  var httpBase = BASE || location.origin;
  var WS_URL = httpBase.replace(/^http/, 'ws') + '/ws';

  // Будим сервер сразу при открытии страницы: бесплатный хостинг засыпает и просыпается до минуты.
  try { fetch(httpBase + '/health', { cache: 'no-store' }).catch(function () {}); } catch (e) {}

  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (e, f) { (this._h[e] = this._h[e] || []).push(f); return this; };
  Emitter.prototype.off = function (e, f) { this._h[e] = (this._h[e] || []).filter(function (x) { return x !== f; }); return this; };
  Emitter.prototype.emit = function (e, x) {
    (this._h[e] || []).slice().forEach(function (f) { try { f(x); } catch (err) { console.error(err); } });
  };
  var rid = function () { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); };
  var keyFor = function (room) {
    var k = null;
    try { k = localStorage.getItem('km_roomkey_' + room); if (!k) { k = rid(); localStorage.setItem('km_roomkey_' + room, k); } } catch (e) { k = k || rid(); }
    return k;
  };

  function Conn(peer, cid, remote) {
    Emitter.call(this);
    this.peer = remote; this._peer = peer; this.cid = cid; this.open = false; this._done = false;
  }
  Conn.prototype = Object.create(Emitter.prototype);
  Conn.prototype.send = function (d) { if (this.open) this._peer._send({ t: 'msg', cid: this.cid, d: d }); };
  Conn.prototype.close = function () {
    if (this._done) return;
    this._peer._send({ t: 'close', cid: this.cid });
    this._end();
  };
  Conn.prototype._end = function () {
    if (this._done) return;
    this._done = true; this.open = false;
    delete this._peer._conns[this.cid];
    this.emit('close');
  };

  function Peer(id) {
    Emitter.call(this);
    this.room = typeof id === 'string' ? id : null; // с id — это создатель комнаты
    this.id = this.room || 'g' + rid();
    this.open = false; this.disconnected = false; this.destroyed = false;
    this._conns = {}; this._ws = null; this._ping = null;
    this._dial();
  }
  Peer.prototype = Object.create(Emitter.prototype);
  Peer.prototype._send = function (m) {
    if (this._ws && this._ws.readyState === 1) { try { this._ws.send(JSON.stringify(m)); } catch (e) {} }
  };
  Peer.prototype._dial = function () {
    var self = this, ws;
    try { ws = new WebSocket(WS_URL); } catch (e) { setTimeout(function () { self.emit('error', { type: 'network', message: e.message }); }, 0); return; }
    this._ws = ws;
    ws.onopen = function () {
      if (self._ws !== ws) return;
      self.disconnected = false;
      clearInterval(self._ping);
      self._ping = setInterval(function () { self._send({ t: 'ping' }); }, 25000);
      if (self.room) self._send({ t: 'host', room: self.room, key: keyFor(self.room) });
      else { self.open = true; self.emit('open', self.id); }
    };
    ws.onmessage = function (ev) {
      if (self._ws !== ws) return;
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      self._recv(m);
    };
    ws.onclose = function () {
      if (self._ws !== ws) return;
      self._ws = null; clearInterval(self._ping);
      var wasOpen = self.open;
      self.open = false;
      Object.keys(self._conns).forEach(function (cid) { self._conns[cid]._end(); });
      if (self.destroyed) return;
      self.disconnected = true;
      if (wasOpen) self.emit('disconnected');
      else self.emit('error', { type: 'network', message: 'Сервер игры недоступен' });
    };
  };
  Peer.prototype._recv = function (m) {
    var c = m.cid && this._conns[m.cid];
    switch (m.t) {
      case 'hosted': this.open = true; this.emit('open', this.id); break;
      case 'taken': this.emit('error', { type: 'unavailable-id' }); break;
      case 'conn': {
        var cn = new Conn(this, m.cid, m.from || 'guest');
        cn.open = true; this._conns[m.cid] = cn;
        this.emit('connection', cn);
        setTimeout(function () { if (cn.open) cn.emit('open'); }, 0);
        break;
      }
      case 'opened': if (c && !c.open && !c._done) { c.open = true; c.emit('open'); } break;
      case 'noroom':
        if (c) { c._done = true; delete this._conns[m.cid]; }
        this.emit('error', { type: 'peer-unavailable' });
        break;
      case 'msg': if (c && c.open) c.emit('data', m.d); break;
      case 'close': if (c) c._end(); break;
    }
  };
  Peer.prototype.connect = function (room) {
    var cn = new Conn(this, rid(), room);
    this._conns[cn.cid] = cn;
    this._send({ t: 'join', room: room, cid: cn.cid });
    return cn;
  };
  Peer.prototype.reconnect = function () {
    if (this.destroyed || (this._ws && this._ws.readyState <= 1)) return;
    this._dial();
  };
  Peer.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true; this.open = false;
    var self = this;
    Object.keys(this._conns).forEach(function (cid) { self._conns[cid].close(); });
    clearInterval(this._ping);
    if (this._ws) { var ws = this._ws; this._ws = null; try { ws.close(); } catch (e) {} }
  };

  window.Peer = Peer;
  window.KM_SERVER = httpBase;
})();
