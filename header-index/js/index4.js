/* =====================================================================
   PEC HACKS 4.0 — Cinematic background (index4.js)
   Responsive rewrite:
     • Desktop  -> full cyberpunk skyline (drones, metro, holograms, AI cursor)
     • Mobile   -> calm, minimal scene (light skyline, fewer particles, no clutter)
     • Touch    -> native cursor kept, custom AI cursor disabled
     • Respects prefers-reduced-motion + pauses when tab is hidden
   Drop-in replacement — no HTML changes required.
   ===================================================================== */
(function () {
  'use strict';

  /* ----------------------------------------------------------------- *
   *  Environment detection
   * ----------------------------------------------------------------- */
  const mqCoarse  = window.matchMedia('(hover: none), (pointer: coarse)');
  const mqReduce  = window.matchMedia('(prefers-reduced-motion: reduce)');
  const isTouch   = mqCoarse.matches;
  let   reduceMotion = mqReduce.matches;

  const MOBILE_BREAKPOINT = 768;
  function isMobileView() { return window.innerWidth < MOBILE_BREAKPOINT; }

  const PALETTE = {
    cyan: 'rgba(0, 243, 255, 1)',
    cyanDim: 'rgba(0, 243, 255, 0.22)',
    gold: 'rgba(255, 179, 0, 1)',
    goldDim: 'rgba(255, 179, 0, 0.22)',
    blue: 'rgba(0, 89, 255, 1)',
    blueDim: 'rgba(0, 89, 255, 0.22)',
    white: 'rgba(255, 255, 255, 1)',
    whiteDim: 'rgba(255, 255, 255, 0.22)',
  };

  /* Responsive config — recomputed on every resize / orientation change */
  function buildConfig() {
    const mobile = isMobileView();
    return {
      mobile,
      dprCap:        mobile ? 1.5 : 2,     // cap pixel ratio -> biggest perf win
      rainCount:     mobile ? 34  : 130,
      droneCount:    mobile ? 4   : 18,
      particleCount: mobile ? 14  : 50,
      fogCount:      mobile ? 2   : 6,
      farCount:      mobile ? 4   : 6,
      midCount:      mobile ? 4   : 8,
      showHolograms:  !mobile,             // holograms overlap hero text on phones
      showMetro:      !mobile,
      showSkyRoads:   !mobile,
      showDroneBeams: !mobile,
      showAICursor:   !isTouch,            // touch devices keep native behaviour
      colors: PALETTE,
    };
  }

  let config = buildConfig();

  /* ----------------------------------------------------------------- *
   *  State
   * ----------------------------------------------------------------- */
  let canvas, ctx;
  let cursorCanvas, cursorCtx;
  let mouse  = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 };
  let cursor = { x: innerWidth / 2, y: innerHeight / 2, vx: 0, vy: 0 };
  let isHovered = false, wasHovered = false, hoverProgress = 0, activeElement = null;

  let rain = [], drones = [], particles = [], fog = [], holograms = [], skyline = [];
  let metro, skyRoadCars = [], clicks = [], sparkParticles = [], cursorTrail = [];

  let scrollY = 0, currentScrollY = 0;
  let camOffset = { x: 0, y: 0 }, targetCamOffset = { x: 0, y: 0 };
  let interactiveRects = [], lastInteractiveUpdate = 0;

  let rafId = null, running = false;

  /* ----------------------------------------------------------------- *
   *  Init
   * ----------------------------------------------------------------- */
  function initSplashCursor() {
    canvas = document.getElementById('splash-cursor');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    if (config.showAICursor) {
      // Hide the default DOM follower and disable native cursor on desktop only
      const defaultFollower = document.getElementById('cursor-follower');
      if (defaultFollower) defaultFollower.style.display = 'none';

      const style = document.createElement('style');
      style.innerHTML = `
        body, html, a, button, [role="button"], #theme-toggle-btn, .nav-link, .nav-social {
          cursor: none !important;
        }`;
      document.head.appendChild(style);

      cursorCanvas = document.createElement('canvas');
      cursorCanvas.id = 'ai-cursor-canvas';
      Object.assign(cursorCanvas.style, {
        position: 'fixed', top: '0', left: '0',
        width: '100vw', height: '100vh',
        zIndex: '99999', pointerEvents: 'none',
      });
      document.body.appendChild(cursorCanvas);
      cursorCtx = cursorCanvas.getContext('2d');

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mousedown', handleMouseDown);
    } else {
      // Touch / no-hover: park the cursor off-screen so nothing clusters at centre
      cursor.x = cursor.y = mouse.tx = mouse.ty = -9999;
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', handleScroll, { passive: true });

    if (mqReduce.addEventListener) {
      mqReduce.addEventListener('change', e => { reduceMotion = e.matches; restart(); });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopLoop();
      else startLoop();
    });

    buildEnvironment();
    updateInteractiveElements();
    startLoop();
  }

  /* ----------------------------------------------------------------- *
   *  Loop control (with reduced-motion + tab-hidden handling)
   * ----------------------------------------------------------------- */
  function startLoop() {
    if (running) return;
    if (reduceMotion) { renderFrame(performance.now() * 0.001); return; } // one static frame
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }
  function restart() { stopLoop(); startLoop(); }

  function loop(timestamp) {
    if (!running) return;
    renderFrame(timestamp * 0.001);
    rafId = requestAnimationFrame(loop);
  }

  function renderFrame(time) {
    updateCamera();
    if (config.showAICursor) updateCursorPhysics();

    ctx.clearRect(0, 0, innerWidth, innerHeight);

    drawSky();
    drawSkyClouds(time);
    drawSkylineFar(time);
    drawSkylineMid(time);
    if (config.showMetro || config.showSkyRoads) drawSkyRoadsAndMetro(time);
    if (config.showHolograms) drawHolograms(time);
    drawDrones(time);
    drawVolumetricFog(time);
    drawForeground(time);
    drawRainAndParticles();
    drawTextAreaProtection();

    if (config.showAICursor && cursorCtx) drawAICursor(time);
  }

  /* ----------------------------------------------------------------- *
   *  Resize
   * ----------------------------------------------------------------- */
  function resize() {
    config = buildConfig();
    const dpr = Math.min(window.devicePixelRatio || 1, config.dprCap);

    canvas.width  = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (cursorCanvas) {
      cursorCanvas.width  = innerWidth * dpr;
      cursorCanvas.height = innerHeight * dpr;
      cursorCtx.setTransform(1, 0, 0, 1, 0, 0);
      cursorCtx.scale(dpr, dpr);
    }

    buildEnvironment();
    updateInteractiveElements();
    if (reduceMotion) renderFrame(performance.now() * 0.001);
  }

  /* ----------------------------------------------------------------- *
   *  Input
   * ----------------------------------------------------------------- */
  function handleScroll() {
    scrollY = window.scrollY;
    updateInteractiveElements();
  }
  function handleMouseMove(e) {
    mouse.tx = e.clientX;
    mouse.ty = e.clientY;
    const now = Date.now();
    if (now - lastInteractiveUpdate > 500) {
      updateInteractiveElements();
      lastInteractiveUpdate = now;
    }
  }
  function handleMouseDown() {
    clicks.push({ x: cursor.x, y: cursor.y, radius: 6, alpha: 1.0 });
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 5.0;
      sparkParticles.push({
        x: cursor.x, y: cursor.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size: 1.0 + Math.random() * 2.0, life: 1.0,
      });
    }
  }

  function updateInteractiveElements() {
    interactiveRects = [];
    if (!config.showAICursor) return; // magnetic cursor only exists on desktop
    const els = document.querySelectorAll(
      'a, button, .cta-wrap, [role="button"], #theme-toggle-btn, .nav-link, .nav-social'
    );
    els.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        interactiveRects.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height });
      }
    });
  }

  /* ----------------------------------------------------------------- *
   *  Build environment (counts now come from config)
   * ----------------------------------------------------------------- */
  function buildEnvironment() {
    const width = innerWidth, height = innerHeight;

    // ---- Skyline ----
    skyline = [];
    const farCount = config.farCount;
    for (let i = 0; i < farCount; i++) {
      const isLighthouse = (i === 1);
      const isFloatingHQ = (i === Math.min(4, farCount - 1)) && !config.mobile;
      skyline.push({
        layer: 'far',
        x: (width / Math.max(1, farCount - 1)) * i + (Math.random() * 50 - 25),
        w: isLighthouse ? 24 : 70 + Math.random() * 40,
        h: isLighthouse ? height * 0.44 : height * (0.35 + Math.random() * 0.2),
        isLighthouse, isFloatingHQ,
        hqFloatOffset: 0,
        lightAngle: Math.random() * Math.PI,
        windowSeed: Math.random(),
        neuralNetPoints: generateNeuralNetPoints(config.mobile ? 3 : 5),
      });
    }

    const midCount = config.midCount;
    for (let i = 0; i < midCount; i++) {
      const isAIResearchTower = !config.mobile && (i === 2 || i === 5);
      skyline.push({
        layer: 'mid',
        x: (width / Math.max(1, midCount - 1)) * i + (Math.random() * 60 - 30),
        w: 90 + Math.random() * 60,
        h: height * (0.42 + Math.random() * 0.28),
        isAIResearchTower,
        windowSeed: Math.random(),
        neuralNetPoints: isAIResearchTower ? generateNeuralNetPoints(6) : null,
      });
    }

    // ---- Drones ----
    drones = [];
    for (let i = 0; i < config.droneCount; i++) {
      drones.push({
        x: Math.random() * width, y: Math.random() * (height * 0.65),
        size: 4 + Math.random() * 4, speed: 0.6 + Math.random() * 1.4,
        direction: Math.random() > 0.5 ? 1 : -1,
        heightOffset: Math.random() * 60, pulsePhase: Math.random() * Math.PI,
        hasBeam: config.showDroneBeams && Math.random() > 0.75,
        beamAngle: Math.PI / 2 + (Math.random() * 0.15 - 0.075),
      });
    }

    // ---- Rain ----
    rain = [];
    for (let i = 0; i < config.rainCount; i++) {
      rain.push({
        x: Math.random() * width, y: Math.random() * height,
        len: 12 + Math.random() * 15, yspeed: 10 + Math.random() * 5,
        xspeed: -1.5 - Math.random() * 1.5, opacity: 0.12 + Math.random() * 0.15,
      });
    }

    // ---- Particles ----
    particles = [];
    for (let i = 0; i < config.particleCount; i++) {
      particles.push({
        x: Math.random() * width, y: Math.random() * height,
        r: 1.0 + Math.random() * 1.5,
        speedX: Math.random() * 0.3 - 0.15, speedY: -0.15 - Math.random() * 0.45,
        life: Math.random(),
        color: Math.random() > 0.3 ? config.colors.cyan : config.colors.gold,
      });
    }

    // ---- Fog ----
    fog = [];
    for (let i = 0; i < config.fogCount; i++) {
      fog.push({
        x: Math.random() * width, y: height * (0.65 + Math.random() * 0.25),
        r: 160 + Math.random() * 140, vx: 0.08 + Math.random() * 0.2,
        vy: (Math.random() * 0.06 - 0.03),
      });
    }

    // ---- Holograms (desktop only) ----
    holograms = [];
    if (config.showHolograms) {
      const holoTexts = ['AI', 'INNOVATION', 'FUTURE MOBILITY', 'HACKATHON', 'ROBOTICS', 'MACHINE LEARNING'];
      for (let i = 0; i < holoTexts.length; i++) {
        holograms.push({
          text: holoTexts[i],
          x: width * (0.16 + (i * 0.13)) + (Math.random() * 40 - 20),
          y: height * (0.33 + Math.random() * 0.22),
          scale: 0.85 + Math.random() * 0.3,
          opacity: 0.35 + Math.random() * 0.15,
          skewX: 0, skewY: 0, glitchTime: 0,
        });
      }
    }

    // ---- Metro ----
    metro = { y: height * 0.63, trainX: -250, speed: 3.5, width: 140, active: true, cooldown: 0 };

    // ---- Sky Road cars (desktop only) ----
    skyRoadCars = [];
    if (config.showSkyRoads) {
      for (let i = 0; i < 9; i++) {
        skyRoadCars.push({
          x: Math.random() * width, direction: Math.random() > 0.5 ? 1 : -1,
          speed: 1.2 + Math.random() * 1.5, lane: Math.floor(Math.random() * 2),
          color: Math.random() > 0.35 ? config.colors.cyan : config.colors.gold,
        });
      }
    }
  }

  function generateNeuralNetPoints(count) {
    const pts = [];
    for (let i = 0; i < count; i++) pts.push({ x: Math.random(), y: Math.random(), connections: [] });
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++)
        if (Math.random() > 0.45) pts[i].connections.push(j);
    return pts;
  }

  /* ----------------------------------------------------------------- *
   *  Draw: Sky
   * ----------------------------------------------------------------- */
  function drawSky() {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    if (isDark) {
      grad.addColorStop(0, '#020207');
      grad.addColorStop(0.35, '#080a22');
      grad.addColorStop(0.68, '#181235');
      grad.addColorStop(0.88, '#321c22');
      grad.addColorStop(1, '#56351d');
    } else {
      grad.addColorStop(0, '#bae6fd');
      grad.addColorStop(0.4, '#cbd5e1');
      grad.addColorStop(0.7, '#fed7aa');
      grad.addColorStop(0.9, '#ffedd5');
      grad.addColorStop(1, '#ffedd5');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    const sunY = height * 0.72;
    const sunGrad = ctx.createRadialGradient(width * 0.5, sunY, 10, width * 0.5, sunY, 130);
    if (isDark) {
      sunGrad.addColorStop(0, 'rgba(255, 140, 0, 0.38)');
      sunGrad.addColorStop(0.5, 'rgba(255, 80, 0, 0.14)');
      sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
      sunGrad.addColorStop(0, 'rgba(255, 235, 180, 0.75)');
      sunGrad.addColorStop(0.5, 'rgba(255, 200, 100, 0.28)');
      sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(width * 0.5, sunY, 130, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSkyClouds(time) {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');
    for (let i = 0; i < 3; i++) {
      const cx = (width * 0.32 * i + time * 4) % (width + 400) - 200;
      const cy = height * (0.18 + i * 0.07);
      const cr = 120 + i * 40;
      const cloudGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      if (isDark) {
        cloudGrad.addColorStop(0, 'rgba(90, 110, 190, 0.035)');
        cloudGrad.addColorStop(0.5, 'rgba(50, 60, 100, 0.015)');
        cloudGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else {
        cloudGrad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
        cloudGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
        cloudGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      }
      ctx.fillStyle = cloudGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ----------------------------------------------------------------- *
   *  Draw: Skyline (far)
   * ----------------------------------------------------------------- */
  function drawSkylineFar(time) {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');
    const py = currentScrollY * 0.12;

    skyline.forEach(b => {
      if (b.layer !== 'far') return;
      const bx = b.x + camOffset.x * 0.12;
      const by = height - b.h + py + camOffset.y * 0.12;

      if (b.isLighthouse) {
        if (isDark) { ctx.fillStyle = 'rgba(15, 22, 38, 0.94)'; ctx.strokeStyle = 'rgba(0, 243, 255, 0.18)'; }
        else        { ctx.fillStyle = 'rgba(219, 223, 235, 0.94)'; ctx.strokeStyle = 'rgba(0, 89, 255, 0.2)'; }
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(bx - 14, height + py);
        ctx.lineTo(bx - 7, by + 45); ctx.lineTo(bx - 11, by + 45);
        ctx.lineTo(bx - 7, by); ctx.lineTo(bx + 7, by);
        ctx.lineTo(bx + 11, by + 45); ctx.lineTo(bx + 7, by + 45);
        ctx.lineTo(bx + 14, height + py);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = isDark ? '#080c18' : '#e2e8f0';
        ctx.fillRect(bx - 9, by - 12, 18, 12);
        ctx.strokeStyle = isDark ? config.colors.cyan : config.colors.blue;
        ctx.strokeRect(bx - 9, by - 12, 18, 12);

        const glowGrad = ctx.createRadialGradient(bx, by - 6, 2, bx, by - 6, 16);
        glowGrad.addColorStop(0, '#ffffff');
        glowGrad.addColorStop(0.3, isDark ? config.colors.cyan : config.colors.blue);
        glowGrad.addColorStop(1, 'rgba(0, 243, 255, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath(); ctx.arc(bx, by - 6, 16, 0, Math.PI * 2); ctx.fill();

        b.lightAngle += 0.004;
        const beamAngle = Math.sin(b.lightAngle) * 0.38 + 0.05;
        ctx.save();
        ctx.translate(bx, by - 6); ctx.rotate(beamAngle);
        const beamLength = width * 0.58;
        const beamGrad = ctx.createLinearGradient(0, 0, beamLength, 0);
        if (isDark) {
          beamGrad.addColorStop(0, 'rgba(0, 243, 255, 0.35)');
          beamGrad.addColorStop(0.3, 'rgba(0, 243, 255, 0.12)');
          beamGrad.addColorStop(1, 'rgba(0, 243, 255, 0)');
        } else {
          beamGrad.addColorStop(0, 'rgba(0, 89, 255, 0.25)');
          beamGrad.addColorStop(0.3, 'rgba(0, 89, 255, 0.08)');
          beamGrad.addColorStop(1, 'rgba(0, 89, 255, 0)');
        }
        ctx.fillStyle = beamGrad;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(beamLength, -38); ctx.lineTo(beamLength, 38); ctx.closePath(); ctx.fill();
        ctx.restore();
        return;
      }

      if (b.isFloatingHQ) {
        b.hqFloatOffset = Math.sin(time * 0.7 + b.windowSeed * 8) * 7;
        const fby = by - 35 + b.hqFloatOffset;
        const hqGrad = ctx.createLinearGradient(bx, fby, bx, fby + b.h * 0.55);
        if (isDark) { hqGrad.addColorStop(0, 'rgba(28, 38, 57, 0.92)'); hqGrad.addColorStop(1, 'rgba(12, 17, 30, 0.96)'); }
        else        { hqGrad.addColorStop(0, 'rgba(241, 245, 249, 0.94)'); hqGrad.addColorStop(1, 'rgba(203, 213, 225, 0.96)'); }
        ctx.fillStyle = hqGrad;
        ctx.beginPath();
        ctx.moveTo(bx - b.w * 0.5, fby + b.h * 0.08);
        ctx.lineTo(bx - b.w * 0.3, fby); ctx.lineTo(bx + b.w * 0.3, fby);
        ctx.lineTo(bx + b.w * 0.5, fby + b.h * 0.08);
        ctx.lineTo(bx + b.w * 0.38, fby + b.h * 0.52);
        ctx.lineTo(bx - b.w * 0.38, fby + b.h * 0.52);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = isDark ? config.colors.cyanDim : 'rgba(0, 89, 255, 0.15)';
        ctx.lineWidth = 0.8; ctx.stroke();

        if (isDark) {
          const thrustGrad = ctx.createRadialGradient(bx, fby + b.h * 0.52, 2, bx, fby + b.h * 0.52, 18);
          thrustGrad.addColorStop(0, 'rgba(0, 243, 255, 0.7)');
          thrustGrad.addColorStop(0.5, 'rgba(0, 243, 255, 0.18)');
          thrustGrad.addColorStop(1, 'rgba(0, 243, 255, 0)');
          ctx.fillStyle = thrustGrad;
          ctx.beginPath(); ctx.arc(bx, fby + b.h * 0.52, 18, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = isDark ? 'rgba(34, 197, 94, 0.65)' : 'rgba(22, 163, 74, 0.5)';
        for (let k = 0; k < 10; k++) {
          const gx = bx + (Math.sin(k * 11 + b.windowSeed) * b.w * 0.28);
          const gy = fby + 12 + k * 7;
          ctx.beginPath(); ctx.arc(gx, gy, 1.2, 0, Math.PI * 2); ctx.fill();
        }
        return;
      }

      // Regular far building
      const bGrad = ctx.createLinearGradient(bx, by, bx, height + py);
      if (isDark) { bGrad.addColorStop(0, 'rgba(18, 22, 40, 0.93)'); bGrad.addColorStop(1, 'rgba(8, 10, 20, 0.97)'); }
      else        { bGrad.addColorStop(0, 'rgba(226, 232, 240, 0.94)'); bGrad.addColorStop(1, 'rgba(203, 213, 225, 0.96)'); }
      ctx.fillStyle = bGrad;
      ctx.fillRect(bx - b.w * 0.5, by, b.w, b.h);
      ctx.strokeStyle = isDark ? 'rgba(0, 243, 255, 0.04)' : 'rgba(0, 89, 255, 0.04)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(bx - b.w * 0.5, by, b.w, b.h);

      ctx.save();
      ctx.translate(bx - b.w * 0.5, by);
      ctx.fillStyle = isDark ? config.colors.cyanDim : 'rgba(0, 89, 255, 0.15)';
      ctx.strokeStyle = isDark ? 'rgba(0, 243, 255, 0.12)' : 'rgba(0, 89, 255, 0.08)';
      ctx.lineWidth = 0.5;
      b.neuralNetPoints.forEach(pt => {
        const px = pt.x * b.w, pyPt = pt.y * b.h * 0.55;
        ctx.beginPath(); ctx.arc(px, pyPt, 1.2, 0, Math.PI * 2); ctx.fill();
        pt.connections.forEach(connIdx => {
          const t = b.neuralNetPoints[connIdx];
          ctx.beginPath(); ctx.moveTo(px, pyPt); ctx.lineTo(t.x * b.w, t.y * b.h * 0.55); ctx.stroke();
        });
      });
      ctx.restore();
    });
  }

  /* ----------------------------------------------------------------- *
   *  Draw: Skyline (mid)
   * ----------------------------------------------------------------- */
  function drawSkylineMid(time) {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');
    const py = currentScrollY * 0.32;

    skyline.forEach(b => {
      if (b.layer !== 'mid') return;
      const bx = b.x + camOffset.x * 0.32;
      const by = height - b.h + py + camOffset.y * 0.32;

      const glassGrad = ctx.createLinearGradient(bx, by, bx, height + py);
      if (isDark) {
        glassGrad.addColorStop(0, 'rgba(22, 30, 52, 0.96)');
        glassGrad.addColorStop(0.5, 'rgba(12, 16, 30, 0.98)');
        glassGrad.addColorStop(1, 'rgba(4, 4, 8, 0.99)');
      } else {
        glassGrad.addColorStop(0, 'rgba(241, 245, 249, 0.95)');
        glassGrad.addColorStop(0.5, 'rgba(203, 213, 225, 0.97)');
        glassGrad.addColorStop(1, 'rgba(148, 163, 184, 0.98)');
      }
      ctx.fillStyle = glassGrad;
      ctx.fillRect(bx - b.w * 0.5, by, b.w, b.h);
      ctx.strokeStyle = isDark ? 'rgba(0, 243, 255, 0.08)' : 'rgba(0, 89, 255, 0.08)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(bx - b.w * 0.5, by, b.w, b.h);

      const cols = Math.floor(b.w / 14);
      const rows = Math.floor((b.h * 0.85) / 16);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const lit = Math.sin(c * 23.3 + r * 17.7 + b.windowSeed * 100) * 0.5 + 0.5;
          if (lit > 0.68) {
            const wx = bx - b.w * 0.5 + 5 + c * 14;
            const wy = by + 10 + r * 16;
            ctx.fillStyle = lit > 0.92
              ? (isDark ? 'rgba(255, 175, 0, 0.45)' : 'rgba(245, 158, 11, 0.45)')
              : (isDark ? 'rgba(0, 243, 255, 0.35)' : 'rgba(59, 130, 246, 0.35)');
            ctx.fillRect(wx, wy, 4.5, 5);
          }
        }
      }

      if (b.isAIResearchTower) {
        const coreY = by - 12;
        const pulse = 1 + Math.sin(time * 3 + b.windowSeed * 10) * 0.15;
        const coreGrad = ctx.createRadialGradient(bx, coreY, 2, bx, coreY, 14 * pulse);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.35, isDark ? config.colors.cyan : config.colors.blue);
        coreGrad.addColorStop(1, 'rgba(0, 243, 255, 0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath(); ctx.arc(bx, coreY, 14 * pulse, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = isDark ? config.colors.cyan : config.colors.blue;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - 26); ctx.stroke();

        ctx.strokeStyle = isDark ? 'rgba(0, 243, 255, 0.14)' : 'rgba(0, 89, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(bx - b.w * 0.5, by); ctx.lineTo(bx + b.w * 0.5, by + b.h * 0.25);
        ctx.moveTo(bx + b.w * 0.5, by); ctx.lineTo(bx - b.w * 0.5, by + b.h * 0.25);
        ctx.stroke();
      }

      ctx.strokeStyle = isDark ? 'rgba(0, 243, 255, 0.25)' : 'rgba(0, 89, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(bx, by, b.w * 0.22, b.w * 0.07, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  /* ----------------------------------------------------------------- *
   *  Draw: Metro + Sky roads (desktop only)
   * ----------------------------------------------------------------- */
  function drawSkyRoadsAndMetro() {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');
    const py = currentScrollY * 0.32;
    const myY = metro.y + py + camOffset.y * 0.32;

    if (config.showMetro) {
      ctx.strokeStyle = isDark ? 'rgba(12, 17, 30, 0.94)' : 'rgba(203, 213, 225, 0.94)';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-100, myY); ctx.lineTo(width + 100, myY); ctx.stroke();

      ctx.strokeStyle = isDark ? config.colors.cyan : config.colors.blue;
      ctx.lineWidth = 1.2; ctx.setLineDash([12, 18]);
      ctx.beginPath(); ctx.moveTo(-100, myY); ctx.lineTo(width + 100, myY); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = isDark ? 'rgba(8, 12, 22, 0.95)' : 'rgba(148, 163, 184, 0.95)';
      for (let x = 80; x < width + 100; x += 280) ctx.fillRect(x - 5 + camOffset.x * 0.32, myY, 10, height - myY);

      if (metro.active) {
        metro.trainX += metro.speed;
        if (metro.trainX > width + 200) { metro.active = false; metro.cooldown = 140 + Math.random() * 200; metro.trainX = -250; }
        const tx = metro.trainX + camOffset.x * 0.32;
        const trainGrad = ctx.createLinearGradient(tx, myY - 5, tx + metro.width, myY - 5);
        if (isDark) {
          trainGrad.addColorStop(0, 'rgba(0, 243, 255, 0)'); trainGrad.addColorStop(0.35, 'rgba(0, 243, 255, 0.8)');
          trainGrad.addColorStop(0.7, '#ffffff'); trainGrad.addColorStop(1, 'rgba(0, 243, 255, 0)');
        } else {
          trainGrad.addColorStop(0, 'rgba(0, 89, 255, 0)'); trainGrad.addColorStop(0.35, 'rgba(0, 89, 255, 0.8)');
          trainGrad.addColorStop(0.7, '#1e3a8a'); trainGrad.addColorStop(1, 'rgba(0, 89, 255, 0)');
        }
        ctx.fillStyle = trainGrad;
        ctx.fillRect(tx, myY - 5, metro.width, 4);
        ctx.fillStyle = isDark ? '#ffffff' : '#f8fafc';
        for (let w = 0; w < 7; w++) ctx.fillRect(tx + 18 + w * 15, myY - 4.2, 7, 1.8);
      } else {
        metro.cooldown--;
        if (metro.cooldown <= 0) metro.active = true;
      }
    }

    if (config.showSkyRoads) {
      const roadY = myY + 40;
      ctx.strokeStyle = isDark ? 'rgba(10, 14, 26, 0.82)' : 'rgba(226, 232, 240, 0.85)';
      ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(-100, roadY); ctx.lineTo(width + 100, roadY); ctx.stroke();

      ctx.strokeStyle = isDark ? 'rgba(0, 110, 255, 0.55)' : 'rgba(59, 130, 246, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-100, roadY); ctx.lineTo(width + 100, roadY); ctx.stroke();

      skyRoadCars.forEach(car => {
        car.x += car.speed * car.direction;
        if (car.direction === 1 && car.x > width + 100) car.x = -100;
        else if (car.direction === -1 && car.x < -100) car.x = width + 100;
        const cx = car.x + camOffset.x * 0.32;
        const cy = roadY + (car.lane === 0 ? -3.5 : 2);
        ctx.fillStyle = isDark ? car.color : 'rgba(30, 58, 138, 0.8)';
        ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
        const trailGrad = ctx.createLinearGradient(cx - car.direction * 14, cy, cx, cy);
        trailGrad.addColorStop(0, 'rgba(0,0,0,0)');
        trailGrad.addColorStop(1, isDark ? car.color : 'rgba(30, 58, 138, 0.4)');
        ctx.strokeStyle = trailGrad; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - car.direction * 14, cy); ctx.lineTo(cx, cy); ctx.stroke();
      });
    }
  }

  /* ----------------------------------------------------------------- *
   *  Draw: Holograms (desktop only)
   * ----------------------------------------------------------------- */
  function drawHolograms(time) {
    const isDark = !document.body.classList.contains('bg-white');
    if (!isDark) return;
    const py = currentScrollY * 0.32;
    ctx.font = '900 11px "Inter", "Playfair Display", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    holograms.forEach(h => {
      const hx = h.x + camOffset.x * 0.32;
      const hy = h.y + py + camOffset.y * 0.32;
      const dx = cursor.x - hx, dy = cursor.y - hy;
      const dist = Math.hypot(dx, dy);

      let skewXTarget = 0, skewYTarget = 0;
      if (dist < 180) {
        const strength = (1 - dist / 180) * 0.22;
        skewXTarget = (dx / 180) * strength;
        skewYTarget = (dy / 180) * strength;
      }
      h.skewX += (skewXTarget - h.skewX) * 0.08;
      h.skewY += (skewYTarget - h.skewY) * 0.08;

      h.glitchTime--;
      let isGlitch = false;
      if (h.glitchTime <= 0) { if (Math.random() > 0.988) h.glitchTime = Math.floor(Math.random() * 12) + 4; }
      else isGlitch = true;

      ctx.save();
      ctx.translate(hx, hy);
      ctx.transform(1, h.skewY, h.skewX, 1, 0, 0);
      const scanPhase = (time * 0.06) % 1;
      ctx.shadowColor = 'rgba(0, 243, 255, 0.7)';
      ctx.shadowBlur = isGlitch ? 12 : 5;
      const alpha = h.opacity * (isGlitch ? Math.random() : 0.6);
      ctx.fillStyle = `rgba(0, 243, 255, ${alpha})`;
      if (isGlitch && Math.random() > 0.5) {
        ctx.fillStyle = 'rgba(255, 0, 120, 0.6)';
        ctx.fillText(h.text, Math.random() * 6 - 3, Math.random() * 3 - 1.5);
        ctx.fillStyle = `rgba(0, 243, 255, ${alpha})`;
      }
      ctx.fillText(h.text, 0, 0);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
      ctx.lineWidth = 0.5;
      const scanY = -6 + scanPhase * 12;
      const tLen = h.text.length * 7;
      ctx.beginPath(); ctx.moveTo(-tLen * 0.5, scanY); ctx.lineTo(tLen * 0.5, scanY); ctx.stroke();
      ctx.restore();
    });
  }

  /* ----------------------------------------------------------------- *
   *  Draw: Drones
   * ----------------------------------------------------------------- */
  function drawDrones(time) {
    const width = innerWidth;
    const isDark = !document.body.classList.contains('bg-white');
    const py = currentScrollY * 0.38;

    drones.forEach(d => {
      d.x += d.speed * d.direction;
      d.y += Math.sin(time * 2.2 + d.pulsePhase) * 0.2;
      if (d.direction === 1 && d.x > width + 40) d.x = -40;
      else if (d.direction === -1 && d.x < -40) d.x = width + 40;

      const dx = d.x + camOffset.x * 0.38;
      const dy = d.y + py + camOffset.y * 0.38;

      ctx.fillStyle = isDark ? '#080d1a' : '#94a3b8';
      ctx.strokeStyle = isDark ? config.colors.cyan : config.colors.blue;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(dx, dy, d.size * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dx - d.size * 1.3, dy); ctx.lineTo(dx + d.size * 1.3, dy); ctx.stroke();

      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 0.5;
      const rot = time * 12 + d.pulsePhase;
      ctx.beginPath();
      ctx.moveTo(dx - d.size * 1.3 - d.size * 0.45 * Math.sin(rot), dy);
      ctx.lineTo(dx - d.size * 1.3 + d.size * 0.45 * Math.sin(rot), dy); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dx + d.size * 1.3 - d.size * 0.45 * Math.sin(rot), dy);
      ctx.lineTo(dx + d.size * 1.3 + d.size * 0.45 * Math.sin(rot), dy); ctx.stroke();

      const blink = Math.sin(time * 6 + d.pulsePhase) > 0;
      ctx.fillStyle = blink ? 'rgba(34, 197, 94, 0.85)' : (isDark ? config.colors.cyan : config.colors.blue);
      ctx.beginPath(); ctx.arc(dx, dy - 1.5, 0.8, 0, Math.PI * 2); ctx.fill();

      if (d.hasBeam && isDark) {
        ctx.save();
        const beamGrad = ctx.createLinearGradient(dx, dy, dx, dy + 60);
        beamGrad.addColorStop(0, 'rgba(0, 243, 255, 0.2)');
        beamGrad.addColorStop(1, 'rgba(0, 243, 255, 0)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - 15, dy + 55); ctx.lineTo(dx + 15, dy + 55); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    });
  }

  /* ----------------------------------------------------------------- *
   *  Draw: Fog / Foreground / Rain / Vignette
   * ----------------------------------------------------------------- */
  function drawVolumetricFog() {
    const width = innerWidth;
    const isDark = !document.body.classList.contains('bg-white');
    if (!isDark) return;
    fog.forEach(f => {
      f.x += f.vx; f.y += f.vy;
      if (f.x - f.r > width) f.x = -f.r;
      const dx = cursor.x - f.x, dy = cursor.y - f.y;
      const dist = Math.hypot(dx, dy);
      if (dist < f.r * 1.1) { const force = (1 - dist / (f.r * 1.1)) * 0.6; f.x -= (dx / dist) * force; }
      const fogGrad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      fogGrad.addColorStop(0, 'rgba(0, 160, 220, 0.03)');
      fogGrad.addColorStop(0.5, 'rgba(25, 38, 70, 0.012)');
      fogGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = fogGrad;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawForeground() {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');
    const py = currentScrollY * 0.65;
    const roadHeight = height * 0.20;
    const roadTop = height - roadHeight + py + camOffset.y * 0.65;

    const roadGrad = ctx.createLinearGradient(0, roadTop, 0, height + py);
    if (isDark) { roadGrad.addColorStop(0, '#030408'); roadGrad.addColorStop(1, '#000000'); }
    else        { roadGrad.addColorStop(0, '#cbd5e1'); roadGrad.addColorStop(1, '#94a3b8'); }
    ctx.fillStyle = roadGrad;
    ctx.fillRect(0, roadTop, width, roadHeight + 100);

    if (isDark) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      skyline.forEach(b => {
        if (b.layer !== 'mid') return;
        const bx = b.x + camOffset.x * 0.32;
        const isWarm = Math.sin(b.windowSeed * 50) > 0.65;
        const color = isWarm ? 'rgba(255, 130, 0, 0.07)' : 'rgba(0, 243, 255, 0.06)';
        const refGrad = ctx.createLinearGradient(bx, roadTop, bx, height + py);
        refGrad.addColorStop(0, color);
        refGrad.addColorStop(0.7, 'rgba(0, 243, 255, 0.005)');
        refGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = refGrad;
        ctx.fillRect(bx - b.w * 0.4 + camOffset.x * 0.65, roadTop, b.w * 0.8, roadHeight);
      });
      ctx.restore();
    }

    ctx.fillStyle = isDark ? 'rgba(0, 18, 36, 0.45)' : 'rgba(203, 213, 225, 0.45)';
    ctx.strokeStyle = isDark ? 'rgba(0, 243, 255, 0.12)' : 'rgba(0, 89, 255, 0.12)';
    ctx.lineWidth = 0.5;
    const puddles = [
      { x: width * 0.18, y: roadTop + roadHeight * 0.28, rx: 65, ry: 9 },
      { x: width * 0.78, y: roadTop + roadHeight * 0.55, rx: 85, ry: 12 },
      { x: width * 0.48, y: roadTop + roadHeight * 0.78, rx: 55, ry: 8 },
    ];
    const t = performance.now() * 0.001;
    puddles.forEach(p => {
      const px = p.x + camOffset.x * 0.65, pyCoord = p.y;
      ctx.beginPath(); ctx.ellipse(px, pyCoord, p.rx, p.ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const rippleRadius = (t * 14 + p.x) % (p.rx * 0.75);
      const a = Math.max(0, 0.14 * (1 - rippleRadius / (p.rx * 0.75)));
      ctx.strokeStyle = isDark ? `rgba(255, 255, 255, ${a})` : `rgba(0, 89, 255, ${a})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.ellipse(px, pyCoord, rippleRadius, rippleRadius * (p.ry / p.rx), 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function drawRainAndParticles() {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');

    ctx.strokeStyle = isDark ? 'rgba(170, 215, 255, 0.16)' : 'rgba(59, 130, 246, 0.15)';
    ctx.lineWidth = 0.7;
    rain.forEach(r => {
      const dx = cursor.x - r.x, dy = cursor.y - r.y;
      const dist = Math.hypot(dx, dy);
      let bendX = 0;
      if (dist < 110) { const pushForce = (1 - dist / 110) * 10; bendX = (dx > 0 ? -1 : 1) * pushForce; }
      ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.xspeed + bendX, r.y + r.len); ctx.stroke();
      r.x += r.xspeed + bendX * 0.04; r.y += r.yspeed;
      if (r.y > height) { r.x = Math.random() * width; r.y = -r.len - 10; }
    });

    particles.forEach(p => {
      const dx = cursor.x - p.x, dy = cursor.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 90) { const force = (1 - dist / 90) * 1.3; p.x -= (dx / dist) * force; p.y -= (dy / dist) * force; }
      ctx.fillStyle = isDark ? p.color : 'rgba(59, 130, 246, 0.6)';
      ctx.globalAlpha = p.life * 0.75;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1.0;
      p.x += p.speedX; p.y += p.speedY; p.life -= 0.0028;
      if (p.life <= 0 || p.y < -10) { p.x = Math.random() * width; p.y = height + 10; p.life = 0.5 + Math.random() * 0.5; }
    });
  }

  function drawTextAreaProtection() {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');
    if (!isDark) return;
    // Stronger centre darkening on mobile so the hero text stays crisp
    const inner = config.mobile ? 0.68 : 0.55;
    const mid   = config.mobile ? 0.4  : 0.28;
    const grad = ctx.createRadialGradient(width * 0.5, height * 0.5, 40, width * 0.5, height * 0.5, width * (config.mobile ? 0.75 : 0.52));
    grad.addColorStop(0, `rgba(0, 0, 0, ${inner})`);
    grad.addColorStop(0.65, `rgba(0, 0, 0, ${mid})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  /* ----------------------------------------------------------------- *
   *  AI cursor (desktop / hover devices only)
   * ----------------------------------------------------------------- */
  function updateCursorPhysics() {
    let tx = mouse.tx, ty = mouse.ty;
    isHovered = false;
    let targetElement = null, minDist = 99999;

    interactiveRects.forEach(rect => {
      const dist = Math.hypot(mouse.tx - rect.cx, mouse.ty - rect.cy);
      if (dist < 45 && dist < minDist) { minDist = dist; targetElement = rect; }
    });

    if (targetElement) {
      const pull = (1 - minDist / 45) * 0.52;
      tx += (targetElement.cx - tx) * pull;
      ty += (targetElement.cy - ty) * pull;
      isHovered = true; activeElement = targetElement;
    } else activeElement = null;

    const springK = 0.15, damping = 0.58;
    const dx = tx - cursor.x, dy = ty - cursor.y;
    cursor.vx = (cursor.vx + dx * springK) * damping;
    cursor.vy = (cursor.vy + dy * springK) * damping;
    cursor.x += cursor.vx; cursor.y += cursor.vy;

    hoverProgress += ((isHovered ? 1 : 0) - hoverProgress) * 0.12;

    cursorTrail.push({ x: cursor.x, y: cursor.y });
    if (cursorTrail.length > 10) cursorTrail.shift();

    if (isHovered && !wasHovered) {
      clicks.push({ x: cursor.x, y: cursor.y, radius: 8, alpha: 0.65 });
      for (let i = 0; i < 7; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 2.2;
        sparkParticles.push({
          x: cursor.x, y: cursor.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          size: 0.8 + Math.random() * 1.2, life: 0.8,
        });
      }
    }
    wasHovered = isHovered;
  }

  function drawAICursor(time) {
    const width = innerWidth, height = innerHeight;
    const isDark = !document.body.classList.contains('bg-white');
    cursorCtx.clearRect(0, 0, width, height);

    const cx = cursor.x, cy = cursor.y;
    const glowRadius = 7 + hoverProgress * 10;
    const innerRingRadius = 12 + hoverProgress * 8;
    const outerRingRadius = 23 + hoverProgress * 13;

    const cursorColor = isHovered ? '#ffffff' : (isDark ? '#00f3ff' : '#0059ff');
    const ringColor = isDark ? (isHovered ? 'rgba(0, 243, 255, 0.9)' : 'rgba(0, 243, 255, 0.6)')
                             : (isHovered ? 'rgba(0, 89, 255, 0.9)' : 'rgba(0, 89, 255, 0.6)');
    const auraColor = isDark ? (isHovered ? 'rgba(0, 243, 255, 0.35)' : 'rgba(0, 243, 255, 0.12)')
                             : (isHovered ? 'rgba(0, 89, 255, 0.3)' : 'rgba(0, 89, 255, 0.1)');

    if (cursorTrail.length > 1) {
      cursorCtx.beginPath();
      cursorCtx.moveTo(cursorTrail[0].x, cursorTrail[0].y);
      for (let i = 1; i < cursorTrail.length; i++) cursorCtx.lineTo(cursorTrail[i].x, cursorTrail[i].y);
      const trailGrad = cursorCtx.createLinearGradient(
        cursorTrail[0].x, cursorTrail[0].y,
        cursorTrail[cursorTrail.length - 1].x, cursorTrail[cursorTrail.length - 1].y);
      trailGrad.addColorStop(0, 'rgba(0, 243, 255, 0)');
      trailGrad.addColorStop(1, isDark ? 'rgba(0, 243, 255, 0.32)' : 'rgba(0, 89, 255, 0.28)');
      cursorCtx.strokeStyle = trailGrad; cursorCtx.lineWidth = 1.4; cursorCtx.lineCap = 'round'; cursorCtx.stroke();
    }

    const auraGrad = cursorCtx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius * 2.4);
    auraGrad.addColorStop(0, auraColor);
    auraGrad.addColorStop(1, 'rgba(0,0,0,0)');
    cursorCtx.fillStyle = auraGrad;
    cursorCtx.beginPath(); cursorCtx.arc(cx, cy, glowRadius * 2.4, 0, Math.PI * 2); cursorCtx.fill();

    cursorCtx.fillStyle = cursorColor;
    cursorCtx.beginPath(); cursorCtx.arc(cx, cy, 3.2, 0, Math.PI * 2); cursorCtx.fill();

    // Inner ring
    cursorCtx.save();
    cursorCtx.translate(cx, cy); cursorCtx.rotate(time * 1.6);
    cursorCtx.strokeStyle = ringColor; cursorCtx.lineWidth = 0.9;
    cursorCtx.setLineDash([innerRingRadius * Math.PI * 0.7, innerRingRadius * Math.PI * 0.3]);
    cursorCtx.beginPath(); cursorCtx.arc(0, 0, innerRingRadius, 0, Math.PI * 2); cursorCtx.stroke();
    cursorCtx.setLineDash([]);
    cursorCtx.fillStyle = ringColor;
    for (let a = 0; a < 4; a++) {
      cursorCtx.save(); cursorCtx.rotate(a * Math.PI / 2);
      cursorCtx.fillRect(-0.5, -innerRingRadius - 2, 1, 3.5); cursorCtx.restore();
    }
    cursorCtx.restore();

    // Outer ring
    cursorCtx.save();
    cursorCtx.translate(cx, cy); cursorCtx.rotate(-time * 0.95);
    cursorCtx.strokeStyle = ringColor; cursorCtx.lineWidth = 0.55;
    cursorCtx.setLineDash([4, 6]);
    cursorCtx.beginPath(); cursorCtx.arc(0, 0, outerRingRadius, 0, Math.PI * 2); cursorCtx.stroke();
    cursorCtx.setLineDash([]);
    cursorCtx.restore();

    // Brackets
    const bracketLen = 3.5, cOffset = outerRingRadius + 3.5;
    cursorCtx.strokeStyle = ringColor; cursorCtx.lineWidth = 0.75;
    const bracket = (sx, sy, ex, ey, mx, my) => { cursorCtx.beginPath(); cursorCtx.moveTo(sx, sy); cursorCtx.lineTo(ex, ey); cursorCtx.lineTo(mx, my); cursorCtx.stroke(); };
    bracket(cx - cOffset + bracketLen, cy - cOffset, cx - cOffset, cy - cOffset, cx - cOffset, cy - cOffset + bracketLen);
    bracket(cx + cOffset - bracketLen, cy - cOffset, cx + cOffset, cy - cOffset, cx + cOffset, cy - cOffset + bracketLen);
    bracket(cx - cOffset + bracketLen, cy + cOffset, cx - cOffset, cy + cOffset, cx - cOffset, cy + cOffset - bracketLen);
    bracket(cx + cOffset - bracketLen, cy + cOffset, cx + cOffset, cy + cOffset, cx + cOffset, cy + cOffset - bracketLen);

    // Orbiting particles
    const orbitCount = 4;
    for (let i = 0; i < orbitCount; i++) {
      const pAngle = time * 2.2 + (i * Math.PI * 2 / orbitCount);
      const pr = innerRingRadius + (outerRingRadius - innerRingRadius) * 0.5;
      const px = cx + Math.cos(pAngle) * pr, py = cy + Math.sin(pAngle) * pr;
      cursorCtx.fillStyle = isDark ? '#00f3ff' : '#0059ff';
      cursorCtx.beginPath(); cursorCtx.arc(px, py, 1.0, 0, Math.PI * 2); cursorCtx.fill();
    }

    drawClickEffects(isDark);
  }

  function drawClickEffects(isDark) {
    for (let i = clicks.length - 1; i >= 0; i--) {
      const clk = clicks[i];
      clk.radius += 3.2; clk.alpha -= 0.035;
      if (clk.alpha <= 0) { clicks.splice(i, 1); continue; }
      cursorCtx.strokeStyle = isDark ? `rgba(0, 243, 255, ${clk.alpha})` : `rgba(0, 89, 255, ${clk.alpha})`;
      cursorCtx.lineWidth = 1.3;
      cursorCtx.beginPath(); cursorCtx.arc(clk.x, clk.y, clk.radius, 0, Math.PI * 2); cursorCtx.stroke();
    }
    for (let i = sparkParticles.length - 1; i >= 0; i--) {
      const sp = sparkParticles[i];
      sp.x += sp.vx; sp.y += sp.vy; sp.vy += 0.07; sp.vx *= 0.97; sp.vy *= 0.97; sp.life -= 0.022;
      if (sp.life <= 0) { sparkParticles.splice(i, 1); continue; }
      cursorCtx.fillStyle = isDark ? `rgba(0, 243, 255, ${sp.life})` : `rgba(0, 89, 255, ${sp.life})`;
      cursorCtx.beginPath(); cursorCtx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2); cursorCtx.fill();
    }
  }

  /* ----------------------------------------------------------------- *
   *  Camera
   * ----------------------------------------------------------------- */
  function updateCamera() {
    currentScrollY += (scrollY - currentScrollY) * 0.075;
    const time = Date.now() * 0.00025;
    // Gentler camera drift on mobile
    const ampX = config.mobile ? 14 : 32;
    const ampY = config.mobile ? 5  : 11;
    targetCamOffset.x = Math.sin(time) * ampX;
    targetCamOffset.y = Math.cos(time * 0.65) * ampY;
    camOffset.x += (targetCamOffset.x - camOffset.x) * 0.045;
    camOffset.y += (targetCamOffset.y - camOffset.y) * 0.045;
  }

  /* ----------------------------------------------------------------- *
   *  Boot
   * ----------------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSplashCursor);
  } else {
    initSplashCursor();
  }
})();