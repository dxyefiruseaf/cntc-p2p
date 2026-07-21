import './styles.css';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
// Optional: tách data API sang một server riêng để giảm tải backend chính.
// Nếu chưa cấu hình VITE_DATA_API_BASE_URL, toàn bộ request vẫn chạy qua API_BASE như cũ.
const DATA_API_BASE = (import.meta.env.VITE_DATA_API_BASE_URL || API_BASE).replace(/\/+$/, '');
const LIVE_NEWS_HIDDEN_KEY = 'btc_bigdata_live_news_hidden_v1';

const DATA_ENDPOINT_PREFIXES = [
  '/api/latest',
  '/api/ohlcv',
  '/api/indicators/summary',
  '/api/p2p-spread',
  '/api/p2p-comparison',
  '/api/data-status',
  '/api/data-reliability',
  '/api/risk-score',
  '/api/market-alerts',
  '/api/news/latest',
  '/api/tax-estimate',
  '/api/net-settlement'
];

function shouldUseDataApi(endpoint) {
  const clean = String(endpoint || '').replace(/^\/+/, '/');
  return DATA_ENDPOINT_PREFIXES.some(prefix => clean.startsWith(prefix));
}

function apiUrl(endpoint) {
  const clean = String(endpoint || '').replace(/^\/+/, '');
  const base = shouldUseDataApi(`/${clean}`) ? DATA_API_BASE : API_BASE;
  return `${base}/${clean}`;
}
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseAuth = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  })
  : null;
const VN_TZ = 'Asia/Ho_Chi_Minh';
const app = document.getElementById('app');
const sideNav = document.getElementById('sideNav');
const menuToggle = document.getElementById('menuToggle');
const topTicker = document.getElementById('topTicker');
const toastEl = document.getElementById('toast');
let charts = [];
let activeRoute = '';
let chartHours = 168;
let p2pHours = 168;
let tradeTerminalHours = 168;
let tradeAmountMode = 'VND';
let currentTradePreview = null;
let chatMessages = [
  {
    role: 'ai',
    text: 'Xin chào! Tôi là AI Advisor của BTC BigData. Bạn có thể hỏi: “Giờ nên mua hay bán?”, “Bán P2P có thiệt không?”, hoặc “Bán 100 triệu thì thuế bao nhiêu?”.'
  }
];
let orders = [];
let currentSession = null;
let currentUserProfile = null;
let authReady = !supabaseAuth;
let topTickerBusy = false;
let lastTopTickerAt = 0;
let liveNewsTickerBusy = false;
let passwordSavingInProgress = false;
let chatSending = false;
let floatingChatSending = false;
let adminSyncPollTimer = null;
const protectedRoutes = new Set(['history', 'alerts', 'billing', 'wallet', 'set-password', 'account', 'decision', 'trade', 'settlement', 'admin']);
const trustRoutes = new Set(['dashboard', 'chart', 'p2p', 'tax', 'settlement', 'chat', 'risk', 'news', 'reliability', 'decision']);

const signalMap = {
  BUY: { vi: 'MUA', className: 'buy', icon: '↗' },
  SELL: { vi: 'BÁN', className: 'sell', icon: '↘' },
  NEUTRAL: { vi: 'TRUNG LẬP', className: 'neutral', icon: '→' }
};

const routes = {
  theory: renderTheoryPage,
  business: renderBusinessPage,
  bmc: renderBMCPage,
  experiment: renderExperimentPage,
  dashboard: renderDashboardPage,
  chart: renderChartPage,
  p2p: renderP2PPage,
  risk: renderRiskPage,
  news: renderNewsPage,
  reliability: renderReliabilityPage,
  guide: renderIndicatorGuidePage,
  tax: renderTaxPage,
  settlement: renderSettlementPage,
  chat: renderChatPage,
  decision: renderDecisionHubPage,
  trade: renderTradePage,
  history: renderHistoryPage,
  alerts: renderAlertsPage,
  billing: renderBillingPage,
  wallet: renderWalletPage,
  login: renderLoginPage,
  'set-password': renderSetPasswordPage,
  account: renderAccountPage,
  admin: renderAdminPage,
  about: renderAboutPage,
  'payment-result': renderPaymentResultPage
};

menuToggle?.addEventListener('click', () => sideNav?.classList.toggle('open'));
document.addEventListener('click', (event) => {
  const routeLink = event.target.closest('a[data-route]');
  if (routeLink?.dataset.route === getCurrentRouteName()) {
    event.preventDefault();
    resetRouteViewport();
    app.focus({ preventScroll: true });
  }
  if (!event.target.closest('.side-nav') && !event.target.closest('.menu-toggle')) {
    sideNav?.classList.remove('open');
    if (document.body.classList.contains('ux-sidebar-compact')) {
      sideNav?.querySelectorAll('[data-side-group][open]').forEach(group => group.removeAttribute('open'));
    }
  }
});
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => charts.forEach(chart => chart.resize()));
topTicker?.addEventListener('click', () => {
  location.hash = '#dashboard';
  showToast('Đã chuyển tới Dashboard để xem giá và tín hiệu mới nhất.');
});

installAuthUxStyles();
installBitcoinAmbient();
installCompactNavigation();
installLiveNewsTicker();
installFloatingAIChat();
installCookieConsent();
cleanupSupabaseAuthRedirectHash();
initAuth();
route();
refreshTopTicker();
setInterval(() => {
  if (getCurrentRouteName() !== 'set-password' && !passwordSavingInProgress) refreshTopTicker();
}, 60_000);

function getCurrentRouteName() {
  const raw = (location.hash || '#theory').replace('#', '');
  const name = raw.split('?')[0] || 'theory';
  return routes[name] ? name : 'theory';
}

function applyApplicationLayout(routeName) {
  const adminMode = routeName === 'admin';
  document.documentElement.classList.toggle('admin-mode', adminMode);
  document.body.classList.toggle('admin-mode', adminMode);
  document.title = adminMode
    ? 'BTC BigData — Admin Console'
    : 'BTC BigData Platform — Bitcoin Market Dashboard';

  if (adminMode) {
    sideNav?.classList.remove('open');
    document.getElementById('floatingAIPanel')?.classList.remove('open');
    document.body.classList.remove('floating-ai-open');
  }
}

function resetRouteViewport() {
  const root = document.documentElement;
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  root.scrollTop = 0;
  document.body.scrollTop = 0;
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    root.scrollTop = 0;
    document.body.scrollTop = 0;
    root.style.scrollBehavior = previousBehavior;
  });
}

function stopAdminSyncPolling() {
  if (adminSyncPollTimer) window.clearTimeout(adminSyncPollTimer);
  adminSyncPollTimer = null;
}

function route() {
  document.querySelector('#tradeDetailModal [data-close-trade-detail]')?.click();
  disposeCharts();
  stopAdminSyncPolling();
  activeRoute = getCurrentRouteName();
  applyApplicationLayout(activeRoute);
  resetRouteViewport();
  // Cho phép vào #set-password cả khi đã có mật khẩu để user có thể đổi mật khẩu.
  // Luồng bắt buộc đặt mật khẩu lần đầu vẫn được xử lý trong redirectAfterLoginIfNeeded().
  if (protectedRoutes.has(activeRoute)) {
    if (!authReady) {
      app.innerHTML = loadingCard(160);
      return;
    }
    if (!currentSession) {
      showToast('Cần đăng nhập để dùng tính năng này.');
      setPendingNextRoute(activeRoute);
      location.hash = `#login?next=${encodeURIComponent(activeRoute)}`;
      return;
    }
  }
  if (activeRoute === 'admin' && !isAdmin()) {
    showToast('Chỉ tài khoản admin được phép mở khu vực quản trị.');
    location.hash = '#dashboard';
    return;
  }
  document.querySelectorAll('[data-route]').forEach(el => el.classList.toggle('active', el.dataset.route === activeRoute));
  document.querySelectorAll('[data-nav-group]').forEach(el => {
    const routeList = (el.dataset.routes || '').split(',').map(x => x.trim()).filter(Boolean);
    el.classList.toggle('active', routeList.includes(activeRoute));
  });
  document.querySelectorAll('[data-side-group]').forEach(group => {
    const routeList = (group.dataset.routes || '').split(',').map(x => x.trim()).filter(Boolean);
    const isActiveGroup = routeList.includes(activeRoute);
    group.classList.toggle('active', isActiveGroup);
    if (!document.body.classList.contains('ux-sidebar-compact')) {
      group.open = isActiveGroup;
    } else {
      group.removeAttribute('open');
    }
  });
  app.innerHTML = '';
  routes[activeRoute]();
  if (trustRoutes.has(activeRoute)) mountDataTrustBadge();
  app.focus({ preventScroll: true });
}

function disposeCharts() {
  charts.forEach(chart => chart.dispose());
  charts = [];
}

function showToast(message, ms = 3400) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

function parseTs(value) {
  if (!value) return new Date();
  return new Date(String(value).replace(' ', 'T'));
}

