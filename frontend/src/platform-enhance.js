// BTC BigData Platform — UI enhancement layer
// Patch nhỏ: không thay đổi logic backend/API chính, chỉ nâng UX, theme và demo terminal.

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const DATA_API_BASE = (import.meta.env.VITE_DATA_API_BASE_URL || API_BASE).replace(/\/+$/, '');
const THEME_KEY = 'btc_bigdata_platform_theme_v1';
const app = document.getElementById('app');
const themeToggle = document.getElementById('themeToggle');
let lastRoute = '';
let marketStripTimer = null;

function apiUrl(endpoint) {
  const clean = String(endpoint || '').replace(/^\/+/, '');
  const dataEndpoint = clean.startsWith('api/latest')
    || clean.startsWith('api/risk-score')
    || clean.startsWith('api/p2p-comparison')
    || clean.startsWith('api/news/latest')
    || clean.startsWith('api/ohlcv')
    || clean.startsWith('api/p2p-spread')
    || clean.startsWith('api/data-reliability');
  return `${dataEndpoint ? DATA_API_BASE : API_BASE}/${clean}`;
}

function formatUSD(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function formatVND(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(n);
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function getRoute() {
  return (location.hash || '#theory').replace('#', '').split('?')[0] || 'theory';
}

function setTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  document.body?.setAttribute('data-theme', resolved);
  localStorage.setItem(THEME_KEY, resolved);
  if (themeToggle) {
    themeToggle.textContent = resolved === 'dark' ? '☀' : '☾';
    themeToggle.title = resolved === 'dark' ? 'Chuyển sang Light Mode' : 'Chuyển sang Dark Mode';
    themeToggle.setAttribute('aria-label', themeToggle.title);
  }
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const preferred = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  setTheme(stored || preferred);
  themeToggle?.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

async function safeGet(endpoint, timeoutMs = 7500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl(endpoint), { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function platformHeroHTML() {
  return `
    <section class="platform-hero" data-platform-enhanced="dashboard-hero">
      <div class="platform-hero-copy">
        <span class="platform-pill">BTC BigData Platform</span>
        <h1>Bitcoin Market Intelligence cho nhà đầu tư Việt Nam</h1>
        <p>Theo dõi BTC/USDT, spread P2P USDT/VNĐ, Risk Score, tin tức và AI Advisor trong một dashboard chuyên nghiệp. Dữ liệu phục vụ học tập và tham khảo, không phải khuyến nghị đầu tư.</p>
        <div class="platform-hero-actions">
          <a class="btn primary" href="#trade">Mở Trading Demo</a>
          <a class="btn secondary" href="#chart">Xem biểu đồ kỹ thuật</a>
          <a class="btn secondary" href="#wallet">Nạp ví QR demo</a>
        </div>
      </div>
      <div class="platform-terminal-card">
        <div class="terminal-top"><span></span><span></span><span></span><strong>BTC/USDT Terminal</strong></div>
        <div class="terminal-row"><span>Mode</span><strong>Live API + Demo fallback</strong></div>
        <div class="terminal-row"><span>Trading</span><strong>Paper trading / không tiền thật</strong></div>
        <div class="terminal-row"><span>FinTech</span><strong>AI · Big Data · P2P · QR Wallet</strong></div>
        <div class="terminal-glow"></div>
      </div>
    </section>`;
}

function marketStripSkeleton() {
  return `
    <div class="market-strip" data-platform-enhanced="market-strip">
      <div><span>BTC/USDT</span><strong>Đang tải...</strong><small>Spot price</small></div>
      <div><span>Risk Score</span><strong>—</strong><small>Market risk</small></div>
      <div><span>P2P BUY</span><strong>—</strong><small>USDT/VNĐ</small></div>
      <div><span>P2P SELL</span><strong>—</strong><small>USDT/VNĐ</small></div>
    </div>`;
}

async function refreshMarketStrip() {
  const strip = document.querySelector('[data-platform-enhanced="market-strip"]');
  if (!strip) return;
  try {
    const [latest, risk, p2p] = await Promise.all([
      safeGet('/api/latest'),
      safeGet('/api/risk-score'),
      safeGet('/api/p2p-comparison')
    ]);
    const buy = p2p?.buy?.p2p_price;
    const sell = p2p?.sell?.p2p_price;
    strip.innerHTML = `
      <div><span>BTC/USDT</span><strong>${formatUSD(latest?.close)}</strong><small>${escapeHTML(latest?.source || 'API')}</small></div>
      <div><span>Risk Score</span><strong>${risk?.score ?? '—'}/100</strong><small>${escapeHTML(risk?.label_vi || risk?.level || '—')}</small></div>
      <div><span>P2P BUY</span><strong>${formatVND(buy)}</strong><small>${formatPct(p2p?.buy?.difference_pct)} so với tham chiếu</small></div>
      <div><span>P2P SELL</span><strong>${formatVND(sell)}</strong><small>${formatPct(p2p?.sell?.difference_pct)} so với tham chiếu</small></div>
    `;
  } catch (_) {
    strip.classList.add('is-fallback');
    strip.innerHTML = `
      <div><span>BTC/USDT</span><strong>Demo fallback</strong><small>Backend đang tải</small></div>
      <div><span>Risk Score</span><strong>—</strong><small>Chờ dữ liệu</small></div>
      <div><span>P2P BUY</span><strong>—</strong><small>Chờ dữ liệu</small></div>
      <div><span>P2P SELL</span><strong>—</strong><small>Chờ dữ liệu</small></div>
    `;
  }
}

function enhanceDashboard() {
  if (!app || app.querySelector('[data-platform-enhanced="dashboard-hero"]')) return;
  app.insertAdjacentHTML('afterbegin', platformHeroHTML() + marketStripSkeleton());
  refreshMarketStrip();
}

function enhanceTradeTerminal() {
  if (!app || app.querySelector('[data-platform-enhanced="trade-pro"]')) return;
  const pageHead = app.querySelector('.page-head');
  if (!pageHead) return;
  pageHead.insertAdjacentHTML('afterend', `
    <section class="trade-pro-shell" data-platform-enhanced="trade-pro">
      <div class="trade-pro-head">
        <div>
          <span class="platform-pill">Paper Trading</span>
          <h2>Trading demo BTC/USDT + P2P</h2>
          <p>Demo mô phỏng mua/bán bằng dữ liệu thật và ví demo. Không gửi lệnh lên sàn, không dùng tiền thật.</p>
        </div>
        <div class="trade-risk-note">
          <strong>Quy tắc demo</strong>
          <span>Chia nhỏ vốn · Kiểm tra Risk Score · So sánh P2P trước khi quyết định</span>
        </div>
      </div>
      ${marketStripSkeleton()}
      <div class="trade-workflow">
        <div><strong>1</strong><span>Nạp ví QR demo</span></div>
        <div><strong>2</strong><span>Chọn mua/bán USDT</span></div>
        <div><strong>3</strong><span>Xem thực nhận, thuế, spread</span></div>
        <div><strong>4</strong><span>Lưu lịch sử mô phỏng</span></div>
      </div>
    </section>
  `);
  const split = app.querySelector('.split');
  split?.classList.add('trade-terminal-layout');
  document.getElementById('tradeSubmit')?.classList.add('trade-action-primary');
  refreshMarketStrip();
}

function enhanceWallet() {
  if (!app || app.querySelector('[data-platform-enhanced="wallet-safe"]')) return;
  const head = app.querySelector('.page-head');
  if (!head) return;
  head.insertAdjacentHTML('afterend', `
    <section class="state-box success wallet-safe-note" data-platform-enhanced="wallet-safe">
      <strong>Demo an toàn:</strong> QR và ví trong project chỉ dùng để minh họa quy trình FinTech. Không phát sinh tiền thật, không liên kết ngân hàng thật, không lưu thẻ thật.
    </section>
  `);
}

function enhanceCurrentRoute() {
  const route = getRoute();
  if (route !== lastRoute) {
    lastRoute = route;
    document.body.dataset.route = route;
  }
  if (route === 'dashboard') enhanceDashboard();
  if (route === 'trade') enhanceTradeTerminal();
  if (route === 'wallet') enhanceWallet();
  if ((route === 'dashboard' || route === 'trade') && !marketStripTimer) {
    marketStripTimer = setInterval(refreshMarketStrip, 60_000);
  }
  if (!(route === 'dashboard' || route === 'trade') && marketStripTimer) {
    clearInterval(marketStripTimer);
    marketStripTimer = null;
  }
}

function installRouteObserver() {
  window.addEventListener('hashchange', () => setTimeout(enhanceCurrentRoute, 120));
  const observer = new MutationObserver(() => enhanceCurrentRoute());
  if (app) observer.observe(app, { childList: true, subtree: false });
  setTimeout(enhanceCurrentRoute, 200);
}

initTheme();
installRouteObserver();
