// BTC BigData Platform — Enhancement layer v2
// Patch nhỏ: thêm Exchange links, News banner, Notifications, Enter-to-submit,
// Decision Hub nâng cao, Paper Exchange, dark-mode fixes và tooltip advice.

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const DATA_API_BASE = (import.meta.env.VITE_DATA_API_BASE_URL || API_BASE).replace(/\/+$/, '');
const THEME_KEY = 'btc_bigdata_platform_theme_v1';
const NOTI_KEY = 'btc_bigdata_notifications_v2';
const EXCHANGE_KEY = 'btc_bigdata_paper_exchange_v2';
const PORTFOLIO_KEY = 'btc_bigdata_portfolio_v2';
const DECISION_ALERT_KEY = 'btc_bigdata_smart_alerts_v2';
const app = document.getElementById('app');
const themeToggle = document.getElementById('themeToggle');
let lastRoute = '';
let marketStripTimer = null;
let newsBannerTimer = null;
let chartAdviceBound = false;
let marketContextPromise = null;
let marketContextCache = null;
let marketContextCacheAt = 0;
const SAFE_GET_INFLIGHT = new Map();
const SAFE_GET_CACHE = new Map();
const SAFE_GET_TTL = {
  '/api/latest': 20000,
  '/api/risk-score': 60000,
  '/api/p2p-comparison': 120000,
  '/api/p2p-spread': 120000,
  '/api/news/latest': 600000,
  '/api/data-status': 300000,
  '/api/data-reliability': 300000,
  '/api/ohlcv': 300000
};

function apiUrl(endpoint, base = API_BASE) {
  return `${base}/${String(endpoint || '').replace(/^\/+/, '')}`;
}

function dataUrl(endpoint) {
  return apiUrl(endpoint, DATA_API_BASE);
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

function formatBTC(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(n >= 1 ? 4 : 8)} BTC`;
}

function formatNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(n);
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

function isLoggedIn() {
  const text = document.getElementById('authBox')?.textContent || '';
  return /đăng xuất|@|logout/i.test(text);
}

function setTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  document.body?.setAttribute('data-theme', resolved);
  localStorage.setItem(THEME_KEY, resolved);
  document.documentElement.style.colorScheme = resolved;
  window.dispatchEvent(new CustomEvent('btc:themechange', { detail: { theme: resolved } }));
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

function safeGetTtl(endpoint) {
  const clean = String(endpoint || '').split('?')[0];
  return SAFE_GET_TTL[clean] || 30000;
}

async function safeGet(endpoint, timeoutMs = 7500, base = DATA_API_BASE) {
  // Dùng chung fetch/cache của main.js để lớp enhancement không gọi lại cùng API.
  if (typeof window.__btcFetchJson === 'function' && (base === DATA_API_BASE || base === API_BASE)) {
    const result = await window.__btcFetchJson(endpoint, { timeout: timeoutMs });
    return result?.data;
  }

  const url = apiUrl(endpoint, base);
  const cacheKey = `${url}|anon`;
  const now = Date.now();
  const ttl = safeGetTtl(endpoint);
  const sharedCache = window.__btcSharedGetCache || SAFE_GET_CACHE;
  const sharedInflight = window.__btcSharedGetInflight || SAFE_GET_INFLIGHT;
  const cached = sharedCache.get(cacheKey);
  if (cached && now - cached.at < ttl) return cached.payload?.data ?? cached.data;
  if (sharedInflight.has(cacheKey)) {
    const result = await sharedInflight.get(cacheKey);
    return result?.data ?? result?.payload?.data ?? result;
  }

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      sharedCache.set(cacheKey, { at: Date.now(), data });
      return data;
    } catch (error) {
      if (cached) return cached.payload?.data ?? cached.data;
      throw error;
    } finally {
      clearTimeout(timer);
      sharedInflight.delete(cacheKey);
    }
  })();

  sharedInflight.set(cacheKey, request);
  return request;
}

async function safePost(endpoint, body, timeoutMs = 30000, base = API_BASE) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl(endpoint, base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof window.__btcAuthHeader === 'function' ? window.__btcAuthHeader() : {})
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { answer: text }; }
    if (!res.ok) throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function showLocalToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showLocalToast._timer);
  showLocalToast._timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function addNotification(title, message, type = 'info', actionHash = '') {
  const items = readJson(NOTI_KEY, []);
  items.unshift({ id: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, title, message, type, actionHash, read: false, createdAt: new Date().toISOString() });
  writeJson(NOTI_KEY, items.slice(0, 80));
  refreshNotificationBadge();
}

function notifications() {
  return readJson(NOTI_KEY, []);
}

function unreadCount() {
  return notifications().filter(n => !n.read).length;
}

function markNotificationsRead() {
  writeJson(NOTI_KEY, notifications().map(n => ({ ...n, read: true })));
  refreshNotificationBadge();
}

function clearNotifications() {
  writeJson(NOTI_KEY, []);
  refreshNotificationBadge();
  renderNotificationPanel();
}

function refreshNotificationBadge() {
  const badge = document.getElementById('platformNotifyCount');
  if (!badge) return;
  const count = unreadCount();
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.hidden = count <= 0;
}

function installTopActions() {
  const actions = document.querySelector('.top-actions');
  if (!actions || document.getElementById('platformExchangeLink')) return;

  const exchange = document.createElement('a');
  exchange.id = 'platformExchangeLink';
  exchange.className = 'btn small exchange-real-link';
  exchange.href = 'https://www.binance.com/en/trade/BTC_USDT?type=spot';
  exchange.target = '_blank';
  exchange.rel = 'noopener noreferrer';
  exchange.title = 'Mở sàn giao dịch thật ở tab mới';
  exchange.innerHTML = '↗ Sàn BTC thật';

  const notify = document.createElement('button');
  notify.id = 'platformNotifyBtn';
  notify.className = 'platform-notify-btn';
  notify.type = 'button';
  notify.title = 'Thông báo giao dịch, cảnh báo và dữ liệu';
  notify.innerHTML = '🔔 <span id="platformNotifyCount" hidden>0</span>';

  const demo = actions.querySelector('.btn.small.primary');
  actions.insertBefore(exchange, demo || actions.firstChild);
  actions.insertBefore(notify, exchange.nextSibling);
  notify.addEventListener('click', () => {
    document.body.classList.toggle('platform-notify-open');
    renderNotificationPanel();
    markNotificationsRead();
  });

  refreshNotificationBadge();
}

function installNotificationPanel() {
  if (document.getElementById('platformNotificationPanel')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <aside id="platformNotificationPanel" class="platform-notification-panel" aria-label="Thông báo">
      <div class="platform-notification-head">
        <div><strong>Thông báo</strong><span>Giao dịch demo, cảnh báo email, dữ liệu và tài khoản</span></div>
        <button type="button" id="platformNotificationClose">×</button>
      </div>
      <div id="platformNotificationList" class="platform-notification-list"></div>
      <div class="platform-notification-foot">
        <button class="btn secondary small" id="platformClearNotifications">Xóa tất cả</button>
        <a class="btn small" href="#alerts">Cảnh báo Email</a>
      </div>
    </aside>
  `);
  document.getElementById('platformNotificationClose')?.addEventListener('click', () => document.body.classList.remove('platform-notify-open'));
  document.getElementById('platformClearNotifications')?.addEventListener('click', clearNotifications);
}

function renderNotificationPanel() {
  const list = document.getElementById('platformNotificationList');
  if (!list) return;
  const items = notifications();
  if (!items.length) {
    list.innerHTML = `<div class="platform-empty-note">Chưa có thông báo. Khi bạn tạo giao dịch demo, cảnh báo hoặc thanh toán sandbox, thông báo sẽ xuất hiện tại đây.</div>`;
    return;
  }
  list.innerHTML = items.map(item => `
    <a class="platform-notification-item ${item.read ? '' : 'unread'}" href="${escapeHTML(item.actionHash || '#')}">
      <span class="platform-noti-icon">${item.type === 'trade' ? '↔' : item.type === 'alert' ? '🔔' : item.type === 'payment' ? '💳' : 'ℹ'}</span>
      <span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.message)}</small><em>${new Date(item.createdAt).toLocaleString('vi-VN')}</em></span>
    </a>
  `).join('');
}

