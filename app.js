/* ==============================================================
   CoinOsprey — app.js
   Vanilla JS only. Wires up navigation, then fetches live data
   (via api.js) and renders it into each section of the page.
   Every render function fails gracefully — api.js already
   guarantees fallback data, so this file just displays whatever
   it receives.
   ============================================================== */

document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  initSearchPopover();

  loadTicker();
  loadHeroWatchlist();
  loadTrendingCoins();
  loadGainersAndLosers();
  loadMarketOverview();
  loadFearAndGreed();
});

/* ---------------------------------------------------------------
   Navigation
--------------------------------------------------------------- */
function initMobileNav() {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (!toggle || !links) return;
  toggle.addEventListener("click", () => {
    const isOpen = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });
}

function initSearchPopover() {
  const btn = document.querySelector("[data-search-toggle]");
  const pop = document.querySelector(".search-pop");
  if (!btn || !pop) return;
  btn.addEventListener("click", () => pop.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!pop.contains(e.target) && !btn.contains(e.target)) {
      pop.classList.remove("open");
    }
  });
}

/* ---------------------------------------------------------------
   Live Crypto Ticker
--------------------------------------------------------------- */
async function loadTicker() {
  const track = document.querySelector("[data-ticker-track]");
  if (!track) return;
  const { data } = await CoinOspreyAPI.getMarkets(10);
  const html = data.map(renderTickerItem).join("");
  // duplicate the list once so the CSS scroll loop is seamless
  track.innerHTML = html + html;
}

function renderTickerItem(c) {
  const dir = c.price_change_percentage_24h >= 0 ? "up" : "down";
  const icon = dir === "up" ? "fa-caret-up" : "fa-caret-down";
  return `<span class="ticker-item">
    <span class="sym">${c.symbol.toUpperCase()}</span>
    <span>${CoinOspreyAPI.formatUSD(c.current_price)}</span>
    <span class="${dir}"><i class="fa-solid ${icon}"></i> ${CoinOspreyAPI.formatPct(c.price_change_percentage_24h)}</span>
  </span>`;
}

/* ---------------------------------------------------------------
   Hero watchlist (small panel inside the hero banner)
--------------------------------------------------------------- */
async function loadHeroWatchlist() {
  const el = document.querySelector("[data-hero-watchlist]");
  if (!el) return;
  const { data } = await CoinOspreyAPI.getMarkets(4);
  el.innerHTML = data.map(renderCoinRow).join("");
}

