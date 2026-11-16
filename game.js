// Neon Breaker — smash all 40 bricks. Plain canvas JS, no assets.
// MAX GRAPHICS: DPR up to 3, bloom glow, ball trail, particles, floating score
// popups, screen shake, layered starfield/nebula background, auto quality
// scaling to hold 60fps on a phone (quality drops glow/particles first).
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = 640, H = 720;
  var DPR = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.scale(DPR, DPR);

  var scoreEl = document.getElementById('hud-score');
  var livesEl = document.getElementById('hud-lives');
  var bricksEl = document.getElementById('hud-bricks');
  var startBtn = document.getElementById('start-btn');
  var sensInput = document.getElementById('sens');
  var sensVal = document.getElementById('sens-val');

  var COLS = 8, ROWS = 5, TOTAL = COLS * ROWS;
  var ROW_COLORS = ['#ff5da2', '#ff9f1c', '#ffd166', '#39ff9c', '#4cc9f0'];
  var ROW_POINTS = [50, 40, 30, 20, 10];

  var state = 'title'; // title | serving | playing | paused | won | over
  var score = 0, lives = 3, best = 0;
  try { best = parseInt(localStorage.getItem('neon-breaker-best') || '0', 10) || 0; } catch (e) { best = 0; }
  var sens = 1;
  try { sens = parseFloat(localStorage.getItem('neon-breaker-sens') || '1') || 1; } catch (e) { sens = 1; }
  sens = Math.max(0.5, Math.min(2, sens));
  sensInput.value = String(sens);
  sensVal.textContent = sens.toFixed(1) + 'x';
  var muted = false;
  var keys = {};
  var bricks = [], bricksLeft = TOTAL, cleared = 0;
  var paddle = { x: W / 2 - 55, y: H - 60, w: 110, h: 16, speed: 520 };
  var ball = { x: W / 2, y: H - 80, r: 9, vx: 0, vy: 0, speed: 420 };
  var particles = [], popups = [], trail = [];
  var shake = 0, flash = 0, pulse = 0, last = 0;
  var dragging = false, dragX = 0;

  // --- Auto quality: 2 = full bloom, 1 = less glow, 0 = minimal (fast) ---
  var quality = 2, slowFrames = 0, fastFrames = 0, frameEma = 16;
  function glowBlur(n) { return quality === 2 ? n : quality === 1 ? n * 0.5 : 0; }
  function maxParticles() { return quality === 2 ? 260 : quality === 1 ? 140 : 60; }

  // --- Layered background: precomputed stars + nebula blobs ---
  var stars = [], nebulas = [];
  var i;
  for (i = 0; i < 90; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.4, tw: Math.random() * Math.PI * 2, sp: 0.5 + Math.random() * 1.5 });
  var nebColors = ['255,93,162', '76,201,240', '57,255,156', '255,209,102'];
  for (i = 0; i < 5; i++) nebulas.push({ x: Math.random() * W, y: Math.random() * H, r: 140 + Math.random() * 140, c: nebColors[i % nebColors.length], a: 0.05 + Math.random() * 0.05 });

  var audioCtx = null;
  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = vol || 0.06;
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* sound is optional */ }
  }

  function updateHud() {
    scoreEl.textContent = 'Score: ' + score;
    var hearts = '';
    for (var k = 0; k < 3; k++) hearts += k < lives ? '\u2665' : '\u2661';
    livesEl.textContent = 'Lives: ' + hearts;
    bricksEl.textContent = 'Bricks: ' + bricksLeft;
  }

  function buildBricks() {
    bricks = [];
    var gap = 8, margin = 24, bw = (W - margin * 2 - gap * (COLS - 1)) / COLS, bh = 26;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        bricks.push({ x: margin + c * (bw + gap), y: 70 + r * (bh + gap), w: bw, h: bh, color: ROW_COLORS[r], pts: ROW_POINTS[r], alive: true, flashT: 0 });
      }
    }
    bricksLeft = TOTAL; cleared = 0;
  }

  function resetBall() {
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - ball.r - 2;
    ball.vx = 0; ball.vy = 0;
    ball.speed = 420;
    trail = [];
  }

  function reset() {
    score = 0; lives = 3;
    particles = []; popups = []; trail = [];
    paddle.x = W / 2 - paddle.w / 2;
    buildBricks();
    resetBall();
    updateHud();
  }

  function startGame() {
    reset();
    state = 'serving';
    startBtn.textContent = 'Restart';
    beep(520, 0.12, 'square', 0.06);
  }

  function endGame(won) {
    state = won ? 'won' : 'over';
    if (score > best) {
      best = score;
      try { localStorage.setItem('neon-breaker-best', String(best)); } catch (e) {}
    }
    updateHud();
    if (won) {
      for (var k = 0; k < 80; k++) burst(W / 2 + (Math.random() - 0.5) * 300, H / 2, ['#ff5da2', '#ffd166', '#39ff9c', '#4cc9f0'][k % 4], 1);
      beep(660, 0.15, 'sine', 0.09); setTimeout(function () { beep(990, 0.25, 'sine', 0.09); }, 150);
    } else beep(140, 0.4, 'sawtooth', 0.08);
  }

  function launch() {
    if (state !== 'serving') return;
    var a = -Math.PI / 2 + (Math.random() - 0.5) * 0.7;
    ball.vx = Math.cos(a) * ball.speed;
    ball.vy = Math.sin(a) * ball.speed;
    state = 'playing';
    beep(440, 0.08, 'square', 0.05);
  }

  function loseLife() {
    lives -= 1;
    shake = 0.4; flash = 0.25;
    burst(ball.x, H - 20, '#ff6b6b', 22);
    beep(160, 0.3, 'sawtooth', 0.08);
    updateHud();
    if (lives <= 0) { endGame(false); return; }
    resetBall();
    state = 'serving';
  }

  function burst(x, y, color, n) {
    for (var k = 0; k < n; k++) {
      if (particles.length >= maxParticles()) return;
      var a = Math.random() * Math.PI * 2;
      var sp = 70 + Math.random() * 260;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.45 + Math.random() * 0.5, t: 0, color: color, r: 2 + Math.random() * 3.5 });
    }
  }

  function popup(x, y, text, color) {
    popups.push({ x: x, y: y, text: text, color: color, t: 0, life: 0.9 });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function update(dt) {
    // Paddle: keyboard (sensitivity-scaled) + drag.
    var mv = 0;
    if (keys.ArrowLeft || keys.a) mv -= 1;
    if (keys.ArrowRight || keys.d) mv += 1;
    if (mv) paddle.x += mv * paddle.speed * sens * dt;
    if (dragging) paddle.x = dragX - paddle.w / 2;
    paddle.x = Math.max(8, Math.min(W - paddle.w - 8, paddle.x));

    if (state === 'serving') {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - ball.r - 2;
      return;
    }
    if (state !== 'playing') return;

    var px = ball.x, py = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Trail.
    trail.push({ x: ball.x, y: ball.y, t: 0 });
    if (trail.length > (quality === 0 ? 6 : 14)) trail.shift();

    // Walls.
    if (ball.x - ball.r < 6) { ball.x = 6 + ball.r; ball.vx = Math.abs(ball.vx); beep(220, 0.05, 'square', 0.04); }
    if (ball.x + ball.r > W - 6) { ball.x = W - 6 - ball.r; ball.vx = -Math.abs(ball.vx); beep(220, 0.05, 'square', 0.04); }
    if (ball.y - ball.r < 6) { ball.y = 6 + ball.r; ball.vy = Math.abs(ball.vy); beep(220, 0.05, 'square', 0.04); }

    // Paddle bounce: angle depends on hit position for real control.
    if (ball.vy > 0 && ball.y + ball.r >= paddle.y && ball.y + ball.r <= paddle.y + paddle.h + 14 &&
        ball.x >= paddle.x - ball.r && ball.x <= paddle.x + paddle.w + ball.r) {
      var rel = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
      rel = Math.max(-1, Math.min(1, rel));
      var ang = -Math.PI / 2 + rel * 1.05;
      var sp = ball.speed;
      ball.vx = Math.cos(ang) * sp;
      ball.vy = Math.sin(ang) * sp;
      ball.y = paddle.y - ball.r - 1;
      beep(330, 0.06, 'square', 0.05);
      burst(ball.x, paddle.y, '#4cc9f0', 5);
    }

    // Bricks.
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w && ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
        // Resolve by previous position: hit from top/bottom vs side.
        if (py + ball.r <= b.y || py - ball.r >= b.y + b.h) ball.vy = -ball.vy;
        else ball.vx = -ball.vx;
        b.alive = false; b.flashT = 0.2;
        bricksLeft -= 1; cleared += 1;
        score += b.pts;
        ball.speed = Math.min(600, 420 + cleared * 4);
        var cur = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) || 1;
        ball.vx = ball.vx / cur * ball.speed;
        ball.vy = ball.vy / cur * ball.speed;
        burst(ball.x, ball.y, b.color, 16);
        popup(b.x + b.w / 2, b.y, '+' + b.pts, b.color);
        flash = Math.max(flash, 0.06);
        beep(520 + (ROWS - 1) * 40, 0.07, 'sine', 0.06);
        updateHud();
        if (bricksLeft <= 0) { endGame(true); return; }
        break;
      }
    }

    // Fell past the paddle.
    if (ball.y - ball.r > H) loseLife();
  }

  function drawBackground() {
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0a0a2e');
    grad.addColorStop(0.55, '#120a33');
    grad.addColorStop(1, '#160a24');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Nebula blobs.
    for (var n = 0; n < nebulas.length; n++) {
      var nb = nebulas[n];
      var rg = ctx.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r);
      rg.addColorStop(0, 'rgba(' + nb.c + ',' + nb.a + ')');
      rg.addColorStop(1, 'rgba(' + nb.c + ',0)');
      ctx.fillStyle = rg;
      ctx.fillRect(nb.x - nb.r, nb.y - nb.r, nb.r * 2, nb.r * 2);
    }
    // Twinkling stars.
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(pulse * st.sp + st.tw));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    // Faint grid.
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (var gx = 40; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 40; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    // Border glow.
    ctx.strokeStyle = 'rgba(255,93,162,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, W - 8, H - 8);
  }

  function draw() {
    pulse += 0.016;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 9 * shake * 2, (Math.random() - 0.5) * 9 * shake * 2);
    drawBackground();

    if (state === 'title') {
      ctx.textAlign = 'center';
      ctx.save();
      ctx.shadowColor = '#ff5da2'; ctx.shadowBlur = glowBlur(26);
      ctx.fillStyle = '#ff5da2';
      ctx.font = 'bold 48px system-ui, sans-serif';
      ctx.fillText('NEON BREAKER', W / 2, 210 + Math.sin(pulse * 1.5) * 3);
      ctx.restore();
      ctx.fillStyle = '#eef2ff';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('Smash all 40 bricks. 3 lives. Don\'t drop the ball.', W / 2, 260);
      ctx.fillStyle = '#b9c4ff';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Arrows / A,D or drag to move the paddle', W / 2, 310);
      ctx.fillText('Space to launch  •  P pause  •  M mute', W / 2, 335);
      ctx.fillText('Paddle Sensitivity slider below the game', W / 2, 360);
      // Mini brick preview.
      for (var r = 0; r < 3; r++) for (var c = 0; c < 6; c++) {
        ctx.fillStyle = ROW_COLORS[r];
        roundRect(W / 2 - 150 + c * 52, 400 + r * 34, 46, 26, 6);
        ctx.fill();
      }
      ctx.fillStyle = '#ff5da2';
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.fillText(best > 0 ? 'Best score: ' + best : 'Tap Play or press Space', W / 2, 540);
      ctx.restore();
      return;
    }

    // Bricks.
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      var bg = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(0.25, b.color);
      bg.addColorStop(1, b.color);
      ctx.save();
      if (quality > 0) { ctx.shadowColor = b.color; ctx.shadowBlur = glowBlur(12); }
      ctx.fillStyle = bg;
      roundRect(b.x, b.y, b.w, b.h, 7);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(b.x + 4, b.y + 3, b.w - 8, 3);
    }

    // Ball trail.
    for (var t = 0; t < trail.length; t++) {
      var tp = trail[t];
      ctx.globalAlpha = (t / trail.length) * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, ball.r * (0.4 + 0.5 * t / trail.length), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Paddle.
    var pg = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.h);
    pg.addColorStop(0, '#ffffff');
    pg.addColorStop(0.3, '#ff5da2');
    pg.addColorStop(1, '#c2185b');
    ctx.save();
    if (quality > 0) { ctx.shadowColor = '#ff5da2'; ctx.shadowBlur = glowBlur(16); }
    ctx.fillStyle = pg;
    roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 8);
    ctx.fill();
    ctx.restore();

    // Ball with radial glow.
    var brg = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 1, ball.x, ball.y, ball.r * 2.2);
    brg.addColorStop(0, '#ffffff');
    brg.addColorStop(0.4, '#ffe9f4');
    brg.addColorStop(1, 'rgba(255,93,162,0)');
    ctx.fillStyle = brg;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r * 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    if (quality > 0) { ctx.shadowColor = '#ffffff'; ctx.shadowBlur = glowBlur(18); }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Particles.
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating score popups.
    ctx.textAlign = 'center';
    for (var u = 0; u < popups.length; u++) {
      var pp = popups[u];
      ctx.globalAlpha = Math.max(0, 1 - pp.t / pp.life);
      ctx.fillStyle = pp.color;
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillText(pp.text, pp.x, pp.y - pp.t * 46);
    }
    ctx.globalAlpha = 1;

    if (state === 'serving') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText('Press Space or tap to launch', W / 2, H - 110);
    }
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.9) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'paused' || state === 'won' || state === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      if (state === 'paused') {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px system-ui, sans-serif';
        ctx.fillText('PAUSED', W / 2, 340);
        ctx.fillStyle = '#b9c4ff';
        ctx.font = '17px system-ui, sans-serif';
        ctx.fillText('Press P to keep breaking', W / 2, 380);
      } else if (state === 'won') {
        ctx.save();
        ctx.shadowColor = '#ffd166'; ctx.shadowBlur = glowBlur(24);
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 44px system-ui, sans-serif';
        ctx.fillText('YOU WIN!', W / 2, 320);
        ctx.restore();
        ctx.fillStyle = '#ffffff';
        ctx.font = '19px system-ui, sans-serif';
        ctx.fillText('All 40 bricks smashed!', W / 2, 365);
        ctx.fillStyle = '#b9c4ff';
        ctx.font = '17px system-ui, sans-serif';
        ctx.fillText('Score: ' + score + '   •   Best: ' + best, W / 2, 400);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Press Enter or tap Play to go again', W / 2, 435);
      } else {
        ctx.fillStyle = '#ff6b6b';
        ctx.font = 'bold 42px system-ui, sans-serif';
        ctx.fillText('GAME OVER', W / 2, 320);
        ctx.fillStyle = '#ffffff';
        ctx.font = '19px system-ui, sans-serif';
        ctx.fillText('Score: ' + score + '   •   Best: ' + best, W / 2, 365);
        ctx.fillStyle = '#ffffff';
        ctx.font = '17px system-ui, sans-serif';
        ctx.fillText('Press Enter or tap Play to try again', W / 2, 400);
      }
    }
    ctx.restore();
  }

  function loop(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    frameEma = frameEma * 0.95 + dt * 1000 * 0.05;
    if (frameEma > 20) { slowFrames++; fastFrames = 0; } else if (frameEma < 13) { fastFrames++; slowFrames = 0; } else { slowFrames = 0; fastFrames = 0; }
    if (slowFrames > 90 && quality > 0) { quality--; slowFrames = 0; }
    if (fastFrames > 600 && quality < 2) { quality++; fastFrames = 0; }
    if (shake > 0) shake -= dt;
    if (flash > 0) flash -= dt * 2;
    if (state === 'playing' || state === 'serving') update(dt);
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
      if (p.t >= p.life) particles.splice(i, 1);
    }
    for (var j = popups.length - 1; j >= 0; j--) {
      popups[j].t += dt;
      if (popups[j].t >= popups[j].life) popups.splice(j, 1);
    }
    for (var k = 0; k < trail.length; k++) trail[k].t += dt;
    draw();
    requestAnimationFrame(loop);
  }

  function toGameX(clientX) {
    var rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (W / rect.width);
  }

  window.addEventListener('keydown', function (e) {
    keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (state === 'title' || state === 'won' || state === 'over') startGame();
      else if (state === 'serving') launch();
    }
    if ((e.key === 'p' || e.key === 'P') && (state === 'playing' || state === 'serving' || state === 'paused')) {
      state = state === 'paused' ? (ball.vx || ball.vy ? 'playing' : 'serving') : 'paused';
    }
    if (e.key === 'm' || e.key === 'M') muted = !muted;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.key) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) {
    keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false;
  });

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    dragging = true;
    dragX = toGameX(e.clientX);
    if (state === 'title' || state === 'won' || state === 'over') startGame();
    else if (state === 'serving') launch();
  });
  window.addEventListener('pointermove', function (e) {
    if (dragging) dragX = toGameX(e.clientX);
  });
  window.addEventListener('pointerup', function () { dragging = false; });

  sensInput.addEventListener('input', function () {
    sens = parseFloat(sensInput.value) || 1;
    sensVal.textContent = sens.toFixed(1) + 'x';
    try { localStorage.setItem('neon-breaker-sens', String(sens)); } catch (e) {}
  });

  startBtn.addEventListener('click', function () { startGame(); });

  reset();
  state = 'title';
  updateHud();
  requestAnimationFrame(loop);
})();
