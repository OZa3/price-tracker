# 📈 Market Price Tracker

A clean, lightweight website that shows live prices for Bitcoin, Ethereum, Gold, Silver, S&P 500, and more. No backend required — runs entirely in the browser.

**Live data sources:**
- 🪙 Crypto → [CoinGecko](https://www.coingecko.com) (free, no API key)
- 🥇 Metals → [metals.live](https://metals.live) (free, no API key)
- 📊 Indices → Yahoo Finance (via CORS proxy)

**Features:**
- Auto-refreshes every 60 seconds
- Manual refresh button
- 24h % change badges
- Dark mode support
- Mobile-friendly

---

## 🚀 Deploy to GitHub Pages (free)

### Step 1 — Create a GitHub repository

1. Go to [github.com](https://github.com) and sign in (create a free account if you don't have one)
2. Click the **+** button → **New repository**
3. Name it `price-tracker` (or anything you like)
4. Leave it **Public**
5. Click **Create repository**

### Step 2 — Upload the files

You have two options:

**Option A — Upload via browser (easiest):**
1. In your new repo, click **Add file → Upload files**
2. Drag and drop all 3 files: `index.html`, `style.css`, `app.js`
3. Click **Commit changes**

**Option B — Via Git (if you have it installed):**
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/price-tracker.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

1. In your repo, go to **Settings** → **Pages** (in the left sidebar)
2. Under **Source**, select **Deploy from a branch**
3. Choose branch: `main`, folder: `/ (root)`
4. Click **Save**

### Step 4 — Visit your site

After ~1 minute, your site will be live at:
```
https://YOUR_USERNAME.github.io/price-tracker/
```

---

## 🛠 Customization

**Add more cryptos:** Edit the `ids` variable in `app.js` (use CoinGecko IDs like `dogecoin`, `cardano`, etc.)

**Change refresh interval:** Edit `REFRESH_INTERVAL_MS` in `app.js` (value is in milliseconds)

**Add more metals:** Edit the URL in `fetchMetals()` — supported: `gold`, `silver`, `platinum`, `palladium`