function formatVNTime(value, mode = 'full') {
  const date = parseTs(value);
  const opts = mode === 'short'
    ? { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }
    : { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' };
  return new Intl.DateTimeFormat('vi-VN', opts).format(date);
}

function formatUSD(value, digits = 2) {
  if (!isNum(value)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(value);
}

function formatVND(value) {
  if (!isNum(value)) return '—';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value, digits = 2) {
  if (!isNum(value)) return '—';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(value);
}

function formatPct(value, digits = 2, signed = true) {
  if (!isNum(value)) return '—';
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}%`;
}

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function badge(signal) {
  const item = signalMap[signal] || signalMap.NEUTRAL;
  return `<span class="badge ${item.className}">${item.icon} ${item.vi}</span>`;
}

function sourcePill(source) {
  const normalized = String(source || '').toLowerCase();
  const isLive = ['api', 'rss', 'rss_cache', 'supabase'].includes(normalized);
  const label = normalized === 'rss' ? '● RSS tin tức' : normalized === 'rss_cache' ? '● RSS cache' : isLive ? '● API thật' : '● Demo fallback';
  return `<span class="source-pill ${isLive ? 'api' : 'mock'}">${label}</span>`;
}

function normalizeOhlcv(hours = 168) {
  const data = (window.MOCK_DATA?.ohlcv?.data || []).slice(-hours);
  return { symbol: 'BTCUSDT', timeframe: '1h', hours, count: data.length, data };
}

function normalizeP2P(hours = 168) {
  const data = (window.MOCK_DATA?.p2p?.data || []).slice(0, hours * 2);
  return { count: data.length, hours, latest: data[0] || null, data };
}

function buildMockDataReliability() {
  const latest = window.MOCK_DATA?.latest || {};
  const p2p = normalizeP2P(24);
  return {
    level: 'GOOD',
    message: 'Đang dùng dữ liệu demo/fallback để minh họa cơ chế kiểm tra độ tin cậy.',
    status: {
      now_utc: new Date().toISOString(),
      latest_ohlcv_timestamp: latest.timestamp,
      latest_p2p_timestamp: p2p.latest?.timestamp,
      ohlcv_age_hours: 0.8,
      p2p_age_hours: 1.2,
      is_ohlcv_fresh: true,
      is_p2p_fresh: true
    },
    checks: [
      { name: 'OHLCV BTC/USDT', source: 'mock', latest_timestamp: latest.timestamp, age_hours: 0.8, fresh: true, threshold_hours: 2, description: 'Dữ liệu giá 1 giờ cho dashboard và AI.' },
      { name: 'P2P USDT/VNĐ', source: 'mock', latest_timestamp: p2p.latest?.timestamp, age_hours: 1.2, fresh: true, threshold_hours: 2, description: 'Dữ liệu P2P dùng cho spread và thực nhận.' }
    ],
    sources: { ohlcv: 'Binance/Data API → sync_market_data.py → Supabase', p2p: 'Binance P2P API/fallback', ai: 'AI provider nằm ở backend .env' },
    automation: 'GitHub Actions chạy mỗi giờ.',
    sample_count: { p2p_last_24h: p2p.count }
  };
}

function buildMockRiskScore() {
  const latest = window.MOCK_DATA?.latest || {};
  const score = Math.min(100, Math.max(0, Math.round(28 + Math.abs((latest.rsi_14 || 50) - 50) * 0.7 + Math.abs(latest.macd_hist || 0) * 0.03)));
  const level = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  return {
    timestamp: latest.timestamp,
    price: latest.close,
    source: 'mock',
    score,
    level,
    label_vi: level === 'HIGH' ? 'Rủi ro cao' : level === 'MEDIUM' ? 'Rủi ro trung bình' : 'Rủi ro thấp',
    recommendation: level === 'HIGH' ? 'Ưu tiên bảo toàn vốn và quan sát thêm.' : level === 'MEDIUM' ? 'Nên chia nhỏ vị thế, tránh vào lệnh lớn.' : 'Có thể theo dõi cơ hội nhưng vẫn cần quản trị rủi ro.',
    factors: [
      { name: 'RSI', impact: 8, value: latest.rsi_14, note: 'RSI được dùng để phát hiện quá mua/quá bán.' },
      { name: 'MACD', impact: 6, value: latest.macd_hist, note: 'MACD histogram phản ánh động lượng ngắn hạn.' },
      { name: 'Bollinger width', impact: 5, value: latest.bb_width, note: 'Độ rộng Bollinger mô tả biến động.' }
    ],
    method: 'Mock rule-based',
    disclaimer: 'Risk Score là chỉ báo tham khảo cho bài học.'
  };
}

function buildMockMarketAlerts() {
  const risk = buildMockRiskScore();
  const latest = window.MOCK_DATA?.latest || {};
  const data = [];
  if ((latest.rsi_14 || 0) > 70) data.push({ severity: 'warn', title: 'RSI quá mua', message: 'RSI cao, cần thận trọng khi mua mới.', metric: 'rsi_14', value: latest.rsi_14 });
  if ((latest.macd_hist || 0) < 0) data.push({ severity: 'warn', title: 'MACD yếu', message: 'MACD histogram âm, động lượng chưa mạnh.', metric: 'macd_hist', value: latest.macd_hist });
  if (!data.length) data.push({ severity: 'info', title: 'Chưa có cảnh báo mạnh', message: 'Các rule hiện tại chưa phát hiện tín hiệu rủi ro nổi bật.', metric: 'market' });
  return { count: data.length, data, risk, sources: { latest: 'mock', summary: 'mock', p2p: 'mock' }, disclaimer: 'Cảnh báo rule-based chỉ dùng tham khảo.' };
}

function buildMockP2PComparison() {
  const rows = normalizeP2P(24).data || [];
  const compare = (row, userSide) => {
    if (!row) return null;
    const diff = (row.p2p_price || 0) - (row.market_price || 0);
    const diffPct = row.market_price ? diff / row.market_price * 100 : 0;
    const favorable = userSide === 'sell' ? diff > 0 : diff < 0;
    return { trade_type: row.trade_type, user_side: userSide, p2p_price: row.p2p_price, market_price: row.market_price, difference_vnd: Math.round(diff), difference_pct: Number(diffPct.toFixed(4)), favorable, samples: row.samples, timestamp: row.timestamp, explain: favorable ? 'Nguồn P2P đang có lợi hơn giá tham chiếu.' : 'Nguồn P2P đang kém lợi hơn giá tham chiếu.' };
  };
  return { source: 'mock', sell: compare(rows.find(r => r.trade_type === 'SELL'), 'sell'), buy: compare(rows.find(r => r.trade_type === 'BUY'), 'buy'), summary: 'So sánh P2P với giá thị trường quy đổi VNĐ.', disclaimer: 'Spread thay đổi nhanh theo merchant và hạn mức.' };
}


function buildMockNews() {
  const now = new Date().toISOString();
  return {
    count: 5,
    source: 'mock',
    sources: [],
    disclaimer: 'Tin tức demo dùng khi backend hoặc RSS chưa sẵn sàng.',
    data: [
      { title: 'Bitcoin biến động mạnh: nên kết hợp Risk Score, dữ liệu P2P và độ mới dữ liệu', source: 'Demo fallback', published_at: now, link: '#', summary: 'Tin demo phục vụ ticker: người dùng không nên đọc giá đơn lẻ mà cần nhìn cả rủi ro và dữ liệu cập nhật.', tags: ['BTC', 'risk'] },
      { title: 'Dữ liệu P2P giúp ước tính số tiền thực nhận sát tình huống giao dịch tại Việt Nam', source: 'Demo fallback', published_at: now, link: '#', summary: 'Spread P2P có thể làm số tiền nhận được khác đáng kể so với giá thị trường quy đổi.', tags: ['P2P', 'VND'] },
      { title: 'AI Advisor cần giải thích lý do, rủi ro và disclaimer thay vì đưa lệnh mua bán tuyệt đối', source: 'Demo fallback', published_at: now, link: '#', summary: 'AI trong phạm vi môn học đóng vai trò diễn giải dữ liệu và hỗ trợ học tập.', tags: ['AI', 'education'] },
      { title: 'GitHub Actions đồng bộ dữ liệu theo giờ giúp dashboard tránh phụ thuộc dữ liệu mock', source: 'Demo fallback', published_at: now, link: '#', summary: 'Pipeline dữ liệu tự động là điểm cộng cho báo cáo FinTech/BigData.', tags: ['pipeline', 'data'] },
      { title: 'Cookie banner minh bạch lựa chọn lưu trữ local preference cho trải nghiệm người dùng', source: 'Demo fallback', published_at: now, link: '#', summary: 'Trong MVP, cookie chỉ dùng để lưu lựa chọn giao diện/cookie consent, không tracking.', tags: ['UX', 'cookie'] }
    ]
  };
}

function mockFor(endpoint) {
  if (endpoint.startsWith('/api/latest')) return window.MOCK_DATA.latest;
  if (endpoint.startsWith('/api/indicators/summary')) return window.MOCK_DATA.summary;
  if (endpoint.startsWith('/api/ohlcv')) {
    const hours = Number(new URLSearchParams(endpoint.split('?')[1] || '').get('hours') || 168);
    return normalizeOhlcv(hours);
  }
  if (endpoint.startsWith('/api/p2p-spread')) {
    const hours = Number(new URLSearchParams(endpoint.split('?')[1] || '').get('hours') || 168);
    return normalizeP2P(hours);
  }
  if (endpoint.startsWith('/api/risk-score')) return buildMockRiskScore();
  if (endpoint.startsWith('/api/market-alerts')) return buildMockMarketAlerts();
  if (endpoint.startsWith('/api/data-reliability')) return buildMockDataReliability();
  if (endpoint.startsWith('/api/p2p-comparison')) return buildMockP2PComparison();
  if (endpoint.startsWith('/api/news/latest')) return buildMockNews();
  if (endpoint.startsWith('/api/ai/history')) return window.MOCK_DATA.aiHistory || { count: 0, data: [] };
  if (endpoint.startsWith('/api/wallet/me')) return { wallet: { balance_vnd: 100000, balance_usdt_demo: 0 }, transactions: [], sandbox: true, disclaimer: 'Ví demo fallback khi backend chưa sẵn sàng.' };
  if (endpoint.startsWith('/api/payment/subscription')) {
    const raw = localStorage.getItem('btc_premium_subscription');
    if (raw) {
      try { return JSON.parse(raw); } catch (_) { }
    }
    return { active: false, plan_id: 'free', plan_name: 'Free', sandbox: true };
  }
  return null;
}

async function fetchJson(endpoint, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const url = apiUrl(endpoint);
  const requestKey = isGet ? `${url}|${currentSession?.access_token ? 'auth' : 'anon'}` : '';

  if (isGet) {
    fetchJson._inFlight ||= new Map();
    if (fetchJson._inFlight.has(requestKey)) return fetchJson._inFlight.get(requestKey);
  }

  const requestPromise = (async () => {
    const controller = new AbortController();
    const timeoutMs = options.timeout ?? 30000;
    const timeout = timeoutMs > 0
      ? setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs)
      : null;
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeader(), ...(options.headers || {}) },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      if (timeout) clearTimeout(timeout);
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const err = await response.json();
          detail = err.detail || detail;
        } catch (_) { }
        throw new Error(detail);
      }
      return { data: await response.json(), source: 'api' };
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      const fallback = mockFor(endpoint);
      if (fallback) return { data: fallback, source: 'mock', error };
      throw error;
    } finally {
      if (isGet) fetchJson._inFlight?.delete(requestKey);
    }
  })();

  if (isGet) fetchJson._inFlight.set(requestKey, requestPromise);
  return requestPromise;
}

async function refreshTopTicker() {
  if (!topTicker) return;
  if (getCurrentRouteName() === 'set-password' || passwordSavingInProgress) return;

  const now = Date.now();
  if (topTickerBusy || now - lastTopTickerAt < 8000) return;

  topTickerBusy = true;
  lastTopTickerAt = now;
  try {
    const res = await fetchJson('/api/latest', { timeout: 5500 });
    topTicker.innerHTML = `BTC/USDT <strong>${formatUSD(res.data.close)}</strong>`;
    topTicker.title = `${res.source === 'api' ? 'API backend' : 'Fallback demo'} · ${formatVNTime(res.data.timestamp)}`;
  } catch (error) {
    console.warn('Không cập nhật được ticker BTC:', error.message);
  } finally {
    topTickerBusy = false;
  }
}

function loadingCard(height = 160) {
  return `<div class="card"><div class="skeleton" style="height:${height}px"></div></div>`;
}

function errorBox(message) {
  return `<div class="state-box error"><strong>Không tải được dữ liệu.</strong><p>${escapeHTML(message || 'Vui lòng thử lại.')}</p></div>`;
}

function sectionHead(eyebrow, title, desc = '') {
  return `<div class="section-head"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ''}</div></div>`;
}

function bmcItems() {
  return [
    {
      id: 'cs', title: 'Customer Segments', vi: 'Phân khúc khách hàng', className: 'bmc-cs',
      bullets: ['Nhà đầu tư Bitcoin cá nhân tại Việt Nam', 'Người mới cần diễn giải tiếng Việt', 'Người giao dịch P2P USDT/VNĐ', 'Nhóm cần công cụ demo FinTech/BigData'],
      detail: 'Tập trung vào nhóm cá nhân thiếu đội ngũ phân tích riêng, cần một dashboard đơn giản để hiểu tín hiệu kỹ thuật, chi phí P2P và nghĩa vụ thuế trước khi ra quyết định.'
    },
    {
      id: 'vp', title: 'Value Propositions', vi: 'Giá trị cốt lõi', className: 'bmc-vp',
      bullets: ['Gộp kỹ thuật + P2P + thuế trong một nơi', 'AI giải thích bằng tiếng Việt', 'Dữ liệu tự động cập nhật', 'API công khai/minh chứng được'],
      detail: 'Điểm khác biệt nằm ở tổ hợp AI + BigData: không chỉ xem biểu đồ, mà còn biết bán P2P có lợi/thiệt và ước tính thuế ngay trong cùng hành trình.'
    },
    {
      id: 'ch', title: 'Channels', vi: 'Kênh phân phối', className: 'bmc-ch',
      bullets: ['Website dashboard', 'API docs/Swagger', 'GitHub demo', 'Zalo/Telegram cảnh báo ở giai đoạn mở rộng'],
      detail: 'Kênh chính trong MVP là web app, sau đó mở rộng qua bot/cảnh báo tự động khi có tín hiệu mạnh.'
    },
    {
      id: 'cr', title: 'Customer Relationships', vi: 'Quan hệ khách hàng', className: 'bmc-cr',
      bullets: ['Tự phục vụ qua dashboard', 'Chat AI hỏi đáp', 'Thông báo tín hiệu định kỳ', 'Giải thích dễ hiểu cho người không chuyên'],
      detail: 'Nền tảng tạo quan hệ dạng trợ lý tài chính tự động: người dùng không cần đọc nhiều bảng số, có thể hỏi AI để hiểu lý do.'
    },
    {
      id: 'rs', title: 'Revenue Streams', vi: 'Dòng doanh thu', className: 'bmc-rev',
      bullets: [
        'Subscription/Free Trial: dùng thử 7 ngày, sau đó có thể nâng cấp gói trả phí dự kiến 49.000đ/tháng',
        'Gói nâng cao gồm phân tích kỹ thuật, theo dõi chênh lệch P2P, cảnh báo, ước tính chi phí/thuế và AI Advisor',
        'Quảng cáo và hợp tác với doanh nghiệp blockchain hoặc FinTech, có công bố minh bạch',
        'Affiliate Marketing khi người dùng đăng ký tài khoản sàn giao dịch qua liên kết giới thiệu',
        'API/Data Service trong tương lai cho doanh nghiệp, tổ chức nghiên cứu hoặc nhà phát triển',
        'Các gói mở rộng như cảnh báo nâng cao, lịch sử dữ liệu sâu hơn hoặc xuất báo cáo phân tích'
      ],
      detail: 'Dòng doanh thu chính định hướng theo mô hình subscription có free trial. Các nguồn bổ sung như quảng cáo, affiliate và API dữ liệu chỉ nên triển khai minh bạch để không làm giảm tính khách quan của nền tảng phân tích.'
    },
    {
      id: 'kr', title: 'Key Resources', vi: 'Nguồn lực chính', className: 'bmc-kr',
      bullets: ['Dữ liệu Binance OHLCV/P2P', 'Supabase lưu dữ liệu', 'FastAPI backend', 'AI API key trong .env', 'Frontend dashboard'],
      detail: 'Nguồn lực cốt lõi gồm kho dữ liệu, pipeline tính chỉ báo, backend chuẩn hóa API, và AI prompt để diễn giải tín hiệu.'
    },
    {
      id: 'ka', title: 'Key Activities', vi: 'Hoạt động chính', className: 'bmc-ka',
      bullets: ['Thu thập dữ liệu theo giờ', 'Tính RSI/MACD/EMA/Bollinger', 'Đo spread P2P', 'Cập nhật Supabase', 'Vận hành AI Advisor'],
      detail: 'Hoạt động chính là pipeline tự động: thu thập → xử lý → lưu → phục vụ API → hiển thị dashboard/AI.'
    },
    {
      id: 'kp', title: 'Key Partnerships', vi: 'Đối tác chính', className: 'bmc-kp',
      bullets: ['Binance: dữ liệu giá/P2P', 'Supabase: database/API management', 'Render/Vercel: triển khai', 'Gemini/Groq/HuggingFace: AI free tier'],
      detail: 'Các đối tác kỹ thuật giúp giảm chi phí MVP và chứng minh mô hình chạy thật mà chưa cần hạ tầng trả phí lớn.'
    },
    {
      id: 'cost', title: 'Cost Structure', vi: 'Cấu trúc chi phí', className: 'bmc-cost',
      bullets: ['Supabase free tier', 'Render/Vercel free tier', 'AI API free tier', 'Chi phí tăng khi vượt quota hoặc mở rộng nhiều coin'],
      detail: 'Cấu trúc chi phí giai đoạn đầu gần như bằng 0, phù hợp thử nghiệm ý tưởng trước khi thương mại hóa.'
    }
  ];
}

function renderBusinessPage() {
  app.innerHTML = `
    <section class="hero">
      <div class="hero-grid">
        <div>
          <span class="eyebrow">Chương 1 · Đề xuất mô hình kinh doanh</span>
          <h1>Trợ lý phân tích Bitcoin tích hợp BigData + AI cho nhà đầu tư cá nhân Việt Nam</h1>
          <p class="lead">Website này được xây dựng để khớp trực tiếp với bài báo cáo: trình bày bài toán, nhu cầu thị trường, mô hình kinh doanh, đối thủ cạnh tranh và phần demo kỹ thuật bằng API thật/fallback Supabase-ready.</p>
          <div class="hero-actions">
            <a class="btn primary" href="#dashboard">Xem dashboard minh chứng</a>
            <a class="btn accent" href="#bmc">Xem Business Model Canvas</a>
            <a class="btn secondary" href="#experiment">Chạy kịch bản thử nghiệm</a>
          </div>
        </div>
        <div class="hero-panel">
          <div class="problem-list">
            <div class="problem-item"><b>1</b><div><strong>Nên mua hay bán?</strong><span>Người dùng cần RSI, MACD, EMA, Bollinger nhưng muốn lời giải thích tiếng Việt dễ hiểu.</span></div></div>
            <div class="problem-item"><b>2</b><div><strong>Bán P2P có thiệt không?</strong><span>Giá USDT/VNĐ qua P2P lệch tỷ giá quốc tế, tạo chi phí ẩn khó đo thủ công.</span></div></div>
            <div class="problem-item"><b>3</b><div><strong>Phải đóng thuế bao nhiêu?</strong><span>Người bán cần ước tính nghĩa vụ thuế trước khi quyết định giao dịch.</span></div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      ${sectionHead('1.1 - 1.2', 'Bài toán và tính cấp thiết', 'Crypto tăng nhanh, nhà đầu tư cá nhân cần một công cụ tổng hợp dữ liệu, diễn giải và hỗ trợ quyết định thay vì phải mở nhiều nguồn rời rạc.')}
      <div class="grid three">
        <article class="card"><span class="badge blue">Phân tích kỹ thuật</span><h3>Từ số liệu thành tín hiệu</h3><p>Backend chuẩn hóa OHLCV và chỉ báo thành các endpoint để frontend hiển thị giá, xu hướng và tín hiệu MUA/BÁN/TRUNG LẬP.</p></article>
        <article class="card"><span class="badge amber">P2P Việt Nam</span><h3>Đo chi phí ẩn</h3><p>Chênh lệch P2P được tách chiều BUY/SELL để tránh hiểu nhầm khi người dùng mua hoặc bán USDT lấy VNĐ.</p></article>
        <article class="card"><span class="badge violet">AI tiếng Việt</span><h3>Giải thích dễ hiểu</h3><p>AI không tự bịa dữ liệu; backend đưa dữ liệu thật vào prompt để AI diễn giải lý do và cảnh báo rủi ro.</p></article>
      </div>
    </section>

    <section class="section">
      ${sectionHead('1.3 - 1.5', 'Đề xuất mô hình kinh doanh và mục tiêu đề tài', 'MVP là nền tảng web tự phục vụ, giai đoạn đầu miễn phí để kiểm chứng nhu cầu, sau đó mở rộng sang cảnh báo và gói Pro.')}
      <div class="split">
        <div class="highlight-box">
          <h3>Mô hình đề xuất</h3>
          <p>Nền tảng <strong>BTC BigData AI Advisor</strong> cung cấp dashboard phân tích Bitcoin, đo P2P spread, ước tính thuế và chat AI tư vấn theo dữ liệu. Mục tiêu là giảm thời gian ra quyết định và tăng khả năng tuân thủ/rủi ro cho nhà đầu tư cá nhân.</p>
          <ul class="report-list">
            <li>Người dùng phổ thông: xem nhanh tín hiệu và lý do.</li>
            <li>Người giao dịch P2P: biết lợi/thiệt khi mua/bán USDT.</li>
            <li>Nhóm báo cáo: có API, Supabase schema, frontend demo và AI prompt để minh chứng.</li>
          </ul>
        </div>
        <div class="grid two">
          <div class="card"><span class="badge green">Phù hợp</span><h3>Đúng nhu cầu thực tế</h3><p>Giải quyết đồng thời ba câu hỏi: tín hiệu kỹ thuật, chi phí P2P và thuế.</p></div>
          <div class="card"><span class="badge blue">Mới</span><h3>Tổ hợp dữ liệu hiếm gặp</h3><p>Trading/chart tools thường thiếu P2P Việt Nam và góc nhìn thuế.</p></div>
          <div class="card"><span class="badge violet">Sáng tạo</span><h3>AI diễn giải dữ liệu</h3><p>AI biến chỉ báo thành ngôn ngữ tự nhiên, có kết luận và lý do.</p></div>
          <div class="card"><span class="badge amber">Khả thi</span><h3>Chạy được MVP</h3><p>Backend FastAPI, Supabase schema, frontend demo và fallback data đã sẵn sàng đưa lên GitHub.</p></div>
        </div>
      </div>
    </section>

    <section class="section">
      ${sectionHead('1.6 - 1.7', 'Đối thủ cạnh tranh và lợi thế nền tảng', 'Bảng này dùng trực tiếp cho phần phân tích đối thủ trong báo cáo và slide thuyết trình.')}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Giải pháp</th><th>Điểm mạnh</th><th>Hạn chế</th><th>Lợi thế BTC BigData + AI</th></tr></thead>
          <tbody>
            <tr><td><strong>TradingView</strong></td><td>Biểu đồ/chỉ báo kỹ thuật rất mạnh.</td><td>Không có P2P VN, không ưu tiên AI tư vấn tiếng Việt theo dữ liệu thuế/P2P.</td><td>Thêm lớp P2P + thuế + AI giải thích cho nhà đầu tư Việt Nam.</td></tr>
            <tr><td><strong>CoinMarketCap / CoinGecko</strong></td><td>Dữ liệu giá đa dạng, nhiều coin.</td><td>Không tích hợp phân tích kỹ thuật sâu trong hành trình ra quyết định.</td><td>Có chỉ báo, tín hiệu tổng hợp và dashboard hành động.</td></tr>
            <tr><td><strong>Nhóm Facebook/Zalo P2P</strong></td><td>Cập nhật nhanh theo cảm nhận cộng đồng.</td><td>Thủ công, khó kiểm chứng, không tự động hóa.</td><td>Đo spread có cấu trúc, lưu lịch sử, hiển thị minh bạch.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderBMCPage() {
  const items = bmcItems();
  app.innerHTML = `
    <section class="page-head">
      <div>
        <span class="eyebrow">Chương 2 · Business Model Canvas</span>
        <h1>Khung BMC 9 thành phần cho BTC BigData AI Advisor</h1>
        <p class="lead">Trang này đóng vai trò bản BMC số: có khung tổng quan, có phân tích từng thành phần và liên kết ngược với tiêu chí phù hợp/mới/sáng tạo/khả thi ở Chương 1.</p>
      </div>
      <div class="hero-actions"><a class="btn primary" href="#experiment">Chạy demo kiểm chứng</a></div>
    </section>

    <section class="section">
      <div class="canvas-grid" id="canvasGrid">
        ${items.map(item => `
          <article class="bmc-block ${item.className}" data-bmc="${item.id}">
            <h3>${item.title}<span>+</span></h3>
            <p><strong>${item.vi}</strong></p>
            <ul>${item.bullets.slice(0, 4).map(b => `<li>${b}</li>`).join('')}</ul>
          </article>
        `).join('')}
      </div>
      <div id="bmcDetail" class="result-panel"></div>
    </section>

    <section class="section">
      ${sectionHead('2.1.2', 'Đối chiếu tiêu chí với Chương 1')}
      <div class="kpi-row">
        <div class="stat-card"><span class="stat-label">Phù hợp</span><strong class="stat-value">3-in-1</strong><div class="stat-note">Kỹ thuật + P2P + Thuế</div></div>
        <div class="stat-card"><span class="stat-label">Tính mới</span><strong class="stat-value">VN-first</strong><div class="stat-note">Tập trung P2P/thuế Việt Nam</div></div>
        <div class="stat-card"><span class="stat-label">Sáng tạo</span><strong class="stat-value">AI</strong><div class="stat-note">Giải thích tín hiệu bằng tiếng Việt</div></div>
        <div class="stat-card"><span class="stat-label">Khả thi</span><strong class="stat-value">MVP</strong><div class="stat-note">FastAPI + Supabase + Vite</div></div>
      </div>
    </section>
  `;
  const detail = document.getElementById('bmcDetail');
  function setDetail(id) {
    const item = items.find(x => x.id === id) || items[1];
    document.querySelectorAll('.bmc-block').forEach(el => el.classList.toggle('active', el.dataset.bmc === item.id));
    detail.innerHTML = `
      <span class="badge amber">Chi tiết BMC</span>
      <h2 style="margin-top:10px">${item.title} — ${item.vi}</h2>
      <p>${item.detail}</p>
      <ul class="report-list">${item.bullets.map(b => `<li>${b}</li>`).join('')}</ul>
    `;
  }
  document.querySelectorAll('[data-bmc]').forEach(el => el.addEventListener('click', () => setDetail(el.dataset.bmc)));
  setDetail('vp');
}

function renderExperimentPage() {
  app.innerHTML = `
    <section class="page-head">
      <div>
        <span class="eyebrow">Chương 3 · Thử nghiệm mô hình kinh doanh</span>
        <h1>Minh chứng kỹ thuật: Pipeline → Automation → Backend → Frontend</h1>
        <p class="lead">Trang này dùng để demo trực tiếp trong báo cáo: gọi API backend, hiển thị dữ liệu, thử tính thuế và gửi câu hỏi AI. Khi chưa có Supabase/API thật, hệ thống tự dùng fallback data để vẫn thuyết trình được.</p>
      </div>
      <div class="hero-actions"><a class="btn primary" href="#dashboard">Mở dashboard</a><a class="btn secondary" href="#chat">Mở Chat AI</a></div>
    </section>

    <section class="section">
      ${sectionHead('3.2.1', 'Kiến trúc ứng dụng 4 tầng')}
      <div class="mini-flow">
        <div class="flow-step"><b>1</b><h3>Pipeline</h3><p>Thu thập BTC/USDT, P2P, tính RSI/MACD/EMA/Bollinger và chuẩn hóa dữ liệu.</p></div>
        <div class="flow-step"><b>2</b><h3>Automation</h3><p>Chạy định kỳ theo giờ, cập nhật Supabase để dữ liệu luôn mới.</p></div>
        <div class="flow-step"><b>3</b><h3>Backend</h3><p>FastAPI trả endpoint: latest, ohlcv, summary, p2p, tax, AI ask/history.</p></div>
        <div class="flow-step"><b>4</b><h3>Frontend</h3><p>Vite dashboard hiển thị biểu đồ, P2P, thuế và chat AI tư vấn.</p></div>
      </div>
    </section>

    <section class="section">
      ${sectionHead('3.3', 'Kịch bản thử nghiệm đề xuất', 'Bấm từng nút để gọi đúng API/logic tương ứng. Kết quả sẽ hiện ngay bên phải để chụp màn hình đưa vào báo cáo.')}
      <div class="demo-grid">
        <div class="card demo-actions">
          <button class="btn primary full" data-demo="latest">1. Gọi /api/latest</button>
          <button class="btn secondary full" data-demo="p2p">2. Gọi /api/p2p-spread</button>
          <button class="btn secondary full" data-demo="tax">3. Tính thuế bán 100 triệu</button>
          <button class="btn accent full" data-demo="ai">4. Hỏi AI: nên mua hay bán?</button>
          <a class="btn ghost full" href="#chart">Xem biểu đồ kỹ thuật</a>
          <a class="btn ghost full" href="#trade">Mô phỏng giao dịch</a>
        </div>
        <div class="card">
          <h3>Kết quả thử nghiệm</h3>
          <p id="demoHint">Chưa chạy kịch bản nào. Hãy bấm một nút bên trái.</p>
          <pre id="apiLog" class="api-log"></pre>
        </div>
      </div>
    </section>

    <section class="section">
      ${sectionHead('3.2.2 - 3.3.4', 'Tính năng và công nghệ sử dụng')}
      <div class="grid three">
        <div class="card"><span class="badge blue">OHLCV</span><h3>Biểu đồ và chỉ báo</h3><p>Frontend gọi <code>/api/ohlcv?hours=N</code> để vẽ nến/đường giá, RSI, MACD và EMA.</p></div>
        <div class="card"><span class="badge amber">P2P Spread</span><h3>Chi phí thực tế</h3><p>Endpoint <code>/api/p2p-spread</code> tách BUY/SELL, diễn giải lợi/thiệt theo đúng dấu.</p></div>
        <div class="card"><span class="badge violet">AI API</span><h3>Tư vấn có kiểm soát</h3><p><code>POST /api/ai/ask</code> lấy dữ liệu thị trường làm context, key AI nằm trong backend <code>.env</code>.</p></div>
      </div>
    </section>
  `;
  document.querySelectorAll('[data-demo]').forEach(btn => btn.addEventListener('click', () => runDemo(btn.dataset.demo)));
}

function renderTheoryPage() {
  const items = bmcItems();
  app.innerHTML = `
    <section class="page-head theory-hero">
      <div>
        <span class="eyebrow">Lý thuyết tổng hợp · Chương 1–3</span>
        <h1>Một trang lý thuyết gọn cho báo cáo BTC BigData AI Advisor</h1>
        <p class="lead">Ba chương lý thuyết được gom về một trang riêng để người dùng phổ thông không bị rối. Các tính năng sản phẩm nằm trong menu Công cụ và có thể mở khi cần demo.</p>
      </div>
      <div class="hero-actions"><a class="btn primary" href="#dashboard">Mở dashboard</a><a class="btn secondary" href="#theory-ch3">Xem thử nghiệm</a></div>
    </section>

    <nav class="theory-tabs" aria-label="Đi tới chương lý thuyết">
      <a href="#theory-ch1"><strong>Chương 1</strong><span>Mô hình kinh doanh</span></a>
      <a href="#theory-ch2"><strong>Chương 2</strong><span>BMC 9 thành phần</span></a>
      <a href="#theory-ch3"><strong>Chương 3</strong><span>Thử nghiệm MVP</span></a>
    </nav>

    <section id="theory-ch1" class="section chapter-card">
      ${sectionHead('Chương 1', 'Đề xuất mô hình kinh doanh', 'Mục tiêu là biến dữ liệu Bitcoin, P2P và thuế thành một trợ lý ra quyết định dễ hiểu bằng tiếng Việt.')}
      <div class="grid three">
        <div class="card"><span class="badge blue">Nhu cầu</span><h3>Người dùng cần tín hiệu dễ hiểu</h3><p>Thay vì tự đọc RSI, MACD, EMA, người dùng nhận được diễn giải ngắn gọn: MUA, BÁN hoặc TRUNG LẬP kèm lý do.</p></div>
        <div class="card"><span class="badge amber">Khác biệt</span><h3>Gộp kỹ thuật + P2P + thuế</h3><p>Không chỉ xem biểu đồ, hệ thống còn tính spread P2P và ước tính số tiền thực nhận khi bán.</p></div>
        <div class="card"><span class="badge violet">Khả thi</span><h3>MVP chạy thật</h3><p>Frontend Vite, backend FastAPI, Supabase và AI Provider được tách riêng để dễ demo, bảo trì và triển khai.</p></div>
      </div>
    </section>

    <section id="theory-ch2" class="section chapter-card">
      ${sectionHead('Chương 2', 'Business Model Canvas rút gọn', 'Bấm vào từng ô để xem phân tích chi tiết nhưng vẫn nằm trong cùng một trang lý thuyết.')}
      <div class="canvas-grid compact" id="theoryCanvasGrid">
        ${items.map(item => `
          <article class="bmc-block ${item.className}" data-bmc="${item.id}">
            <h3>${item.title}<span>+</span></h3>
            <p><strong>${item.vi}</strong></p>
            <ul>${item.bullets.slice(0, 3).map(b => `<li>${b}</li>`).join('')}</ul>
          </article>
        `).join('')}
      </div>
      <div id="theoryBmcDetail" class="result-panel"></div>
    </section>

    <section id="theory-ch3" class="section chapter-card">
      ${sectionHead('Chương 3', 'Thử nghiệm mô hình và minh chứng kỹ thuật', 'Các nút bên dưới gọi API/logic thật nếu backend hoạt động; khi lỗi sẽ dùng fallback demo để thuyết trình không bị gián đoạn.')}
      <div class="demo-grid">
        <div class="card demo-actions">
          <button class="btn primary full" data-demo="latest">1. Gọi /api/latest</button>
          <button class="btn secondary full" data-demo="p2p">2. Gọi /api/p2p-spread</button>
          <button class="btn secondary full" data-demo="tax">3. Tính thuế bán 100 triệu</button>
          <button class="btn accent full" data-demo="ai">4. Hỏi AI: nên mua hay bán?</button>
        </div>
        <div class="card">
          <h3>Kết quả thử nghiệm</h3>
          <p id="demoHint">Chưa chạy kịch bản nào. Hãy bấm một nút bên trái.</p>
          <pre id="apiLog" class="api-log"></pre>
        </div>
      </div>
      <div class="mini-flow section">
        <div class="flow-step"><b>1</b><h3>Pipeline</h3><p>Thu thập và chuẩn hóa dữ liệu BTC/P2P.</p></div>
        <div class="flow-step"><b>2</b><h3>Backend</h3><p>FastAPI trả API cho frontend và AI.</p></div>
        <div class="flow-step"><b>3</b><h3>Frontend</h3><p>Dashboard, biểu đồ, thuế, P2P, chat.</p></div>
        <div class="flow-step"><b>4</b><h3>AI</h3><p>Diễn giải tín hiệu bằng tiếng Việt.</p></div>
      </div>
    </section>
  `;

  const detail = document.getElementById('theoryBmcDetail');
  function setDetail(id) {
    const item = items.find(x => x.id === id) || items[1];
    document.querySelectorAll('#theoryCanvasGrid .bmc-block').forEach(el => el.classList.toggle('active', el.dataset.bmc === item.id));
    detail.innerHTML = `
      <span class="badge amber">Chi tiết BMC</span>
      <h2 style="margin-top:10px">${item.title} — ${item.vi}</h2>
      <p>${item.detail}</p>
      <ul class="report-list">${item.bullets.map(b => `<li>${b}</li>`).join('')}</ul>
    `;
  }
  document.querySelectorAll('#theoryCanvasGrid [data-bmc]').forEach(el => el.addEventListener('click', () => setDetail(el.dataset.bmc)));
  setDetail('vp');
  document.querySelectorAll('[data-demo]').forEach(btn => btn.addEventListener('click', () => runDemo(btn.dataset.demo)));
}

async function runDemo(type) {
  const log = document.getElementById('apiLog');
  const hint = document.getElementById('demoHint');
  hint.textContent = 'Đang chạy kịch bản...';
  log.textContent = '';
  try {
    let res;
    if (type === 'latest') res = await fetchJson('/api/latest');
    if (type === 'p2p') res = await fetchJson('/api/p2p-spread?hours=168');
    if (type === 'tax') res = await fetchJson('/api/tax-estimate?amount=100000000&country=VN');
    if (type === 'ai') {
      res = await askAI('Dựa trên dữ liệu hiện tại, giờ nên mua hay bán BTC? Hãy nêu lý do ngắn gọn.');
    }
    hint.innerHTML = `Hoàn tất · ${sourcePill(res.source)}`;
    log.textContent = JSON.stringify(res.data, null, 2);
  } catch (error) {
    hint.textContent = 'Có lỗi khi chạy thử nghiệm.';
    log.textContent = error.message;
  }
}

async function renderDashboardPage() {
  app.innerHTML = `
    <section class="page-head dashboard-page-head">
      <div>
        <span class="eyebrow">Tổng quan thị trường</span>
        <h1>Dashboard Bitcoin trực quan</h1>
        <p class="lead">Theo dõi giá, tín hiệu kỹ thuật, Risk Score và quy đổi BTC ↔ USD ↔ VNĐ trên cùng một màn hình.</p>
      </div>
      <div class="dashboard-head-actions">
        <a class="btn secondary" href="#decision">Mở Decision Hub</a>
        <button class="btn primary" id="refreshDashboard">Làm mới dữ liệu</button>
      </div>
    </section>
    <section id="dashboardContent" class="dashboard-loading-shell">
      <div class="grid three">${loadingCard(170)}${loadingCard(170)}${loadingCard(170)}</div>
      ${loadingCard(480)}
    </section>
  `;
  document.getElementById('refreshDashboard').addEventListener('click', renderDashboardPage);
  try {
    const [latestRes, summaryRes, ohlcvRes, riskRes, alertsRes, p2pRes] = await Promise.all([
      fetchJson('/api/latest'),
      fetchJson('/api/indicators/summary'),
      fetchJson('/api/ohlcv?hours=72'),
      fetchJson('/api/risk-score'),
      fetchJson('/api/market-alerts'),
      fetchJson('/api/p2p-comparison')
    ]);

    const latest = latestRes.data || {};
    const summary = summaryRes.data || {};
    const ohlcv = ohlcvRes.data || {};
    const rows = Array.isArray(ohlcv.data) ? ohlcv.data : [];
    const risk = riskRes.data || {};
    const alerts = alertsRes.data?.data || alertsRes.data || [];
    const p2p = p2pRes.data || {};
    const signals = summary.signals || {};
    const verdict = summary.overall?.verdict || 'NEUTRAL';
    const firstClose = Number(rows[0]?.close || latest.open || latest.close || 0);
    const btcUsd = Number(latest.close || rows.at(-1)?.close || 0);
    const change24 = firstClose ? ((btcUsd - firstClose) / firstClose) * 100 : 0;
    const buyRate = Number(p2p.buy?.p2p_price || p2p.buy?.market_price || p2p.sell?.market_price || 26000);
    const sellRate = Number(p2p.sell?.p2p_price || p2p.sell?.market_price || p2p.buy?.market_price || 26000);
    const btcBuyVnd = btcUsd * buyRate;
    const btcSellVnd = btcUsd * sellRate;
    const riskScore = Number(risk.score || 0);
    const riskLabel = escapeHTML(risk.label_vi || risk.level || 'Chưa xác định');

    document.getElementById('dashboardContent').innerHTML = `
      <section class="dashboard-market-overview">
        <article class="dashboard-price-hero">
          <div class="dashboard-price-topline">
            <div><span class="dashboard-symbol">₿</span><span><strong>Bitcoin</strong><small>BTC/USDT · Spot</small></span></div>
            <span class="dashboard-live-dot">Dữ liệu mới nhất</span>
          </div>
          <div class="dashboard-price-main">
            <div>
              <span>Giá hiện tại</span>
              <strong>${formatUSD(btcUsd)}</strong>
              <small class="${change24 >= 0 ? 'positive' : 'negative'}">${formatPct(change24)} trong 72 giờ</small>
            </div>
            <div class="dashboard-price-vnd">
              <span>Mua qua P2P</span><strong>${formatVND(btcBuyVnd)}</strong>
              <span>Bán qua P2P</span><strong>${formatVND(btcSellVnd)}</strong>
            </div>
          </div>
          <div class="dashboard-price-footer">
            <span>Cập nhật ${formatVNTime(latest.timestamp)}</span>
            <span>${sourcePill(latestRes.source)} · P2P ${sourcePill(p2pRes.source)}</span>
          </div>
        </article>

        <div class="dashboard-signal-stack">
          <article class="dashboard-signal-card">
            <span>Tín hiệu tổng hợp</span>
            <strong>${badge(verdict)}</strong>
            <small>${summary.overall?.buy || 0} MUA · ${summary.overall?.sell || 0} BÁN · ${summary.overall?.neutral || 0} TRUNG LẬP</small>
          </article>
          <article class="dashboard-signal-card">
            <span>Risk Score</span>
            <div class="dashboard-risk-line"><strong>${formatNumber(riskScore, 0)}/100</strong><span>${riskLabel}</span></div>
            <div class="dashboard-risk-track"><i style="width:${Math.max(0, Math.min(100, riskScore))}%"></i></div>
          </article>
          <article class="dashboard-signal-card compact-action-card">
            <span>Hành động nhanh</span>
            <div><a href="#decision">Lập kế hoạch</a><a href="#trade">Giao dịch demo</a><a href="#risk">Xem rủi ro</a></div>
          </article>
        </div>
      </section>

      <section class="dashboard-kpi-strip">
        <div><span>RSI 14</span><strong>${formatNumber(latest.rsi_14, 2)}</strong><small>${escapeHTML(signals.RSI?.note || 'Động lượng thị trường')}</small></div>
        <div><span>MACD</span><strong>${formatNumber(latest.macd, 2)}</strong><small>${escapeHTML(signals.MACD?.note || 'Xu hướng ngắn hạn')}</small></div>
        <div><span>EMA 20 / 50</span><strong>${formatNumber(latest.ema_20, 0)} / ${formatNumber(latest.ema_50, 0)}</strong><small>${badge(signals.EMA_Trend?.signal || 'NEUTRAL')}</small></div>
        <div><span>Khối lượng</span><strong>${formatNumber(latest.volume, 2)} BTC</strong><small>${formatNumber(latest.trades, 0)} giao dịch</small></div>
      </section>

      <section class="dashboard-workspace-grid">
        <article class="card dashboard-technical-card">
          <div class="section-head dashboard-section-head">
            <div><span class="dashboard-section-kicker">Phân tích kỹ thuật</span><h2>Biểu đồ nến, EMA và RSI</h2><p>72 giờ gần nhất, hỗ trợ zoom trực tiếp trên biểu đồ.</p></div>
            <a class="btn secondary small" href="#chart">Mở biểu đồ đầy đủ</a>
          </div>
          <div id="dashboardTechnicalChart" class="chart-box dashboard-technical-chart"></div>
        </article>

        <article class="card dashboard-converter-card">
          <div class="dashboard-card-title">
            <span class="dashboard-section-kicker">Quy đổi nhanh</span>
            <h2>BTC ↔ USD ↔ VNĐ</h2>
            <p>Dùng giá BTC hiện tại và tỷ giá P2P theo chiều mua/bán.</p>
          </div>
          <div class="dashboard-converter-form">
            <label>Số tiền<input id="dashboardConvertAmount" type="number" min="0" step="0.00000001" value="0.01"></label>
            <label>Đơn vị<select id="dashboardConvertUnit"><option value="btc">BTC</option><option value="usd">USD/USDT</option><option value="vnd">VNĐ</option></select></label>
            <label>Chiều P2P<select id="dashboardConvertSide"><option value="buy">Mua BTC</option><option value="sell">Bán BTC</option></select></label>
          </div>
          <div id="dashboardConvertResult" class="dashboard-converter-result"></div>
          <div class="dashboard-rate-note"><span>P2P BUY <strong>${formatVND(buyRate)}</strong></span><span>P2P SELL <strong>${formatVND(sellRate)}</strong></span></div>
        </article>
      </section>

      <section class="dashboard-bottom-grid">
        <article class="card dashboard-indicator-card">
          <div class="section-head dashboard-section-head"><div><span class="dashboard-section-kicker">Chỉ báo</span><h2>Trạng thái kỹ thuật</h2></div><a class="btn secondary small" href="#guide">Cách đọc</a></div>
          <div class="dashboard-indicator-grid">
            ${['RSI', 'MACD', 'Bollinger', 'EMA_Trend'].map(key => {
              const s = signals[key] || { value: null, signal: 'NEUTRAL', note: 'Chưa có dữ liệu' };
              return `<div><span>${key.replace('_', ' ')}</span><strong>${badge(s.signal)}</strong><p>${escapeHTML(s.note)}</p><small>Giá trị ${formatNumber(s.value, 2)}</small></div>`;
            }).join('')}
          </div>
        </article>
        <article class="card dashboard-alert-card">
          <div class="section-head dashboard-section-head"><div><span class="dashboard-section-kicker">Theo dõi rủi ro</span><h2>Cảnh báo nhanh</h2></div><a class="btn secondary small" href="#risk">Chi tiết</a></div>
          ${marketAlertsHTML((Array.isArray(alerts) ? alerts : []).slice(0, 4))}
        </article>
      </section>
    `;

    drawTechnicalChart('dashboardTechnicalChart', rows);
    bindDashboardConverter({ btcUsd, buyRate, sellRate });
  } catch (error) {
    document.getElementById('dashboardContent').innerHTML = errorBox(error.message);
  }
}

function bindDashboardConverter({ btcUsd, buyRate, sellRate }) {
  const amountEl = document.getElementById('dashboardConvertAmount');
  const unitEl = document.getElementById('dashboardConvertUnit');
  const sideEl = document.getElementById('dashboardConvertSide');
  const resultEl = document.getElementById('dashboardConvertResult');
  if (!amountEl || !unitEl || !sideEl || !resultEl) return;

  const update = () => {
    const amount = Math.max(0, Number(amountEl.value || 0));
    const rate = sideEl.value === 'sell' ? sellRate : buyRate;
    let btc = 0;
    let usd = 0;
    let vnd = 0;
    if (unitEl.value === 'btc') {
      btc = amount;
      usd = btc * btcUsd;
      vnd = usd * rate;
    } else if (unitEl.value === 'usd') {
      usd = amount;
      btc = btcUsd ? usd / btcUsd : 0;
      vnd = usd * rate;
    } else {
      vnd = amount;
      usd = rate ? vnd / rate : 0;
      btc = btcUsd ? usd / btcUsd : 0;
    }
    resultEl.innerHTML = `
      <div><span>Bitcoin</span><strong>${formatBTC(btc, 8)}</strong></div>
      <div><span>USD/USDT</span><strong>${formatUSD(usd)}</strong></div>
      <div class="total"><span>Giá trị VNĐ</span><strong>${formatVND(vnd)}</strong><small>${sideEl.value === 'sell' ? 'Ước tính thực nhận trước phí' : 'Ước tính chi phí trước phí'}</small></div>`;
  };

  [amountEl, unitEl, sideEl].forEach(el => {
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });
  update();
}

async function renderChartPage() {
  app.innerHTML = `
    <div class="technical-pro-page">
      <section class="page-head technical-pro-page-head">
        <div class="technical-pro-title-wrap">
          <span class="eyebrow">Phân tích kỹ thuật</span>
          <h1>BTC/USDT Market Terminal</h1>
          <p class="lead">Theo dõi nến 1 giờ, xu hướng EMA, Bollinger Bands, khối lượng, RSI, Stochastic và MACD trong một màn hình.</p>
        </div>
        <div class="technical-pro-head-actions">
          <div class="segmented technical-pro-timeframe" id="chartHours" aria-label="Chọn khung dữ liệu">
            <button data-hours="24">24H</button>
            <button data-hours="168">7 ngày</button>
            <button data-hours="720">30 ngày</button>
          </div>
          <button class="btn secondary technical-pro-refresh" id="technicalRefresh" type="button" title="Tải lại dữ liệu">↻ Làm mới</button>
        </div>
      </section>
      <section id="chartContent">${loadingCard(680)}</section>
    </div>
  `;

  document.querySelectorAll('#chartHours button').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.hours) === chartHours);
    btn.addEventListener('click', () => {
      const nextHours = Number(btn.dataset.hours);
      if (nextHours === chartHours) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      chartHours = nextHours;
      renderChartPage();
    });
  });
  document.getElementById('technicalRefresh')?.addEventListener('click', renderChartPage);

  try {
    const [res, p2pRes] = await Promise.all([
      fetchJson(`/api/ohlcv?hours=${chartHours}`),
      fetchJson(`/api/p2p-spread?hours=${chartHours}`, { timeout: 30000 })
    ]);

    const rows = normalizeTechnicalRows(res.data.data || []);
    if (!rows.length) {
      document.getElementById('chartContent').innerHTML = `<div class="state-box empty">Chưa có dữ liệu OHLCV để hiển thị biểu đồ kỹ thuật.</div>`;
      return;
    }

    const p2pRows = Array.isArray(p2pRes.data?.data) ? p2pRes.data.data : [];
    const snapshot = buildTechnicalSnapshot(rows, p2pRows, chartHours);
    const movementClass = snapshot.periodChange >= 0 ? 'positive' : 'negative';
    const movementIcon = snapshot.periodChange >= 0 ? '↗' : '↘';

    document.getElementById('chartContent').innerHTML = `
      <section class="technical-pro-market-grid">
        <article class="technical-pro-price-card">
          <div class="technical-pro-price-topline">
            <div class="technical-pro-symbol">
              <span class="technical-pro-btc-mark">₿</span>
              <div><strong>BTC/USDT</strong><span>Bitcoin · Nến 1 giờ</span></div>
            </div>
            <span class="technical-pro-live"><i></i>Dữ liệu ${sourcePill(res.source)}</span>
          </div>
          <div class="technical-pro-price-value">${formatUSD(snapshot.close)}</div>
          <div class="technical-pro-price-change ${movementClass}">
            <strong>${movementIcon} ${formatPct(snapshot.periodChange)}</strong>
            <span>${snapshot.periodLabel} · ${formatUSD(snapshot.absoluteChange)}</span>
          </div>
          <div class="technical-pro-price-meta">
            <span>Nến mới nhất <b>${formatVNTime(snapshot.timestamp)}</b></span>
            <span>${rows.length} điểm dữ liệu</span>
          </div>
        </article>

        <div class="technical-pro-kpi-grid">
          ${technicalMetricCard('Cao nhất', formatUSD(snapshot.high), `Biên độ ${formatPct(snapshot.rangePct, 2, false)}`, 'high')}
          ${technicalMetricCard('Thấp nhất', formatUSD(snapshot.low), `Khoảng giá ${formatUSD(snapshot.high - snapshot.low)}`, 'low')}
          ${technicalMetricCard('Khối lượng', formatNumber(snapshot.volume, 2), 'BTC trong khung đã chọn', 'volume')}
          ${technicalMetricCard('ATR 14', formatUSD(snapshot.atr), `${formatPct(snapshot.atrPct, 2, false)} giá hiện tại`, 'atr')}
        </div>
      </section>

      <section class="technical-pro-workspace">
        <article class="technical-pro-chart-card">
          <div class="technical-pro-card-head">
            <div>
              <span class="technical-pro-kicker">BIỂU ĐỒ ĐA CHỈ BÁO</span>
              <h2>Giá, khối lượng và động lượng</h2>
              <p>Di chuột để xem OHLC; kéo thanh dưới biểu đồ để phóng to một giai đoạn.</p>
            </div>
            <div class="technical-pro-chart-actions">
              <button type="button" class="technical-pro-tool active" data-tech-group="ema">EMA</button>
              <button type="button" class="technical-pro-tool active" data-tech-group="bollinger">Bollinger</button>
              <button type="button" class="technical-pro-tool" data-tech-group="p2p" ${snapshot.hasP2P ? '' : 'disabled'}>P2P VNĐ</button>
              <button type="button" class="technical-pro-tool" id="technicalResetZoom">Đặt lại</button>
            </div>
          </div>
          <div class="technical-pro-chart-key">
            <span><i class="up"></i>Nến tăng</span>
            <span><i class="down"></i>Nến giảm</span>
            <span><i class="ema20"></i>EMA20</span>
            <span><i class="ema50"></i>EMA50</span>
            <span><i class="ema200"></i>EMA200</span>
          </div>
          <div id="technicalProChart" class="technical-pro-chart" role="img" aria-label="Biểu đồ kỹ thuật BTC USDT"></div>
          <div class="technical-pro-chart-footer">
            <span>OHLCV ${sourcePill(res.source)}</span>
            <span>P2P ${sourcePill(p2pRes.source)}</span>
            <span>Cập nhật: ${formatVNTime(snapshot.timestamp)}</span>
          </div>
        </article>

        <aside class="technical-pro-analysis-card">
          <div class="technical-pro-analysis-head">
            <div><span class="technical-pro-kicker">TỔNG HỢP TÍN HIỆU</span><h2>Trạng thái thị trường</h2></div>
            <span class="technical-pro-bias ${snapshot.biasClass}">${snapshot.biasLabel}</span>
          </div>
          <div class="technical-pro-score">
            <div class="technical-pro-score-ring" style="--score:${snapshot.score}">
              <strong>${snapshot.score}</strong><span>/100</span>
            </div>
            <div><b>${snapshot.biasTitle}</b><p>${snapshot.biasDescription}</p></div>
          </div>

          <div class="technical-pro-signal-list">
            ${technicalSignalRow('Xu hướng EMA', snapshot.trendLabel, snapshot.trendTone, snapshot.trendNote)}
            ${technicalSignalRow('Động lượng RSI', snapshot.rsiLabel, snapshot.rsiTone, `RSI 14: ${formatNumber(snapshot.rsi, 1)}`)}
            ${technicalSignalRow('MACD', snapshot.macdLabel, snapshot.macdTone, `Histogram: ${formatNumber(snapshot.macdHist, 2)}`)}
            ${technicalSignalRow('Stochastic', snapshot.stochLabel, snapshot.stochTone, `K ${formatNumber(snapshot.stochK, 1)} · D ${formatNumber(snapshot.stochD, 1)}`)}
          </div>

          <div class="technical-pro-levels">
            <div><span>Kháng cự gần</span><strong>${formatUSD(snapshot.resistance)}</strong><small>${formatPct(snapshot.resistanceDistance, 2)} so với giá</small></div>
            <div><span>Hỗ trợ gần</span><strong>${formatUSD(snapshot.support)}</strong><small>${formatPct(snapshot.supportDistance, 2)} so với giá</small></div>
          </div>

          <div class="technical-pro-p2p-box ${snapshot.hasP2P ? '' : 'muted'}">
            <div class="technical-pro-p2p-head"><span>Quy đổi BTC qua P2P</span><b>${snapshot.hasP2P ? 'VNĐ' : 'Chưa có dữ liệu'}</b></div>
            <div><span>Ước tính mua</span><strong>${formatVND(snapshot.p2pBuyBtc)}</strong></div>
            <div><span>Ước tính bán</span><strong>${formatVND(snapshot.p2pSellBtc)}</strong></div>
            <small>Giá BTC/USDT × tỷ giá USDT/VNĐ mới nhất.</small>
          </div>
        </aside>
      </section>

      <section class="technical-pro-indicator-grid">
        ${technicalIndicatorCard('RSI 14', formatNumber(snapshot.rsi, 1), snapshot.rsiLabel, snapshot.rsiTone, clampPercent(snapshot.rsi), '30 quá bán · 70 quá mua')}
        ${technicalIndicatorCard('MACD', formatNumber(snapshot.macd, 2), snapshot.macdLabel, snapshot.macdTone, snapshot.macdGauge, `Signal ${formatNumber(snapshot.macdSignal, 2)}`)}
        ${technicalIndicatorCard('Stochastic', formatNumber(snapshot.stochK, 1), snapshot.stochLabel, snapshot.stochTone, clampPercent(snapshot.stochK), `K ${formatNumber(snapshot.stochK, 1)} · D ${formatNumber(snapshot.stochD, 1)}`)}
        ${technicalIndicatorCard('Bollinger', formatPct(snapshot.bbPosition, 1, false), snapshot.bbLabel, snapshot.bbTone, clampPercent(snapshot.bbPosition), `Độ rộng ${formatPct(snapshot.bbWidth, 2, false)}`)}
        ${technicalIndicatorCard('EMA 20/50', formatUSD(snapshot.ema20), snapshot.trendLabel, snapshot.trendTone, snapshot.emaGauge, `EMA50 ${formatUSD(snapshot.ema50)}`)}
        ${technicalIndicatorCard('Biến động ATR', formatPct(snapshot.atrPct, 2, false), snapshot.volatilityLabel, snapshot.volatilityTone, snapshot.atrGauge, `ATR ${formatUSD(snapshot.atr)}`)}
      </section>

      <section class="technical-pro-explainer">
        <div><span class="technical-pro-kicker">CÁCH ĐỌC NHANH</span><h2>Ba lớp thông tin trên biểu đồ</h2></div>
        <div class="technical-pro-explainer-grid">
          <article><span>01</span><div><b>Xu hướng</b><p>So sánh giá với EMA20, EMA50 và EMA200 để nhận biết xu hướng ngắn, trung và dài hạn.</p></div></article>
          <article><span>02</span><div><b>Động lượng</b><p>RSI, Stochastic và MACD giúp nhận biết lực mua bán, vùng quá mua hoặc quá bán.</p></div></article>
          <article><span>03</span><div><b>Biến động</b><p>ATR, Bollinger Bands và khối lượng cho biết mức độ dao động, không phải dự báo chắc chắn.</p></div></article>
        </div>
      </section>
    `;

    const chart = drawAdvancedTechnicalChart('technicalProChart', rows, p2pRows, snapshot);
    bindTechnicalChartControls(chart);
  } catch (error) {
    document.getElementById('chartContent').innerHTML = errorBox(error.message);
  }
}

function normalizeTechnicalRows(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .filter(row => row?.timestamp)
    .sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp));
}

function technicalNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, technicalNumber(value, 0)));
}

function buildTechnicalSnapshot(rows, p2pRows, hours) {
  const latest = rows.at(-1) || {};
  const first = rows[0] || latest;
  const close = technicalNumber(latest.close, 0);
  const open = technicalNumber(first.open, close);
  const highs = rows.map(row => technicalNumber(row.high)).filter(Number.isFinite);
  const lows = rows.map(row => technicalNumber(row.low)).filter(Number.isFinite);
  const volume = rows.reduce((total, row) => total + (technicalNumber(row.volume, 0) || 0), 0);
  const high = highs.length ? Math.max(...highs) : close;
  const low = lows.length ? Math.min(...lows) : close;
  const absoluteChange = close - open;
  const periodChange = open ? (absoluteChange / open) * 100 : 0;
  const rangePct = low ? ((high - low) / low) * 100 : 0;

  const ema20 = technicalNumber(latest.ema_20, close);
  const ema50 = technicalNumber(latest.ema_50, close);
  const ema200 = technicalNumber(latest.ema_200, close);
  const rsi = technicalNumber(latest.rsi_14, 50);
  const macd = technicalNumber(latest.macd, 0);
  const macdSignal = technicalNumber(latest.macd_signal, 0);
  const macdHist = technicalNumber(latest.macd_hist, macd - macdSignal);
  const stochK = technicalNumber(latest.stoch_k, 50);
  const stochD = technicalNumber(latest.stoch_d, 50);
  const atr = technicalNumber(latest.atr_14, 0);
  const atrPct = close ? (atr / close) * 100 : 0;
  const bbUpper = technicalNumber(latest.bb_upper, close);
  const bbMid = technicalNumber(latest.bb_mid, close);
  const bbLower = technicalNumber(latest.bb_lower, close);
  const bbWidthRaw = technicalNumber(latest.bb_width);
  const bbWidth = bbWidthRaw !== null ? bbWidthRaw : (bbMid ? ((bbUpper - bbLower) / bbMid) * 100 : 0);
  const bbPosition = bbUpper !== bbLower ? ((close - bbLower) / (bbUpper - bbLower)) * 100 : 50;

  const recentRows = rows.slice(-Math.min(48, rows.length));
  const resistance = Math.max(...recentRows.map(row => technicalNumber(row.high, close)));
  const support = Math.min(...recentRows.map(row => technicalNumber(row.low, close)));
  const resistanceDistance = close ? ((resistance - close) / close) * 100 : 0;
  const supportDistance = close ? ((support - close) / close) * 100 : 0;

  let rawScore = 0;
  rawScore += close > ema20 ? 2 : -2;
  rawScore += ema20 > ema50 ? 2 : -2;
  rawScore += ema50 > ema200 ? 2 : -2;
  rawScore += macdHist > 0 ? 1 : -1;
  rawScore += rsi >= 50 && rsi <= 70 ? 1 : rsi < 40 ? -1 : 0;
  const score = Math.round(Math.max(0, Math.min(100, 50 + rawScore * 6.25)));
  const biasLabel = rawScore >= 4 ? 'TĂNG' : rawScore <= -4 ? 'GIẢM' : 'TRUNG LẬP';
  const biasClass = rawScore >= 4 ? 'bullish' : rawScore <= -4 ? 'bearish' : 'neutral';
  const biasTitle = rawScore >= 4 ? 'Xu hướng đang nghiêng tăng' : rawScore <= -4 ? 'Xu hướng đang nghiêng giảm' : 'Thị trường đang cân bằng';
  const biasDescription = rawScore >= 4
    ? 'Giá và các đường trung bình đang cho tín hiệu tích cực, nhưng vẫn cần theo dõi vùng kháng cự.'
    : rawScore <= -4
      ? 'Động lượng và cấu trúc EMA đang yếu; ưu tiên quản trị rủi ro tại vùng hỗ trợ.'
      : 'Các chỉ báo chưa đồng thuận rõ ràng. Nên chờ thêm xác nhận từ giá và khối lượng.';

  const trendBullish = close > ema20 && ema20 > ema50;
  const trendBearish = close < ema20 && ema20 < ema50;
  const trendLabel = trendBullish ? 'Tăng' : trendBearish ? 'Giảm' : 'Đi ngang';
  const trendTone = trendBullish ? 'positive' : trendBearish ? 'negative' : 'neutral';
  const trendNote = close > ema200 ? 'Giá trên EMA200' : 'Giá dưới EMA200';

  const rsiLabel = rsi >= 70 ? 'Quá mua' : rsi <= 30 ? 'Quá bán' : rsi >= 55 ? 'Tích cực' : rsi <= 45 ? 'Suy yếu' : 'Trung tính';
  const rsiTone = rsi >= 70 ? 'warning' : rsi <= 30 ? 'info' : rsi >= 55 ? 'positive' : rsi <= 45 ? 'negative' : 'neutral';
  const macdLabel = macdHist > 0 ? 'Dương' : macdHist < 0 ? 'Âm' : 'Cân bằng';
  const macdTone = macdHist > 0 ? 'positive' : macdHist < 0 ? 'negative' : 'neutral';
  const stochLabel = stochK >= 80 ? 'Quá mua' : stochK <= 20 ? 'Quá bán' : stochK > stochD ? 'Động lượng tăng' : 'Động lượng giảm';
  const stochTone = stochK >= 80 ? 'warning' : stochK <= 20 ? 'info' : stochK > stochD ? 'positive' : 'negative';
  const bbLabel = bbPosition >= 80 ? 'Sát dải trên' : bbPosition <= 20 ? 'Sát dải dưới' : 'Trong biên';
  const bbTone = bbPosition >= 80 ? 'warning' : bbPosition <= 20 ? 'info' : 'neutral';
  const volatilityLabel = atrPct >= 3 ? 'Biến động cao' : atrPct >= 1.5 ? 'Biến động vừa' : 'Biến động thấp';
  const volatilityTone = atrPct >= 3 ? 'warning' : atrPct >= 1.5 ? 'info' : 'neutral';

  const p2pSorted = [...(Array.isArray(p2pRows) ? p2pRows : [])].sort((a, b) => parseTs(b.timestamp) - parseTs(a.timestamp));
  const latestBuy = p2pSorted.find(row => String(row.trade_type || '').toUpperCase() === 'BUY');
  const latestSell = p2pSorted.find(row => String(row.trade_type || '').toUpperCase() === 'SELL');
  const p2pBuyRate = technicalNumber(latestBuy?.p2p_price);
  const p2pSellRate = technicalNumber(latestSell?.p2p_price);
  const p2pBuyBtc = p2pBuyRate ? close * p2pBuyRate : null;
  const p2pSellBtc = p2pSellRate ? close * p2pSellRate : null;

  return {
    close, open, high, low, volume, absoluteChange, periodChange, rangePct,
    timestamp: latest.timestamp, periodLabel: hours === 24 ? '24 giờ' : hours === 168 ? '7 ngày' : '30 ngày',
    ema20, ema50, ema200, rsi, macd, macdSignal, macdHist, stochK, stochD,
    atr, atrPct, bbUpper, bbMid, bbLower, bbWidth, bbPosition,
    resistance, support, resistanceDistance, supportDistance,
    score, biasLabel, biasClass, biasTitle, biasDescription,
    trendLabel, trendTone, trendNote, rsiLabel, rsiTone, macdLabel, macdTone,
    stochLabel, stochTone, bbLabel, bbTone, volatilityLabel, volatilityTone,
    macdGauge: clampPercent(50 + Math.tanh(macdHist / Math.max(1, atr || 1)) * 42),
    emaGauge: clampPercent(50 + ((close - ema50) / Math.max(close * .04, 1)) * 50),
    atrGauge: clampPercent((atrPct / 5) * 100),
    p2pBuyBtc, p2pSellBtc, hasP2P: Number.isFinite(p2pBuyBtc) || Number.isFinite(p2pSellBtc)
  };
}

