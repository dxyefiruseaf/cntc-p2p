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
let currentTradePreview = null;
let chatMessages = [
  {
    role: 'ai',
    text: 'Xin chào! Tôi là AI Advisor của BTC BigData. Bạn có thể hỏi: “Giờ nên mua hay bán?”, “Bán P2P có thiệt không?”, hoặc “Bán 100 triệu thì thuế bao nhiêu?”.'
  }
];
let orders = [];
let currentSession = null;
let authReady = !supabaseAuth;
let topTickerBusy = false;
let lastTopTickerAt = 0;
let liveNewsTickerBusy = false;
let passwordSavingInProgress = false;
const protectedRoutes = new Set(['history', 'alerts', 'billing', 'wallet', 'set-password', 'account', 'decision', 'trade', 'settlement']);
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
  about: renderAboutPage,
  'payment-result': renderPaymentResultPage
};

menuToggle?.addEventListener('click', () => sideNav?.classList.toggle('open'));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.side-nav') && !event.target.closest('.menu-toggle')) sideNav?.classList.remove('open');
});
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

function route() {
  disposeCharts();
  activeRoute = getCurrentRouteName();
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
  document.querySelectorAll('[data-route]').forEach(el => el.classList.toggle('active', el.dataset.route === activeRoute));
  document.querySelectorAll('[data-nav-group]').forEach(el => {
    const routeList = (el.dataset.routes || '').split(',').map(x => x.trim()).filter(Boolean);
    el.classList.toggle('active', routeList.includes(activeRoute));
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
    <section class="page-head">
      <div><span class="eyebrow">Dashboard minh chứng</span><h1>Thị trường Bitcoin trong 5 giây</h1><p class="lead">Dashboard này là sản phẩm mẫu của mô hình kinh doanh: người dùng thấy giá, tín hiệu tổng hợp, chỉ báo chi tiết và biểu đồ nhanh.</p></div>
      <button class="btn primary" id="refreshDashboard">Làm mới dữ liệu</button>
    </section>
    <section id="dashboardContent" class="grid"><div class="grid three">${loadingCard(180)}${loadingCard(180)}${loadingCard(180)}</div>${loadingCard(300)}</section>
  `;
  document.getElementById('refreshDashboard').addEventListener('click', renderDashboardPage);
  try {
    const [latestRes, summaryRes, ohlcvRes, riskRes, alertsRes] = await Promise.all([
      fetchJson('/api/latest'),
      fetchJson('/api/indicators/summary'),
      fetchJson('/api/ohlcv?hours=24'),
      fetchJson('/api/risk-score'),
      fetchJson('/api/market-alerts')
    ]);
    const latest = latestRes.data;
    const summary = summaryRes.data;
    const ohlcv = ohlcvRes.data;
    const risk = riskRes.data;
    const alerts = alertsRes.data.data || [];
    const change = latest.open ? ((latest.close - latest.open) / latest.open) * 100 : 0;
    const verdict = summary.overall?.verdict || 'NEUTRAL';
    const signals = summary.signals || {};
    document.getElementById('dashboardContent').innerHTML = `
      <div class="kpi-row">
        <div class="stat-card"><span class="stat-label">BTC/USDT</span><strong class="stat-value">${formatUSD(latest.close)}</strong><div class="stat-note">${formatPct(change)} trong nến hiện tại · ${sourcePill(latestRes.source)}</div></div>
        <div class="stat-card"><span class="stat-label">Khuyến nghị tổng hợp</span><strong class="stat-value">${badge(verdict)}</strong><div class="stat-note">${summary.overall?.buy || 0} MUA · ${summary.overall?.sell || 0} BÁN · ${summary.overall?.neutral || 0} TRUNG LẬP</div></div>
        <div class="stat-card"><span class="stat-label">Risk Score</span><strong class="stat-value">${risk.score}/100</strong><div class="stat-note">${escapeHTML(risk.label_vi || risk.level)} · <a href="#risk">Xem cảnh báo</a></div></div>
        <div class="stat-card"><span class="stat-label">Cập nhật</span><strong class="stat-value" style="font-size:1.7rem">${formatVNTime(latest.timestamp)}</strong><div class="stat-note">Hiển thị theo giờ Việt Nam UTC+7</div></div>
        <div class="stat-card"><span class="stat-label">Volume</span><strong class="stat-value">${formatNumber(latest.volume, 2)}</strong><div class="stat-note">BTC · ${formatNumber(latest.trades, 0)} lệnh</div></div>
      </div>
      <div class="grid four section">
        ${['RSI', 'MACD', 'Bollinger', 'EMA_Trend'].map(key => {
      const s = signals[key] || { value: null, signal: 'NEUTRAL', note: 'Chưa có dữ liệu' };
      return `<div class="card"><h3>${key.replace('_', ' ')}</h3><p>${badge(s.signal)}</p><p style="margin-top:10px">${escapeHTML(s.note)}</p><div class="meta">Giá trị: ${formatNumber(s.value, 2)}</div></div>`;
    }).join('')}
      </div>
      <div class="grid two section">
        <div class="card">
          <div class="section-head"><div><h2>Biến động 24 giờ gần nhất</h2><p>Đường giá đóng cửa dùng để xem nhanh xu hướng trong ngày.</p></div><a class="btn secondary" href="#chart">Xem biểu đồ chi tiết</a></div>
          <div id="miniChart" class="chart-box small"></div>
        </div>
        <div class="card">
          <div class="section-head"><div><h2>Cảnh báo nhanh</h2><p>Rule-based alerts giúp người dùng không cần tự đọc toàn bộ bảng chỉ báo.</p></div><a class="btn secondary" href="#risk">Chi tiết</a></div>
          ${marketAlertsHTML(alerts.slice(0, 4))}
        </div>
      </div>
    `;
    drawLineChart('miniChart', ohlcv.data || [], 'close', 'Giá đóng cửa BTC/USDT');
  } catch (error) {
    document.getElementById('dashboardContent').innerHTML = errorBox(error.message);
  }
}

async function renderChartPage() {
  app.innerHTML = `
    <section class="page-head">
      <div><span class="eyebrow">Biểu đồ kỹ thuật</span><h1>OHLCV, EMA, RSI và MACD</h1><p class="lead">Trang phục vụ phần demo frontend: đổi khung thời gian sẽ gọi lại <code>/api/ohlcv?hours=N</code>.</p></div>
      <div class="segmented" id="chartHours">
        <button data-hours="24">24H</button><button data-hours="168">7 ngày</button><button data-hours="720">30 ngày</button>
      </div>
    </section>
    <section id="chartContent">${loadingCard(620)}</section>
  `;
  document.querySelectorAll('#chartHours button').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.hours) === chartHours);
    btn.addEventListener('click', () => { chartHours = Number(btn.dataset.hours); renderChartPage(); });
  });
  try {
    const [res, p2pRes] = await Promise.all([
      fetchJson(`/api/ohlcv?hours=${chartHours}`),
      fetchJson(`/api/p2p-spread?hours=${chartHours}`, { timeout: 30000 })
    ]);
    document.getElementById('chartContent').innerHTML = `
      <div class="card">
        <div class="section-head"><div><h2>BTC/USDT + Giá BTC theo P2P · ${chartHours} giờ gần nhất</h2><p>Số nến: ${res.data.count} · OHLCV ${sourcePill(res.source)} · P2P ${sourcePill(p2pRes.source)}. Hai đường P2P được quy đổi: <code>giá BTC/USDT × giá USDT/VNĐ P2P</code>.</p></div></div>
        <div id="technicalChart" class="chart-box large"></div>
        <p class="chart-note">Đường nến vẫn là BTC/USDT theo USD. Hai đường P2P dùng trục VNĐ bên phải để thể hiện giá mua/bán Bitcoin ước tính qua thị trường P2P.</p>
      </div>
    `;
    drawTechnicalChart('technicalChart', res.data.data || [], p2pRes.data.data || []);
  } catch (error) {
    document.getElementById('chartContent').innerHTML = errorBox(error.message);
  }
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
      <div class="chat-input">
        <div class="field"><input id="chatInput" type="text" placeholder="Nhập câu hỏi của bạn..."></div>
        <button id="chatSend" class="btn primary">Gửi</button>
      </div>
    </section>
  `;
  renderMessages();
  document.getElementById('chatSend').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  document.querySelectorAll('[data-question]').forEach(btn => btn.addEventListener('click', () => {
    document.getElementById('chatInput').value = btn.dataset.question;
    sendChat();
  }));
}

function renderMessages() {
  const box = document.getElementById('messages');
  if (!box) return;
  box.innerHTML = chatMessages.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${escapeHTML(m.text)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
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
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Lịch sử theo tài khoản</span><h1>Lịch sử AI và sàn giao dịch ảo</h1><p class="lead">Trang này yêu cầu đăng nhập. Lịch sử được đọc từ Supabase theo access token, không còn phụ thuộc localStorage.</p></div></section>
    <section class="card">
      <div class="segmented" id="historyTabs"><button data-tab="ai" class="active">Lịch sử AI</button><button data-tab="trades">Lịch sử sàn ảo</button></div>
      <div id="historyContent" style="margin-top:16px">${loadingCard(360)}</div>
    </section>
  `;
  document.querySelectorAll('#historyTabs button').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('#historyTabs button').forEach(b => b.classList.toggle('active', b === btn));
    if (btn.dataset.tab === 'ai') loadAccountAIHistory(); else loadAccountTradeHistory();
  }));
  await loadAccountAIHistory();
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
    box.innerHTML = rows.length ? `<div class="trade-history">${rows.map(tradeRowHTML).join('')}</div>` : `<div class="state-box empty">Chưa có lệnh giao dịch trên sàn ảo.</div>`;
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
  app.innerHTML = `
    <section class="page-head decision-page-head decision-hero-pro">
      <div>
        <span class="eyebrow">Decision Hub · Đăng nhập bắt buộc</span>
        <h1>Trung tâm hỗ trợ quyết định Bitcoin</h1>
        <p class="lead">Bộ công cụ dành cho tài khoản đã đăng nhập: lập kế hoạch mua/bán, theo dõi danh mục demo, cảnh báo thông minh, tính thực nhận VNĐ và AI giải thích giao dịch.</p>
        <div class="decision-hero-tags"><span>Không đặt lệnh thật</span><span>Dữ liệu tham khảo</span><span>Lưu cục bộ theo trình duyệt</span></div>
      </div>
      <div class="decision-hero-panel">
        <strong>Quy trình sử dụng</strong>
        <ol>
          <li>Kiểm tra Risk Score và giá P2P.</li>
          <li>Lập kế hoạch mua/bán phù hợp vốn.</li>
          <li>Lưu lệnh từ sàn giao dịch ảo để theo dõi PnL.</li>
          <li>Đặt cảnh báo và nhờ AI giải thích.</li>
        </ol>
      </div>
    </section>

    <section class="decision-feature-grid pro">
      <article class="decision-feature-card"><span>🧭</span><strong>Buy/Sell Plan</strong><p>Lập kế hoạch theo vốn, P2P, Risk Score và khẩu vị rủi ro.</p></article>
      <article class="decision-feature-card"><span>💼</span><strong>Portfolio PnL</strong><p>Theo dõi BTC demo, giá vốn trung bình và lời/lỗ tạm tính.</p></article>
      <article class="decision-feature-card"><span>🔔</span><strong>Smart Alerts</strong><p>Cảnh báo giá, RSI, Risk Score và P2P spread theo ngưỡng.</p></article>
      <article class="decision-feature-card"><span>💸</span><strong>Real VNĐ</strong><p>Ước tính số tiền nhận/mua theo BTC và P2P USDT/VNĐ.</p></article>
      <article class="decision-feature-card"><span>🤖</span><strong>AI Explanation</strong><p>AI tóm tắt bối cảnh, rủi ro và kế hoạch tham khảo.</p></article>
    </section>

    <section class="decision-layout">
      <article class="card decision-card decision-card-large" id="buySellPlanCard">
        <div class="decision-card-head"><span class="step-badge">1</span><div><h3>Buy/Sell Plan Builder</h3><p>Lập kế hoạch trước khi vào lệnh. Công cụ chỉ mô phỏng, không gửi lệnh thật.</p></div></div>
        <div class="decision-form-grid plan-grid">
          <div class="field"><label>Hành động</label><select id="planAction"><option value="buy">Mua BTC</option><option value="sell">Bán BTC</option><option value="observe">Quan sát thêm</option></select></div>
          <div class="field"><label>Vốn/Số lượng</label><input id="planAmount" type="number" min="0" step="0.00000001" value="5000000"></div>
          <div class="field"><label>Đơn vị</label><select id="planUnit"><option value="vnd">VNĐ</option><option value="btc">BTC</option></select></div>
          <div class="field"><label>Khẩu vị rủi ro</label><select id="planProfile"><option value="safe">An toàn</option><option value="moderate" selected>Trung bình</option><option value="aggressive">Rủi ro cao</option></select></div>
        </div>
        <button id="planBuildBtn" class="btn primary full">Tạo kế hoạch tham khảo</button>
        <div id="planResult" class="decision-result compact"></div>
      </article>

      <article class="card decision-card decision-card-large" id="portfolioCard">
        <div class="decision-card-head"><span class="step-badge blue">2</span><div><h3>Portfolio PnL Tracker</h3><p>Danh mục demo lưu trong trình duyệt để theo dõi giá vốn/lời lỗ. Đăng nhập giúp tính năng nằm trong khu vực tài khoản.</p></div></div>
        <div id="portfolioSummary" class="decision-result compact">${loadingCard(110)}</div>
        <div class="decision-form-grid portfolio-grid">
          <div class="field"><label>Loại giao dịch</label><select id="portfolioSide"><option value="BUY">Mua BTC</option><option value="SELL">Bán BTC</option></select></div>
          <div class="field"><label>Số tiền VNĐ</label><input id="portfolioVnd" type="number" min="0" value="1000000"></div>
          <div class="field"><label>Ghi chú</label><input id="portfolioNote" type="text" placeholder="VD: DCA tuần 1"></div>
        </div>
        <div class="hero-actions"><button id="portfolioAddBtn" class="btn primary">Thêm giao dịch demo</button><button id="portfolioClearBtn" class="btn secondary">Xóa danh mục</button></div>
        <div id="portfolioList" class="trade-history decision-list"></div>
      </article>

      <article class="card decision-card" id="smartAlertCard">
        <div class="decision-card-head"><span class="step-badge amber">3</span><div><h3>Smart Alert Center</h3><p>Cảnh báo cục bộ theo dữ liệu hiện tại. Nếu cần email tự động, dùng trang Cảnh báo Email.</p></div></div>
        <div class="decision-form-grid alert-grid">
          <div class="field"><label>Metric</label><select id="smartMetric"><option value="price">BTC/USDT</option><option value="rsi">RSI</option><option value="risk">Risk Score</option><option value="p2p_sell">P2P SELL</option><option value="p2p_buy">P2P BUY</option></select></div>
          <div class="field"><label>Điều kiện</label><select id="smartOperator"><option value="gt">Lớn hơn</option><option value="lt">Nhỏ hơn</option></select></div>
          <div class="field"><label>Ngưỡng</label><input id="smartThreshold" type="number" step="0.01" placeholder="VD: 65000, 70"></div>
        </div>
        <div class="hero-actions"><button id="smartAddBtn" class="btn primary">Thêm cảnh báo</button><button id="smartCheckBtn" class="btn secondary">Kiểm tra ngay</button><a class="btn secondary" href="#alerts">Cảnh báo Email</a></div>
        <div id="smartAlertList" class="decision-result compact"></div>
      </article>

      <article class="card decision-card" id="realVndCard">
        <div class="decision-card-head"><span class="step-badge green">4</span><div><h3>Real VNĐ Received Calculator</h3><p>Tính nhanh số VNĐ ước tính khi bán BTC hoặc chi phí khi mua BTC qua P2P.</p></div></div>
        <div class="decision-form-grid real-grid">
          <div class="field"><label>Chiều</label><select id="realSide"><option value="sell">Bán BTC lấy VNĐ</option><option value="buy">Mua BTC bằng VNĐ</option></select></div>
          <div class="field"><label>Số BTC</label><input id="realBtc" type="number" min="0" step="0.00000001" value="0.01"></div>
          <div class="field"><label>Phí ước tính (%)</label><input id="realFee" type="number" min="0" step="0.01" value="0"></div>
          <div class="field"><label>Thuế tham khảo (%)</label><input id="realTax" type="number" min="0" step="0.01" value="0.1"></div>
        </div>
        <button id="realCalcBtn" class="btn primary full">Tính VNĐ thực tế</button>
        <div id="realVndResult" class="decision-result compact"></div>
      </article>
    </section>

    <section class="card decision-card decision-ai-card" id="aiTradeExplanationCard">
      <div class="decision-card-head"><span class="step-badge dark">5</span><div><h3>AI Trade Explanation</h3><p>AI giải thích dữ liệu theo cấu trúc rõ ràng, không đưa cam kết lợi nhuận hoặc lệnh mua/bán tuyệt đối.</p></div></div>
      <div class="field"><label>Tình huống cần giải thích</label><textarea id="aiExplainInput" rows="4">Tôi muốn mua BTC bằng 5.000.000 VNĐ hôm nay. Hãy phân tích Risk Score, RSI/MACD, P2P spread và đề xuất kế hoạch tham khảo.</textarea></div>
      <button id="aiExplainBtn" class="btn primary">AI giải thích kế hoạch</button>
      <div id="aiExplainResult" class="ai-explain-result decision-result compact"></div>
    </section>

    <section class="state-box empty decision-disclaimer">
      Các tính năng trên chỉ hỗ trợ học tập và mô phỏng quyết định. Hệ thống không đặt lệnh thật, không lưu private key, không cam kết lợi nhuận và không thay thế tư vấn tài chính/thuế chuyên nghiệp.
    </section>
  `;

  document.getElementById('planBuildBtn')?.addEventListener('click', buildBuySellPlan);
  document.getElementById('portfolioAddBtn')?.addEventListener('click', addPortfolioTrade);
  document.getElementById('portfolioClearBtn')?.addEventListener('click', clearPortfolioTrades);
  document.getElementById('smartAddBtn')?.addEventListener('click', addSmartAlert);
  document.getElementById('smartCheckBtn')?.addEventListener('click', evaluateSmartAlerts);
  document.getElementById('realCalcBtn')?.addEventListener('click', calculateRealVND);
  document.getElementById('aiExplainBtn')?.addEventListener('click', explainTradeWithAI);
  refreshDecisionPortfolio();
  renderSmartAlerts();
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
                <a class="btn secondary full" href="#history">Xem lịch sử</a>
              </div>
              <div class="wallet-safe-note">Ví demo phục vụ học phần, không phát sinh tiền thật. Lệnh BUY dùng số dư ví VND; lệnh SELL chỉ cho phép khi bạn đang nắm giữ đủ BTC mô phỏng.</div>
            </div>

            <div class="card trade-order-card">
              <div class="section-head compact"><div><h3>Order Ticket</h3><p>Nhập số tiền muốn giao dịch, hệ thống sẽ ước tính khối lượng BTC theo nguồn giá bạn chọn.</p></div></div>
              <div class="trade-side-toggle" id="tradeSideToggle">
                <button class="active" data-side="BUY">Mua BTC</button>
                <button data-side="SELL">Bán BTC</button>
              </div>
              <div class="field"><label>Số tiền giao dịch (VNĐ)</label><input id="tradeAmount" type="number" value="5000000" min="10000" step="10000"></div>
              <div class="quick-amounts" id="tradeQuickAmounts">
                <button class="btn small secondary" data-trade-amount="1000000">1.000.000đ</button>
                <button class="btn small secondary" data-trade-amount="5000000">5.000.000đ</button>
                <button class="btn small secondary" data-trade-amount="10000000">10.000.000đ</button>
                <button class="btn small secondary" data-trade-amount="50000000">50.000.000đ</button>
              </div>
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
    document.querySelectorAll('[data-trade-amount]').forEach(btn => btn.addEventListener('click', () => {
      document.getElementById('tradeAmount').value = btn.dataset.tradeAmount;
    }));
    document.querySelectorAll('#tradeSideToggle button').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('#tradeSideToggle button').forEach(item => item.classList.remove('active'));
      btn.classList.add('active');
      currentTradePreview = null;
      const previewEl = document.getElementById('tradeOrderPreview');
      const execBtn = document.getElementById('tradeExecuteBtn');
      if (previewEl) previewEl.innerHTML = 'Nhấn <b>Xem trước lệnh</b> để hệ thống tính lại theo chiều giao dịch mới.';
      if (execBtn) execBtn.disabled = true;
    }));
    document.getElementById('tradePreviewBtn')?.addEventListener('click', previewTradeOrder);
    document.getElementById('tradeExecuteBtn')?.addEventListener('click', executeTradeOrder);

    drawTradeTerminalChart('tradeAdvancedChart', ohlcv.data || []);
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
  const amountVnd = Number(document.getElementById('tradeAmount')?.value || 0);
  const side = getSelectedTradeSide();
  const priceSource = document.getElementById('tradePriceSource')?.value || 'p2p';
  const state = window.__tradeMarketState || {};
  const walletVnd = Number(state.wallet?.balance_vnd || 0);
  const positionBtc = Number(state.portfolio?.position_btc || 0);

  if (!previewEl || !executeBtn) return;
  if (!amountVnd || amountVnd < 10000) {
    previewEl.innerHTML = `<div class="state-box error">Số tiền phải từ 10.000đ trở lên.</div>`;
    executeBtn.disabled = true;
    return;
  }

  const pricing = getTradePricingContext(side, priceSource);
  if (!pricing.appliedBtcVnd) {
    previewEl.innerHTML = `<div class="state-box error">Chưa đủ dữ liệu giá để tính lệnh demo.</div>`;
    executeBtn.disabled = true;
    return;
  }

  const amountBtc = amountVnd / pricing.appliedBtcVnd;
  const enoughBalance = side === 'BUY' ? walletVnd >= amountVnd : positionBtc >= amountBtc;
  const compareP2p = getTradePricingContext(side, 'p2p').appliedBtcVnd;
  const compareMarket = getTradePricingContext(side, 'market').appliedBtcVnd;
  const altPrice = priceSource === 'p2p' ? compareMarket : compareP2p;
  const altDiff = altPrice ? altPrice - pricing.appliedBtcVnd : 0;

  currentTradePreview = {
    side,
    priceSource,
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
      <div><span>Khối lượng ước tính</span><strong>${formatNumber(amountBtc, 8)} BTC</strong></div>
      <div><span>Giá BTC quy đổi</span><strong>${formatVND(pricing.appliedBtcVnd)}</strong></div>
      <div><span>Giá BTC/USDT</span><strong>${formatUSD(pricing.btcUsd)}</strong></div>
      <div><span>Tỷ giá sử dụng</span><strong>${formatVND(pricing.usdtVnd)} / USDT</strong></div>
    </div>
    <div class="result-panel" style="margin-top:12px">
      <strong>${side === 'BUY' ? 'Lệnh mua BTC' : 'Lệnh bán BTC'}</strong>
      <p>Nguồn giá: <b>${escapeHTML(pricing.rateLabel)}</b>. ${side === 'BUY' ? `Ví demo của bạn hiện có ${formatVND(walletVnd)}.` : `Danh mục hiện có ${formatNumber(positionBtc, 6)} BTC.`}</p>
      <p>${altPrice ? `So với nguồn giá còn lại, mức chênh lệch mỗi BTC là ${formatVND(Math.abs(altDiff))} (${altDiff > 0 ? 'nguồn hiện tại rẻ hơn cho người mua / lợi hơn cho người bán' : altDiff < 0 ? 'nguồn còn lại đang tốt hơn' : 'hai nguồn gần như tương đương'}).` : 'Nguồn giá thay thế chưa đủ dữ liệu để so sánh.'}</p>
      <p class="${enoughBalance ? 'positive' : 'negative'}">${enoughBalance ? '✅ Đủ điều kiện đặt lệnh demo.' : (side === 'BUY' ? '⚠️ Số dư ví demo chưa đủ. Hãy nạp thêm tiền demo ở trang Ví.' : '⚠️ Bạn không đủ BTC mô phỏng để bán lượng này.')}</p>
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
        amount_usdt: currentTradePreview.amountBtc,
        price_source: currentTradePreview.priceSource,
        applied_price: currentTradePreview.appliedPrice
      }
    });
    showToast(`Đã khớp lệnh ${currentTradePreview.side} BTC demo thành công.`);
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
  } catch (error) { el.innerHTML = errorBox(error.message); }
}

function tradeRowHTML(o) {
  const side = String(o.side || '').toUpperCase();
  const applied = Number(o.applied_price || 0);
  return `
    <div class="order-row trade-order-row ${side === 'BUY' ? 'buy' : 'sell'}">
      <div>
        <strong>${side === 'BUY' ? 'BUY BTC' : 'SELL BTC'}</strong>
        <div class="meta">${formatVNTime(o.created_at || o.createdAt)} · ${escapeHTML(String(o.price_source || 'p2p').toUpperCase())}</div>
      </div>
      <div style="text-align:right">
        <strong>${formatNumber(Number(o.amount_usdt || o.usdt || 0), 8)} BTC</strong>
        <div class="meta">${formatVND(o.amount_vnd || o.amount || 0)} · ${applied ? `${formatVND(applied)}/BTC` : 'Giá mô phỏng'}</div>
      </div>
    </div>
  `;
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
    authReady = true;
    await syncCurrentUserProfile();
    renderAuthHeader();

    redirectAfterLoginIfNeeded();

    supabaseAuth.auth.onAuthStateChange(async (event, session) => {
      currentSession = session || null;
      authReady = true;
      await syncCurrentUserProfile();
      renderAuthHeader();

      if (event === 'SIGNED_IN') {
        if (needsPasswordSetup()) {
          location.hash = '#set-password';
          return;
        }
        redirectAfterLoginIfNeeded();
      }

      if (event === 'SIGNED_OUT' && protectedRoutes.has(activeRoute)) {
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
    el.innerHTML = `<a class="btn small secondary auth-entry" href="#login" title="Cần cấu hình VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY">Tài khoản</a>`;
    return;
  }

  if (!authReady) {
    el.innerHTML = `<span class="badge amber">Đang kiểm tra...</span>`;
    return;
  }

  const email = currentSession?.user?.email;
  if (email) {
    const passwordState = needsPasswordSetup() ? '<span class="auth-warn-dot" title="Cần đặt mật khẩu"></span>' : '';
    el.innerHTML = `
      <a class="user-email" href="#account" title="${escapeHTML(email)}">${passwordState}${escapeHTML(shortEmail(email))}</a>
      <button id="logoutBtn" class="btn small secondary" type="button">Đăng xuất</button>
    `;
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await supabaseAuth.auth.signOut();
      currentSession = null;
      showToast('Đã đăng xuất.');
      renderAuthHeader();
      if (protectedRoutes.has(activeRoute)) location.hash = '#login';
      else route();
    });
  } else {
    el.innerHTML = `<a class="btn small secondary auth-entry" href="#login">Tài khoản</a>`;
  }
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
    .side-nav { width:min(280px, 82vw); }
    .side-nav [data-route] { border-radius:14px; }
    .side-nav small, .side-nav .nav-desc, .side-nav p { display:none !important; }
    .side-nav a { min-height:40px; }

    /* UI/UX compact mode: giảm chiều dài navigation, tránh phải cuộn sidebar. */
    body.ux-sidebar-compact { --sidebar: 86px; }
    body.ux-sidebar-compact .side-nav { width:86px; padding:12px 9px; overflow-y:visible; }
    body.ux-sidebar-compact .side-head { margin:2px 0 10px; padding:9px 6px; border-radius:16px; text-align:center; }
    body.ux-sidebar-compact .side-head strong { font-size:0; }
    body.ux-sidebar-compact .side-head strong::before { content:'₿'; display:grid; place-items:center; width:38px; height:38px; margin:0 auto; border-radius:14px; background:#f7931a; color:#fff; font-size:1.25rem; }
    body.ux-sidebar-compact .side-head span,
    body.ux-sidebar-compact .side-label { display:none !important; }
    body.ux-sidebar-compact .side-nav a { justify-content:center; gap:0; min-height:42px; margin:5px 0; padding:10px 0; font-size:0; border-radius:16px; }
    body.ux-sidebar-compact .side-nav a span { display:grid; place-items:center; width:28px; height:28px; margin:0; font-size:1rem; }
    body.ux-sidebar-compact .side-nav a:hover::after { content:attr(title); position:absolute; left:72px; z-index:120; padding:8px 10px; border-radius:12px; white-space:nowrap; background:#0f172a; color:#fff; font-size:.82rem; font-weight:800; box-shadow:0 14px 42px rgba(15,23,42,.22); }
    .side-nav a { position:relative; }
    .sidebar-collapse-toggle { width:100%; border:1px solid var(--border); border-radius:14px; background:#fff; color:var(--muted-2); min-height:34px; font-weight:900; margin:0 0 10px; }
    body.ux-sidebar-compact .sidebar-collapse-toggle { height:36px; font-size:0; padding:0; }
    body.ux-sidebar-compact .sidebar-collapse-toggle::before { content:'☰'; font-size:1rem; }
    body:not(.ux-sidebar-compact) .sidebar-collapse-toggle::before { content:'Thu gọn '; }
    body:not(.ux-sidebar-compact) .sidebar-collapse-toggle::after { content:'←'; }
    @media (max-height:720px) { body.ux-sidebar-compact .side-nav a { min-height:36px; margin:3px 0; } }

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
    @media (max-width:720px) { .floating-ai-panel { right:10px; bottom:80px; width:calc(100vw - 20px); border-radius:22px; } .floating-ai-button { right:16px; bottom:16px; } body.ux-sidebar-compact { --sidebar:0px; } }

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

  // Mặc định dùng compact để người dùng không phải cuộn trang bên trái.
  const saved = localStorage.getItem('btc_bigdata_sidebar_compact');
  document.body.classList.toggle('ux-sidebar-compact', saved !== '0');

  nav.querySelectorAll('a[data-route]').forEach(link => {
    const text = link.textContent.replace(/\s+/g, ' ').trim();
    if (!link.title) link.title = text;
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
    const input = document.getElementById('floatingAIInput');
    if (input) input.value = btn.dataset.floatingQuestion;
    sendFloatingAIMessage();
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

async function sendFloatingAIMessage() {
  const input = document.getElementById('floatingAIInput');
  const question = input?.value.trim();
  if (!question) return;

  input.value = '';
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
            <button class="active" data-auth-mode="register" type="button">Đăng ký</button>
            <button data-auth-mode="login" type="button">Đăng nhập</button>
          </div>

          <div id="registerPanel" class="auth-mode-panel">
            <h2>Tạo tài khoản</h2>
            <p class="muted">Hệ thống gửi mã OTP qua email. Bạn nhập mã tại đây để xác thực, không cần bấm link nên tránh token nằm trên URL.</p>
            <div class="field"><label>Email</label><input id="registerEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
            <button id="registerSubmit" class="btn primary full" style="margin-top:14px" ${!supabaseAuth ? 'disabled' : ''}>Gửi mã OTP xác thực</button>
            <div id="registerOtpBox" class="otp-box hidden">
              <div class="field"><label>Mã OTP trong email</label><input id="registerOtp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autocomplete="one-time-code"></div>
              <button id="registerOtpVerify" class="btn secondary full" type="button">Xác nhận mã OTP</button>
            </div>
          </div>

          <div id="loginPanel" class="auth-mode-panel hidden">
            <h2>Đăng nhập</h2>
            <p class="muted">Ưu tiên đăng nhập bằng mật khẩu. Nếu quên hoặc chưa đặt mật khẩu, dùng mã OTP qua email.</p>
            <div class="field"><label>Email</label><input id="loginEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
            <div class="field"><label>Mật khẩu</label><input id="loginPassword" type="password" placeholder="••••••••" autocomplete="current-password"></div>
            <button id="passwordLoginSubmit" class="btn primary full" style="margin-top:14px" ${!supabaseAuth ? 'disabled' : ''}>Đăng nhập bằng mật khẩu</button>
            <button id="otpLoginSubmit" class="btn secondary full" style="margin-top:10px" ${!supabaseAuth ? 'disabled' : ''}>Gửi mã OTP qua email</button>
            <div id="loginOtpBox" class="otp-box hidden">
              <div class="field"><label>Mã OTP trong email</label><input id="loginOtp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autocomplete="one-time-code"></div>
              <button id="loginOtpVerify" class="btn secondary full" type="button">Xác nhận mã OTP</button>
            </div>
          </div>

          <div id="loginResult"></div>
        `}
      </div>
    </section>
  `;

  setupAuthTabs();
  document.getElementById('registerSubmit')?.addEventListener('click', () => requestEmailOtp('register', next));
  document.getElementById('otpLoginSubmit')?.addEventListener('click', () => requestEmailOtp('login', next));
  document.getElementById('registerOtpVerify')?.addEventListener('click', () => verifyEmailOtp('register', next));
  document.getElementById('loginOtpVerify')?.addEventListener('click', () => verifyEmailOtp('login', next));
  document.getElementById('passwordLoginSubmit')?.addEventListener('click', () => signInWithPasswordUI(next));
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

async function requestEmailOtp(mode, next = 'dashboard') {
  const inputId = mode === 'register' ? 'registerEmail' : 'loginEmail';
  const boxId = mode === 'register' ? 'registerOtpBox' : 'loginOtpBox';
  const otpInputId = mode === 'register' ? 'registerOtp' : 'loginOtp';
  const email = document.getElementById(inputId)?.value.trim();
  const result = document.getElementById('loginResult');

  if (!email) {
    result.innerHTML = `<div class="state-box error">Vui lòng nhập email.</div>`;
    return;
  }
  if (!supabaseAuth) {
    result.innerHTML = `<div class="state-box error">Chưa cấu hình VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY.</div>`;
    return;
  }

  setPendingNextRoute(mode === 'register' ? 'set-password' : next);
  result.innerHTML = `<div class="state-box empty">Đang gửi mã OTP tới email...</div>`;

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

  result.innerHTML = `<div class="state-box empty"><b>Đã gửi mã OTP tới ${escapeHTML(email)}.</b><br>Nhập mã 6 số trong email để xác thực. Không bấm link magic link nếu email template vẫn còn link cũ.</div>`;
}

async function verifyEmailOtp(mode, next = 'dashboard') {
  const inputId = mode === 'register' ? 'registerEmail' : 'loginEmail';
  const otpInputId = mode === 'register' ? 'registerOtp' : 'loginOtp';
  const boxId = mode === 'register' ? 'registerOtpBox' : 'loginOtpBox';
  const result = document.getElementById('loginResult');
  const email = document.getElementById(inputId)?.value.trim() || document.getElementById(boxId)?.dataset.email || '';
  const token = (document.getElementById(otpInputId)?.value || '').replace(/\s+/g, '').trim();

  if (!email) {
    result.innerHTML = `<div class="state-box error">Vui lòng nhập email trước khi xác nhận OTP.</div>`;
    return;
  }
  if (!/^\d{6}$/.test(token)) {
    result.innerHTML = `<div class="state-box error">Mã OTP thường gồm 6 chữ số. Vui lòng kiểm tra lại email.</div>`;
    return;
  }

  result.innerHTML = `<div class="state-box empty">Đang xác thực mã OTP...</div>`;

  const { data, error } = await supabaseAuth.auth.verifyOtp({
    email,
    token,
    type: 'email'
  });

  if (error) {
    result.innerHTML = `<div class="state-box error">${escapeHTML(error.message)}<br><small>Nếu mã đã hết hạn, hãy bấm gửi lại mã OTP mới.</small></div>`;
    return;
  }

  currentSession = data.session || null;
  await syncCurrentUserProfile();
  renderAuthHeader();
  showToast('Xác thực email thành công.');
  location.hash = needsPasswordSetup() ? '#set-password' : `#${next}`;
}

async function signInWithPasswordUI(next = 'dashboard') {
  const email = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value || '';
  const result = document.getElementById('loginResult');

  if (!email || !password) {
    result.innerHTML = `<div class="state-box error">Vui lòng nhập email và mật khẩu.</div>`;
    return;
  }

  result.innerHTML = `<div class="state-box empty">Đang đăng nhập...</div>`;
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

  if (error) {
    result.innerHTML = `<div class="state-box error">${escapeHTML(error.message)}<br><small>Nếu bạn chưa đặt mật khẩu, hãy dùng nút gửi mã OTP qua email.</small></div>`;
    return;
  }

  currentSession = data.session || null;
  await syncCurrentUserProfile();
  renderAuthHeader();
  showToast('Đăng nhập thành công.');
  location.hash = needsPasswordSetup() ? '#set-password' : `#${next}`;
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

        <div class="field"><label>Mật khẩu mới</label><input id="newPassword" type="password" autocomplete="new-password" placeholder="Ít nhất 8 ký tự"></div>
        <div class="field"><label>Nhập lại mật khẩu</label><input id="confirmPassword" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu"></div>
        <div class="password-hint">Yêu cầu: 8+ ký tự, chữ hoa, chữ thường, số và ký tự đặc biệt.</div>
        <button id="setPasswordSubmit" class="btn primary full" style="margin-top:14px">${isChangingPassword ? 'Cập nhật mật khẩu' : 'Lưu mật khẩu'}</button>
        <div id="setPasswordResult"></div>
      </div>
    </section>
  `;

  document.getElementById('setPasswordSubmit')?.addEventListener('click', setPasswordUI);
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
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Tài khoản</span><h1>Bảo mật và dữ liệu cá nhân</h1><p class="lead">Mọi dữ liệu cá nhân được lưu theo <code>user_id</code> trong Supabase và được RLS chặn không cho user khác xem.</p></div></section>
    <section class="grid two">
      <div class="card">
        <h3>Thông tin đăng nhập</h3>
        <p><strong>Email:</strong> ${escapeHTML(email)}</p>
        <p><strong>Trạng thái mật khẩu:</strong> ${passwordSet ? 'Đã thiết lập' : 'Chưa thiết lập'}</p>
        <a class="btn ${passwordSet ? 'secondary' : 'primary'}" href="#set-password">${passwordSet ? 'Đổi mật khẩu' : 'Đặt mật khẩu ngay'}</a>
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