function installNavLinks() {
  const toolsMenu = document.querySelector('[data-nav-group="tools"] .nav-dropdown-menu');
  if (toolsMenu && !toolsMenu.querySelector('[data-route="decision"]')) {
    toolsMenu.insertAdjacentHTML('afterbegin', `
      <a href="#decision" data-route="decision">Decision Hub</a>
      <a href="#paper-exchange" data-route="paper-exchange">Sàn giao dịch ảo</a>
    `);
  }
  const toolGroup = document.querySelector('[data-nav-group="tools"]');
  if (toolGroup) {
    const routes = new Set((toolGroup.dataset.routes || '').split(',').map(x => x.trim()).filter(Boolean));
    routes.add('decision'); routes.add('paper-exchange');
    toolGroup.dataset.routes = Array.from(routes).join(',');
  }
  const side = document.getElementById('sideNav');
  if (side && !side.querySelector('[data-route="decision"]')) {
    const tradeLink = side.querySelector('[data-route="trade"]');
    const html = `
      <a href="#decision" data-route="decision"><span>🎯</span>Decision Hub</a>
      <a href="#paper-exchange" data-route="paper-exchange"><span>🏦</span>Sàn giao dịch ảo</a>
    `;
    tradeLink?.insertAdjacentHTML('beforebegin', html);
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
          <a class="btn primary" href="#decision">Ra quyết định</a>
          <a class="btn secondary" href="#paper-exchange">Sàn giao dịch ảo</a>
          <a class="btn secondary" href="https://www.binance.com/en/trade/BTC_USDT?type=spot" target="_blank" rel="noopener noreferrer">↗ Sàn BTC thật</a>
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

async function getMarketContext(force = false) {
  const now = Date.now();
  if (!force && marketContextCache && now - marketContextCacheAt < 20000) return marketContextCache;
  if (!force && marketContextPromise) return marketContextPromise;

  marketContextPromise = (async () => {
    const [latest, risk, p2p] = await Promise.allSettled([
      safeGet('/api/latest', 6500, DATA_API_BASE),
      safeGet('/api/risk-score', 6500, DATA_API_BASE),
      safeGet('/api/p2p-comparison', 6500, DATA_API_BASE)
    ]);
    const ctx = {
      latest: latest.status === 'fulfilled' ? latest.value : marketContextCache?.latest || null,
      risk: risk.status === 'fulfilled' ? risk.value : marketContextCache?.risk || null,
      p2p: p2p.status === 'fulfilled' ? p2p.value : marketContextCache?.p2p || null
    };
    marketContextCache = ctx;
    marketContextCacheAt = Date.now();
    return ctx;
  })();

  try {
    return await marketContextPromise;
  } finally {
    marketContextPromise = null;
  }
}

async function refreshMarketStrip() {
  const strip = document.querySelector('[data-platform-enhanced="market-strip"]');
  if (!strip) return;
  try {
    const { latest, risk, p2p } = await getMarketContext();
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
  }
}

async function enhanceNewsBanner() {
  if (!app || app.querySelector('[data-platform-enhanced="news-banner"]')) return;
  const anchor = app.querySelector('[data-platform-enhanced="market-strip"]') || app.querySelector('.page-head');
  if (!anchor) return;

  anchor.insertAdjacentHTML('afterend', `
    <section class="news-visual-banner binance-news-banner" data-platform-enhanced="news-banner" aria-label="Tin tức Bitcoin nổi bật">
      <div class="bn-news-header">
        <div>
          <span class="bn-news-kicker">BTC News Spotlight</span>
          <h2>Tin tức thị trường nổi bật</h2>
          <p>Tự động lướt tin mới, bấm vào từng tin để mở bài viết hoặc xem trang tin tức.</p>
        </div>
        <a class="bn-news-all" href="#news">Xem tất cả tin tức</a>
      </div>
      <div class="bn-news-shell">
        <button class="bn-news-nav bn-news-prev" type="button" aria-label="Tin trước">‹</button>
        <div class="bn-news-viewport">
          <div id="newsVisualTrack" class="bn-news-slider"><div class="news-visual-skeleton">Đang tải banner tin tức...</div></div>
        </div>
        <button class="bn-news-nav bn-news-next" type="button" aria-label="Tin tiếp">›</button>
        <aside id="newsVisualSide" class="bn-news-side"></aside>
      </div>
      <div id="newsVisualDots" class="bn-news-dots"></div>
    </section>
  `);

  const section = app.querySelector('[data-platform-enhanced="news-banner"]');
  try {
    const res = await safeGet('/api/news/latest?limit=8', 10000, DATA_API_BASE);
    const items = normalizeNewsItems(res).slice(0, 8);
    if (!items.length) throw new Error('empty');
    startNewsSpotlight(section, items);
  } catch {
    startNewsSpotlight(section, fallbackNewsItems());
  }
}

function normalizeNewsItems(res) {
  return (res?.data || res?.items || res?.news || []).map((item, index) => ({
    title: item.title || `Tin Bitcoin #${index + 1}`,
    summary: item.summary || item.description || item.snippet || 'Bấm để xem chi tiết tin tức và bối cảnh ảnh hưởng đến thị trường Bitcoin.',
    source: item.source || item.provider || item.author || 'BTC News',
    link: item.link || item.url || '#news',
    published_at: item.published_at || item.publishedAt || item.date || '',
    image: item.image || item.image_url || item.thumbnail || item.urlToImage || ''
  }));
}

function fallbackNewsItems() {
  return [
    { title: 'Bitcoin biến động mạnh, nhà đầu tư cần theo dõi rủi ro trước khi mua', source: 'BTC BigData', summary: 'Kết hợp giá BTC/USDT, P2P spread và Risk Score giúp người dùng đánh giá bối cảnh thị trường tốt hơn.', link: '#risk' },
    { title: 'P2P spread ảnh hưởng trực tiếp đến số VNĐ thực nhận', source: 'BTC BigData', summary: 'Giá quốc tế tăng chưa chắc người bán nhận được nhiều VNĐ nếu chênh lệch P2P thay đổi bất lợi.', link: '#p2p' },
    { title: 'AI Advisor giúp diễn giải RSI, MACD và EMA bằng tiếng Việt', source: 'AI Demo', summary: 'Người mới có thể hiểu tín hiệu kỹ thuật nhanh hơn nhưng kết quả chỉ nên dùng để tham khảo.', link: '#chat' },
    { title: 'Sàn giao dịch ảo giúp luyện tập chiến lược không mất tiền thật', source: 'Paper Exchange', summary: 'Người dùng có thể thử mua/bán BTC bằng tiền demo trước khi ra quyết định ngoài thị trường thật.', link: '#paper-exchange' }
  ];
}

function newsCoverURL(item, index) {
  const img = item.image || '';
  if (img && /^https?:\/\//i.test(img)) return img;
  const palettes = [
    ['#f0b90b', '#181a20', '#fcd535'],
    ['#1e40af', '#020617', '#60a5fa'],
    ['#047857', '#052e16', '#34d399'],
    ['#7c2d12', '#111827', '#fb923c'],
    ['#581c87', '#0f172a', '#c084fc']
  ];
  const [a, b, c] = palettes[index % palettes.length];
  const title = escapeHTML(item.title || 'BTC News').replace(/&/g, '&amp;').slice(0, 64);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
      <radialGradient id="r" cx="70%" cy="25%" r="65%"><stop stop-color="${c}" stop-opacity=".7"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="1200" height="760" fill="url(#g)"/>
    <rect width="1200" height="760" fill="url(#r)"/>
    <g opacity=".18" stroke="#fff" stroke-width="2">
      <path d="M70 620 C180 520 260 560 360 450 S540 320 650 390 820 500 930 310 1060 240 1150 280" fill="none"/>
      <path d="M70 520 C190 440 300 460 430 350 S610 280 760 320 900 420 1130 190" fill="none"/>
      <path d="M120 680 L1080 680 M120 560 L1080 560 M120 440 L1080 440 M120 320 L1080 320 M120 200 L1080 200"/>
    </g>
    <circle cx="930" cy="210" r="138" fill="#fff" opacity=".11" filter="url(#blur)"/>
    <circle cx="910" cy="220" r="92" fill="${c}" opacity=".85"/>
    <text x="910" y="258" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="112" font-weight="900" fill="#fff">₿</text>
    <text x="72" y="112" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" fill="#fff" opacity=".92">BTC BIGDATA NEWS</text>
    <foreignObject x="70" y="480" width="820" height="190">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,Helvetica,sans-serif;color:white;font-size:46px;font-weight:900;line-height:1.08;text-shadow:0 8px 22px rgba(0,0,0,.35)">${title}</div>
    </foreignObject>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function startNewsSpotlight(section, items) {
  if (!section) return;
  clearInterval(newsBannerTimer);
  const slider = section.querySelector('#newsVisualTrack');
  const side = section.querySelector('#newsVisualSide');
  const dots = section.querySelector('#newsVisualDots');
  const prev = section.querySelector('.bn-news-prev');
  const next = section.querySelector('.bn-news-next');
  let active = 0;
  const safeItems = items.slice(0, 8);

  slider.innerHTML = safeItems.map((item, index) => newsSlideHTML(item, index)).join('');
  side.innerHTML = safeItems.slice(0, 4).map((item, index) => newsSideHTML(item, index)).join('');
  dots.innerHTML = safeItems.map((_, index) => `<button type="button" class="bn-news-dot" data-news-index="${index}" aria-label="Chuyển đến tin ${index + 1}"></button>`).join('');

  const paint = () => {
    if (!section.isConnected) return;
    slider.style.transform = `translateX(-${active * 100}%)`;
    section.querySelectorAll('[data-news-index]').forEach(el => el.classList.toggle('active', Number(el.dataset.newsIndex) === active));
  };
  const go = (index) => {
    active = (index + safeItems.length) % safeItems.length;
    paint();
  };

  section.querySelectorAll('[data-news-index]').forEach(el => el.addEventListener('click', () => go(Number(el.dataset.newsIndex))));
  prev?.addEventListener('click', () => go(active - 1));
  next?.addEventListener('click', () => go(active + 1));
  section.addEventListener('mouseenter', () => section.dataset.paused = '1');
  section.addEventListener('mouseleave', () => section.dataset.paused = '0');

  paint();
  newsBannerTimer = setInterval(() => {
    if (!section.isConnected) return clearInterval(newsBannerTimer);
    if (document.hidden || section.dataset.paused === '1') return;
    go(active + 1);
  }, 5200);
}

function newsSlideHTML(item, index) {
  const href = item.link || item.url || '#news';
  const external = /^https?:\/\//i.test(href);
  const source = item.source || item.provider || 'BTC News';
  const title = item.title || 'Tin tức Bitcoin';
  const summary = item.summary || item.description || 'Bấm để xem nội dung tin tức và tác động đến thị trường Bitcoin.';
  const cover = newsCoverURL(item, index);
  return `
    <a class="bn-news-slide" href="${escapeHTML(href)}" ${external ? 'target="_blank" rel="noopener noreferrer"' : ''}>
      <img class="bn-news-cover" src="${escapeHTML(cover)}" alt="${escapeHTML(title)}" loading="lazy" />
      <div class="bn-news-overlay"></div>
      <div class="bn-news-content">
        <span class="bn-news-source">${escapeHTML(source)}</span>
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(summary).slice(0, 190)}${summary.length > 190 ? '...' : ''}</p>
      </div>
    </a>`;
}

function newsSideHTML(item, index) {
  const title = item.title || 'Tin tức Bitcoin';
  const source = item.source || item.provider || 'BTC News';
  return `
    <button type="button" class="bn-news-side-item" data-news-index="${index}">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <strong>${escapeHTML(title)}</strong>
      <small>${escapeHTML(source)}</small>
    </button>`;
}

function enhanceDashboard() {
  if (!app) return;
  if (!app.querySelector('[data-platform-enhanced="dashboard-hero"]')) {
    app.insertAdjacentHTML('afterbegin', platformHeroHTML() + marketStripSkeleton());
    refreshMarketStrip();
  }
  enhanceNewsBanner();
}

function ensureProtectedFeature(routeName) {
  if (isLoggedIn()) return true;
  app.innerHTML = `
    <section class="platform-auth-required">
      <span class="platform-pill">Yêu cầu đăng nhập</span>
      <h1>${routeName === 'paper-exchange' ? 'Sàn giao dịch ảo' : 'Decision Hub'} cần tài khoản</h1>
      <p>Các tính năng ra quyết định, giao dịch demo, danh mục và tính thực nhận dùng dữ liệu cá nhân trong trình duyệt/tài khoản nên cần đăng nhập trước.</p>
      <div class="platform-hero-actions"><a class="btn primary" href="#login?next=${encodeURIComponent(routeName)}">Đăng nhập để tiếp tục</a><a class="btn secondary" href="#dashboard">Về Dashboard</a></div>
    </section>`;
  return false;
}

function decisionCockpitSkeleton() {
  return `
    <div class="decision-cockpit-card skeleton-card"><span>Giá BTC</span><strong>Đang tải...</strong><small>Đồng bộ dữ liệu thị trường</small></div>
    <div class="decision-cockpit-card skeleton-card"><span>Risk Score</span><strong>—/100</strong><small>Đánh giá mức biến động</small></div>
    <div class="decision-cockpit-card skeleton-card"><span>Động lượng</span><strong>RSI —</strong><small>RSI · MACD · EMA</small></div>
    <div class="decision-cockpit-card skeleton-card"><span>P2P USDT/VNĐ</span><strong>Đang tải...</strong><small>BUY · SELL · Spread</small></div>`;
}

function decisionFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function decisionFreshness(timestamp) {
  if (!timestamp) return { label: 'Chưa rõ thời gian', tone: 'unknown', minutes: null };
  const date = new Date(String(timestamp).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return { label: 'Thời gian không hợp lệ', tone: 'unknown', minutes: null };
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes <= 90) return { label: `Cập nhật ${minutes} phút trước`, tone: 'fresh', minutes };
  if (minutes <= 360) return { label: `Chậm ${minutes} phút`, tone: 'delayed', minutes };
  return { label: `Dữ liệu cũ ${minutes} phút`, tone: 'stale', minutes };
}

function decisionSignalLabel(latest) {
  const close = decisionFinite(latest?.close);
  const ema50 = decisionFinite(latest?.ema_50, latest?.ema50);
  const macdHist = decisionFinite(latest?.macd_hist, latest?.macd_histogram);
  const rsi = decisionFinite(latest?.rsi_14, latest?.rsi14, latest?.rsi);
  const parts = [];
  if (close != null && ema50 != null) parts.push(close >= ema50 ? 'Giá trên EMA50' : 'Giá dưới EMA50');
  if (macdHist != null) parts.push(macdHist >= 0 ? 'MACD dương' : 'MACD âm');
  if (rsi != null) parts.push(rsi >= 70 ? 'RSI quá mua' : rsi <= 30 ? 'RSI quá bán' : 'RSI trung tính');
  return parts.length ? parts : ['Chưa đủ dữ liệu kỹ thuật'];
}

async function refreshDecisionCockpit(force = false) {
  const cockpit = document.getElementById('decisionCockpit');
  const freshnessBox = document.getElementById('decisionFreshness');
  const refreshBtn = document.getElementById('decisionRefreshBtn');
  if (!cockpit) return;
  refreshBtn?.setAttribute('disabled', 'disabled');
  refreshBtn?.classList.add('is-loading');
  try {
    const { latest, risk, p2p } = await getMarketContext(force);
    const close = decisionFinite(latest?.close);
    const open = decisionFinite(latest?.open);
    const changePct = decisionFinite(latest?.change_pct, latest?.price_change_percent, latest?.change_24h_pct,
      close != null && open ? ((close - open) / open) * 100 : null);
    const rsi = decisionFinite(latest?.rsi_14, latest?.rsi14, latest?.rsi);
    const macdHist = decisionFinite(latest?.macd_hist, latest?.macd_histogram);
    const score = Math.max(0, Math.min(100, decisionFinite(risk?.score) ?? 0));
    const riskLabel = risk?.label_vi || risk?.level || (score >= 70 ? 'Cao' : score >= 40 ? 'Trung bình' : 'Thấp');
    const buy = decisionFinite(p2p?.buy?.p2p_price);
    const sell = decisionFinite(p2p?.sell?.p2p_price);
    const p2pGap = buy != null && sell != null ? buy - sell : null;
    const timestamp = latest?.timestamp || latest?.time || latest?.datetime || latest?.open_time;
    const fresh = decisionFreshness(timestamp);
    const technical = decisionSignalLabel(latest);
    const completeCount = [close, rsi, decisionFinite(risk?.score), buy, sell].filter(value => value != null).length;

    if (freshnessBox) {
      freshnessBox.className = `decision-freshness ${fresh.tone}`;
      freshnessBox.textContent = `${fresh.label} · ${completeCount}/5 nhóm dữ liệu sẵn sàng`;
    }

    cockpit.innerHTML = `
      <article class="decision-cockpit-card price-card">
        <div class="decision-cockpit-icon">₿</div>
        <div><span>BTC/USDT hiện tại</span><strong>${formatUSD(close)}</strong>
          <small class="${changePct != null && changePct >= 0 ? 'positive-text' : 'negative-text'}">${changePct == null ? 'Chưa có biến động' : `${formatPct(changePct)} so với giá mở`}</small></div>
      </article>
      <article class="decision-cockpit-card risk-card">
        <div class="decision-risk-gauge" style="--decision-score:${score}"><div><strong>${formatNumber(score, 0)}</strong><span>/100</span></div></div>
        <div><span>Risk Score</span><strong>${escapeHTML(String(riskLabel))}</strong><small>${score >= 70 ? 'Ưu tiên bảo toàn vốn' : score >= 40 ? 'Nên chia nhỏ vị thế' : 'Vẫn cần đặt giới hạn rủi ro'}</small></div>
      </article>
      <article class="decision-cockpit-card momentum-card">
        <div class="decision-rsi-meter"><span style="--rsi-height:${rsi == null ? 0 : Math.max(0, Math.min(100, rsi))}%"></span></div>
        <div><span>Động lượng kỹ thuật</span><strong>RSI ${rsi == null ? '—' : formatNumber(rsi, 2)}</strong><small>${technical.map(escapeHTML).join(' · ')}${macdHist == null ? '' : ` · Hist ${formatNumber(macdHist, 2)}`}</small></div>
      </article>
      <article class="decision-cockpit-card p2p-card">
        <div class="decision-p2p-pair"><span>BUY<strong>${formatVND(buy)}</strong></span><span>SELL<strong>${formatVND(sell)}</strong></span></div>
        <div><span>P2P USDT/VNĐ</span><strong>${p2pGap == null ? 'Chưa đủ dữ liệu' : `Chênh ${formatVND(Math.abs(p2pGap))}`}</strong><small>${escapeHTML(p2p?.source || 'Nguồn dữ liệu P2P')}</small></div>
      </article>`;
  } catch (error) {
    cockpit.innerHTML = `<div class="decision-cockpit-error">Không tải được bảng tổng quan: ${escapeHTML(error.message)}</div>`;
    if (freshnessBox) {
      freshnessBox.className = 'decision-freshness stale';
      freshnessBox.textContent = 'Không kiểm tra được độ mới dữ liệu';
    }
  } finally {
    refreshBtn?.removeAttribute('disabled');
    refreshBtn?.classList.remove('is-loading');
  }
}

function renderDecisionHub() {
  if (!ensureProtectedFeature('decision')) return;
  app.innerHTML = `
    <section class="page-head platform-decision-head decision-command-hero" data-platform-route="decision">
      <div>
        <span class="eyebrow">Decision Hub · Dữ liệu → Phân tích → Hành động</span>
        <h1>Trung tâm hỗ trợ quyết định Bitcoin</h1>
        <p class="lead">Theo dõi bối cảnh thị trường, lập kế hoạch, mô phỏng danh mục và hỏi AI trên cùng một luồng. Hệ thống không gửi lệnh thật và không cam kết lợi nhuận.</p>
        <div class="decision-hero-pills"><span>Live context</span><span>Rule-based Risk</span><span>AI theo câu hỏi</span><span>Paper only</span></div>
      </div>
      <div class="decision-command-side">
        <div class="decision-command-status"><i></i><div><strong>Dữ liệu quyết định</strong><small id="decisionFreshness" class="decision-freshness unknown">Đang kiểm tra độ mới...</small></div></div>
        <div class="platform-hero-actions"><button class="btn secondary" id="decisionRefreshBtn" type="button">↻ Làm mới dữ liệu</button><a class="btn primary" href="#paper-exchange">Mở sàn giao dịch ảo</a></div>
      </div>
    </section>

    <section class="decision-cockpit-shell" aria-label="Tổng quan dữ liệu quyết định">
      <div class="decision-section-heading"><div><span class="decision-section-kicker">Bước 0</span><h2>Ảnh chụp thị trường trước khi quyết định</h2><p>Đọc nhanh giá, mức rủi ro, động lượng và chênh lệch P2P.</p></div><span class="decision-data-note">Không dùng dữ liệu giả khi backend mất kết nối</span></div>
      <div id="decisionCockpit" class="decision-cockpit-grid">${decisionCockpitSkeleton()}</div>
    </section>

    <nav class="decision-flow-nav" aria-label="Các bước trong Decision Hub">
      <button type="button" data-decision-target="decisionPlanCard"><b>1</b><span>Lập kế hoạch</span></button>
      <button type="button" data-decision-target="decisionPortfolioCard"><b>2</b><span>Theo dõi PnL</span></button>
      <button type="button" data-decision-target="decisionAlertCard"><b>3</b><span>Đặt cảnh báo</span></button>
      <button type="button" data-decision-target="decisionRealCard"><b>4</b><span>Tính VNĐ</span></button>
      <button type="button" data-decision-target="decisionAiCard"><b>5</b><span>Hỏi AI</span></button>
    </nav>

    <section class="decision-pro-grid">
      ${buySellPlannerHTML()}
      ${portfolioTrackerHTML()}
      ${smartAlertHTML()}
      ${realReceivedHTML()}
      ${aiTradeExplanationHTML()}
    </section>

    <section class="decision-safe-note"><strong>Lưu ý sử dụng</strong><span>Kết quả chỉ hỗ trợ học tập và mô phỏng. Không all-in, không vay tiền và luôn kiểm tra độ mới của dữ liệu trước khi ra quyết định.</span></section>
  `;
  bindDecisionHub();
  refreshDecisionCockpit();
  renderPortfolioState();
  renderSmartAlerts();
}

function buySellPlannerHTML() {
  return `
    <article class="decision-card decision-wide decision-work-card" id="decisionPlanCard"><div class="decision-card-title"><div class="decision-step">1</div><div><span class="decision-card-kicker">Kế hoạch vốn</span><h2>Buy/Sell Plan Builder</h2><p>Lập kế hoạch trước khi vào lệnh, không gửi lệnh thật.</p></div></div>
      <div class="form-grid compact">
        <label>Hành động<select id="planAction"><option value="buy">Mua BTC</option><option value="sell">Bán BTC</option><option value="watch">Quan sát thêm</option></select></label>
        <label>Vốn/Số lượng<input id="planAmount" type="number" min="0" value="5000000"></label>
        <label>Đơn vị<select id="planUnit"><option value="vnd">VNĐ</option><option value="btc">BTC</option></select></label>
        <label>Khẩu vị rủi ro<select id="planRisk"><option value="safe">An toàn</option><option value="medium" selected>Trung bình</option><option value="aggressive">Rủi ro cao</option></select></label>
      </div>
      <button class="btn primary full" id="buildPlanBtn">Tạo kế hoạch tham khảo</button>
      <div id="planResult" class="decision-result muted">Kết quả sẽ hiển thị tại đây.</div>
    </article>`;
}

function portfolioTrackerHTML() {
  return `
    <article class="decision-card decision-work-card" id="decisionPortfolioCard"><div class="decision-card-title"><div class="decision-step blue">2</div><div><span class="decision-card-kicker">Danh mục demo</span><h2>Portfolio PnL Tracker</h2><p>Lưu danh mục demo trong trình duyệt để theo dõi giá vốn/lãi lỗ.</p></div></div>
      <div id="portfolioKpis" class="portfolio-kpis"></div>
      <div class="form-grid compact">
        <label>Loại<select id="pfSide"><option value="buy">Mua BTC</option><option value="sell">Bán BTC</option></select></label>
        <label>Số tiền VNĐ<input id="pfAmount" type="number" min="0" value="1000000"></label>
        <label>Ghi chú<input id="pfNote" placeholder="VD: DCA tuần 1"></label>
      </div>
      <div class="button-row"><button class="btn primary" id="pfAddBtn">Thêm giao dịch demo</button><button class="btn secondary" id="pfClearBtn">Xóa danh mục</button></div>
      <div id="portfolioList" class="portfolio-list"></div>
    </article>`;
}

function smartAlertHTML() {
  return `
    <article class="decision-card decision-work-card" id="decisionAlertCard"><div class="decision-card-title"><div class="decision-step amber">3</div><div><span class="decision-card-kicker">Theo dõi điều kiện</span><h2>Smart Alert Center</h2><p>Cảnh báo cục bộ theo dữ liệu hiện tại. Muốn gửi email tự động, dùng trang Cảnh báo Email.</p></div></div>
      <div class="form-grid compact">
        <label>Metric<select id="alertMetric"><option value="price">BTC/USDT</option><option value="risk">Risk Score</option><option value="p2pBuy">P2P BUY</option><option value="p2pSell">P2P SELL</option></select></label>
        <label>Điều kiện<select id="alertOp"><option value="gt">Lớn hơn</option><option value="lt">Nhỏ hơn</option></select></label>
        <label>Ngưỡng<input id="alertValue" type="number" placeholder="VD: 65000"></label>
      </div>
      <div class="button-row"><button class="btn primary" id="alertAddBtn">Thêm cảnh báo</button><button class="btn secondary" id="alertCheckBtn">Kiểm tra ngay</button><a class="btn secondary" href="#alerts">Cảnh báo Email</a></div>
      <div id="smartAlertList" class="smart-alert-list"></div>
    </article>`;
}

function realReceivedHTML() {
  return `
    <article class="decision-card decision-work-card" id="decisionRealCard"><div class="decision-card-title"><div class="decision-step green">4</div><div><span class="decision-card-kicker">Quy đổi thực tế</span><h2>Real VNĐ Received Calculator</h2><p>Tính nhanh VNĐ ước tính khi bán BTC hoặc chi phí khi mua BTC qua P2P.</p></div></div>
      <div class="form-grid compact">
        <label>Chiều<select id="realSide"><option value="sell">Bán BTC lấy VNĐ</option><option value="buy">Mua BTC bằng VNĐ</option></select></label>
        <label>Số BTC<input id="realBtc" type="number" min="0" step="0.00000001" value="0.01"></label>
        <label>Phí ước tính (%)<input id="realFee" type="number" min="0" step="0.01" value="0"></label>
        <label>Thuế tham khảo (%)<input id="realTax" type="number" min="0" step="0.01" value="0.1"></label>
      </div>
      <button class="btn primary full" id="realCalcBtn">Tính VNĐ thực tế</button>
      <div id="realResult" class="decision-result muted">Chưa tính.</div>
    </article>`;
}

function aiTradeExplanationHTML() {
  const prompts = [
    'RSI hiện tại đang cho biết điều gì?',
    'Tôi có nên mua BTC bằng 5 triệu lúc này không?',
    'Giá P2P BUY và SELL đang chênh nhau thế nào?',
    'Bán BTC trị giá 100 triệu thì thuế ước tính bao nhiêu?',
    'Hướng dẫn tôi sử dụng Decision Hub.'
  ];
  return `
    <article class="decision-card decision-wide decision-work-card decision-ai-workspace" id="decisionAiCard">
      <div class="decision-card-title"><div class="decision-step violet">5</div><div><span class="decision-card-kicker">Trả lời theo đúng ý định</span><h2>AI Explanation</h2><p>AI nhận diện câu hỏi về quyết định, thị trường, chỉ báo, P2P, thuế hoặc cách dùng website; chỉ lấy dữ liệu backend liên quan.</p></div></div>
      <div class="decision-ai-layout">
        <div class="decision-ai-compose">
          <label for="aiDecisionQuestion">Câu hỏi của bạn</label>
          <textarea id="aiDecisionQuestion" rows="5" placeholder="Hãy hỏi đúng điều bạn cần biết. Ví dụ: Vì sao BTC đang giảm hôm nay?"></textarea>
          <div class="decision-ai-prompts" aria-label="Câu hỏi gợi ý">${prompts.map(prompt => `<button type="button" data-ai-prompt="${escapeHTML(prompt)}">${escapeHTML(prompt)}</button>`).join('')}</div>
          <div class="decision-ai-actions"><span>Ctrl + Enter để gửi</span><button class="btn primary" id="aiDecisionBtn" type="button">Gửi câu hỏi cho AI</button></div>
        </div>
        <div id="aiDecisionResult" class="ai-decision-output decision-ai-empty">
          <div class="decision-ai-placeholder"><span>🤖</span><strong>AI sẽ trả lời đúng câu hỏi tại đây</strong><p>Thông tin số liệu hiện tại chỉ được lấy từ backend; nếu dữ liệu thiếu hoặc cũ, AI phải nói rõ.</p></div>
        </div>
      </div>
    </article>`;
}

async function bindDecisionHub() {
  document.getElementById('buildPlanBtn')?.addEventListener('click', buildPlan);
  document.getElementById('pfAddBtn')?.addEventListener('click', addPortfolioTx);
  document.getElementById('pfClearBtn')?.addEventListener('click', () => {
    if (confirm('Xóa danh mục demo?')) {
      writeJson(PORTFOLIO_KEY, []);
      renderPortfolioState();
      addNotification('Đã xóa danh mục demo', 'Portfolio tracker đã được đặt lại.', 'trade', '#decision');
    }
  });
  document.getElementById('alertAddBtn')?.addEventListener('click', addSmartAlert);
  document.getElementById('alertCheckBtn')?.addEventListener('click', checkSmartAlerts);
  document.getElementById('realCalcBtn')?.addEventListener('click', calculateRealReceived);
  document.getElementById('aiDecisionBtn')?.addEventListener('click', askDecisionAI);
  document.getElementById('decisionRefreshBtn')?.addEventListener('click', async () => {
    marketContextCache = null;
    marketContextCacheAt = 0;
    await refreshDecisionCockpit(true);
    await renderPortfolioState();
    showLocalToast('Đã làm mới dữ liệu Decision Hub.');
  });

  document.querySelectorAll('[data-decision-target]').forEach(button => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.decisionTarget);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('decision-focus-pulse');
      setTimeout(() => target.classList.remove('decision-focus-pulse'), 1100);
    });
  });

  document.querySelectorAll('[data-ai-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById('aiDecisionQuestion');
      if (!input) return;
      input.value = button.dataset.aiPrompt || '';
      input.focus();
    });
  });

  document.getElementById('aiDecisionQuestion')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      askDecisionAI();
    }
  });
}