function technicalMetricCard(label, value, note, icon) {
  const icons = { high: '↗', low: '↘', volume: '▥', atr: '≈' };
  return `<article class="technical-pro-kpi-card ${icon}"><span class="technical-pro-kpi-icon">${icons[icon] || '•'}</span><div><span>${label}</span><strong>${value}</strong><small>${note}</small></div></article>`;
}

function technicalSignalRow(label, value, tone, note) {
  return `<div class="technical-pro-signal-row"><div><span>${label}</span><small>${note}</small></div><strong class="${tone}">${value}</strong></div>`;
}

function technicalIndicatorCard(label, value, status, tone, progress, note) {
  return `
    <article class="technical-pro-indicator-card">
      <div class="technical-pro-indicator-head"><span>${label}</span><b class="${tone}">${status}</b></div>
      <strong>${value}</strong>
      <div class="technical-pro-progress ${tone}"><i style="width:${clampPercent(progress)}%"></i></div>
      <small>${note}</small>
    </article>`;
}

function bindTechnicalChartControls(chart) {
  if (!chart) return;
  const groups = {
    ema: ['EMA20', 'EMA50', 'EMA200'],
    bollinger: ['BB Upper', 'BB Mid', 'BB Lower'],
    p2p: ['BTC P2P mua', 'BTC P2P bán']
  };
  document.querySelectorAll('[data-tech-group]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      const group = button.dataset.techGroup;
      button.classList.toggle('active');
      (groups[group] || []).forEach(name => chart.dispatchAction({ type: 'legendToggleSelect', name }));
    });
  });
  document.getElementById('technicalResetZoom')?.addEventListener('click', () => {
    chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
  });
}

async function renderP2PPage() {
  app.innerHTML = `
    <section class="page-head">
      <div><span class="eyebrow">P2P Spread</span><h1>Bán/mua USDT qua P2P đang lợi hay thiệt?</h1><p class="lead">Trang này phục vụ Chương 1.1 và 1.6: đo chi phí ẩn khi quy đổi USDT/VNĐ thay vì hỏi thủ công trên cộng đồng.</p></div>
      <div class="segmented" id="p2pHours"><button data-hours="24">24H</button><button data-hours="168">7 ngày</button><button data-hours="720">30 ngày</button></div>
    </section>
    <section id="p2pContent">${loadingCard(520)}</section>
  `;
  document.querySelectorAll('#p2pHours button').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.hours) === p2pHours);
    btn.addEventListener('click', () => { p2pHours = Number(btn.dataset.hours); renderP2PPage(); });
  });
  try {
    const res = await fetchJson(`/api/p2p-spread?hours=${p2pHours}`);
    const p2p = res.data;
    if (!p2p.latest || !p2p.data?.length) {
      document.getElementById('p2pContent').innerHTML = `<div class="state-box empty">${escapeHTML(p2p.note || 'Chưa có dữ liệu spread.')}</div>`;
      return;
    }
    const latestSell = latestByTradeType(p2p.data, 'SELL');
    const latestBuy = latestByTradeType(p2p.data, 'BUY');
    document.getElementById('p2pContent').innerHTML = `
      <div class="grid two">
        ${p2pCard('SELL', latestSell)}
        ${p2pCard('BUY', latestBuy)}
      </div>
      <div class="card section">
        <div class="section-head"><div><h2>Lịch sử chênh lệch P2P</h2><p>${sourcePill(res.source)} · Dữ liệu mới nhất đứng đầu API, frontend đảo lại khi vẽ chart.</p></div></div>
        <div id="p2pChart" class="chart-box"></div>
      </div>
    `;
    document.querySelectorAll('[data-trade-side]').forEach(btn => btn.addEventListener('click', () => {
      location.hash = `#trade?side=${btn.dataset.tradeSide}`;
    }));
    drawP2PChart('p2pChart', p2p.data || []);
  } catch (error) {
    document.getElementById('p2pContent').innerHTML = errorBox(error.message);
  }
}

function latestByTradeType(data, type) {
  return (data || []).find(row => row.trade_type === type) || null;
}

function p2pCard(type, row) {
  if (!row) return `<div class="card"><h3>${type}</h3><p>Chưa có dữ liệu.</p></div>`;
  const spread = row.spread_pct;
  const isGood = type === 'SELL' ? spread < 0 : spread > 0;
  const text = type === 'SELL'
    ? (isGood ? `Bạn đang được lợi ${formatPct(Math.abs(spread), 3, false)} so với tỷ giá quốc tế.` : `Bạn đang chịu thiệt ${formatPct(Math.abs(spread), 3, false)} so với tỷ giá quốc tế.`)
    : (isGood ? `Bạn đang được lợi ${formatPct(Math.abs(spread), 3, false)} khi mua USDT.` : `Bạn đang phải trả đắt hơn ${formatPct(Math.abs(spread), 3, false)} so với tỷ giá quốc tế.`);
  return `
    <div class="card">
      <span class="badge ${isGood ? 'green' : 'red'}">${type === 'SELL' ? 'Nếu bạn BÁN USDT' : 'Nếu bạn MUA USDT'}</span>
      <h2 style="margin-top:12px">${formatVND(row.p2p_price)} / USDT</h2>
      <p>Dao động: ${formatVND(row.p2p_price_min)} – ${formatVND(row.p2p_price_max)}</p>
      <p>Tỷ giá quốc tế: ${formatVND(row.market_price)} · Samples: ${row.samples || '—'}</p>
      <div class="result-panel" style="border-color:${isGood ? '#bbf7d0' : '#fecaca'}"><strong>${isGood ? '✅' : '⚠️'} ${text}</strong></div>
      <button class="btn ${type === 'SELL' ? 'primary' : 'accent'} full" data-trade-side="${type}" style="margin-top:14px">${type === 'SELL' ? 'Bán ngay demo' : 'Mua ngay demo'}</button>
    </div>
  `;
}

function riskLevelClass(level) {
  if (level === 'HIGH') return 'danger';
  if (level === 'MEDIUM') return 'warn';
  return 'ok';
}

function riskScoreCard(risk) {
  const level = risk?.level || 'LOW';
  const levelClass = riskLevelClass(level);
  const score = Number(risk?.score || 0);
  return `
    <div class="risk-score-card ${levelClass}">
      <div class="risk-score-ring" style="--score:${score}"><strong>${score}</strong><span>/100</span></div>
      <div>
        <span class="badge ${levelClass === 'danger' ? 'red' : levelClass === 'warn' ? 'amber' : 'green'}">${escapeHTML(risk?.label_vi || level)}</span>
        <h2>Risk Score thị trường BTC</h2>
        <p>${escapeHTML(risk?.recommendation || 'Risk Score rule-based dùng cho mục tiêu học tập.')}</p>
        <div class="meta">${escapeHTML(risk?.method || 'Rule-based MVP')}</div>
      </div>
    </div>
  `;
}

function alertClass(severity) {
  if (severity === 'danger') return 'red';
  if (severity === 'warn') return 'amber';
  return 'blue';
}

function marketAlertsHTML(alerts = []) {
  return `<div class="insight-list">${alerts.map(a => `
    <div class="insight-item ${escapeHTML(a.severity || 'info')}">
      <span class="badge ${alertClass(a.severity)}">${escapeHTML((a.severity || 'info').toUpperCase())}</span>
      <div><strong>${escapeHTML(a.title)}</strong><p>${escapeHTML(a.message)}</p><small>${escapeHTML(a.metric || '')}${isNum(Number(a.value)) ? ` · ${formatNumber(Number(a.value), 3)}` : ''}</small></div>
    </div>
  `).join('')}</div>`;
}

function p2pComparisonBlock(item, title) {
  if (!item) return `<div class="card"><h3>${title}</h3><p>Chưa có dữ liệu so sánh.</p></div>`;
  return `
    <div class="card">
      <span class="badge ${item.favorable ? 'green' : 'red'}">${item.favorable ? 'Có lợi hơn' : 'Kém lợi hơn'}</span>
      <h3 style="margin-top:10px">${title}</h3>
      <div class="breakdown">
        <div><span>Giá P2P</span><strong>${formatVND(item.p2p_price)} / USDT</strong><small>${escapeHTML(item.trade_type || '')} · ${formatVNTime(item.timestamp, 'short')}</small></div>
        <div><span>Giá tham chiếu</span><strong>${formatVND(item.market_price)} / USDT</strong><small>Quy đổi từ giá thị trường</small></div>
        <div class="total"><span>Chênh lệch</span><strong>${formatVND(item.difference_vnd)}</strong><small>${formatPct(item.difference_pct, 3)} · ${escapeHTML(item.explain || '')}</small></div>
      </div>
    </div>
  `;
}

async function renderRiskPage() {
  app.innerHTML = `
    <section class="page-head">
      <div><span class="eyebrow">Risk Score & Cảnh báo</span><h1>Biến nhiều chỉ báo thành cảnh báo dễ hiểu</h1><p class="lead">Trang này dùng rule-based model trong backend, phù hợp phạm vi môn học: không dự đoán giá, chỉ tổng hợp rủi ro từ RSI, MACD, EMA, Bollinger, ATR, volume và độ mới dữ liệu.</p></div>
      <a class="btn secondary" href="#guide">Xem cách đọc chỉ báo</a>
    </section>
    <section id="riskContent">${loadingCard(560)}</section>
  `;
  try {
    const [riskRes, alertsRes, cmpRes] = await Promise.all([
      fetchJson('/api/risk-score'),
      fetchJson('/api/market-alerts'),
      fetchJson('/api/p2p-comparison')
    ]);
    const risk = riskRes.data;
    const alerts = alertsRes.data.data || [];
    const cmp = cmpRes.data;
    document.getElementById('riskContent').innerHTML = `
      ${riskScoreCard(risk)}
      <section class="grid two section">
        <div class="card">
          <div class="section-head"><div><h2>Cảnh báo hiện tại</h2><p>Rule-based alerts giúp người dùng tránh bỏ sót tín hiệu quan trọng.</p></div>${sourcePill(alertsRes.source)}</div>
          ${marketAlertsHTML(alerts)}
          <p class="meta">${escapeHTML(alertsRes.data.disclaimer || 'Thông tin chỉ mang tính tham khảo.')}</p>
        </div>
        <div class="card">
          <h2>Yếu tố tạo Risk Score</h2>
          <div class="factor-list">
            ${(risk.factors || []).map(f => `<div><strong>${escapeHTML(f.name)}</strong><span>+${formatNumber(Number(f.impact || 0), 1)} điểm</span><p>${escapeHTML(f.note || '')}</p></div>`).join('')}
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-head"><div><span class="eyebrow">P2P Comparison</span><h2>Giá sàn vs Giá P2P</h2><p>${escapeHTML(cmp.summary || '')}</p></div><a class="btn primary" href="#settlement">Tính thực nhận</a></div>
        <div class="grid two">${p2pComparisonBlock(cmp.sell, 'Nếu người dùng BÁN USDT lấy VNĐ')}${p2pComparisonBlock(cmp.buy, 'Nếu người dùng MUA USDT bằng VNĐ')}</div>
      </section>
    `;
  } catch (error) {
    document.getElementById('riskContent').innerHTML = errorBox(error.message);
  }
}


function newsCardHTML(item) {
  const source = item.source || 'Nguồn tin';
  const link = item.link && item.link !== '#' ? item.link : '#news';
  const external = link !== '#news';
  const tags = (item.tags || []).slice(0, 3).map(tag => `<span class="mini-tag">${escapeHTML(tag)}</span>`).join('');
  return `
    <article class="news-card">
      <div class="news-card-top"><span class="badge amber">${escapeHTML(source)}</span><span class="meta">${formatVNTime(item.published_at, 'short')}</span></div>
      <h3>${external ? `<a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a>` : escapeHTML(item.title)}</h3>
      <p>${escapeHTML(item.summary || 'Tin tức dùng để bổ sung bối cảnh cho dashboard và AI Advisor.')}</p>
      <div class="news-tags">${tags}</div>
    </article>
  `;
}

async function renderNewsPage() {
  app.innerHTML = `
    <section class="page-head">
      <div><span class="eyebrow">Market News</span><h1>Tin tức BTC chạy theo thời gian thực</h1><p class="lead">Trang này bổ sung bối cảnh thị trường cho Dashboard/Risk Score. Tin tức chỉ là yếu tố tham khảo, không thay thế dữ liệu giá và quản trị rủi ro.</p></div>
      <button class="btn primary" id="reloadNews">Làm mới tin tức</button>
    </section>
    <section id="newsContent">${loadingCard(520)}</section>
  `;
  document.getElementById('reloadNews').addEventListener('click', renderNewsPage);
  try {
    const [newsRes, riskRes, alertsRes] = await Promise.all([
      fetchJson('/api/news/latest?limit=12'),
      fetchJson('/api/risk-score'),
      fetchJson('/api/market-alerts')
    ]);
    const news = newsRes.data.data || [];
    const risk = riskRes.data;
    const alerts = alertsRes.data.data || [];
    document.getElementById('newsContent').innerHTML = `
      <div class="news-hero card">
        <div>
          <span class="badge blue">${escapeHTML(newsRes.data.source || newsRes.source)}</span>
          <h2>News Context Layer</h2>
          <p>Tầng tin tức giúp bài demo gần thực tế hơn: dữ liệu giá trả lời “thị trường đang làm gì”, còn tin tức giúp đặt câu hỏi “vì sao tâm lý thị trường có thể thay đổi”.</p>
          <p class="meta">${escapeHTML(newsRes.data.disclaimer || 'Tin tức chỉ dùng để bổ sung bối cảnh học tập.')}</p>
        </div>
        <div class="news-risk-mini">
          <strong>${risk.score}/100</strong><span>${escapeHTML(risk.label_vi || risk.level || 'Risk Score')}</span><a href="#risk">Xem Risk Score</a>
        </div>
      </div>
      <div class="grid two section">
        <div class="card">
          <div class="section-head"><div><h2>Cảnh báo liên quan</h2><p>Kết hợp news ticker với rule-based alerts để tránh diễn giải tin tức tách rời dữ liệu.</p></div></div>
          ${marketAlertsHTML(alerts.slice(0, 4))}
        </div>
        <div class="card">
          <h2>Cách dùng trong báo cáo</h2>
          <ul class="report-list">
            <li>Tin tức là lớp ngữ cảnh, không phải tín hiệu mua/bán độc lập.</li>
            <li>AI Advisor nên kết hợp tin tức với Risk Score, RSI, MACD và độ mới dữ liệu.</li>
            <li>Nếu RSS lỗi, frontend/backend dùng fallback để demo không bị vỡ.</li>
          </ul>
        </div>
      </div>
      <section class="section">
        <div class="section-head"><div><h2>Dòng tin BTC mới nhất</h2><p>${sourcePill(newsRes.source)} · Số tin: ${news.length}</p></div></div>
        <div class="news-grid">${news.map(newsCardHTML).join('')}</div>
      </section>
    `;
  } catch (error) {
    document.getElementById('newsContent').innerHTML = errorBox(error.message);
  }
}

async function renderReliabilityPage() {
  app.innerHTML = `
    <section class="page-head">
      <div><span class="eyebrow">Data Reliability</span><h1>Độ tin cậy và độ mới dữ liệu</h1><p class="lead">Tính năng này giúp người dùng biết dữ liệu có đang đủ mới để đọc dashboard hay không, tránh quyết định dựa trên dữ liệu cũ.</p></div>
      <button class="btn primary" id="reloadReliability">Kiểm tra lại</button>
    </section>
    <section id="reliabilityContent">${loadingCard(520)}</section>
  `;
  document.getElementById('reloadReliability').addEventListener('click', renderReliabilityPage);
  try {
    const res = await fetchJson('/api/data-reliability');
    const data = res.data;
    const level = data.level === 'GOOD' ? 'ok' : data.level === 'WARNING' ? 'warn' : 'danger';
    document.getElementById('reliabilityContent').innerHTML = `
      <div class="trust-badge ${level}"><span class="dot ${level}"></span><strong>${escapeHTML(data.level)}</strong> · ${escapeHTML(data.message)} ${sourcePill(res.source)}</div>
      <div class="grid two">
        ${(data.checks || []).map(c => `
          <div class="card">
            <span class="badge ${c.fresh ? 'green' : 'amber'}">${c.fresh ? 'Fresh' : 'Cần kiểm tra'}</span>
            <h3 style="margin-top:10px">${escapeHTML(c.name)}</h3>
            <p>${escapeHTML(c.description || '')}</p>
            <div class="breakdown">
              <div><span>Nguồn</span><strong>${escapeHTML(c.source || '—')}</strong></div>
              <div><span>Cập nhật gần nhất</span><strong>${c.latest_timestamp ? formatVNTime(c.latest_timestamp) : '—'}</strong><small>${ageText(Number(c.age_hours))}</small></div>
              <div><span>Ngưỡng fresh</span><strong>${formatNumber(Number(c.threshold_hours || 2), 1)} giờ</strong></div>
            </div>
          </div>
        `).join('')}
      </div>
      <section class="grid two section">
        <div class="card"><h3>Nguồn dữ liệu</h3><ul class="report-list">${Object.entries(data.sources || {}).map(([k, v]) => `<li><strong>${escapeHTML(k)}:</strong> ${escapeHTML(v)}</li>`).join('')}</ul></div>
        <div class="card"><h3>Cơ chế tự động</h3><p>${escapeHTML(data.automation || '')}</p><ul class="report-list"><li>GitHub Actions chạy theo cron mỗi giờ.</li><li>Script lấy dữ liệu, tính chỉ báo, upsert vào Supabase.</li><li>Frontend gọi backend API và hiển thị badge độ tin cậy.</li></ul></div>
      </section>
    `;
  } catch (error) {
    document.getElementById('reliabilityContent').innerHTML = errorBox(error.message);
  }
}

function renderIndicatorGuidePage() {
  const guides = [
    ['RSI', 'Đo trạng thái quá mua/quá bán. RSI > 70 thường cần thận trọng mua mới, RSI < 30 thường cho thấy quá bán nhưng chưa chắc đảo chiều ngay.'],
    ['MACD', 'Đo động lượng. MACD histogram dương thường tích cực hơn, âm cho thấy động lượng tăng yếu.'],
    ['EMA 20/50/200', 'So sánh giá với đường trung bình để nhìn xu hướng ngắn, trung và dài hạn. Giá dưới EMA50/EMA200 làm Risk Score tăng.'],
    ['Bollinger Bands', 'Dải biến động quanh giá. Giá gần dải trên/dưới và band mở rộng mạnh cho thấy rủi ro biến động cao.'],
    ['ATR', 'Đo độ biến động trung bình. ATR càng cao so với giá, giao dịch càng rủi ro.'],
    ['Volume MA20', 'So sánh volume hiện tại với trung bình 20 kỳ để phát hiện thanh khoản bất thường.']
  ];
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Giải thích chỉ báo</span><h1>Người mới đọc Dashboard như thế nào?</h1><p class="lead">Trang này biến thuật ngữ kỹ thuật thành ngôn ngữ dễ hiểu, phù hợp mục tiêu giáo dục tài chính của đề tài.</p></div><a class="btn primary" href="#risk">Xem Risk Score</a></section>
    <section class="grid three">
      ${guides.map(([name, desc]) => `<div class="card"><span class="badge blue">Indicator</span><h3 style="margin-top:10px">${name}</h3><p>${desc}</p></div>`).join('')}
    </section>
    <section class="card section"><h2>Cách hệ thống sử dụng các chỉ báo</h2><p>Backend không dùng một chỉ báo duy nhất để kết luận. Hệ thống tổng hợp RSI, MACD, EMA, Bollinger, ATR, volume và độ mới dữ liệu thành khuyến nghị BUY/SELL/NEUTRAL, Risk Score 0–100 và cảnh báo rule-based. Đây là mô hình minh họa cho môn học, không phải mô hình dự báo giá chuyên nghiệp.</p></section>
  `;
}

function renderTaxPage() {
  app.innerHTML = `
    <section class="page-head">
      <div><span class="eyebrow">Ước tính thuế</span><h1>Tính nhanh thuế khi bán BTC/Crypto</h1><p class="lead">Form này gọi <code>/api/tax-estimate</code> khi người dùng bấm nút, đúng với đặc tả frontend. Kết quả luôn hiển thị disclaimer.</p></div>
    </section>
    <section class="card">
      <div class="form-grid">
        <div class="field"><label>Quốc gia</label><select id="taxCountry"><option value="VN">🇻🇳 Việt Nam</option><option value="US">🇺🇸 Hoa Kỳ</option></select></div>
        <div class="field"><label id="amountLabel">Giá trị bán (VNĐ)</label><input id="taxAmount" type="number" min="1" placeholder="VD: 100000000"></div>
        <div class="field" id="holdingField" style="display:none"><label>Số ngày nắm giữ</label><input id="holdingDays" type="number" min="0" value="400"></div>
      </div>
      <button id="taxSubmit" class="btn primary" style="margin-top:14px">Tính thuế ngay</button>
      <div id="taxResult"></div>
    </section>
  `;
  const country = document.getElementById('taxCountry');
  const holding = document.getElementById('holdingField');
  const label = document.getElementById('amountLabel');
  country.addEventListener('change', () => {
    const us = country.value === 'US';
    holding.style.display = us ? 'grid' : 'none';
    label.textContent = us ? 'Lợi nhuận (USD)' : 'Giá trị bán (VNĐ)';
    document.getElementById('taxResult').innerHTML = '';
  });
  document.getElementById('taxSubmit').addEventListener('click', calculateTax);
}

async function calculateTax() {
  const result = document.getElementById('taxResult');
  const amount = Number(document.getElementById('taxAmount').value);
  const country = document.getElementById('taxCountry').value;
  const holding = Number(document.getElementById('holdingDays').value || 0);
  if (!amount || amount <= 0) {
    result.innerHTML = `<div class="result-panel state-box error">Số tiền phải lớn hơn 0.</div>`;
    return;
  }
  result.innerHTML = `<div class="result-panel"><div class="skeleton" style="height:120px"></div></div>`;
  try {
    const res = await fetchJson(`/api/tax-estimate?amount=${amount}&country=${country}&holding_days=${holding}`);
    const data = res.data;
    const money = country === 'VN' ? formatVND : formatUSD;
    result.innerHTML = `
      <div class="result-panel">
        <span class="badge red">Thuế ước tính</span> ${sourcePill(res.source)}
        <h2 style="margin-top:10px">${money(data.tax_amount)}</h2>
        <div class="grid two" style="margin-top:12px">
          <div class="card soft"><strong>Giá trị gốc</strong><p>${money(data.gross_amount)}</p></div>
          <div class="card soft"><strong>Còn lại sau thuế</strong><p>${money(data.net_amount)}</p></div>
        </div>
        <p><strong>Thuế suất:</strong> ${formatPct(data.tax_rate_pct, 3, false)}</p>
        <p>${escapeHTML(data.note)}</p>
        <p><em>${escapeHTML(data.disclaimer)}</em></p>
      </div>
    `;
  } catch (error) {
    result.innerHTML = errorBox(error.message);
  }
}

function renderChatPage() {
  app.innerHTML = `
    <section class="page-head">
      <div><span class="eyebrow">Chat AI tư vấn</span><h1>AI giải thích tín hiệu MUA/BÁN/TRUNG LẬP</h1><p class="lead">Frontend gửi câu hỏi tới <code>POST /api/ai/ask</code>. Backend ghép dữ liệu latest/summary/P2P vào prompt và bảo vệ API key bằng file <code>.env</code>.</p></div>
      <a class="btn secondary" href="#history">Xem lịch sử AI</a>
    </section>
    <section class="chat-shell">
      <div>
        <div class="chips">
          ${['Giờ nên mua hay bán BTC?', 'Bán P2P lúc này có lời không?', 'Giải thích RSI và MACD hiện tại', 'Bán 100 triệu thì thuế bao nhiêu?'].map(q => `<button class="chip" data-question="${escapeHTML(q)}">${q}</button>`).join('')}
        </div>
        <div id="messages" class="messages"></div>
      </div>
      <form id="chatForm" class="chat-input">
        <div class="field"><input id="chatInput" type="text" placeholder="Nhập câu hỏi của bạn..."></div>
        <button id="chatSend" class="btn primary" type="submit">Gửi</button>
      </form>
    </section>
  `;
  renderMessages();
  document.getElementById('chatForm').addEventListener('submit', event => {
    event.preventDefault();
    sendChat();
  });
  document.querySelectorAll('[data-question]').forEach(btn => btn.addEventListener('click', () => {
    sendChat(btn.dataset.question || '');
  }));
}

function renderMessages() {
  const box = document.getElementById('messages');
  if (!box) return;
  box.innerHTML = chatMessages.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${escapeHTML(m.text)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendChat(forcedQuestion = '') {
  const input = document.getElementById('chatInput');
  const question = String(forcedQuestion || input?.value || '').trim();
  if (!question || chatSending) return;
  chatSending = true;
  const sendButton = document.getElementById('chatSend');
  if (input) input.value = '';
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = 'Đang gửi...';
  }
  chatMessages.push({ role: 'user', text: question });
  chatMessages.push({ role: 'ai', text: 'AI đang phân tích dữ liệu thị trường...' });
  renderMessages();
  try {
    const res = await askAI(question);
    const data = res.data;
    chatMessages[chatMessages.length - 1] = {
      role: 'ai',
      text: aiResponseText(data)
    };
  } catch (error) {
    chatMessages[chatMessages.length - 1] = { role: 'ai', text: `AI hiện không phản hồi được: ${error.message}` };
  } finally {
    chatSending = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = 'Gửi';
    }
  }
  renderMessages();
}


function aiResponseText(data) {
  const riskLine = data.risk_score != null ? `\nRisk Score: ${data.risk_score}/100${data.risk_level ? ` · ${data.risk_level}` : ''}` : '';
  const factors = (data.risk_factors || []).slice(0, 3).map(x => `- ${x.name}: ${x.note}`).join('\n');
  return `${signalMap[data.verdict]?.vi || data.verdict} · Độ tin cậy ${data.confidence || 50}%${riskLine}\n\n${data.answer}\n\nLý do:\n${(data.reasons || []).map(x => `- ${x}`).join('\n')}\n\nRủi ro:\n${(data.risks || []).map(x => `- ${x}`).join('\n')}${factors ? `\n\nYếu tố Risk Score:\n${factors}` : ''}\n\n${data.disclaimer || 'Thông tin chỉ mang tính tham khảo.'}`;
}

async function askAI(question) {
  try {
    const response = await fetch(apiUrl('/api/ai/ask'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ question, risk_profile: 'moderate' })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { data: await response.json(), source: 'api' };
  } catch (error) {
    const latest = window.MOCK_DATA.latest;
    const summary = window.MOCK_DATA.summary;
    const verdict = summary.overall?.verdict || 'NEUTRAL';
    return {
      source: 'mock',
      data: {
        verdict,
        confidence: 58,
        risk_score: buildMockRiskScore().score,
        risk_level: buildMockRiskScore().level,
        risk_factors: buildMockRiskScore().factors,
        answer: `Backend AI chưa sẵn sàng nên đang dùng mock advisor. Với giá BTC quanh ${formatUSD(latest.close)}, hệ thống tạm kết luận ${signalMap[verdict]?.vi || verdict}.`,
        reasons: [
          `RSI hiện tại khoảng ${latest.rsi_14}, chưa đủ để khẳng định một chiều mạnh.`,
          `MACD histogram là ${latest.macd_hist}, cần kết hợp thêm EMA và P2P spread.`,
          `Tín hiệu tổng hợp backend là ${verdict}.`
        ],
        risks: ['BTC biến động mạnh trong ngắn hạn.', 'Không nên all-in hoặc dùng đòn bẩy cao.'],
        suggested_action: 'Quan sát thêm hoặc chia nhỏ vị thế nếu muốn giao dịch.',
        disclaimer: 'Thông tin chỉ mang tính tham khảo, không phải lời khuyên đầu tư cá nhân.'
      }
    };
  }
}


async function renderHistoryPage() {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const requestedTab = params.get('tab') === 'trades' ? 'trades' : 'ai';

  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Lịch sử theo tài khoản</span><h1>Lịch sử AI và giao dịch BTC demo</h1><p class="lead">Dữ liệu được đọc từ Supabase theo tài khoản. Chọn từng giao dịch để xem đầy đủ giá khớp, số lượng, tổng tiền, nguồn giá và biến động ví demo.</p></div></section>
    <section class="card history-page-card">
      <div class="segmented" id="historyTabs"><button data-tab="ai" class="${requestedTab === 'ai' ? 'active' : ''}">Lịch sử AI</button><button data-tab="trades" class="${requestedTab === 'trades' ? 'active' : ''}">Lịch sử giao dịch</button></div>
      <div id="historyContent" style="margin-top:16px">${loadingCard(360)}</div>
    </section>
  `;
  document.querySelectorAll('#historyTabs button').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('#historyTabs button').forEach(b => b.classList.toggle('active', b === btn));
    window.history.replaceState(null, '', `#history?tab=${btn.dataset.tab}`);
    if (btn.dataset.tab === 'ai') loadAccountAIHistory(); else loadAccountTradeHistory();
  }));

  if (requestedTab === 'trades') await loadAccountTradeHistory();
  else await loadAccountAIHistory();
}

async function loadAccountAIHistory() {
  const box = document.getElementById('historyContent');
  if (!box) return;
  box.innerHTML = loadingCard(360);
  try {
    const res = await fetchJson('/api/ai/history?limit=24');
    const rows = res.data.data || [];
    box.innerHTML = rows.length ? `
      <div class="timeline">
        ${rows.map(row => `<div class="timeline-item"><div class="timeline-time">${formatVNTime(row.created_at || row.timestamp, 'short')}</div><div class="card"><span class="badge ${(row.verdict || 'NEUTRAL').toLowerCase()}">${row.verdict || 'NEUTRAL'}</span><h3 style="margin-top:10px">${escapeHTML(row.question || 'AI phân tích')}</h3><p>${escapeHTML(row.answer || row.summary || '')}</p></div></div>`).join('')}
      </div>
    ` : `<div class="state-box empty">Chưa có lịch sử AI cho tài khoản này.</div>`;
  } catch (error) { box.innerHTML = errorBox(error.message); }
}

async function loadAccountTradeHistory() {
  const box = document.getElementById('historyContent');
  if (!box) return;
  box.innerHTML = loadingCard(260);
  try {
    const res = await fetchJson('/api/demo-trades?limit=50');
    const rows = res.data.data || [];
    const portfolio = res.data.portfolio || {};
    box.innerHTML = rows.length ? `
      <div class="trade-history-summary" aria-label="Tổng quan lịch sử giao dịch">
        <div><span>Tổng giao dịch</span><strong>${formatNumber(portfolio.trades_count ?? rows.length, 0)}</strong></div>
        <div><span>Tổng tiền mua</span><strong>${formatVND(portfolio.total_buy_vnd || 0)}</strong></div>
        <div><span>Tổng tiền bán</span><strong>${formatVND(portfolio.total_sell_vnd || 0)}</strong></div>
        <div><span>BTC đang nắm giữ</span><strong>${formatNumber(portfolio.position_btc || 0, 8)} BTC</strong></div>
      </div>
      <div class="trade-history-hint"><span>Chọn một giao dịch bên dưới để xem chi tiết mua hoặc bán.</span><span>${rows.length} giao dịch gần nhất</span></div>
      <div class="trade-history">${rows.map(tradeRowHTML).join('')}</div>
    ` : `<div class="state-box empty">Chưa có lệnh giao dịch trên sàn ảo.</div>`;
    bindTradeHistoryDetails(box);
  } catch (error) { box.innerHTML = errorBox(error.message); }
}


const DECISION_PORTFOLIO_KEY = 'btc_bigdata_portfolio_tracker_v2';
const DECISION_ALERTS_KEY = 'btc_bigdata_smart_alerts_v2';

function formatBTC(value, digits = 8) {
  if (!isNum(Number(value))) return '—';
  return `${Number(value).toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')} BTC`;
}

function getDecisionPortfolio() {
  try { return JSON.parse(localStorage.getItem(DECISION_PORTFOLIO_KEY) || '[]'); }
  catch { return []; }
}
function setDecisionPortfolio(rows) {
  localStorage.setItem(DECISION_PORTFOLIO_KEY, JSON.stringify(rows.slice(-120)));
}
function getSmartAlerts() {
  try { return JSON.parse(localStorage.getItem(DECISION_ALERTS_KEY) || '[]'); }
  catch { return []; }
}
function setSmartAlerts(rows) {
  localStorage.setItem(DECISION_ALERTS_KEY, JSON.stringify(rows.slice(-80)));
}

async function getDecisionMarketContext() {
  const [latestRes, riskRes, p2pRes] = await Promise.all([
    fetchJson('/api/latest', { timeout: 9000 }),
    fetchJson('/api/risk-score', { timeout: 9000 }),
    fetchJson('/api/p2p-comparison', { timeout: 9000 })
  ]);
  const latest = latestRes.data || {};
  const risk = riskRes.data || buildMockRiskScore();
  const p2p = p2pRes.data || buildMockP2PComparison();
  const buyPrice = Number(p2p.buy?.p2p_price || p2p.buy?.market_price || p2p.sell?.market_price || 26000);
  const sellPrice = Number(p2p.sell?.p2p_price || p2p.sell?.market_price || p2p.buy?.market_price || 26000);
  const btcUsd = Number(latest.close || risk.price || window.MOCK_DATA?.latest?.close || 0);
  return { latest, risk, p2p, buyPrice, sellPrice, btcUsd, source: [latestRes.source, riskRes.source, p2pRes.source].join('/') };
}

function riskTone(score) {
  const s = Number(score || 0);
  if (s >= 70) return { label: 'Rủi ro cao', badge: 'red', action: 'Ưu tiên bảo toàn vốn, tránh all-in và chỉ dùng vị thế nhỏ nếu vẫn muốn thử.' };
  if (s >= 40) return { label: 'Rủi ro trung bình', badge: 'amber', action: 'Nên chia nhỏ vốn, chờ xác nhận thêm từ RSI/MACD/P2P và đặt cảnh báo.' };
  return { label: 'Rủi ro thấp', badge: 'green', action: 'Có thể lập kế hoạch từng phần nhưng vẫn cần ngưỡng cắt lỗ và theo dõi tin tức.' };
}

function renderDecisionHubPage() {
  // platform-enhance.js dựng Decision Hub trực quan sau khi route được xác thực.
  // Chỉ hiển thị skeleton ở đây để tránh render giao diện cũ và gọi API hai lần.
  app.innerHTML = `
    <section class="page-head" data-decision-bootstrap>
      <div><span class="eyebrow">Decision Hub</span><h1>Đang mở trung tâm quyết định</h1><p class="lead">Đang chuẩn bị biểu đồ kỹ thuật, dữ liệu P2P và các công cụ mô phỏng...</p></div>
    </section>
    <section class="decision-cockpit-shell">
      <div class="decision-cockpit-grid">${Array.from({ length: 4 }, () => '<div class="decision-cockpit-card decision-cockpit-skeleton"></div>').join('')}</div>
    </section>`;
}

async function buildBuySellPlan() {
  const box = document.getElementById('planResult');
  const action = document.getElementById('planAction').value;
  const amount = Number(document.getElementById('planAmount').value);
  const unit = document.getElementById('planUnit').value;
  const profile = document.getElementById('planProfile').value;
  if (!amount || amount <= 0) { box.innerHTML = `<div class="state-box error">Vui lòng nhập số vốn hoặc số BTC hợp lệ.</div>`; return; }
  box.innerHTML = loadingCard(150);
  try {
    const ctx = await getDecisionMarketContext();
    const risk = riskTone(ctx.risk.score);
    const usdtVnd = action === 'sell' ? ctx.sellPrice : ctx.buyPrice;
    const btcValueVnd = ctx.btcUsd * usdtVnd;
    const btcQty = unit === 'btc' ? amount : amount / Math.max(btcValueVnd, 1);
    const grossVnd = btcQty * btcValueVnd;
    const profilePct = profile === 'safe' ? 25 : profile === 'moderate' ? 40 : 60;
    const firstLeg = action === 'observe' ? 0 : grossVnd * profilePct / 100;
    const actionText = action === 'buy' ? 'mua BTC' : action === 'sell' ? 'bán BTC' : 'quan sát thêm';
    box.innerHTML = `
      <div class="decision-result-panel">
        <div class="decision-summary-line"><span class="badge ${risk.badge}">${risk.label}</span><strong>${action === 'observe' ? 'Kế hoạch quan sát' : `Kế hoạch ${actionText}`}</strong></div>
        <div class="breakdown decision-breakdown">
          <div><span>Giá BTC quy đổi</span><strong>${formatVND(btcValueVnd)}</strong><small>${formatUSD(ctx.btcUsd)} · P2P ${formatVND(usdtVnd)}</small></div>
          <div><span>Quy mô vị thế</span><strong>${formatBTC(btcQty, 8)}</strong><small>${formatVND(grossVnd)}</small></div>
          <div><span>Lệnh đầu tiên</span><strong>${action === 'observe' ? 'Chưa vào lệnh' : formatVND(firstLeg)}</strong><small>${profilePct}% theo khẩu vị ${profile}</small></div>
          <div class="total"><span>Risk Score</span><strong>${formatNumber(Number(ctx.risk.score || 0), 0)}/100</strong><small>${risk.label}</small></div>
        </div>
        <div class="decision-advice"><p><strong>Kế hoạch tham khảo:</strong> ${action === 'observe' ? 'Quan sát thêm, đặt cảnh báo và chờ tín hiệu xác nhận.' : `Có thể ${actionText} theo nhiều phần thay vì all-in.`} ${risk.action}</p></div>
      </div>`;
  } catch (error) { box.innerHTML = errorBox(error.message); }
}