function renderCoinRow(c) {
  const dir = c.price_change_percentage_24h >= 0 ? "up" : "down";
  return `<div class="coin-row">
    <div class="coin-id">
      <div class="coin-ico">${c.symbol.slice(0, 2).toUpperCase()}</div>
      <div>
        <div class="coin-name">${c.name}</div>
        <div class="coin-sub">${c.symbol.toUpperCase()}</div>
      </div>
    </div>
    <div class="coin-figures">
      <div class="coin-price">${CoinOspreyAPI.formatUSD(c.current_price)}</div>
      <div class="coin-change ${dir}">${CoinOspreyAPI.formatPct(c.price_change_percentage_24h)}</div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------
   Trending Coins (glass cards + sparkline canvas)
--------------------------------------------------------------- */
async function loadTrendingCoins() {
  const wrap = document.querySelector("[data-trending-grid]");
  if (!wrap) return;
  const { data, live } = await CoinOspreyAPI.getMarkets(8);
  setStatus("[data-market-status]", live);

  wrap.innerHTML = data.map(renderCoinCard).join("");
  drawAllSparklines();
}

function renderCoinCard(c) {
  const dir = c.price_change_percentage_24h >= 0 ? "up" : "down";
  const points = c.sparkline_in_7d ? c.sparkline_in_7d.price.slice(-24) : [];
  return `<div class="glass glass-hover coin-card">
    <div class="coin-card-top">
      <div class="coin-id">
        <div class="coin-ico">${c.symbol.slice(0, 2).toUpperCase()}</div>
        <div>
          <div class="coin-name">${c.name}</div>
          <div class="coin-sub">${c.symbol.toUpperCase()}</div>
        </div>
      </div>
      <span class="badge ${dir}">
        <i class="fa-solid ${dir === "up" ? "fa-arrow-trend-up" : "fa-arrow-trend-down"}"></i>
        ${CoinOspreyAPI.formatPct(c.price_change_percentage_24h)}
      </span>
    </div>
    <div class="coin-price">${CoinOspreyAPI.formatUSD(c.current_price)}</div>
    <div class="coin-sub">Cap ${CoinOspreyAPI.formatCompact(c.market_cap)}</div>
    <canvas class="spark-canvas" data-spark='${JSON.stringify(points)}'></canvas>
  </div>`;
}

/* ---------------------------------------------------------------
   Top Gainers / Top Losers
   Pulled from the top-50-by-market-cap set, then re-sorted by
   24h % change — this mirrors how most trackers define "movers"
   (ignoring illiquid micro-caps).
--------------------------------------------------------------- */
async function loadGainersAndLosers() {
  const gainersEl = document.querySelector("[data-gainers-grid]");
  const losersEl = document.querySelector("[data-losers-grid]");
  if (!gainersEl && !losersEl) return;

  const { data } = await CoinOspreyAPI.getMarkets(50);
  const sorted = [...data].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);

  if (gainersEl) gainersEl.innerHTML = sorted.slice(0, 4).map(renderCoinCard).join("");
  if (losersEl) losersEl.innerHTML = sorted.slice(-4).reverse().map(renderCoinCard).join("");

  drawAllSparklines();
}

/* ---------------------------------------------------------------
   Market Overview stat cards
--------------------------------------------------------------- */
async function loadMarketOverview() {
  const wrap = document.querySelector("[data-market-overview]");
  if (!wrap) return;
  const { data, live } = await CoinOspreyAPI.getGlobal();
  setStatus("[data-overview-status]", live);

  const deltaUp = data.market_cap_change_24h >= 0;

  wrap.innerHTML = `
    <div class="glass stat-card">
      <i class="fa-solid fa-globe"></i>
      <b>${CoinOspreyAPI.formatCompact(data.total_market_cap_usd)}</b>
      <span>Total Market Cap</span>
      <span class="stat-delta ${deltaUp ? "up" : "down"}" style="color:${deltaUp ? "var(--rise)" : "var(--fall)"}">
        ${CoinOspreyAPI.formatPct(data.market_cap_change_24h)} (24h)
      </span>
    </div>
    <div class="glass stat-card">
      <i class="fa-solid fa-chart-column"></i>
      <b>${CoinOspreyAPI.formatCompact(data.total_volume_usd)}</b>
      <span>24h Trading Volume</span>
    </div>
    <div class="glass stat-card">
      <i class="fa-brands fa-bitcoin"></i>
      <b>${data.btc_dominance.toFixed(1)}%</b>
      <span>BTC Dominance</span>
    </div>
    <div class="glass stat-card">
      <i class="fa-solid fa-coins"></i>
      <b>${CoinOspreyAPI.formatInt(data.active_cryptocurrencies)}</b>
      <span>Active Cryptocurrencies</span>
    </div>
  `;
}

/* ---------------------------------------------------------------
   Fear & Greed gauge (SVG semi-circle + rotated needle)
--------------------------------------------------------------- */
async function loadFearAndGreed() {
  const needle = document.querySelector("[data-fg-needle]");
  const valueEl = document.querySelector("[data-fg-value]");
  const labelEl = document.querySelector("[data-fg-label]");
  if (!needle || !valueEl) return;

  const { data, live } = await CoinOspreyAPI.getFearGreed();
  setStatus("[data-fg-status]", live);

  // 0 = "Extreme Fear" (needle far left, -90deg) → 100 = "Extreme Greed" (+90deg)
  const angle = (data.value / 100) * 180 - 90;
  needle.style.transform = `rotate(${angle}deg)`;
  valueEl.textContent = data.value;
  if (labelEl) labelEl.textContent = data.classification;
}

/* ---------------------------------------------------------------
   Shared helpers
--------------------------------------------------------------- */
function setStatus(selector, live) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.innerHTML = live
    ? `<span class="pulse-dot"></span> Live data`
    : `<span class="pulse-dot" style="background:var(--text-3)"></span> Recent snapshot — live feed unavailable`;
}

function drawAllSparklines() {
  document.querySelectorAll(".spark-canvas").forEach((canvas) => {
    if (canvas.dataset.drawn) return; // avoid redrawing already-rendered charts
    const points = JSON.parse(canvas.dataset.spark || "[]");
    if (!points.length) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 46;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const rising = points[points.length - 1] >= points[0];

    // filled area under the line, tinted to match direction
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * (h - 6) - 3;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = rising ? "rgba(52,211,153,0.12)" : "rgba(251,91,91,0.12)";
    ctx.fill();

    // the line itself
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * (h - 6) - 3;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = rising ? "#34D399" : "#FB5B5B";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    canvas.dataset.drawn = "true";
  });
}