async function buildPlan() {
  const result = document.getElementById('planResult');
  result.innerHTML = 'Đang phân tích dữ liệu...';
  try {
    const { latest, risk, p2p } = await getMarketContext();
    const price = Number(latest?.close || 0);
    const p2pBuy = Number(p2p?.buy?.p2p_price || 26000);
    const p2pSell = Number(p2p?.sell?.p2p_price || p2pBuy);
    const action = document.getElementById('planAction').value;
    const amount = Number(document.getElementById('planAmount').value || 0);
    const unit = document.getElementById('planUnit').value;
    const profile = document.getElementById('planRisk').value;
    const rate = action === 'sell' ? p2pSell : p2pBuy;
    const btc = unit === 'btc' ? amount : amount / Math.max(price * rate, 1);
    const riskScore = Number(risk?.score || 50);
    const slice = profile === 'safe' ? 0.25 : profile === 'aggressive' ? 0.7 : 0.45;
    const firstOrderBtc = action === 'watch' ? 0 : btc * slice;
    const advice = action === 'watch'
      ? 'Tín hiệu chưa đủ rõ hoặc bạn muốn quan sát thêm; hãy đặt cảnh báo thay vì vào lệnh ngay.'
      : riskScore >= 70
        ? 'Rủi ro cao: chỉ nên dùng phần nhỏ vốn, chia lệnh và có điểm cắt lỗ rõ ràng.'
        : riskScore <= 35
          ? 'Rủi ro thấp hơn trung bình: có thể lập kế hoạch từng phần, nhưng vẫn không all-in.'
          : 'Rủi ro trung bình: ưu tiên DCA/chia lệnh thay vì vào toàn bộ một lần.';
    result.innerHTML = `
      <div class="decision-kpi-row"><span>Giá BTC</span><strong>${formatUSD(price)}</strong><span>P2P áp dụng</span><strong>${formatVND(rate)}</strong><span>Risk</span><strong>${riskScore}/100</strong></div>
      <p><b>Kế hoạch tham khảo:</b> ${action === 'buy' ? 'Mua' : action === 'sell' ? 'Bán' : 'Quan sát'} khoảng <b>${formatBTC(btc)}</b>. Lệnh đầu tiên nên khoảng <b>${formatBTC(firstOrderBtc)}</b>.</p>
      <p>${advice}</p><small>Thông tin chỉ phục vụ mô phỏng, không phải khuyến nghị đầu tư.</small>`;
    addNotification('Đã tạo kế hoạch mua/bán', `${action.toUpperCase()} · ${formatBTC(btc)} · Risk ${riskScore}/100`, 'trade', '#decision');
  } catch (error) {
    result.innerHTML = `<span class="danger">Không tạo được kế hoạch: ${escapeHTML(error.message)}</span>`;
  }
}

