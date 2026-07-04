/* ==============================================================
   CoinOsprey — api.js
   All external data access lives here. Two public, keyless APIs
   are used:
     - CoinGecko  → coin prices, market caps, global stats
     - Alternative.me → Crypto Fear & Greed Index
   Every function returns { data, live }. If a fetch fails for
   any reason (offline, CORS, rate limit) we fall back to a
   realistic static snapshot so the page never breaks or shows
   an empty state.
   ============================================================== */

const CoinOspreyAPI = (() => {

  const COINGECKO = "https://api.coingecko.com/api/v3";
  const FNG_API   = "https://api.alternative.me/fng/?limit=1";

  /* ---- Static fallback snapshot (used only if the live call fails) ---- */
  const FALLBACK_MARKETS = [
    { id:"bitcoin", symbol:"btc", name:"Bitcoin", current_price:107452, market_cap:2123000000000, total_volume:38200000000, price_change_percentage_24h:1.82, sparkline_in_7d:{price:[104000,105200,103800,106500,107900,106800,107452]} },
    { id:"ethereum", symbol:"eth", name:"Ethereum", current_price:3894, market_cap:469000000000, total_volume:19800000000, price_change_percentage_24h:-0.74, sparkline_in_7d:{price:[3980,3950,3870,3910,3860,3900,3894]} },
    { id:"solana", symbol:"sol", name:"Solana", current_price:198.3, market_cap:96000000000, total_volume:4200000000, price_change_percentage_24h:3.41, sparkline_in_7d:{price:[182,186,190,188,195,201,198.3]} },
    { id:"ripple", symbol:"xrp", name:"XRP", current_price:2.41, market_cap:139000000000, total_volume:5100000000, price_change_percentage_24h:-1.15, sparkline_in_7d:{price:[2.5,2.47,2.44,2.39,2.42,2.45,2.41]} },
    { id:"binancecoin", symbol:"bnb", name:"BNB", current_price:712.4, market_cap:103000000000, total_volume:1800000000, price_change_percentage_24h:0.52, sparkline_in_7d:{price:[698,702,705,709,715,710,712.4]} },
    { id:"dogecoin", symbol:"doge", name:"Dogecoin", current_price:0.221, market_cap:32600000000, total_volume:1650000000, price_change_percentage_24h:5.67, sparkline_in_7d:{price:[0.198,0.203,0.21,0.215,0.219,0.225,0.221]} },
    { id:"cardano", symbol:"ada", name:"Cardano", current_price:0.812, market_cap:29100000000, total_volume:820000000, price_change_percentage_24h:-2.31, sparkline_in_7d:{price:[0.86,0.85,0.83,0.82,0.80,0.815,0.812]} },
    { id:"avalanche-2", symbol:"avax", name:"Avalanche", current_price:38.7, market_cap:16000000000, total_volume:610000000, price_change_percentage_24h:2.02, sparkline_in_7d:{price:[35,36,37,36.5,38,39,38.7]} },
    { id:"tron", symbol:"trx", name:"TRON", current_price:0.298, market_cap:25700000000, total_volume:520000000, price_change_percentage_24h:-3.8, sparkline_in_7d:{price:[0.31,0.305,0.30,0.296,0.293,0.30,0.298]} },
    { id:"chainlink", symbol:"link", name:"Chainlink", current_price:22.6, market_cap:14400000000, total_volume:410000000, price_change_percentage_24h:4.92, sparkline_in_7d:{price:[20.1,20.8,21.4,21.9,22.2,22.9,22.6]} },
    { id:"polkadot", symbol:"dot", name:"Polkadot", current_price:6.14, market_cap:9200000000, total_volume:210000000, price_change_percentage_24h:-4.4, sparkline_in_7d:{price:[6.6,6.5,6.4,6.2,6.1,6.05,6.14]} },
    { id:"shiba-inu", symbol:"shib", name:"Shiba Inu", current_price:0.0000164, market_cap:9600000000, total_volume:190000000, price_change_percentage_24h:6.31, sparkline_in_7d:{price:[0.0000148,0.0000151,0.0000155,0.0000158,0.0000160,0.0000162,0.0000164]} },
  ];

  const FALLBACK_GLOBAL = {
    total_market_cap_usd: 3480000000000,
    total_volume_usd: 142000000000,
    btc_dominance: 54.2,
    active_cryptocurrencies: 16842,
    market_cap_change_24h: 1.4,
  };

  const FALLBACK_FNG = { value: 68, classification: "Greed" };

  /* ---- Helper: fetch with a timeout so a stalled request never hangs the UI ---- */
  async function withTimeout(fn, ms = 6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await fn(ctrl.signal); }
    finally { clearTimeout(timer); }
  }

  /* ---- Top N coins by market cap, with 7d sparkline data ---- */
  async function getMarkets(limit = 10) {
    try {
      const res = await withTimeout((signal) =>
        fetch(`${COINGECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=24h`, { signal })
      );
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error("empty");
      return { data, live: true };
    } catch (err) {
      return { data: FALLBACK_MARKETS.slice(0, limit), live: false };
    }
  }

  /* ---- Global market stats: total cap, volume, BTC dominance ---- */
  async function getGlobal() {
    try {
      const res = await withTimeout((signal) => fetch(`${COINGECKO}/global`, { signal }));
      if (!res.ok) throw new Error("bad response");
      const json = await res.json();
      const d = json.data;
      return {
        data: {
          total_market_cap_usd: d.total_market_cap.usd,
          total_volume_usd: d.total_volume.usd,
          btc_dominance: d.market_cap_percentage.btc,
          active_cryptocurrencies: d.active_cryptocurrencies,
          market_cap_change_24h: d.market_cap_change_percentage_24h_usd,
        },
        live: true,
      };
    } catch (err) {
      return { data: FALLBACK_GLOBAL, live: false };
    }
  }

  /* ---- Crypto Fear & Greed Index (alternative.me) ---- */
  async function getFearGreed() {
    try {
      const res = await withTimeout((signal) => fetch(FNG_API, { signal }));
      if (!res.ok) throw new Error("bad response");
      const json = await res.json();
      const item = json.data && json.data[0];
      if (!item) throw new Error("empty");
      return { data: { value: Number(item.value), classification: item.value_classification }, live: true };
    } catch (err) {
      return { data: FALLBACK_FNG, live: false };
    }
  }

  /* ---- Formatting helpers ---- */
  function formatUSD(n) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  function formatCompact(n) {
    if (n == null || isNaN(n)) return "—";
    return "$" + Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  }
  function formatPct(n) {
    if (n == null || isNaN(n)) return "—";
    const sign = n >= 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  }
  function formatInt(n) {
    if (n == null || isNaN(n)) return "—";
    return Intl.NumberFormat("en").format(n);
  }

  return {
    getMarkets, getGlobal, getFearGreed,
    formatUSD, formatCompact, formatPct, formatInt,
    FALLBACK_MARKETS,
  };
})();
