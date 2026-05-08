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

// ── Yahoo Finance (används för metals + indices) ──────────────

async function fetchYahoo(symbol) {
  const key = `yahoo_${symbol}`;
  const cached = getCachedData(key);
  if (cached) return cached;

  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(target)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
  ];

  let json = null;
  for (const url of proxies) {
    try {
      const res = await fetchWithTimeout(url);
      const wrapper = await res.json();
      // allorigins wrapppar svaret i { contents: "..." }
      json = wrapper.contents ? JSON.parse(wrapper.contents) : wrapper;
      break;
    } catch {}
  }
  if (!json) throw new Error(`All proxies failed for ${symbol}`);

  const result = json.chart.result[0];
  const closes = result.indicators.quote[0].close.filter(Boolean);
  const latest = closes.at(-1);
  const prev   = closes.at(-2) ?? latest;
  const data   = { price: latest, changePct: ((latest - prev) / prev) * 100 };
  setCachedData(key, data);
  return data;
}

// ── Metals ────────────────────────────────────────────────────

const METAL_SYMBOLS = [
  { symbol: "GC=F", label: "Gold (oz)",   decimals: 2 },
  { symbol: "SI=F", label: "Silver (oz)", decimals: 2 },
];

async function fetchMetals() {
  const results = await Promise.allSettled(
    METAL_SYMBOLS.map(s => fetchYahoo(s.symbol).then(d => ({ ...s, ...d })))
  );
  return results.map((r, i) => {
    if (r.status === "rejected") return makeErrorCard(METAL_SYMBOLS[i].label);
    const { label, price, decimals } = r.value;
    return makeCard(label, fmt(price, { decimals }), null);
  });
}

// ── Indices ───────────────────────────────────────────────────

const SYMBOLS = [
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
    const priceStr = label === "USD/SEK"
      ? price.toFixed(4) + " kr"
      : fmt(price, { decimals });
    return makeCard(label, priceStr, fmtChange(changePct));
  });
}

// ── Visa cachad data direkt vid sidladdning ───────────────────

function renderFromCache() {
  // Crypto
  const cryptoStale = getStaleData("crypto_cache");
  if (cryptoStale) setGrid("crypto-grid", buildCryptoCards(cryptoStale));

  // Metals
  METAL_SYMBOLS.forEach(({ symbol, label, decimals }) => {
    const d = getStaleData(`yahoo_${symbol}`);
    if (!d) return;
    const grid = document.getElementById("metals-grid");
    if (!grid) return;
    const idx = METAL_SYMBOLS.findIndex(s => s.symbol === symbol);
    const skeleton = grid.children[idx];
    if (skeleton?.classList.contains("skeleton")) {
      grid.replaceChild(makeCard(label, fmt(d.price, { decimals }), null), skeleton);
    }
  });

  // Indices
  SYMBOLS.forEach(({ symbol, label, decimals }) => {
    const d = getStaleData(`yahoo_${symbol}`);
    if (!d) return;
    const priceStr = label === "USD/SEK"
      ? d.price.toFixed(4) + " kr"
      : fmt(d.price, { decimals });
    const grid = document.getElementById("indices-grid");
    if (!grid) return;
    const idx = SYMBOLS.findIndex(s => s.symbol === symbol);
    const skeleton = grid.children[idx];
    if (skeleton?.classList.contains("skeleton")) {
      grid.replaceChild(makeCard(label, priceStr, fmtChange(d.changePct)), skeleton);
    }
  });
}

// ── Huvudorkestrering ─────────────────────────────────────────

async function fetchAll(silent = false) {
  const btn = document.getElementById("refresh-btn");
  if (btn) btn.classList.add("loading");

  if (!silent) {
    if (!getStaleData("crypto_cache")) setSkeletons("crypto-grid", 1);
    const hasAllMetals  = METAL_SYMBOLS.every(s => getStaleData(`yahoo_${s.symbol}`));
    const hasAllIndices = SYMBOLS.every(s => getStaleData(`yahoo_${s.symbol}`));
    if (!hasAllMetals)  setSkeletons("metals-grid",  METAL_SYMBOLS.length);
    if (!hasAllIndices) setSkeletons("indices-grid",  SYMBOLS.length);
  }

  const p1 = fetchCrypto()
    .then(d     => setGrid("crypto-grid",  buildCryptoCards(d)))
    .catch(()   => setGrid("crypto-grid",  [makeErrorCard("Bitcoin")]));

  const p2 = fetchMetals()
    .then(cards => setGrid("metals-grid",  cards))
    .catch(()   => setGrid("metals-grid",  [makeErrorCard("Gold"), makeErrorCard("Silver")]));

  const p3 = fetchIndices()
    .then(cards => setGrid("indices-grid", cards))
    .catch(()   => {});

  await Promise.allSettled([p1, p2, p3]);

  const timeEl = document.getElementById("updated-time");
  if (timeEl) timeEl.textContent = "Senast uppdaterad: " + new Date().toLocaleTimeString();
  if (btn) btn.classList.remove("loading");
}

// ── Initiering ────────────────────────────────────────────────

// 1. Visa cachad data omedelbart (noll fördröjning)
renderFromCache();

// 2. Hämta färsk data — tyst om cache finns, annars med skeletons
const hasSomeCache = getStaleData("crypto_cache") ||
                     METAL_SYMBOLS.some(s => getStaleData(`yahoo_${s.symbol}`));
fetchAll(/* silent = */ !!hasSomeCache);

// 3. Refresh-knapp rensar cache och hämtar på nytt
document.getElementById("refresh-btn")?.addEventListener("click", () => {
  localStorage.clear();
  fetchAll(false);
});

// 4. Auto-refresh körs tyst
setInterval(() => fetchAll(true), REFRESH_INTERVAL_MS);