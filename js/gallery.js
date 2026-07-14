(function () {
    'use strict';

    // ==========================================
    // IMAGE ARRAY — 24 slots (4-5-6-5-4 honeycomb), cycling 20 source photos
    // ==========================================
    const SOURCE_PHOTO_COUNT = 20;
    const TOTAL_SLOTS = 24;

    const IMAGES = Array.from(
        { length: TOTAL_SLOTS },
        (_, i) => `assets/gallery/${(i % SOURCE_PHOTO_COUNT) + 1}.jpg`
    );

    // ==========================================
    // DOM VARIABLES (resolved in init)
    // ==========================================
    let hexRows = null;
    let overlay = null;
    let caption = null;
    let captionTitle = null;
    let captionSub = null;
    let lightboxImageContainer = null;
    let lightboxFrame = null;
    let lightboxImg = null;

    // ==========================================
    // STATE
    // ==========================================
    let cards = [];
    let lightboxOpen = false;
    let activeLightboxIndex = 0;
    let lastFocusedElement = null;
    let gsapCtx = null;
    let cachedLightboxContainerRect = null;
    let changeImageTimeout = null;

    const REQUIRED_IDS = ['gallerySectionOuter', 'galleryStickyEl', 'hexRows', 'galleryTitle', 'lightboxOverlay'];

    function findMissingIds() {
        return REQUIRED_IDS.filter(id => !document.getElementById(id));
    }

    // ==========================================
    // INITIALIZE GRID CARDS FROM STATIC HTML
    // ==========================================
    function initializeCards() {
        if (!hexRows) return;
        cards = [];

        const cardElements = hexRows.querySelectorAll('.hex-card');
        cardElements.forEach((cardEl, i) => {
            const push = cardEl.querySelector('.hex-push');
            const img = cardEl.querySelector('.hex-image');

            cards.push({
                element: cardEl,
                push,
                image: img,
                index: i
            });

            cardEl.addEventListener('click', () => openLightbox(i));
            cardEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(i); }
            });
        });
    }

    // ==========================================
    // LIGHTWEIGHT ANIMATION INITIALIZATION
    // ==========================================
    function initScrollAnimation() {
        const missing = findMissingIds();
        if (missing.length) {
            console.error('[Gallery] Required elements missing — animation will NOT run.', missing);
            return;
        }

        if (!window.gsap || !window.ScrollTrigger) {
            console.warn('[Gallery] GSAP/ScrollTrigger not loaded — revealing gallery instantly');
            cards.forEach(c => {
                if (c.element) {
                    c.element.style.opacity = '1';
                    c.element.style.transform = 'scale(1)';
                }
            });
            return;
        }

        const gsap = window.gsap;
        gsap.registerPlugin(window.ScrollTrigger);

        if (gsapCtx) { gsapCtx.revert(); gsapCtx = null; }
        window.ScrollTrigger.getAll()
            .filter(t => t.vars && t.vars.id && t.vars.id.startsWith('gallery'))
            .forEach(t => t.kill());

        const outer = document.getElementById('gallerySectionOuter');
        const stickyEl = document.getElementById('galleryStickyEl');

        gsapCtx = gsap.context(() => {
            try {
                const pinTrigger = ScrollTrigger.create({
                    id: 'gallery-pin',
                    trigger: stickyEl,
                    start: 'top top',
                    end: '+=140%',        // total pinned scroll distance (in viewport heights)
                    pin: true,
                    pinSpacing: true,
                    anticipatePin: 1,
                });

                // 2. Entrance bloom — plays once, early in the pin duration
                gsap.fromTo(cards.map(c => c.element), {
                    scale: 0.3, opacity: 0, y: 40
                }, {
                    scale: 1, opacity: 1, y: 0,
                    duration: 0.9,
                    ease: 'back.out(1.4)',
                    stagger: { each: 0.04, from: 'center' },
                    scrollTrigger: {
                        id: 'gallery-entrance',
                        trigger: stickyEl,
                        start: 'top top',
                        end: '+=30%',      // entrance consumes first ~30% of the pin — hold phase follows
                        scrub: 0.5,
                    }
                });

                // 3. Exit push — plays only in the LAST portion of the pin, after a clear static hold
                gsap.to(stickyEl, {
                    yPercent: -30,
                    scale: 0.94,
                    opacity: 0.35,
                    ease: 'none',
                    scrollTrigger: {
                        id: 'gallery-exit',
                        trigger: stickyEl,
                        start: 'top top+=-100%',   // starts at 100% into the pin (i.e. after hold)
                        end: 'top top+=-140%',     // ends exactly when pin releases
                        scrub: true,
                    }
                });

            } catch (err) {
                console.error('[Gallery Debug] EXCEPTION during pin setup:', err);
            }
        });
    }

    function preloadImage(url) {
        if (!url) return;
        const img = new Image();
        img.src = url;
    }

    // ==========================================
    // CACHE BOUNDING CLIENT RECTS
    // ==========================================
    function cacheCardRects() {
        let restoreOverlay = false;
        if (overlay && (overlay.style.visibility === 'hidden' || overlay.style.opacity === '0' || overlay.style.pointerEvents === 'none')) {
            overlay.style.visibility = 'visible';
            overlay.style.opacity = '0.001';
            overlay.style.pointerEvents = 'auto';
            overlay.style.display = 'flex';
            restoreOverlay = true;
        }

        cards.forEach((card) => {
            if (card.element) {
                const inner = card.element.querySelector('.hex-inner');
                if (inner) {
                    card.innerRect = inner.getBoundingClientRect();
                }
            }
        });
        if (lightboxImageContainer) {
            cachedLightboxContainerRect = lightboxImageContainer.getBoundingClientRect();
        }

        if (restoreOverlay && overlay) {
            overlay.style.visibility = 'hidden';
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
        }
    }

    // ==========================================
    // LIGHTBOX INITIALIZATION
    // ==========================================
    function initLightbox() {
        overlay = document.getElementById('lightboxOverlay');
        caption = document.getElementById('lightboxCaption');
        captionTitle = document.getElementById('lightboxCaptionTitle');
        captionSub = document.getElementById('lightboxCaptionSub');
        lightboxImageContainer = overlay.querySelector('.lightbox-image-container');
        lightboxFrame = overlay.querySelector('.lightbox-frame');
        lightboxImg = overlay.querySelector('.lightbox-img');

        cachedLightboxContainerRect = lightboxImageContainer.getBoundingClientRect();

        overlay.addEventListener('click', closeLightbox);

        window.addEventListener('keydown', (e) => {
            if (!lightboxOpen) return;
            if (e.key === 'Escape') closeLightbox();
            else if (e.key === 'ArrowRight') changeLightboxImage((activeLightboxIndex + 1) % IMAGES.length);
            else if (e.key === 'ArrowLeft') changeLightboxImage((activeLightboxIndex - 1 + IMAGES.length) % IMAGES.length);
        });
    }

    // ==========================================
    // LIGHTBOX OPEN
    // ==========================================
    async function openLightbox(index) {
        if (lightboxOpen) return;

        const card = cards[index];
        if (!card || !card.element) return;

        if (!card.innerRect || !cachedLightboxContainerRect || cachedLightboxContainerRect.width === 0) {
            cacheCardRects();
        }

        if (!card.innerRect || !cachedLightboxContainerRect || cachedLightboxContainerRect.width === 0) {
            console.error("[Gallery] Cannot open lightbox — invalid layout bounds");
            return;
        }

        const imgSrc = IMAGES[index];
        const tempImg = new Image();
        tempImg.src = imgSrc;
        try {
            await tempImg.decode();
        } catch (err) {
            console.warn("Decode failed before opening", err);
        }

        lightboxOpen = true;
        activeLightboxIndex = index;
        lastFocusedElement = document.activeElement;

        preloadImage(IMAGES[(index + 1) % IMAGES.length]);
        preloadImage(IMAGES[(index - 1 + IMAGES.length) % IMAGES.length]);

        const sourceRect = card.innerRect;
        const targetRect = cachedLightboxContainerRect;

        const sourceCX = sourceRect.left + sourceRect.width / 2;
        const sourceCY = sourceRect.top + sourceRect.height / 2;
        const targetCX = targetRect.left + targetRect.width / 2;
        const targetCY = targetRect.top + targetRect.height / 2;

        const deltaX = sourceCX - targetCX;
        const deltaY = sourceCY - targetCY;
        const scaleX = sourceRect.width / targetRect.width;
        const scaleY = sourceRect.height / targetRect.height;

        lightboxImg.src = imgSrc;
        if (captionTitle) captionTitle.textContent = `MOMENT ${String(index + 1).padStart(2, '0')}`;
        if (captionSub) captionSub.textContent = 'PEC Hacks 4.0 · Event Archive';

        window.gsap.set(lightboxImageContainer, {
            x: deltaX,
            y: deltaY,
            scaleX: scaleX,
            scaleY: scaleY,
            opacity: 0,
            transformOrigin: "center center"
        });

        window.gsap.set(lightboxImg, {
            scale: 0.94,
            opacity: 0
        });

        lightboxImageContainer.style.transition = 'none';
        lightboxImageContainer.style.clipPath = 'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)';
        lightboxImageContainer.style.borderRadius = '0px';

        card.element.style.opacity = '0';
        overlay.classList.add('active');

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.gsap.to(overlay, {
                    opacity: 1,
                    visibility: "visible",
                    pointerEvents: "auto",
                    duration: 0.28,
                    ease: "power3.out"
                });

                lightboxImageContainer.style.transition = 'clip-path 0.28s cubic-bezier(0.16,1,0.3,1), border-radius 0.28s cubic-bezier(0.16,1,0.3,1)';
                lightboxImageContainer.style.clipPath = 'polygon(0 0, 100% 0, 100% 100%, 0 100%)';
                lightboxImageContainer.style.borderRadius = '20px';

                window.gsap.to(lightboxImageContainer, {
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    opacity: 1,
                    duration: 0.28,
                    ease: "power3.out"
                });

                window.gsap.to(lightboxImg, {
                    scale: 1,
                    opacity: 1,
                    duration: 0.28,
                    ease: "power3.out"
                });

                window.gsap.fromTo(caption, {
                    opacity: 0,
                    y: 20
                }, {
                    opacity: 1,
                    y: 0,
                    duration: 0.28,
                    ease: "power3.out"
                });
            });
        });
    }

    // ==========================================
    // LIGHTBOX IMAGE CHANGE
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

        if (caption) {
            caption.style.opacity = '0';
            caption.style.transform = 'translate(-50%,10px)';
        }

        if (changeImageTimeout) clearTimeout(changeImageTimeout);
        changeImageTimeout = setTimeout(() => {
            if (captionTitle) captionTitle.textContent = `MOMENT ${String(newIndex + 1).padStart(2, '0')}`;
            if (caption) {
                caption.style.opacity = '1';
                caption.style.transform = 'translate(-50%,0)';
            }
        }, 200);

        if (lightboxFrame && lightboxImg) {
            lightboxImg.classList.remove('active');

            const onFadeOut = () => {
                lightboxImg.removeEventListener('transitionend', onFadeOut);
                lightboxImg.src = IMAGES[newIndex];

                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        lightboxImg.classList.add('active');
                    });
                });
            };
            lightboxImg.addEventListener('transitionend', onFadeOut);
        }
    }

    // ==========================================
    // LIGHTBOX CLOSE
    // ==========================================
    function closeLightbox() {
        if (!lightboxOpen) return;
        lightboxOpen = false;
        overlay.classList.remove('active');

        const activeCard = cards[activeLightboxIndex];
        if (!activeCard || !activeCard.element || !activeCard.innerRect || !cachedLightboxContainerRect) return;

        const sourceRect = activeCard.innerRect;
        const targetRect = cachedLightboxContainerRect;

        const sourceCX = sourceRect.left + sourceRect.width / 2;
        const sourceCY = sourceRect.top + sourceRect.height / 2;
        const targetCX = targetRect.left + targetRect.width / 2;
        const targetCY = targetRect.top + targetRect.height / 2;

        const deltaX = sourceCX - targetCX;
        const deltaY = sourceCY - targetCY;
        const scaleX = sourceRect.width / targetRect.width;
        const scaleY = sourceRect.height / targetRect.height;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.gsap.to(overlay, {
                    opacity: 0,
                    visibility: "hidden",
                    pointerEvents: "none",
                    duration: 0.24,
                    ease: "power3.out"
                });

                lightboxImageContainer.style.transition = 'clip-path 0.24s cubic-bezier(0.16,1,0.3,1), border-radius 0.24s cubic-bezier(0.16,1,0.3,1)';
                lightboxImageContainer.style.clipPath = 'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)';
                lightboxImageContainer.style.borderRadius = '0px';

                window.gsap.to(lightboxImageContainer, {
                    x: deltaX,
                    y: deltaY,
                    scaleX: scaleX,
                    scaleY: scaleY,
                    opacity: 0,
                    duration: 0.24,
                    ease: "power3.out",
                    onComplete: () => {
                        if (activeCard.element) activeCard.element.style.opacity = '1';
                        window.gsap.set(lightboxImageContainer, { clearProps: "all" });
                        window.gsap.set(lightboxImg, { clearProps: "all" });
                        if (lastFocusedElement) lastFocusedElement.focus();
                    }
                });

                window.gsap.to(lightboxImg, {
                    scale: 0.96,
                    opacity: 0,
                    duration: 0.24,
                    ease: "power3.out"
                });

                window.gsap.to(caption, {
                    opacity: 0,
                    y: 20,
                    duration: 0.24,
                    ease: "power3.out"
                });
            });
        });
    }

    // ==========================================
    // INIT
    // ==========================================
    function init() {
        const missing = findMissingIds();
        if (missing.length) {
            console.error('[Gallery] Cannot init — missing element ids in your HTML:', missing);
            return;
        }

        hexRows = document.getElementById('hexRows');

        initializeCards();
        initLightbox();

        function startWhenReady() {
            if (window.__gsapReady || (window.gsap && window.ScrollTrigger)) {
                initScrollAnimation();
            } else {
                window.addEventListener('gsap-ready', initScrollAnimation, { once: true });
            }
        }
        startWhenReady();
        cacheCardRects();

        if (window.ScrollTrigger) {
            window.ScrollTrigger.addEventListener('refresh', cacheCardRects);
        }

        if (document.fonts) {
            document.fonts.ready.then(() => {
                requestAnimationFrame(() => {
                    cacheCardRects();
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
