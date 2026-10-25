// ゲームのルールと動き（画面や通信には触れない）
(function (root) {
  'use strict';
  const H = root.Hitogomi = root.Hitogomi || {};

  const C = H.CONST = {
    W: 1600, H: 900,
    BOUNDS: { x0: 50, x1: 1550, y0: 110, y1: 870 },
    R: 14,                 // 人の当たり判定の半径
    WALK: 55,              // 歩く速さ（NPCもニンゲンも同じ）
    NPC_COUNT: 40,
    STAR_R: 22,            // ニンゲンが★を拾える距離
    NPC_PICK_R: 8,         // NPCは★をほぼ踏まないと拾わない（横取りが多すぎないように）
    STAR_CLEAR: 70,        // ★は人から少し離れた場所に出す
    SEEKER_SPEED: 95,      // 鬼の歩く速さの初期値（ロビーで変えられる）
    SEEKER_START: { x: 800, y: 640 },
    ATTACK_RANGE: 75,      // 前方攻撃がとどく距離の初期値（足もとどうし。ロビーの「範囲」で倍率が変わる）
    ATTACK_ARC: 1.05,      // 前方攻撃の角度（左右それぞれ約60°）
    TAP_R: 26,             // タップした点と人の見た目の中心の距離
    REACH: 160,            // タップでつかまえられる、鬼からの距離の初期値
    CATCH_COOLDOWN: 1.2,
    MISS_MAX: 3,
    LIVES: 3,              // ニンゲンの残機（チームで共有）の初期値
    RESPAWN_FAR: 250,      // のりうつる先は、なるべく鬼からこれより遠いNPC
    ROUND_TIME: 150,
    HIDE_TIME: 10,         // 自分さがしタイム
    STARS_PER_HIDER: 3,
    STAR_RESPAWN: 1.5,     // ★が取られてから、次の★が出るまで
    NPC_STAR_CHANCE: 0.03, // NPCが★のほうへ歩きだす確率（ニンゲンだけが★に向かうとばれるので）
    DEAD_ZONE: 0.25,       // これより弱く倒すと歩かない
    TURN_ZONE: 0.12        // これより強ければ、その場で向きだけ変わる
  };

  const OBSTACLES = H.OBSTACLES = [
    { kind: 'fountain', x: 800, y: 490, r: 72 },
    { kind: 'tree', x: 270, y: 260, r: 30 },
    { kind: 'tree', x: 1330, y: 260, r: 30 },
    { kind: 'tree', x: 270, y: 730, r: 30 },
    { kind: 'tree', x: 1330, y: 730, r: 30 },
    { kind: 'tree', x: 560, y: 200, r: 26 },
    { kind: 'tree', x: 1040, y: 790, r: 26 }
  ];

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  H.rng = rng;

  function inBounds(x, y, pad) {
    const b = C.BOUNDS;
    return x >= b.x0 + pad && x <= b.x1 - pad && y >= b.y0 + pad && y <= b.y1 - pad;
  }

  function hitsObstacle(x, y, pad) {
    for (const o of OBSTACLES) {
      const dx = x - o.x, dy = y - o.y, rr = o.r + pad;
      if (dx * dx + dy * dy < rr * rr) return o;
    }
    return null;
  }

  function isFree(x, y, pad) {
    return inBounds(x, y, pad) && !hitsObstacle(x, y, pad);
  }
  H.isFree = isFree;

  function randomFreePoint(g, pad, avoid, minDist) {
    const b = C.BOUNDS;
    for (let i = 0; i < 400; i++) {
      const x = b.x0 + pad + g.rand() * (b.x1 - b.x0 - pad * 2);
      const y = b.y0 + pad + g.rand() * (b.y1 - b.y0 - pad * 2);
      if (!isFree(x, y, pad)) continue;
      let ok = true;
      for (const p of avoid || []) {
        if ((p.x - x) ** 2 + (p.y - y) ** 2 < minDist * minDist) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return { x: (b.x0 + b.x1) / 2, y: b.y0 + pad + 10 };
  }

  // opts: { seed, hiders: [{pid, name, bot}], seeker: pid | 'pc', npcCount, hideTime, roundTime, starsPerHider,
  //         seekerSpeed, catchScale（つかまえられる範囲の倍率）, lives（チームの残機） }
  function createGame(opts) {
    const g = {
      rand: rng(opts.seed || 1),
      phase: 'hide',
      hideLeft: opts.hideTime != null ? opts.hideTime : C.HIDE_TIME,
      roundTime: opts.roundTime || C.ROUND_TIME,
      time: 0,
      chars: [],
      stars: [],
      respawns: [],          // 次の★を出す時刻
      collected: 0,
      stolen: 0,             // NPCが横取りした★
      goal: Math.max(1, opts.hiders.length) * (opts.starsPerHider || C.STARS_PER_HIDER),
      seeker: {
        pid: opts.seeker, x: C.SEEKER_START.x, y: C.SEEKER_START.y, dir: -Math.PI / 2,
        moving: false, walkPhase: 0, cooldown: 0, misses: 0,
        speed: opts.seekerSpeed || C.SEEKER_SPEED,
        range: C.ATTACK_RANGE * (opts.catchScale || 1),
        reach: C.REACH * (opts.catchScale || 1)
      },
      lives: opts.lives != null ? opts.lives : C.LIVES,
      hiders: {},            // pid → ニンゲンの成績（体がかわっても引きつぐ）
      events: [],
      result: null
    };
    g.livesMax = g.lives;
    for (const h of opts.hiders) {
      g.hiders[h.pid] = { pid: h.pid, name: h.name, kind: h.bot ? 'bot' : 'human', stars: 0, caught: 0, out: null, caughtAt: null };
    }
    const npcCount = opts.npcCount != null ? opts.npcCount : C.NPC_COUNT;
    const kinds = [];
    for (let i = 0; i < npcCount; i++) kinds.push(null);
    for (const h of opts.hiders) kinds.push(h);
    // ニンゲンの並び順から正体がばれないように混ぜる
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(g.rand() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    kinds.forEach((h, i) => {
      // 鬼のすぐそばには置かない（始まってすぐ取られないように）
      let p = null;
      for (let k = 0; k < 20; k++) {
        p = randomFreePoint(g, C.R + 4, g.chars, 34);
        if (Math.hypot(p.x - C.SEEKER_START.x, p.y - C.SEEKER_START.y) > 100) break;
      }
      const c = {
        id: i, x: p.x, y: p.y, dir: g.rand() * Math.PI * 2,
        moving: false, state: 'idle', timer: g.rand() * 2, walkPhase: g.rand() * 6,
        kind: h ? (h.bot ? 'bot' : 'human') : 'npc',
        pid: h ? h.pid : null, name: h ? h.name : null,
        out: null
      };
      g.chars.push(c);
    });
    return g;
  }
  H.createGame = createGame;

  function isHider(c) { return c.kind !== 'npc'; }
  H.isHider = isHider;

  function hidersLeft(g) { return g.chars.filter(c => isHider(c) && !c.out).length; }
  H.hidersLeft = hidersLeft;

  // ニンゲン全員の成績
  H.hiderList = function (g) { return Object.values(g.hiders); };
  H.findHider = function (g, pid) { return g.hiders[pid] || null; };

  // 前方に障害物や壁がないか
  function clearAhead(c, dir, dist) {
    for (let d = 20; d <= dist; d += 20) {
      if (!isFree(c.x + Math.cos(dir) * d, c.y + Math.sin(dir) * d, C.R)) return false;
    }
    return true;
  }

  function startWalk(g, c, dir) {
    if (dir == null) {
      dir = g.rand() * Math.PI * 2;
      for (let i = 0; i < 10 && !clearAhead(c, dir, 70); i++) dir = g.rand() * Math.PI * 2;
    }
    c.state = 'walk';
    c.dir = dir;
    c.timer = 1.5 + g.rand() * 4;
  }

  function startIdle(g, c) {
    c.state = 'idle';
    c.moving = false;
    c.timer = 0.6 + g.rand() * 2.6;
  }

  // 少し歩いて、止まって、きょろきょろする。starChance の確率で★のほうへ歩きだす
  // NPCは小さい確率、ボット（ニンゲン役）は大きい確率
  function wander(g, c, dt, starChance) {
    c.timer -= dt;
    if (c.state === 'walk') {
      if (c.timer <= 0 || !moveStrict(c, dt)) startIdle(g, c);
      return;
    }
    if (g.rand() < dt * 0.5) c.dir += (g.rand() < 0.5 ? -1 : 1) * (0.5 + g.rand() * 1.6);
    if (c.timer > 0) return;
    const star = nearest(g.stars, c);
    if (star && g.rand() < starChance) {
      const dist = Math.hypot(star.x - c.x, star.y - c.y);
      const dir = Math.atan2(star.y - c.y, star.x - c.x) + (g.rand() - 0.5) * 0.4;
      if (clearAhead(c, dir, Math.min(70, dist))) {
        startWalk(g, c, dir);
        c.timer = Math.min(c.timer, dist / C.WALK + 0.2);
        return;
      }
    }
    startWalk(g, c);
  }

  // ボット（ニンゲン役）：★があれば、いちばん近い★へまっすぐ向かう。障害物はよけて回りこむ
  function updateBot(g, c, dt) {
    const star = nearest(g.stars, c);
    if (!star) return wander(g, c, dt, 0);
    c.state = 'walk';
    c.dir = Math.atan2(star.y - c.y, star.x - c.x);
    const dist = Math.hypot(star.x - c.x, star.y - c.y);
    const look = Math.min(40, dist);
    if (dist > 30 && !clearAhead(c, c.dir, look)) {
      const o = blockingObstacle(c, c.dir, look);
      if (o) {
        // 障害物のふちに沿って、★に近い側から回りこむ
        const ax = o.x - c.x, ay = o.y - c.y, bx = star.x - c.x, by = star.y - c.y;
        c.dir = Math.atan2(ay, ax) + (ax * by - ay * bx >= 0 ? 1 : -1) * Math.PI / 2;
      } else {
        c.dir += (c.id % 2 ? 1 : -1) * Math.PI / 2;   // 壁ぎわ
      }
    }
    moveSlide(c, dt);
  }

  function blockingObstacle(c, dir, dist) {
    for (let d = 20; d <= dist; d += 20) {
      const o = hitsObstacle(c.x + Math.cos(dir) * d, c.y + Math.sin(dir) * d, C.R);
      if (o) return o;
    }
    return null;
  }

  function nearest(list, p) {
    let best = null, bd = Infinity;
    for (const s of list) {
      const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ぶつかるなら動かない（NPC用）
  function moveStrict(c, dt) {
    const nx = c.x + Math.cos(c.dir) * C.WALK * dt;
    const ny = c.y + Math.sin(c.dir) * C.WALK * dt;
    if (!isFree(nx, ny, C.R)) { c.moving = false; return false; }
    c.x = nx; c.y = ny; c.moving = true;
    c.walkPhase += dt * 9;
    return true;
  }

  // 壁や障害物に沿ってすべる（ニンゲンと鬼）
  function moveSlide(c, dt, speed) {
    speed = speed || C.WALK;
    c.x += Math.cos(c.dir) * speed * dt;
    c.y += Math.sin(c.dir) * speed * dt;
    pushOut(c);
    c.moving = true;
    c.walkPhase += dt * 9 * speed / C.WALK;
  }

  function pushOut(c) {
    const b = C.BOUNDS;
    for (const o of OBSTACLES) {
      const dx = c.x - o.x, dy = c.y - o.y, rr = o.r + C.R;
      const d = Math.hypot(dx, dy);
      if (d < rr && d > 0.001) { c.x = o.x + dx / d * rr; c.y = o.y + dy / d * rr; }
    }
    c.x = Math.min(b.x1 - C.R, Math.max(b.x0 + C.R, c.x));
    c.y = Math.min(b.y1 - C.R, Math.max(b.y0 + C.R, c.y));
  }

  function updateHuman(c, input, dt) {
    const x = input ? input.x : 0, y = input ? input.y : 0;
    const m = Math.hypot(x, y);
    if (m >= C.TURN_ZONE) c.dir = Math.atan2(y, x);
    if (m >= C.DEAD_ZONE) moveSlide(c, dt);
    else c.moving = false;
  }

  // 重なりすぎた人どうしを少し離す
  function separate(g) {
    const list = g.chars.filter(c => !c.out);
    const min = C.R * 1.7;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 0.0001) continue;
        const d = Math.sqrt(d2), push = (min - d) * 0.25;
        const ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        pushOut(a); pushOut(b);
      }
    }
  }

  // 広場の★は、残っているニンゲンの数だけ
  function targetStars(g) {
    return Math.max(1, hidersLeft(g));
  }

  function spawnStar(g) {
    let p = null;
    for (let i = 0; i < 30; i++) {
      p = randomFreePoint(g, 40, g.stars, 160);
      if (g.chars.every(c => c.out || (c.x - p.x) ** 2 + (c.y - p.y) ** 2 >= C.STAR_CLEAR ** 2)) break;
    }
    g.stars.push({ x: p.x, y: p.y, born: g.time });
  }

  function refillStars(g) {
    g.respawns = g.respawns.filter(t => {
      if (t > g.time) return true;
      if (g.stars.length < targetStars(g)) spawnStar(g);
      return false;
    });
    while (g.stars.length + g.respawns.length < targetStars(g)) g.respawns.push(g.time + C.STAR_RESPAWN);
  }

  function end(g, winner, reason) {
    if (g.phase === 'end') return;
    g.phase = 'end';
    g.result = { winner, reason };
    g.events.push({ type: 'end', winner, reason });
  }

  // inputs: { [pid]: {x, y} }。鬼がスマホなら inputs[鬼のpid] でカーソルが動く
  function step(g, dt, inputs) {
    inputs = inputs || {};
    for (const c of g.chars) {
      if (c.out) continue;
      if (c.kind === 'npc') wander(g, c, dt, C.NPC_STAR_CHANCE);
      else if (c.kind === 'bot') updateBot(g, c, dt);
      else if (g.phase !== 'end') updateHuman(c, inputs[c.pid], dt);
      else c.moving = false;
    }
    separate(g);

    // 鬼のキャラ。自分さがしタイムのあいだは動けない
    const s = g.seeker;
    const inp = inputs[s.pid];
    if (g.phase === 'play' && inp) {
      const m = Math.hypot(inp.x, inp.y);
      if (m >= C.TURN_ZONE) s.dir = Math.atan2(inp.y, inp.x);
      if (m >= C.DEAD_ZONE) moveSlide(s, dt, s.speed);
      else s.moving = false;
    } else {
      s.moving = false;
    }
    if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - dt);

    if (g.phase === 'hide') {
      g.hideLeft -= dt;
      if (g.hideLeft <= 0) {
        g.phase = 'play';
        g.hideLeft = 0;
        for (let i = 0; i < targetStars(g); i++) spawnStar(g);
        g.events.push({ type: 'start' });
      }
      return;
    }
    if (g.phase !== 'play') return;

    g.time += dt;

    // ★はだれが通っても消える。数に入るのはニンゲンが取ったときだけ
    // （NPCが取ったときも見た目と音は同じなので、鬼には区別がつかない）
    for (const c of g.chars) {
      if (c.out) continue;
      const r = isHider(c) ? C.STAR_R : C.NPC_PICK_R;
      for (let i = g.stars.length - 1; i >= 0; i--) {
        const st = g.stars[i];
        if ((st.x - c.x) ** 2 + (st.y - c.y) ** 2 >= r * r) continue;
        g.stars.splice(i, 1);
        if (isHider(c)) {
          g.collected++;
          g.hiders[c.pid].stars++;
        } else {
          g.stolen++;
        }
        g.events.push({ type: 'star', pid: isHider(c) ? c.pid : null, x: st.x, y: st.y });
      }
    }
    refillStars(g);
    if (g.collected >= g.goal) return end(g, 'humans', 'stars');
    if (g.time >= g.roundTime) return end(g, 'seeker', 'time');
  }
  H.step = step;

  function angleDiff(a, b) {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }

  // 前方攻撃：鬼の目の前にいる、いちばん近い人をつかまえる
  function attack(g) {
    const s = g.seeker;
    if (g.phase !== 'play' || s.cooldown > 0) return null;
    s.cooldown = C.CATCH_COOLDOWN;
    g.events.push({ type: 'swing', x: s.x, y: s.y, dir: s.dir, range: s.range });
    let best = null, bd = Infinity;
    for (const c of g.chars) {
      if (c.out) continue;
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d > s.range) continue;
      const inFront = d < C.R * 1.2 || angleDiff(Math.atan2(c.y - s.y, c.x - s.x), s.dir) <= C.ATTACK_ARC;
      if (inFront && d < bd) { bd = d; best = c; }
    }
    if (!best) {
      g.events.push({ type: 'whiff', x: s.x, y: s.y });
      return 'whiff';
    }
    return resolve(g, best);
  }
  H.attack = attack;

  // タップ：画面でタップした人をつかまえる。ただし鬼の近くの人だけ
  function tapAt(g, x, y) {
    const s = g.seeker;
    if (g.phase !== 'play' || s.cooldown > 0) return null;
    let best = null, bd = C.TAP_R * C.TAP_R;
    for (const c of g.chars) {
      if (c.out) continue;
      // 人の見た目の中心（頭と体のあいだ）で判定する
      const d = (c.x - x) ** 2 + (c.y - 14 - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    if (Math.hypot(best.x - s.x, best.y - s.y) > s.reach) {
      g.events.push({ type: 'far', x: best.x, y: best.y });
      return 'far';
    }
    s.cooldown = C.CATCH_COOLDOWN;
    s.dir = Math.atan2(best.y - s.y, best.x - s.x);
    g.events.push({ type: 'swing', x: s.x, y: s.y, dir: s.dir, range: s.range });
    return resolve(g, best);
  }
  H.tapAt = tapAt;

  function resolve(g, best) {
    const s = g.seeker;
    best.moving = false;
    if (!isHider(best)) {
      best.out = 'miss';
      s.misses++;
      g.events.push({ type: 'miss', x: best.x, y: best.y, left: C.MISS_MAX - s.misses });
      if (s.misses >= C.MISS_MAX) end(g, 'humans', 'misses');
      return 'miss';
    }
    // 見つかった体は、その場で止まる（色と名前が出る）。owner はだれの体だったか
    const rec = g.hiders[best.pid];
    rec.caught++;
    const ev = { type: 'caught', pid: rec.pid, name: rec.name, x: best.x, y: best.y };
    best.out = 'caught';
    best.owner = rec.pid;
    best.pid = null;

    // 残機があれば、別のNPCにのりうつって続ける（残機はチームで共有）
    const body = g.lives > 0 ? pickBody(g) : null;
    if (body) {
      g.lives--;
      body.kind = rec.kind;
      body.pid = rec.pid;
      body.name = rec.name;
      body.state = 'idle';
      body.timer = 0.5;
      body.moving = false;
      ev.respawn = true;
    } else {
      rec.out = 'caught';
      rec.caughtAt = g.time;
      ev.respawn = false;
    }
    ev.lives = g.lives;
    g.events.push(ev);
    if (hidersLeft(g) === 0) end(g, 'seeker', 'caught');
    return 'caught';
  }

  // のりうつる先：なるべく鬼から遠いNPCをランダムに
  function pickBody(g) {
    const s = g.seeker;
    const all = g.chars.filter(c => c.kind === 'npc' && !c.out);
    const far = all.filter(c => Math.hypot(c.x - s.x, c.y - s.y) > C.RESPAWN_FAR);
    const pool = far.length ? far : all;
    return pool.length ? pool[Math.floor(g.rand() * pool.length)] : null;
  }

  H.timeLeft = function (g) {
    return g.phase === 'hide' ? g.hideLeft : Math.max(0, g.roundTime - g.time);
  };
})(typeof window !== 'undefined' ? window : globalThis);
