/* ─────────────────────────────────────────────────────────────
   Market Price Tracker — app.js (Optimerad)
   ───────────────────────────────────────────────────────────── */

const REFRESH_INTERVAL_MS = 300_000;
const CACHE_TIME_MS       = 300_000;
const PREF_KEY            = "market_tracker_prefs";

const DEFAULT_PREFS = {
  sections: {
    crypto: true,
    metals: true,
    indices: true,
  },
  refreshMinutes: REFRESH_INTERVAL_MS / 60_000,
};

let autoRefreshTimer = null;
let prefs = loadPrefs();

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

function cloneDefaultPrefs() {
  return JSON.parse(JSON.stringify(DEFAULT_PREFS));
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return cloneDefaultPrefs();

    const parsed = JSON.parse(raw);
    return {
      sections: {
        ...DEFAULT_PREFS.sections,
        ...(parsed.sections || {}),
      },
      refreshMinutes: [1, 5, 15].includes(parsed.refreshMinutes) ? parsed.refreshMinutes : DEFAULT_PREFS.refreshMinutes,
    };
  } catch {
    return cloneDefaultPrefs();
  }
}

function savePrefs(nextPrefs) {
  prefs = nextPrefs;
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {}
}

function getCacheKeys() {
  return [
    "crypto_cache",
    ...METAL_SYMBOLS.map(s => `yahoo_${s.symbol}`),
    ...SYMBOLS.map(s => s.kind === "fx" ? `fx_${s.base}_${s.quote}` : `yahoo_${s.symbol}`),
  ];
}

function getRefreshIntervalMs() {
  return prefs.refreshMinutes * 60_000;
}

function isSectionVisible(section) {
  return prefs.sections[section] !== false;
}

function setSectionVisibility(section, visible) {
  const wrapper = document.querySelector(`.market-section[data-section="${section}"]`);
  if (wrapper) wrapper.hidden = !visible;
}

function updateRefreshLabel() {
  const label = document.getElementById("refresh-label");
  if (!label) return;
  label.textContent = prefs.refreshMinutes === 1 ? "1 minute" : `${prefs.refreshMinutes} minutes`;
}

function applyPrefsToUI() {
  ["crypto", "metals", "indices"].forEach(section => {
    const toggle = document.getElementById(`toggle-${section}`);
    if (toggle) toggle.checked = isSectionVisible(section);
    setSectionVisibility(section, isSectionVisible(section));
  });

  const intervalSelect = document.getElementById("refresh-interval");
  if (intervalSelect) intervalSelect.value = String(prefs.refreshMinutes);

  updateRefreshLabel();
}

function restartAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => fetchAll(true), getRefreshIntervalMs());
}

function clearMarketCache() {
  getCacheKeys().forEach(key => {
    try {
      localStorage.removeItem(key);
    } catch {}
  });
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

  // Primär: CoinGecko
  try {
    const res = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true"
    );
    const data = await res.json();
    if (data?.bitcoin?.usd) { setCachedData(key, data); return data; }
  } catch {}

  // Fallback: CoinCap
  const res2 = await fetchWithTimeout("https://api.coincap.io/v2/assets/bitcoin");
  const { data: cc } = await res2.json();
  const data = {
    bitcoin: {
      usd: parseFloat(cc.priceUsd),
      usd_24h_change: parseFloat(cc.changePercent24Hr),
    }
  };
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
    `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
    `https://corsproxy.io/?${encodeURIComponent(target)}`,
  ];

  let json = null;
  for (const url of proxies) {
    try {
      const res = await fetchWithTimeout(url);
      const text = await res.text();
      const wrapper = JSON.parse(text);
      json = wrapper.contents ? JSON.parse(wrapper.contents) : wrapper;
      if (json?.chart?.result?.length) break;
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

async function fetchFx(base, quote) {
  const key = `fx_${base}_${quote}`;
  const cached = getCachedData(key);
  if (cached) return cached;

  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
  const res = await fetchWithTimeout(url);
  const data = await res.json();
  const price = data?.rates?.[quote];
  if (!price) throw new Error(`Missing FX rate for ${base}/${quote}`);

  const result = { price, changePct: null };
  setCachedData(key, result);
  return result;
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
    const { label, price, decimals, changePct } = r.value;
    return makeCard(label, fmt(price, { decimals }), fmtChange(changePct));
  });
}

// ── Indices ───────────────────────────────────────────────────

const SYMBOLS = [
  { kind: "yahoo", symbol: "^GSPC", label: "S&P 500", decimals: 2 },
  { kind: "fx", base: "USD", quote: "SEK", label: "USD/SEK", decimals: 4 },
  { kind: "fx", base: "EUR", quote: "SEK", label: "EUR/SEK", decimals: 4 },
];

function formatIndexPrice(label, price, decimals) {
  return (label === "USD/SEK" || label === "EUR/SEK")
    ? price.toFixed(4) + " kr"
    : fmt(price, { decimals });
}

