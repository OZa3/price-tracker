/* ─────────────────────────────────────────────────────────────
   Market Price Tracker — app.js (Uppdaterad version)
   ───────────────────────────────────────────────────────────── */

const REFRESH_INTERVAL_MS = 300_000; // 5 minuter
const CACHE_TIME_MS = 300_000;       // 5 minuter

// ── Helpers ──────────────────────────────────────────────────

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000 } = options; // 10 sekunder timeout
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

function getCachedData(key) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_TIME_MS) return null;
    return data;
  } catch (e) { return null; }
}

function setCachedData(key, data) {
  try {
    const payload = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {}
}

function fmt(value, opts = {}) {
  const { currency = "USD", decimals = 2 } = opts;
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
  const badge = changeObj ? `<span class="badge ${changeObj.cls}">${changeObj.text}</span>` : "";
  card.innerHTML = `<div class="card-name">${name}</div><div class="card-price">${priceStr}</div>${badge}`;
  return card;
}

function makeErrorCard(name) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="card-name">${name}</div><div class="card-price">—</div><div class="card-error">Unavailable</div>`;
  return card;
}

function setGrid(id, cards) {
  const grid = document.getElementById(id);
  if (grid) {
    grid.innerHTML = "";
    cards.forEach(c => grid.appendChild(c));
  }
}

function setSkeletons(id, n) {
  const grid = document.getElementById(id);
  if (grid) grid.innerHTML = Array(n).fill('<div class="card skeleton"></div>').join("");
}

// ── Crypto (Endast Bitcoin) ──────────────────────────────────

async function fetchCrypto() {
  const cacheKey = "crypto_cache";
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetchWithTimeout(url);
  const data = await res.json();
  setCachedData(cacheKey, data);
  return data;
}

function buildCryptoCards(data) {
  const btc = data.bitcoin;
  if (!btc) return [makeErrorCard("Bitcoin")];
  return [makeCard("Bitcoin (BTC)", fmt(btc.usd, { decimals: 0 }), fmtChange(btc.usd_24h_change))];
}

// ── Metals (Guld & Silver) ───────────────────────────────────

async function fetchMetals() {
  const cacheKey = "metals_cache";
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  const url = "https://api.metals.live/v1/spot/gold,silver";
  const res = await fetchWithTimeout(url);
  const data = await res.json();
  setCachedData(cacheKey, data);
  return data;
}

function buildMetalCards(data) {
  const flat = {};
  data.forEach(obj => Object.assign(flat, obj));
  const metals = [
    { key: "gold", label: "Gold (oz)" },
    { key: "silver", label: "Silver (oz)" }
  ];
  return metals.map(m => flat[m.key] ? makeCard(m.label, fmt(flat[m.key]), null) : makeErrorCard(m.label));
}

// ── Indices & Forex (Yahoo via AllOrigins) ───────────────────

async function fetchYahoo(symbol) {
  const cacheKey = `yahoo_cache_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  const encoded = encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`);
  const url = `https://api.allorigins.win/get?url=${encoded}`;
  const res = await fetchWithTimeout(url);
  const wrapper = await res.json();
  const json = JSON.parse(wrapper.contents);
  const result = json.chart.result[0];
  const closes = result.indicators.quote[0].close.filter(Boolean);
  const latest = closes[closes.length - 1];
  const prev = closes[closes.length - 2] ?? latest;
  const data = { price: latest, changePct: ((latest - prev) / prev) * 100 };
  setCachedData(cacheKey, data);
  return data;
}

async function fetchIndices() {
  const symbols = [
    { symbol: "^GSPC",  label: "S&P 500",  decimals: 0 },
    { symbol: "^IXIC",  label: "NASDAQ",   decimals: 0 },
    { symbol: "CL=F",   label: "Oil (WTI)", decimals: 2 },
    { symbol: "SEK=X",  label: "USD/SEK",  decimals: 4 } // Valutaväxling
  ];

  return Promise.allSettled(symbols.map(s => fetchYahoo(s.symbol).then(d => ({ ...s, ...d }))))
    .then(results => results.map((r, i) => {
      if (r.status === "rejected") return makeErrorCard(symbols[i].label);
      const { label, price, changePct, decimals } = r.value;
      const pStr = (label === "S&P 500" || label === "NASDAQ") 
        ? price.toLocaleString("en-US", { maximumFractionDigits: 0 }) 
        : price.toFixed(decimals);
      return makeCard(label, label === "USD/SEK" ? price.toFixed(4) + " kr" : fmt(price, { decimals }), fmtChange(changePct));
    }));
}

// ── Main Orchestration ───────────────────────────────────────

async function fetchAll() {
  const btn = document.getElementById("refresh-btn");
  if (btn) btn.classList.add("loading");

  setSkeletons("crypto-grid", 1);
  setSkeletons("metals-grid", 2);
  setSkeletons("indices-grid", 4);

  const p1 = fetchCrypto().then(d => setGrid("crypto-grid", buildCryptoCards(d))).catch(() => setGrid("crypto-grid", [makeErrorCard("Bitcoin")]));
  const p2 = fetchMetals().then(d => setGrid("metals-grid", buildMetalCards(d))).catch(() => setGrid("metals-grid", [makeErrorCard("Gold"), makeErrorCard("Silver")]));
  const p3 = fetchIndices().then(cards => setGrid("indices-grid", cards)).catch(() => {});

  await Promise.allSettled([p1, p2, p3]);

  const timeEl = document.getElementById("updated-time");
  if (timeEl) timeEl.textContent = "Senast uppdaterad: " + new Date().toLocaleTimeString();
  if (btn) btn.classList.remove("loading");
}

// Event Listeners
const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) refreshBtn.addEventListener("click", () => { localStorage.clear(); fetchAll(); });

fetchAll();
setInterval(fetchAll, REFRESH_INTERVAL_MS);