async function addPortfolioTx() {
  try {
    const { latest, p2p } = await getMarketContext();
    const price = Number(latest?.close || 0);
    const p2pRate = Number((document.getElementById('pfSide').value === 'sell' ? p2p?.sell?.p2p_price : p2p?.buy?.p2p_price) || 26000);
    const side = document.getElementById('pfSide').value;
    const amount = Number(document.getElementById('pfAmount').value || 0);
    const btc = amount / Math.max(price * p2pRate, 1);
    const txs = readJson(PORTFOLIO_KEY, []);
    txs.unshift({ id: Date.now(), side, amount, btc, price, p2pRate, note: document.getElementById('pfNote').value || '', createdAt: new Date().toISOString() });
    writeJson(PORTFOLIO_KEY, txs);
    renderPortfolioState();
    addNotification('Giao dịch danh mục demo', `${side === 'buy' ? 'Mua' : 'Bán'} ${formatBTC(btc)} · ${formatVND(amount)}`, 'trade', '#decision');
  } catch (error) {
    showLocalToast(`Không thêm được giao dịch: ${error.message}`);
  }
}

async function renderPortfolioState() {
  const kpi = document.getElementById('portfolioKpis');
  const list = document.getElementById('portfolioList');
  if (!kpi || !list) return;
  const txs = readJson(PORTFOLIO_KEY, []);
  let btc = 0, cost = 0;
  txs.slice().reverse().forEach(tx => {
    if (tx.side === 'buy') { btc += Number(tx.btc || 0); cost += Number(tx.amount || 0); }
    else { btc -= Number(tx.btc || 0); cost -= Number(tx.amount || 0); }
  });
  let currentValue = 0;
  try {
    const { latest, p2p } = await getMarketContext();
    currentValue = btc * Number(latest?.close || 0) * Number(p2p?.sell?.p2p_price || 26000);
  } catch { }
  const pnl = currentValue - cost;
  kpi.innerHTML = `
    <div><span>BTC đang giữ</span><strong>${formatBTC(btc)}</strong></div>
    <div><span>Giá vốn</span><strong>${formatVND(cost)}</strong></div>
    <div><span>Giá trị hiện tại</span><strong>${formatVND(currentValue)}</strong></div>
    <div class="${pnl >= 0 ? 'positive' : 'negative'}"><span>Lãi/lỗ tạm tính</span><strong>${formatVND(pnl)}</strong></div>`;
  list.innerHTML = txs.length ? txs.slice(0, 8).map(tx => `
    <div class="portfolio-row"><span>${tx.side === 'buy' ? 'Mua' : 'Bán'} · ${formatBTC(tx.btc)}</span><strong>${formatVND(tx.amount)}</strong><small>${escapeHTML(tx.note || '')}</small></div>`).join('') : `<div class="platform-empty-note">Chưa có giao dịch danh mục demo.</div>`;
}