function calculatePortfolio(rows, ctx) {
  let btc = 0;
  let cost = 0;
  for (const row of rows) {
    const qty = Number(row.btc_qty || 0);
    const amount = Number(row.amount_vnd || 0);
    if (row.side === 'BUY') { btc += qty; cost += amount; }
    else { btc -= qty; cost -= Math.min(cost, amount); }
  }
  const currentPrice = ctx.btcUsd * ctx.sellPrice;
  const currentValue = Math.max(btc, 0) * currentPrice;
  const avgCost = btc > 0 ? cost / btc : 0;
  const unrealized = currentValue - Math.max(cost, 0);
  const pnlPct = cost > 0 ? unrealized / cost * 100 : 0;
  return { btc: Math.max(btc, 0), cost: Math.max(cost, 0), currentPrice, currentValue, avgCost, unrealized, pnlPct };
}

async function refreshDecisionPortfolio() {
  const summary = document.getElementById('portfolioSummary');
  const list = document.getElementById('portfolioList');
  if (!summary || !list) return;
  const rows = getDecisionPortfolio();
  summary.innerHTML = loadingCard(110);
  try {
    const ctx = await getDecisionMarketContext();
    const p = calculatePortfolio(rows, ctx);
    summary.innerHTML = `
      <div class="decision-kpi-grid">
        <div><span>BTC đang nắm giữ</span><strong>${formatBTC(p.btc, 8)}</strong><small>${rows.length} giao dịch</small></div>
        <div><span>Giá vốn TB</span><strong>${p.avgCost ? formatVND(p.avgCost) : '—'}</strong><small>/ BTC</small></div>
        <div><span>Giá trị hiện tại</span><strong>${formatVND(p.currentValue)}</strong><small>Theo P2P SELL</small></div>
        <div class="total"><span>Lãi/lỗ tạm tính</span><strong class="${p.unrealized >= 0 ? 'positive' : 'negative'}">${formatVND(p.unrealized)}</strong><small>${formatPct(p.pnlPct, 2)}</small></div>
      </div>`;
    list.innerHTML = rows.length ? rows.slice().reverse().map(r => `<div class="order-row"><div><strong>${r.side} · ${formatVND(r.amount_vnd)}</strong><div class="meta">${formatBTC(r.btc_qty, 8)} · ${formatVNTime(r.created_at)}${r.note ? ` · ${escapeHTML(r.note)}` : ''}</div></div><button class="btn small danger" data-portfolio-delete="${r.id}">Xóa</button></div>`).join('') : `<div class="state-box empty">Chưa có giao dịch danh mục demo.</div>`;
    document.querySelectorAll('[data-portfolio-delete]').forEach(btn => btn.addEventListener('click', () => {
      setDecisionPortfolio(getDecisionPortfolio().filter(r => r.id !== btn.dataset.portfolioDelete));
      refreshDecisionPortfolio();
    }));
  } catch (error) {
    summary.innerHTML = errorBox(error.message);
  }
}

async function addPortfolioTrade() {
  const side = document.getElementById('portfolioSide').value;
  const amountVnd = Number(document.getElementById('portfolioVnd').value);
  const note = document.getElementById('portfolioNote').value.trim();
  if (!amountVnd || amountVnd <= 0) { showToast('Vui lòng nhập số tiền VNĐ hợp lệ.'); return; }
  try {
    const ctx = await getDecisionMarketContext();
    const price = side === 'BUY' ? ctx.buyPrice : ctx.sellPrice;
    const btcQty = amountVnd / Math.max(ctx.btcUsd * price, 1);
    const rows = getDecisionPortfolio();
    rows.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, side, amount_vnd: amountVnd, btc_qty: btcQty, price_vnd_per_btc: ctx.btcUsd * price, note, created_at: new Date().toISOString() });
    setDecisionPortfolio(rows);
    showToast('Đã thêm giao dịch vào Portfolio Tracker demo.');
    document.getElementById('portfolioNote').value = '';
    await refreshDecisionPortfolio();
  } catch (error) { showToast(error.message); }
}

function clearPortfolioTrades() {
  if (!confirm('Xóa toàn bộ danh mục demo trong trình duyệt này?')) return;
  setDecisionPortfolio([]);
  refreshDecisionPortfolio();
  showToast('Đã xóa danh mục demo.');
}

function addSmartAlert() {
  const metric = document.getElementById('smartMetric').value;
  const operator = document.getElementById('smartOperator').value;
  const threshold = Number(document.getElementById('smartThreshold').value);
  if (!Number.isFinite(threshold)) { showToast('Vui lòng nhập ngưỡng hợp lệ.'); return; }
  const rows = getSmartAlerts();
  rows.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, metric, operator, threshold, active: true, created_at: new Date().toISOString(), last_status: 'Chưa kiểm tra' });
  setSmartAlerts(rows);
  renderSmartAlerts();
  showToast('Đã thêm cảnh báo thông minh cục bộ.');
}

function renderSmartAlerts() {
  const box = document.getElementById('smartAlertList');
  if (!box) return;
  const rows = getSmartAlerts();
  box.innerHTML = rows.length ? rows.map(r => `<div class="order-row"><div><strong>${metricLabel(r.metric)} ${r.operator === 'gt' ? '>' : '<'} ${formatNumber(Number(r.threshold), 3)}</strong><div class="meta">${escapeHTML(r.last_status || 'Chưa kiểm tra')} · ${formatVNTime(r.created_at)}</div></div><button class="btn small danger" data-smart-delete="${r.id}">Xóa</button></div>`).join('') : `<div class="state-box empty">Chưa có cảnh báo cục bộ. Thêm rule rồi bấm “Kiểm tra ngay”.</div>`;
  document.querySelectorAll('[data-smart-delete]').forEach(btn => btn.addEventListener('click', () => { setSmartAlerts(getSmartAlerts().filter(r => r.id !== btn.dataset.smartDelete)); renderSmartAlerts(); }));
}

function metricLabel(metric) {
  return ({ price: 'BTC/USDT', rsi: 'RSI', risk: 'Risk Score', p2p_sell: 'P2P SELL', p2p_buy: 'P2P BUY' })[metric] || metric;
}

async function evaluateSmartAlerts() {
  const rows = getSmartAlerts();
  if (!rows.length) { showToast('Chưa có cảnh báo để kiểm tra.'); return; }
  const box = document.getElementById('smartAlertList');
  box.innerHTML = loadingCard(110);
  try {
    const ctx = await getDecisionMarketContext();
    const values = { price: ctx.btcUsd, rsi: Number(ctx.latest.rsi_14 || 0), risk: Number(ctx.risk.score || 0), p2p_sell: ctx.sellPrice, p2p_buy: ctx.buyPrice };
    const updated = rows.map(r => {
      const value = Number(values[r.metric]);
      const hit = r.operator === 'gt' ? value > Number(r.threshold) : value < Number(r.threshold);
      return { ...r, last_status: `${hit ? 'ĐẠT NGƯỠNG' : 'Chưa đạt'} · hiện tại ${formatNumber(value, 3)}`, last_checked_at: new Date().toISOString() };
    });
    setSmartAlerts(updated);
    renderSmartAlerts();
    const hitCount = updated.filter(r => String(r.last_status || '').includes('ĐẠT NGƯỠNG')).length;
    showToast(hitCount ? `${hitCount} cảnh báo đã đạt ngưỡng.` : 'Chưa có cảnh báo nào đạt ngưỡng.');
  } catch (error) { box.innerHTML = errorBox(error.message); }
}

async function calculateRealVND() {
  const box = document.getElementById('realVndResult');
  const side = document.getElementById('realSide').value;
  const btc = Number(document.getElementById('realBtc').value);
  const feePct = Number(document.getElementById('realFee').value || 0);
  const taxPct = Number(document.getElementById('realTax').value || 0);
  if (!btc || btc <= 0) { box.innerHTML = `<div class="state-box error">Vui lòng nhập số BTC hợp lệ.</div>`; return; }
  box.innerHTML = loadingCard(130);
  try {
    const ctx = await getDecisionMarketContext();
    const usdtValue = btc * ctx.btcUsd;
    const p2pPrice = side === 'sell' ? ctx.sellPrice : ctx.buyPrice;
    const gross = usdtValue * p2pPrice;
    const fee = gross * feePct / 100;
    const tax = side === 'sell' ? gross * taxPct / 100 : 0;
    const net = side === 'sell' ? gross - fee - tax : gross + fee;
    box.innerHTML = `
      <div class="result-panel settlement-result">
        <span class="badge green">${side === 'sell' ? 'Bán BTC lấy VNĐ' : 'Mua BTC bằng VNĐ'}</span>
        <div class="breakdown decision-breakdown">
          <div><span>BTC</span><strong>${formatBTC(btc, 8)}</strong><small>${formatNumber(usdtValue, 4)} USDT</small></div>
          <div><span>Giá P2P</span><strong>${formatVND(p2pPrice)} / USDT</strong><small>${side === 'sell' ? 'SELL' : 'BUY'}</small></div>
          <div><span>Phí/Thuế tham khảo</span><strong>${formatVND(fee + tax)}</strong><small>Phí ${formatPct(feePct, 2, false)} · Thuế ${formatPct(taxPct, 2, false)}</small></div>
          <div class="total"><span>${side === 'sell' ? 'VNĐ thực nhận' : 'VNĐ cần chi'}</span><strong>${formatVND(net)}</strong><small>Ước tính, không phải báo giá cam kết</small></div>
        </div>
      </div>`;
  } catch (error) { box.innerHTML = errorBox(error.message); }
}

async function explainTradeWithAI() {
  const box = document.getElementById('aiExplainResult');
  const question = document.getElementById('aiExplainInput').value.trim();
  if (!question) { showToast('Vui lòng nhập tình huống cần AI giải thích.'); return; }
  box.innerHTML = `<div class="state-box empty">AI đang tổng hợp dữ liệu thị trường, P2P, Risk Score và bối cảnh người dùng...</div>`;
  try {
    const res = await askAI(`${question}\n\nHãy trả lời theo cấu trúc: 1) Tóm tắt thị trường, 2) Rủi ro, 3) Kế hoạch tham khảo, 4) Điều kiện nên chờ thêm, 5) Disclaimer không phải khuyến nghị đầu tư.`);
    box.innerHTML = `<div class="msg ai decision-ai-message">${escapeHTML(aiResponseText(res.data)).replace(/\n/g, '<br>')}</div>`;
  } catch (error) { box.innerHTML = errorBox(error.message); }
}

async function renderTradePage() {
  app.innerHTML = `
    <section class="page-head">
      <div>
        <span class="eyebrow">Sàn giao dịch ảo BTC</span>
        <h1>BTC Trading Terminal Demo</h1>
        <p class="lead">Mô phỏng giao dịch BTC bằng ví demo nạp qua QR không mất phí. Giao diện ưu tiên trực quan như một mini terminal: có biểu đồ nến, chỉ báo kỹ thuật, sổ thông tin và ticket đặt lệnh.</p>
      </div>
      <div class="hero-actions">
        <a class="btn accent" href="#wallet">Nạp tiền demo miễn phí</a>
        <a class="btn secondary" href="#decision">Mở Decision Hub</a>
      </div>
    </section>
    <section class="trade-terminal-page" id="tradeTerminalRoot">
      ${loadingCard(860)}
    </section>
  `;
  await loadTradeTerminal();
}

async function loadTradeTerminal() {
  const root = document.getElementById('tradeTerminalRoot');
  if (!root) return;
  root.innerHTML = loadingCard(860);

  try {
    const [latestRes, ohlcvRes, p2pRes, riskRes, walletRes, tradesRes] = await Promise.all([
      fetchJson('/api/latest'),
      fetchJson(`/api/ohlcv?hours=${tradeTerminalHours}`),
      fetchJson(`/api/p2p-spread?hours=${tradeTerminalHours}`, { timeout: 30000 }),
      fetchJson('/api/risk-score'),
      fetchJson('/api/wallet/me'),
      fetchJson('/api/demo-trades?limit=50')
    ]);

    const latest = latestRes.data || {};
    const ohlcv = ohlcvRes.data || {};
    const p2p = p2pRes.data || {};
    const risk = riskRes.data || {};
    const wallet = walletRes.data?.wallet || {};
    const trades = tradesRes.data?.data || [];
    const portfolio = tradesRes.data?.portfolio || {};

    const latestBuy = latestByTradeType(p2p.data || [], 'BUY');
    const latestSell = latestByTradeType(p2p.data || [], 'SELL');
    const marketUsdtVnd = Number(latestBuy?.market_price || latestSell?.market_price || 0);
    const priceChangePct = isNum(latest.open) && isNum(latest.close) && latest.open ? ((latest.close - latest.open) / latest.open) * 100 : 0;
    const btcMarketVnd = isNum(latest.close) && marketUsdtVnd ? latest.close * marketUsdtVnd : 0;
    const btcP2pBuyVnd = isNum(latest.close) && isNum(latestBuy?.p2p_price) ? latest.close * latestBuy.p2p_price : 0;
    const btcP2pSellVnd = isNum(latest.close) && isNum(latestSell?.p2p_price) ? latest.close * latestSell.p2p_price : 0;
    const btcPosition = Number(portfolio.position_btc || 0);
    const walletVnd = Number(wallet.balance_vnd || 0);
    const estimatedEquity = walletVnd + (btcPosition * (btcP2pSellVnd || btcMarketVnd || 0));
    const dataFreshText = ageTextFromTimestamp(latest.timestamp);

    window.__tradeMarketState = {
      latest,
      latestBuy,
      latestSell,
      marketUsdtVnd,
      btcMarketVnd,
      btcP2pBuyVnd,
      btcP2pSellVnd,
      wallet,
      portfolio,
      trades,
      risk,
      ohlcvRows: ohlcv.data || []
    };
    currentTradePreview = null;

    root.innerHTML = `
      <section class="trade-terminal-shell">
        <div class="trade-terminal-grid">
          <div class="card trade-screen-card">
            <div class="trade-screen-head">
              <div>
                <span class="badge violet">BTC/USDT</span>
                <h2>Trading Terminal</h2>
                <p>Dữ liệu: ${sourcePill(latestRes.source)} · P2P: ${sourcePill(p2pRes.source)} · Cập nhật ${escapeHTML(dataFreshText)}</p>
              </div>
              <div class="segmented" id="tradeHoursTabs">
                <button data-trade-hours="24">24H</button>
                <button data-trade-hours="168">7 ngày</button>
                <button data-trade-hours="720">30 ngày</button>
              </div>
            </div>

            <div class="trade-kpi-strip">
              <div class="terminal-kpi ${priceChangePct >= 0 ? 'up' : 'down'}">
                <span>BTC/USDT</span>
                <strong>${formatUSD(latest.close)}</strong>
                <small>${priceChangePct >= 0 ? '+' : ''}${formatPct(priceChangePct, 2, false)} so với giá mở cửa</small>
              </div>
              <div class="terminal-kpi">
                <span>BTC quy đổi thị trường</span>
                <strong>${btcMarketVnd ? formatVND(btcMarketVnd) : '—'}</strong>
                <small>${marketUsdtVnd ? `${formatVND(marketUsdtVnd)} / USDT` : 'Thiếu tỷ giá USDT/VNĐ'}</small>
              </div>
              <div class="terminal-kpi">
                <span>P2P BUY / SELL</span>
                <strong>${btcP2pBuyVnd ? formatVND(btcP2pBuyVnd) : '—'} / ${btcP2pSellVnd ? formatVND(btcP2pSellVnd) : '—'}</strong>
                <small>Dùng khi mua hoặc bán BTC bằng ví demo</small>
              </div>
              <div class="terminal-kpi">
                <span>Risk Score</span>
                <strong>${isNum(risk.score) ? `${Math.round(risk.score)}/100` : '—'}</strong>
                <small>${escapeHTML(risk.label_vi || risk.level || 'Rule-based')}</small>
              </div>
              <div class="terminal-kpi">
                <span>Ví demo / Tài sản</span>
                <strong>${formatVND(walletVnd)} / ${formatNumber(btcPosition, 6)} BTC</strong>
                <small>Equity ước tính: ${estimatedEquity ? formatVND(estimatedEquity) : '—'}</small>
              </div>
            </div>

            <div id="tradeAdvancedChart" class="chart-box trade-advanced-chart"></div>

            <div class="trade-indicator-board">
              ${tradeIndicatorTile('RSI 14', latest.rsi_14, latest.rsi_14 > 70 ? 'Quá mua' : latest.rsi_14 < 30 ? 'Quá bán' : 'Trung tính')}
              ${tradeIndicatorTile('MACD', latest.macd_hist, latest.macd_hist >= 0 ? 'Động lượng dương' : 'Động lượng âm')}
              ${tradeIndicatorTile('EMA20 / EMA50', latest.ema_20, isNum(latest.ema_20) && isNum(latest.ema_50) ? `${formatNumber(latest.ema_20, 0)} / ${formatNumber(latest.ema_50, 0)}` : '—', true)}
              ${tradeIndicatorTile('EMA200', latest.ema_200, 'Xu hướng dài hạn')}
              ${tradeIndicatorTile('Bollinger', latest.bb_mid, isNum(latest.bb_upper) && isNum(latest.bb_lower) ? `${formatNumber(latest.bb_lower, 0)} – ${formatNumber(latest.bb_upper, 0)}` : '—', true)}
              ${tradeIndicatorTile('Volume', latest.volume, isNum(latest.vol_ma_20) ? `MA20 ${formatNumber(latest.vol_ma_20, 2)}` : 'Khối lượng mới nhất', true)}
            </div>
          </div>

          <div class="trade-side-panel">
            <div class="card trade-wallet-card">
              <div class="section-head compact"><div><h3>Ví demo & danh mục</h3><p>Nạp tiền demo không mất phí rồi giao dịch ngay trên terminal.</p></div></div>
              <div class="wallet-balance-stack">
                <div><span>Số dư khả dụng</span><strong>${formatVND(walletVnd)}</strong></div>
                <div><span>BTC đang nắm giữ</span><strong>${formatNumber(btcPosition, 6)} BTC</strong></div>
                <div><span>Giá vốn bình quân</span><strong>${portfolio.avg_entry_vnd ? formatVND(portfolio.avg_entry_vnd) : '—'}</strong></div>
                <div><span>Lãi/lỗ đã chốt</span><strong class="${Number(portfolio.realized_pnl_vnd || 0) >= 0 ? 'positive' : 'negative'}">${formatVND(portfolio.realized_pnl_vnd || 0)}</strong></div>
              </div>
              <div class="hero-actions" style="margin-top:14px">
                <a class="btn primary full" href="#wallet">Nạp tiền demo</a>
                <a class="btn secondary full" href="#history?tab=trades">Xem lịch sử giao dịch</a>
              </div>
              <div class="wallet-safe-note">Ví demo phục vụ học phần, không phát sinh tiền thật. Lệnh BUY dùng số dư ví VND; lệnh SELL chỉ cho phép khi bạn đang nắm giữ đủ BTC mô phỏng.</div>
            </div>

            <div class="card trade-order-card">
              <div class="section-head compact"><div><h3>Order Ticket</h3><p>Chọn nhập theo VNĐ hoặc BTC; hệ thống tự quy đổi hai chiều theo nguồn giá bạn chọn.</p></div></div>
              <div class="trade-side-toggle" id="tradeSideToggle">
                <button class="active" data-side="BUY">Mua BTC</button>
                <button data-side="SELL">Bán BTC</button>
              </div>
              <div class="trade-amount-mode-row">
                <span>Nhập giá trị theo</span>
                <div class="trade-amount-mode-toggle" id="tradeAmountModeToggle" aria-label="Chọn đơn vị nhập giao dịch">
                  <button type="button" class="${tradeAmountMode === 'VND' ? 'active' : ''}" data-trade-amount-mode="VND">VNĐ</button>
                  <button type="button" class="${tradeAmountMode === 'BTC' ? 'active' : ''}" data-trade-amount-mode="BTC">BTC</button>
                </div>
              </div>
              <div class="field">
                <label id="tradeAmountLabel">${tradeAmountMode === 'BTC' ? 'Khối lượng BTC muốn giao dịch' : 'Số tiền giao dịch (VNĐ)'}</label>
                <div class="trade-amount-input-wrap">
                  <input id="tradeAmount" type="number" inputmode="decimal" value="${tradeAmountMode === 'BTC' ? '0.001' : '5000000'}" min="${tradeAmountMode === 'BTC' ? '0.00000001' : '10000'}" step="${tradeAmountMode === 'BTC' ? '0.00000001' : '10000'}">
                  <span id="tradeAmountSuffix">${tradeAmountMode}</span>
                </div>
                <small id="tradeAmountHint" class="trade-field-hint">${tradeAmountMode === 'BTC' ? 'Hệ thống tự quy đổi số BTC này sang VNĐ theo nguồn giá đã chọn.' : 'Hệ thống tự quy đổi số tiền này sang khối lượng BTC.'}</small>
              </div>
              <div class="quick-amounts" id="tradeQuickAmounts">${tradeQuickAmountsHTML(tradeAmountMode)}</div>
              <div class="field" style="margin-top:12px"><label>Nguồn tỷ giá USDT/VNĐ</label><select id="tradePriceSource"><option value="p2p">P2P (mô phỏng sát người dùng Việt Nam)</option><option value="market">Giá quốc tế quy đổi</option></select></div>
              <div id="tradeOrderPreview" class="trade-order-preview state-box empty" style="margin-top:14px">Nhấn <b>Xem trước lệnh</b> để hệ thống tính giá BTC quy đổi, khối lượng dự kiến và kiểm tra số dư ví demo.</div>
              <div class="hero-actions" style="margin-top:14px">
                <button id="tradePreviewBtn" class="btn secondary full">Xem trước lệnh</button>
                <button id="tradeExecuteBtn" class="btn primary full" disabled>Đặt lệnh demo</button>
              </div>
            </div>
          </div>
        </div>

        <div class="trade-lower-grid">
          <div class="card trade-positions-card">
            <div class="section-head compact"><div><h3>Tổng quan vị thế</h3><p>Thông tin được tính trực tiếp từ lịch sử giao dịch demo của tài khoản.</p></div></div>
            <div class="decision-kpi-row">
              <div><span>Tổng lệnh</span><strong>${portfolio.trades_count || 0}</strong></div>
              <div><span>Lệnh mua</span><strong>${portfolio.buys || 0}</strong></div>
              <div><span>Lệnh bán</span><strong>${portfolio.sells || 0}</strong></div>
              <div><span>Tổng vốn mua</span><strong>${formatVND(portfolio.total_buy_vnd || 0)}</strong></div>
              <div><span>Tổng tiền bán</span><strong>${formatVND(portfolio.total_sell_vnd || 0)}</strong></div>
            </div>
            <div class="result-panel" style="margin-top:14px">
              <strong>Giải thích nhanh</strong>
              <p>BUY sẽ dùng số dư ví demo để mở vị thế BTC. SELL sẽ chốt vị thế BTC mô phỏng và hoàn tiền lại ví demo. Dữ liệu giá sử dụng trực tiếp từ BTC/USDT và USDT/VNĐ (P2P hoặc quốc tế) để mô phỏng gần hành vi giao dịch thực tế.</p>
            </div>
          </div>

          <div class="card trade-history-card">
            <div class="section-head compact"><div><h3>Lịch sử giao dịch demo</h3><p>5 lệnh gần nhất của tài khoản.</p></div></div>
            <div id="tradeHistory" class="trade-history">${trades.length ? trades.map(tradeRowHTML).join('') : `<div class="state-box empty">Chưa có giao dịch BTC demo nào.</div>`}</div>
          </div>
        </div>
      </section>
    `;

    document.querySelectorAll('[data-trade-hours]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.tradeHours) === tradeTerminalHours);
      btn.addEventListener('click', async () => {
        tradeTerminalHours = Number(btn.dataset.tradeHours || 168);
        await loadTradeTerminal();
      });
    });
    document.getElementById('tradeQuickAmounts')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-trade-amount]');
      if (!btn) return;
      const input = document.getElementById('tradeAmount');
      if (input) input.value = btn.dataset.tradeAmount || '';
      invalidateTradePreview('Giá trị đã thay đổi. Nhấn <b>Xem trước lệnh</b> để tính lại.');
    });
    document.querySelectorAll('[data-trade-amount-mode]').forEach(btn => btn.addEventListener('click', () => {
      tradeAmountMode = btn.dataset.tradeAmountMode === 'BTC' ? 'BTC' : 'VND';
      document.querySelectorAll('[data-trade-amount-mode]').forEach(item => item.classList.toggle('active', item === btn));
      configureTradeAmountInput(true);
      invalidateTradePreview(`Đã chuyển sang nhập theo <b>${tradeAmountMode}</b>. Nhấn <b>Xem trước lệnh</b> để quy đổi.`);
    }));
    document.querySelectorAll('#tradeSideToggle button').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('#tradeSideToggle button').forEach(item => item.classList.remove('active'));
      btn.classList.add('active');
      invalidateTradePreview('Nhấn <b>Xem trước lệnh</b> để hệ thống tính lại theo chiều giao dịch mới.');
    }));
    document.getElementById('tradeAmount')?.addEventListener('input', () => invalidateTradePreview('Giá trị đã thay đổi. Nhấn <b>Xem trước lệnh</b> để tính lại.'));
    document.getElementById('tradeAmount')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        previewTradeOrder();
      }
    });
    document.getElementById('tradePriceSource')?.addEventListener('change', () => invalidateTradePreview('Nguồn giá đã thay đổi. Nhấn <b>Xem trước lệnh</b> để tính lại.'));
    document.getElementById('tradePreviewBtn')?.addEventListener('click', previewTradeOrder);
    document.getElementById('tradeExecuteBtn')?.addEventListener('click', executeTradeOrder);

    drawTradeTerminalChart('tradeAdvancedChart', ohlcv.data || []);
    bindTradeHistoryDetails(document.getElementById('tradeHistory'));
  } catch (error) {
    root.innerHTML = errorBox(error.message);
  }
}

function tradeIndicatorTile(title, value, note = '', rawText = false) {
  const display = rawText ? note : (isNum(value) ? formatNumber(Number(value), Number(value) > 1000 ? 0 : 2) : '—');
  const secondary = rawText ? '' : note;
  return `
    <div class="trade-indicator-tile">
      <span>${escapeHTML(title)}</span>
      <strong>${escapeHTML(display)}</strong>
      <small>${escapeHTML(secondary || (rawText ? String(value ?? '') : ''))}</small>
    </div>
  `;
}

function ageTextFromTimestamp(timestamp) {
  const date = parseTs(timestamp);
  if (Number.isNaN(date.getTime())) return 'không rõ thời điểm';
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.round((mins / 60) * 10) / 10;
  return `${hours} giờ trước`;
}

function tradeQuickAmountsHTML(mode = tradeAmountMode) {
  const items = mode === 'BTC'
    ? [
      ['0.0001', '0,0001 BTC'],
      ['0.001', '0,001 BTC'],
      ['0.005', '0,005 BTC'],
      ['0.01', '0,01 BTC']
    ]
    : [
      ['1000000', '1.000.000đ'],
      ['5000000', '5.000.000đ'],
      ['10000000', '10.000.000đ'],
      ['50000000', '50.000.000đ']
    ];
  return items.map(([value, label]) => `<button type="button" class="btn small secondary" data-trade-amount="${value}">${label}</button>`).join('');
}

function configureTradeAmountInput(resetValue = false) {
  const input = document.getElementById('tradeAmount');
  const label = document.getElementById('tradeAmountLabel');
  const suffix = document.getElementById('tradeAmountSuffix');
  const hint = document.getElementById('tradeAmountHint');
  const quick = document.getElementById('tradeQuickAmounts');
  if (!input) return;

  const btcMode = tradeAmountMode === 'BTC';
  input.min = btcMode ? '0.00000001' : '10000';
  input.step = btcMode ? '0.00000001' : '10000';
  input.placeholder = btcMode ? '0.001' : '5000000';
  if (resetValue) input.value = btcMode ? '0.001' : '5000000';
  if (label) label.textContent = btcMode ? 'Khối lượng BTC muốn giao dịch' : 'Số tiền giao dịch (VNĐ)';
  if (suffix) suffix.textContent = tradeAmountMode;
  if (hint) hint.textContent = btcMode
    ? 'Hệ thống tự quy đổi số BTC này sang VNĐ theo nguồn giá đã chọn.'
    : 'Hệ thống tự quy đổi số tiền này sang khối lượng BTC.';
  if (quick) quick.innerHTML = tradeQuickAmountsHTML(tradeAmountMode);
}

function invalidateTradePreview(message = 'Nhấn <b>Xem trước lệnh</b> để hệ thống tính lại.') {
  currentTradePreview = null;
  const previewEl = document.getElementById('tradeOrderPreview');
  const execBtn = document.getElementById('tradeExecuteBtn');
  if (previewEl) {
    previewEl.classList.add('empty');
    previewEl.innerHTML = message;
  }
  if (execBtn) execBtn.disabled = true;
}

function getSelectedTradeSide() {
  return document.querySelector('#tradeSideToggle button.active')?.dataset.side || 'BUY';
}

function getTradePricingContext(side, priceSource) {
  const state = window.__tradeMarketState || {};
  const latest = state.latest || {};
  const buy = state.latestBuy || {};
  const sell = state.latestSell || {};
  const marketUsdtVnd = Number(state.marketUsdtVnd || 0);
  const btcUsd = Number(latest.close || 0);
  const p2pRate = side === 'BUY' ? Number(buy.p2p_price || 0) : Number(sell.p2p_price || 0);
  const usdtVnd = priceSource === 'market' ? marketUsdtVnd : p2pRate;
  const appliedBtcVnd = btcUsd && usdtVnd ? btcUsd * usdtVnd : 0;
  return {
    btcUsd,
    usdtVnd,
    appliedBtcVnd,
    marketUsdtVnd,
    rateLabel: priceSource === 'market'
      ? 'Giá quốc tế quy đổi'
      : (side === 'BUY' ? 'P2P BUY USDT/VNĐ' : 'P2P SELL USDT/VNĐ')
  };
}

async function previewTradeOrder() {
  const previewEl = document.getElementById('tradeOrderPreview');
  const executeBtn = document.getElementById('tradeExecuteBtn');
  const inputValue = Number(document.getElementById('tradeAmount')?.value || 0);
  const inputMode = tradeAmountMode === 'BTC' ? 'BTC' : 'VND';
  const side = getSelectedTradeSide();
  const priceSource = document.getElementById('tradePriceSource')?.value || 'p2p';
  const state = window.__tradeMarketState || {};
  const walletVnd = Number(state.wallet?.balance_vnd || 0);
  const positionBtc = Number(state.portfolio?.position_btc || 0);

  if (!previewEl || !executeBtn) return;
  previewEl.classList.remove('empty');
  if (!Number.isFinite(inputValue) || inputValue <= 0) {
    previewEl.innerHTML = `<div class="state-box error">Giá trị giao dịch phải lớn hơn 0.</div>`;
    executeBtn.disabled = true;
    return;
  }
  if (inputMode === 'VND' && inputValue < 10000) {
    previewEl.innerHTML = `<div class="state-box error">Số tiền giao dịch phải từ 10.000đ trở lên.</div>`;
    executeBtn.disabled = true;
    return;
  }
  if (inputMode === 'BTC' && inputValue < 0.00000001) {
    previewEl.innerHTML = `<div class="state-box error">Khối lượng nhỏ nhất là 0,00000001 BTC.</div>`;
    executeBtn.disabled = true;
    return;
  }

  const pricing = getTradePricingContext(side, priceSource);
  if (!pricing.appliedBtcVnd) {
    previewEl.innerHTML = `<div class="state-box error">Chưa đủ dữ liệu giá để tính lệnh demo.</div>`;
    executeBtn.disabled = true;
    return;
  }

  let amountBtc = inputMode === 'BTC' ? inputValue : inputValue / pricing.appliedBtcVnd;
  amountBtc = Number(amountBtc.toFixed(8));
  let amountVnd = inputMode === 'VND' ? inputValue : amountBtc * pricing.appliedBtcVnd;
  amountVnd = Math.round(amountVnd * 100) / 100;
  if (amountBtc <= 0 || amountVnd <= 0) {
    previewEl.innerHTML = `<div class="state-box error">Giá trị sau quy đổi không hợp lệ.</div>`;
    executeBtn.disabled = true;
    return;
  }

  const enoughBalance = side === 'BUY' ? walletVnd + 0.01 >= amountVnd : positionBtc + 1e-12 >= amountBtc;
  const compareP2p = getTradePricingContext(side, 'p2p').appliedBtcVnd;
  const compareMarket = getTradePricingContext(side, 'market').appliedBtcVnd;
  const altPrice = priceSource === 'p2p' ? compareMarket : compareP2p;
  const altDiff = altPrice ? altPrice - pricing.appliedBtcVnd : 0;

  currentTradePreview = {
    side,
    priceSource,
    inputMode,
    inputValue,
    amountVnd,
    amountBtc,
    appliedPrice: pricing.appliedBtcVnd,
    btcUsd: pricing.btcUsd,
    usdtVnd: pricing.usdtVnd,
    enoughBalance,
    altDiff,
    walletVnd,
    positionBtc,
    rateLabel: pricing.rateLabel
  };

  previewEl.innerHTML = `
    <div class="trade-preview-grid">
      <div><span>Giá trị giao dịch</span><strong>${formatVND(amountVnd)}</strong></div>
      <div><span>Khối lượng BTC</span><strong>${formatNumber(amountBtc, 8)} BTC</strong></div>
      <div><span>Giá BTC quy đổi</span><strong>${formatVND(pricing.appliedBtcVnd)}</strong></div>
      <div><span>Tỷ giá sử dụng</span><strong>${formatVND(pricing.usdtVnd)} / USDT</strong></div>
    </div>
    <div class="trade-conversion-note">Bạn nhập <b>${inputMode === 'BTC' ? `${formatNumber(inputValue, 8)} BTC` : formatVND(inputValue)}</b> · Hệ thống quy đổi tự động sang <b>${inputMode === 'BTC' ? formatVND(amountVnd) : `${formatNumber(amountBtc, 8)} BTC`}</b>.</div>
    <div class="result-panel" style="margin-top:12px">
      <strong>${side === 'BUY' ? 'Lệnh mua BTC' : 'Lệnh bán BTC'}</strong>
      <p>Nguồn giá: <b>${escapeHTML(pricing.rateLabel)}</b>. ${side === 'BUY' ? `Ví demo của bạn hiện có ${formatVND(walletVnd)}.` : `Danh mục hiện có ${formatNumber(positionBtc, 8)} BTC.`}</p>
      <p>${altPrice ? `So với nguồn giá còn lại, mức chênh lệch mỗi BTC là ${formatVND(Math.abs(altDiff))} (${altDiff > 0 ? 'nguồn hiện tại rẻ hơn cho người mua / lợi hơn cho người bán' : altDiff < 0 ? 'nguồn còn lại đang tốt hơn' : 'hai nguồn gần như tương đương'}).` : 'Nguồn giá thay thế chưa đủ dữ liệu để so sánh.'}</p>
      <p class="${enoughBalance ? 'positive' : 'negative'}">${enoughBalance ? '✅ Đủ điều kiện đặt lệnh demo.' : (side === 'BUY' ? `⚠️ Ví còn thiếu ${formatVND(Math.max(0, amountVnd - walletVnd))}. Hãy nạp thêm tiền demo.` : `⚠️ Bạn còn thiếu ${formatNumber(Math.max(0, amountBtc - positionBtc), 8)} BTC để đặt lệnh bán.`)}</p>
    </div>
  `;
  executeBtn.disabled = !enoughBalance;
}

async function executeTradeOrder() {
  if (!currentTradePreview) {
    await previewTradeOrder();
    if (!currentTradePreview) return;
  }

  if (!currentTradePreview.enoughBalance) {
    showToast('Lệnh demo chưa đủ điều kiện thực hiện.');
    return;
  }

  const button = document.getElementById('tradeExecuteBtn');
  if (button) {
    button.disabled = true;
    button.textContent = 'Đang khớp lệnh demo...';
  }
  try {
    await fetchJson('/api/demo-trades', {
      method: 'POST',
      body: {
        side: currentTradePreview.side,
        amount_vnd: currentTradePreview.amountVnd,
        amount_btc: currentTradePreview.amountBtc,
        amount_usdt: currentTradePreview.amountBtc,
        price_source: currentTradePreview.priceSource,
        applied_price: currentTradePreview.appliedPrice
      }
    });
    showToast(`Đã khớp lệnh ${currentTradePreview.side} · ${formatNumber(currentTradePreview.amountBtc, 8)} BTC · ${formatVND(currentTradePreview.amountVnd)}.`);
    await loadTradeTerminal();
  } catch (error) {
    const previewEl = document.getElementById('tradeOrderPreview');
    if (previewEl) previewEl.innerHTML = errorBox(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Đặt lệnh demo';
    }
  }
}

async function renderAccountTradePreview() {
  const el = document.getElementById('tradeHistory');
  if (!el) return;
  try {
    const res = await fetchJson('/api/demo-trades?limit=5');
    const rows = res.data.data || [];
    el.innerHTML = rows.length ? rows.map(tradeRowHTML).join('') : `<div class="state-box empty">Chưa có giao dịch mô phỏng.</div>`;
    bindTradeHistoryDetails(el);
  } catch (error) { el.innerHTML = errorBox(error.message); }
}

