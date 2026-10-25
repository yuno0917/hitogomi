// スマホ（コントローラー）側：スティックの向きをPCに送り、PCから届いた様子を表示する
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const RADIUS = 70;            // スティックをいっぱいに倒したときの指の距離(px)
  const CONNECT_TIMEOUT = 12000;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても遊べる */ } }
  };

  // タブごとに別の人として扱う（同じPCで2つ開いて試せるように）
  function makePid() {
    const id = 'p' + Math.random().toString(36).slice(2, 10);
    try {
      const saved = sessionStorage.getItem('hg-pid');
      if (saved) return saved;
      sessionStorage.setItem('hg-pid', id);
    } catch (e) { /* 読みこみ直すと別の人になるだけ */ }
    return id;
  }
  const pid = makePid();

  $('codeInput').value = (params.get('r') || store.get('hg-code') || '').toUpperCase();
  $('nameInput').value = store.get('hg-name') || '';

  let peer = null, conn = null, code = '', name = '';
  let wantJoin = false, everJoined = false, retryTimer = null;
  let state = null;

  const joinMsg = t => { $('joinMsg').textContent = t; };
  const status = t => { $('status').textContent = t; };

  $('joinBtn').addEventListener('click', () => {
    code = $('codeInput').value.trim().toUpperCase();
    name = $('nameInput').value.trim();
    if (!/^[A-Z0-9]{5}$/.test(code)) return joinMsg('部屋コードは5文字です。PCの画面で確かめてね。');
    if (!name) return joinMsg('なまえを入れてね。');
    store.set('hg-code', code);
    store.set('hg-name', name);
    wantJoin = true;
    joinMsg('つないでいます…');
    connect();
  });

  // ---------- 通信 ----------
  function connect() {
    clearTimeout(retryTimer);
    if (typeof Peer === 'undefined') {
      joinMsg('通信の部品を読みこめませんでした。電波のよい場所で読みこみ直してね。');
      return;
    }
    if (!peer || peer.destroyed) {
      peer = new Peer({ debug: 1 });
      peer.on('open', openConn);
      peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
      peer.on('error', err => {
        if (err.type === 'peer-unavailable' && !everJoined) {
          wantJoin = false;
          joinMsg('部屋が見つかりません。部屋コードを確かめてね。');
          return;
        }
        retry();
      });
    } else if (peer.open) {
      openConn();
    } else if (peer.disconnected) {
      peer.reconnect();
    }
  }

  function openConn() {
    if (!wantJoin || (conn && conn.open)) return;
    const c = peer.connect('hitogomi-' + code.toLowerCase(), { serialization: 'json', reliable: true });
    conn = c;
    const timer = setTimeout(() => {
      if (c.open) return;
      if (!everJoined) joinMsg('つながりませんでした。PCと同じWi-Fiにつないで、もう一度ためしてね。');
      c.close();
      if (conn === c) { conn = null; retry(); }
    }, CONNECT_TIMEOUT);
    c.on('open', () => {
      clearTimeout(timer);
      c.send({ t: 'hello', pid, name });
      status('');
    });
    c.on('data', onData);
    c.on('close', () => {
      clearTimeout(timer);
      if (conn !== c) return;
      conn = null;
      status('切れました。つなぎ直しています…');
      retry();
    });
    c.on('error', () => { if (conn === c) retry(); });
  }

  function retry() {
    if (!wantJoin) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 2000);
  }

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'full') {
      wantJoin = false;
      $('padView').hidden = true;
      $('joinView').hidden = false;
      joinMsg('満員です（8人まで）。');
    } else if (msg.t === 'f') {
      onSnapshot(msg);
    } else if (msg.t === 'fx') {
      if (H.FX_LIFE[msg.k]) fx.push({ type: msg.k, x: msg.x, y: msg.y, dir: msg.dir, range: msg.range, color: msg.color, name: msg.name, t0: performance.now(), life: H.FX_LIFE[msg.k] });
    } else if (msg.t === 'buzz') {
      if (navigator.vibrate) navigator.vibrate(msg.ms);
    } else if (msg.t === 's') {
      state = msg;
      if (!everJoined) {
        everJoined = true;
        $('joinView').hidden = true;
        $('padView').hidden = false;
        requestWakeLock();
      }
      render();
    }
  }

  // ---------- 表示 ----------
  const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  let lastCaught = 0, respawnUntil = 0;   // のりうつったお知らせを出す時間

  function render() {
    const s = state;
    $('meName').textContent = s.name;
    $('meColor').style.background = s.color;
    let role = 'wait', title = '', text = '', stick = false, catchBtn = false, hint = '', info = '';

    if (s.phase === 'lobby' || s.phase === 'hide') lastCaught = 0;
    if ((s.caughtCount || 0) > lastCaught) {
      lastCaught = s.caughtCount;
      if (s.out !== 'caught') respawnUntil = performance.now() + 6000;
    }
    const respawned = s.phase === 'play' && s.out !== 'caught' && performance.now() < respawnUntil;

    if (s.phase === 'lobby') {
      title = '参加しました！';
      text = 'PCの画面を見ながら待ってね。スタートすると、ここがコントローラーになります。';
    } else if (s.role === 'wait') {
      title = '観戦中';
      text = 'いまのラウンドが終わったら参加できます。';
    } else if (s.phase === 'end' && s.result) {
      const win = (s.result.winner === 'humans') === (s.role === 'hider');
      role = win ? 'win' : 'lose';
      title = s.result.winner === 'humans' ? 'ニンゲンの勝ち！' : '鬼の勝ち！';
      text = (win ? 'やったね！' : 'ざんねん…') + '　次のラウンドを待ってね。';
    } else if (s.role === 'hider') {
      role = 'hider';
      hint = '少しだけ倒すと、歩かずに向きだけ変わる';
      if (s.out === 'caught') {
        role = 'out';
        title = '脱落…';
        text = 'チームの残機がなくなりました。あとは観戦して、仲間を応援しよう。';
      } else if (respawned) {
        title = 'のりうつった！';
        text = `つかまったけど、チームの残機で別の人にのりうつった。スティックを少し動かして、新しい自分をさがそう（残機 ${s.lives}）`;
        stick = true;
      } else if (s.phase === 'hide') {
        title = 'あなたはニンゲン';
        text = `スティックを少し動かして、画面で自分をさがそう（${s.left}）`;
        stick = true;
      } else {
        title = 'まわりと同じように歩こう';
        text = '★を集めよう。まっすぐ★に向かったり、ずっと止まっていたりすると、あやしまれるよ。';
        stick = true;
      }
      if (s.phase === 'play') info = `★ ${s.stars}/${s.goal}　残機 ${s.lives}　のこり ${fmt(s.left)}`;
    } else if (s.role === 'seeker') {
      role = 'seeker';
      if (s.phase === 'hide') {
        title = 'あなたは鬼';
        text = `目をつぶって！（${s.left}）`;
      } else {
        title = 'ニンゲンをさがせ';
        text = '鬼を動かして、「つかまえる！」で目の前の人を。画面の点線の輪の中の人は、タップでもつかまえられる。';
        stick = true;
        catchBtn = true;
        hint = '鬼を動かす';
        info = `ハズレ あと${s.missMax - s.misses}回　のこり ${fmt(s.left)}`;
      }
    }

    document.body.className = 'role-' + role;
    $('roleTitle').textContent = title;
    $('roleText').textContent = text;
    $('stickHint').textContent = hint;
    $('infoBar').textContent = info;
    $('stickArea').hidden = !stick;
    $('catchBtn').hidden = !catchBtn;
    $('catchBtn').classList.toggle('cool', !!s.cool);
    if (!stick) resetStick();

    // 広場の画面。鬼は自分さがしタイムのあいだ見られない
    const inRound = s.phase !== 'lobby';
    const blind = s.role === 'seeker' && s.phase === 'hide';
    $('screenBtn').hidden = !inRound;
    $('screenBtn').textContent = screenOn ? '画面をかくす' : '画面を出す';
    $('screenBox').hidden = !(inRound && screenOn);
    $('screenNote').hidden = !blind;
    $('screenNote').textContent = '自分さがしタイムのあいだは見えません';
    document.body.classList.toggle('with-screen', inRound && screenOn);
    if (blind || !inRound) { snapCur = snapPrev = null; fx.length = 0; }
  }

  // ---------- 広場の画面 ----------
  const H = window.Hitogomi;
  const canvas = $('screen'), sctx = canvas.getContext('2d');
  const view = { chars: [], stars: [], seeker: { x: 0, y: 0, dir: 0, moving: false, walkPhase: 0, cooldown: 0 } };
  const colors = {};
  const fx = [];
  let screenOn = store.get('hg-screen') !== 'off';
  let snapPrev = null, snapCur = null, tPrev = 0, tCur = 0, lastFrame = performance.now(), fitted = null;

  $('screenBtn').addEventListener('click', () => {
    screenOn = !screenOn;
    store.set('hg-screen', screenOn ? 'on' : 'off');
    if (state) render();
  });

  function onSnapshot(m) {
    if (state && state.role === 'seeker' && state.phase === 'hide') return;
    snapPrev = snapCur;
    tPrev = tCur;
    snapCur = m;
    tCur = performance.now();
  }

  function fitCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    fitted = H.fitView(w, h);
  }

  // 届いた2つの様子のあいだを補間して、なめらかに動かす
  function drawScreen(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if ($('screenBox').hidden || !snapCur) {
      if (!$('screenBox').hidden) { fitCanvas(); sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.fillStyle = '#1d1c22'; sctx.fillRect(0, 0, canvas.width, canvas.height); }
      return requestAnimationFrame(drawScreen);
    }
    fitCanvas();
    const cur = snapCur, prev = snapPrev && snapPrev.c.length === cur.c.length ? snapPrev : null;
    const a = prev ? Math.min(1, Math.max(0, (now - tCur) / Math.max(30, tCur - tPrev))) : 1;
    const n = cur.c.length / 4;
    while (view.chars.length < n) view.chars.push({ x: 0, y: 0, dir: 0, moving: false, walkPhase: Math.random() * 6, out: null, kind: 'npc', pid: null, name: null });
    view.chars.length = n;
    for (let i = 0; i < n; i++) {
      const ch = view.chars[i], k = i * 4;
      const x1 = cur.c[k], y1 = cur.c[k + 1];
      ch.x = prev ? prev.c[k] + (x1 - prev.c[k]) * a : x1;
      ch.y = prev ? prev.c[k + 1] + (y1 - prev.c[k + 1]) * a : y1;
      ch.dir = cur.c[k + 2] * Math.PI / 180;
      const f = cur.c[k + 3];
      ch.moving = !!(f & 1);
      ch.out = f & 4 ? 'caught' : f & 2 ? 'miss' : null;
      if (ch.moving) ch.walkPhase += dt * 9;
      ch.kind = 'npc'; ch.pid = null; ch.name = null;
    }
    for (const [i, color, name] of cur.rv) {
      const ch = view.chars[i];
      if (!ch) continue;
      ch.kind = 'human'; ch.pid = i; ch.name = name;
      colors[i] = color;
    }
    view.stars.length = 0;
    for (let i = 0; i < cur.st.length; i += 2) view.stars.push({ x: cur.st[i], y: cur.st[i + 1] });
    const sk = cur.sk, psk = prev ? prev.sk : sk, s = view.seeker;
    s.x = psk[0] + (sk[0] - psk[0]) * a;
    s.y = psk[1] + (sk[1] - psk[1]) * a;
    s.dir = sk[2] * Math.PI / 180;
    s.moving = !!sk[3];
    if (s.moving) s.walkPhase += dt * 9 * (sk[7] || H.CONST.SEEKER_SPEED) / H.CONST.WALK;
    s.cooldown = sk[4] * H.CONST.CATCH_COOLDOWN;
    s.range = sk[5];
    s.reach = sk[6];
    while (fx.length && now - fx[0].t0 > fx[0].life) fx.shift();
    H.draw(sctx, view, fitted, {
      t: now / 1000, now, fx, colorOf: i => colors[i], reveal: true, seekerMode: cur.ph
    });
    requestAnimationFrame(drawScreen);
  }
  requestAnimationFrame(drawScreen);

  // 鬼は画面の人をタップしてつかまえられる（鬼の近くの人だけ。判定はPCで行う）
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!state || state.role !== 'seeker' || state.phase !== 'play' || !fitted || !conn || !conn.open) return;
    const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width;
    const x = ((e.clientX - r.left) * dpr - fitted.ox) / fitted.scale;
    const y = ((e.clientY - r.top) * dpr - fitted.oy) / fitted.scale;
    conn.send({ t: 'tap', x: Math.round(x), y: Math.round(y) });
  });

  // ---------- スティック ----------
  const area = $('stickArea'), base = $('stickBase'), knob = $('stickKnob');
  let pointerId = null, origin = null;
  let vec = { x: 0, y: 0 }, lastSent = { x: 0, y: 0 }, lastSentAt = 0;

  function restBase() {
    base.style.left = '50%';
    base.style.top = '50%';
    base.classList.remove('active');
    knob.style.transform = 'translate(-50%, -50%)';
  }

  area.addEventListener('pointerdown', e => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    try { area.setPointerCapture(pointerId); } catch (err) { /* 指が外に出ても大きな問題はない */ }
    const r = area.getBoundingClientRect();
    origin = { x: e.clientX, y: e.clientY };
    base.style.left = (e.clientX - r.left) + 'px';
    base.style.top = (e.clientY - r.top) + 'px';
    base.classList.add('active');
    moveStick(e);
    e.preventDefault();
  });
  area.addEventListener('pointermove', e => { if (e.pointerId === pointerId) moveStick(e); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    area.addEventListener(type, e => { if (e.pointerId === pointerId) releaseStick(); });
  }

  function moveStick(e) {
    let dx = e.clientX - origin.x, dy = e.clientY - origin.y;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) { dx *= RADIUS / d; dy *= RADIUS / d; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    vec = { x: dx / RADIUS, y: dy / RADIUS };
    sendInput(false);
  }

  function releaseStick() {
    pointerId = null;
    vec = { x: 0, y: 0 };
    restBase();
    sendInput(true);
  }

  function resetStick() {
    if (pointerId !== null || vec.x || vec.y) releaseStick();
  }

  const r2 = v => Math.round(v * 100) / 100;

  function sendInput(force) {
    if (!conn || !conn.open) return;
    const now = performance.now();
    const changed = Math.abs(vec.x - lastSent.x) + Math.abs(vec.y - lastSent.y) > 0.04;
    if (!force) {
      if (!changed && now - lastSentAt < 150) return;
      if (now - lastSentAt < 40) return; // 1秒に25回まで
    }
    conn.send({ t: 'i', x: r2(vec.x), y: r2(vec.y) });
    lastSent = { x: vec.x, y: vec.y };
    lastSentAt = now;
  }
  // 倒しっぱなしのあいだも送りつづける（PCは1秒届かないと止める）
  setInterval(() => { if (vec.x || vec.y) sendInput(false); }, 150);

  // ---------- つかまえる ----------
  function doCatch() {
    if (!conn || !conn.open || $('catchBtn').hidden || $('catchBtn').classList.contains('cool')) return;
    conn.send({ t: 'c' });
    $('catchBtn').classList.add('cool');
    if (navigator.vibrate) navigator.vibrate(30);
  }
  $('catchBtn').addEventListener('pointerdown', e => { e.preventDefault(); doCatch(); });

  // PCで試すとき用：WASD・矢印キーとスペース
  const keys = new Set();
  const KEYMAP = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  function keyVec() {
    if ($('stickArea').hidden || pointerId !== null) return;
    let x = 0, y = 0;
    for (const k of keys) { x += KEYMAP[k][0]; y += KEYMAP[k][1]; }
    const d = Math.hypot(x, y) || 1;
    vec = { x: x / d, y: y / d };
    sendInput(true);
  }
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); doCatch(); return; }
    if (KEYMAP[e.code] && !keys.has(e.code)) { keys.add(e.code); keyVec(); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if (KEYMAP[e.code]) { keys.delete(e.code); keyVec(); }
  });

  // ---------- 画面を消さない・戻ったらつなぎ直す ----------
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (e) { /* https でないと使えない */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (everJoined) requestWakeLock();
    if (wantJoin && !(conn && conn.open)) connect();
  });

  restBase();
})();