function addSmartAlert() {
  const alerts = readJson(DECISION_ALERT_KEY, []);
  const alert = {
    id: Date.now(), metric: document.getElementById('alertMetric').value, op: document.getElementById('alertOp').value,
    value: Number(document.getElementById('alertValue').value || 0), createdAt: new Date().toISOString(), last: null
  };
  alerts.unshift(alert);
  writeJson(DECISION_ALERT_KEY, alerts);
  renderSmartAlerts();
  addNotification('Đã tạo cảnh báo cục bộ', `${metricLabel(alert.metric)} ${alert.op === 'gt' ? '>' : '<'} ${formatNumber(alert.value, 2)}`, 'alert', '#decision');
}

function metricLabel(metric) {
  return { price: 'BTC/USDT', risk: 'Risk Score', p2pBuy: 'P2P BUY', p2pSell: 'P2P SELL' }[metric] || metric;
}

function renderSmartAlerts() {
  const box = document.getElementById('smartAlertList');
  if (!box) return;
  const alerts = readJson(DECISION_ALERT_KEY, []);
  box.innerHTML = alerts.length ? alerts.map(a => `<div class="smart-alert-row"><span>${metricLabel(a.metric)} ${a.op === 'gt' ? '>' : '<'} ${formatNumber(a.value, 2)}</span><small>${a.last ? escapeHTML(a.last) : 'Chưa kiểm tra'}</small></div>`).join('') : `<div class="platform-empty-note">Chưa có cảnh báo cục bộ.</div>`;
}

