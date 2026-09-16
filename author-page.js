/* =============================================================
   COINOSPREY — AUTHOR PROFILE PAGE LOGIC
   =============================================================
   Reads the author slug from the URL, matches it against
   CO_AUTHOR_REGISTRY (author-data.js) for verified profile info,
   pulls the author's real published articles from the existing
   /api/articles endpoint (same one the homepage uses), and
   renders the page. No article data is duplicated or faked here
   — /api/articles remains the single source of truth.
   ============================================================= */
(function () {
  "use strict";

  var ARTICLE_URL_PREFIX = '/en/';
  var PLACEHOLDER_IMG = 'https://placehold.co/128x128/1a1f26/F3F5F7?text=%3F';
  var ENDPOINT = '/api/articles';
  var PAGE_SIZE = 9;

  var state = {
    slug: null,
    registryEntry: null,
    displayName: null,
    allArticles: [],       // every article by this author
    filteredArticles: [],  // after category filter
    activeCategory: 'all',
    page: 1
  };

  /* ---------------- helpers (mirrors homepage conventions) ---------------- */

  function escapeHtml(str) {
    return (str == null ? '' : String(str)).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function fmtDate(d) {
    if (!d) return '';
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtMonthYear(d) {
    if (!d) return '';
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  function href(a) {
    var section = a.section || 'news';
    return ARTICLE_URL_PREFIX + encodeURIComponent(section) + '/' + encodeURIComponent(a.slug || '');
  }

  function img(a) {
    return a.image || PLACEHOLDER_IMG;
  }

  function badgeClass(category) {
    var map = {
      bitcoin: 'badge--bitcoin', ethereum: 'badge--ethereum', altcoins: 'badge--altcoins',
      exchange: 'badge--exchange', binance: 'badge--binance', regulation: 'badge--regulation',
      sec: 'badge--sec'
    };
    return map[(category || '').toLowerCase()] || 'badge--dark';
  }

  function slugify(str) {
    return (str || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function titleCaseFromSlug(slug) {
    return (slug || '')
      .split('-')
      .filter(Boolean)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); })
      .join(' ');
  }

  function initialsFromName(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0].charAt(0);
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  function getSlugFromUrl() {
    // Prefer clean /author/{slug} paths (works once the server rewrites
    // that route to this file while preserving the URL). Falls back to
    // ?slug= for direct static hosting without that rewrite in place.
    var pathMatch = window.location.pathname.match(/\/author\/([^\/?#]+)/i);
    if (pathMatch && pathMatch[1]) return decodeURIComponent(pathMatch[1]);
    var params = new URLSearchParams(window.location.search);
    return params.get('slug') || params.get('author') || '';
  }

  /* ---------------- SEO / structured data ---------------- */

  function updateSeo(name, bio, image, canonicalSlug) {
    var title = name + ' | CoinOsprey';
    var description = bio
      ? bio.slice(0, 155)
      : "Read " + name + "'s latest cryptocurrency news, blockchain coverage and research articles on CoinOsprey.";
    var canonicalUrl = 'https://www.coinosprey.com/author/' + encodeURIComponent(canonicalSlug) + '/';
    var ogImage = image || 'https://www.coinosprey.com/og-default.jpg';

    document.title = title;
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('metaDescription').setAttribute('content', description);
    document.getElementById('canonicalLink').setAttribute('href', canonicalUrl);
    document.getElementById('ogUrl').setAttribute('content', canonicalUrl);
    document.getElementById('ogTitle').setAttribute('content', title);
    document.getElementById('ogDescription').setAttribute('content', description);
    document.getElementById('ogImage').setAttribute('content', ogImage);

    var personGraph = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "ProfilePage",
          "@id": canonicalUrl + "#profilepage",
          "url": canonicalUrl,
          "mainEntity": { "@id": canonicalUrl + "#person" }
        },
        Object.assign({
          "@type": "Person",
          "@id": canonicalUrl + "#person",
          "name": name,
          "url": canonicalUrl
        },
          image ? { "image": image } : {},
          (state.registryEntry && state.registryEntry.role) ? { "jobTitle": state.registryEntry.role } : {},
          { "worksFor": { "@type": "Organization", "name": "CoinOsprey" } },
          buildSameAs()
        )
      ]
    };

    var breadcrumbGraph = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.coinosprey.com/" },
        { "@type": "ListItem", "position": 2, "name": "Authors", "item": "https://www.coinosprey.com/authors.html" },
        { "@type": "ListItem", "position": 3, "name": name, "item": canonicalUrl }
      ]
    };

    document.getElementById('ldPerson').textContent = JSON.stringify(personGraph);
    document.getElementById('ldBreadcrumb').textContent = JSON.stringify(breadcrumbGraph);
  }

  function buildSameAs() {
    var social = state.registryEntry && state.registryEntry.social;
    if (!social) return {};
    var links = [social.twitter, social.linkedin, social.website, social.github].filter(Boolean);
    return links.length ? { sameAs: links } : {};
  }

  /* ---------------- rendering ---------------- */

  function renderHero(name, entry) {
    document.getElementById('breadcrumbCurrent').textContent = name;
    document.getElementById('authorName').textContent = name;

    var photoWrap = document.getElementById('authorPhotoWrap');
    if (entry && entry.image) {
      photoWrap.innerHTML = '<img src="' + escapeHtml(entry.image) + '" alt="' + escapeHtml(name) + ' — CoinOsprey Author" loading="lazy">';
    } else {
      photoWrap.innerHTML = '<span class="author-hero__initials">' + escapeHtml(initialsFromName(name)) + '</span>';
    }

    var roleEl = document.getElementById('authorRole');
    if (entry && entry.role) {
      roleEl.textContent = entry.role;
      roleEl.style.display = '';
    }

    var introEl = document.getElementById('authorIntro');
    if (entry && entry.bio) {
      introEl.textContent = entry.bio.length > 220 ? entry.bio.slice(0, 217) + '…' : entry.bio;
      introEl.style.display = '';
    }

    var socialsEl = document.getElementById('authorSocials');
    var socialIcons = {
      twitter: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-7.2L4.4 22H1.3l8.2-9.3L1 2h7.2l5 6.6L18.9 2Z"/></svg>',
      linkedin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2 3.77-2 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.6c0-1.34-.02-3.06-1.87-3.06-1.87 0-2.16 1.46-2.16 2.97V21H9z"/></svg>',
      website: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>',
      github: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.5c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.1.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.4 9.4 0 0 1 5 0c1.9-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.69 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>'
    };
    var labels = { twitter: 'X (Twitter)', linkedin: 'LinkedIn', website: 'Website', github: 'GitHub' };
    var html = '';
    if (entry && entry.social) {
      Object.keys(socialIcons).forEach(function (key) {
        var url = entry.social[key];
        if (url) {
          html += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + labels[key] + '">' + socialIcons[key] + '</a>';
        }
      });
    }
    socialsEl.innerHTML = html;
  }

  function renderBio(name, entry) {
    if (!entry || !entry.bio) return;
    document.getElementById('bioHeading').textContent = 'About ' + name;
    document.getElementById('authorBioText').textContent = entry.bio;
    document.getElementById('bioSection').style.display = '';
  }

  function renderExpertise(entry) {
    if (!entry || !entry.expertise || !entry.expertise.length) return;
    var list = document.getElementById('expertiseList');
    list.innerHTML = entry.expertise.map(function (tag) {
      return '<li class="author-expertise__tag">' + escapeHtml(tag) + '</li>';
    }).join('');
    document.getElementById('expertiseSection').style.display = '';
  }

  function renderEditorialRole(entry) {
    if (!entry || (!entry.role && !entry.focus)) return;
    if (entry.role) document.getElementById('editorialRole').textContent = entry.role;
    if (entry.focus) document.getElementById('editorialFocus').textContent = entry.focus;
    document.getElementById('editorialSection').style.display = '';
  }

  function renderProfessionalInfo(name, entry, articles) {
    var fields = [];
    fields.push(['Name', name]);
    if (entry && entry.role) fields.push(['Role', entry.role]);
    fields.push(['Organization', (entry && entry.organization) || 'CoinOsprey']);
    var topics = uniqueCategories(articles);
    if (topics.length) fields.push(['Primary Topics', topics.slice(0, 5).join(', ')]);
    if (entry && entry.languages) fields.push(['Languages', entry.languages]);
    if (entry && entry.location) fields.push(['Location', entry.location]);
    if (entry && entry.joined) fields.push(['Joined CoinOsprey', entry.joined]);

    if (fields.length <= 2) return; // nothing meaningful beyond name/org — skip the panel

    var grid = document.getElementById('professionalGrid');
    grid.innerHTML = fields.map(function (f) {
      return '<div class="author-field"><div class="author-field__label">' + escapeHtml(f[0]) + '</div><div class="author-field__value">' + escapeHtml(f[1]) + '</div></div>';
    }).join('');
    document.getElementById('professionalSection').style.display = '';
  }

  function uniqueCategories(articles) {
    var seen = {};
    var out = [];
    articles.forEach(function (a) {
      var c = a.category || a.type;
      if (c && !seen[c]) { seen[c] = true; out.push(c); }
    });
    return out;
  }

  function renderStats(articles) {
    document.getElementById('statArticles').textContent = articles.length ? String(articles.length) : '—';
    var topics = uniqueCategories(articles);
    document.getElementById('statTopics').textContent = topics.length ? String(topics.length) : '—';
    var latest = articles.slice().sort(byDateDesc)[0];
    document.getElementById('statLatest').textContent = latest ? fmtMonthYear(latest.publishedAt || latest.createdAt) : '—';
    if (!articles.length) document.getElementById('statsSection').style.display = 'none';
  }

  function byDateDesc(a, b) {
    return new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0);
  }

  function newsCardTemplate(a) {
    return '' +
      '<a class="news-card" href="' + href(a) + '" aria-label="' + escapeHtml(a.title || '') + '">' +
      '  <div class="news-card__media co-skeleton">' +
      '    <img class="news-card__img is-loaded" src="' + img(a) + '" alt="' + escapeHtml(a.imageAlt || a.title || '') + '" loading="lazy" width="500" height="300">' +
      '    <div class="news-card__overlay"></div>' +
      '  </div>' +
      '  <div class="news-card__body">' +
      '    <div class="badge-row news-card__badge-row">' +
      '      <span class="badge ' + badgeClass(a.category) + '">' + escapeHtml(a.category || a.type || 'News') + '</span>' +
      '    </div>' +
      '    <h3 class="news-card__title">' + escapeHtml(a.title || '') + '</h3>' +
      '    <div class="news-card__footer">' +
      '      <span>' + fmtDate(a.publishedAt || a.createdAt) + '</span>' +
      '    </div>' +
      '  </div>' +
      '</a>';
  }

  function renderLatest(name, articles) {
    document.getElementById('latestHeading').textContent = 'Latest Articles by ' + name;
    var latest = articles.slice().sort(byDateDesc).slice(0, 4);
    var grid = document.getElementById('latestArticlesGrid');
    if (!latest.length) {
      document.getElementById('latestSection').style.display = 'none';
      return;
    }
    grid.innerHTML = latest.map(newsCardTemplate).join('');
  }

  function renderCategoryFilter(name, articles) {
    var cats = uniqueCategories(articles);
    var wrap = document.getElementById('categoryFilter');
    if (cats.length < 2) { wrap.innerHTML = ''; return; }
    var html = '<button class="author-filter__chip is-active" data-cat="all">All</button>';
    cats.forEach(function (c) {
      html += '<button class="author-filter__chip" data-cat="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.author-filter__chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        wrap.querySelectorAll('.author-filter__chip').forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        state.activeCategory = chip.getAttribute('data-cat');
        state.page = 1;
        applyFilterAndRenderArchive();
      });
    });
  }

  function applyFilterAndRenderArchive() {
    var all = state.allArticles.slice().sort(byDateDesc);
    state.filteredArticles = state.activeCategory === 'all'
      ? all
      : all.filter(function (a) { return (a.category || a.type) === state.activeCategory; });
    renderArchivePage();
  }

  function renderArchivePage() {
    var name = state.displayName;
    document.getElementById('archiveHeading').textContent = 'All Articles by ' + name;
    var grid = document.getElementById('archiveGrid');
    var totalPages = Math.max(1, Math.ceil(state.filteredArticles.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;

    if (!state.filteredArticles.length) {
      grid.innerHTML = '<div class="author-empty" style="grid-column:1/-1;">No articles have been published by this author yet.</div>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    var start = (state.page - 1) * PAGE_SIZE;
    var pageItems = state.filteredArticles.slice(start, start + PAGE_SIZE);
    grid.innerHTML = pageItems.map(newsCardTemplate).join('');

    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    var el = document.getElementById('pagination');
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    var html = '';
    html += '<button class="author-pagination__btn" data-page="prev" ' + (state.page === 1 ? 'disabled' : '') + ' aria-label="Previous page">‹</button>';
    for (var p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - state.page) <= 1) {
        html += '<button class="author-pagination__btn ' + (p === state.page ? 'is-active' : '') + '" data-page="' + p + '" aria-current="' + (p === state.page ? 'page' : 'false') + '">' + p + '</button>';
      } else if (Math.abs(p - state.page) === 2) {
        html += '<span class="author-pagination__btn" style="border:none;background:none;cursor:default;">…</span>';
      }
    }
    html += '<button class="author-pagination__btn" data-page="next" ' + (state.page === totalPages ? 'disabled' : '') + ' aria-label="Next page">›</button>';
    el.innerHTML = html;

    el.querySelectorAll('[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var val = btn.getAttribute('data-page');
        if (val === 'prev') state.page = Math.max(1, state.page - 1);
        else if (val === 'next') state.page = Math.min(totalPages, state.page + 1);
        else state.page = parseInt(val, 10);
        renderArchivePage();
        document.getElementById('archiveSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderFaqToggles() {
    document.querySelectorAll('.author-faq__item').forEach(function (item) {
      var q = item.querySelector('.author-faq__q');
      var a = item.querySelector('.author-faq__a');
      q.addEventListener('click', function () {
        var open = item.classList.toggle('is-open');
        a.style.maxHeight = open ? a.scrollHeight + 'px' : '0';
      });
    });
  }

  /* ---------------- error / empty states ---------------- */

  function showError(title, message) {
    document.getElementById('authorLoading').style.display = 'none';
    document.getElementById('authorContent').style.display = 'none';
    document.getElementById('authorErrorTitle').textContent = title;
    document.getElementById('authorErrorMessage').textContent = message;
    document.getElementById('authorErrorState').style.display = '';
    document.getElementById('breadcrumbCurrent').textContent = 'Not Found';
    document.title = 'Author Not Found | CoinOsprey';
  }

  /* ---------------- main flow ---------------- */

  function init() {
    var rawSlug = getSlugFromUrl();
    if (!rawSlug) {
      showError('Author profile not found.', 'No author was specified in this link.');
      return;
    }
    state.slug = slugify(rawSlug);
    state.registryEntry = (window.CO_AUTHOR_REGISTRY || {})[state.slug] || null;
    state.displayName = (state.registryEntry && state.registryEntry.name) || titleCaseFromSlug(state.slug);

    fetch(ENDPOINT, { method: 'GET', credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('Request failed: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var articles = Array.isArray(data) ? data : (data.articles || []);
        onArticlesLoaded(articles);
      })
      .catch(function (err) {
        console.error('[CoinOsprey] Author page API failed:', err.message);
        showError('Something went wrong.', 'We could not load this author\u2019s articles right now. Please try again shortly.');
      });
  }

  function onArticlesLoaded(articles) {
    var matchNames = (state.registryEntry && state.registryEntry.matchNames) || [];
    var matched = articles.filter(function (a) {
      var authorName = a.author || '';
      if (matchNames.length && matchNames.indexOf(authorName) !== -1) return true;
      return slugify(authorName) === state.slug;
    });

    // If the author has neither a registry entry nor any matching
    // published articles, this is not a real author — show the
    // professional "not found" fallback rather than an empty shell.
    if (!state.registryEntry && !matched.length) {
      showError('Author profile not found.', "We couldn't find a CoinOsprey author matching this profile link.");
      return;
    }

    state.allArticles = matched;

    document.getElementById('authorLoading').style.display = 'none';
    document.getElementById('authorErrorState').style.display = 'none';
    document.getElementById('authorContent').style.display = '';

    var entry = state.registryEntry;
    var name = state.displayName;

    renderHero(name, entry);
    renderBio(name, entry);
    renderExpertise(entry);
    renderEditorialRole(entry);
    renderProfessionalInfo(name, entry, matched);
    renderStats(matched);
    renderLatest(name, matched);
    renderCategoryFilter(name, matched);
    applyFilterAndRenderArchive();
    renderFaqToggles();

    updateSeo(name, entry && entry.bio, entry && entry.image, state.slug);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