function encodeTradePayload(value) {
  try { return encodeURIComponent(JSON.stringify(value || {})); }
  catch (_) { return ''; }
}

function tradeRowHTML(o) {
  const side = String(o.side || '').toUpperCase();
  const isBuy = side === 'BUY';
  const amountBtc = Number(o.amount_usdt || o.usdt || 0);
  const amountVnd = Number(o.amount_vnd || o.amount || 0);
  const applied = Number(o.applied_price || 0) || (amountBtc > 0 ? amountVnd / amountBtc : 0);
  const sourceLabel = String(o.price_source || 'p2p').toLowerCase() === 'market' ? 'Thị trường' : 'P2P';
  const payload = escapeHTML(encodeTradePayload(o));
  return `
    <div class="order-row trade-order-row trade-history-trigger ${isBuy ? 'buy' : 'sell'}" role="button" tabindex="0" aria-label="Xem chi tiết lệnh ${isBuy ? 'mua' : 'bán'} BTC" data-trade-payload="${payload}">
      <div class="trade-row-main">
        <span class="trade-direction-icon" aria-hidden="true">${isBuy ? '↗' : '↘'}</span>
        <div class="trade-row-copy">
          <strong>${isBuy ? 'MUA BTC' : 'BÁN BTC'}</strong>
          <div class="meta">${formatVNTime(o.created_at || o.createdAt)} · ${escapeHTML(sourceLabel)}</div>
        </div>
      </div>
      <div class="trade-row-value">
        <strong>${formatNumber(amountBtc, 8)} BTC</strong>
        <div class="meta">${formatVND(amountVnd)} · ${applied ? `${formatVND(applied)}/BTC` : 'Giá mô phỏng'}</div>
      </div>
      <div class="trade-row-action"><span>Chi tiết</span><b aria-hidden="true">›</b></div>
    </div>
  `;
}

function bindTradeHistoryDetails(root = document) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  scope.querySelectorAll('.trade-history-trigger[data-trade-payload]').forEach(row => {
    if (row.dataset.tradeDetailBound === 'true') return;
    row.dataset.tradeDetailBound = 'true';
    const openDetail = () => {
      try {
        const trade = JSON.parse(decodeURIComponent(row.dataset.tradePayload || ''));
        showTradeDetailModal(trade);
      } catch (_) {
        showToast('Không đọc được chi tiết giao dịch này.');
      }
    };
    row.addEventListener('click', openDetail);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetail();
      }
    });
  });
}

function showTradeDetailModal(trade) {
  document.getElementById('tradeDetailModal')?.remove();

  const side = String(trade.side || '').toUpperCase();
  const isBuy = side === 'BUY';
  const amountBtc = Number(trade.amount_usdt || trade.usdt || 0);
  const amountVnd = Number(trade.amount_vnd || trade.amount || 0);
  const feeVnd = Number(trade.fee_vnd || trade.fee || 0);
  const appliedPrice = Number(trade.applied_price || 0) || (amountBtc > 0 ? amountVnd / amountBtc : 0);
  const source = String(trade.price_source || 'p2p').toLowerCase();
  const sourceLabel = source === 'market' ? 'Giá thị trường quốc tế quy đổi' : 'Giá P2P USDT/VNĐ';
  const createdAt = trade.created_at || trade.createdAt;
  const tradeId = String(trade.id || trade.trade_id || 'Giao dịch demo');
  const walletImpact = isBuy ? -(amountVnd + feeVnd) : amountVnd - feeVnd;
  const statusRaw = String(trade.status || 'filled').toLowerCase();
  const statusLabel = ['failed', 'cancelled', 'canceled'].includes(statusRaw) ? 'Không thành công' : statusRaw === 'pending' ? 'Đang xử lý' : 'Đã khớp';
  const statusClass = statusLabel === 'Đã khớp' ? 'success' : statusLabel === 'Đang xử lý' ? 'pending' : 'failed';
  const shortId = tradeId.length > 24 ? `${tradeId.slice(0, 10)}…${tradeId.slice(-8)}` : tradeId;

  const modal = document.createElement('div');
  modal.id = 'tradeDetailModal';
  modal.className = 'trade-detail-modal';
  modal.innerHTML = `
    <div class="trade-detail-backdrop" data-close-trade-detail></div>
    <section class="trade-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="tradeDetailTitle">
      <header class="trade-detail-header ${isBuy ? 'buy' : 'sell'}">
        <div class="trade-detail-title-wrap">
          <span class="trade-detail-icon" aria-hidden="true">${isBuy ? '↗' : '↘'}</span>
          <div>
            <span class="eyebrow">Chi tiết giao dịch BTC demo</span>
            <h2 id="tradeDetailTitle">${isBuy ? 'Lệnh mua BTC' : 'Lệnh bán BTC'}</h2>
            <p>${createdAt ? formatVNTime(createdAt) : 'Không có thời gian giao dịch'}</p>
          </div>
        </div>
        <button type="button" class="trade-detail-close" data-close-trade-detail aria-label="Đóng chi tiết giao dịch">×</button>
      </header>

      <div class="trade-detail-body">
        <div class="trade-detail-status-line">
          <span class="trade-detail-status ${statusClass}">${escapeHTML(statusLabel)}</span>
          <span>Nguồn giá: <b>${escapeHTML(sourceLabel)}</b></span>
        </div>

        <div class="trade-detail-hero-value">
          <span>${isBuy ? 'Tổng tiền đã dùng' : 'Tổng tiền nhận về'}</span>
          <strong>${formatVND(amountVnd)}</strong>
          <small>${isBuy ? 'Ví demo bị trừ tiền để nhận BTC mô phỏng.' : 'Ví demo được cộng tiền sau khi bán BTC mô phỏng.'}</small>
        </div>

        <div class="trade-detail-grid">
          <div><span>Khối lượng BTC</span><strong>${formatNumber(amountBtc, 8)} BTC</strong></div>
          <div><span>Giá khớp mỗi BTC</span><strong>${appliedPrice ? formatVND(appliedPrice) : '—'}</strong></div>
          <div><span>Giá trị giao dịch</span><strong>${formatVND(amountVnd)}</strong></div>
          <div><span>Phí giao dịch demo</span><strong>${formatVND(feeVnd)}</strong></div>
          <div><span>Biến động ví</span><strong class="${walletImpact >= 0 ? 'positive' : 'negative'}">${walletImpact >= 0 ? '+' : '−'}${formatVND(Math.abs(walletImpact))}</strong></div>
          <div><span>Loại lệnh</span><strong>${isBuy ? 'Mua theo giá hiện tại' : 'Bán theo giá hiện tại'}</strong></div>
        </div>

        <div class="trade-detail-note ${isBuy ? 'buy' : 'sell'}">
          <strong>${isBuy ? 'Kết quả mua' : 'Kết quả bán'}</strong>
          <p>${isBuy
            ? `Bạn đã dùng ${formatVND(amountVnd)} để mua ${formatNumber(amountBtc, 8)} BTC theo ${escapeHTML(sourceLabel.toLowerCase())}.`
            : `Bạn đã bán ${formatNumber(amountBtc, 8)} BTC và nhận ${formatVND(amountVnd)} vào ví demo theo ${escapeHTML(sourceLabel.toLowerCase())}.`}</p>
        </div>

        <div class="trade-detail-meta">
          <div><span>Mã giao dịch</span><code title="${escapeHTML(tradeId)}">${escapeHTML(shortId)}</code></div>
          <div><span>Thời gian ghi nhận</span><b>${createdAt ? formatVNTime(createdAt) : '—'}</b></div>
        </div>
      </div>

      <footer class="trade-detail-footer">
        <span>Đây là giao dịch mô phỏng phục vụ học tập, không phát sinh tiền thật.</span>
        <button type="button" class="btn primary" data-close-trade-detail>Đóng</button>
      </footer>
    </section>
  `;

  const closeModal = () => {
    document.removeEventListener('keydown', handleEscape);
    document.body.classList.remove('trade-detail-open');
    modal.classList.remove('open');
    window.setTimeout(() => modal.remove(), 180);
  };
  const handleEscape = event => {
    if (event.key === 'Escape') closeModal();
  };

  modal.querySelectorAll('[data-close-trade-detail]').forEach(el => el.addEventListener('click', closeModal));
  document.body.appendChild(modal);
  document.body.classList.add('trade-detail-open');
  document.addEventListener('keydown', handleEscape);
  requestAnimationFrame(() => {
    modal.classList.add('open');
    modal.querySelector('.trade-detail-close')?.focus({ preventScroll: true });
  });
}

function loadOrders() { return []; }
function saveOrders() { }
function renderOrderHistory() { renderAccountTradePreview(); }

function drawTradeTerminalChart(id, data) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return;
  const chart = echarts.init(el);
  charts.push(chart);

  const rows = Array.isArray(data) ? data : [];
  const labels = rows.map(d => formatVNTime(d.timestamp, 'short'));
  const candle = rows.map(d => [d.open, d.close, d.low, d.high]);
  const volume = rows.map(d => d.volume ?? null);
  const macdBar = rows.map(d => d.macd_hist ?? null);
  const diffLine = rows.map(d => d.macd ?? null);
  const deaLine = rows.map(d => d.macd_signal ?? null);

  chart.setOption({
    animation: false,
    legend: {
      top: 8,
      data: ['OHLC', 'EMA20', 'EMA50', 'EMA200', 'BB Upper', 'BB Lower', 'Volume', 'RSI', 'MACD Hist', 'DIFF', 'DEA']
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      valueFormatter: value => {
        if (!isNum(value)) return '—';
        if (Math.abs(value) >= 1_000_000) return formatVND(value);
        return formatNumber(value, 2);
      }
    },
    grid: [
      { left: 58, right: 28, top: 54, height: 280 },
      { left: 58, right: 28, top: 350, height: 70 },
      { left: 58, right: 28, top: 436, height: 88 },
      { left: 58, right: 28, top: 540, height: 88 }
    ],
    xAxis: [
      { type: 'category', data: labels, scale: true, boundaryGap: false, axisLine: { onZero: false } },
      { type: 'category', gridIndex: 1, data: labels, scale: true, boundaryGap: false, axisLine: { onZero: false }, axisLabel: { show: false } },
      { type: 'category', gridIndex: 2, data: labels, scale: true, boundaryGap: false, axisLine: { onZero: false }, axisLabel: { show: false } },
      { type: 'category', gridIndex: 3, data: labels, scale: true, boundaryGap: false, axisLine: { onZero: false } }
    ],
    yAxis: [
      { scale: true, name: 'USD', splitArea: { show: false } },
      { gridIndex: 1, scale: true, name: 'Vol' },
      { gridIndex: 2, min: 0, max: 100, name: 'RSI' },
      { gridIndex: 3, scale: true, name: 'MACD' }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: 45, end: 100 },
      { show: true, xAxisIndex: [0, 1, 2, 3], type: 'slider', bottom: 6, start: 45, end: 100 }
    ],
    series: [
      { name: 'OHLC', type: 'candlestick', data: candle },
      { name: 'EMA20', type: 'line', showSymbol: false, smooth: true, data: rows.map(d => d.ema_20 ?? null) },
      { name: 'EMA50', type: 'line', showSymbol: false, smooth: true, data: rows.map(d => d.ema_50 ?? null) },
      { name: 'EMA200', type: 'line', showSymbol: false, smooth: true, data: rows.map(d => d.ema_200 ?? null) },
      { name: 'BB Upper', type: 'line', showSymbol: false, smooth: true, data: rows.map(d => d.bb_upper ?? null), lineStyle: { type: 'dashed' } },
      { name: 'BB Lower', type: 'line', showSymbol: false, smooth: true, data: rows.map(d => d.bb_lower ?? null), lineStyle: { type: 'dashed' } },
      { name: 'Volume', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volume },
      { name: 'RSI', type: 'line', xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, data: rows.map(d => d.rsi_14 ?? null), markLine: { symbol: 'none', data: [{ yAxis: 30 }, { yAxis: 70 }] } },
      { name: 'MACD Hist', type: 'bar', xAxisIndex: 3, yAxisIndex: 3, data: macdBar },
      { name: 'DIFF', type: 'line', xAxisIndex: 3, yAxisIndex: 3, showSymbol: false, data: diffLine },
      { name: 'DEA', type: 'line', xAxisIndex: 3, yAxisIndex: 3, showSymbol: false, data: deaLine }
    ]
  });
}
function drawLineChart(id, data, field, name) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return;
  const chart = echarts.init(el);
  charts.push(chart);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 24, right: 24, top: 24, bottom: 28, containLabel: true },
    xAxis: { type: 'category', data: data.map(d => formatVNTime(d.timestamp, 'short')), axisLabel: { color: '#64748b' } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: '#64748b' } },
    series: [{ name, type: 'line', smooth: true, showSymbol: false, data: data.map(d => d[field]) }]
  });
}

function hourKey(value) {
  const date = parseTs(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 13);
}

function buildP2PBtcSeries(ohlcvRows = [], p2pRows = []) {
  const rows = Array.isArray(p2pRows) ? p2pRows : [];
  const byTypeHour = new Map();

  rows.forEach(row => {
    const type = String(row.trade_type || '').toUpperCase();
    const key = hourKey(row.timestamp);
    if (!type || !key || !isNum(row.p2p_price)) return;
    byTypeHour.set(`${type}:${key}`, row);
  });

  const compute = (ohlcv, type) => {
    const row = byTypeHour.get(`${type}:${hourKey(ohlcv.timestamp)}`);
    if (!row || !isNum(ohlcv.close) || !isNum(row.p2p_price)) return null;
    return Math.round(ohlcv.close * row.p2p_price);
  };

  return {
    sell: ohlcvRows.map(row => compute(row, 'SELL')),
    buy: ohlcvRows.map(row => compute(row, 'BUY'))
  };
}

function drawTechnicalChart(id, data, p2pRows = []) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return;
  const chart = echarts.init(el);
  charts.push(chart);
  const labels = data.map(d => formatVNTime(d.timestamp, 'short'));
  const candle = data.map(d => [d.open, d.close, d.low, d.high]);
  const p2pBtc = buildP2PBtcSeries(data, p2pRows);
  const hasP2PLine = p2pBtc.sell.some(isNum) || p2pBtc.buy.some(isNum);
  const p2pLegend = hasP2PLine ? ['BTC P2P bán (VNĐ)', 'BTC P2P mua (VNĐ)'] : [];

  chart.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      valueFormatter: value => {
        if (!isNum(value)) return '—';
        return value > 1_000_000 ? formatVND(value) : formatNumber(value, 2);
      }
    },
    legend: { top: 8, data: ['OHLC', 'EMA20', 'EMA50', 'EMA200', ...p2pLegend, 'RSI'] },
    grid: [
      { left: 54, right: hasP2PLine ? 96 : 42, top: 58, height: 250 },
      { left: 54, right: hasP2PLine ? 96 : 42, top: 350, height: 90 }
    ],
    xAxis: [{ type: 'category', data: labels }, { type: 'category', data: labels, gridIndex: 1 }],
    yAxis: [
      { scale: true, name: 'USD', axisLabel: { formatter: value => formatNumber(value, 0) } },
      { gridIndex: 1, min: 0, max: 100 },
      { scale: true, name: 'BTC/VNĐ P2P', position: 'right', axisLabel: { formatter: value => `${Math.round(value / 1_000_000)}tr` } }
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], bottom: 10 }],
    series: [
      { name: 'OHLC', type: 'candlestick', data: candle },
      { name: 'EMA20', type: 'line', smooth: true, showSymbol: false, data: data.map(d => d.ema_20 ?? null) },
      { name: 'EMA50', type: 'line', smooth: true, showSymbol: false, data: data.map(d => d.ema_50 ?? null) },
      { name: 'EMA200', type: 'line', smooth: true, showSymbol: false, data: data.map(d => d.ema_200 ?? null) },
      ...(hasP2PLine ? [
        { name: 'BTC P2P bán (VNĐ)', type: 'line', yAxisIndex: 2, smooth: true, showSymbol: false, data: p2pBtc.sell, lineStyle: { width: 2, type: 'dashed' } },
        { name: 'BTC P2P mua (VNĐ)', type: 'line', yAxisIndex: 2, smooth: true, showSymbol: false, data: p2pBtc.buy, lineStyle: { width: 2, type: 'dotted' } }
      ] : []),
      { name: 'RSI', type: 'line', xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, data: data.map(d => d.rsi_14 ?? null), markLine: { symbol: 'none', data: [{ yAxis: 30 }, { yAxis: 70 }] } }
    ]
  });
}


function drawAdvancedTechnicalChart(id, data, p2pRows = [], snapshot = {}) {
  const el = document.getElementById(id);
  if (!el || !window.echarts || !data.length) return null;

  const chart = echarts.init(el);
  charts.push(chart);
  const dark = document.body.dataset.theme === 'dark' || document.documentElement.dataset.theme === 'dark';
  const axisColor = dark ? '#94a3b8' : '#64748b';
  const splitColor = dark ? 'rgba(148,163,184,.13)' : 'rgba(148,163,184,.18)';
  const tooltipBg = dark ? 'rgba(8,15,28,.96)' : 'rgba(255,255,255,.98)';
  const tooltipText = dark ? '#f8fafc' : '#0f172a';
  const labels = data.map(row => formatVNTime(row.timestamp, 'short'));
  const n = value => technicalNumber(value);
  const candle = data.map(row => [n(row.open), n(row.close), n(row.low), n(row.high)]);
  const volume = data.map(row => ({
    value: n(row.volume, 0),
    itemStyle: { color: n(row.close, 0) >= n(row.open, 0) ? 'rgba(16,185,129,.58)' : 'rgba(239,68,68,.55)' }
  }));
  const macdHistogram = data.map(row => {
    const value = n(row.macd_hist, 0);
    return { value, itemStyle: { color: value >= 0 ? 'rgba(16,185,129,.75)' : 'rgba(239,68,68,.72)' } };
  });

  const p2pByHour = new Map();
  (Array.isArray(p2pRows) ? p2pRows : []).forEach(row => {
    const type = String(row.trade_type || '').toUpperCase();
    const key = hourKey(row.timestamp);
    const rate = n(row.p2p_price);
    if (type && key && Number.isFinite(rate)) p2pByHour.set(`${type}:${key}`, rate);
  });
  const p2pSeries = type => data.map(row => {
    const rate = p2pByHour.get(`${type}:${hourKey(row.timestamp)}`);
    const close = n(row.close);
    return Number.isFinite(rate) && Number.isFinite(close) ? Math.round(rate * close) : null;
  });
  const p2pBuy = p2pSeries('BUY');
  const p2pSell = p2pSeries('SELL');
  const hasP2P = p2pBuy.some(Number.isFinite) || p2pSell.some(Number.isFinite);

  const selected = {
    'BTC P2P mua': false,
    'BTC P2P bán': false
  };

  chart.setOption({
    animation: false,
    color: ['#f7931a', '#38bdf8', '#8b5cf6', '#94a3b8', '#10b981', '#ef4444'],
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter, sans-serif', color: axisColor },
    axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: dark ? '#334155' : '#475569' } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', snap: true },
      backgroundColor: tooltipBg,
      borderColor: dark ? 'rgba(148,163,184,.28)' : '#e2e8f0',
      borderWidth: 1,
      textStyle: { color: tooltipText, fontSize: 12 },
      padding: [12, 14],
      extraCssText: 'border-radius:12px;box-shadow:0 18px 42px rgba(15,23,42,.18);'
    },
    legend: {
      type: 'scroll',
      top: 8,
      left: 10,
      right: 10,
      itemWidth: 18,
      itemHeight: 8,
      textStyle: { color: axisColor, fontSize: 11 },
      selected,
      data: [
        'BTC/USDT', 'EMA20', 'EMA50', 'EMA200', 'BB Upper', 'BB Mid', 'BB Lower',
        ...(hasP2P ? ['BTC P2P mua', 'BTC P2P bán'] : []),
        'Khối lượng', 'RSI 14', 'Stoch K', 'Stoch D', 'MACD Hist', 'MACD', 'Signal'
      ]
    },
    grid: [
      { left: 66, right: hasP2P ? 84 : 28, top: 66, height: '42%' },
      { left: 66, right: hasP2P ? 84 : 28, top: '54%', height: '10%' },
      { left: 66, right: hasP2P ? 84 : 28, top: '68%', height: '12%' },
      { left: 66, right: hasP2P ? 84 : 28, top: '84%', height: '10%' }
    ],
    xAxis: [0, 1, 2, 3].map((gridIndex, index) => ({
      type: 'category',
      gridIndex,
      data: labels,
      boundaryGap: true,
      axisLine: { lineStyle: { color: splitColor } },
      axisTick: { show: false },
      axisLabel: { show: index === 3, color: axisColor, fontSize: 10, hideOverlap: true },
      splitLine: { show: false },
      min: 'dataMin',
      max: 'dataMax'
    })),
    yAxis: [
      {
        type: 'value', scale: true, position: 'left', name: 'USD', nameTextStyle: { color: axisColor, padding: [0, 0, 0, -18] },
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: axisColor, formatter: value => `$${formatNumber(value, 0)}` },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' } }
      },
      {
        type: 'value', scale: true, position: 'right', name: 'P2P VNĐ', show: hasP2P,
        nameTextStyle: { color: axisColor }, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axisColor, formatter: value => `${formatNumber(value / 1_000_000, 0)}tr` }, splitLine: { show: false }
      },
      {
        type: 'value', gridIndex: 1, scale: true, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 10, formatter: value => formatNumber(value, 0) },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' } }
      },
      {
        type: 'value', gridIndex: 2, min: 0, max: 100, interval: 20, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 10 }, splitLine: { lineStyle: { color: splitColor, type: 'dashed' } }
      },
      {
        type: 'value', gridIndex: 3, scale: true, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 10, formatter: value => formatNumber(value, 0) },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' } }
      }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
      {
        type: 'slider', xAxisIndex: [0, 1, 2, 3], bottom: 0, height: 20,
        borderColor: 'transparent', backgroundColor: dark ? 'rgba(15,23,42,.65)' : '#f1f5f9',
        fillerColor: dark ? 'rgba(247,147,26,.22)' : 'rgba(247,147,26,.18)',
        handleStyle: { color: '#f7931a', borderColor: '#f7931a' },
        textStyle: { color: axisColor, fontSize: 10 }, showDetail: false
      }
    ],
    series: [
      {
        name: 'BTC/USDT', type: 'candlestick', data: candle, barMaxWidth: 11,
        itemStyle: { color: '#10b981', color0: '#ef4444', borderColor: '#10b981', borderColor0: '#ef4444' },
        markLine: {
          silent: true, symbol: ['none', 'none'], label: { fontSize: 10, formatter: '{b}' },
          data: [
            { name: `Kháng cự ${formatUSD(snapshot.resistance, 0)}`, yAxis: snapshot.resistance, lineStyle: { color: '#ef4444', type: 'dashed', opacity: .62 }, label: { color: '#ef4444', position: 'insideEndTop' } },
            { name: `Hỗ trợ ${formatUSD(snapshot.support, 0)}`, yAxis: snapshot.support, lineStyle: { color: '#10b981', type: 'dashed', opacity: .62 }, label: { color: '#10b981', position: 'insideEndBottom' } }
          ]
        }
      },
      { name: 'EMA20', type: 'line', data: data.map(row => n(row.ema_20)), smooth: true, showSymbol: false, lineStyle: { width: 1.8, color: '#f59e0b' }, emphasis: { focus: 'series' } },
      { name: 'EMA50', type: 'line', data: data.map(row => n(row.ema_50)), smooth: true, showSymbol: false, lineStyle: { width: 1.7, color: '#38bdf8' }, emphasis: { focus: 'series' } },
      { name: 'EMA200', type: 'line', data: data.map(row => n(row.ema_200)), smooth: true, showSymbol: false, lineStyle: { width: 1.6, color: '#8b5cf6' }, emphasis: { focus: 'series' } },
      { name: 'BB Upper', type: 'line', data: data.map(row => n(row.bb_upper)), showSymbol: false, lineStyle: { width: 1, color: '#94a3b8', type: 'dashed', opacity: .75 }, symbol: 'none' },
      { name: 'BB Mid', type: 'line', data: data.map(row => n(row.bb_mid)), showSymbol: false, lineStyle: { width: 1, color: '#64748b', type: 'dotted', opacity: .55 }, symbol: 'none' },
      { name: 'BB Lower', type: 'line', data: data.map(row => n(row.bb_lower)), showSymbol: false, lineStyle: { width: 1, color: '#94a3b8', type: 'dashed', opacity: .75 }, symbol: 'none' },
      ...(hasP2P ? [
        { name: 'BTC P2P mua', type: 'line', yAxisIndex: 1, data: p2pBuy, showSymbol: false, smooth: true, lineStyle: { width: 1.5, color: '#22c55e', type: 'dashed' } },
        { name: 'BTC P2P bán', type: 'line', yAxisIndex: 1, data: p2pSell, showSymbol: false, smooth: true, lineStyle: { width: 1.5, color: '#f97316', type: 'dashed' } }
      ] : []),
      { name: 'Khối lượng', type: 'bar', xAxisIndex: 1, yAxisIndex: 2, data: volume, barMaxWidth: 9, emphasis: { disabled: true } },
      {
        name: 'RSI 14', type: 'line', xAxisIndex: 2, yAxisIndex: 3, data: data.map(row => n(row.rsi_14)), showSymbol: false,
        lineStyle: { width: 1.8, color: '#f7931a' },
        markLine: { silent: true, symbol: 'none', label: { show: false }, data: [
          { yAxis: 30, lineStyle: { color: '#38bdf8', type: 'dashed', opacity: .55 } },
          { yAxis: 50, lineStyle: { color: '#64748b', type: 'dotted', opacity: .38 } },
          { yAxis: 70, lineStyle: { color: '#ef4444', type: 'dashed', opacity: .55 } }
        ] }
      },
      { name: 'Stoch K', type: 'line', xAxisIndex: 2, yAxisIndex: 3, data: data.map(row => n(row.stoch_k)), showSymbol: false, lineStyle: { width: 1.2, color: '#38bdf8', opacity: .88 } },
      { name: 'Stoch D', type: 'line', xAxisIndex: 2, yAxisIndex: 3, data: data.map(row => n(row.stoch_d)), showSymbol: false, lineStyle: { width: 1.2, color: '#8b5cf6', opacity: .88 } },
      { name: 'MACD Hist', type: 'bar', xAxisIndex: 3, yAxisIndex: 4, data: macdHistogram, barMaxWidth: 8 },
      { name: 'MACD', type: 'line', xAxisIndex: 3, yAxisIndex: 4, data: data.map(row => n(row.macd)), showSymbol: false, lineStyle: { width: 1.5, color: '#38bdf8' } },
      { name: 'Signal', type: 'line', xAxisIndex: 3, yAxisIndex: 4, data: data.map(row => n(row.macd_signal)), showSymbol: false, lineStyle: { width: 1.4, color: '#f59e0b' } }
    ]
  }, true);

  return chart;
}

function drawP2PChart(id, rows) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return;
  const data = [...rows].reverse();
  const sell = data.filter(x => x.trade_type === 'SELL');
  const buy = data.filter(x => x.trade_type === 'BUY');
  const labels = [...new Set(data.map(d => formatVNTime(d.timestamp, 'short')))];
  const byLabel = (arr) => {
    const map = new Map(arr.map(r => [formatVNTime(r.timestamp, 'short'), r.spread_pct]));
    return labels.map(l => map.get(l) ?? null);
  };
  const chart = echarts.init(el);
  charts.push(chart);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { top: 8, data: ['Spread khi BÁN', 'Spread khi MUA'] },
    grid: { left: 44, right: 28, top: 52, bottom: 34, containLabel: true },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [
      { name: 'Spread khi BÁN', type: 'line', smooth: true, showSymbol: false, data: byLabel(sell), markLine: { symbol: 'none', data: [{ yAxis: 0 }] } },
      { name: 'Spread khi MUA', type: 'line', smooth: true, showSymbol: false, data: byLabel(buy) }
    ]
  });
}

// ---------------------------------------------------------------------------
// Feature upgrade v1 — Supabase Auth, data trust, settlement, alerts, billing
// ---------------------------------------------------------------------------

async function initAuth() {
  ensureAuthBox();
  renderAuthHeader();

  if (!supabaseAuth) {
    authReady = true;
    renderAuthHeader();
    return;
  }

  try {
    const { data, error } = await supabaseAuth.auth.getSession();
    if (error) console.warn('Supabase getSession error:', error.message);

    currentSession = data?.session || null;
    await syncCurrentUserProfile();
    await loadCurrentUserProfile();
    authReady = true;
    renderAuthHeader();

    redirectAfterLoginIfNeeded();

    supabaseAuth.auth.onAuthStateChange(async (event, session) => {
      currentSession = session || null;
      currentUserProfile = null;
      await syncCurrentUserProfile();
      await loadCurrentUserProfile();
      authReady = true;
      renderAuthHeader();

      if (event === 'SIGNED_IN') {
        if (needsPasswordSetup()) {
          location.hash = '#set-password';
          return;
        }
        redirectAfterLoginIfNeeded();
      }

      if (event === 'SIGNED_OUT' && protectedRoutes.has(activeRoute)) {
        currentUserProfile = null;
        showToast('Bạn đã đăng xuất. Vui lòng đăng nhập để tiếp tục.');
        location.hash = '#login';
      }
    });
  } catch (error) {
    console.error('Không khởi tạo được Supabase Auth:', error);
    authReady = true;
    renderAuthHeader();
  }

  route();
}

function authHeader() {
  return currentSession?.access_token ? { Authorization: `Bearer ${currentSession.access_token}` } : {};
}

async function loadCurrentUserProfile() {
  currentUserProfile = null;
  if (!supabaseAuth || !currentSession?.user?.id) return null;
  try {
    const { data, error } = await supabaseAuth
      .from('user_profiles')
      .select('user_id,email,full_name,role,status,password_set,created_at,last_login_at')
      .eq('user_id', currentSession.user.id)
      .maybeSingle();
    if (error) throw error;
    currentUserProfile = data || null;
  } catch (error) {
    console.warn('Không đọc được user_profiles:', error.message);
    const metadataRole = currentSession.user.app_metadata?.role || currentSession.user.user_metadata?.role;
    currentUserProfile = {
      user_id: currentSession.user.id,
      email: currentSession.user.email,
      role: metadataRole === 'admin' ? 'admin' : 'user',
      status: 'active'
    };
  }

  if (currentUserProfile?.status === 'suspended') {
    showToast('Tài khoản đã bị tạm khóa. Vui lòng liên hệ quản trị viên.');
    await supabaseAuth.auth.signOut();
    currentSession = null;
    currentUserProfile = null;
  }
  return currentUserProfile;
}

function isAdmin() {
  const profileRole = String(currentUserProfile?.role || '').toLowerCase();
  const metadataRole = String(
    currentSession?.user?.app_metadata?.role
    || currentSession?.user?.user_metadata?.role
    || ''
  ).toLowerCase();
  return profileRole === 'admin' || metadataRole === 'admin';
}

function ensureAuthBox() {
  if (document.getElementById('authBox') || document.getElementById('authArea')) return;

  const topActions = document.querySelector('.top-actions');
  if (!topActions) return;

  const authBox = document.createElement('div');
  authBox.id = 'authBox';
  authBox.className = 'auth-box';

  const demoButton = topActions.querySelector('a.btn');
  if (demoButton) {
    topActions.insertBefore(authBox, demoButton);
  } else {
    topActions.appendChild(authBox);
  }
}

function getAuthBox() {
  return document.getElementById('authBox') || document.getElementById('authArea');
}

function setPendingNextRoute(routeName) {
  const safeRoute = routes[routeName] ? routeName : 'dashboard';
  try {
    localStorage.setItem('btc_bigdata_auth_next', safeRoute);
  } catch (_) { }
}

function consumePendingNextRoute() {
  try {
    const saved = localStorage.getItem('btc_bigdata_auth_next');
    localStorage.removeItem('btc_bigdata_auth_next');
    return routes[saved] ? saved : '';
  } catch (_) {
    return '';
  }
}

function getLoginNextRoute() {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const next = params.get('next') || consumePendingNextRoute() || 'dashboard';
  return routes[next] ? next : 'dashboard';
}

function redirectAfterLoginIfNeeded() {
  if (!currentSession) return;

  const currentHashRoute = (location.hash || '').replace('#', '').split('?')[0];
  if (needsPasswordSetup() && currentHashRoute !== 'set-password') {
    location.hash = '#set-password';
    return;
  }

  const pending = currentHashRoute === 'login' ? getLoginNextRoute() : consumePendingNextRoute();

  if (pending && routes[pending] && currentHashRoute !== pending) {
    location.hash = `#${pending}`;
  }
}

function cleanupSupabaseAuthRedirectHash() {
  const hash = window.location.hash || '';
  const isSupabaseAuthHash =
    hash.includes('access_token=') ||
    hash.includes('refresh_token=') ||
    hash.includes('type=magiclink') ||
    hash.includes('error_code=otp_expired') ||
    hash.includes('error=access_denied');

  if (!isSupabaseAuthHash) return;

  let message = 'Đã bỏ qua magic link cũ. Hệ thống hiện dùng mã OTP email nên token sẽ không còn nằm trên URL.';
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const errorCode = params.get('error_code');
    const description = params.get('error_description');
    if (errorCode === 'otp_expired') {
      message = 'Link email cũ đã hết hạn hoặc đã được dùng. Hãy dùng luồng mới: gửi mã OTP và nhập mã trong website.';
    } else if (description) {
      message = decodeURIComponent(description.replace(/\+/g, ' '));
    }
  } catch (_) { }

  window.history.replaceState(
    {},
    document.title,
    `${window.location.origin}${window.location.pathname}#login`
  );

  try {
    sessionStorage.setItem('btc_bigdata_auth_notice', message);
  } catch (_) { }
}

function consumeAuthNotice() {
  try {
    const notice = sessionStorage.getItem('btc_bigdata_auth_notice');
    sessionStorage.removeItem('btc_bigdata_auth_notice');
    return notice || '';
  } catch (_) {
    return '';
  }
}

function renderAuthHeader() {
  ensureAuthBox();
  const el = getAuthBox();
  if (!el) return;

  if (!supabaseAuth) {
    updateAdminNavigation(false);
    el.innerHTML = `<a class="btn small secondary auth-entry" href="#login" title="Cần cấu hình VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY">Tài khoản</a>`;
    return;
  }

  if (!authReady) {
    updateAdminNavigation(false);
    el.innerHTML = `<span class="badge amber">Đang kiểm tra...</span>`;
    return;
  }

  const email = currentSession?.user?.email;
  if (email) {
    const admin = isAdmin();
    updateAdminNavigation(admin);
    const passwordState = needsPasswordSetup() ? '<span class="auth-warn-dot" title="Cần đặt mật khẩu"></span>' : '';
    el.innerHTML = `
      ${admin ? '<a class="admin-console-link" href="#admin" title="Mở Admin Console">ADMIN</a>' : ''}
      <a class="user-email" href="#account" title="${escapeHTML(email)}">${passwordState}${escapeHTML(shortEmail(email))}</a>
      <button id="logoutBtn" class="btn small secondary" type="button">Đăng xuất</button>
    `;
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await supabaseAuth.auth.signOut();
      currentSession = null;
      currentUserProfile = null;
      showToast('Đã đăng xuất.');
      renderAuthHeader();
      if (protectedRoutes.has(activeRoute)) location.hash = '#login';
      else route();
    });
  } else {
    updateAdminNavigation(false);
    el.innerHTML = `<a class="btn small secondary auth-entry" href="#login">Tài khoản</a>`;
  }
}

function updateAdminNavigation(visible) {
  document.querySelectorAll('[data-admin-nav]').forEach(el => {
    el.classList.toggle('hidden', !visible);
    el.setAttribute('aria-hidden', visible ? 'false' : 'true');
  });
}

function shortEmail(email) {
  if (!email || email.length <= 24) return email;
  const [name, domain] = email.split('@');
  return `${name.slice(0, 10)}…@${domain}`;
}