async function checkSmartAlerts() {
  const alerts = readJson(DECISION_ALERT_KEY, []);
  if (!alerts.length) return showLocalToast('Chưa có cảnh báo để kiểm tra.');
  const { latest, risk, p2p } = await getMarketContext();
  const values = { price: Number(latest?.close), risk: Number(risk?.score), p2pBuy: Number(p2p?.buy?.p2p_price), p2pSell: Number(p2p?.sell?.p2p_price) };
  let hit = 0;
  const next = alerts.map(a => {
    const current = values[a.metric];
    const ok = Number.isFinite(current) && (a.op === 'gt' ? current > a.value : current < a.value);
    if (ok) { hit += 1; addNotification('Cảnh báo đạt ngưỡng', `${metricLabel(a.metric)} hiện là ${formatNumber(current, 2)}`, 'alert', '#decision'); }
    return { ...a, last: ok ? `Đạt ngưỡng · hiện tại ${formatNumber(current, 2)}` : `Chưa đạt · hiện tại ${formatNumber(current, 2)}` };
  });
  writeJson(DECISION_ALERT_KEY, next);
  renderSmartAlerts();
  showLocalToast(hit ? `${hit} cảnh báo đã đạt ngưỡng.` : 'Chưa có cảnh báo nào đạt ngưỡng.');
}

async function calculateRealReceived() {
  const box = document.getElementById('realResult');
  box.innerHTML = 'Đang tính...';
  try {
    const { latest, p2p } = await getMarketContext();
    const side = document.getElementById('realSide').value;
    const btc = Number(document.getElementById('realBtc').value || 0);
    const fee = Number(document.getElementById('realFee').value || 0) / 100;
    const tax = Number(document.getElementById('realTax').value || 0) / 100;
    const price = Number(latest?.close || 0);
    const rate = Number((side === 'sell' ? p2p?.sell?.p2p_price : p2p?.buy?.p2p_price) || 26000);
    const gross = btc * price * rate;
    const totalCost = gross * (fee + tax);
    const net = side === 'sell' ? gross - totalCost : gross + totalCost;
    box.innerHTML = `
      <div class="decision-kpi-row"><span>Giá trị gốc</span><strong>${formatVND(gross)}</strong><span>Phí/thuế</span><strong>${formatVND(totalCost)}</strong><span>${side === 'sell' ? 'Thực nhận' : 'Cần chi'}</span><strong>${formatVND(net)}</strong></div>
      <p>${side === 'sell' ? 'Khi bán BTC lấy VNĐ, bạn nên quan tâm số tiền thực nhận sau phí/thuế tham khảo.' : 'Khi mua BTC bằng VNĐ, bạn nên tính cả phí và chênh lệch P2P.'}</p>`;
    addNotification('Đã tính VNĐ thực tế', `${formatBTC(btc)} · ${formatVND(net)}`, 'info', '#decision');
  } catch (error) {
    box.innerHTML = `<span class="danger">Không tính được: ${escapeHTML(error.message)}</span>`;
  }
}

function decisionIntentLabel(intent) {
  return {
    market_decision: 'Quyết định mua/bán',
    market_status: 'Trạng thái thị trường',
    indicator: 'Chỉ báo kỹ thuật',
    p2p: 'Dữ liệu P2P',
    tax: 'Thuế / thực nhận',
    website_help: 'Hướng dẫn website',
    general: 'Hỏi đáp chung'
  }[intent] || 'AI Explanation';
}

function decisionQualityLabel(quality, usesMarketData) {
  if (!usesMarketData) return { text: 'Không cần dữ liệu thị trường', tone: 'neutral' };
  const status = quality?.status || 'unknown';
  if (status === 'fresh') return { text: `Dữ liệu mới${quality?.age_minutes != null ? ` · ${quality.age_minutes} phút` : ''}`, tone: 'fresh' };
  if (status === 'delayed') return { text: `Dữ liệu chậm${quality?.age_minutes != null ? ` · ${quality.age_minutes} phút` : ''}`, tone: 'delayed' };
  if (status === 'stale') return { text: `Dữ liệu cũ${quality?.age_minutes != null ? ` · ${quality.age_minutes} phút` : ''}`, tone: 'stale' };
  return { text: 'Chưa xác định độ mới', tone: 'unknown' };
}

function formatDecisionAIAnswer(answer) {
  const safe = escapeHTML(answer || 'AI chưa có phản hồi.');
  const withStrong = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const lines = withStrong.split(/\r?\n/);
  const chunks = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    chunks.push(`<ul>${list.map(item => `<li>${item}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (/^[-•]\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^[-•]\s+/, ''));
      continue;
    }
    flushList();
    chunks.push(`<p>${trimmed}</p>`);
  }
  flushList();
  return chunks.join('');
}

function renderDecisionAIResponse(res, question) {
  const quality = decisionQualityLabel(res?.data_quality, Boolean(res?.uses_market_data));
  const intent = res?.intent || 'general';
  const verdict = intent === 'market_decision' && res?.verdict ? `<span class="decision-ai-meta verdict ${String(res.verdict).toLowerCase()}">${escapeHTML(res.verdict)}</span>` : '';
  return `
    <div class="decision-ai-thread">
      <div class="decision-ai-question"><span>Câu hỏi của bạn</span><p>${escapeHTML(question)}</p></div>
      <div class="decision-ai-answer-card">
        <div class="decision-ai-answer-head">
          <div><span class="decision-ai-meta intent">${escapeHTML(decisionIntentLabel(intent))}</span>${verdict}<span class="decision-ai-meta quality ${quality.tone}">${escapeHTML(quality.text)}</span></div>
          <small>${res?.uses_market_data ? 'Số liệu lấy từ backend' : 'Trả lời theo nội dung câu hỏi'}</small>
        </div>
        <div class="decision-ai-answer-body">${formatDecisionAIAnswer(res?.answer)}</div>
        ${res?.disclaimer && !String(res?.answer || '').includes(res.disclaimer) ? `<div class="decision-ai-disclaimer">${escapeHTML(res.disclaimer)}</div>` : ''}
      </div>
    </div>`;
}

