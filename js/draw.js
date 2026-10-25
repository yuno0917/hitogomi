// 広場と人の描画
(function (root) {
  'use strict';
  const H = root.Hitogomi = root.Hitogomi || {};
  const C = H.CONST;

  const BODY = '#6f9fd8', BODY_DARK = '#5683bd', SKIN = '#f6d3b3', HAIR = '#5b4334', SHOE = '#4a3b33';
  H.PLAYER_COLORS = ['#ff5a5a', '#ffb020', '#3cc46a', '#b066ff', '#ff6fb5', '#18b5c9', '#8a5a2b', '#222222'];
  H.FX_LIFE = { star: 700, miss: 1200, caught: 2000, swing: 260, far: 700 }; // 演出の長さ(ms)

  let bgCanvas = null;

  // 動かない背景は一度だけ描いておく
  function buildBackground() {
    const cv = document.createElement('canvas');
    cv.width = C.W; cv.height = C.H;
    const ctx = cv.getContext('2d');
    const rand = H.rng(7);
    const b = C.BOUNDS;

    ctx.fillStyle = '#8cc56b';
    ctx.fillRect(0, 0, C.W, C.H);
    ctx.strokeStyle = 'rgba(60,110,40,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 900; i++) {
      const x = rand() * C.W, y = rand() * C.H;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 4, y - 5 - rand() * 4); ctx.stroke();
    }

    // 石畳の広場
    const px = b.x0 - 14, py = b.y0 - 14, pw = b.x1 - b.x0 + 28, ph = b.y1 - b.y0 + 28;
    ctx.fillStyle = '#c9b99a';
    roundRect(ctx, px - 6, py - 6, pw + 12, ph + 12, 34); ctx.fill();
    ctx.fillStyle = '#ece3d1';
    roundRect(ctx, px, py, pw, ph, 28); ctx.fill();
    ctx.save();
    roundRect(ctx, px, py, pw, ph, 28); ctx.clip();
    ctx.strokeStyle = 'rgba(150,130,100,0.25)';
    ctx.lineWidth = 1.5;
    const T = 48;
    for (let y = py, row = 0; y < py + ph; y += T, row++) {
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke();
      for (let x = px + (row % 2 ? T / 2 : 0); x < px + pw; x += T) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + T); ctx.stroke();
      }
    }
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(120,100,70,${0.04 + rand() * 0.06})`;
      ctx.fillRect(px + rand() * pw, py + rand() * ph, T - 4, T - 4);
    }
    ctx.restore();

    // 上下の生け垣と花
    for (const [y0, y1] of [[18, 82], [C.H - 8, C.H + 40]]) {
      ctx.fillStyle = '#5f9e4a';
      roundRect(ctx, 30, y0, C.W - 60, y1 - y0, 26); ctx.fill();
      for (let i = 0; i < 70; i++) {
        const x = 50 + rand() * (C.W - 100), y = y0 + 8 + rand() * Math.max(8, Math.min(y1, C.H) - y0 - 16);
        ctx.fillStyle = ['#ff8fa3', '#ffd65a', '#ffffff', '#c59bff'][Math.floor(rand() * 4)];
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 噴水の土台
    for (const o of H.OBSTACLES) {
      if (o.kind !== 'fountain') continue;
      ctx.fillStyle = 'rgba(40,30,20,0.18)';
      ellipse(ctx, o.x, o.y + 8, o.r + 6, o.r * 0.9 + 6); ctx.fill();
      ctx.fillStyle = '#b8ab95';
      ellipse(ctx, o.x, o.y, o.r, o.r * 0.9); ctx.fill();
      ctx.fillStyle = '#d6cbb7';
      ellipse(ctx, o.x, o.y - 4, o.r - 4, o.r * 0.9 - 4); ctx.fill();
      ctx.fillStyle = '#5fb4e0';
      ellipse(ctx, o.x, o.y - 4, o.r - 14, o.r * 0.9 - 14); ctx.fill();
    }
    return cv;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  }

  function drawFountainWater(ctx, o, t) {
    ctx.save();
    ellipse(ctx, o.x, o.y - 4, o.r - 14, o.r * 0.9 - 14); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const k = ((t * 0.35 + i / 3) % 1);
      ellipse(ctx, o.x, o.y - 4, 12 + k * (o.r - 26), (12 + k * (o.r - 26)) * 0.9);
      ctx.globalAlpha = 1 - k; ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#c9bea9';
    ellipse(ctx, o.x, o.y - 6, 13, 11); ctx.fill();
    ctx.fillStyle = 'rgba(200,235,255,0.9)';
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + t * 0.6, k = (t * 1.3 + i * 0.37) % 1;
      const r = 6 + k * 26;
      ctx.beginPath();
      ctx.arc(o.x + Math.cos(a) * r, o.y - 26 + k * k * 22 + Math.sin(a) * r * 0.4 - Math.sin(k * Math.PI) * 18, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTree(ctx, o, t) {
    ctx.fillStyle = 'rgba(40,30,20,0.22)';
    ellipse(ctx, o.x + 6, o.y + 4, o.r + 12, (o.r + 12) * 0.45); ctx.fill();
    ctx.fillStyle = '#8a5a3a';
    roundRect(ctx, o.x - 7, o.y - 30, 14, 34, 5); ctx.fill();
    const sway = Math.sin(t * 0.8 + o.x) * 1.5;
    const cy = o.y - 52, R = o.r + 18;
    ctx.fillStyle = '#3f8a3c';
    ctx.beginPath(); ctx.arc(o.x + sway, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4fa24a';
    ctx.beginPath(); ctx.arc(o.x - 8 + sway, cy - 8, R * 0.72, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(o.x - 14 + sway, cy - 16, R * 0.35, 0, Math.PI * 2); ctx.fill();
  }

  // 人を1人描く。(x, y) は足もと
  function drawPerson(ctx, c, opts) {
    const x = c.x, y = c.y;
    const sitting = c.out === 'miss';
    const bob = c.moving ? Math.abs(Math.sin(c.walkPhase)) * 2.5 : 0;
    const fx = Math.cos(c.dir), fy = Math.sin(c.dir);
    const back = fy < -0.45;
    const reveal = opts.color;

    ctx.save();
    if (sitting) ctx.globalAlpha = 0.8;

    ctx.fillStyle = 'rgba(40,30,20,0.22)';
    ellipse(ctx, x, y, 12, 4.5); ctx.fill();

    const lift = sitting ? -7 : 0;
    if (!sitting) {
      const s = c.moving ? Math.sin(c.walkPhase) * 2.5 : 0;
      ctx.fillStyle = SHOE;
      ellipse(ctx, x - 4.5, y - 1.5 + s, 3.4, 2.4); ctx.fill();
      ellipse(ctx, x + 4.5, y - 1.5 - s, 3.4, 2.4); ctx.fill();
    }

    const bodyTop = y - 22 - bob - lift;
    ctx.fillStyle = reveal || BODY;
    roundRect(ctx, x - 10, bodyTop, 20, sitting ? 13 : 19, 8); ctx.fill();
    ctx.fillStyle = reveal ? 'rgba(0,0,0,0.18)' : BODY_DARK;
    const swing = c.moving ? Math.sin(c.walkPhase) * 2 : 0;
    ellipse(ctx, x - 10.5, bodyTop + 9 + swing, 3, 5); ctx.fill();
    ellipse(ctx, x + 10.5, bodyTop + 9 - swing, 3, 5); ctx.fill();

    const hx = x, hy = bodyTop - 9;
    ctx.fillStyle = HAIR;
    ctx.beginPath(); ctx.arc(hx, hy, 10.5, 0, Math.PI * 2); ctx.fill();
    if (!back) {
      ctx.fillStyle = SKIN;
      ctx.beginPath(); ctx.arc(hx + fx * 1.8, hy + 2.6, 8.8, 0, Math.PI * 2); ctx.fill();
      const ex = hx + fx * 3.6, ey = hy + 3 + (fy > 0.3 ? 1 : 0);
      const gap = 3.7 * (1 - Math.abs(fx) * 0.35);
      ctx.fillStyle = '#2a211c';
      if (sitting) {
        ctx.strokeStyle = '#2a211c'; ctx.lineWidth = 1.4;
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(ex + s * gap - 1.8, ey - 1.5); ctx.lineTo(ex + s * gap + 1.8, ey + 1.5);
          ctx.moveTo(ex + s * gap + 1.8, ey - 1.5); ctx.lineTo(ex + s * gap - 1.8, ey + 1.5); ctx.stroke();
        }
      } else if (opts.eyesClosed) {
        ctx.strokeStyle = '#2a211c'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(ex - gap - 2, ey); ctx.lineTo(ex - gap + 2, ey);
        ctx.moveTo(ex + gap - 2, ey); ctx.lineTo(ex + gap + 2, ey);
        ctx.stroke();
      } else {
        ellipse(ctx, ex - gap, ey, 1.5, 2); ctx.fill();
        ellipse(ctx, ex + gap, ey, 1.5, 2); ctx.fill();
      }
    }
    ctx.restore();

    if (sitting) {
      ctx.strokeStyle = 'rgba(90,90,110,0.8)'; ctx.lineWidth = 1.6;
      const t = opts.t;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const a = t * 4 + i * 0.6, r = 2 + i * 0.5;
        const px = hx + Math.cos(a) * r, py = hy - 17 + Math.sin(a) * r * 0.5;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }

    if (reveal && c.name) {
      ctx.font = '800 18px "M PLUS Rounded 1c", "Yu Gothic UI", sans-serif';
      const w = ctx.measureText(c.name).width + 16;
      ctx.fillStyle = reveal;
      roundRect(ctx, hx - w / 2, hy - 42, w, 26, 13); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 5, hy - 17); ctx.lineTo(hx + 5, hy - 17); ctx.lineTo(hx, hy - 11); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.name, hx, hy - 29);
    }
    if (opts.debug && H.isHider(c) && !c.out) {
      ctx.fillStyle = '#ff2d55';
      ctx.beginPath(); ctx.arc(hx, hy - 16, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawStar(ctx, s, t) {
    const pulse = 1 + Math.sin(t * 5 + s.x) * 0.08;
    const y = s.y - 6 + Math.sin(t * 3 + s.y) * 2;
    const g = ctx.createRadialGradient(s.x, y, 2, s.x, y, 34);
    g.addColorStop(0, 'rgba(255,230,120,0.75)');
    g.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s.x, y, 34, 0, Math.PI * 2); ctx.fill();
    starPath(ctx, s.x, y, 13 * pulse, 5.6 * pulse, t * 0.6);
    ctx.fillStyle = '#ffd23f'; ctx.fill();
    ctx.strokeStyle = '#e39a00'; ctx.lineWidth = 2; ctx.stroke();
  }

  function starPath(ctx, x, y, R, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot - Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // タップでとどく範囲と、前方攻撃の向き（地面に描く）
  function drawSeekerGround(ctx, s) {
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(230,50,50,0.35)';
    ctx.lineWidth = 2.5;
    const reach = s.reach || C.REACH, range = s.range || C.ATTACK_RANGE;
    ellipse(ctx, s.x, s.y, reach, reach * 0.92); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(230,50,50,0.12)';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.arc(s.x, s.y, range, s.dir - C.ATTACK_ARC, s.dir + C.ATTACK_ARC);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // 鬼のキャラ：赤い服、つの、少し大きい。自分さがしタイムは目をつぶっている
  function drawSeeker(ctx, s, mode, t) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(1.25, 1.25);
    ctx.translate(-s.x, -s.y);
    const fake = { x: s.x, y: s.y, dir: s.dir, moving: s.moving, walkPhase: s.walkPhase, out: null };
    drawPerson(ctx, fake, { t, color: '#e23c3c', eyesClosed: mode === 'hide' });
    const bob = s.moving ? Math.abs(Math.sin(s.walkPhase)) * 2.5 : 0;
    const hx = s.x, hy = s.y - 31 - bob;
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = '#b07a00'; ctx.lineWidth = 1;
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + k * 4, hy - 8);
      ctx.lineTo(hx + k * 9, hy - 18);
      ctx.lineTo(hx + k * 9.5, hy - 6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    if (s.cooldown > 0) {
      ctx.strokeStyle = 'rgba(226,60,60,0.8)'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 66, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.cooldown / C.CATCH_COOLDOWN));
      ctx.stroke();
    }
    if (mode === 'hide') {
      ctx.fillStyle = 'rgba(43,42,51,0.85)';
      ctx.font = '800 16px "M PLUS Rounded 1c", "Yu Gothic UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('…目をつぶっています', s.x, s.y - 66);
    }
  }

  function drawFx(ctx, fx, now) {
    for (const f of fx) {
      const k = (now - f.t0) / f.life;
      if (k < 0 || k > 1) continue;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      if (f.type === 'star') {
        ctx.fillStyle = '#ffd23f';
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * Math.PI * 2;
          starPath(ctx, f.x + Math.cos(a) * k * 60, f.y - 6 + Math.sin(a) * k * 60, 6, 2.6, a);
          ctx.fill();
        }
      } else if (f.type === 'caught') {
        ctx.strokeStyle = f.color; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(f.x, f.y - 16, 20 + k * 70, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = f.color;
        ctx.font = `900 ${42 + Math.sin(Math.min(1, k * 4) * Math.PI) * 14}px "Yu Gothic UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('！', f.x, f.y - 60 - k * 20);
        if (f.name) {
          // だれが見つかったか（このあとキャラはNPCにもどる）
          ctx.font = '800 20px "M PLUS Rounded 1c", "Yu Gothic UI", sans-serif';
          ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round';
          ctx.strokeText(f.name, f.x, f.y - 104 - k * 20);
          ctx.fillText(f.name, f.x, f.y - 104 - k * 20);
        }
      } else if (f.type === 'miss') {
        ctx.fillStyle = '#555';
        ctx.font = '900 26px "Yu Gothic UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ハズレ', f.x, f.y - 50 - k * 30);
      } else if (f.type === 'swing') {
        // 前方攻撃のひと振り
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 9 * (1 - k) + 2;
        ctx.lineCap = 'round';
        const a0 = f.dir - C.ATTACK_ARC, sweep = C.ATTACK_ARC * 2 * Math.min(1, k * 2.2);
        const rr = (f.range || C.ATTACK_RANGE) * 0.85;
        ctx.beginPath(); ctx.arc(f.x, f.y - 14, rr, a0, a0 + sweep); ctx.stroke();
        ctx.strokeStyle = 'rgba(226,60,60,0.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.x, f.y - 14, rr, a0, a0 + sweep); ctx.stroke();
      } else if (f.type === 'far') {
        ctx.fillStyle = '#7a7480';
        ctx.font = '800 18px "M PLUS Rounded 1c", "Yu Gothic UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('とどかない', f.x, f.y - 46 - k * 16);
      }
      ctx.restore();
    }
  }

  // view: {scale, ox, oy}; opts: {t, fx, now, seekerMode: null|'hide'|'play'|'end', reveal, colorOf(pid), debug}
  H.draw = function (ctx, g, view, opts) {
    if (!bgCanvas) bgCanvas = buildBackground();
    const t = opts.t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#4d7a3d';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    ctx.drawImage(bgCanvas, 0, 0);

    for (const o of H.OBSTACLES) if (o.kind === 'fountain') drawFountainWater(ctx, o, t);

    const mode = opts.seekerMode;
    if (mode === 'play') drawSeekerGround(ctx, g.seeker);

    const items = [];
    for (const c of g.chars) items.push({ y: c.y, c });
    for (const o of H.OBSTACLES) if (o.kind === 'tree') items.push({ y: o.y, o });
    if (mode) items.push({ y: g.seeker.y, s: g.seeker });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.o) { drawTree(ctx, it.o, t); continue; }
      if (it.s) { drawSeeker(ctx, it.s, mode, t); continue; }
      const c = it.c;
      const showColor = H.isHider(c) && (c.out === 'caught' || opts.reveal);
      drawPerson(ctx, c, { t, debug: opts.debug, color: showColor ? opts.colorOf(c.owner || c.pid) : null });
    }

    for (const s of g.stars) drawStar(ctx, s, t);
    if (opts.fx) drawFx(ctx, opts.fx, opts.now);
  };

  // 画面の大きさに合わせて 16:9 の広場を中央に置く
  H.fitView = function (cw, ch) {
    const scale = Math.min(cw / C.W, ch / C.H);
    return { scale, ox: (cw - C.W * scale) / 2, oy: (ch - C.H * scale) / 2 };
  };
})(typeof window !== 'undefined' ? window : globalThis);