function installAuthUxStyles() {
  if (document.getElementById('authUxStyles')) return;
  const style = document.createElement('style');
  style.id = 'authUxStyles';
  style.textContent = `
    .auth-box, #authArea { display:flex; align-items:center; gap:8px; }
    .auth-entry { border-radius:999px; }
    .user-email { display:inline-flex; align-items:center; gap:6px; max-width:180px; padding:8px 10px; border-radius:999px; background:rgba(15,23,42,.06); color:inherit; text-decoration:none; font-weight:700; font-size:.88rem; }
    .auth-warn-dot { width:8px; height:8px; border-radius:999px; background:#f59e0b; box-shadow:0 0 0 3px rgba(245,158,11,.16); }
    .auth-shell { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(320px,.95fr); gap:22px; align-items:stretch; }
    .auth-shell.single { grid-template-columns:minmax(320px,620px); justify-content:center; }
    .auth-panel { border:1px solid rgba(148,163,184,.22); border-radius:28px; background:rgba(255,255,255,.9); box-shadow:0 20px 70px rgba(15,23,42,.08); padding:28px; }
    .auth-copy { background:linear-gradient(145deg, rgba(15,23,42,.96), rgba(30,41,59,.9)); color:white; overflow:hidden; position:relative; }
    .auth-copy .lead, .auth-copy p { color:rgba(255,255,255,.78); }
    .auth-steps { display:grid; gap:12px; margin-top:24px; }
    .auth-steps div { display:flex; align-items:center; gap:12px; padding:12px; border-radius:18px; background:rgba(255,255,255,.08); }
    .auth-steps b { width:30px; height:30px; display:grid; place-items:center; border-radius:999px; background:#f59e0b; color:#111827; }
    .auth-form-card h2, .auth-form-card h1 { margin-top:10px; }
    .auth-tabs { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:6px; background:#f1f5f9; border-radius:16px; margin-bottom:18px; }
    .auth-tabs button { border:0; padding:10px 12px; border-radius:12px; background:transparent; font-weight:800; cursor:pointer; color:#64748b; }
    .auth-tabs button.active { background:white; color:#0f172a; box-shadow:0 6px 22px rgba(15,23,42,.08); }
    .auth-mode-panel.hidden, .hidden { display:none !important; }
    .auth-actions-row { display:flex; flex-wrap:wrap; gap:10px; margin-top:14px; }
    .otp-box { margin-top:14px; padding:14px; border-radius:18px; border:1px solid rgba(37,99,235,.18); background:rgba(59,130,246,.06); }
    .otp-box input { letter-spacing:.28em; font-weight:900; text-align:center; font-size:1.1rem; }
    .password-hint, .muted { color:#64748b; font-size:.92rem; }
    .side-nav { width:var(--sidebar); }
    .side-nav [data-route] { border-radius:13px; }
    .side-nav small:not(.side-head-copy small), .side-nav .nav-desc, .side-nav p { display:none !important; }
    .side-nav a { min-height:38px; }

    /* Thanh điều hướng đã được gom nhóm; chế độ compact chỉ giữ biểu tượng và mở nhóm bằng flyout. */
    body.ux-sidebar-compact { --sidebar: 74px; }
    body.ux-sidebar-compact .side-nav { width:74px; padding:10px 8px; overflow-y:visible; }
    body.ux-sidebar-compact .side-head { display:grid; grid-template-columns:1fr; margin:2px 0 8px; padding:8px; }
    body.ux-sidebar-compact .side-head-mark { margin:0 auto !important; }
    body.ux-sidebar-compact .side-head-copy,
    body.ux-sidebar-compact .side-route-text,
    body.ux-sidebar-compact .side-group-title,
    body.ux-sidebar-compact .side-group-chevron { display:none !important; }
    body.ux-sidebar-compact .side-nav > a,
    body.ux-sidebar-compact .side-group > summary { justify-content:center; gap:0; min-height:42px; margin:4px 0; padding:8px; }
    body.ux-sidebar-compact .side-nav > a > span:first-child,
    body.ux-sidebar-compact .side-group-icon { flex-basis:28px; width:28px; height:28px; }
    body.ux-sidebar-compact .side-group-links {
      position:absolute;
      top:0;
      left:58px;
      z-index:140;
      width:220px;
      margin:0;
      padding:8px;
      border:1px solid var(--border);
      border-radius:15px;
      background:var(--card);
      box-shadow:0 20px 60px rgba(15,23,42,.18);
    }
    body.ux-sidebar-compact .side-group-links a { justify-content:flex-start; min-height:38px; font-size:.82rem; }
    body.ux-sidebar-compact .side-nav > a:hover::after {
      content:attr(title);
      position:absolute;
      left:58px;
      z-index:140;
      padding:8px 10px;
      border-radius:11px;
      white-space:nowrap;
      background:#0f172a;
      color:#fff;
      font-size:.78rem;
      font-weight:800;
      box-shadow:0 14px 42px rgba(15,23,42,.22);
    }
    .sidebar-collapse-toggle { width:100%; border:1px solid var(--border); border-radius:12px; background:#fff; color:var(--muted-2); min-height:32px; font-weight:850; margin:0 0 8px; font-size:.78rem; }
    body.ux-sidebar-compact .sidebar-collapse-toggle { height:34px; font-size:0; padding:0; }
    body.ux-sidebar-compact .sidebar-collapse-toggle::before { content:'☰'; font-size:1rem; }
    body:not(.ux-sidebar-compact) .sidebar-collapse-toggle::before { content:'Thu gọn '; }
    body:not(.ux-sidebar-compact) .sidebar-collapse-toggle::after { content:'←'; }
    @media (max-height:720px) {
      .side-head { display:none; }
      .side-nav { padding-top:8px; }
      .side-group summary, .side-nav > a { min-height:36px; }
      .side-group-links a { min-height:32px; }
    }

    /* Floating AI Messenger */
    .floating-ai-button { position:fixed; right:22px; bottom:22px; z-index:95; width:58px; height:58px; border:0; border-radius:999px; background:linear-gradient(135deg,#2563eb,#7c3aed); color:#fff; box-shadow:0 22px 55px rgba(37,99,235,.35); display:grid; place-items:center; font-size:1.35rem; }
    .floating-ai-button .unread-dot { position:absolute; top:8px; right:8px; width:10px; height:10px; border-radius:999px; background:#f59e0b; box-shadow:0 0 0 4px rgba(245,158,11,.22); }
    .floating-ai-panel { position:fixed; right:22px; bottom:92px; z-index:96; width:min(390px, calc(100vw - 28px)); max-height:min(560px, calc(100vh - 120px)); display:none; grid-template-rows:auto minmax(180px,1fr) auto; overflow:hidden; border:1px solid rgba(148,163,184,.28); border-radius:24px; background:rgba(255,255,255,.98); box-shadow:0 30px 90px rgba(15,23,42,.22); backdrop-filter:blur(16px); }
    .floating-ai-panel.open { display:grid; }
    .floating-ai-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; background:linear-gradient(135deg,#0f172a,#1e293b); color:#fff; cursor:grab; user-select:none; touch-action:none; }
    .floating-ai-panel.dragging .floating-ai-head { cursor:grabbing; }
    .floating-ai-controls { display:flex; align-items:center; gap:6px; }
    .floating-ai-hint { display:block; color:rgba(255,255,255,.55); font-size:.68rem; font-weight:700; margin-top:2px; }
    .floating-ai-title { display:flex; align-items:center; gap:10px; }
    .floating-ai-avatar { width:38px; height:38px; display:grid; place-items:center; border-radius:16px; background:#f7931a; }
    .floating-ai-title strong { display:block; }
    .floating-ai-title small { display:block; color:rgba(255,255,255,.72); margin-top:1px; }
    .floating-ai-close, .floating-ai-reset { border:0; background:rgba(255,255,255,.12); color:#fff; width:34px; height:34px; border-radius:12px; font-weight:900; }
    .floating-ai-messages { overflow-y:auto; padding:14px; display:grid; gap:10px; background:linear-gradient(180deg,#f8fafc,#eef2ff); }
    .floating-ai-msg { max-width:86%; padding:10px 12px; border-radius:18px; white-space:pre-wrap; line-height:1.45; font-size:.92rem; box-shadow:0 8px 22px rgba(15,23,42,.06); }
    .floating-ai-msg.ai { justify-self:start; background:#fff; color:#0f172a; border-bottom-left-radius:6px; }
    .floating-ai-msg.user { justify-self:end; background:#2563eb; color:#fff; border-bottom-right-radius:6px; }
    .floating-ai-quick { display:flex; gap:8px; padding:0 14px 10px; overflow-x:auto; background:#eef2ff; }
    .floating-ai-quick button { border:1px solid rgba(37,99,235,.18); background:#fff; color:#1d4ed8; border-radius:999px; padding:7px 10px; font-size:.78rem; font-weight:800; white-space:nowrap; }
    .floating-ai-input { display:flex; gap:8px; padding:12px; border-top:1px solid rgba(226,232,240,.9); background:#fff; }
    .floating-ai-input input { flex:1; border:1px solid var(--border); border-radius:16px; padding:11px 12px; outline:none; }
    .floating-ai-input button { border:0; border-radius:16px; padding:0 14px; background:#2563eb; color:#fff; font-weight:900; }
    body.floating-ai-open .floating-ai-button { transform:scale(.92); }
    .toast { bottom:92px; }
    @media (max-width:720px) {
      .floating-ai-panel { right:10px; bottom:80px; width:calc(100vw - 20px); border-radius:22px; }
      .floating-ai-button { right:16px; bottom:16px; }
      body.ux-sidebar-compact { --sidebar:0px; }
      body.ux-sidebar-compact .side-nav { width:min(244px, 82vw); padding:14px 12px; overflow-y:auto; }
      body.ux-sidebar-compact .side-head { display:grid; grid-template-columns:38px minmax(0,1fr); }
      body.ux-sidebar-compact .side-head-copy,
      body.ux-sidebar-compact .side-route-text,
      body.ux-sidebar-compact .side-group-title,
      body.ux-sidebar-compact .side-group-chevron { display:block !important; }
      body.ux-sidebar-compact .side-group-chevron { margin-left:auto; }
      body.ux-sidebar-compact .side-nav > a,
      body.ux-sidebar-compact .side-group > summary { justify-content:flex-start; gap:10px; padding:9px 10px; }
      body.ux-sidebar-compact .side-group-links { position:static; width:auto; margin:2px 0 7px 20px; padding:3px 0 3px 9px; box-shadow:none; border-width:0 0 0 1px; border-radius:0; background:transparent; }
      body.ux-sidebar-compact .sidebar-collapse-toggle { display:none; }
    }

    @media (max-width:900px) { .auth-shell { grid-template-columns:1fr; } .auth-copy { min-height:auto; } }
  `;
  document.head.appendChild(style);
}



function installBitcoinAmbient() {
  if (document.getElementById('btcAmbientLayer')) return;
  const layer = document.createElement('div');
  layer.id = 'btcAmbientLayer';
  layer.className = 'btc-ambient-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<span>₿</span><span>₿</span><span>₿</span><span>₿</span>';
  document.body.appendChild(layer);
}

function isLiveNewsHidden() {
  return localStorage.getItem(LIVE_NEWS_HIDDEN_KEY) === '1';
}

function hideLiveNewsTicker() {
  localStorage.setItem(LIVE_NEWS_HIDDEN_KEY, '1');
  document.getElementById('liveNewsTicker')?.remove();
  document.body.classList.remove('has-live-news');
  installNewsRestoreButton();
  showToast('Đã ẩn thanh BTC News. Bạn có thể bật lại bằng nút “Hiện BTC News”.');
}

function showLiveNewsTicker() {
  localStorage.removeItem(LIVE_NEWS_HIDDEN_KEY);
  document.getElementById('liveNewsRestore')?.remove();
  document.getElementById('liveNewsTicker')?.remove();
  liveNewsTickerBusy = false;
  installLiveNewsTicker();
  document.body.classList.add('has-live-news');
  setTimeout(refreshLiveNewsTicker, 80);
  showToast('Đã bật lại thanh BTC News.');
}

function installNewsRestoreButton() {
  if (!isLiveNewsHidden() || document.getElementById('liveNewsRestore')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <button id="liveNewsRestore" class="live-news-restore" type="button" title="Hiện lại thanh tin tức BTC">₿ Hiện BTC News</button>
  `);
  document.getElementById('liveNewsRestore')?.addEventListener('click', showLiveNewsTicker);
}

function installLiveNewsTicker() {
  if (isLiveNewsHidden()) {
    document.body.classList.remove('has-live-news');
    installNewsRestoreButton();
    return;
  }
  if (document.getElementById('liveNewsTicker')) {
    document.body.classList.add('has-live-news');
    return;
  }
  document.getElementById('liveNewsRestore')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <aside id="liveNewsTicker" class="live-news-ticker" aria-label="Tin tức Bitcoin chạy">
      <button class="live-news-label" type="button" title="Mở trang tin tức">BTC News</button>
      <div class="live-news-track"><div id="liveNewsTrackInner" class="live-news-track-inner">Đang tải tin tức thị trường...</div></div>
      <button id="liveNewsPause" class="live-news-pause" type="button" aria-pressed="false" title="Tạm dừng/chạy ticker">Ⅱ</button>
      <button id="liveNewsHide" class="live-news-hide" type="button" title="Ẩn thanh tin tức BTC">×</button>
    </aside>
  `);
  document.body.classList.add('has-live-news');
  document.querySelector('.live-news-label')?.addEventListener('click', () => { location.hash = '#news'; });
  document.getElementById('liveNewsTicker')?.addEventListener('click', event => {
    if (event.target.closest('.live-news-pause') || event.target.closest('.live-news-label') || event.target.closest('.live-news-hide')) return;
    location.hash = '#news';
  });
  document.getElementById('liveNewsPause')?.addEventListener('click', () => {
    const ticker = document.getElementById('liveNewsTicker');
    const paused = !ticker.classList.contains('paused');
    ticker.classList.toggle('paused', paused);
    const btn = document.getElementById('liveNewsPause');
    btn.setAttribute('aria-pressed', String(paused));
    btn.textContent = paused ? '▶' : 'Ⅱ';
  });
  document.getElementById('liveNewsHide')?.addEventListener('click', hideLiveNewsTicker);
  refreshLiveNewsTicker();
  if (!window.__btcLiveNewsInterval) {
    window.__btcLiveNewsInterval = setInterval(() => {
      if (!document.hidden && !isLiveNewsHidden()) refreshLiveNewsTicker();
    }, 15 * 60_000);
  }
}

async function refreshLiveNewsTicker() {
  const inner = document.getElementById('liveNewsTrackInner');
  if (!inner) return;
  if (getCurrentRouteName() === 'set-password' || passwordSavingInProgress || liveNewsTickerBusy) return;

  liveNewsTickerBusy = true;
  try {
    const res = await fetchJson('/api/news/latest?limit=8', { timeout: 30000 });
    const items = (res.data.data || []).slice(0, 8);
    if (!items.length) throw new Error('Không có tin');
    const html = items.map(item => `<span><b>₿</b> ${escapeHTML(item.title)} <em>${escapeHTML(item.source || '')}</em></span>`).join('');
    inner.innerHTML = `<div class="live-news-segment">${html}</div><div class="live-news-segment" aria-hidden="true">${html}</div>`;
    inner.style.setProperty('--ticker-duration', `${Math.max(38, items.length * 9)}s`);
    document.getElementById('liveNewsTicker')?.classList.toggle('mock', res.source !== 'api' && res.data.source === 'mock');
  } catch (_) {
    const fallback = buildMockNews().data.slice(0, 5);
    const html = fallback.map(item => `<span><b>₿</b> ${escapeHTML(item.title)} <em>Demo</em></span>`).join('');
    inner.innerHTML = `<div class="live-news-segment">${html}</div><div class="live-news-segment" aria-hidden="true">${html}</div>`;
    inner.style.setProperty('--ticker-duration', `${Math.max(42, fallback.length * 10)}s`);
  } finally {
    liveNewsTickerBusy = false;
  }
}

function cookieChoiceKey() {
  return 'btc_bigdata_cookie_consent_v1';
}

function setConsentCookie(value) {
  const maxAge = 60 * 60 * 24 * 180;
  document.cookie = `btc_cookie_consent=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  localStorage.setItem(cookieChoiceKey(), value);
}

function installCookieConsent() {
  if (localStorage.getItem(cookieChoiceKey()) || document.getElementById('cookieConsent')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <section id="cookieConsent" class="cookie-consent" role="dialog" aria-live="polite" aria-label="Thông báo cookie">
      <div class="cookie-icon">🍪</div>
      <div class="cookie-copy">
        <strong>Cookie & local storage</strong>
        <p>Website chỉ dùng lưu trữ cần thiết để nhớ lựa chọn giao diện, trạng thái sidebar, vị trí chat AI và cookie consent. Không dùng cookie quảng cáo trong bản demo môn học.</p>
      </div>
      <div class="cookie-actions">
        <button class="btn secondary small" id="cookieEssential" type="button">Chỉ cần thiết</button>
        <button class="btn primary small" id="cookieAccept" type="button">Đồng ý</button>
      </div>
    </section>
  `);
  const close = value => {
    setConsentCookie(value);
    const el = document.getElementById('cookieConsent');
    el?.classList.add('hide');
    window.setTimeout(() => el?.remove(), 220);
    showToast(value === 'accepted' ? 'Đã lưu lựa chọn cookie.' : 'Chỉ bật lưu trữ cần thiết.');
  };
  document.getElementById('cookieEssential')?.addEventListener('click', () => close('essential'));
  document.getElementById('cookieAccept')?.addEventListener('click', () => close('accepted'));
}

function installCompactNavigation() {
  const nav = document.getElementById('sideNav');
  if (!nav || nav.dataset.compactReady === '1') return;
  nav.dataset.compactReady = '1';

  // Sidebar mới đã được gom nhóm nên mặc định hiển thị đầy đủ; người dùng vẫn có thể thu gọn thành thanh biểu tượng.
  const saved = localStorage.getItem('btc_bigdata_sidebar_compact');
  document.body.classList.toggle('ux-sidebar-compact', saved === '1');

  nav.querySelectorAll('a[data-route]').forEach(link => {
    const text = link.textContent.replace(/\s+/g, ' ').trim();
    if (!link.title) link.title = text;
  });

  nav.querySelectorAll('[data-side-group]').forEach(group => {
    const summary = group.querySelector('summary');
    const title = group.querySelector('.side-group-title')?.textContent?.trim();
    if (summary && title) summary.title = title;
    summary?.addEventListener('click', () => {
      window.setTimeout(() => {
        if (!group.open) return;
        nav.querySelectorAll('[data-side-group]').forEach(other => {
          if (other !== group) other.removeAttribute('open');
        });
      }, 0);
    });
  });

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sidebar-collapse-toggle';
  toggle.title = 'Thu gọn / mở rộng thanh điều hướng';
  toggle.setAttribute('aria-label', 'Thu gọn hoặc mở rộng thanh điều hướng');
  toggle.addEventListener('click', () => {
    const compact = !document.body.classList.contains('ux-sidebar-compact');
    document.body.classList.toggle('ux-sidebar-compact', compact);
    localStorage.setItem('btc_bigdata_sidebar_compact', compact ? '1' : '0');
    nav.querySelectorAll('[data-side-group]').forEach(group => group.removeAttribute('open'));
    if (!compact) {
      const activeGroup = nav.querySelector('[data-side-group].active');
      if (activeGroup) activeGroup.open = true;
    }
    window.setTimeout(() => charts.forEach(chart => chart.resize()), 160);
  });

  const head = nav.querySelector('.side-head');
  if (head?.nextSibling) nav.insertBefore(toggle, head.nextSibling);
  else nav.prepend(toggle);
}

function installFloatingAIChat() {
  if (document.getElementById('floatingAIWidget')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div id="floatingAIWidget" class="floating-ai-widget" aria-live="polite">
      <button id="floatingAIButton" class="floating-ai-button" type="button" aria-label="Mở AI Advisor">
        🤖<span class="unread-dot" aria-hidden="true"></span>
      </button>
      <section id="floatingAIPanel" class="floating-ai-panel" aria-label="AI Advisor chat nhanh">
        <div class="floating-ai-head">
          <div class="floating-ai-title">
            <div class="floating-ai-avatar">₿</div>
            <div><strong>AI Advisor</strong><small>Hỏi nhanh khi đang xem dữ liệu</small><span class="floating-ai-hint">Kéo thanh này để di chuyển</span></div>
          </div>
          <div class="floating-ai-controls"><button id="floatingAIReset" class="floating-ai-reset" type="button" title="Đưa chat về góc phải" aria-label="Đưa chat về góc phải">↺</button><button id="floatingAIClose" class="floating-ai-close" type="button" aria-label="Thu gọn chat">−</button></div>
        </div>
        <div id="floatingAIMessages" class="floating-ai-messages"></div>
        <div class="floating-ai-quick">
          <button type="button" data-floating-question="Giờ nên mua hay bán BTC?">Nên mua/bán?</button>
          <button type="button" data-floating-question="P2P hiện tại có lợi hay thiệt?">P2P lợi/thiệt?</button>
          <button type="button" data-floating-question="Giải thích RSI và MACD hiện tại">RSI/MACD</button>
        </div>
        <form id="floatingAIForm" class="floating-ai-input">
          <input id="floatingAIInput" type="text" placeholder="Hỏi AI mà không rời trang..." autocomplete="off" />
          <button type="submit">Gửi</button>
        </form>
      </section>
    </div>
  `);

  const button = document.getElementById('floatingAIButton');
  const close = document.getElementById('floatingAIClose');
  const reset = document.getElementById('floatingAIReset');
  const form = document.getElementById('floatingAIForm');
  setupFloatingAIDrag();
  restoreFloatingAIPosition();

  button?.addEventListener('click', () => toggleFloatingAI());
  close?.addEventListener('click', () => toggleFloatingAI(false));
  reset?.addEventListener('click', resetFloatingAIPosition);
  form?.addEventListener('submit', event => {
    event.preventDefault();
    sendFloatingAIMessage();
  });
  document.querySelectorAll('[data-floating-question]').forEach(btn => btn.addEventListener('click', () => {
    sendFloatingAIMessage(btn.dataset.floatingQuestion || '');
  }));

  renderFloatingAIMessages();
}

function getFloatingAIPositionStoreKey() {
  return 'btc_bigdata_floating_ai_position';
}

function clampFloatingAIPosition(x, y) {
  const panel = document.getElementById('floatingAIPanel');
  if (!panel) return { x, y };
  const rect = panel.getBoundingClientRect();
  const margin = 10;
  const width = rect.width || 390;
  const height = rect.height || 520;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin + 68, Math.min(y, window.innerHeight - height - margin))
  };
}

function applyFloatingAIPosition(x, y) {
  const panel = document.getElementById('floatingAIPanel');
  if (!panel) return;
  const pos = clampFloatingAIPosition(x, y);
  panel.style.left = `${pos.x}px`;
  panel.style.top = `${pos.y}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
}

function restoreFloatingAIPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(getFloatingAIPositionStoreKey()) || 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) applyFloatingAIPosition(saved.x, saved.y);
  } catch (_) { }
}

function resetFloatingAIPosition() {
  const panel = document.getElementById('floatingAIPanel');
  if (!panel) return;
  panel.style.left = '';
  panel.style.top = '';
  panel.style.right = '22px';
  panel.style.bottom = '92px';
  localStorage.removeItem(getFloatingAIPositionStoreKey());
}

function setupFloatingAIDrag() {
  const panel = document.getElementById('floatingAIPanel');
  const head = panel?.querySelector('.floating-ai-head');
  if (!panel || !head || panel.dataset.dragReady === '1') return;
  panel.dataset.dragReady = '1';

  let start = null;
  head.addEventListener('pointerdown', event => {
    if (event.target.closest('button, input, a')) return;
    const rect = panel.getBoundingClientRect();
    start = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    panel.classList.add('dragging');
    head.setPointerCapture?.(event.pointerId);
  });
  head.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.pointerId) return;
    applyFloatingAIPosition(event.clientX - start.dx, event.clientY - start.dy);
  });
  function stopDrag(event) {
    if (!start || event.pointerId !== start.pointerId) return;
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(getFloatingAIPositionStoreKey(), JSON.stringify({ x: rect.left, y: rect.top }));
    panel.classList.remove('dragging');
    start = null;
  }
  head.addEventListener('pointerup', stopDrag);
  head.addEventListener('pointercancel', stopDrag);
  window.addEventListener('resize', restoreFloatingAIPosition);
}

function toggleFloatingAI(forceOpen) {
  const panel = document.getElementById('floatingAIPanel');
  if (!panel) return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  document.body.classList.toggle('floating-ai-open', open);
  document.querySelector('.floating-ai-button .unread-dot')?.classList.toggle('hidden', open);
  if (open) {
    renderFloatingAIMessages();
    window.setTimeout(() => document.getElementById('floatingAIInput')?.focus(), 80);
  }
}

function renderFloatingAIMessages() {
  const box = document.getElementById('floatingAIMessages');
  if (!box) return;
  box.innerHTML = chatMessages.map(m => `<div class="floating-ai-msg ${m.role === 'user' ? 'user' : 'ai'}">${escapeHTML(m.text)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendFloatingAIMessage(forcedQuestion = '') {
  const input = document.getElementById('floatingAIInput');
  const question = String(forcedQuestion || input?.value || '').trim();
  if (!question || floatingChatSending) return;

  floatingChatSending = true;
  const sendButton = document.querySelector('#floatingAIForm button[type="submit"]');
  if (input) input.value = '';
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = '...';
  }
  chatMessages.push({ role: 'user', text: question });
  chatMessages.push({ role: 'ai', text: 'AI đang phân tích dữ liệu bạn đang xem...' });
  renderFloatingAIMessages();
  renderMessages();

  try {
    const res = await askAI(question);
    const data = res.data;
    chatMessages[chatMessages.length - 1] = {
      role: 'ai',
      text: aiResponseText(data)
    };
  } catch (error) {
    chatMessages[chatMessages.length - 1] = { role: 'ai', text: `AI hiện không phản hồi được: ${error.message}` };
  } finally {
    floatingChatSending = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = 'Gửi';
    }
  }

  renderFloatingAIMessages();
  renderMessages();
}

function mountDataTrustBadge() {
  if (document.getElementById('dataTrustBadge')) return;
  app.insertAdjacentHTML('afterbegin', `<div id="dataTrustBadge" class="trust-badge"><span class="dot neutral"></span>Đang kiểm tra độ tin cậy dữ liệu...</div>`);
  refreshDataTrustBadge();
}

async function refreshDataTrustBadge() {
  const el = document.getElementById('dataTrustBadge');
  if (!el) return;
  try {
    const res = await fetchJson('/api/data-status', { timeout: 30000 });
    const s = res.data;
    const o = ageText(s.ohlcv_age_hours);
    const p = ageText(s.p2p_age_hours);
    const level = (!s.is_ohlcv_fresh || !s.is_p2p_fresh) ? ((s.ohlcv_age_hours > 6 || s.p2p_age_hours > 6) ? 'danger' : 'warn') : 'ok';
    el.className = `trust-badge ${level}`;
    el.innerHTML = `<span class="dot ${level}"></span>Dữ liệu giá: cập nhật ${o} · Dữ liệu P2P: cập nhật ${p}${level !== 'ok' ? '<br><b>⚠ Dữ liệu có thể chưa cập nhật kịp thời, đội ngũ đang kiểm tra.</b>' : ''}`;
  } catch (error) {
    el.className = 'trust-badge warn';
    el.innerHTML = `<span class="dot warn"></span>Không kiểm tra được độ tin cậy dữ liệu: ${escapeHTML(error.message)}`;
  }
}

function ageText(hours) {
  if (!isNum(hours)) return 'chưa rõ';
  if (hours < 1) return `${Math.round(hours * 60)} phút trước`;
  if (hours < 24) return `${formatNumber(hours, 1)} giờ trước`;
  return `${formatNumber(hours / 24, 1)} ngày trước`;
}

function renderLoginPage() {
  const next = getLoginNextRoute();
  const authNotice = consumeAuthNotice();

  app.innerHTML = `
    <section class="auth-shell">
      <div class="auth-panel auth-copy">
        <span class="eyebrow">BTC BigData Account</span>
        <h1>Tài khoản an toàn cho lịch sử, cảnh báo và mua gói</h1>
        <p class="lead">Đăng ký theo luồng mới: website gửi mã OTP 6 số qua email, người dùng nhập mã ngay trên trang. Token không còn xuất hiện trên thanh địa chỉ như magic link.</p>
        <div class="auth-steps">
          <div><b>1</b><span>Nhập email</span></div>
          <div><b>2</b><span>Nhận mã OTP 6 số</span></div>
          <div><b>3</b><span>Nhập mã trên website</span></div>
          <div><b>4</b><span>Đặt mật khẩu để dùng lâu dài</span></div>
        </div>
      </div>

      <div class="auth-panel auth-form-card">
        ${currentSession ? `
          <span class="badge green">Đã đăng nhập</span>
          <h2>${escapeHTML(shortEmail(currentSession.user.email))}</h2>
          <p class="muted">Tài khoản đã sẵn sàng. Bạn có thể vào trang cần dùng hoặc quản lý bảo mật.</p>
          <div class="auth-actions-row">
            <a class="btn primary" href="#${escapeHTML(needsPasswordSetup() ? 'set-password' : next)}">${needsPasswordSetup() ? 'Đặt mật khẩu' : 'Đi tiếp'}</a>
            <a class="btn secondary" href="#account">Quản lý tài khoản</a>
          </div>
        ` : `
          ${authNotice ? `<div class="state-box warn">${escapeHTML(authNotice)}</div>` : ''}
          ${!supabaseAuth ? `
            <div class="state-box error">
              Chưa cấu hình Supabase Auth. Hãy thêm <code>VITE_SUPABASE_URL</code> và <code>VITE_SUPABASE_ANON_KEY</code> vào <code>frontend/.env</code>, sau đó chạy lại <code>npm run dev</code>.
            </div>
          ` : ''}

          <div class="auth-tabs" id="authModeTabs">
            <button class="active" data-auth-mode="login" type="button">Đăng nhập</button>
            <button data-auth-mode="register" type="button">Đăng ký</button>
          </div>

          <div id="registerPanel" class="auth-mode-panel hidden">
            <h2>Tạo tài khoản</h2>
            <p class="muted">Hệ thống gửi mã OTP qua email. Bạn nhập mã tại đây để xác thực, không cần bấm link nên tránh token nằm trên URL.</p>
            <form id="registerEmailForm" novalidate>
              <div class="field"><label for="registerEmail">Email</label><input id="registerEmail" type="email" placeholder="you@example.com" autocomplete="email" required></div>
              <button id="registerSubmit" class="btn primary full" type="submit" style="margin-top:14px" ${!supabaseAuth ? 'disabled' : ''}>Gửi mã OTP xác thực</button>
            </form>
            <div id="registerOtpBox" class="otp-box hidden">
              <form id="registerOtpForm" novalidate>
                <div class="field"><label for="registerOtp">Mã OTP trong email</label><input id="registerOtp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autocomplete="one-time-code" required></div>
                <button id="registerOtpVerify" class="btn secondary full" type="submit">Xác nhận mã OTP</button>
              </form>
            </div>
          </div>

          <div id="loginPanel" class="auth-mode-panel">
            <h2>Đăng nhập</h2>
            <p class="muted">Ưu tiên đăng nhập bằng mật khẩu. Nếu quên hoặc chưa đặt mật khẩu, dùng mã OTP qua email.</p>
            <form id="passwordLoginForm" novalidate>
              <div class="field"><label for="loginEmail">Email</label><input id="loginEmail" type="email" placeholder="you@example.com" autocomplete="email" required></div>
              <div class="field"><label for="loginPassword">Mật khẩu</label><div class="password-input-wrap"><input id="loginPassword" type="password" placeholder="••••••••" autocomplete="current-password" required><button class="password-toggle" type="button" data-password-toggle="loginPassword" aria-label="Hiện mật khẩu" aria-pressed="false"><span aria-hidden="true">👁</span></button></div></div>
              <button id="passwordLoginSubmit" class="btn primary full" type="submit" style="margin-top:14px" ${!supabaseAuth ? 'disabled' : ''}>Đăng nhập bằng mật khẩu</button>
            </form>
            <button id="otpLoginSubmit" class="btn secondary full" type="button" style="margin-top:10px" ${!supabaseAuth ? 'disabled' : ''}>Gửi mã OTP qua email</button>
            <div id="loginOtpBox" class="otp-box hidden">
              <form id="loginOtpForm" novalidate>
                <div class="field"><label for="loginOtp">Mã OTP trong email</label><input id="loginOtp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autocomplete="one-time-code" required></div>
                <button id="loginOtpVerify" class="btn secondary full" type="submit">Xác nhận mã OTP</button>
              </form>
            </div>
          </div>

          <div id="loginResult"></div>
        `}
      </div>
    </section>
  `;

  setupAuthTabs();
  setupPasswordToggles();
  document.getElementById('registerEmailForm')?.addEventListener('submit', event => {
    event.preventDefault();
    requestEmailOtp('register', next);
  });
  document.getElementById('otpLoginSubmit')?.addEventListener('click', () => requestEmailOtp('login', next));
  document.getElementById('registerOtpForm')?.addEventListener('submit', event => {
    event.preventDefault();
    verifyEmailOtp('register', next);
  });
  document.getElementById('loginOtpForm')?.addEventListener('submit', event => {
    event.preventDefault();
    verifyEmailOtp('login', next);
  });
  document.getElementById('passwordLoginForm')?.addEventListener('submit', event => {
    event.preventDefault();
    signInWithPasswordUI(next);
  });
}

function setupAuthTabs() {
  document.querySelectorAll('[data-auth-mode]').forEach(btn => btn.addEventListener('click', () => {
    const mode = btn.dataset.authMode;
    document.querySelectorAll('[data-auth-mode]').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('registerPanel')?.classList.toggle('hidden', mode !== 'register');
    document.getElementById('loginPanel')?.classList.toggle('hidden', mode !== 'login');
    const result = document.getElementById('loginResult');
    if (result) result.innerHTML = '';
  }));
}

function setupPasswordToggles(scope = document) {
  scope.querySelectorAll('[data-password-toggle]').forEach(button => {
    if (button.dataset.passwordToggleReady === '1') return;
    button.dataset.passwordToggleReady = '1';
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!(input instanceof HTMLInputElement)) return;
      const willShow = input.type === 'password';
      input.type = willShow ? 'text' : 'password';
      button.setAttribute('aria-pressed', willShow ? 'true' : 'false');
      button.setAttribute('aria-label', willShow ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      button.classList.toggle('visible', willShow);
      input.focus({ preventScroll: true });
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
    });
  });
}

function setActionBusy(button, busy, busyText = 'Đang xử lý...') {
  if (!(button instanceof HTMLButtonElement)) return;
  if (busy) {
    if (!button.dataset.idleText) button.dataset.idleText = button.textContent || '';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyText;
    return;
  }
  button.disabled = false;
  button.removeAttribute('aria-busy');
  if (button.dataset.idleText) button.textContent = button.dataset.idleText;
}

async function requestEmailOtp(mode, next = 'dashboard') {
  const inputId = mode === 'register' ? 'registerEmail' : 'loginEmail';
  const boxId = mode === 'register' ? 'registerOtpBox' : 'loginOtpBox';
  const otpInputId = mode === 'register' ? 'registerOtp' : 'loginOtp';
  const button = document.getElementById(mode === 'register' ? 'registerSubmit' : 'otpLoginSubmit');
  const email = document.getElementById(inputId)?.value.trim();
  const result = document.getElementById('loginResult');

  if (!email) {
    result.innerHTML = `<div class="state-box error">Vui lòng nhập email.</div>`;
    document.getElementById(inputId)?.focus();
    return;
  }
  if (!supabaseAuth) {
    result.innerHTML = `<div class="state-box error">Chưa cấu hình VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY.</div>`;
    return;
  }

  setActionBusy(button, true, 'Đang gửi OTP...');
  setPendingNextRoute(mode === 'register' ? 'set-password' : next);
  result.innerHTML = `<div class="state-box empty">Đang gửi mã OTP tới email...</div>`;

  try {
    const { error } = await supabaseAuth.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: mode === 'register'
      }
    });

    if (error) {
      result.innerHTML = `<div class="state-box error">${escapeHTML(error.message)}</div>`;
      return;
    }

    const otpBox = document.getElementById(boxId);
    otpBox?.classList.remove('hidden');
    otpBox?.setAttribute('data-email', email);
    document.getElementById(otpInputId)?.focus();

    result.innerHTML = `<div class="state-box empty"><b>Đã gửi mã OTP tới ${escapeHTML(email)}.</b><br>Nhập mã 6 số trong email để xác thực.</div>`;
  } catch (error) {
    result.innerHTML = `<div class="state-box error">${escapeHTML(error.message || 'Không gửi được mã OTP.')}</div>`;
  } finally {
    setActionBusy(button, false);
  }
}

async function verifyEmailOtp(mode, next = 'dashboard') {
  const inputId = mode === 'register' ? 'registerEmail' : 'loginEmail';
  const otpInputId = mode === 'register' ? 'registerOtp' : 'loginOtp';
  const boxId = mode === 'register' ? 'registerOtpBox' : 'loginOtpBox';
  const button = document.getElementById(mode === 'register' ? 'registerOtpVerify' : 'loginOtpVerify');
  const result = document.getElementById('loginResult');
  const email = document.getElementById(inputId)?.value.trim() || document.getElementById(boxId)?.dataset.email || '';
  const token = (document.getElementById(otpInputId)?.value || '').replace(/\s+/g, '').trim();

  if (!email) {
    result.innerHTML = `<div class="state-box error">Vui lòng nhập email trước khi xác nhận OTP.</div>`;
    return;
  }
  if (!/^\d{6}$/.test(token)) {
    result.innerHTML = `<div class="state-box error">Mã OTP gồm 6 chữ số. Vui lòng kiểm tra lại email.</div>`;
    document.getElementById(otpInputId)?.focus();
    return;
  }

  setActionBusy(button, true, 'Đang xác thực...');
  result.innerHTML = `<div class="state-box empty">Đang xác thực mã OTP...</div>`;

  try {
    const { data, error } = await supabaseAuth.auth.verifyOtp({
      email,
      token,
      type: 'email'
    });

    if (error) {
      result.innerHTML = `<div class="state-box error">${escapeHTML(error.message)}<br><small>Nếu mã đã hết hạn, hãy gửi lại mã OTP mới.</small></div>`;
      return;
    }

    currentSession = data.session || null;
    await syncCurrentUserProfile();
    await loadCurrentUserProfile();
    renderAuthHeader();
    showToast('Xác thực email thành công.');
    location.hash = needsPasswordSetup() ? '#set-password' : `#${next}`;
  } catch (error) {
    result.innerHTML = `<div class="state-box error">${escapeHTML(error.message || 'Không xác thực được OTP.')}</div>`;
  } finally {
    setActionBusy(button, false);
  }
}