async function askDecisionAI() {
  const box = document.getElementById('aiDecisionResult');
  const input = document.getElementById('aiDecisionQuestion');
  const button = document.getElementById('aiDecisionBtn');
  const question = input?.value.trim() || '';
  if (!question) return showLocalToast('Vui lòng nhập câu hỏi cho AI.');

  button?.setAttribute('disabled', 'disabled');
  if (button) button.textContent = 'AI đang trả lời...';
  box.classList.remove('decision-ai-empty');
  box.innerHTML = `<div class="decision-ai-loading"><span></span><div><strong>AI đang đọc đúng câu hỏi</strong><small>Hệ thống chỉ tải nhóm dữ liệu liên quan đến nội dung bạn hỏi.</small></div></div>`;
  try {
    // Gửi nguyên văn câu hỏi, không nối thêm mẫu trả lời hoặc ép thành khuyến nghị giao dịch.
    const res = await safePost('/api/ai/ask', { question, risk_profile: 'moderate' });
    box.innerHTML = renderDecisionAIResponse(res, question);
    addNotification('AI đã trả lời', `${decisionIntentLabel(res?.intent)} · ${question.slice(0, 58)}`, 'info', '#decision');
  } catch (error) {
    box.innerHTML = `<div class="decision-ai-error"><strong>AI chưa thể phản hồi</strong><p>${escapeHTML(error.message)}</p><small>Câu hỏi của bạn chưa bị thay đổi. Hãy thử gửi lại khi backend hoạt động.</small></div>`;
  } finally {
    button?.removeAttribute('disabled');
    if (button) button.textContent = 'Gửi câu hỏi cho AI';
  }
}

function defaultExchangeState() {
  return { cashVnd: 100000000, btc: 0, orders: [], createdAt: new Date().toISOString() };
}

function exchangeState() {
  return readJson(EXCHANGE_KEY, defaultExchangeState());
}

function saveExchangeState(state) {
  writeJson(EXCHANGE_KEY, state);
}

function renderPaperExchange() {
  if (!ensureProtectedFeature('paper-exchange')) return;
  if (app?.querySelector('[data-platform-route="paper-exchange"]')) {
    renderPaperAccount();
    refreshMarketStrip();
    return;
  }
  const state = exchangeState();
  app.innerHTML = `
    <section class="paper-exchange" data-platform-route="paper-exchange">
      <div class="paper-exchange-head">
        <div><span class="platform-pill">Virtual Exchange</span><h1>Sàn giao dịch ảo BTC</h1><p>Mô phỏng thị trường thực tế bằng tiền ảo. Người mới có thể luyện mua/bán, kiểm chứng chiến lược và theo dõi lãi/lỗ mà không mất tiền thật.</p></div>
        <div class="paper-warning"><strong>Không gửi lệnh thật</strong><span>Dữ liệu tham khảo từ API, tài sản chỉ lưu local demo.</span></div>
      </div>
      ${marketStripSkeleton()}
      <div class="paper-layout">
        <article class="paper-card paper-order-card">
          <h2>Đặt lệnh demo</h2>
          <div class="form-grid compact">
            <label>Loại lệnh<select id="paperSide"><option value="buy">Mua BTC</option><option value="sell">Bán BTC</option></select></label>
            <label>Nhập theo<select id="paperUnit"><option value="vnd">Số tiền VNĐ</option><option value="btc">Số BTC</option></select></label>
            <label>Số lượng<input id="paperAmount" type="number" min="0" step="0.00000001" value="1000000"></label>
            <label>Ghi chú<input id="paperNote" placeholder="VD: test breakout RSI"></label>
          </div>
          <button class="btn primary full" id="paperSubmit">Khớp lệnh demo</button>
          <div id="paperPreview" class="decision-result muted">Lệnh sẽ khớp theo giá tham khảo hiện tại.</div>
        </article>
        <article class="paper-card"><h2>Tài sản demo</h2><div id="paperAccount" class="paper-account"></div><div class="button-row"><button class="btn secondary" id="paperReset">Reset 100 triệu VNĐ demo</button><a class="btn secondary" href="https://www.binance.com/en/trade/BTC_USDT?type=spot" target="_blank" rel="noopener noreferrer">↗ Xem sàn thật</a></div></article>
      </div>
      <article class="paper-card"><h2>Lịch sử lệnh demo</h2><div id="paperOrders" class="paper-orders"></div></article>
    </section>`;
  document.getElementById('paperSubmit')?.addEventListener('click', submitPaperOrder);
  document.getElementById('paperReset')?.addEventListener('click', () => { if (confirm('Reset tài khoản giao dịch ảo?')) { saveExchangeState(defaultExchangeState()); renderPaperExchange(); addNotification('Đã reset sàn giao dịch ảo', 'Tài khoản quay về 100.000.000 VNĐ demo.', 'trade', '#paper-exchange'); } });
  refreshMarketStrip();
  renderPaperAccount();
}

async function renderPaperAccount() {
  const state = exchangeState();
  const account = document.getElementById('paperAccount');
  const orders = document.getElementById('paperOrders');
  if (!account || !orders) return;
  let btcValue = 0;
  try {
    const { latest, p2p } = await getMarketContext();
    btcValue = state.btc * Number(latest?.close || 0) * Number(p2p?.sell?.p2p_price || 26000);
  } catch { }
  account.innerHTML = `
    <div><span>Tiền mặt demo</span><strong>${formatVND(state.cashVnd)}</strong></div>
    <div><span>BTC demo</span><strong>${formatBTC(state.btc)}</strong></div>
    <div><span>Giá trị BTC</span><strong>${formatVND(btcValue)}</strong></div>
    <div><span>Tổng tài sản</span><strong>${formatVND(state.cashVnd + btcValue)}</strong></div>`;
  orders.innerHTML = state.orders.length ? state.orders.slice(0, 20).map(o => `
    <div class="paper-order-row"><span>${o.side === 'buy' ? 'Mua' : 'Bán'} ${formatBTC(o.btc)}</span><strong>${formatVND(o.vnd)}</strong><small>${escapeHTML(o.note || '')} · ${new Date(o.createdAt).toLocaleString('vi-VN')}</small></div>`).join('') : `<div class="platform-empty-note">Chưa có lệnh demo.</div>`;
}

async function submitPaperOrder() {
  const preview = document.getElementById('paperPreview');
  preview.textContent = 'Đang khớp lệnh theo giá tham khảo...';
  try {
    const state = exchangeState();
    const { latest, p2p } = await getMarketContext();
    const side = document.getElementById('paperSide').value;
    const unit = document.getElementById('paperUnit').value;
    const amount = Number(document.getElementById('paperAmount').value || 0);
    const price = Number(latest?.close || 0);
    const rate = Number((side === 'buy' ? p2p?.buy?.p2p_price : p2p?.sell?.p2p_price) || 26000);
    const vnd = unit === 'vnd' ? amount : amount * price * rate;
    const btc = unit === 'btc' ? amount : vnd / Math.max(price * rate, 1);
    if (amount <= 0) throw new Error('Số lượng phải lớn hơn 0.');
    if (side === 'buy' && state.cashVnd < vnd) throw new Error('Không đủ VNĐ demo để mua.');
    if (side === 'sell' && state.btc < btc) throw new Error('Không đủ BTC demo để bán.');
    if (side === 'buy') { state.cashVnd -= vnd; state.btc += btc; }
    else { state.cashVnd += vnd; state.btc -= btc; }
    const order = { id: Date.now(), side, unit, amount, vnd, btc, price, rate, note: document.getElementById('paperNote').value || '', createdAt: new Date().toISOString() };
    state.orders.unshift(order);
    saveExchangeState(state);
    preview.innerHTML = `<b>Đã khớp lệnh demo:</b> ${side === 'buy' ? 'Mua' : 'Bán'} ${formatBTC(btc)} · ${formatVND(vnd)}.`;
    addNotification('Khớp lệnh sàn ảo', `${side === 'buy' ? 'Mua' : 'Bán'} ${formatBTC(btc)} · ${formatVND(vnd)}`, 'trade', '#paper-exchange');
    renderPaperAccount();
  } catch (error) {
    preview.innerHTML = `<span class="danger">${escapeHTML(error.message)}</span>`;
  }
}

