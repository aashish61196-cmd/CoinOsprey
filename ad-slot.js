/* ==========================================================================
   PART 9A — PUBLIC AD SLOT COMPONENT
   ==========================================================================
   Reusable, framework-free "AdSlot" for the public CoinOsprey site.

   This file owns ONLY:
     - reading a slot's placement/page/targeting context from its markup
     - calling the existing Part 8 delivery engine
       (GET /api/advertisements/deliver — see
       backend/controllers/advertisementController.js#deliver)
     - rendering the single ad it gets back (or safely doing nothing)

   It deliberately does NOT decide which ad is eligible — that decision is
   made entirely server-side by advertisementDeliveryService.getAdvertisement()
   / getEligibleAdvertisements(). No advertiser/campaign/date/page checks
   live in this file; see PART 9A spec item 4.

   Usage — drop this anywhere in the page body:

     <div class="co-ad-slot"
          data-ad-slot
          data-placement="leaderboard"
          data-page="news"></div>

     <script src="/ad-slot.js"></script>

   Optional attributes:
     data-category-id="..."   (page="category")
     data-article-id="..."    (page="article", if known up front)
     data-class="extra-css-class"
     data-preview="true"      (PART 10A: admin/testing render — the ad
                               still displays, but no impression or click
                               is ever recorded for it, see spec item 8)

   PART 10A — analytics tracking: once an ad has actually rendered and
   become visible, this file reports an impression to
   POST /api/advertisements/impression, and its click link routes through
   GET /api/advertisements/click/:id (which records the click, then
   redirects to the advertiser's destination) rather than linking to the
   destination directly. Both are best-effort and never block or break
   rendering — see sendTrackingEvent().

   The component auto-initializes every [data-ad-slot] element on
   DOMContentLoaded (and immediately if the DOM is already ready), and
   re-evaluates every slot when the viewport crosses a device breakpoint
   (desktop/tablet/mobile), so a slot never keeps showing a
   desktop-only creative on a phone or vice versa.

   Public API (window.CoinOspreyAds):
     init(root)              - (re)scan `root` (defaults to document) for
                                [data-ad-slot] elements and render each.
     render(container)       - render (or re-render) a single slot element.
     refresh(container, ctx) - merge extra data-* context (e.g. an
                                articleId that only becomes known after an
                                existing page's own fetch resolves) and
                                re-render. Never touches any other page
                                logic — safe to call from anywhere.
   ========================================================================== */
