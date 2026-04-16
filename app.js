/* ─────────────────────────────────────────────────────────────
   Market Price Tracker — app.js
   Sources:
     • Crypto  → CoinGecko public API (free, no key required)
     • Metals  → Metals-live via public commodity API
     • Indices → Yahoo Finance via allorigins CORS proxy
   ───────────────────────────────────────────────────────────── */

const REFRESH_INTERVAL_MS = 60_000; // auto-refresh every 60 s

// ── Helpers ──────────────────────────────────────────────────

function fmt(value, opts = {}) {
  const { currency = "USD", decimals = 2, compact = false } = opts;
  if (compact && value >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + "M";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function fmtChange(pct) {
  if (pct === null || isNaN(pct)) return { text: "—", cls: "flat" };
  const sign = pct >= 0 ? "+" : "";
  return { text: `${sign}${pct.toFixed(2)}%`, cls: pct >= 0 ? "up" : "down" };
}

function makeCard(name, priceStr, changeObj) {
  const card = document.createElement("div");
  card.className = "card";
  const badge = changeObj
    ? `<span class="badge ${changeObj.cls}">${changeObj.text}</span>`
    : "";
  card.innerHTML = `
    <div class="card-name">${name}</div>
    <div class="card-price">${priceStr}</div>
    ${badge}
  `;
  return card;
}

function makeErrorCard(name, message = "Unavailable") {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-name">${name}</div>
    <div class="card-price">—</div>
    <div class="card-error">${message}</div>
  `;
  return card;
}

function setGrid(id, cards) {
  const grid = document.getElementById(id);
  grid.innerHTML = "";
  cards.forEach(c => grid.appendChild(c));
}

function setSkeletons(id, n) {
  const grid = document.getElementById(id);
  grid.innerHTML = Array(n).fill('<div class="card skeleton"></div>').join("");
}

// ── Crypto (CoinGecko) ────────────────────────────────────────

async function fetchCrypto() {
  const ids = "bitcoin,ethereum,solana,ripple";
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("CoinGecko error");
  return res.json();
}

function buildCryptoCards(data) {
  const map = {
    bitcoin:  { label: "Bitcoin (BTC)",   decimals: 0 },
    ethereum: { label: "Ethereum (ETH)",  decimals: 0 },
    solana:   { label: "Solana (SOL)",    decimals: 2 },
    ripple:   { label: "XRP",             decimals: 4 },
  };
  return Object.entries(map).map(([id, { label, decimals }]) => {
    const d = data[id];
    if (!d) return makeErrorCard(label);
    const price = fmt(d.usd, { decimals });
    const change = fmtChange(d.usd_24h_change);
    return makeCard(label, price, change);
  });
}

// ── Metals (via Frankfurter / gold price workaround) ──────────
// We use the free metals.live API which returns XAU and XAG in USD

async function fetchMetals() {
  // metals.live free API — no key required
  const url = "https://api.metals.live/v1/spot/gold,silver,platinum";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Metals API error");
  return res.json();
}

function buildMetalCards(data) {
  // Response is an array like: [{gold: 2300.5}, {silver: 27.2}, ...]
  const flat = {};
  data.forEach(obj => Object.assign(flat, obj));

  const metals = [
    { key: "gold",     label: "Gold (oz)",     decimals: 2 },
    { key: "silver",   label: "Silver (oz)",   decimals: 2 },
    { key: "platinum", label: "Platinum (oz)", decimals: 2 },
  ];

  return metals.map(({ key, label, decimals }) => {
    const price = flat[key];
    if (!price) return makeErrorCard(label);
    return makeCard(label, fmt(price, { decimals }), null);
  });
}

// ── Indices & Commodities (Yahoo Finance via AllOrigins) ──────

async function fetchYahoo(symbol) {
  const encoded = encodeURIComponent(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`
  );
  const url = `https://api.allorigins.win/get?url=${encoded}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Proxy error");
  const wrapper = await res.json();
  const json = JSON.parse(wrapper.contents);
  const result = json.chart.result[0];
  const closes = result.indicators.quote[0].close.filter(Boolean);
  const latest = closes[closes.length - 1];
  const prev = closes[closes.length - 2] ?? closes[closes.length - 1];
  const changePct = ((latest - prev) / prev) * 100;
  return { price: latest, changePct };
}

async function fetchIndices() {
  const symbols = [
    { symbol: "^GSPC",  label: "S&P 500",     decimals: 0 },
    { symbol: "^IXIC",  label: "NASDAQ",       decimals: 0 },
    { symbol: "CL=F",   label: "Oil (WTI)",    decimals: 2 },
  ];

  return Promise.allSettled(
    symbols.map(async (s) => {
      const data = await fetchYahoo(s.symbol);
      return { ...s, ...data };
    })
  ).then(results =>
    results.map((r, i) => {
      if (r.status === "rejected") return makeErrorCard(symbols[i].label);
      const { label, price, changePct, decimals } = r.value;
      const change = fmtChange(changePct);
      const priceStr = label.includes("S&P") || label.includes("NASDAQ")
        ? price.toLocaleString("en-US", { maximumFractionDigits: 0 })
        : fmt(price, { decimals });
      return makeCard(label, priceStr, change);
    })
  );
}

// ── Main fetch orchestration ──────────────────────────────────

async function fetchAll() {
  const btn = document.getElementById("refresh-btn");
  btn.classList.add("loading");

  setSkeletons("crypto-grid", 4);
  setSkeletons("metals-grid", 3);
  setSkeletons("indices-grid", 3);

  // Run all in parallel
  const [cryptoResult, metalsResult, indicesResult] = await Promise.allSettled([
    fetchCrypto(),
    fetchMetals(),
    fetchIndices(),
  ]);

  // Crypto
  if (cryptoResult.status === "fulfilled") {
    setGrid("crypto-grid", buildCryptoCards(cryptoResult.value));
  } else {
    setGrid("crypto-grid", [
      makeErrorCard("Bitcoin"), makeErrorCard("Ethereum"),
      makeErrorCard("Solana"),  makeErrorCard("XRP"),
    ]);
    console.error("Crypto fetch failed:", cryptoResult.reason);
  }

  // Metals
  if (metalsResult.status === "fulfilled") {
    setGrid("metals-grid", buildMetalCards(metalsResult.value));
  } else {
    setGrid("metals-grid", [
      makeErrorCard("Gold (oz)"), makeErrorCard("Silver (oz)"), makeErrorCard("Platinum (oz)"),
    ]);
    console.error("Metals fetch failed:", metalsResult.reason);
  }

  // Indices
  setGrid("indices-grid", await indicesResult.value ?? [
    makeErrorCard("S&P 500"), makeErrorCard("NASDAQ"), makeErrorCard("Oil (WTI)"),
  ]);

  // Update timestamp
  document.getElementById("updated-time").textContent =
    "Last updated: " + new Date().toLocaleTimeString();

  btn.classList.remove("loading");
}

// ── Auto-refresh ──────────────────────────────────────────────

fetchAll();
setInterval(fetchAll, REFRESH_INTERVAL_MS);