const STOCK_CACHE_TTL_MS = 120_000;
const STOCKS = [
  { symbol: "TSLA", name: "Tesla, Inc.", reportFallback: "2026-10-21" },
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" },
];

function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(resource, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function getCachedStock(symbol) {
  try {
    const raw = localStorage.getItem(`stock_cache_${symbol}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > STOCK_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function setCachedStock(symbol, data) {
  try {
    localStorage.setItem(`stock_cache_${symbol}`, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {}
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dateValue);
}

function formatDaysToReport(reportDate) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(reportDate);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function parseNumberMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

function parseReportDate(text) {
  const match = text.match(/Earnings Date \(est\.\)([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i);
  return match ? match[1] : null;
}

async function fetchStockQuote(stock) {
  const cached = getCachedStock(stock.symbol);
  if (cached) return cached;

  const url = `https://r.jina.ai/http://finance.yahoo.com/quote/${stock.symbol}?p=${stock.symbol}`;
  const res = await fetchWithTimeout(url);
  const text = await res.text();

  const bid = parseNumberMatch(text, /Bid\s+([0-9]+(?:\.[0-9]+)?)\s+x\s+[0-9]+/i);
  const ask = parseNumberMatch(text, /Ask\s+([0-9]+(?:\.[0-9]+)?)\s+x\s+[0-9]+/i);
  const previousClose = parseNumberMatch(text, /Previous Close\s+([0-9]+(?:\.[0-9]+)?)/i);
  const reportDateText = parseReportDate(text);
  const reportDate = reportDateText ? new Date(reportDateText) : (stock.reportFallback ? new Date(stock.reportFallback) : null);

  const price = bid && ask ? (bid + ask) / 2 : (bid || ask || previousClose || null);
  if (!price) throw new Error("Could not read TSLA price");

  const changePct = previousClose ? ((price - previousClose) / previousClose) * 100 : null;

  const data = {
    symbol: stock.symbol,
    name: stock.name,
    price,
    bid,
    ask,
    previousClose,
    changePct,
    reportDate: reportDate ? reportDate.toISOString().slice(0, 10) : null,
    reportDateText: reportDate ? (reportDateText || formatDate(reportDate)) : "Not available",
    daysToReport: reportDate ? formatDaysToReport(reportDate) : null,
  };

  setCachedStock(stock.symbol, data);
  return data;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderStockCard(data) {
  const card = document.createElement("div");
  card.className = "stock-card";

  const changeClass = data.changePct === null || Number.isNaN(data.changePct)
    ? "flat"
    : (data.changePct >= 0 ? "up" : "down");
  const changeText = data.changePct === null || Number.isNaN(data.changePct)
    ? "—"
    : `${data.changePct >= 0 ? "+" : ""}${data.changePct.toFixed(2)}%`;
  const reportLine = data.daysToReport === null
    ? data.reportDateText
    : `${data.reportDateText} · ${data.daysToReport} days`;

  card.innerHTML = `
    <div class="stock-card-top">
      <div>
        <div class="stock-symbol">${data.symbol}</div>
        <div class="stock-name">${data.name}</div>
      </div>
      <div class="stock-top-meta">
        <span class="badge ${changeClass}">${changeText}</span>
        <div class="stock-prev-close">Prev close ${data.previousClose ? formatMoney(data.previousClose) : "—"}</div>
      </div>
    </div>
    <div class="stock-price">${formatMoney(data.price)}</div>
    <div class="stock-meta">
      <span>Next report</span>
      <strong>${reportLine}</strong>
    </div>
  `;

  return card;
}

async function refreshStock() {
  const button = document.getElementById("refresh-stock-btn");
  if (button) button.classList.add("loading");

  try {
    const grid = document.getElementById("stocks-grid");
    if (!grid) return;

    grid.innerHTML = "";

    const results = await Promise.allSettled(STOCKS.map(stock => fetchStockQuote(stock)));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        grid.appendChild(renderStockCard(result.value));
      } else {
        const card = document.createElement("div");
        card.className = "stock-card";
        card.innerHTML = `
          <div class="stock-card-top">
            <div>
              <div class="stock-symbol">${STOCKS[index].symbol}</div>
              <div class="stock-name">${STOCKS[index].name}</div>
            </div>
            <div class="stock-top-meta">
              <span class="badge flat">—</span>
              <div class="stock-prev-close">Prev close —</div>
            </div>
          </div>
          <div class="stock-price">Unavailable</div>
          <div class="stock-meta"><span>Next report</span><strong>—</strong></div>
        `;
        grid.appendChild(card);
      }
    });

    setText("stock-note", "Tesla is shown first. Add more stocks by editing the STOCKS array in stock.js.");
  } catch (error) {
    setText("stock-note", String(error?.message || error));
  } finally {
    if (button) button.classList.remove("loading");
  }
}

document.getElementById("refresh-stock-btn")?.addEventListener("click", () => {
  try {
    STOCKS.forEach(stock => localStorage.removeItem(`stock_cache_${stock.symbol}`));
  } catch {}
  refreshStock();
});

refreshStock();
