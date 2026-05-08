/* ─────────────────────────────────────────────────────────────
   Market Price Tracker — app.js (Optimerad)
   ───────────────────────────────────────────────────────────── */

const REFRESH_INTERVAL_MS = 300_000;
const CACHE_TIME_MS       = 300_000;

// ── Helpers ──────────────────────────────────────────────────

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) { clearTimeout(id); throw e; }
}

function getCachedData(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    return (Date.now() - timestamp < CACHE_TIME_MS) ? data : null;
  } catch { return null; }
}

// ✅ NY: returnerar cachad data även om den är gammal (för omedelbar visning)
function getStaleData(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).data : null;
  } catch { return null; }
}

function setCachedData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {}
}

function fmt(value, opts = {}) {
  const { currency = "USD", decimals = 2 } = opts;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
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
  if (grid) { grid.innerHTML = ""; cards.forEach(c => grid.appendChild(c)); }
}

function setSkeletons(id, n) {
  const grid = document.getElementById(id);
  if (grid) grid.innerHTML = Array(n).fill('<div class="card skeleton"></div>').join("");
}

// ── Crypto ────────────────────────────────────────────────────

async function fetchCrypto() {
  const key = "crypto_cache";
  const cached = getCachedData(key);
  if (cached) return cached;
  const res = await fetchWithTimeout(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true"
  );
  const data = await res.json();
  setCachedData(key, data);
  return data;
}

function buildCryptoCards(data) {
  const btc = data?.bitcoin;
  if (!btc) return [makeErrorCard("Bitcoin")];
  return [makeCard("Bitcoin (BTC)", fmt(btc.usd, { decimals: 0 }), fmtChange(btc.usd_24h_change))];
}

// ── Metals ────────────────────────────────────────────────────

async function fetchMetals() {
  const key = "metals_cache";
  const cached = getCachedData(key);
  if (cached) return cached;
  const res = await fetchWithTimeout("https://api.metals.live/v1/spot/gold,silver");
  const data = await res.json();
  setCachedData(key, data);
  return data;
}

function buildMetalCards(data) {
  const flat = {};
  data.forEach(obj => Object.assign(flat, obj));
  return [
    { key: "gold",   label: "Gold (oz)"   },
    { key: "silver", label: "Silver (oz)" },
  ].map(m => flat[m.key] ? makeCard(m.label, fmt(flat[m.key]), null) : makeErrorCard(m.label));
}

// ── Indices (Yahoo Finance) ───────────────────────────────────
// ✅ Bytt proxy: corsproxy.io är snabbare och mer stabil än allorigins.win

async function fetchYahoo(symbol) {
  const key = `yahoo_${symbol}`;
  const cached = getCachedData(key);
  if (cached) return cached;

  // Primär proxy
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
  const url = `https://corsproxy.io/?${encodeURIComponent(target)}`;
  const res = await fetchWithTimeout(url);
  const json = await res.json();

  const result = json.chart.result[0];
  const closes = result.indicators.quote[0].close.filter(Boolean);
  const latest = closes.at(-1);
  const prev   = closes.at(-2) ?? latest;
  const data   = { price: latest, changePct: ((latest - prev) / prev) * 100 };
  setCachedData(key, data);
  return data;
}

const SYMBOLS = [
  { symbol: "^GSPC", label: "S&P 500",   decimals: 0 },
  { symbol: "^IXIC", label: "NASDAQ",    decimals: 0 },
  { symbol: "CL=F",  label: "Oil (WTI)", decimals: 2 },
  { symbol: "SEK=X", label: "USD/SEK",   decimals: 4 },
];

async function fetchIndices() {
  const results = await Promise.allSettled(
    SYMBOLS.map(s => fetchYahoo(s.symbol).then(d => ({ ...s, ...d })))
  );
  return results.map((r, i) => {
    if (r.status === "rejected") return makeErrorCard(SYMBOLS[i].label);
    const { label, price, changePct, decimals } = r.value;
    const isIndex = label === "S&P 500" || label === "NASDAQ";
    const priceStr = label === "USD/SEK"
      ? price.toFixed(4) + " kr"
      : isIndex
        ? price.toLocaleString("en-US", { maximumFractionDigits: 0 })
        : fmt(price, { decimals });
    return makeCard(label, priceStr, fmtChange(changePct));
  });
}

