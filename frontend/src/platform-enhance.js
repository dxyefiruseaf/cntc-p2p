// BTC BigData Platform — Enhancement layer v2
// Patch nhỏ: thêm Exchange links, News banner, Notifications, Enter-to-submit,
// Decision Hub nâng cao, Paper Exchange, dark-mode fixes và tooltip advice.

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const DATA_API_BASE = (import.meta.env.VITE_DATA_API_BASE_URL || API_BASE).replace(/\/+$/, '');
const THEME_KEY = 'btc_bigdata_platform_theme_v1';
const NOTI_KEY = 'btc_bigdata_notifications_v2';
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
  '/api/overview': 45000,
  '/api/latest': 45000,
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

async function safeGet(endpoint, timeoutMs = 12000, base = DATA_API_BASE) {
  const url = apiUrl(endpoint, base);
  const cacheKey = `GET:${url}`;
  const now = Date.now();
  const ttl = safeGetTtl(endpoint);
  const cached = SAFE_GET_CACHE.get(cacheKey);
  if (cached && now - cached.at < ttl) return cached.data;
  if (SAFE_GET_INFLIGHT.has(cacheKey)) return SAFE_GET_INFLIGHT.get(cacheKey);

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      SAFE_GET_CACHE.set(cacheKey, { at: Date.now(), data });
      return data;
    } catch (error) {
      if (cached) return cached.data;
      throw error;
    } finally {
      clearTimeout(timer);
      SAFE_GET_INFLIGHT.delete(cacheKey);
    }
  })();

  SAFE_GET_INFLIGHT.set(cacheKey, request);
  return request;
}

async function safePost(endpoint, body, timeoutMs = 30000, base = API_BASE) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl(endpoint, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    toolsMenu.insertAdjacentHTML('beforeend', `
      <a href="#decision" data-route="decision">Decision Hub</a>
    `);
  }
  const toolGroup = document.querySelector('[data-nav-group="tools"]');
  if (toolGroup) {
    const routes = new Set((toolGroup.dataset.routes || '').split(',').map(x => x.trim()).filter(Boolean));
    routes.add('decision');
    routes.delete('paper-exchange');
    routes.delete('exchange');
    routes.delete('simulator');
    toolGroup.dataset.routes = Array.from(routes).join(',');
  }
  const side = document.getElementById('sideNav');
  if (side && !side.querySelector('[data-route="decision"]')) {
    const tradeLink = side.querySelector('[data-route="trade"]');
    tradeLink?.insertAdjacentHTML('afterend', `
      <a href="#decision" data-route="decision"><span>🎯</span>Decision Hub</a>
    `);
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
          <a class="btn secondary" href="#trade">Sàn giao dịch ảo</a>
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
    try {
      const overview = await safeGet('/api/overview?hours=24', 14000, DATA_API_BASE);
      const ctx = {
        latest: overview?.latest || marketContextCache?.latest || null,
        risk: overview?.risk || marketContextCache?.risk || null,
        p2p: overview?.comparison || marketContextCache?.p2p || null
      };
      marketContextCache = ctx;
      marketContextCacheAt = Date.now();
      return ctx;
    } catch (error) {
      if (marketContextCache) return marketContextCache;
      throw error;
    }
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
    { title: 'Sàn giao dịch ảo BTC giúp luyện tập chiến lược không mất tiền thật', source: 'Paper Exchange', summary: 'Người dùng có thể thử mua/bán BTC bằng tiền demo trước khi ra quyết định ngoài thị trường thật.', link: '#trade' }
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
      <h1>${routeName === 'trade' ? 'Sàn giao dịch ảo BTC' : 'Decision Hub'} cần tài khoản</h1>
      <p>Các tính năng ra quyết định, giao dịch demo, danh mục và tính thực nhận dùng dữ liệu cá nhân trong trình duyệt/tài khoản nên cần đăng nhập trước.</p>
      <div class="platform-hero-actions"><a class="btn primary" href="#login?next=${encodeURIComponent(routeName)}">Đăng nhập để tiếp tục</a><a class="btn secondary" href="#dashboard">Về Dashboard</a></div>
    </section>`;
  return false;
}

function renderDecisionHub() {
  if (!ensureProtectedFeature('decision')) return;
  app.innerHTML = `
    <section class="page-head platform-decision-head" data-platform-route="decision">
      <div><span class="eyebrow">Decision Hub</span><h1>Trung tâm ra quyết định Bitcoin</h1><p class="lead">Lập kế hoạch mua/bán, theo dõi danh mục, cảnh báo thông minh, tính VNĐ thực nhận và nhờ AI giải thích. Tất cả chỉ là mô phỏng/tham khảo, không gửi lệnh thật.</p></div>
      <div class="platform-hero-actions"><a class="btn secondary" href="#trade">Mở sàn giao dịch ảo</a><a class="btn secondary" href="https://www.binance.com/en/trade/BTC_USDT?type=spot" target="_blank" rel="noopener noreferrer">↗ Sàn thật</a></div>
    </section>
    ${marketStripSkeleton()}
    <section class="decision-pro-grid">
      ${buySellPlannerHTML()}
      ${portfolioTrackerHTML()}
      ${smartAlertHTML()}
      ${realReceivedHTML()}
      ${aiTradeExplanationHTML()}
    </section>
  `;
  bindDecisionHub();
  refreshMarketStrip();
  renderPortfolioState();
  renderSmartAlerts();
}

function buySellPlannerHTML() {
  return `
    <article class="decision-card decision-wide"><div class="decision-step">1</div><h2>Buy/Sell Plan Builder</h2><p>Lập kế hoạch trước khi vào lệnh, không gửi lệnh thật.</p>
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
    <article class="decision-card"><div class="decision-step">2</div><h2>Portfolio PnL Tracker</h2><p>Lưu danh mục demo trong trình duyệt để theo dõi giá vốn/lãi lỗ.</p>
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
    <article class="decision-card"><div class="decision-step">3</div><h2>Smart Alert Center</h2><p>Cảnh báo cục bộ theo dữ liệu hiện tại. Muốn gửi email tự động, dùng trang Cảnh báo Email.</p>
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
    <article class="decision-card"><div class="decision-step">4</div><h2>Real VNĐ Received Calculator</h2><p>Tính nhanh VNĐ ước tính khi bán BTC hoặc chi phí khi mua BTC qua P2P.</p>
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
  return `
    <article class="decision-card decision-wide"><div class="decision-step">5</div><h2>AI Trade Explanation</h2><p>AI giải thích linh hoạt: mua/bán, rủi ro, P2P, thuế hoặc câu hỏi ngoài lề. Nếu ngoài chủ đề, AI vẫn trả lời ngắn và gợi ý quay về Bitcoin.</p>
      <textarea id="aiDecisionQuestion" rows="4" placeholder="VD: Tôi muốn mua BTC bằng 5 triệu hôm nay, hãy giải thích rủi ro và kế hoạch tham khảo."></textarea>
      <button class="btn primary full" id="aiDecisionBtn">Nhờ AI giải thích</button>
      <div id="aiDecisionResult" class="ai-decision-output">AI sẽ hiển thị câu trả lời tại đây.</div>
    </article>`;
}