async function signInWithPasswordUI(next = 'dashboard') {
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const email = emailInput?.value.trim();
  const password = passwordInput?.value || '';
  const result = document.getElementById('loginResult');
  const button = document.getElementById('passwordLoginSubmit');

  if (!email || !password) {
    result.innerHTML = `<div class="state-box error">Vui lòng nhập email và mật khẩu.</div>`;
    (!email ? emailInput : passwordInput)?.focus();
    return;
  }
  if (!supabaseAuth) {
    result.innerHTML = `<div class="state-box error">Supabase Auth chưa được cấu hình.</div>`;
    return;
  }

  setActionBusy(button, true, 'Đang đăng nhập...');
  result.innerHTML = `<div class="state-box empty">Đang đăng nhập...</div>`;

  try {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

    if (error) {
      result.innerHTML = `<div class="state-box error">${escapeHTML(error.message)}<br><small>Nếu bạn chưa đặt mật khẩu, hãy dùng nút gửi mã OTP qua email.</small></div>`;
      return;
    }

    currentSession = data.session || null;
    await syncCurrentUserProfile();
    await loadCurrentUserProfile();
    if (!currentSession) return;
    renderAuthHeader();
    showToast(isAdmin() ? 'Đăng nhập admin thành công.' : 'Đăng nhập thành công.');
    location.hash = isAdmin() && next === 'dashboard' ? '#admin' : (needsPasswordSetup() ? '#set-password' : `#${next}`);
  } catch (error) {
    result.innerHTML = `<div class="state-box error">${escapeHTML(error.message || 'Không đăng nhập được.')}</div>`;
  } finally {
    setActionBusy(button, false);
  }
}

function needsPasswordSetup() {
  if (!currentSession?.user) return false;
  try {
    if (localStorage.getItem(`btc_bigdata_password_set_${currentSession.user.id}`) === 'true') return false;
  } catch (_) { }
  return currentSession.user.user_metadata?.password_set !== true;
}

function validatePassword(password) {
  const errors = [];
  if (password.length < 8) errors.push('ít nhất 8 ký tự');
  if (!/[A-Z]/.test(password)) errors.push('1 chữ hoa');
  if (!/[a-z]/.test(password)) errors.push('1 chữ thường');
  if (!/[0-9]/.test(password)) errors.push('1 số');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('1 ký tự đặc biệt');
  return errors;
}

function renderSetPasswordPage() {
  if (!currentSession) {
    setPendingNextRoute('set-password');
    location.hash = '#login?next=set-password';
    return;
  }

  const isChangingPassword = !needsPasswordSetup();
  app.innerHTML = `
    <section class="auth-shell single">
      <div class="auth-panel auth-form-card">
        <span class="badge green">Email đã xác thực</span>
        <h1>${isChangingPassword ? 'Đổi mật khẩu bảo mật' : 'Đặt mật khẩu bảo mật'}</h1>
        <p class="muted">Email: <b>${escapeHTML(currentSession.user.email)}</b></p>
        <p class="muted">Mật khẩu giúp bạn đăng nhập nhanh ở các lần sau. Mật khẩu được Supabase Auth quản lý, project không tự lưu mật khẩu trong database.</p>

        <form id="setPasswordForm" novalidate>
          <div class="field"><label for="newPassword">Mật khẩu mới</label><div class="password-input-wrap"><input id="newPassword" type="password" autocomplete="new-password" placeholder="Ít nhất 8 ký tự" required><button class="password-toggle" type="button" data-password-toggle="newPassword" aria-label="Hiện mật khẩu" aria-pressed="false"><span aria-hidden="true">👁</span></button></div></div>
          <div class="field"><label for="confirmPassword">Nhập lại mật khẩu</label><div class="password-input-wrap"><input id="confirmPassword" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu" required><button class="password-toggle" type="button" data-password-toggle="confirmPassword" aria-label="Hiện mật khẩu" aria-pressed="false"><span aria-hidden="true">👁</span></button></div></div>
          <div class="password-hint">Yêu cầu: 8+ ký tự, chữ hoa, chữ thường, số và ký tự đặc biệt.</div>
          <button id="setPasswordSubmit" class="btn primary full" type="submit" style="margin-top:14px">${isChangingPassword ? 'Cập nhật mật khẩu' : 'Lưu mật khẩu'}</button>
        </form>
        <div id="setPasswordResult"></div>
      </div>
    </section>
  `;

  setupPasswordToggles();
  document.getElementById('setPasswordForm')?.addEventListener('submit', event => {
    event.preventDefault();
    setPasswordUI();
  });
}