async function fetchIndices() {
  const results = await Promise.allSettled(
    SYMBOLS.map(s => {
      if (s.kind === "fx") {
        return fetchFx(s.base, s.quote).then(d => ({ ...s, ...d }));
      }
      return fetchYahoo(s.symbol).then(d => ({ ...s, ...d }));
    })
  );
  return results.map((r, i) => {
    if (r.status === "rejected") return makeErrorCard(SYMBOLS[i].label);
    const { label, price, changePct, decimals } = r.value;
    return makeCard(label, formatIndexPrice(label, price, decimals), fmtChange(changePct));
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
      grid.replaceChild(makeCard(label, fmt(d.price, { decimals }), fmtChange(d.changePct)), skeleton);
    }
  });

  // Indices
  SYMBOLS.forEach(({ symbol, label, decimals }) => {
    const d = getStaleData(`yahoo_${symbol}`);
    if (!d) return;
    const grid = document.getElementById("indices-grid");
    if (!grid) return;
    const idx = SYMBOLS.findIndex(s => s.symbol === symbol);
    const skeleton = grid.children[idx];
    if (skeleton?.classList.contains("skeleton")) {
      grid.replaceChild(
        makeCard(label, formatIndexPrice(label, d.price, decimals), fmtChange(d.changePct)),
        skeleton
      );
    }
  });
}

// ── Huvudorkestrering ─────────────────────────────────────────

async function fetchAll(silent = false) {
  const btn = document.getElementById("refresh-btn");
  if (btn) btn.classList.add("loading");

  if (!silent) {
    if (isSectionVisible("crypto") && !getStaleData("crypto_cache")) setSkeletons("crypto-grid", 1);
    const hasAllMetals  = METAL_SYMBOLS.every(s => getStaleData(`yahoo_${s.symbol}`));
    const hasAllIndices = SYMBOLS.every(s => {
      const key = s.kind === "fx" ? `fx_${s.base}_${s.quote}` : `yahoo_${s.symbol}`;
      return getStaleData(key);
    });
    if (isSectionVisible("metals") && !hasAllMetals)  setSkeletons("metals-grid",  METAL_SYMBOLS.length);
    if (isSectionVisible("indices") && !hasAllIndices) setSkeletons("indices-grid",  SYMBOLS.length);
  }

  const tasks = [];

  if (isSectionVisible("crypto")) {
    tasks.push(
      fetchCrypto()
        .then(d => setGrid("crypto-grid", buildCryptoCards(d)))
        .catch(() => setGrid("crypto-grid", [makeErrorCard("Bitcoin")]))
    );
  }

  if (isSectionVisible("metals")) {
    tasks.push(
      fetchMetals()
        .then(cards => setGrid("metals-grid", cards))
        .catch(() => setGrid("metals-grid", [makeErrorCard("Gold"), makeErrorCard("Silver")]))
    );
  }

  if (isSectionVisible("indices")) {
    tasks.push(
      fetchIndices()
        .then(cards => setGrid("indices-grid", cards))
        .catch(() => {})
    );
  }

  await Promise.allSettled(tasks);

  const timeEl = document.getElementById("updated-time");
  if (timeEl) timeEl.textContent = "Senast uppdaterad: " + new Date().toLocaleTimeString();
  if (btn) btn.classList.remove("loading");
}

// ── Initiering ────────────────────────────────────────────────

// 1. Visa cachad data omedelbart (noll fördröjning)
applyPrefsToUI();
renderFromCache();

// 2. Hämta färsk data — tyst om cache finns, annars med skeletons
const hasSomeCache = getStaleData("crypto_cache") ||
                     METAL_SYMBOLS.some(s => getStaleData(`yahoo_${s.symbol}`));
fetchAll(/* silent = */ !!hasSomeCache);

// 3. Refresh-knapp rensar cache och hämtar på nytt
document.getElementById("refresh-btn")?.addEventListener("click", () => {
  clearMarketCache();
  fetchAll(false);
});

// 4. Inställningar för vy och uppdateringsintervall
document.querySelectorAll("[data-section-toggle]").forEach(input => {
  input.addEventListener("change", () => {
    const section = input.getAttribute("data-section-toggle");
    if (!section) return;

    savePrefs({
      ...prefs,
      sections: {
        ...prefs.sections,
        [section]: input.checked,
      },
    });

    applyPrefsToUI();

    if (input.checked) fetchAll(true);
  });
});

document.getElementById("refresh-interval")?.addEventListener("change", event => {
  const value = Number(event.target.value);
  savePrefs({
    ...prefs,
    refreshMinutes: [1, 5, 15].includes(value) ? value : DEFAULT_PREFS.refreshMinutes,
  });
  applyPrefsToUI();
  restartAutoRefresh();
});

document.getElementById("reset-layout")?.addEventListener("click", () => {
  savePrefs(cloneDefaultPrefs());
  applyPrefsToUI();
  restartAutoRefresh();
  renderFromCache();
  fetchAll(false);
});

// 5. Auto-refresh körs tyst
restartAutoRefresh();

// 6. Uppdatera när användaren återvänder till fliken
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;

  // Kolla om senaste refresh var äldre än det valda intervallet
  const keys = getCacheKeys();
  const oldest = keys.reduce((min, key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return 0;
      return Math.min(min, JSON.parse(raw).timestamp);
    } catch { return 0; }
  }, Date.now());

  const ageSeconds = (Date.now() - oldest) / 1000;
  if (ageSeconds * 1000 > getRefreshIntervalMs()) fetchAll(true);
});