function enhanceTradeTerminal() {
  if (!app || app.querySelector('[data-platform-enhanced="trade-pro"]')) return;
  const pageHead = app.querySelector('.page-head');
  if (!pageHead) return;
  pageHead.insertAdjacentHTML('afterend', `
    <section class="trade-pro-shell" data-platform-enhanced="trade-pro">
      <div class="trade-pro-head">
        <div><span class="platform-pill">Paper Trading</span><h2>Trading demo BTC/USDT + P2P</h2><p>Demo mô phỏng mua/bán bằng dữ liệu thật và ví demo. Không gửi lệnh lên sàn, không dùng tiền thật.</p></div>
        <div class="trade-risk-note"><strong>Quy tắc demo</strong><span>Chia nhỏ vốn · Kiểm tra Risk Score · So sánh P2P trước khi quyết định</span></div>
      </div>
      ${marketStripSkeleton()}
      <div class="trade-workflow"><div><strong>1</strong><span>Nạp ví QR demo</span></div><div><strong>2</strong><span>Chọn mua/bán USDT</span></div><div><strong>3</strong><span>Xem thực nhận, thuế, spread</span></div><div><strong>4</strong><span>Lưu lịch sử mô phỏng</span></div></div>
    </section>`);
  app.querySelector('.split')?.classList.add('trade-terminal-layout');
  document.getElementById('tradeSubmit')?.classList.add('trade-action-primary');
  refreshMarketStrip();
}

function enhanceWallet() {
  if (!app || app.querySelector('[data-platform-enhanced="wallet-safe"]')) return;
  const head = app.querySelector('.page-head');
  if (!head) return;
  head.insertAdjacentHTML('afterend', `<section class="state-box success wallet-safe-note" data-platform-enhanced="wallet-safe"><strong>Demo an toàn:</strong> QR và ví trong project chỉ dùng để minh họa quy trình FinTech. Không phát sinh tiền thật, không liên kết ngân hàng thật, không lưu thẻ thật.</section>`);
}

function enhanceTechnicalChartAdvice() {
  const el = document.getElementById('technicalChart');
  if (!el || !window.echarts || chartAdviceBound) return;
  const chart = echarts.getInstanceByDom(el);
  if (!chart) return;
  chartAdviceBound = true;
  if (!document.getElementById('technicalAdvicePanel')) {
    el.insertAdjacentHTML('afterend', `<div id="technicalAdvicePanel" class="technical-advice-panel"><strong>Gợi ý chỉ báo</strong><span>Di chuột trên biểu đồ để xem số liệu và nhận xét nhanh về RSI, EMA, P2P.</span></div>`);
  }
  const panel = document.getElementById('technicalAdvicePanel');
  const update = (idx) => {
    const opt = chart.getOption();
    const label = opt?.xAxis?.[0]?.data?.[idx] || 'điểm dữ liệu';
    const series = opt?.series || [];
    const get = name => series.find(s => s.name === name)?.data?.[idx];
    const ohlc = get('OHLC') || [];
    const close = Array.isArray(ohlc) ? Number(ohlc[1]) : null;
    const ema20 = Number(get('EMA20'));
    const ema50 = Number(get('EMA50'));
    const ema200 = Number(get('EMA200'));
    const rsi = Number(get('RSI'));
    const notes = [];
    if (Number.isFinite(rsi)) notes.push(rsi > 70 ? 'RSI cao: thị trường có thể quá mua, tránh FOMO.' : rsi < 30 ? 'RSI thấp: có thể quá bán nhưng vẫn cần xác nhận xu hướng.' : 'RSI trung tính: chưa có tín hiệu cực đoan.');
    if (Number.isFinite(close) && Number.isFinite(ema20) && Number.isFinite(ema50)) notes.push(close > ema20 && ema20 > ema50 ? 'Giá trên EMA20/50: xu hướng ngắn hạn đang tích cực.' : close < ema20 && ema20 < ema50 ? 'Giá dưới EMA20/50: xu hướng ngắn hạn yếu, nên thận trọng.' : 'EMA chưa đồng thuận, ưu tiên quan sát thêm.');
    if (Number.isFinite(ema200) && Number.isFinite(close)) notes.push(close > ema200 ? 'Giá trên EMA200: cấu trúc dài hạn tích cực hơn.' : 'Giá dưới EMA200: rủi ro xu hướng dài hạn còn cao.');
    panel.innerHTML = `<strong>${escapeHTML(label)}</strong><span>Close: ${formatUSD(close)} · RSI: ${formatNumber(rsi, 2)} · EMA20/50/200: ${formatNumber(ema20, 2)} / ${formatNumber(ema50, 2)} / ${formatNumber(ema200, 2)}</span><p>${notes.join(' ')}</p>`;
  };
  chart.on('updateAxisPointer', evt => {
    const idx = evt?.axesInfo?.[0]?.value;
    if (Number.isInteger(idx) || String(Number(idx)) === String(idx)) update(Number(idx));
  });
  const opt = chart.getOption();
  const lastIdx = (opt?.xAxis?.[0]?.data?.length || 1) - 1;
  update(Math.max(0, lastIdx));
}

function installEnterToSubmit() {
  if (window.__btcEnterSubmitInstalled) return;
  window.__btcEnterSubmitInstalled = true;
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches('input, select')) return;
    const scope = target.closest('form, .card, .decision-card, .paper-card, .auth-panel, .auth-card, section, article');
    if (!scope) return;
    const button = scope.querySelector('button[type="submit"], button.btn.primary, button.btn.accent, button[id$="Btn"], button:not([disabled])');
    if (!button || button.disabled) return;
    event.preventDefault();
    button.click();
  });
}

function observeActionNotifications() {
  if (window.__btcActionNotiInstalled) return;
  window.__btcActionNotiInstalled = true;
  document.addEventListener('click', event => {
    const btn = event.target.closest('button, a.btn');
    if (!btn) return;
    const text = (btn.textContent || '').toLowerCase();
    setTimeout(() => {
      if (text.includes('cảnh báo')) addNotification('Thao tác cảnh báo', 'Bạn vừa thao tác với chức năng cảnh báo.', 'alert', '#alerts');
      if (text.includes('thanh toán') || text.includes('premium') || text.includes('sandbox')) addNotification('Thao tác thanh toán/Premium', 'Hệ thống đã ghi nhận thao tác thanh toán hoặc gói Premium.', 'payment', '#billing');
      if (text.includes('giao dịch') || text.includes('khớp lệnh')) addNotification('Thao tác giao dịch demo', 'Bạn vừa thao tác với giao dịch mô phỏng.', 'trade', '#trade');
    }, 500);
  }, true);
}

function enhanceCurrentRoute() {
  installNavLinks();
  installTopActions();
  installNotificationPanel();
  const route = getRoute();
  if (route !== lastRoute) {
    lastRoute = route;
    chartAdviceBound = false;
    document.body.dataset.route = route;
  }
  if (route === 'decision') {
    if (app?.querySelector('[data-platform-route="decision"]')) return;
    return renderDecisionHub();
  }
  if (route === 'paper-exchange' || route === 'exchange' || route === 'simulator') return renderPaperExchange();
  if (route === 'dashboard') enhanceDashboard();
  if (route === 'trade') enhanceTradeTerminal();
  if (route === 'wallet') enhanceWallet();
  if (route === 'chart') setTimeout(enhanceTechnicalChartAdvice, 400);
  if ((route === 'dashboard' || route === 'trade' || route === 'decision' || route === 'paper-exchange') && !marketStripTimer) {
    marketStripTimer = setInterval(() => { if (!document.hidden) refreshMarketStrip(); }, 120_000);
  }
  if (!(route === 'dashboard' || route === 'trade' || route === 'decision' || route === 'paper-exchange') && marketStripTimer) {
    clearInterval(marketStripTimer); marketStripTimer = null;
  }
}

function installRouteObserver() {
  let routeEnhanceTimer = null;
  const scheduleEnhance = (delay = 120) => {
    clearTimeout(routeEnhanceTimer);
    routeEnhanceTimer = setTimeout(enhanceCurrentRoute, delay);
  };
  window.addEventListener('hashchange', () => scheduleEnhance(140));
  const observer = new MutationObserver(() => {
    const route = getRoute();
    if ((route === 'paper-exchange' && app?.querySelector('[data-platform-route="paper-exchange"]')) ||
      (route === 'decision' && app?.querySelector('[data-platform-route="decision"]'))) return;
    scheduleEnhance(120);
  });
  if (app) observer.observe(app, { childList: true, subtree: false });
  scheduleEnhance(250);
}

initTheme();
installEnterToSubmit();
observeActionNotifications();
installRouteObserver();