async function setPasswordUI() {
  const password = document.getElementById('newPassword')?.value || '';
  const confirm = document.getElementById('confirmPassword')?.value || '';
  const result = document.getElementById('setPasswordResult');
  const submitBtn = document.getElementById('setPasswordSubmit');

  const errors = validatePassword(password);
  if (errors.length) {
    result.innerHTML = `<div class="state-box error">Mật khẩu cần có: ${errors.join(', ')}.</div>`;
    return;
  }
  if (password !== confirm) {
    result.innerHTML = `<div class="state-box error">Mật khẩu nhập lại không khớp.</div>`;
    return;
  }

  passwordSavingInProgress = true;
  submitBtn?.setAttribute('disabled', 'disabled');
  result.innerHTML = `<div class="state-box empty">Đang lưu mật khẩu...</div>`;

  let resolved = false;

  const goDashboardAfterPasswordSaved = () => {
    if (resolved) return;
    resolved = true;
    passwordSavingInProgress = false;

    try {
      localStorage.removeItem('btc_bigdata_auth_next');
      if (currentSession?.user?.id) localStorage.setItem(`btc_bigdata_password_set_${currentSession.user.id}`, 'true');
    } catch (_) { }

    if (currentSession?.user) {
      currentSession = {
        ...currentSession,
        user: {
          ...currentSession.user,
          user_metadata: { ...(currentSession.user.user_metadata || {}), password_set: true }
        }
      };
    }

    result.innerHTML = `<div class="state-box success">Đã lưu mật khẩu thành công. Đang chuyển về Dashboard...</div>`;
    showToast('Đã lưu mật khẩu thành công.');
    renderAuthHeader();

    // Sync profile chạy nền, không được chặn chuyển trang.
    syncCurrentUserProfile({ password_set: true }).catch(error => {
      console.warn('Không sync được profile sau khi đặt mật khẩu:', error.message);
    });

    window.setTimeout(() => {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#dashboard`);
      route();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 350);
  };

  const showPasswordError = (message) => {
    if (resolved) return;
    resolved = true;
    passwordSavingInProgress = false;
    submitBtn?.removeAttribute('disabled');
    result.innerHTML = `<div class="state-box error">${escapeHTML(message || 'Không lưu được mật khẩu.')}</div>`;
  };

  // Trường hợp Supabase Auth đã trả 200 nhưng SDK promise bị kẹt, vẫn thoát khỏi màn hình chờ.
  const fallbackTimer = window.setTimeout(() => {
    console.warn('Fallback redirect: Supabase updateUser chưa resolve sau 10 giây.');
    goDashboardAfterPasswordSaved();
  }, 10000);

  supabaseAuth.auth.updateUser({
    password,
    data: { password_set: true }
  }).then(({ data, error }) => {
    window.clearTimeout(fallbackTimer);
    if (error) {
      showPasswordError(error.message);
      return;
    }

    if (data?.user && currentSession) {
      currentSession = {
        ...currentSession,
        user: {
          ...currentSession.user,
          ...data.user,
          user_metadata: { ...(currentSession.user.user_metadata || {}), ...(data.user.user_metadata || {}), password_set: true }
        }
      };
    }

    goDashboardAfterPasswordSaved();
  }).catch(error => {
    window.clearTimeout(fallbackTimer);
    showPasswordError(error.message);
  });
}

async function syncCurrentUserProfile(extra = {}) {
  if (!supabaseAuth || !currentSession?.user) return;
  const user = currentSession.user;
  try {
    await supabaseAuth.from('user_profiles').upsert({
      user_id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || null,
      password_set: user.user_metadata?.password_set === true || extra.password_set === true,
      last_login_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
  } catch (error) {
    console.warn('Không sync được user_profiles. Hãy chạy SQL tạo bảng user_profiles nếu cần:', error.message);
  }
}

function renderAccountPage() {
  if (!currentSession) {
    location.hash = '#login?next=account';
    return;
  }

  const email = currentSession.user.email;
  const passwordSet = !needsPasswordSetup();
  const admin = isAdmin();
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Tài khoản</span><h1>Bảo mật và dữ liệu cá nhân</h1><p class="lead">Mọi dữ liệu cá nhân được lưu theo <code>user_id</code> trong Supabase và được RLS chặn không cho user khác xem.</p></div></section>
    <section class="grid two">
      <div class="card">
        <h3>Thông tin đăng nhập</h3>
        <p><strong>Email:</strong> ${escapeHTML(email)}</p>
        <p><strong>Vai trò:</strong> ${admin ? '<span class="badge amber">Admin</span>' : 'Người dùng'}</p>
        <p><strong>Trạng thái mật khẩu:</strong> ${passwordSet ? 'Đã thiết lập' : 'Chưa thiết lập'}</p>
        <div class="hero-actions"><a class="btn ${passwordSet ? 'secondary' : 'primary'}" href="#set-password">${passwordSet ? 'Đổi mật khẩu' : 'Đặt mật khẩu ngay'}</a>${admin ? '<a class="btn primary" href="#admin">Mở Admin Console</a>' : ''}</div>
      </div>
      <div class="card">
        <h3>Dữ liệu gắn với tài khoản</h3>
        <ul class="report-list">
          <li><code>user_profiles</code>: hồ sơ tài khoản.</li>
          <li><code>ai_analysis_history</code>: lịch sử hỏi AI theo user.</li>
          <li><code>demo_trades</code>: giao dịch demo theo user.</li>
          <li><code>alert_rules</code>: cảnh báo email theo user.</li>
          <li><code>orders</code> và <code>subscriptions</code>: gói thanh toán theo user.</li>
          <li><code>wallets</code>, <code>wallet_topups</code>, <code>wallet_transactions</code>: ví demo, nạp QR và lịch sử biến động số dư.</li>
        </ul>
      </div>
    </section>
  `;
}


let adminUsersCache = [];
let adminDashboardCache = null;
let adminLoadToken = 0;
let adminUserSearchTimer = null;

const ADMIN_CLIENT_CACHE_VERSION = 'v2';
const ADMIN_CLIENT_CACHE_TTL = Object.freeze({
  overview: 45_000,
  users: 60_000,
  activity: 30_000,
  system: 15_000
});
const adminUserQueryState = {
  page: 1,
  limit: 30,
  search: '',
  status: 'all',
  plan: 'all'
};

function adminClientCachePrefix() {
  return `btc_admin_cache_${ADMIN_CLIENT_CACHE_VERSION}:${currentSession?.user?.id || 'anonymous'}:`;
}

function adminClientCacheKey(view) {
  const safeView = ADMIN_VIEW_CONFIG[view] ? view : 'overview';
  if (safeView !== 'users') return `${adminClientCachePrefix()}${safeView}`;
  const query = adminUserQueryState;
  return `${adminClientCachePrefix()}users:${query.page}:${query.limit}:${query.status}:${query.plan}:${query.search.trim().toLowerCase()}`;
}

function readAdminClientCache(view) {
  try {
    const raw = sessionStorage.getItem(adminClientCacheKey(view));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !Number.isFinite(Number(parsed.savedAt))) return null;
    const ttl = ADMIN_CLIENT_CACHE_TTL[view] || 30_000;
    return {
      data: parsed.data,
      fresh: Date.now() - Number(parsed.savedAt) < ttl
    };
  } catch (_) {
    return null;
  }
}

function writeAdminClientCache(view, data) {
  try {
    sessionStorage.setItem(adminClientCacheKey(view), JSON.stringify({ data, savedAt: Date.now() }));
  } catch (_) { }
}

function clearAdminClientCache(view = null) {
  const prefix = adminClientCachePrefix();
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      if (!view || key.startsWith(`${prefix}${view}`)) sessionStorage.removeItem(key);
    }
  } catch (_) { }
}

function adminApiEndpoint(view, force = false) {
  const safeView = ADMIN_VIEW_CONFIG[view] ? view : 'overview';
  const params = new URLSearchParams();
  if (force) params.set('refresh', '1');
  if (safeView === 'users') {
    params.set('page', String(adminUserQueryState.page));
    params.set('limit', String(adminUserQueryState.limit));
    if (adminUserQueryState.search.trim()) params.set('search', adminUserQueryState.search.trim());
    if (adminUserQueryState.status !== 'all') params.set('status', adminUserQueryState.status);
    if (adminUserQueryState.plan !== 'all') params.set('plan', adminUserQueryState.plan);
  }
  const path = safeView === 'overview' ? '/api/admin/overview' : `/api/admin/${safeView}`;
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

const ADMIN_VIEW_CONFIG = Object.freeze({
  overview: {
    kicker: 'ADMIN OVERVIEW',
    title: 'Tổng quan quản trị',
    description: 'Theo dõi nhanh người dùng, Premium, giao dịch demo, AI và diễn biến BTC mới nhất.'
  },
  users: {
    kicker: 'USER MANAGEMENT',
    title: 'Quản lý người dùng',
    description: 'Quản lý trạng thái truy cập, gói Premium, ví demo và hoạt động của từng tài khoản.'
  },
  activity: {
    kicker: 'TRADING & PREMIUM',
    title: 'Giao dịch và Premium',
    description: 'Theo dõi các giao dịch mô phỏng, đơn Premium Sandbox và hoạt động AI gần đây.'
  },
  system: {
    kicker: 'SYSTEM HEALTH',
    title: 'Trạng thái hệ thống',
    description: 'Kiểm tra API, cơ sở dữ liệu, độ mới dữ liệu thị trường và tiến trình đồng bộ.'
  }
});

function getAdminView() {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const requested = String(params.get('view') || 'overview').toLowerCase();
  return ADMIN_VIEW_CONFIG[requested] ? requested : 'overview';
}

function adminViewHref(view) {
  const safeView = ADMIN_VIEW_CONFIG[view] ? view : 'overview';
  return `#admin?view=${safeView}`;
}

async function renderAdminPage() {
  if (!currentSession || !isAdmin()) {
    location.hash = currentSession ? '#dashboard' : '#login?next=admin';
    return;
  }

  const adminView = getAdminView();
  const viewMeta = ADMIN_VIEW_CONFIG[adminView];

  app.innerHTML = `
    <section class="admin-console" aria-label="BTC BigData Admin Console">
      <aside class="admin-console-rail">
        <div class="admin-brand"><span>₿</span><div><strong>BitAdmin</strong><small>BTC BIGDATA</small></div></div>
        <nav class="admin-section-nav" aria-label="Điều hướng quản trị">
          <a href="${adminViewHref('overview')}" class="${adminView === 'overview' ? 'active' : ''}" data-admin-view-link="overview" ${adminView === 'overview' ? 'aria-current="page"' : ''}><span>▦</span>Tổng quan</a>
          <a href="${adminViewHref('users')}" class="${adminView === 'users' ? 'active' : ''}" data-admin-view-link="users" ${adminView === 'users' ? 'aria-current="page"' : ''}><span>♙</span>Người dùng</a>
          <a href="${adminViewHref('activity')}" class="${adminView === 'activity' ? 'active' : ''}" data-admin-view-link="activity" ${adminView === 'activity' ? 'aria-current="page"' : ''}><span>↔</span>Giao dịch & Premium</a>
          <a href="${adminViewHref('system')}" class="${adminView === 'system' ? 'active' : ''}" data-admin-view-link="system" ${adminView === 'system' ? 'aria-current="page"' : ''}><span>◉</span>Hệ thống</a>
        </nav>
        <div class="admin-rail-bottom">
          <a class="admin-rail-return" href="#dashboard"><span>←</span><b>Giao diện người dùng</b></a>
          <div class="admin-profile-card">
            <span class="admin-avatar">A</span>
            <div><strong>${escapeHTML(shortEmail(currentSession.user.email))}</strong><small>Quản trị viên</small></div>
            <button id="adminLogoutSide" class="admin-profile-logout" type="button" aria-label="Đăng xuất" title="Đăng xuất">↪</button>
          </div>
        </div>
      </aside>
      <div class="admin-console-main">
        <header class="admin-console-header">
          <div><span class="admin-kicker">${viewMeta.kicker}</span><h1>${viewMeta.title}</h1><p>${viewMeta.description}</p></div>
          <div class="admin-header-actions">
            <span id="adminMarketBadge" class="admin-market-badge">BTC/USDT · đang tải</span>
            <button id="adminRefresh" class="btn admin-accent" type="button">↻ Làm mới</button>
            <a class="admin-shell-action" href="#dashboard">← Trang người dùng</a>
            <button id="adminLogout" class="admin-shell-action danger" type="button">Đăng xuất</button>
          </div>
        </header>
        <div id="adminDataStatusMount" class="admin-data-status-mount" aria-live="polite"></div>
        <main id="adminConsoleContent" class="admin-console-content" data-admin-view="${adminView}">
          <section class="admin-loading-grid">${loadingCard(150)}${loadingCard(150)}${loadingCard(340)}</section>
        </main>
      </div>
    </section>
  `;

  document.querySelectorAll('[data-admin-view-link]').forEach(link => link.addEventListener('click', event => {
    const target = link.getAttribute('href');
    if (target && location.hash === target) {
      event.preventDefault();
      resetRouteViewport();
      document.querySelector('.admin-console-main')?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    }
  }));

  document.getElementById('adminRefresh')?.addEventListener('click', () => loadAdminConsole(true, adminView));
  const logoutAdmin = async () => {
    if (!supabaseAuth) return;
    try {
      await supabaseAuth.auth.signOut();
    } finally {
      currentSession = null;
      currentUserProfile = null;
      clearAdminClientCache();
      adminDashboardCache = null;
      adminUsersCache = [];
      renderAuthHeader();
      showToast('Đã đăng xuất khỏi Admin Console.');
      location.hash = '#login';
    }
  };
  document.getElementById('adminLogout')?.addEventListener('click', logoutAdmin);
  document.getElementById('adminLogoutSide')?.addEventListener('click', logoutAdmin);
  await loadAdminConsole(false, adminView);
}

async function loadAdminConsole(force = false, view = getAdminView(), options = {}) {
  const content = document.getElementById('adminConsoleContent');
  const refreshButton = document.getElementById('adminRefresh');
  if (!content) return;

  const safeView = ADMIN_VIEW_CONFIG[view] ? view : 'overview';
  const skipClientCache = Boolean(options.skipClientCache);
  const showLoading = options.showLoading !== false;
  const cached = !force && !skipClientCache ? readAdminClientCache(safeView) : null;

  if (cached?.data) {
    adminDashboardCache = cached.data;
    adminUsersCache = cached.data?.users?.data || [];
    renderAdminConsoleContent(adminDashboardCache, adminUsersCache, safeView, options);
    if (cached.fresh) return;
  }

  if (force) clearAdminClientCache(safeView);
  if (!cached?.data && showLoading) {
    content.innerHTML = `<section class="admin-loading-grid">${loadingCard(150)}${loadingCard(150)}${loadingCard(340)}</section>`;
  }

  const requestToken = ++adminLoadToken;
  setActionBusy(refreshButton, true, cached?.data ? 'Đang cập nhật...' : 'Đang tải...');
  try {
    const response = await fetchJson(adminApiEndpoint(safeView, force), {
      timeout: 45000,
      headers: force ? { 'Cache-Control': 'no-cache' } : undefined
    });
    if (requestToken !== adminLoadToken || activeRoute !== 'admin' || getAdminView() !== safeView) return;

    adminDashboardCache = response.data || {};
    adminUsersCache = adminDashboardCache?.users?.data || [];
    writeAdminClientCache(safeView, adminDashboardCache);
    renderAdminConsoleContent(adminDashboardCache, adminUsersCache, safeView, options);
  } catch (error) {
    if (cached?.data) {
      showToast(`Đang hiển thị dữ liệu cache: ${error.message}`);
      return;
    }
    content.innerHTML = `
      <section class="admin-error-panel">
        <span class="badge red">Không tải được trang quản trị</span>
        <h2>Kiểm tra migration và quyền admin</h2>
        <p>${escapeHTML(error.message)}</p>
        <p class="muted">Chạy phần Feature upgrade v4 trong <code>supabase/schema.sql</code>, sau đó triển khai lại backend.</p>
        <button class="btn admin-accent" id="adminRetry" type="button">Thử lại</button>
      </section>`;
    document.getElementById('adminRetry')?.addEventListener('click', () => loadAdminConsole(true, safeView));
  } finally {
    if (requestToken === adminLoadToken) setActionBusy(refreshButton, false);
  }
}

function renderAdminConsoleContent(data, users, view = getAdminView(), options = {}) {
  const content = document.getElementById('adminConsoleContent');
  if (!content) return;
  const safeView = ADMIN_VIEW_CONFIG[view] ? view : 'overview';
  const summary = data?.summary || {};
  const latest = data?.market?.latest || {};
  const activity = data?.activity || [];
  const system = data?.system || {};

  const marketBadge = document.getElementById('adminMarketBadge');
  if (marketBadge) marketBadge.innerHTML = `BTC/USDT <strong>${formatUSD(Number(latest.close))}</strong>`;
  renderAdminDataStatus(system.data_freshness || {}, system.data_sync || {});
  if (['queued', 'running'].includes(String(system.data_sync?.status || ''))) startAdminSyncPolling();

  const pages = {
    overview: `
      <section class="admin-page admin-overview-page" aria-labelledby="adminOverviewTitle">
        <div class="admin-page-heading">
          <div><span class="admin-kicker">OVERVIEW</span><h2 id="adminOverviewTitle">Tình hình hệ thống hôm nay</h2><p>Tất cả số liệu quan trọng được tổng hợp trong một màn hình.</p></div>
        </div>
        <div class="admin-kpi-grid">
          ${adminKpi('♙', 'Tổng người dùng', formatNumber(Number(summary.total_users || 0), 0), `${formatNumber(Number(summary.online_24h || 0), 0)} hoạt động 24h`)}
          ${adminKpi('◆', 'Premium đang hoạt động', formatNumber(Number(summary.premium_users || 0), 0), `${formatNumber(Number(summary.successful_orders || 0), 0)} đơn thành công`)}
          ${adminKpi('₫', 'Doanh thu Sandbox', formatVND(Number(summary.revenue_vnd || 0)), 'Dữ liệu mô phỏng, không phải tiền thật')}
          ${adminKpi('↔', 'Giao dịch demo', formatNumber(Number(summary.trade_count || 0), 0), formatVND(Number(summary.trade_volume_vnd || 0)))}
          ${adminKpi('AI', 'Câu hỏi AI', formatNumber(Number(summary.ai_questions || 0), 0), `${formatNumber(Number(summary.active_alerts || 0), 0)} cảnh báo đang bật`)}
          ${adminKpi('₿', 'Giá BTC hiện tại', formatUSD(Number(latest.close)), `RSI ${formatNumber(Number(latest.rsi_14), 2)}`)}
        </div>
        <div class="admin-overview-grid">
          <article class="admin-panel admin-market-panel">
            <div class="admin-panel-head"><div><span>THỊ TRƯỜNG</span><h2>BTC/USDT · 72 giờ</h2></div><a href="#chart">Mở biểu đồ đầy đủ →</a></div>
            <div class="admin-market-meta"><span>Low <b>${formatUSD(Number(latest.low))}</b></span><span>High <b>${formatUSD(Number(latest.high))}</b></span><span>EMA20 <b>${formatUSD(Number(latest.ema_20))}</b></span></div>
            <div id="adminMarketChart" class="admin-market-chart"></div>
          </article>
          <article class="admin-panel admin-live-panel">
            <div class="admin-panel-head"><div><span>HOẠT ĐỘNG MỚI</span><h2>Người dùng đang thao tác</h2></div></div>
            <div class="admin-activity-list compact">${renderAdminActivity(activity.slice(0, 7))}</div>
            <a class="admin-view-all" href="${adminViewHref('activity')}">Xem toàn bộ hoạt động</a>
          </article>
        </div>
      </section>`,
    users: `
      <section class="admin-page admin-panel admin-users-page" aria-labelledby="adminUsersTitle">
        <div class="admin-users-toolbar">
          <div><span class="admin-kicker">USER MANAGEMENT</span><h2 id="adminUsersTitle">Danh sách người dùng</h2><p>Dữ liệu được phân trang và lọc trực tiếp tại Supabase để giảm tải trình duyệt.</p></div>
          <div class="admin-user-filters">
            <label class="admin-search"><span>⌕</span><input id="adminUserSearch" type="search" value="${escapeHTML(adminUserQueryState.search)}" placeholder="Tìm email hoặc tên..."></label>
            <select id="adminUserStatus" aria-label="Lọc trạng thái"><option value="all" ${adminUserQueryState.status === 'all' ? 'selected' : ''}>Tất cả trạng thái</option><option value="active" ${adminUserQueryState.status === 'active' ? 'selected' : ''}>Đang hoạt động</option><option value="suspended" ${adminUserQueryState.status === 'suspended' ? 'selected' : ''}>Tạm khóa</option></select>
            <select id="adminUserPlan" aria-label="Lọc gói"><option value="all" ${adminUserQueryState.plan === 'all' ? 'selected' : ''}>Tất cả gói</option><option value="premium" ${adminUserQueryState.plan === 'premium' ? 'selected' : ''}>Premium</option><option value="free" ${adminUserQueryState.plan === 'free' ? 'selected' : ''}>Free</option></select>
          </div>
        </div>
        <div class="admin-users-layout">
          <div class="admin-user-table-column">
            <div class="admin-table-wrap"><table class="admin-user-table"><thead><tr><th>Người dùng</th><th>Trạng thái</th><th>Gói</th><th>Ví demo</th><th>Giao dịch</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody id="adminUsersBody"></tbody></table></div>
            <div id="adminUsersPagination" class="admin-pagination" aria-label="Phân trang người dùng"></div>
          </div>
          <aside id="adminUserDetail" class="admin-user-detail"><div class="admin-empty-detail"><span>♙</span><strong>Chọn một người dùng</strong><p>Xem thông tin tài khoản, gói, ví và hoạt động demo.</p></div></aside>
        </div>
      </section>`,
    activity: `
      <section class="admin-page admin-activity-page" aria-labelledby="adminActivityTitle">
        <div class="admin-page-heading">
          <div><span class="admin-kicker">TRADING & PREMIUM</span><h2 id="adminActivityTitle">Nhật ký giao dịch và Premium</h2><p>Theo dõi các thao tác phát sinh từ những chức năng đang có trên website.</p></div>
        </div>
        <div class="admin-kpi-grid admin-activity-kpis">
          ${adminKpi('↔', 'Tổng giao dịch demo', formatNumber(Number(summary.trade_count || 0), 0), formatVND(Number(summary.trade_volume_vnd || 0)))}
          ${adminKpi('◆', 'Premium hoạt động', formatNumber(Number(summary.premium_users || 0), 0), `${formatNumber(Number(summary.successful_orders || 0), 0)} đơn thành công`)}
          ${adminKpi('₫', 'Doanh thu Sandbox', formatVND(Number(summary.revenue_vnd || 0)), 'Không phải doanh thu tiền thật')}
          ${adminKpi('AI', 'Câu hỏi AI', formatNumber(Number(summary.ai_questions || 0), 0), `${formatNumber(Number(summary.active_alerts || 0), 0)} cảnh báo đang bật`)}
        </div>
        <article class="admin-panel admin-activity-page-panel"><div class="admin-panel-head"><div><span>ACTIVITY LOG</span><h2>Hoạt động gần đây</h2></div></div><div class="admin-activity-list">${renderAdminActivity(activity)}</div></article>
      </section>`,
    system: `
      <section class="admin-page admin-system-page" aria-labelledby="adminSystemTitle">
        <div class="admin-page-heading">
          <div><span class="admin-kicker">SYSTEM HEALTH</span><h2 id="adminSystemTitle">Trạng thái vận hành</h2><p>Kiểm tra sức khỏe API, cơ sở dữ liệu và độ đầy đủ của dữ liệu 72 giờ.</p></div>
        </div>
        <article class="admin-panel admin-system-panel admin-system-page-panel"><div class="admin-panel-head"><div><span>LIVE STATUS</span><h2>Hạ tầng BTC BigData</h2></div><span class="admin-health-ok">● ${system.api === 'operational' ? 'API hoạt động' : 'Cần kiểm tra'}</span></div>${renderAdminSystem(system, summary)}</article>
      </section>`
  };

  content.innerHTML = pages[safeView];
  content.dataset.adminView = safeView;

  if (safeView === 'users') setupAdminUserTable(users, data?.users || {});
  if (safeView === 'overview') drawAdminMarketChart(data?.market?.series || []);

  if (!options.preserveViewport) resetRouteViewport();
}

function renderAdminDataStatus(freshness = {}, sync = {}) {
  const mount = document.getElementById('adminDataStatusMount');
  if (!mount) return;

  const syncStatus = String(sync.status || 'idle');
  const syncing = syncStatus === 'queued' || syncStatus === 'running';
  const dataState = String(freshness.state || 'missing');
  const visualState = syncing ? 'syncing' : dataState;
  const labels = {
    fresh: 'Dữ liệu đúng lịch',
    late: 'Dữ liệu đang trễ',
    stale: 'Dữ liệu quá cũ',
    missing: 'Chưa có dữ liệu',
    syncing: 'Đang đồng bộ dữ liệu'
  };
  const icons = { fresh: '✓', late: '!', stale: '!', missing: '?', syncing: '↻' };
  const ohlcvAge = Number(freshness.ohlcv?.age_hours);
  const p2pAge = Number(freshness.p2p?.age_hours);
  const threshold = Math.max(0.1, Number(freshness.threshold_hours || 2));
  const latestTimestamp = freshness.ohlcv?.timestamp;
  const ageForMeter = Number.isFinite(ohlcvAge) ? ohlcvAge : threshold * 3;
  const freshnessPercent = syncing ? 100 : Math.max(6, Math.min(100, 100 - (ageForMeter / (threshold * 3)) * 100));
  const needsSync = Boolean(freshness.needs_sync) || dataState !== 'fresh';
  const syncFailed = syncStatus === 'failed';
  const message = syncFailed
    ? `${sync.message || 'Đồng bộ thất bại.'}${sync.error ? ` ${sync.error}` : ''}`
    : syncing
      ? (sync.message || 'Đang lấy dữ liệu mới và cập nhật Supabase...')
      : (freshness.message || 'Đang kiểm tra độ mới dữ liệu.');
  const latestText = latestTimestamp ? formatVNTime(latestTimestamp) : 'Chưa có';
  const actionLabel = syncing ? 'Đang đồng bộ...' : needsSync ? '↻ Đồng bộ dữ liệu ngay' : '↻ Đồng bộ lại';

  mount.innerHTML = `
    <section class="admin-data-status ${escapeHTML(visualState)} ${syncFailed ? 'failed' : ''}">
      <div class="admin-data-status-icon" aria-hidden="true">${icons[visualState] || '!'}</div>
      <div class="admin-data-status-copy">
        <div class="admin-data-status-title"><span>DATA FRESHNESS</span><strong>${labels[visualState] || labels.missing}</strong></div>
        <p>${escapeHTML(message)}</p>
        <div class="admin-data-source-row">
          <span>OHLCV: <b>${ageText(ohlcvAge)}</b></span>
          <span>P2P: <b>${ageText(p2pAge)}</b></span>
          <span>Ngưỡng cho phép: <b>${formatNumber(threshold, 1)} giờ</b></span>
        </div>
        <div class="admin-data-meter" aria-label="Mức độ mới của dữ liệu"><span style="width:${freshnessPercent}%"></span></div>
      </div>
      <div class="admin-data-status-actions">
        <small>Cập nhật gần nhất</small>
        <strong>${escapeHTML(latestText)}</strong>
        <button id="adminSyncNow" class="btn ${needsSync ? 'admin-sync-urgent' : 'admin-sync-secondary'}" type="button" ${syncing ? 'disabled aria-busy="true"' : ''}>${actionLabel}</button>
      </div>
    </section>`;

  document.getElementById('adminSyncNow')?.addEventListener('click', startAdminDataSync);
}

async function startAdminDataSync() {
  const button = document.getElementById('adminSyncNow');
  setActionBusy(button, true, 'Đang gửi yêu cầu...');
  try {
    const response = await fetchJson('/api/admin/data-sync', {
      method: 'POST',
      timeout: 20000
    });
    renderAdminDataStatus(response.data?.data || {}, response.data?.sync || {});
    showToast('Đã bắt đầu đồng bộ dữ liệu thị trường.');
    startAdminSyncPolling();
  } catch (error) {
    if (String(error.message || '').toLowerCase().includes('đang chạy')) {
      showToast('Tiến trình đồng bộ đang chạy, hệ thống sẽ tiếp tục theo dõi.');
      startAdminSyncPolling();
      return;
    }
    setActionBusy(button, false);
    showToast(`Không thể bắt đầu đồng bộ: ${error.message}`);
  }
}

function startAdminSyncPolling() {
  stopAdminSyncPolling();
  let attempts = 0;
  const poll = async () => {
    if (activeRoute !== 'admin') {
      stopAdminSyncPolling();
      return;
    }
    attempts += 1;
    try {
      const response = await fetchJson('/api/admin/data-sync/status', { timeout: 20000 });
      const sync = response.data?.sync || {};
      const freshness = response.data?.data || {};
      renderAdminDataStatus(freshness, sync);
      const status = String(sync.status || 'idle');
      if (status === 'queued' || status === 'running') {
        if (attempts < 150) adminSyncPollTimer = window.setTimeout(poll, 2000);
        else showToast('Đồng bộ đang mất nhiều thời gian. Bạn có thể làm mới Admin Console sau.');
        return;
      }
      stopAdminSyncPolling();
      if (status === 'success') {
        clearAdminClientCache();
        showToast(sync.message || 'Đồng bộ dữ liệu hoàn tất.');
        await loadAdminConsole(true);
      } else if (status === 'failed') {
        showToast(sync.error ? `Đồng bộ thất bại: ${sync.error}` : 'Đồng bộ dữ liệu thất bại.');
      }
    } catch (error) {
      if (attempts < 8) {
        adminSyncPollTimer = window.setTimeout(poll, 2500);
      } else {
        stopAdminSyncPolling();
        showToast(`Không đọc được trạng thái đồng bộ: ${error.message}`);
      }
    }
  };
  adminSyncPollTimer = window.setTimeout(poll, 900);
}

function adminKpi(icon, label, value, note) {
  return `<article class="admin-kpi"><span class="admin-kpi-icon">${escapeHTML(icon)}</span><div><small>${escapeHTML(label)}</small><strong>${value}</strong><p>${note}</p></div></article>`;
}

function renderAdminActivity(items) {
  if (!items?.length) return `<div class="admin-empty-row">Chưa có hoạt động mới.</div>`;
  return items.map(item => {
    const type = String(item.type || 'system');
    const icon = type === 'premium' ? '◆' : type === 'trade' ? '↔' : type === 'ai' ? 'AI' : '•';
    const amount = Number(item.amount_vnd);
    return `<div class="admin-activity-item"><span class="admin-activity-icon ${escapeHTML(type)}">${icon}</span><div><strong>${escapeHTML(item.title || 'Hoạt động')}</strong><p>${escapeHTML(item.detail || '')}${Number.isFinite(amount) ? ` · ${formatVND(amount)}` : ''}</p></div><span class="admin-activity-status ${escapeHTML(String(item.status || ''))}">${escapeHTML(String(item.status || ''))}</span><time>${escapeHTML(formatVNTime(item.created_at, 'short'))}</time></div>`;
  }).join('');
}

function renderAdminSystem(system, summary) {
  const databaseOk = system.database === 'operational';
  const dataPoints = Number(system.data_points || 0);
  const apiHealth = system.api === 'operational' ? 100 : 0;
  const dbHealth = databaseOk ? 100 : 0;
  const dataHealth = Math.min(100, Math.round((dataPoints / 72) * 100));
  return `
    <div class="admin-health-rings">
      ${adminHealthRing(apiHealth, 'API')}
      ${adminHealthRing(dbHealth, 'Database')}
      ${adminHealthRing(dataHealth, 'Dữ liệu 72h')}
    </div>
    <div class="admin-system-lines">
      <div><span>Môi trường</span><b>${escapeHTML(system.environment || 'development')}</b></div>
      <div><span>AI Provider</span><b>${escapeHTML(system.ai_provider || 'mock')}</b></div>
      <div><span>Ví demo toàn hệ thống</span><b>${formatVND(Number(summary.wallet_balance_vnd || 0))}</b></div>
      <div><span>Kiểm tra lúc</span><b>${escapeHTML(formatVNTime(system.checked_at))}</b></div>
    </div>`;
}

function adminHealthRing(value, label) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="admin-health-ring" style="--health:${safe * 3.6}deg"><div><strong>${safe}%</strong></div><span>${escapeHTML(label)}</span></div>`;
}

function setupAdminUserTable(users, meta = {}) {
  const search = document.getElementById('adminUserSearch');
  const status = document.getElementById('adminUserStatus');
  const plan = document.getElementById('adminUserPlan');
  const pagination = document.getElementById('adminUsersPagination');

  renderAdminUsersRows(users);

  const reloadUsers = ({ resetPage = false, immediate = false } = {}) => {
    if (resetPage) adminUserQueryState.page = 1;
    window.clearTimeout(adminUserSearchTimer);
    const run = () => loadAdminConsole(false, 'users', { skipClientCache: true, showLoading: false, preserveViewport: true });
    if (immediate) run();
    else adminUserSearchTimer = window.setTimeout(run, 420);
  };

  search?.addEventListener('input', () => {
    adminUserQueryState.search = String(search.value || '');
    reloadUsers({ resetPage: true });
  });
  search?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    adminUserQueryState.search = String(search.value || '');
    reloadUsers({ resetPage: true, immediate: true });
  });
  status?.addEventListener('change', () => {
    adminUserQueryState.status = status.value || 'all';
    reloadUsers({ resetPage: true, immediate: true });
  });
  plan?.addEventListener('change', () => {
    adminUserQueryState.plan = plan.value || 'all';
    reloadUsers({ resetPage: true, immediate: true });
  });

  if (pagination) {
    const page = Math.max(1, Number(meta.page || adminUserQueryState.page || 1));
    const pageSize = Math.max(1, Number(meta.page_size || adminUserQueryState.limit || 30));
    const total = Math.max(0, Number(meta.total || 0));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    adminUserQueryState.page = page;
    adminUserQueryState.limit = pageSize;
    pagination.innerHTML = `
      <span>Hiển thị <b>${formatNumber(Number(meta.count || users.length), 0)}</b> / <b>${formatNumber(total, 0)}</b> tài khoản</span>
      <div>
        <button id="adminUsersPrev" class="admin-page-button" type="button" ${page <= 1 ? 'disabled' : ''}>← Trước</button>
        <strong>Trang ${formatNumber(page, 0)} / ${formatNumber(totalPages, 0)}</strong>
        <button id="adminUsersNext" class="admin-page-button" type="button" ${!meta.has_next || page >= totalPages ? 'disabled' : ''}>Tiếp →</button>
      </div>`;
    document.getElementById('adminUsersPrev')?.addEventListener('click', () => {
      adminUserQueryState.page = Math.max(1, page - 1);
      loadAdminConsole(false, 'users', { skipClientCache: true, showLoading: false, preserveViewport: true });
    });
    document.getElementById('adminUsersNext')?.addEventListener('click', () => {
      adminUserQueryState.page = page + 1;
      loadAdminConsole(false, 'users', { skipClientCache: true, showLoading: false, preserveViewport: true });
    });
  }
}

function renderAdminUsersRows(users) {
  const body = document.getElementById('adminUsersBody');
  if (!body) return;
  if (!users.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="admin-empty-row">Không tìm thấy người dùng phù hợp.</div></td></tr>`;
    return;
  }
  body.innerHTML = users.map(user => {
    const active = String(user.status || 'active') === 'active';
    const name = user.full_name || shortEmail(user.email || 'Người dùng');
    return `<tr tabindex="0" data-admin-user-row="${escapeHTML(user.user_id)}"><td><div class="admin-user-identity"><span>${escapeHTML(String(name).charAt(0).toUpperCase())}</span><div><strong>${escapeHTML(name)}</strong><small>${escapeHTML(user.email || '')}${user.role === 'admin' ? ' · ADMIN' : ''}</small></div></div></td><td><span class="admin-status ${active ? 'active' : 'suspended'}">● ${active ? 'Đang hoạt động' : 'Tạm khóa'}</span></td><td><span class="admin-plan ${user.premium_active ? 'premium' : 'free'}">${user.premium_active ? '★ PREMIUM' : 'FREE'}</span></td><td>${formatVND(Number(user.wallet_balance_vnd || 0))}</td><td>${formatNumber(Number(user.trade_count || 0), 0)}</td><td>${user.last_login_at ? escapeHTML(formatVNTime(user.last_login_at, 'short')) : 'Chưa có'}</td><td><button class="admin-row-action" type="button" aria-label="Xem chi tiết">›</button></td></tr>`;
  }).join('');

  body.querySelectorAll('[data-admin-user-row]').forEach(row => {
    const open = () => showAdminUserDetail(row.dataset.adminUserRow);
    row.addEventListener('click', open);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function showAdminUserDetail(userId) {
  const user = adminUsersCache.find(item => String(item.user_id) === String(userId));
  const detail = document.getElementById('adminUserDetail');
  if (!user || !detail) return;
  const active = String(user.status || 'active') === 'active';
  const isSelf = String(user.user_id) === String(currentSession?.user?.id);
  detail.innerHTML = `
    <div class="admin-detail-head"><span>${escapeHTML(String(user.full_name || user.email || 'U').charAt(0).toUpperCase())}</span><div><strong>${escapeHTML(user.full_name || shortEmail(user.email || 'Người dùng'))}</strong><small>${escapeHTML(user.email || '')}</small></div></div>
    <div class="admin-detail-grid">
      <div><span>Vai trò</span><b>${user.role === 'admin' ? 'Admin' : 'Người dùng'}</b></div>
      <div><span>Trạng thái</span><b>${active ? 'Đang hoạt động' : 'Tạm khóa'}</b></div>
      <div><span>Gói hiện tại</span><b>${user.premium_active ? 'Premium' : 'Free'}</b></div>
      <div><span>Số dư ví demo</span><b>${formatVND(Number(user.wallet_balance_vnd || 0))}</b></div>
      <div><span>Số giao dịch</span><b>${formatNumber(Number(user.trade_count || 0), 0)}</b></div>
      <div><span>Ngày tạo</span><b>${user.created_at ? escapeHTML(formatVNTime(user.created_at, 'short')) : '—'}</b></div>
    </div>
    <div class="admin-detail-note">Admin chỉ quản lý trạng thái truy cập. Mật khẩu do Supabase Auth quản lý và không hiển thị tại đây.</div>
    <button id="adminToggleUserStatus" class="btn ${active ? 'danger' : 'admin-accent'} full" type="button" ${isSelf ? 'disabled title="Không thể tự khóa tài khoản"' : ''}>${active ? 'Tạm khóa tài khoản' : 'Mở khóa tài khoản'}</button>`;
  document.getElementById('adminToggleUserStatus')?.addEventListener('click', () => updateAdminUserStatus(user, active ? 'suspended' : 'active'));
}

async function updateAdminUserStatus(user, nextStatus) {
  const button = document.getElementById('adminToggleUserStatus');
  const action = nextStatus === 'suspended' ? 'tạm khóa' : 'mở khóa';
  if (!window.confirm(`Xác nhận ${action} tài khoản ${user.email}?`)) return;
  setActionBusy(button, true, 'Đang cập nhật...');
  try {
    await fetchJson(`/api/admin/users/${encodeURIComponent(user.user_id)}/status`, {
      method: 'PATCH',
      body: { status: nextStatus },
      timeout: 30000
    });
    user.status = nextStatus;
    clearAdminClientCache();
    showToast(`Đã ${action} tài khoản ${user.email}.`);
    renderAdminUsersRows(adminUsersCache);
    showAdminUserDetail(user.user_id);
  } catch (error) {
    showToast(error.message);
    setActionBusy(button, false);
  }
}

function drawAdminMarketChart(rows) {
  const el = document.getElementById('adminMarketChart');
  if (!el || !window.echarts || !rows?.length) return;
  const chart = echarts.init(el);
  charts.push(chart);
  const labels = rows.map(row => formatVNTime(row.timestamp, 'short'));
  chart.setOption({
    animation: false,
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { top: 4, right: 8, textStyle: { color: '#b9c1d3' }, data: ['OHLC', 'EMA20', 'EMA50'] },
    grid: { left: 48, right: 24, top: 42, bottom: 36 },
    xAxis: { type: 'category', data: labels, boundaryGap: true, axisLabel: { color: '#75809a', hideOverlap: true }, axisLine: { lineStyle: { color: '#263044' } } },
    yAxis: { scale: true, axisLabel: { color: '#75809a', formatter: value => `$${Math.round(value / 1000)}k` }, splitLine: { lineStyle: { color: 'rgba(117,128,154,.12)' } } },
    dataZoom: [{ type: 'inside', start: 25, end: 100 }],
    series: [
      { name: 'OHLC', type: 'candlestick', data: rows.map(row => [row.open, row.close, row.low, row.high]), itemStyle: { color: '#20d5a4', color0: '#ff7f8c', borderColor: '#20d5a4', borderColor0: '#ff7f8c' } },
      { name: 'EMA20', type: 'line', data: rows.map(row => row.ema_20), showSymbol: false, smooth: true, lineStyle: { width: 1.7, color: '#ffb873' } },
      { name: 'EMA50', type: 'line', data: rows.map(row => row.ema_50), showSymbol: false, smooth: true, lineStyle: { width: 1.4, color: '#5dc9ff' } }
    ]
  });
}

function renderSettlementPage() {
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Thực nhận</span><h1>Gộp P2P + Thuế trong một phép tính</h1><p class="lead">Trang này gọi API mới <code>/api/net-settlement</code> để tính giá áp dụng, thuế, thực nhận và so sánh với nguồn giá còn lại.</p></div></section>
    <section class="card">
      <div class="form-grid">
        <div class="field"><label>Chiều giao dịch</label><select id="settleSide"><option value="sell">Bán USDT lấy VNĐ</option><option value="buy">Mua USDT bằng VNĐ</option></select></div>
        <div class="field"><label>Số lượng</label><input id="settleAmount" type="number" min="1" value="100000000"></div>
        <div class="field"><label>Đơn vị</label><select id="settleUnit"><option value="vnd">VNĐ</option><option value="usdt">USDT</option></select></div>
        <div class="field"><label>Nguồn giá áp dụng</label><select id="settlePriceSource"><option value="p2p">Giá P2P</option><option value="market">Giá sàn quốc tế</option></select></div>
        <div class="field"><label>Quốc gia tính thuế</label><select id="settleCountry"><option value="VN">Việt Nam</option><option value="US">Hoa Kỳ</option></select></div>
        <div class="field"><label>Số ngày nắm giữ (US)</label><input id="settleHolding" type="number" min="0" value="0"></div>
      </div>
      <button id="settleSubmit" class="btn primary" style="margin-top:14px">Tính thực nhận</button>
      <div id="settleResult"></div>
    </section>`;
  document.getElementById('settleSubmit').addEventListener('click', calculateSettlement);
}

async function calculateSettlement() {
  const result = document.getElementById('settleResult');
  const amount = Number(document.getElementById('settleAmount').value);
  if (!amount || amount <= 0) { result.innerHTML = `<div class="state-box error">Số lượng phải lớn hơn 0.</div>`; return; }
  const qs = new URLSearchParams({
    amount: String(amount),
    unit: document.getElementById('settleUnit').value,
    side: document.getElementById('settleSide').value,
    price_source: document.getElementById('settlePriceSource').value,
    country: document.getElementById('settleCountry').value,
    holding_days: document.getElementById('settleHolding').value || '0'
  });
  result.innerHTML = `<div class="result-panel"><div class="skeleton" style="height:180px"></div></div>`;
  try {
    const res = await fetchJson(`/api/net-settlement?${qs.toString()}`);
    result.innerHTML = settlementResultHTML(res.data, res.source);
  } catch (error) { result.innerHTML = errorBox(error.message); }
}

function settlementResultHTML(data, source = 'api') {
  const diff = data.comparison?.difference_vnd || 0;
  const diffText = Math.abs(diff) < 1 ? 'Hai nguồn giá gần như tương đương.' : (diff > 0
    ? `Nếu dùng ${data.comparison.alt_price_source === 'market' ? 'giá sàn quốc tế' : 'giá P2P'} thay vì lựa chọn hiện tại, bạn sẽ được THÊM ${formatVND(diff)}.`
    : `Lựa chọn hiện tại tốt hơn nguồn giá còn lại khoảng ${formatVND(Math.abs(diff))}.`);
  return `
    <div class="result-panel settlement-result">
      <span class="badge blue">Kết quả thực nhận</span> ${sourcePill(source)}
      ${(data.warnings || []).map(w => `<div class="state-box error" style="margin-top:12px">${escapeHTML(w)}</div>`).join('')}
      <div class="breakdown">
        <div><span>Giá áp dụng</span><strong>${formatVND(data.applied_price)} / USDT</strong><small>Nguồn: ${data.price_source.toUpperCase()} · cập nhật ${data.applied_price_age_minutes ?? '—'} phút trước</small></div>
        <div><span>Giá trị trước thuế</span><strong>${formatVND(data.gross_amount_vnd)}</strong><small>${formatNumber(data.amount_usdt, 6)} USDT</small></div>
        <div><span>Thuế (${data.tax.country} ${formatPct(data.tax.tax_rate_pct, 3, false)})</span><strong>${formatVND(data.tax.tax_amount)}</strong><small>${escapeHTML(data.tax.note || '')}</small></div>
        <div class="total"><span>THỰC NHẬN</span><strong>${formatVND(data.net_amount_vnd)}</strong><small>${escapeHTML(data.tax.disclaimer || '')}</small></div>
      </div>
      <div class="result-panel"><strong>So sánh:</strong> ${diffText}</div>
    </div>`;
}

function renderAboutPage() {
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Về dữ liệu</span><h1>Nguồn dữ liệu và độ tin cậy</h1><p class="lead">Trang này giải thích dữ liệu đổ từ đâu vào hệ thống và vì sao cần kiểm tra độ tươi dữ liệu khi ra quyết định.</p></div></section>
    <section class="grid two">
      <div class="card"><h3>Nguồn dữ liệu</h3><ul class="report-list"><li>OHLCV BTC/USDT: Binance public API.</li><li>P2P USDT/VNĐ: Binance P2P API, có fallback API Render cũ.</li><li>Tỷ giá tham chiếu: market_price trong bảng P2P hoặc fallback USD/VND.</li><li>AI Advisor: Groq/Gemini/OpenAI tuỳ cấu hình backend .env.</li></ul></div>
      <div class="card"><h3>Pipeline cập nhật</h3><ul class="report-list"><li><code>scripts/sync_market_data.py</code> lấy dữ liệu mới.</li><li>Script tự tính RSI, MACD, EMA, Bollinger, ATR.</li><li>Dữ liệu được upsert vào Supabase.</li><li>GitHub Actions/cron chạy mỗi giờ để tự động hoá.</li></ul></div>
      <div class="card"><h3>Độ tin cậy dữ liệu</h3><p>Badge trên các trang cho biết dữ liệu cập nhật bao lâu trước. Nếu dữ liệu quá cũ, hệ thống đổi màu cam/đỏ để cảnh báo.</p></div>
      <div class="card"><h3>Miễn trừ trách nhiệm</h3><p>Đây là dự án học thuật môn Công nghệ dịch vụ tài chính, không phải khuyến nghị đầu tư, pháp lý hoặc thuế chuyên nghiệp.</p></div>
    </section>`;
}

function renderAlertsPage() {
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Cảnh báo Email</span><h1>Đặt điều kiện cảnh báo giá, RSI, P2P spread</h1><p class="lead">Backend kiểm tra rule sau mỗi lần pipeline chạy và gửi email qua Resend nếu điều kiện đạt.</p></div></section>
    <section class="split">
      <div class="card">
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field"><label>Metric</label><select id="alertMetric"><option value="price">Giá BTC</option><option value="rsi">RSI</option><option value="p2p_spread_sell">P2P Spread SELL</option><option value="p2p_spread_buy">P2P Spread BUY</option></select></div>
          <div class="field"><label>Điều kiện</label><select id="alertOperator"><option value="gt">Lớn hơn</option><option value="lt">Nhỏ hơn</option></select></div>
          <div class="field"><label>Ngưỡng</label><input id="alertThreshold" type="number" step="0.01" placeholder="VD: 65000 hoặc 70"></div>
        </div>
        <button id="alertCreate" class="btn primary full" style="margin-top:14px">Tạo cảnh báo</button>
        <div class="meta">Giới hạn 5 rule đang bật/tài khoản để tránh spam email.</div>
      </div>
      <div class="card"><h3>Rule hiện có</h3><div id="alertList">${loadingCard(220)}</div></div>
    </section>`;
  document.getElementById('alertCreate').addEventListener('click', createAlertRuleUI);
  loadAlertsUI();
}

async function createAlertRuleUI() {
  const threshold = Number(document.getElementById('alertThreshold').value);
  if (!Number.isFinite(threshold)) { showToast('Vui lòng nhập ngưỡng hợp lệ.'); return; }
  try {
    await fetchJson('/api/alerts', { method: 'POST', body: { metric: document.getElementById('alertMetric').value, operator: document.getElementById('alertOperator').value, threshold, active: true } });
    showToast('Đã đặt cảnh báo, hệ thống kiểm tra tự động mỗi giờ.');
    await loadAlertsUI();
  } catch (error) { showToast(error.message); }
}

async function loadAlertsUI() {
  const box = document.getElementById('alertList');
  if (!box) return;
  try {
    const res = await fetchJson('/api/alerts');
    const rows = res.data.data || [];
    box.innerHTML = rows.length ? rows.map(r => `<div class="order-row"><div><strong>${escapeHTML(r.metric)}</strong><div class="meta">${r.operator} ${formatNumber(Number(r.threshold), 3)} · ${r.active ? 'Đang bật' : 'Đã tắt'}</div></div><div><button class="btn small secondary" data-alert-toggle="${r.id}" data-active="${r.active}">${r.active ? 'Tắt' : 'Bật'}</button><button class="btn small danger" data-alert-delete="${r.id}">Xóa</button></div></div>`).join('') : `<div class="state-box empty">Chưa có cảnh báo.</div>`;
    document.querySelectorAll('[data-alert-toggle]').forEach(btn => btn.addEventListener('click', async () => { await fetchJson(`/api/alerts/${btn.dataset.alertToggle}`, { method: 'PATCH', body: { active: btn.dataset.active !== 'true' } }); loadAlertsUI(); }));
    document.querySelectorAll('[data-alert-delete]').forEach(btn => btn.addEventListener('click', async () => { await fetchJson(`/api/alerts/${btn.dataset.alertDelete}`, { method: 'DELETE' }); loadAlertsUI(); }));
  } catch (error) { box.innerHTML = errorBox(error.message); }
}


function walletStatusBadge(status) {
  const value = String(status || 'pending').toLowerCase();
  if (value === 'success') return '<span class="badge green">Thành công</span>';
  if (value === 'failed') return '<span class="badge red">Thất bại</span>';
  return '<span class="badge amber">Đang chờ</span>';
}

function walletTransactionHTML(row) {
  const amount = Number(row.amount_vnd || 0);
  const sign = amount > 0 ? '+' : '';
  return `
    <div class="order-row wallet-tx-row">
      <div>
        <strong>${escapeHTML(row.description || row.type || 'Giao dịch ví')}</strong>
        <div class="meta">${formatVNTime(row.created_at)}${row.ref_id ? ` · ${escapeHTML(row.ref_id)}` : ''}</div>
      </div>
      <div class="wallet-tx-amount ${amount >= 0 ? 'positive' : 'negative'}">
        ${sign}${formatVND(amount)}
        <small>Sau GD: ${row.balance_after_vnd == null ? '—' : formatVND(row.balance_after_vnd)}</small>
      </div>
    </div>`;
}

async function renderWalletPage() {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const txnRef = params.get('txn_ref');
  const paid = params.get('wallet_paid');
  const verified = params.get('verified');
  app.innerHTML = `
    <section class="page-head">
      <div>
        <span class="eyebrow">Ví điện tử demo</span>
        <h1>Nạp ví bằng QR Code demo không mất phí</h1>
        <p class="lead">Mô phỏng ví điện tử và thanh toán QR trong phạm vi học phần. Mã QR chỉ dùng để minh họa, không mở giao dịch ngân hàng thật.</p>
      </div>
      <div class="page-actions"><a class="btn secondary" href="#billing">Mua gói Sandbox</a></div>
    </section>
    ${txnRef ? `<section class="state-box ${paid === '1' ? 'success' : 'error'}"><strong>Kết quả nạp ví:</strong> ${paid === '1' ? 'Giao dịch thành công.' : 'Giao dịch thất bại hoặc chưa xác thực.'} <span class="meta">TxnRef: ${escapeHTML(txnRef)} · chữ ký ${verified === '1' ? 'hợp lệ' : 'không hợp lệ'}</span></section>` : ''}
    <section class="wallet-grid">
      <div class="card wallet-balance-card" id="walletBalanceCard">${loadingCard(120)}</div>
      <div class="card">
        <span class="badge blue">QR Demo</span>
        <h2>Nạp ví demo không mất phí</h2>
        <p class="meta">Tạo QR nội bộ cho bài học. Sau khi quét/quan sát QR, bấm “Xác nhận thanh toán demo” để cộng số dư ví.</p>
        <div class="quick-amounts" id="walletQuickAmounts">
          <button class="btn small secondary" data-wallet-amount="10000">10.000đ</button>
          <button class="btn small secondary" data-wallet-amount="50000">50.000đ</button>
          <button class="btn small secondary" data-wallet-amount="100000">100.000đ</button>
          <button class="btn small secondary" data-wallet-amount="500000">500.000đ</button>
        </div>
        <div class="field" style="margin-top:12px"><label>Số tiền muốn nạp</label><input id="walletAmount" type="number" min="10000" step="10000" value="50000"></div>
        <button id="walletCreateTopup" class="btn primary full" style="margin-top:14px">Tạo QR nạp ví</button>
      </div>
      <div class="card wallet-qr-card" id="walletQrCard">
        <span class="badge neutral">Chưa tạo QR</span>
        <h3>QR Code thanh toán</h3>
        <div class="qr-placeholder">Nhập số tiền và bấm “Tạo QR nạp ví”.</div>
      </div>
      <div class="card">
        <h3>Lịch sử ví</h3>
        <div id="walletTransactions">${loadingCard(180)}</div>
      </div>
    </section>
    <section class="card">
      <h3>Liên hệ học phần</h3>
      <div class="feature-grid compact">
        <div><strong>Ví điện tử</strong><span>Nạp tiền vào tài khoản trực tuyến và dùng số dư để thanh toán dịch vụ demo.</span></div>
        <div><strong>QR Code</strong><span>Minh họa thanh toán không tiếp xúc qua mã QR thay cho tiền mặt.</span></div>
        <div><strong>Payment Gateway</strong><span>Project hỗ trợ chế độ demo nội bộ không mất phí; có thể chuyển sang VNPay Sandbox khi có key test.</span></div>
      </div>
    </section>`;
  document.querySelectorAll('[data-wallet-amount]').forEach(btn => btn.addEventListener('click', () => {
    document.getElementById('walletAmount').value = btn.dataset.walletAmount;
  }));
  document.getElementById('walletCreateTopup').addEventListener('click', createWalletTopupUI);
  await loadWalletUI();
}

async function loadWalletUI() {
  const balanceBox = document.getElementById('walletBalanceCard');
  const txBox = document.getElementById('walletTransactions');
  if (!balanceBox || !txBox) return;
  try {
    const res = await fetchJson('/api/wallet/me');
    const wallet = res.data.wallet || {};
    const rows = res.data.transactions || [];
    balanceBox.innerHTML = `
      <span class="badge violet">Số dư demo</span>
      <h2>${formatVND(Number(wallet.balance_vnd || 0))}</h2>
      <p>USDT demo: <strong>${formatNumber(Number(wallet.balance_usdt_demo || 0), 4)} USDT</strong></p>
      <p class="meta">${escapeHTML(res.data.disclaimer || 'Ví demo phục vụ học phần, không phát sinh tiền thật.')}</p>`;
    txBox.innerHTML = rows.length ? rows.map(walletTransactionHTML).join('') : `<div class="state-box empty">Chưa có giao dịch ví.</div>`;
  } catch (error) {
    balanceBox.innerHTML = errorBox(error.message);
    txBox.innerHTML = errorBox(error.message);
  }
}

async function createWalletTopupUI() {
  const amount = Number(document.getElementById('walletAmount').value);
  const qrCard = document.getElementById('walletQrCard');
  if (!Number.isFinite(amount) || amount < 10000) {
    showToast('Số tiền nạp tối thiểu là 10.000đ.');
    return;
  }
  qrCard.innerHTML = `<span class="badge amber">Đang tạo</span><h3>QR Code demo</h3>${loadingCard(180)}`;
  try {
    const res = await fetchJson('/api/wallet/topup/create', { method: 'POST', body: { amount_vnd: amount }, timeout: 30000 });
    const paymentMode = res.data.payment_mode || 'demo';
    const isDemo = paymentMode === 'demo';
    const qrPayload = res.data.qr_payload || res.data.payment_url || res.data.txn_ref;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 2, scale: 7 });
    qrCard.innerHTML = `
      <span class="badge ${isDemo ? 'violet' : 'green'}">${isDemo ? 'Demo không mất phí' : 'VNPay Sandbox'}</span>
      <h3>Nạp ${formatVND(amount)}</h3>
      <div class="wallet-qr-wrap"><img src="${qrDataUrl}" alt="QR nạp ví demo"></div>
      <p class="meta">TxnRef: ${escapeHTML(res.data.txn_ref)} · ${isDemo ? 'QR nội bộ phục vụ minh họa học phần, không dùng app ngân hàng thật.' : 'QR chứa payment URL của VNPay Sandbox.'}</p>
      ${isDemo ? `
        <button class="btn primary full" id="walletDemoConfirm">Xác nhận thanh toán demo, không mất phí</button>
        <p class="meta">Nút này mô phỏng payment gateway trả kết quả thành công và cộng số dư ví demo.</p>
      ` : `
        <a class="btn primary full" href="${res.data.payment_url}" target="_blank" rel="noopener">Mở trang thanh toán Sandbox</a>
      `}
      <button class="btn secondary full" id="walletCheckTopup" style="margin-top:10px">Kiểm tra trạng thái</button>`;
    document.getElementById('walletCheckTopup').addEventListener('click', async () => {
      await checkWalletTopupStatus(res.data.txn_ref);
    });
    document.getElementById('walletDemoConfirm')?.addEventListener('click', async () => {
      await confirmWalletTopupDemo(res.data.txn_ref);
    });
  } catch (error) {
    qrCard.innerHTML = `<span class="badge red">Lỗi</span><h3>Không tạo được QR</h3>${errorBox(error.message)}<p class="meta">Kiểm tra đăng nhập, Supabase và bảng ví. Chế độ mặc định là demo không mất phí nên không cần key VNPay.</p>`;
  }
}

async function confirmWalletTopupDemo(txnRef) {
  try {
    const res = await fetchJson('/api/wallet/topup/demo-confirm', { method: 'POST', body: { txn_ref: txnRef }, timeout: 30000 });
    showToast(res.data.message || 'Đã xác nhận thanh toán demo.');
    await loadWalletUI();
    const qrCard = document.getElementById('walletQrCard');
    if (qrCard) {
      qrCard.insertAdjacentHTML('afterbegin', `<div class="state-box success"><strong>Đã cộng ví demo.</strong> Giao dịch này không phát sinh tiền thật.</div>`);
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function checkWalletTopupStatus(txnRef) {
  try {
    const res = await fetchJson(`/api/wallet/topup/status?txn_ref=${encodeURIComponent(txnRef)}`);
    showToast(`Trạng thái nạp ví: ${res.data.status}`);
    await loadWalletUI();
  } catch (error) {
    showToast(error.message);
  }
}

function formatDateTimeVN(value) {
  if (!value) return 'Không giới hạn trong bản demo';
  try {
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch (_) {
    return String(value);
  }
}

function premiumFeatureCards() {
  return [
    { badge: 'AI Advisor', title: 'Kịch bản AI nâng cao', text: 'Hỏi AI theo dữ liệu kỹ thuật, P2P, thuế/phí và trạng thái rủi ro thị trường.' },
    { badge: 'Alerts', title: 'Cảnh báo nâng cao', text: 'Theo dõi tín hiệu giá, risk score và chênh lệch P2P để demo quy trình hỗ trợ quyết định.' },
    { badge: 'Data', title: 'Lịch sử dữ liệu sâu hơn', text: 'Truy cập biểu đồ kỹ thuật, trạng thái dữ liệu và lịch sử phân tích phục vụ báo cáo.' },
    { badge: 'Report', title: 'Xuất báo cáo phân tích', text: 'Mô phỏng gói mở rộng: tổng hợp nhận định, chi phí, P2P spread và kết quả trading demo.' }
  ];
}

function persistPremiumSubscription(data) {
  try { localStorage.setItem('btc_premium_subscription', JSON.stringify(data)); } catch (_) { }
}

async function getPremiumSubscription() {
  const res = await fetchJson('/api/payment/subscription');
  if (res?.data) persistPremiumSubscription(res.data);
  return res.data;
}

async function renderBillingPage() {
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Gói dịch vụ</span><h1>Premium Sandbox</h1><p class="lead">Quản lý gói demo cho BTC BigData Platform. Thanh toán sandbox và hủy gói đều không phát sinh tiền thật.</p></div></section>
    <section id="billingContent">${loadingCard(180)}</section>`;
  const box = document.getElementById('billingContent');
  try {
    const subscription = await getPremiumSubscription();
    if (subscription?.active) renderPremiumActiveBilling(box, subscription);
    else renderFreeBilling(box);
  } catch (error) {
    box.innerHTML = `<div class="state-box error">Không tải được trạng thái gói: ${escapeHTML(error.message)}</div><div style="margin-top:14px">${freeBillingMarkup()}</div>`;
    bindFreeBillingActions();
  }
}

function freeBillingMarkup() {
  return `
    <section class="grid two">
      <div class="card"><span class="badge neutral">Free</span><h2>Gói miễn phí</h2><p>Dashboard, giá BTC/USDT, P2P spread, công cụ thuế/thực nhận và AI cơ bản phục vụ học phần.</p><ul class="report-list"><li>Xem dữ liệu thị trường và biểu đồ kỹ thuật cơ bản.</li><li>Sử dụng ví QR demo và trading demo không phát sinh tiền thật.</li><li>Phù hợp người dùng mới trải nghiệm nền tảng.</li></ul></div>
      <div class="card premium-plan-card"><span class="badge violet">Premium Sandbox</span><h2>49.000đ/tháng</h2><p>Dùng thử 7 ngày, sau đó có thể nâng cấp gói trả phí dự kiến. Bản hiện tại chỉ mô phỏng sandbox.</p><ul class="report-list"><li>Phân tích kỹ thuật nâng cao và theo dõi chênh lệch P2P.</li><li>Cảnh báo nâng cao, AI Advisor và ước tính chi phí/thuế.</li><li>Lịch sử dữ liệu sâu hơn và mô phỏng xuất báo cáo phân tích.</li></ul><button id="buyPremium" class="btn primary full" style="margin-top:14px">Nâng cấp qua VNPay Sandbox</button><a class="btn secondary full" href="#wallet" style="margin-top:10px">Nạp ví demo bằng QR Code</a></div>
    </section>`;
}

function renderFreeBilling(box) { box.innerHTML = freeBillingMarkup(); bindFreeBillingActions(); }

function bindFreeBillingActions() {
  document.getElementById('buyPremium')?.addEventListener('click', async () => {
    try {
      const button = document.getElementById('buyPremium');
      if (button) { button.disabled = true; button.textContent = 'Đang tạo thanh toán sandbox...'; }
      const res = await fetchJson('/api/payment/create', { method: 'POST', body: { plan_id: 'premium_monthly' }, timeout: 30000 });
      showToast('Đã tạo yêu cầu thanh toán Sandbox. Đang chuyển sang VNPay...');
      window.location.href = res.data.payment_url;
    } catch (error) {
      showToast(error.message);
      const button = document.getElementById('buyPremium');
      if (button) { button.disabled = false; button.textContent = 'Nâng cấp qua VNPay Sandbox'; }
    }
  });
}

function renderPremiumActiveBilling(box, subscription) {
  const expiresAt = subscription.expires_at || subscription.subscription?.expires_at;
  const planName = subscription.plan_name || subscription.plan?.name || 'Premium Sandbox';
  box.innerHTML = `
    <section class="premium-hero card"><div><span class="badge green">Premium đang hoạt động</span><h2>Bạn đã đăng ký ${escapeHTML(planName)}</h2><p>Gói Premium Sandbox đã được kích hoạt sau thanh toán demo. Đây là trạng thái mô phỏng phục vụ học phần, không phát sinh tiền thật.</p><div class="kpi-row" style="margin-top:16px"><div class="stat-card"><span class="stat-label">Trạng thái</span><strong class="stat-value">Active</strong><div class="stat-note">Premium Sandbox</div></div><div class="stat-card"><span class="stat-label">Hết hạn</span><strong class="stat-value" style="font-size:18px">${escapeHTML(formatDateTimeVN(expiresAt))}</strong><div class="stat-note">Có thể hủy bất kỳ lúc nào</div></div><div class="stat-card"><span class="stat-label">Thanh toán</span><strong class="stat-value">Demo</strong><div class="stat-note">VNPay Sandbox</div></div></div><div class="hero-actions" style="margin-top:18px"><a class="btn primary" href="#dashboard">Mở Dashboard Premium</a><a class="btn accent" href="#alerts">Tạo cảnh báo</a><a class="btn secondary" href="#chat">Hỏi AI Advisor</a><button id="cancelPremium" class="btn danger">Hủy Premium, quay về Free</button></div></div></section>
    <section class="grid four" style="margin-top:18px">${premiumFeatureCards().map(item => `<article class="card premium-feature-card"><span class="badge violet">${escapeHTML(item.badge)}</span><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.text)}</p></article>`).join('')}</section>
    <section class="card" style="margin-top:18px"><span class="badge amber">Minh bạch</span><h3>Ghi chú phạm vi demo</h3><p>Premium Sandbox chỉ dùng để minh họa mô hình Subscription/Free Trial trong báo cáo. Các tính năng AI, cảnh báo, ước tính thuế và trading demo chỉ hỗ trợ tham khảo, không phải tư vấn đầu tư hoặc giao dịch tài chính thật.</p></section>`;
  document.getElementById('cancelPremium')?.addEventListener('click', cancelPremiumSubscription);
}

async function cancelPremiumSubscription() {
  const ok = window.confirm('Bạn muốn hủy Premium Sandbox và quay lại gói Free? Thao tác này chỉ ảnh hưởng trạng thái demo, không phát sinh hoàn tiền thật.');
  if (!ok) return;
  try {
    const button = document.getElementById('cancelPremium');
    if (button) { button.disabled = true; button.textContent = 'Đang hủy Premium...'; }
    const res = await fetchJson('/api/payment/cancel-subscription', { method: 'POST', timeout: 30000 });
    persistPremiumSubscription(res.data || { active: false, plan_id: 'free' });
    showToast(res.data?.message || 'Đã hủy Premium Sandbox. Tài khoản quay về gói Free.');
    await renderBillingPage();
  } catch (error) {
    showToast(error.message);
    const button = document.getElementById('cancelPremium');
    if (button) { button.disabled = false; button.textContent = 'Hủy Premium, quay về Free'; }
  }
}

async function renderPaymentResultPage() {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const txnRef = params.get('txn_ref');
  const returnedStatus = params.get('status');
  app.innerHTML = `<section class="page-head"><div><span class="eyebrow">Kết quả thanh toán</span><h1>VNPay Sandbox</h1><p class="lead">Thanh toán sandbox không phát sinh tiền thật. Hệ thống kiểm tra lại trạng thái đơn hàng từ backend.</p></div></section><section id="paymentResult">${loadingCard(180)}</section>`;
  const box = document.getElementById('paymentResult');
  if (!txnRef) { box.innerHTML = `<div class="state-box error">Thiếu mã giao dịch.</div>`; return; }
  try {
    const res = await fetchJson(`/api/payment/status?txn_ref=${encodeURIComponent(txnRef)}`);
    const status = res.data.status || returnedStatus;
    if (status === 'success') {
      try { persistPremiumSubscription(await getPremiumSubscription()); } catch (_) { persistPremiumSubscription({ active: true, plan_id: res.data.plan_id, plan_name: 'Premium Sandbox' }); }
      showToast('Thanh toán Sandbox thành công. Premium đã được kích hoạt.');
      box.innerHTML = `<div class="card payment-success-card"><span class="badge green">Thanh toán thành công</span><h2>Premium Sandbox đã được kích hoạt</h2><p>Đơn hàng: <strong>${escapeHTML(txnRef)}</strong></p><p>Gói: ${escapeHTML(res.data.plan_id)} · Số tiền demo: ${formatVND(res.data.amount_vnd)}</p><div class="grid three" style="margin-top:16px"><div class="card"><span class="badge violet">AI</span><h3>AI Advisor</h3><p>Mở kịch bản hỏi đáp nâng cao theo dữ liệu kỹ thuật, P2P và thuế/phí.</p></div><div class="card"><span class="badge amber">Alerts</span><h3>Cảnh báo</h3><p>Tạo cảnh báo mô phỏng cho giá, risk score và P2P spread.</p></div><div class="card"><span class="badge blue">Report</span><h3>Báo cáo</h3><p>Mô phỏng xuất báo cáo và lịch sử dữ liệu sâu hơn trong gói Premium.</p></div></div><div class="hero-actions" style="margin-top:18px"><a class="btn primary" href="#dashboard">Vào Dashboard Premium</a><a class="btn accent" href="#billing">Quản lý gói Premium</a><a class="btn secondary" href="#alerts">Tạo cảnh báo</a></div><p class="meta">Đây là thanh toán VNPay Sandbox/demo, không phát sinh tiền thật.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="card"><span class="badge ${status === 'failed' ? 'red' : 'amber'}">${escapeHTML(status || 'pending')}</span><h2>Đơn hàng ${escapeHTML(txnRef)}</h2><p>Gói: ${escapeHTML(res.data.plan_id)} · Số tiền: ${formatVND(res.data.amount_vnd)}</p><p>Sandbox VNPay — không phải tiền thật.</p><div class="hero-actions" style="margin-top:14px"><a class="btn secondary" href="#billing">Quay lại trang gói</a></div></div>`;
  } catch (error) { box.innerHTML = errorBox(error.message); }
}