(function () {
  'use strict';

  var API_BASE = '/api';

  // Known recommended dimensions per placement (mirrors
  // backend/models/AdPlacement.js DEFAULT_PLACEMENTS) — used ONLY to
  // reserve the right amount of layout space up front (spec item 12,
  // avoid CLS). This is a rendering hint, not an eligibility rule: the
  // delivery engine remains the single source of truth for which ad (and
  // which creative asset) is actually chosen.
  var PLACEMENT_DIMENSIONS = {
    'top-banner': { desktop: [970, 250] },
    'leaderboard': { desktop: [728, 90] },
    'sidebar': { desktop: [300, 250] },
    'mobile-banner': { mobile: [320, 100] }
    // homepage-feature / sponsored-article / in-article / bottom-article /
    // newsletter are intentionally responsive/variable — no fixed
    // reservation, so no entry here (falls through to "no reservation").
  };

  // ------------------------------------------------------------------
  // PART 10A — analytics tracking (impressions + clicks)
  // ------------------------------------------------------------------
  // Opaque, one-shot ids used ONLY to dedupe a single render/click event
  // against accidental repeats (a React-style double-init, a browser
  // retrying a POST, a double-click). Never stored, never reused across
  // renders, never tied to a visitor — regenerated every render() call.
  function genEventId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Fire-and-forget POST that must never affect ad rendering (spec item
  // 18): sendBeacon when available (survives the page/tab going away,
  // which matters for the click case), fetch(keepalive) otherwise.
  // Every failure is swallowed — a tracking miss must never surface as a
  // visible error on the public site.
  function sendTrackingEvent(path, payload) {
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        var ok = navigator.sendBeacon(API_BASE + path, blob);
        if (ok) return;
      }
      fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (err) {
      // no-op — analytics must never throw into the caller
    }
  }

  function isPreview(container) {
    var attr = container.getAttribute('data-preview');
    return attr === 'true' || attr === '1';
  }

  function trackingContext(container, ad, device) {
    return {
      advertisementId: ad.id,
      placementId: ad.placementId,
      page: container.getAttribute('data-page') || '',
      language: detectLanguage(),
      device: device,
      preview: isPreview(container)
    };
  }

  // Fires an impression exactly once per rendered ad, and only once the
  // ad has actually become meaningfully visible — never merely because
  // it exists in the delivery response, and never during admin preview
  // (spec items 2, 3, 8). Falls back to "fires once the <img> has
  // loaded" when IntersectionObserver isn't available, rather than
  // over-engineering viewport tracking the rest of this file doesn't
  // otherwise need (spec item 3).
  function armImpressionTracking(container, img, ad, device) {
    if (isPreview(container)) return; // admin preview never counts (spec item 8)
    if (!ad.id) return; // house/fallback ads have no Advertisement record to attribute analytics to

    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      var ctx = trackingContext(container, ad, device);
      ctx.eventId = genEventId();
      sendTrackingEvent('/advertisements/impression', ctx);
    }

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            fire();
            observer.disconnect();
          }
        });
      }, { threshold: [0, 0.5, 1] });
      observer.observe(img);
      // Belt-and-braces: an <img> that's already loaded and in view by
      // the time the observer attaches may not get an initial callback
      // in every browser — a normal 'load' fallback covers that case
      // too, still gated by the same `fired` flag so it's never double
      // counted.
      if (img.complete && img.naturalWidth > 0) fire();
    } else {
      img.addEventListener('load', fire);
    }
  }

  // Clicks are tracked via the server-side redirect endpoint
  // (GET /api/advertisements/click/:id) rather than a client-fired
  // beacon: the browser navigating to that URL is itself what records
  // the click, so it works even without JS still running by the time the
  // visitor clicks (spec item 5 — "use the existing tracking-redirect
  // architecture" once one exists; this file is what defines it).
  function buildClickHref(container, ad, device) {
    // Preview, and house/fallback ads (no Advertisement record to
    // attribute a click to), link straight to the destination — nothing
    // to validate/track for either case.
    if (isPreview(container) || !ad.id) return ad.destinationUrl || '#';

    var params = new URLSearchParams();
    if (ad.placementId) params.set('placementId', ad.placementId);
    var page = container.getAttribute('data-page');
    if (page) params.set('page', page);
    params.set('language', detectLanguage());
    params.set('device', device);
    params.set('eventId', genEventId());
    return API_BASE + '/advertisements/click/' + encodeURIComponent(ad.id) + '?' + params.toString();
  }

  function detectDevice() {
    var w = window.innerWidth || document.documentElement.clientWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  // Matches the language-detection convention article.html's own Part 2
  // script already uses (leading /hi/ path segment = Hindi), so this
  // component never disagrees with the page it's sitting on.
  function detectLanguage() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'hi') return 'hi';
    var params = new URLSearchParams(window.location.search);
    return params.get('language') === 'hi' ? 'hi' : 'en';
  }

  function collapse(container) {
    container.innerHTML = '';
    container.style.removeProperty('min-height');
    container.style.removeProperty('aspect-ratio');
    container.classList.remove('co-ad-slot--reserved');
    container.style.display = 'none';
    container.removeAttribute('data-ad-rendered');
  }

  function reserveSpace(container, placementKey, device) {
    var entry = PLACEMENT_DIMENSIONS[placementKey];
    if (!entry) return;
    var dims = device === 'mobile' ? (entry.mobile || entry.desktop) : (entry.desktop || entry.mobile);
    if (!dims) return;
    container.style.aspectRatio = dims[0] + ' / ' + dims[1];
    container.style.maxWidth = dims[0] + 'px';
    container.classList.add('co-ad-slot--reserved');
  }

  function paint(container, result, device) {
    var ad = result && result.advertisement;
    var creative = ad && ad.creative;
    if (!result || result.status !== 'served' || !ad || !creative) {
      collapse(container);
      return;
    }

    // Prefer the device-appropriate asset; fall back to whichever asset
    // actually exists (mirrors the "mobile optional" contract already
    // documented on AdCreative.mobile).
    var asset = (device === 'mobile' && creative.mobile && creative.mobile.fileUrl)
      ? creative.mobile
      : (creative.desktop && creative.desktop.fileUrl ? creative.desktop : creative.mobile);

    if (!asset || !asset.fileUrl) {
      // Invalid/incomplete creative — never render a broken box (spec item 7).
      collapse(container);
      return;
    }

    container.innerHTML = '';
    container.style.display = '';
    container.style.removeProperty('aspect-ratio');
    container.setAttribute('data-ad-rendered', ad.type || 'paid');

    var link = document.createElement('a');
    link.className = 'co-ad-slot__link';
    link.href = buildClickHref(container, ad, device); // tracking-redirect URL, or the raw destination in preview/house-ad cases
    if (ad.openInNewTab !== false) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer sponsored';
    }

    var img = document.createElement('img');
    img.className = 'co-ad-slot__img';
    img.src = asset.fileUrl; // from the delivery response, never a hardcoded advertiser URL
    img.alt = creative.altText || 'Advertisement';
    img.loading = 'lazy';
    img.decoding = 'async';
    if (asset.width) img.width = asset.width;
    if (asset.height) img.height = asset.height;
    // If the creative URL turns out to be dead, fail safe rather than
    // show a broken-image icon (spec item 7).
    img.addEventListener('error', function () { collapse(container); });

    link.appendChild(img);

    var label = document.createElement('span');
    label.className = 'co-ad-slot__label';
    label.textContent = 'Advertisement';

    container.appendChild(label);
    container.appendChild(link);

    // Only now — after the ad has actually been placed in the DOM as a
    // real, painted element — does it become eligible to count as an
    // impression (spec items 2-3). Never armed during initialization,
    // SSR, or before this point.
    armImpressionTracking(container, img, ad, device);
  }

  function buildParams(container, device) {
    var params = new URLSearchParams();
    params.set('placement', container.getAttribute('data-placement') || '');
    var page = container.getAttribute('data-page');
    if (page) params.set('page', page);
    var categoryId = container.getAttribute('data-category-id');
    if (categoryId) params.set('categoryId', categoryId);
    var articleId = container.getAttribute('data-article-id');
    if (articleId) params.set('articleId', articleId);
    params.set('language', detectLanguage());
    params.set('device', device);
    params.set('url', window.location.pathname);
    return params;
  }

  // Prevents duplicate/overlapping requests for the same slot element —
  // re-renders, resize-triggered re-evaluations, and rapid re-inits (spec
  // item 11) all cancel any still-in-flight request for that same
  // container before starting a new one.
  var inFlightControllers = new WeakMap();

  function render(container) {
    if (!container || !container.getAttribute) return;
    var placement = container.getAttribute('data-placement');
    if (!placement) return; // misconfigured slot — do nothing rather than guess

    var device = detectDevice();
    reserveSpace(container, placement, device);

    var previous = inFlightControllers.get(container);
    if (previous) previous.abort();
    var controller = ('AbortController' in window) ? new AbortController() : null;
    if (controller) inFlightControllers.set(container, controller);

    var url = API_BASE + '/advertisements/deliver?' + buildParams(container, device).toString();

    fetch(url, controller ? { signal: controller.signal } : {})
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (result) { paint(container, result, device); })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        // Delivery failure must never break the page (spec item 15) —
        // degrade to "no ad" exactly like an empty eligibility result.
        collapse(container);
      });
  }

  function init(root) {
    var scope = (root && root.querySelectorAll) ? root : document;
    var slots = scope.querySelectorAll('[data-ad-slot]');
    for (var i = 0; i < slots.length; i++) render(slots[i]);
  }

  // Lets a page merge in context it only learns after its own existing
  // fetch/render logic resolves (e.g. an article's id), without this file
  // ever needing to know how that page loads its data.
  function refresh(container, extraAttrs) {
    if (!container) return;
    if (extraAttrs) {
      Object.keys(extraAttrs).forEach(function (key) {
        var value = extraAttrs[key];
        if (value === null || value === undefined || value === '') {
          container.removeAttribute('data-' + key);
        } else {
          container.setAttribute('data-' + key, value);
        }
      });
    }
    render(container);
  }

  function injectStyles() {
    if (document.getElementById('co-ad-slot-styles')) return;
    var style = document.createElement('style');
    style.id = 'co-ad-slot-styles';
    style.textContent =
      '.co-ad-slot{width:100%;max-width:100%;box-sizing:border-box;margin:24px auto;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'overflow:hidden;}' +
      '.co-ad-slot--reserved{margin:24px auto;}' +
      '.co-ad-slot__label{display:block;font-size:10px;font-weight:600;letter-spacing:.06em;' +
      'text-transform:uppercase;color:var(--co-gray-500,#8892a6);margin-bottom:6px;' +
      'text-align:center;width:100%;}' +
      '.co-ad-slot__link{display:block;max-width:100%;line-height:0;}' +
      '.co-ad-slot__img{display:block;width:auto;max-width:100%;height:auto;margin:0 auto;' +
      'border-radius:var(--co-radius-sm,4px);}';
    document.head.appendChild(style);
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      var args = arguments;
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  var lastDevice = detectDevice();
  var onResize = debounce(function () {
    var device = detectDevice();
    if (device !== lastDevice) {
      lastDevice = device;
      init(document); // breakpoint crossed — re-evaluate every slot's device targeting
    }
  }, 250);

  function boot() {
    injectStyles();
    init(document);
    window.addEventListener('resize', onResize);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.CoinOspreyAds = { init: init, render: render, refresh: refresh };
})();