async function bindDecisionHub() {
  document.getElementById('buildPlanBtn')?.addEventListener('click', buildPlan);
  document.getElementById('pfAddBtn')?.addEventListener('click', addPortfolioTx);
  document.getElementById('pfClearBtn')?.addEventListener('click', () => { if (confirm('Xóa danh mục demo?')) { writeJson(PORTFOLIO_KEY, []); renderPortfolioState(); addNotification('Đã xóa danh mục demo', 'Portfolio tracker đã được đặt lại.', 'trade', '#decision'); } });
  document.getElementById('alertAddBtn')?.addEventListener('click', addSmartAlert);
  document.getElementById('alertCheckBtn')?.addEventListener('click', checkSmartAlerts);
  document.getElementById('realCalcBtn')?.addEventListener('click', calculateRealReceived);
  document.getElementById('aiDecisionBtn')?.addEventListener('click', askDecisionAI);
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

async function askDecisionAI() {
  const box = document.getElementById('aiDecisionResult');
  const question = document.getElementById('aiDecisionQuestion').value.trim();
  if (!question) return showLocalToast('Vui lòng nhập câu hỏi cho AI.');
  box.textContent = 'AI đang phân tích...';
  try {
    const res = await safePost('/api/ai/ask', { question: `${question}\n\nHãy trả lời linh hoạt. Nếu câu hỏi liên quan mua/bán BTC, hãy đưa kế hoạch tham khảo, rủi ro, P2P và disclaimer. Nếu câu hỏi ngoài lề, trả lời ngắn gọn rồi gợi ý tôi có thể hỗ trợ tốt hơn về Bitcoin, P2P, AI Advisor hoặc quản lý rủi ro.`, risk_profile: 'moderate' });
    box.textContent = res.answer || 'AI chưa có phản hồi.';
    addNotification('AI đã trả lời', question.slice(0, 80), 'info', '#decision');
  } catch (error) {
    box.textContent = `AI hiện chưa phản hồi được: ${error.message}`;
  }
}

function enhanceTradeTerminal() {
  if (!app || app.querySelector('.trade-terminal-shell') || app.querySelector('[data-platform-enhanced="trade-pro"]')) return;
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
    // Trang Decision chính được render và bind sự kiện trong main.js.
    // Không render đè bằng phiên bản legacy ở platform-enhance.js vì sẽ:
    // - tạo hai bộ giao diện/chức năng trùng nhau;
    // - làm mất CSS của Decision Hub mới;
    // - khiến .ai-decision-output min-height:100% kéo dài tới footer.
    if (marketStripTimer) {
      clearInterval(marketStripTimer);
      marketStripTimer = null;
    }
    return;
  }
  if (route === 'paper-exchange' || route === 'exchange' || route === 'simulator') {
    location.replace('#trade');
    return;
  }
  if (route === 'dashboard') enhanceDashboard();
  if (route === 'trade') enhanceTradeTerminal();
  if (route === 'wallet') enhanceWallet();
  if (route === 'chart') setTimeout(enhanceTechnicalChartAdvice, 400);
  if ((route === 'dashboard' || route === 'trade' || route === 'decision') && !marketStripTimer) {
    marketStripTimer = setInterval(() => { if (!document.hidden) refreshMarketStrip(); }, 120_000);
  }
  if (!(route === 'dashboard' || route === 'trade' || route === 'decision') && marketStripTimer) {
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
    // main.js sở hữu toàn bộ trang Decision; tránh observer gọi lại renderer legacy.
    if (route === 'decision') return;
    scheduleEnhance(120);
  });
  if (app) observer.observe(app, { childList: true, subtree: false });
  scheduleEnhance(250);
}

initTheme();
installEnterToSubmit();
observeActionNotifications();
installRouteObserver();
