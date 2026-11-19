/* 楓葉飄落：前景 canvas，右上 → 左下，像真葉子一樣左右擺盪、翻面；滑鼠／手指掃過會把葉子撥開。
   用法：MapleLeaves(圖片網址)。圖片是一片楓葉的小圖（約 28×30）。 */
(function () {
  'use strict';
  window.MapleLeaves = function (src) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
    document.body.appendChild(cv);
    var g = cv.getContext('2d');
    var W = 0, H = 0, DPR = 1, leaves = [], sprite = null, back = null, SW = 28, SH = 30;

    // 先用最近鄰放大 3 倍，旋轉時邊緣比較不糊
    var img = new Image();
    img.onload = function () {
      SW = img.width; SH = img.height;
      sprite = document.createElement('canvas');
      sprite.width = SW * 3; sprite.height = SH * 3;
      var s = sprite.getContext('2d');
      s.imageSmoothingEnabled = false;
      s.drawImage(img, 0, 0, SW * 3, SH * 3);
      back = document.createElement('canvas');           // 背面：稍暗一點
      back.width = sprite.width; back.height = sprite.height;
      var b = back.getContext('2d');
      b.drawImage(sprite, 0, 0);
      b.globalCompositeOperation = 'source-atop';
      b.fillStyle = 'rgba(40,10,0,.22)';
      b.fillRect(0, 0, back.width, back.height);
      resize(); seed(); last = performance.now(); requestAnimationFrame(tick);
    };
    img.src = src;

    function rnd(a, b) { return a + Math.random() * (b - a); }

    function make(atEdge) {
      var L = {
        s: rnd(0.85, 1.15),          // 大小
        fall: rnd(42, 70),           // 終端下落速度 px/s
        amp: rnd(35, 70),            // 左右擺盪幅度 px/s
        ph: rnd(0, 6.283), fq: rnd(1.1, 2.0),      // 擺盪相位、頻率
        fl: rnd(0, 6.283), fls: rnd(1.5, 3.5),     // 翻面相位、速度
        rot: rnd(-0.6, 0.6), spin: rnd(-0.6, 0.6), // 旋轉、自轉速度
        vx: 0, vy: 0
      };
      if (atEdge) {
        // 從上緣（偏右）或右緣進場，依兩邊長度分配
        var top = W * 0.75, right = H * 0.7;
        if (Math.random() < top / (top + right)) { L.x = rnd(W * 0.25, W + 40); L.y = -40; }
        else { L.x = W + 40; L.y = rnd(-40, H * 0.7); }
      } else { L.x = rnd(0, W); L.y = rnd(0, H); }   // 第一格畫面就鋪滿
      L.vx = -wind(); L.vy = L.fall;
      return L;
    }

    function count() { return Math.max(8, Math.min(26, Math.round(W * H / 60000))); }
    function seed() { leaves = []; for (var i = 0; i < count(); i++) leaves.push(make(false)); }

    function resize() {
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = innerWidth; H = innerHeight;
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      var n = count();
      while (leaves.length < n) leaves.push(make(true));
      if (leaves.length > n) leaves.length = n;
    }
    addEventListener('resize', resize);

    // 風：基本往左吹，偶爾一陣陣變強
    var T = 0;
    function wind() { return 38 + 18 * Math.sin(T * 0.23) + 10 * Math.sin(T * 0.71 + 1.3); }

    // 滑鼠／手指：位置與速度（平滑過）
    var P = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0, on: false };
    function move(e) {
      var now = performance.now(), dt = Math.max(8, now - P.t) / 1000;
      if (P.on) {
        P.vx = P.vx * 0.5 + 0.5 * (e.clientX - P.x) / dt;
        P.vy = P.vy * 0.5 + 0.5 * (e.clientY - P.y) / dt;
      }
      P.x = e.clientX; P.y = e.clientY; P.t = now; P.on = true;
    }
    addEventListener('pointermove', move, { passive: true });
    addEventListener('pointerdown', move, { passive: true });
    document.addEventListener('pointerleave', function () { P.on = false; P.x = P.y = -1e4; });

    var last = 0, R = 90;
    function tick(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt;
      // 手停下來，速度慢慢歸零
      P.vx *= Math.exp(-dt * 8); P.vy *= Math.exp(-dt * 8);
      var w = wind(), k = 1 - Math.exp(-dt * 1.3);
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, W, H);
      g.imageSmoothingEnabled = true;
      for (var i = 0; i < leaves.length; i++) {
        var L = leaves[i];
        L.ph += L.fq * dt; L.fl += L.fls * dt;
        var sw = Math.cos(L.ph);
        // 想要的速度：被風往左帶＋左右擺；擺到兩端時下落變慢（像鐘擺滑翔）
        var tx = -w + L.amp * sw;
        var ty = L.fall * (0.45 + 0.75 * Math.abs(Math.sin(L.ph)));
        L.vx += (tx - L.vx) * k; L.vy += (ty - L.vy) * k;

        // 被滑鼠碰到：順著手的方向被帶走，再往外推開，還會轉起來
        var dx = L.x - P.x, dy = L.y - P.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < R) {
          var f = (1 - d / R); f *= f;
          var sp = Math.min(1600, Math.sqrt(P.vx * P.vx + P.vy * P.vy));
          var cap = sp > 0 ? Math.min(1, 1600 / sp) : 1;
          L.vx += (P.vx * cap - L.vx) * f * 0.35 + (dx / (d || 1)) * 240 * f * dt * 6;
          L.vy += (P.vy * cap - L.vy) * f * 0.35 + (dy / (d || 1)) * 240 * f * dt * 6;
          L.spin += (P.vx * dy - P.vy * dx) / (R * 400) * f;
          L.fls = Math.min(9, L.fls + sp * 0.004 * f);
        }
        L.spin += (-L.spin * 0.35 + 0.25 * Math.sin(L.ph * 0.5)) * dt;
        L.fls += (2.5 - L.fls) * dt * 0.3;
        L.rot += L.spin * dt;
        L.x += L.vx * dt; L.y += L.vy * dt;

        if (L.x < -60 || L.y > H + 60 || L.x > W + 140 || L.y < -200) { leaves[i] = make(true); continue; }

        var flip = Math.cos(L.fl);                 // 翻面：寬度縮放 −1～1
        g.save();
        g.translate(L.x, L.y);
        g.rotate(L.rot + 0.45 * sw);
        g.scale((Math.abs(flip) < 0.12 ? 0.12 * (flip < 0 ? -1 : 1) : flip) * L.s, L.s);
        g.globalAlpha = 0.92;
        g.drawImage(flip < 0 ? back : sprite, -SW / 2, -SH / 2, SW, SH);
        g.restore();
      }
      requestAnimationFrame(tick);
    }
  };
})();
