(function () {
  'use strict';

  // ==========================================
  // IMAGE ARRAY — 24 slots (4-5-6-5-4 honeycomb), cycling 20 source photos
  // ==========================================
  const SOURCE_PHOTO_COUNT = 20;
  const TOTAL_SLOTS = 24;
  const IMAGES = Array.from(
    { length: TOTAL_SLOTS },
    (_, i) => `https://picsum.photos/500/500?random=${(i % SOURCE_PHOTO_COUNT) + 1}`
  );

  // ==========================================
  // DOM VARIABLES (resolved in init)
  // ==========================================
  let hexRows           = null;
  let overlay            = null;
  let caption             = null;
  let captionTitle       = null;
  let captionSub          = null;
  let lightboxImageContainer = null;
  let lightboxFrame       = null;

  // ==========================================
  // STATE
  // ==========================================
  let cards            = [];
  let cardPositions    = [];
  let baseHexWidth     = 0;
  let baseHexHeight    = 0;
  let gap              = 6;
  let maxCols          = 6;
  let rowPattern       = [4, 5, 6, 5, 4];
  let lightboxOpen     = false;
  let activeLightboxIndex = 0;
  let lastFocusedElement  = null;
  let resizeTimeout    = null;
  let gsapCtx          = null;
  let cardRings        = [];
  let initRetryCount   = 0;
  let wheelCooldown    = false;

  const REQUIRED_IDS = ['gallerySectionOuter', 'galleryStickyEl', 'hexRows', 'galleryBlackOverlay', 'galleryTitle'];

  // ==========================================
  // DIAGNOSTIC CHECK — tells you EXACTLY which id is missing
  // instead of letting GSAP spam vague "target not found" errors.
  // ==========================================
  function findMissingIds() {
    return REQUIRED_IDS.filter(id => !document.getElementById(id));
  }

  // ==========================================
  // STYLE INJECTION
  // ==========================================
  function injectStyles() {
    if (document.getElementById('gallery-dynamic-styles')) return;
    const style = document.createElement('style');
    style.id = 'gallery-dynamic-styles';
    style.textContent = `
      #gallerySectionOuter { position: relative; z-index: 10; }

      /* A thin vertical line drops from the top of the viewport down to
         the closed portal box below — same idea as the Vector Bridge
         line into the Glimpse portal, not a full-screen black wash. */
      #galleryBlackOverlay {
        position: fixed;
        top: 0; left: 50%;
        width: 4px; height: 0;
        margin-left: -2px;
        background: #000;
        transform-origin: top center;
        transform: scaleY(0);
        z-index: 9;
        pointer-events: none;
      }

      #galleryStickyEl {
        /* GSAP ScrollTrigger owns the pinning. Do NOT use position:sticky
           here — it fights the pin and makes the section scroll away.
           clip-path starts as a small closed "portal box" (set via JS,
           matching where the line above lands) and is animated out to
           inset(0) — the box opening to reveal the gallery inside it,
           mirroring the Glimpse portal-box effect. */
        position: relative;
        width: 100%;
        height: 100vh;
        overflow: hidden;
        background: #000;
        border: 2px solid #000;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 50;
      }

      #galleryCanvas {
        position: relative;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
      }

      /* Title sits at its natural size at the top; the honeycomb takes
         "margin: auto" below it so it's centered in whatever vertical
         space is left over — never in the full viewport — which is what
         keeps every row on screen instead of overflow:hidden clipping
         the bottom of the grid. */
      .gallery-heading { flex: 0 0 auto; }

      #galleryTitle {
        font-family: 'Inter', sans-serif;
        font-weight: 900;
        color: #ffffff;
        letter-spacing: -0.04em;
        text-align: center;
        line-height: 0.9;
        margin: 0 0 24px 0;
        opacity: 0;
        transform: translateY(30px);
        will-change: opacity, transform;
        user-select: none;
      }

      @media (min-width: 1366px) { #galleryTitle { font-size: 96px; } }
      @media (min-width: 1024px) and (max-width: 1365px) { #galleryTitle { font-size: 76px; } }
      @media (min-width: 768px)  and (max-width: 1023px) { #galleryTitle { font-size: 56px; margin-bottom: 20px; } }
      @media (max-width: 767px) {
        #galleryTitle { font-size: 32px; margin-bottom: 16px; letter-spacing: 0.06em; }
      }

      @media (max-width: 1023px) {
        #galleryStickyEl { justify-content: flex-start; }
        #galleryCanvas   { justify-content: flex-start; }
        #hexRows         { margin: 0; flex: 0 0 auto; }
      }

      #hexRows { position: relative; margin: auto; flex-shrink: 0; }

      /* .hex-card's transform (translate+scale+rotate composite) is
         owned EXCLUSIVELY by GSAP for the petal-bloom intro/scramble-out.
         Hover visuals live on .hex-inner instead so nothing collides. */
      .hex-card {
        position: absolute;
        top: 0;
        left: 0;
        cursor: pointer;
        will-change: transform, opacity;
        outline: none;
        box-sizing: border-box;
        z-index: 1;
        opacity: 0;
        --push-x: 0px;
        --push-y: 0px;
      }

      .hex-card:focus-visible {
        outline: 2px solid #00f2fe;
        outline-offset: 3px;
      }

      .hex-push {
        position: relative;
        width: 100%;
        height: 100%;
        transform: translate(var(--push-x), var(--push-y));
        transition: transform 0.35s cubic-bezier(0.16,1,0.3,1);
      }

      /* Ambient animated gradient ring — always faintly visible, like the
         rotating conic-gradient borders on the Domains track cards. */
      .hex-glow {
        position: absolute;
        inset: 0;
        clip-path: polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
        overflow: hidden;
        opacity: 0.5;
        transition: opacity 0.45s ease;
        pointer-events: none;
      }
      .hex-card:hover .hex-glow { opacity: 1; }
      .hex-glow-gradient {
        position: absolute;
        width: 240%;
        height: 240%;
        top: -70%;
        left: -70%;
        background: conic-gradient(from 0deg, transparent, #00f2fe, #4facfe, #7000ff, transparent);
        animation: hex-glow-rotate 7s linear infinite;
        filter: blur(5px);
      }
      @keyframes hex-glow-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

      .hex-inner {
        position: absolute;
        inset: 3px;
        background: rgba(255,255,255,0.03);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        clip-path: polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
        overflow: hidden;
        transition: background 0.45s ease, transform 0.45s cubic-bezier(0.16,1,0.3,1);
        box-sizing: border-box;
      }

      .hex-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        clip-path: polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
        transition: transform 0.55s cubic-bezier(0.16,1,0.3,1), filter 0.55s ease;
        filter: brightness(0.72) saturate(0.82);
        pointer-events: none;
      }

      .hex-reflection {
        position: absolute;
        top: 0;
        left: -150%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent);
        transform: skewX(-25deg);
        pointer-events: none;
      }

      .hex-card:hover .hex-inner {
        background: rgba(255,255,255,0.07);
        transform: scale(1.08);
        z-index: 10;
      }
      .hex-card:hover .hex-image {
        transform: scale(1.14);
        filter: brightness(1.22) saturate(1.18);
      }
      .hex-card:hover .hex-reflection {
        left: 150%;
        transition: left 0.75s cubic-bezier(0.16,1,0.3,1);
      }

      @keyframes ken-burns {
        0%   { transform: scale(1.14) translate(0, 0); }
        50%  { transform: scale(1.20) translate(1.5%, -1%); }
        100% { transform: scale(1.14) translate(0, 0); }
      }
      .hex-image.ken-burns { animation: ken-burns 14s ease-in-out infinite alternate; }

      /* ---- Lightbox overlay ---- */
      .lightbox-overlay {
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.88);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        z-index: 99999;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.5s cubic-bezier(0.16,1,0.3,1);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .lightbox-overlay.active { opacity: 1; pointer-events: auto; }

      /* Smaller popup, floats gently, ringed with the same rotating
         colored-gradient look as the hex cards. */
      .lightbox-image-container {
        position: absolute;
        top: 50%; left: 50%;
        width: min(52vw, 480px);
        height: min(46vh, 380px);
        border-radius: 20px;
        overflow: hidden;
        box-shadow: 0 25px 60px rgba(0,0,0,0.8);
        animation: lightbox-float 4.5s ease-in-out infinite;
      }
      @keyframes lightbox-float {
        0%, 100% { transform: translate(-50%,-50%) translateY(0); }
        50%      { transform: translate(-50%,-50%) translateY(-14px); }
      }
      .lightbox-glow {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
      }
      .lightbox-glow-gradient {
        position: absolute;
        width: 220%;
        height: 220%;
        top: -60%;
        left: -60%;
        background: conic-gradient(from 0deg, transparent, #00f2fe, #4facfe, #7000ff, transparent);
        animation: hex-glow-rotate 6s linear infinite;
        filter: blur(8px);
      }
      .lightbox-frame {
        position: absolute;
        inset: 3px;
        border-radius: 17px;
        overflow: hidden;
        background: rgba(10,10,10,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .lightbox-img {
        position: absolute;
        max-width: 100%; max-height: 100%;
        object-fit: contain;
        opacity: 0;
        transition: opacity 0.4s ease;
        pointer-events: none;
      }
      .lightbox-img.active { opacity: 1; }

      .lightbox-caption {
        position: absolute;
        bottom: 32px; left: 50%;
        transform: translateX(-50%);
        text-align: center;
        z-index: 100000;
        width: 90%; max-width: 480px;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        padding: 12px 24px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,0.05);
        transition: opacity 0.4s ease, transform 0.4s ease;
        pointer-events: none;
      }
      .lightbox-caption-title {
        font-size: 1.15rem; font-weight: 900;
        letter-spacing: 0.1em; color: #fff;
        text-transform: uppercase; margin-bottom: 4px;
      }
      .lightbox-caption-sub {
        font-size: 0.7rem; font-weight: 500;
        color: rgba(255,255,255,0.5);
        text-transform: uppercase; letter-spacing: 0.06em;
      }

      @media (max-width: 768px) {
        .lightbox-image-container { width: min(80vw, 420px); height: min(40vh, 320px); }
        .lightbox-caption { bottom: 16px; padding: 10px 20px; }
        .lightbox-caption-title { font-size: 1rem; }
      }
    `;
    document.head.appendChild(style);
  }

  // ==========================================
  // RESPONSIVE LAYOUT CONFIG
  // Row pattern (4-5-6-5-4) is fixed at every viewport size — only the
  // hex size + gap are recalculated so the WHOLE honeycomb always fits
  // in whatever vertical space is left after the title. No fixed
  // per-breakpoint pixel table: hex size is solved for, not looked up.
  //
  //   availableHeight = viewportHeight − titleBlockHeight − topPadding − bottomSafeArea
  //
  // We solve for the largest hex size that fits BOTH that height and the
  // available width, so nothing ever overflows/clips vertically.
  // ==========================================
  const HEX_ASPECT   = 1.1547; // hexH / hexW for our clip-path hexagon (2/√3)
  const ROW_PATTERN  = [4, 5, 6, 5, 4];
  const MAX_COLS     = 6;
  const MIN_HEX_W    = 26;
  const MAX_HEX_W    = 190;

  function getLayoutConfig(titleBlockHeight) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isMobile = vw < 768;
    const rows = ROW_PATTERN.length;

    const NAVBAR_H = 76; // matches #mobile-navbar-bg h-[76px]

    const topPadding = isMobile
      ? NAVBAR_H + 16
      : Math.max(12, Math.min(32, vh * 0.02));
    const bottomSafeArea = isMobile ? Math.max(16, vh * 0.03) : Math.max(16, Math.min(40, vh * 0.03));
    const sidePadding    = Math.max(16, vw * 0.03);

    const availableHeight = Math.max(60, vh - titleBlockHeight - topPadding - bottomSafeArea);
    const availableWidth  = Math.max(120, vw - sidePadding * 2);

    const gap = Math.max(3, Math.min(8, vw * 0.006));

    // Fit against height: totalH = hexH*(1+(rows-1)*0.75) + (rows-1)*gap
    const heightFactor  = 1 + (rows - 1) * 0.75;
    const hexHFromHeight = (availableHeight - (rows - 1) * gap) / heightFactor;
    const hexWFromHeight = hexHFromHeight / HEX_ASPECT;

    // Fit against width: totalW = maxCols*hexW + (maxCols-1)*gap
    const hexWFromWidth = (availableWidth - (MAX_COLS - 1) * gap) / MAX_COLS;

    let hexW = Math.min(hexWFromHeight, hexWFromWidth);
    hexW = Math.max(MIN_HEX_W, Math.min(MAX_HEX_W, hexW));
    const hexH = hexW * HEX_ASPECT;

    return { pattern: ROW_PATTERN, maxCols: MAX_COLS, gap, hexW, hexH, topPadding };
  }

  // ==========================================
  // BUILD HEX GRID DOM
  // ==========================================
  function createGrid() {
    if (!hexRows) return;
    hexRows.innerHTML = '';
    cards = [];

    IMAGES.forEach((url, i) => {
      const card = document.createElement('div');
      card.className = 'hex-card';
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `View event photo ${i + 1}`);

      const push = document.createElement('div');
      push.className = 'hex-push';

      const glow = document.createElement('div');
      glow.className = 'hex-glow';
      const glowGradient = document.createElement('div');
      glowGradient.className = 'hex-glow-gradient';
      glowGradient.style.animationDelay = `${-(i % 7)}s`;
      glow.appendChild(glowGradient);

      const inner = document.createElement('div');
      inner.className = 'hex-inner';

      const img = document.createElement('img');
      img.className = 'hex-image';
      img.alt = `PEC Hacks moment ${i + 1}`;
      img.loading = 'lazy';
      img.src = url;

      const reflection = document.createElement('div');
      reflection.className = 'hex-reflection';

      inner.appendChild(img);
      inner.appendChild(reflection);
      push.appendChild(glow);
      push.appendChild(inner);
      card.appendChild(push);
      hexRows.appendChild(card);

      cards.push({ element: card, push, image: img, index: i });

      let kenBurnsTimeout = null;

      card.addEventListener('mouseenter', () => {
        if (lightboxOpen) return;
        applyNeighborPush(i);
        kenBurnsTimeout = setTimeout(() => img.classList.add('ken-burns'), 580);
      });
      card.addEventListener('mouseleave', () => {
        if (lightboxOpen) return;
        clearTimeout(kenBurnsTimeout);
        img.classList.remove('ken-burns');
        resetNeighborPush();
      });
      card.addEventListener('click', () => openLightbox(i));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(i); }
      });
    });
  }

  // ==========================================
  // CALCULATE POSITIONS + PETAL ORIGIN VECTORS
  // Every card gets, besides its final (x,y) slot, a delta from the
  // grid's center to that slot — that delta is the "petal" travel
  // distance each hex unfurls along, like petals opening from a bud.
  // ==========================================
  function measureTitleBlock() {
    const el = document.getElementById('galleryTitle');
    if (!el) return 0;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return 0;
    return el.getBoundingClientRect().height
         + parseFloat(cs.marginTop  || 0)
         + parseFloat(cs.marginBottom || 0);
  }

  function calculateLayout() {
    if (!hexRows) return;

    const titleBlockHeight = measureTitleBlock();
    const cfg = getLayoutConfig(titleBlockHeight);
    rowPattern    = cfg.pattern;
    maxCols       = cfg.maxCols;
    gap           = cfg.gap;
    baseHexWidth  = cfg.hexW;
    baseHexHeight = cfg.hexH;

    const galleryCanvas = document.getElementById('galleryCanvas');
    if (galleryCanvas) galleryCanvas.style.paddingTop = `${cfg.topPadding}px`;

    const rows = [];
    let imgIdx = 0;
    for (let pi = 0; pi < rowPattern.length && imgIdx < IMAGES.length; pi++) {
      const count = Math.min(rowPattern[pi], IMAGES.length - imgIdx);
      rows.push({ count, startIndex: imgIdx });
      imgIdx += count;
    }

    const totalW = maxCols * baseHexWidth + (maxCols - 1) * gap;
    const totalH = (rows.length - 1) * (baseHexHeight * 0.75 + gap) + baseHexHeight;

    hexRows.style.width  = `${totalW}px`;
    hexRows.style.height = `${totalH}px`;

    const cx = totalW / 2;
    const cy = totalH / 2;

    cardPositions = [];
    rows.forEach((row, rowIndex) => {
      const offset = (maxCols - row.count) * (baseHexWidth + gap) / 2;
      const y = rowIndex * (baseHexHeight * 0.75 + gap);
      for (let ci = 0; ci < row.count; ci++) {
        const x   = offset + ci * (baseHexWidth + gap);
        const idx = row.startIndex + ci;
        const xc = x + baseHexWidth / 2;
        const yc = y + baseHexHeight / 2;
        const petalDx = cx - xc;
        const petalDy = cy - yc;
        const petalRot = Math.max(-16, Math.min(16, (xc - cx) / (totalW / 2) * 16));
        cardPositions[idx] = {
          x, y, w: baseHexWidth, h: baseHexHeight,
          xc, yc, row: rowIndex, col: ci,
          petalDx, petalDy, petalRot,
        };
      }
    });

    computeBloomRings(totalW, totalH);

    cards.forEach((card, idx) => {
      const pos = cardPositions[idx];
      if (!pos || !card.element) return;
      card.element.style.width  = `${pos.w}px`;
      card.element.style.height = `${pos.h}px`;
      card.element.style.left   = `${pos.x}px`;
      card.element.style.top    = `${pos.y}px`;
      card.element.style.opacity = '0';
      card.element.style.setProperty('--push-x', '0px');
      card.element.style.setProperty('--push-y', '0px');

      // Pre-bloom pose: card sits at the center bud, scaled down and
      // slightly rotated — the "closed petal" state before it opens.
      if (window.gsap) {
        window.gsap.set(card.element, {
          x: pos.petalDx,
          y: pos.petalDy,
          scale: 0.15,
          rotation: pos.petalRot,
          opacity: 0,
        });
      } else {
        card.element.style.transform = `translate(${pos.petalDx}px, ${pos.petalDy}px) scale(0.15) rotate(${pos.petalRot}deg)`;
      }
    });
  }

  function computeBloomRings(totalW, totalH) {
    cardRings = new Array(IMAGES.length).fill(0);
    const cx = totalW / 2;
    const cy = totalH / 2;
    const distances = IMAGES.map((_, idx) => {
      const pos = cardPositions[idx];
      if (!pos) return 0;
      const dx = pos.xc - cx;
      const dy = pos.yc - cy;
      return Math.sqrt(dx * dx + dy * dy);
    });
    const max = Math.max(...distances, 1);
    const ringCount = 4;
    distances.forEach((d, idx) => {
      cardRings[idx] = Math.min(ringCount - 1, Math.floor((d / max) * ringCount));
    });
  }

  // ==========================================
  // NEIGHBOUR PUSH — translate-only, via CSS vars on .hex-push.
  // Never touches .hex-card's transform (owned by GSAP) or
  // .hex-inner's transform (owned by :hover scale).
  // ==========================================
  function applyNeighborPush(hoveredIdx) {
    const hoveredPos = cardPositions[hoveredIdx];
    if (!hoveredPos) return;
    cards.forEach((card, j) => {
      const pos = cardPositions[j];
      if (!pos || !card.element) return;
      if (j === hoveredIdx) {
        card.element.style.zIndex = '10';
        return;
      }
      const dx = pos.xc - hoveredPos.xc;
      const dy = pos.yc - hoveredPos.yc;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1.45 * baseHexWidth) {
        let tx = 0, ty = 0;
        if      (dy < -0.3 * baseHexHeight) ty = -12;
        else if (dy >  0.3 * baseHexHeight) ty =  12;
        else if (dx < -0.3 * baseHexWidth)  tx = -12;
        else if (dx >  0.3 * baseHexWidth)  tx =  12;
        card.element.style.setProperty('--push-x', `${tx}px`);
        card.element.style.setProperty('--push-y', `${ty}px`);
        card.element.style.zIndex = '2';
      } else {
        card.element.style.setProperty('--push-x', '0px');
        card.element.style.setProperty('--push-y', '0px');
        card.element.style.zIndex = '1';
      }
    });
  }

  function resetNeighborPush() {
    cards.forEach((card) => {
      if (!card.element) return;
      card.element.style.setProperty('--push-x', '0px');
      card.element.style.setProperty('--push-y', '0px');
      card.element.style.zIndex = '1';
    });
  }

  // ==========================================
  // SCROLL-DRIVEN GSAP ANIMATION — petal bloom in, scramble out
  // ==========================================
  function initScrollAnimation() {
    const missing = findMissingIds();
    if (missing.length) {
      if (initRetryCount < 1) {
        initRetryCount++;
        console.warn('[Gallery] Missing elements on first pass, retrying once in 300ms:', missing);
        setTimeout(initScrollAnimation, 300);
        return;
      }
      console.error('[Gallery] Required elements still missing after retry — animation will NOT run. Check your HTML for these exact ids:', missing);
      simpleFallbackReveal();
      return;
    }

    if (!window.gsap || !window.ScrollTrigger) {
      console.warn('[Gallery] GSAP/ScrollTrigger not loaded — falling back to simple reveal');
      simpleFallbackReveal();
      return;
    }

    const gsap = window.gsap;
    gsap.registerPlugin(window.ScrollTrigger);

    if (gsapCtx) { gsapCtx.revert(); gsapCtx = null; }
    window.ScrollTrigger.getAll()
      .filter(t => t.vars && t.vars.id && t.vars.id.startsWith('gallery'))
      .forEach(t => t.kill());

    const outer = document.getElementById('gallerySectionOuter');
    const ringCount = 4;

    // ── Responsive scroll multiplier (Tuned to absolute lowest bounds) ──
    const vw = window.innerWidth;
    let scrollMultiplier;
    if (vw < 768) {
      scrollMultiplier = 1.5;
    } else if (vw < 1024) {
      scrollMultiplier = 2.0;
    } else {
      scrollMultiplier = 2.5;
    }
    const scrollRoom = window.innerHeight * scrollMultiplier;
    const outerHeight = window.innerHeight + (0.60 * scrollRoom);
    outer.style.height = `${outerHeight}px`;

    // Portal box geometry
    const boxW = Math.min(340, window.innerWidth * 0.88);
    const boxH = Math.min(220, window.innerHeight * 0.5);
    const insetX = (window.innerWidth - boxW) / 2;
    const insetY = (window.innerHeight - boxH) / 2;
    const stickyEl = document.getElementById('galleryStickyEl');
    const lineEl   = document.getElementById('galleryBlackOverlay');

    gsap.set(stickyEl, { clipPath: `inset(${insetY}px ${insetX}px ${insetY}px ${insetX}px)`, borderColor: '#000' });
    lineEl.style.height = `${insetY}px`;

    gsapCtx = gsap.context(() => {

      const tl = gsap.timeline({
        scrollTrigger: {
          id: 'gallery-main',
          trigger: '#gallerySectionOuter',
          start: 'top top',
          end: `+=${scrollRoom}`,
          pin: '#galleryStickyEl',
          pinSpacing: false, // Allows native overlap!
          scrub: 0.6,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        }
      });

      // ── Phase 0: Vertical line drops instantly (0–0.01) ────────────────
      tl.fromTo('#galleryBlackOverlay',
        { scaleY: 0 },
        { scaleY: 1, duration: 0.01, ease: 'none' },
        0
      );

      // ── Phase 1: The box (strip) expands instantly (0.01–0.04) ──────────
      tl.fromTo(stickyEl,
        { clipPath: `inset(${insetY}px ${insetX}px ${insetY}px ${insetX}px)` },
        { clipPath: 'inset(0px 0px 0px 0px)', duration: 0.03, ease: 'power2.inOut' },
        0.01
      );
      tl.to(stickyEl, {
        borderColor: 'rgba(0,0,0,0)',
        duration: 0.02,
        ease: 'none',
      }, 0.02);

      // ── Phase 2: Title reveals instantly (0.01–0.03) ───────────────────
      tl.fromTo('#galleryTitle',
        { opacity: 0, y: 40 },
        { opacity: 1, y: 0, duration: 0.02, ease: 'power2.out' },
        0.01
      );

      // ── Phase 3: Honeycomb bloom starts immediately (0.03–0.35) ────────
      const bloomStart = 0.03;
      const bloomEnd   = 0.35;
      const ringSlot   = (bloomEnd - bloomStart) / ringCount;

      for (let ring = 0; ring < ringCount; ring++) {
        const ringStart = bloomStart + ring * ringSlot;
        const ringCardObjs = cards
          .map((c, idx) => ({ c, idx }))
          .filter(({ idx }) => cardRings[idx] === ring);

        ringCardObjs.forEach(({ c, idx }) => {
          const pos = cardPositions[idx];
          if (!pos || !c.element) return;
          tl.to(c.element, {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            opacity: 1,
            duration: ringSlot * 0.85,
            ease: 'back.out(1.5)',
          }, ringStart + Math.random() * ringSlot * 0.15);
        });
      }

      // ── Phase 4 (35–60%): Fully bloomed hold ────────────────────────

      // ── Phase 5 (60–100%): Scramble ─────────────────────────────────
      const scrambleStart = 0.60;
      const scrambleEnd   = 1.0;
      const scrambleSpan  = scrambleEnd - scrambleStart;

      cards.forEach((c) => {
        if (!c.element) return;
        const angle = Math.random() * Math.PI * 2;
        const dist  = 500 + Math.random() * 600;
        tl.to(c.element, {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          rotation: (Math.random() - 0.5) * 480,
          scale: 0.2,
          opacity: 0,
          duration: scrambleSpan * 0.75,
          ease: 'power1.in',
        }, scrambleStart + Math.random() * scrambleSpan * 0.3);
      });

      tl.to('#galleryTitle', {
        opacity: 0, y: -50, duration: scrambleSpan * 0.55, ease: 'power2.in',
      }, scrambleStart);

      tl.to(stickyEl, {
        y: -scrambleSpan * scrollRoom,
        duration: scrambleSpan,
        ease: 'none', // Matches natural scroll velocity
      }, scrambleStart);

      tl.to('#galleryBlackOverlay', {
        scaleY: 0, duration: scrambleSpan * 0.3, ease: 'none',
      }, scrambleStart + scrambleSpan * 0.6);

    });
  }

  // ==========================================
  // SIMPLE FALLBACK (no GSAP, or elements missing)
  // ==========================================
  function simpleFallbackReveal() {
    const target = document.getElementById('galleryStickyEl');
    if (!target) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        const titleEl = document.getElementById('galleryTitle');
        if (titleEl) { titleEl.style.transition = 'opacity 0.8s ease, transform 0.8s ease'; titleEl.style.opacity = '1'; titleEl.style.transform = 'translateY(0)'; }
        cards.forEach((card, idx) => {
          if (!card.element) return;
          const delay = cardRings[idx] * 130;
          setTimeout(() => {
            card.element.style.transition = 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.34,1.56,0.64,1)';
            card.element.style.opacity   = '1';
            card.element.style.transform = 'scale(1) rotate(0deg)';
          }, delay);
        });
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    observer.observe(target);
  }

  // ==========================================
  // PRELOAD IMAGES
  // ==========================================
  function preloadImage(url) {
    if (!url) return;
    const img = new Image(); img.src = url;
  }

  // ==========================================
  // LIGHTBOX — FLIP MORPH OPEN
  // ==========================================
  function openLightbox(index) {
    if (lightboxOpen) return;
    lightboxOpen = true;
    activeLightboxIndex = index;
    lastFocusedElement = document.activeElement;

    preloadImage(IMAGES[(index + 1) % IMAGES.length]);
    preloadImage(IMAGES[(index - 1 + IMAGES.length) % IMAGES.length]);

    const card = cards[index];
    if (!card || !card.element) return;
    const originalInner = card.element.querySelector('.hex-inner');
    if (!originalInner) return;
    const originalRect = originalInner.getBoundingClientRect();

    const clone = buildClone(originalRect, IMAGES[index]);
    const innerClone = clone.querySelector('div');
    innerClone.style.clipPath     = 'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)';
    innerClone.style.borderRadius = '0px';
    document.body.appendChild(clone);

    card.element.style.opacity = '0';
    if (overlay) overlay.classList.add('active');

    if (captionTitle) captionTitle.textContent = `MOMENT ${String(index + 1).padStart(2, '0')}`;
    if (captionSub)   captionSub.textContent   = 'PEC Hacks 4.0 · Event Archive';
    if (caption) { caption.style.opacity = '0'; caption.style.transform = 'translate(-50%,20px)'; }

    if (lightboxImageContainer) {
      const targetRect = lightboxImageContainer.getBoundingClientRect();

      clone.offsetHeight;

      clone.style.transition = 'all 0.6s cubic-bezier(0.16,1,0.3,1)';
      clone.style.top    = `${targetRect.top}px`;
      clone.style.left   = `${targetRect.left}px`;
      clone.style.width  = `${targetRect.width}px`;
      clone.style.height = `${targetRect.height}px`;

      innerClone.style.transition  = 'all 0.6s cubic-bezier(0.16,1,0.3,1)';
      innerClone.style.clipPath     = 'polygon(0 0,100% 0,100% 100%,0 100%)';
      innerClone.style.borderRadius = '17px';

      const imgClone = clone.querySelector('img');
      imgClone.style.transition = 'all 0.6s cubic-bezier(0.16,1,0.3,1)';
      imgClone.style.objectFit  = 'contain';
    }

    setTimeout(() => {
      if (lightboxFrame) {
        lightboxFrame.innerHTML = '';
        const mainImg = document.createElement('img');
        mainImg.src = IMAGES[index];
        mainImg.className = 'lightbox-img active';
        lightboxFrame.appendChild(mainImg);
      }
      if (caption) { caption.style.opacity = '1'; caption.style.transform = 'translate(-50%,0)'; }
      if (clone.parentNode) clone.parentNode.removeChild(clone);
    }, 640);
  }

  // ==========================================
  // LIGHTBOX — IMAGE CHANGE (crossfade), driven by scroll/wheel
  // ==========================================
  function changeLightboxImage(newIndex) {
    if (newIndex < 0 || newIndex >= IMAGES.length) return;

    const oldCard = cards[activeLightboxIndex];
    if (oldCard && oldCard.element) oldCard.element.style.opacity = '1';

    activeLightboxIndex = newIndex;

    const newCard = cards[newIndex];
    if (newCard && newCard.element) newCard.element.style.opacity = '0';

    preloadImage(IMAGES[(newIndex + 1) % IMAGES.length]);
    preloadImage(IMAGES[(newIndex - 1 + IMAGES.length) % IMAGES.length]);

    if (caption) { caption.style.opacity = '0'; caption.style.transform = 'translate(-50%,10px)'; }
    setTimeout(() => {
      if (captionTitle) captionTitle.textContent = `MOMENT ${String(newIndex + 1).padStart(2, '0')}`;
      if (caption)      { caption.style.opacity = '1'; caption.style.transform = 'translate(-50%,0)'; }
    }, 200);

    if (lightboxFrame) {
      const oldImg = lightboxFrame.querySelector('.lightbox-img.active');
      const newImg = document.createElement('img');
      newImg.src = IMAGES[newIndex];
      newImg.className = 'lightbox-img';
      lightboxFrame.appendChild(newImg);
      newImg.offsetHeight;
      newImg.classList.add('active');
      if (oldImg) {
        oldImg.classList.remove('active');
        setTimeout(() => { if (oldImg.parentNode) oldImg.parentNode.removeChild(oldImg); }, 420);
      }
    }
  }

  // ==========================================
  // LIGHTBOX — FLIP MORPH CLOSE
  // ==========================================
  function closeLightbox() {
    if (!lightboxOpen) return;
    lightboxOpen = false;
    if (overlay) overlay.classList.remove('active');

    const activeCard = cards[activeLightboxIndex];
    if (!activeCard || !activeCard.element || !lightboxImageContainer) return;

    const innerEl = activeCard.element.querySelector('.hex-inner');
    if (!innerEl) return;

    const targetRect    = innerEl.getBoundingClientRect();
    const containerRect = lightboxImageContainer.getBoundingClientRect();

    const clone = buildClone(containerRect, IMAGES[activeLightboxIndex]);
    const innerClone = clone.querySelector('div');
    innerClone.style.clipPath     = 'polygon(0 0,100% 0,100% 100%,0 100%)';
    innerClone.style.borderRadius = '17px';
    const imgClone = clone.querySelector('img');
    imgClone.style.objectFit = 'contain';
    document.body.appendChild(clone);

    if (lightboxFrame) lightboxFrame.innerHTML = '';
    clone.offsetHeight;

    clone.style.transition = 'all 0.6s cubic-bezier(0.16,1,0.3,1)';
    clone.style.top    = `${targetRect.top}px`;
    clone.style.left   = `${targetRect.left}px`;
    clone.style.width  = `${targetRect.width}px`;
    clone.style.height = `${targetRect.height}px`;

    innerClone.style.transition  = 'all 0.6s cubic-bezier(0.16,1,0.3,1)';
    innerClone.style.clipPath     = 'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)';
    innerClone.style.borderRadius = '0px';

    imgClone.style.transition = 'all 0.6s cubic-bezier(0.16,1,0.3,1)';
    imgClone.style.objectFit  = 'cover';

    setTimeout(() => {
      if (activeCard.element) activeCard.element.style.opacity = '1';
      if (clone.parentNode) clone.parentNode.removeChild(clone);
      if (lastFocusedElement) lastFocusedElement.focus();
    }, 640);
  }

  // ==========================================
  // FLIP CLONE HELPER
  // ==========================================
  function buildClone(rect, imgSrc) {
    const clone = document.createElement('div');
    clone.style.cssText = [
      `position:fixed`,
      `top:${rect.top}px`,
      `left:${rect.left}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      `margin:0`,
      `z-index:999999`,
      `pointer-events:none`,
    ].join(';');
    const inner = document.createElement('div');
    inner.style.cssText = 'width:100%;height:100%;overflow:hidden;box-sizing:border-box;background:rgba(255,255,255,0.04);';
    const img = document.createElement('img');
    img.src = imgSrc;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    inner.appendChild(img);
    clone.appendChild(inner);
    return clone;
  }

  // ==========================================
  // LIGHTBOX EVENTS
  // Click anywhere closes it (no close button). Scrolling while open
  // advances to the next/previous photo instead of scrolling the page.
  // ==========================================
  function setupLightboxEvents() {
    overlay = document.getElementById('lightboxOverlay');
    if (!overlay) { console.error('[Gallery] Missing #lightboxOverlay'); return; }

    lightboxImageContainer = document.createElement('div');
    lightboxImageContainer.className = 'lightbox-image-container';

    const glow = document.createElement('div');
    glow.className = 'lightbox-glow';
    const glowGradient = document.createElement('div');
    glowGradient.className = 'lightbox-glow-gradient';
    glow.appendChild(glowGradient);

    lightboxFrame = document.createElement('div');
    lightboxFrame.className = 'lightbox-frame';

    lightboxImageContainer.appendChild(glow);
    lightboxImageContainer.appendChild(lightboxFrame);

    if (caption) overlay.insertBefore(lightboxImageContainer, caption);
    else overlay.appendChild(lightboxImageContainer);

    overlay.addEventListener('click', closeLightbox);

    overlay.addEventListener('wheel', (e) => {
      if (!lightboxOpen) return;
      e.preventDefault();
      if (wheelCooldown) return;
      wheelCooldown = true;
      setTimeout(() => { wheelCooldown = false; }, 450);
      if (e.deltaY > 0) changeLightboxImage((activeLightboxIndex + 1) % IMAGES.length);
      else              changeLightboxImage((activeLightboxIndex - 1 + IMAGES.length) % IMAGES.length);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (!lightboxOpen) return;
      if      (e.key === 'Escape')     closeLightbox();
      else if (e.key === 'ArrowRight') changeLightboxImage((activeLightboxIndex + 1) % IMAGES.length);
      else if (e.key === 'ArrowLeft')  changeLightboxImage((activeLightboxIndex - 1 + IMAGES.length) % IMAGES.length);
    });
  }

  // ==========================================
  // RESIZE HANDLER
  // ==========================================
  function handleResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      requestAnimationFrame(() => {
        calculateLayout();
        initScrollAnimation();
      });
    }, 280);
  }

  // ==========================================
  // INIT
  // ==========================================
  function init() {
    const missing = findMissingIds();
    if (missing.length) {
      console.error('[Gallery] Cannot init — missing element ids in your HTML:', missing,
        '. Double check your live page has the exact wrapper structure (gallerySectionOuter > galleryStickyEl > ... > hexRows).');
      return;
    }

    hexRows = document.getElementById('hexRows');
    overlay      = document.getElementById('lightboxOverlay');
    caption      = document.getElementById('lightboxCaption');
    captionTitle = document.getElementById('lightboxCaptionTitle');
    captionSub   = document.getElementById('lightboxCaptionSub');

    injectStyles();
    createGrid();
    calculateLayout();
    initScrollAnimation();
    setupLightboxEvents();

    window.addEventListener('resize', handleResize);

    if (document.fonts) {
      document.fonts.ready.then(() => {
        requestAnimationFrame(() => {
          calculateLayout();
          if (window.ScrollTrigger) {
            window.ScrollTrigger.refresh();
          }
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
