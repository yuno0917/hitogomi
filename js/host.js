// PC（ホスト）側：部屋を立てて、ゲームを動かして、みんなのスマホに様子を送る
(function () {
  'use strict';
  const H = window.Hitogomi, C = H.CONST;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');
  const HIDE_TIME = params.has('hide') ? Number(params.get('hide')) : C.HIDE_TIME;
  const TIME_OVERRIDE = params.has('time') ? Number(params.get('time')) : null; // テスト用
  const MAX_PLAYERS = 8;
  const STEP = 1 / 60;
  const SNAP_EVERY = 1000 / 12;  // スマホに広場の様子を送る間隔(ms)
  const TAU = Math.PI * 2;
  const ZERO = { x: 0, y: 0 };
  const BOT_COLORS = ['#7d8597', '#a07850', '#5f8f8b', '#9a6fa0'];

  const canvas = $('field'), ctx = canvas.getContext('2d');
  let view = null;
  const players = new Map(); // pid -> { pid, name, color, conn, connected, input, lastInput, inGame }
  let phase = 'lobby';       // lobby | hide | play | end
  let game = attractGame();
  let seekerPid = null;      // 'pc' か スマホのpid
  let fx = [];
  let peer = null, roomCode = null;
  let resultTimer = null, bannerTimer = null, lastSec = -1;

  // ロビーの後ろで歩いている人ごみ
  function attractGame() {
    return H.createGame({ seed: (Math.random() * 1e9) | 0, hiders: [], seeker: 'none', hideTime: 1e9 });
  }

  // ---------- 通信 ----------
  function makeCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  function startPeer() {
    if (typeof Peer === 'undefined') {
      warn('通信の部品を読みこめませんでした。インターネットにつながっているか確かめてください。');
      return;
    }
    roomCode = makeCode();
    peer = new Peer('hitogomi-' + roomCode.toLowerCase(), { debug: 1 });
    peer.on('open', showJoin);
    peer.on('connection', onConnection);
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', err => {
      if (err.type === 'unavailable-id') { peer.destroy(); startPeer(); return; }
      if (err.type === 'peer-unavailable') return;
      warn('通信エラー（' + err.type + '）。ページを読みこみ直してください。');
    });
  }

  function joinUrl() {
    const base = location.href.split(/[?#]/)[0].replace(/index\.html$/, '');
    return base + 'play.html?r=' + roomCode;
  }

  function showJoin() {
    $('roomCode').textContent = roomCode;
    const url = joinUrl();
    $('joinUrl').textContent = url;
    if (typeof qrcode !== 'undefined') {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      $('qr').innerHTML = qr.createImgTag(5, 8);
    }
    if (location.protocol === 'file:') {
      warn('このままではスマホから入れません。play.bat から開いてください。');
    } else if (/^(localhost|127\.)/.test(location.hostname)) {
      warn('このアドレスはこのPCの中だけで使えます。スマホからは、play.bat が表示する http://192.168… のアドレスで開いてください。');
    }
  }

  function warn(text) {
    const el = $('netWarn');
    el.textContent = text;
    el.hidden = false;
  }

  function onConnection(conn) {
    conn.on('data', msg => onMessage(conn, msg));
    conn.on('close', () => onClose(conn));
    conn.on('error', () => onClose(conn));
  }

  function send(conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { /* 切れていたら次の送信でやり直す */ }
  }

  const clamp1 = v => Math.max(-1, Math.min(1, Number(v) || 0));

  function onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') return onHello(conn, msg);
    const p = conn._player;
    if (!p) return;
    if (msg.t === 'i') {
      p.input = { x: clamp1(msg.x), y: clamp1(msg.y) };
      p.lastInput = performance.now();
    } else if (msg.t === 'c' && phase === 'play' && p.pid === seekerPid) {
      H.attack(game);
    } else if (msg.t === 'tap' && phase === 'play' && p.pid === seekerPid) {
      // スマホの画面でタップした人をつかまえる（鬼の近くの人だけ）
      const x = Number(msg.x), y = Number(msg.y);
      if (Number.isFinite(x) && Number.isFinite(y)) H.tapAt(game, x, y);
    }
  }

  function onHello(conn, msg) {
    const pid = String(msg.pid || '').slice(0, 40);
    const name = String(msg.name || '').trim().slice(0, 10) || 'ななし';
    if (!pid) return;
    let p = players.get(pid);
    if (!p) {
      if (players.size >= MAX_PLAYERS) {
        send(conn, { t: 'full' });
        setTimeout(() => conn.close(), 500);
        return;
      }
      p = { pid, name, color: nextColor(), input: ZERO, lastInput: 0, inGame: false };
      players.set(pid, p);
    } else if (p.conn && p.conn !== conn) {
      try { p.conn.close(); } catch (e) { /* もう切れている */ }
    }
    p.name = name;
    p.conn = conn;
    p.connected = true;
    conn._player = p;
    for (const c of game.chars) if (c.pid === pid) c.name = name;
    renderLobby();
    sendState(p);
  }

  function onClose(conn) {
    const p = conn._player;
    if (!p || p.conn !== conn) return;
    p.connected = false;
    p.input = ZERO;
    if (phase === 'lobby') players.delete(p.pid);
    renderLobby();
  }

  function nextColor() {
    const used = new Set([...players.values()].map(p => p.color));
    return H.PLAYER_COLORS.find(c => !used.has(c)) || H.PLAYER_COLORS[players.size % H.PLAYER_COLORS.length];
  }

  function colorOf(pid) {
    const p = players.get(pid);
    if (p) return p.color;
    const m = /^bot(\d+)$/.exec(pid || '');
    return m ? BOT_COLORS[Number(m[1]) % BOT_COLORS.length] : '#999';
  }

  function nameOf(pid) {
    if (pid === 'pc') return 'このPC';
    const p = players.get(pid);
    return p ? p.name : '';
  }

  function stateFor(p) {
    const s = { t: 's', phase, name: p.name, color: p.color, role: 'wait' };
    if (phase !== 'lobby' && p.inGame) {
      s.role = p.pid === seekerPid ? 'seeker' : 'hider';
      const h = H.findHider(game, p.pid);
      s.out = h ? h.out : null;
      s.myStars = h ? h.stars : 0;
      s.caughtCount = h ? h.caught : 0;
      s.lives = game.lives;
      s.stars = game.collected;
      s.goal = game.goal;
      s.misses = game.seeker.misses;
      s.missMax = C.MISS_MAX;
      s.left = Math.ceil(H.timeLeft(game));
      s.cool = game.seeker.cooldown > 0;
      s.result = game.result;
    }
    return s;
  }

  function sendState(p) { if (p.connected) send(p.conn, stateFor(p)); }
  function broadcast() { for (const p of players.values()) sendState(p); }
  function buzz(pid, ms) { const p = players.get(pid); if (p && p.connected) send(p.conn, { t: 'buzz', ms }); }

  // 広場の様子（スマホの画面用）。だれがニンゲンかは、見つかった人と終わったあとしか入れない
  function snapshot() {
    const c = [], rv = [], st = [];
    game.chars.forEach((ch, i) => {
      const deg = Math.round((((ch.dir % TAU) + TAU) % TAU) * 180 / Math.PI);
      c.push(Math.round(ch.x), Math.round(ch.y), deg,
        (ch.moving ? 1 : 0) | (ch.out === 'miss' ? 2 : 0) | (ch.out === 'caught' ? 4 : 0));
      if (H.isHider(ch) && (ch.out === 'caught' || phase === 'end')) rv.push([i, colorOf(ch.owner || ch.pid), ch.name]);
    });
    for (const s of game.stars) st.push(Math.round(s.x), Math.round(s.y));
    const s = game.seeker;
    const sk = [Math.round(s.x), Math.round(s.y), Math.round((((s.dir % TAU) + TAU) % TAU) * 180 / Math.PI),
      s.moving ? 1 : 0, Math.round(s.cooldown / C.CATCH_COOLDOWN * 100) / 100,
      Math.round(s.range), Math.round(s.reach), s.speed];
    return { t: 'f', ph: phase, c, rv, st, sk };
  }

  function sendSnapshots() {
    if (phase === 'lobby') return;
    const snap = snapshot();
    for (const p of players.values()) {
      if (!p.connected) continue;
      if (phase === 'hide' && p.pid === seekerPid) continue; // 鬼には自分さがしタイムの画面を見せない
      send(p.conn, snap);
    }
  }

  function sendFx(type, e) {
    const msg = { t: 'fx', k: type, x: Math.round(e.x), y: Math.round(e.y), color: e.pid ? colorOf(e.pid) : null };
    if (e.name) msg.name = e.name;
    if (e.range) msg.range = Math.round(e.range);
    if (e.dir != null) msg.dir = Math.round(e.dir * 100) / 100;
    for (const p of players.values()) if (p.connected) send(p.conn, msg);
  }

  // ---------- ロビー ----------
  function connectedPlayers() { return [...players.values()].filter(p => p.connected); }

  function renderLobby() {
    const list = connectedPlayers();
    $('playerCount').textContent = list.length;
    const ul = $('playerList');
    ul.innerHTML = '';
    if (!list.length) ul.innerHTML = '<li class="empty">まだだれもいません</li>';
    for (const p of list) {
      const li = document.createElement('li');
      li.innerHTML = '<i></i>';
      li.querySelector('i').style.background = p.color;
      li.append(p.name);
      ul.append(li);
    }

    const sel = $('seekerSelect'), keep = sel.value || 'pc';
    sel.innerHTML = '';
    const opts = [['pc', 'このPC'], ['random', 'ランダム']].concat(list.map(p => [p.pid, p.name]));
    for (const [v, label] of opts) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.append(o);
    }
    sel.value = opts.some(o => o[0] === keep) ? keep : 'pc';
    updateStartButton();
  }

  function planRound() {
    const list = connectedPlayers();
    let seeker = $('seekerSelect').value;
    if (seeker === 'random') seeker = list.length ? list[Math.floor(Math.random() * list.length)].pid : 'pc';
    const bots = Number($('botSelect').value);
    const hiders = list.filter(p => p.pid !== seeker).map(p => ({ pid: p.pid, name: p.name }));
    for (let i = 0; i < bots; i++) hiders.push({ pid: 'bot' + i, name: 'ボット' + (i + 1), bot: true });
    return { seeker, hiders, list };
  }

  function updateStartButton() {
    const sel = $('seekerSelect').value;
    const list = connectedPlayers();
    const bots = Number($('botSelect').value);
    // スマホの人が鬼になると、ニンゲンは1人減る
    const humans = sel === 'pc' ? list.length : Math.max(0, list.length - 1);
    const ok = humans + bots >= 1;
    $('startBtn').disabled = !ok;
    $('startHint').textContent = ok ? '' : 'ニンゲンが1人以上いると始められます（スマホで参加するか、ボットを入れてください）。';
  }

  function startRound() {
    const { seeker, hiders, list } = planRound();
    if (!hiders.length) return;
    seekerPid = seeker;
    for (const p of players.values()) {
      p.inGame = list.includes(p);
      p.input = ZERO;
    }
    saveSettings();
    game = H.createGame({
      seed: (Math.random() * 1e9) | 0, hiders, seeker, hideTime: HIDE_TIME,
      npcCount: Number($('npcSelect').value),
      starsPerHider: Number($('starSelect').value),
      seekerSpeed: Number($('speedSelect').value),
      catchScale: Number($('rangeSelect').value),
      lives: Number($('livesSelect').value),
      roundTime: TIME_OVERRIDE || Number($('timeSelect').value)
    });
    phase = 'hide';
    fx = [];
    lastSec = -1;
    $('lobby').hidden = true;
    $('result').hidden = true;
    $('hud').hidden = false;
    $('hudGoal').textContent = game.goal;
    document.body.classList.toggle('pc-seeker', seekerPid === 'pc');
    H.sound.unlock();
    H.sound.start();
    broadcast();
  }

  function backToLobby() {
    clearTimeout(resultTimer);
    phase = 'lobby';
    game = attractGame();
    seekerPid = null;
    fx = [];
    for (const p of [...players.values()]) {
      p.inGame = false;
      if (!p.connected) players.delete(p.pid);
    }
    $('result').hidden = true;
    $('hud').hidden = true;
    $('banner').hidden = true;
    $('lobby').hidden = false;
    document.body.classList.remove('pc-seeker');
    renderLobby();
    broadcast();
  }

  // ---------- ゲーム中 ----------
  function banner(text, ms) {
    const el = $('banner');
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function handleEvents(now) {
    for (const e of game.events) {
      if (H.FX_LIFE[e.type]) {
        const color = e.type === 'caught' ? colorOf(e.pid) : null;
        fx.push({ type: e.type, x: e.x, y: e.y, dir: e.dir, range: e.range, name: e.type === 'caught' ? e.name : null, t0: now, life: H.FX_LIFE[e.type], color });
        // ★はだれが取ったか分からないように、スマホにも同じ演出だけを送る
        sendFx(e.type, e.type === 'caught' ? e : { x: e.x, y: e.y, dir: e.dir, range: e.range });
      }
      if (e.type === 'start') {
        banner('スタート！　鬼はさがしはじめて！', 1800);
        H.sound.start();
      } else if (e.type === 'star') {
        H.sound.star();
        buzz(e.pid, 60);
      } else if (e.type === 'swing' || e.type === 'far') {
        H.sound.whiff();
      } else if (e.type === 'miss') {
        H.sound.miss();
        if (e.left > 0) banner('ハズレ！　あと' + e.left + '回', 1400);
      } else if (e.type === 'caught') {
        H.sound.caught();
        banner(e.respawn
          ? `ニンゲン発見！　${e.name} は別の人にのりうつった（残機 ${e.lives}）`
          : `ニンゲン発見！　${e.name} は脱落`, 2200);
        buzz(e.pid, [200, 100, 300]);
      } else if (e.type === 'end') {
        H.sound.end();
        banner(e.winner === 'humans' ? 'ニンゲンの勝ち！' : '鬼の勝ち！', 0);
        resultTimer = setTimeout(showResult, 1800);
      }
    }
    game.events.length = 0;
    fx = fx.filter(f => now - f.t0 < f.life);
    if (fx.length > 40) fx.splice(0, fx.length - 40);
  }

  const REASONS = {
    stars: n => `★を${n}個集めきった！`,
    misses: () => '鬼がハズレを3回出した',
    caught: () => 'ニンゲンを全員脱落させた',
    time: () => '時間切れ。ニンゲンは★を集めきれなかった'
  };

  function showResult() {
    const r = game.result;
    $('banner').hidden = true;
    $('resultTitle').textContent = r.winner === 'humans' ? 'ニンゲンの勝ち！' : '鬼の勝ち！';
    $('resultTitle').className = r.winner;
    $('resultReason').textContent = REASONS[r.reason](game.goal) +
      `（ニンゲンが集めた★ ${game.collected}個／NPCが横取りした★ ${game.stolen}個）`;
    const ul = $('resultList');
    ul.innerHTML = '';
    for (const c of H.hiderList(game)) {
      const li = document.createElement('li');
      li.innerHTML = '<i></i><span class="n"></span><span class="s"></span>';
      li.querySelector('i').style.background = colorOf(c.pid);
      li.querySelector('.n').textContent = c.name;
      li.querySelector('.s').textContent = `★${c.stars}　つかまった${c.caught}回　` + (c.out === 'caught' ? `${Math.ceil(c.caughtAt)}秒で脱落` : '逃げきり');
      ul.append(li);
    }
    const li = document.createElement('li');
    li.className = 'seeker';
    li.innerHTML = '<i></i><span class="n"></span><span class="s"></span>';
    li.querySelector('i').style.background = '#ff3b3b';
    li.querySelector('.n').textContent = '鬼：' + nameOf(seekerPid);
    li.querySelector('.s').textContent = `ハズレ ${game.seeker.misses}回`;
    ul.append(li);
    $('result').hidden = false;
  }

  function fmt(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function updateHud() {
    // ★の数が増えたかどうかで正体がばれないように、PCの画面では終わるまで隠す
    $('hudStars').textContent = game.phase === 'end' ? game.collected : '？';
    $('hudTime').textContent = game.phase === 'hide' ? '–:––' : fmt(H.timeLeft(game));
    $('hudTime').classList.toggle('low', game.phase === 'play' && H.timeLeft(game) <= 20);
    $('hudMiss').textContent = '●'.repeat(game.seeker.misses) + '○'.repeat(C.MISS_MAX - game.seeker.misses);
    $('hudLives').textContent = game.livesMax ? '♥'.repeat(game.lives) + '♡'.repeat(game.livesMax - game.lives) : 'なし';
    if (game.phase === 'hide') {
      const sec = Math.ceil(game.hideLeft);
      if (sec !== lastSec) {
        lastSec = sec;
        banner(`鬼は目をつぶって！　ニンゲンは自分をさがそう　${sec}`, 0);
        H.sound.tick();
      }
    }
  }

  // ---------- 入力（PCで鬼をやるとき）：WASD・矢印で歩く、スペースで前方攻撃、クリックで近くの人 ----------
  const keys = new Set();
  const KEYMAP = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  function pcInput() {
    let x = 0, y = 0;
    for (const k of keys) { x += KEYMAP[k][0]; y += KEYMAP[k][1]; }
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
  }
  window.addEventListener('keydown', e => {
    if (seekerPid !== 'pc' || e.target.tagName === 'SELECT') return;
    if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); }
    if (e.code === 'Space' && phase === 'play') { H.attack(game); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); });
  window.addEventListener('blur', () => keys.clear());

  function toField(e) {
    const dpr = window.devicePixelRatio || 1;
    return { x: (e.clientX * dpr - view.ox) / view.scale, y: (e.clientY * dpr - view.oy) / view.scale };
  }
  canvas.addEventListener('pointerdown', e => {
    if (seekerPid !== 'pc' || phase !== 'play') return;
    const p = toField(e);
    H.tapAt(game, p.x, p.y);
  });

  // ---------- 描画とループ ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    view = H.fitView(canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now(), acc = 0, lastBroadcast = 0, lastSnap = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    const inputs = {};
    if (phase !== 'lobby') {
      for (const p of players.values()) {
        inputs[p.pid] = p.connected && now - p.lastInput < 1000 ? p.input : ZERO;
      }
      if (seekerPid === 'pc') inputs.pc = pcInput();
    }
    while (acc >= STEP) {
      H.step(game, STEP, inputs);
      acc -= STEP;
    }
    if (phase !== 'lobby') {
      const before = phase;
      phase = game.phase;
      handleEvents(now);
      updateHud();
      if (before !== phase) broadcast();
    }
    H.draw(ctx, game, view, {
      t: now / 1000, now, fx, debug: DEBUG, colorOf,
      reveal: phase === 'end',
      seekerMode: phase === 'lobby' ? null : phase
    });
    if (now - lastBroadcast > 250) {
      lastBroadcast = now;
      broadcast();
    }
    if (now - lastSnap > SNAP_EVERY) {
      lastSnap = now;
      sendSnapshots();
    }
    requestAnimationFrame(frame);
  }

  // ---------- ロビーの設定を覚えておく ----------
  const SETTINGS = ['npcSelect', 'timeSelect', 'starSelect', 'botSelect', 'speedSelect', 'rangeSelect', 'livesSelect'];
  function saveSettings() {
    try {
      const s = {};
      for (const id of SETTINGS) s[id] = $(id).value;
      localStorage.setItem('hg-settings', JSON.stringify(s));
    } catch (e) { /* 保存できなくても遊べる */ }
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('hg-settings') || '{}');
      for (const id of SETTINGS) {
        if (s[id] && [...$(id).options].some(o => o.value === s[id])) $(id).value = s[id];
      }
    } catch (e) { /* 初めてのときや保存できないときは最初の値 */ }
  }

  $('startBtn').addEventListener('click', startRound);
  $('againBtn').addEventListener('click', backToLobby);
  $('seekerSelect').addEventListener('change', updateStartButton);
  $('botSelect').addEventListener('change', updateStartButton);
  $('fullBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });

  loadSettings();
  renderLobby();
  startPeer();
  requestAnimationFrame(frame);

  // テスト用
  window.__hg = {
    get game() { return game; }, get phase() { return phase; }, get code() { return roomCode; },
    players, startRound, backToLobby
  };
})();