// ── ✅ NY: Visa cachad (stale) data direkt vid sidladdning ────

function renderFromCache() {
  const cryptoStale  = getStaleData("crypto_cache");
  const metalsStale  = getStaleData("metals_cache");

  if (cryptoStale) setGrid("crypto-grid",  buildCryptoCards(cryptoStale));
  if (metalsStale) setGrid("metals-grid",  buildMetalCards(metalsStale));

  SYMBOLS.forEach(({ symbol, label, decimals }) => {
    const d = getStaleData(`yahoo_${symbol}`);
    if (!d) return;
    const isIndex = label === "S&P 500" || label === "NASDAQ";
    const priceStr = label === "USD/SEK"
      ? d.price.toFixed(4) + " kr"
      : isIndex
        ? d.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
        : fmt(d.price, { decimals });
    // Ersätt rätt skeleton-kort i indexgriddet med känd data
    const grid = document.getElementById("indices-grid");
    if (grid) {
      const idx = SYMBOLS.findIndex(s => s.symbol === symbol);
      const skeleton = grid.children[idx];
      if (skeleton?.classList.contains("skeleton")) {
        grid.replaceChild(makeCard(label, priceStr, fmtChange(d.changePct)), skeleton);
      }
    }
  });
}

// ── Huvudorkestrering ─────────────────────────────────────────

async function fetchAll(silent = false) {
  const btn = document.getElementById("refresh-btn");
  if (btn) btn.classList.add("loading");

  // Visa endast skeletons för sektioner utan cachad data
  if (!silent) {
    if (!getStaleData("crypto_cache"))   setSkeletons("crypto-grid", 1);
    if (!getStaleData("metals_cache"))   setSkeletons("metals-grid", 2);
    const hasAllIndices = SYMBOLS.every(s => getStaleData(`yahoo_${s.symbol}`));
    if (!hasAllIndices) setSkeletons("indices-grid", SYMBOLS.length);
  }

  const p1 = fetchCrypto()
    .then(d  => setGrid("crypto-grid",  buildCryptoCards(d)))
    .catch(() => setGrid("crypto-grid", [makeErrorCard("Bitcoin")]));

  const p2 = fetchMetals()
    .then(d  => setGrid("metals-grid",  buildMetalCards(d)))
    .catch(() => setGrid("metals-grid", [makeErrorCard("Gold"), makeErrorCard("Silver")]));

  const p3 = fetchIndices()
    .then(cards => setGrid("indices-grid", cards))
    .catch(() => {});

  await Promise.allSettled([p1, p2, p3]);

  const timeEl = document.getElementById("updated-time");
  if (timeEl) timeEl.textContent = "Senast uppdaterad: " + new Date().toLocaleTimeString();
  if (btn) btn.classList.remove("loading");
}

// ── Initiering ────────────────────────────────────────────────

// 1. Visa cachad data omedelbart (noll fördröjning)
renderFromCache();

// 2. Hämta färsk data tyst i bakgrunden om cache finns, annars normalt
const hasSomeCache = getStaleData("crypto_cache") || getStaleData("metals_cache");
fetchAll(/* silent = */ !!hasSomeCache);

// 3. Refresh-knapp rensar alltid cachen och hämtar på nytt
document.getElementById("refresh-btn")?.addEventListener("click", () => {
  localStorage.clear();
  fetchAll(false);
});

// 4. Auto-refresh körs tyst (ingen skeleton-animation)
setInterval(() => fetchAll(true), REFRESH_INTERVAL_MS);

// Fallback om primär proxy misslyckas
async function fetchYahooWithFallback(symbol) {
  const proxies = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  ];
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
  for (const proxy of proxies) {
    try { return await fetchYahoo(symbol, proxy(target)); } catch {}
  }
  throw new Error("All proxies failed");
}