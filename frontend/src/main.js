import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
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
let chatMessages = [
  {
    role: 'ai',
    text: 'Xin chào! Tôi là AI Advisor của BTC BigData. Bạn có thể hỏi: “Giờ nên mua hay bán?”, “Bán P2P có thiệt không?”, hoặc “Bán 100 triệu thì thuế bao nhiêu?”.'
  }
];
let orders = loadOrders();

const signalMap = {
  BUY: { vi: 'MUA', className: 'buy', icon: '↗' },
  SELL: { vi: 'BÁN', className: 'sell', icon: '↘' },
  NEUTRAL: { vi: 'TRUNG LẬP', className: 'neutral', icon: '→' }
};

const routes = {
  business: renderBusinessPage,
  bmc: renderBMCPage,
  experiment: renderExperimentPage,
  dashboard: renderDashboardPage,
  chart: renderChartPage,
  p2p: renderP2PPage,
  tax: renderTaxPage,
  chat: renderChatPage,
  trade: renderTradePage,
  history: renderHistoryPage
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

route();
refreshTopTicker();
setInterval(refreshTopTicker, 60_000);

function route() {
  disposeCharts();
  const raw = (location.hash || '#business').replace('#', '');
  const name = raw.split('?')[0] || 'business';
  activeRoute = routes[name] ? name : 'business';
  document.querySelectorAll('[data-route]').forEach(el => el.classList.toggle('active', el.dataset.route === activeRoute));
  app.innerHTML = '';
  routes[activeRoute]();
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
  return `<span class="source-pill ${source === 'api' ? 'api' : 'mock'}">${source === 'api' ? '● API thật' : '● Demo fallback'}</span>`;
}

function normalizeOhlcv(hours = 168) {
  const data = (window.MOCK_DATA?.ohlcv?.data || []).slice(-hours);
  return { symbol: 'BTCUSDT', timeframe: '1h', hours, count: data.length, data };
}

function normalizeP2P(hours = 168) {
  const data = (window.MOCK_DATA?.p2p?.data || []).slice(0, hours * 2);
  return { count: data.length, hours, latest: data[0] || null, data };
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
  if (endpoint.startsWith('/api/ai/history')) return window.MOCK_DATA.aiHistory || { count: 0, data: [] };
  return null;
}

async function fetchJson(endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 9000);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        detail = err.detail || detail;
      } catch (_) {}
      throw new Error(detail);
    }
    return { data: await response.json(), source: 'api' };
  } catch (error) {
    clearTimeout(timeout);
    const fallback = mockFor(endpoint);
    if (fallback) return { data: fallback, source: 'mock', error };
    throw error;
  }
}

async function refreshTopTicker() {
  if (!topTicker) return;
  const res = await fetchJson('/api/latest', { timeout: 5500 });
  topTicker.innerHTML = `BTC/USDT <strong>${formatUSD(res.data.close)}</strong>`;
  topTicker.title = `${res.source === 'api' ? 'API backend' : 'Fallback demo'} · ${formatVNTime(res.data.timestamp)}`;
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
      bullets: ['Freemium: xem dashboard cơ bản miễn phí', 'Gói Pro: cảnh báo nâng cao', 'B2B API cho nhóm nghiên cứu/đào tạo', 'Affiliate/đối tác dữ liệu nếu thương mại hóa'],
      detail: 'Giai đoạn MVP ưu tiên kiểm chứng nhu cầu. Khi có người dùng thật, có thể thu phí tính năng cảnh báo, lịch sử sâu, nhiều coin và API quota cao hơn.'
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
    const [latestRes, summaryRes, ohlcvRes] = await Promise.all([
      fetchJson('/api/latest'),
      fetchJson('/api/indicators/summary'),
      fetchJson('/api/ohlcv?hours=24')
    ]);
    const latest = latestRes.data;
    const summary = summaryRes.data;
    const ohlcv = ohlcvRes.data;
    const change = latest.open ? ((latest.close - latest.open) / latest.open) * 100 : 0;
    const verdict = summary.overall?.verdict || 'NEUTRAL';
    const signals = summary.signals || {};
    document.getElementById('dashboardContent').innerHTML = `
      <div class="kpi-row">
        <div class="stat-card"><span class="stat-label">BTC/USDT</span><strong class="stat-value">${formatUSD(latest.close)}</strong><div class="stat-note">${formatPct(change)} trong nến hiện tại · ${sourcePill(latestRes.source)}</div></div>
        <div class="stat-card"><span class="stat-label">Khuyến nghị tổng hợp</span><strong class="stat-value">${badge(verdict)}</strong><div class="stat-note">${summary.overall?.buy || 0} MUA · ${summary.overall?.sell || 0} BÁN · ${summary.overall?.neutral || 0} TRUNG LẬP</div></div>
        <div class="stat-card"><span class="stat-label">Cập nhật</span><strong class="stat-value" style="font-size:1.7rem">${formatVNTime(latest.timestamp)}</strong><div class="stat-note">Hiển thị theo giờ Việt Nam UTC+7</div></div>
        <div class="stat-card"><span class="stat-label">Volume</span><strong class="stat-value">${formatNumber(latest.volume, 2)}</strong><div class="stat-note">BTC · ${formatNumber(latest.trades, 0)} lệnh</div></div>
      </div>
      <div class="grid four section">
        ${['RSI', 'MACD', 'Bollinger', 'EMA_Trend'].map(key => {
          const s = signals[key] || { value: null, signal: 'NEUTRAL', note: 'Chưa có dữ liệu' };
          return `<div class="card"><h3>${key.replace('_', ' ')}</h3><p>${badge(s.signal)}</p><p style="margin-top:10px">${escapeHTML(s.note)}</p><div class="meta">Giá trị: ${formatNumber(s.value, 2)}</div></div>`;
        }).join('')}
      </div>
      <div class="card section">
        <div class="section-head"><div><h2>Biến động 24 giờ gần nhất</h2><p>Đường giá đóng cửa dùng để xem nhanh xu hướng trong ngày.</p></div><a class="btn secondary" href="#chart">Xem biểu đồ chi tiết</a></div>
        <div id="miniChart" class="chart-box small"></div>
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
    const res = await fetchJson(`/api/ohlcv?hours=${chartHours}`);
    document.getElementById('chartContent').innerHTML = `
      <div class="card">
        <div class="section-head"><div><h2>BTC/USDT · ${chartHours} giờ gần nhất</h2><p>Số nến trả về: ${res.data.count} · ${sourcePill(res.source)}</p></div></div>
        <div id="technicalChart" class="chart-box large"></div>
      </div>
    `;
    drawTechnicalChart('technicalChart', res.data.data || []);
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
      text: `${signalMap[data.verdict]?.vi || data.verdict} · Độ tin cậy ${data.confidence || 50}%\n\n${data.answer}\n\nLý do:\n${(data.reasons || []).map(x => `- ${x}`).join('\n')}\n\nRủi ro:\n${(data.risks || []).map(x => `- ${x}`).join('\n')}\n\n${data.disclaimer || 'Thông tin chỉ mang tính tham khảo.'}`
    };
  } catch (error) {
    chatMessages[chatMessages.length - 1] = { role: 'ai', text: `AI hiện không phản hồi được: ${error.message}` };
  }
  renderMessages();
}

async function askAI(question) {
  try {
    const response = await fetch(`${API_BASE}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    <section class="page-head"><div><span class="eyebrow">Lịch sử AI</span><h1>Các lần phân tích AI đã lưu</h1><p class="lead">Dữ liệu lấy từ <code>/api/ai/history</code>, có thể lưu ở Supabase bảng <code>ai_analysis_history</code>.</p></div></section>
    <section id="historyContent">${loadingCard(420)}</section>
  `;
  try {
    const res = await fetchJson('/api/ai/history?limit=24');
    const rows = res.data.data || [];
    document.getElementById('historyContent').innerHTML = rows.length ? `
      <div class="timeline">
        ${rows.map(row => `<div class="timeline-item"><div class="timeline-time">${formatVNTime(row.created_at || row.timestamp, 'short')}</div><div class="card"><span class="badge ${(row.verdict || 'NEUTRAL').toLowerCase()}">${row.verdict || 'NEUTRAL'}</span><h3 style="margin-top:10px">${escapeHTML(row.question || 'AI phân tích định kỳ')}</h3><p>${escapeHTML(row.answer || row.summary || '')}</p></div></div>`).join('')}
      </div>
    ` : `<div class="state-box empty">Chưa có lịch sử AI.</div>`;
  } catch (error) {
    document.getElementById('historyContent').innerHTML = errorBox(error.message);
  }
}

function renderTradePage() {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const side = params.get('side') || 'SELL';
  app.innerHTML = `
    <section class="page-head"><div><span class="eyebrow">Giao dịch demo</span><h1>Mô phỏng mua/bán USDT qua P2P</h1><p class="lead">Trang này không đặt lệnh thật. Nó minh họa cách web có thể thực thi hoạt động sau khi người dùng bấm “Mua/Bán” từ trang P2P.</p></div></section>
    <section class="split">
      <div class="card">
        <div class="form-grid" style="grid-template-columns:1fr">
          <div class="field"><label>Chiều giao dịch</label><select id="tradeSide"><option value="SELL">Bán USDT lấy VNĐ</option><option value="BUY">Mua USDT bằng VNĐ</option></select></div>
          <div class="field"><label>Số tiền quy đổi (VNĐ)</label><input id="tradeAmount" type="number" value="100000000" min="1"></div>
        </div>
        <button id="tradeSubmit" class="btn primary full" style="margin-top:14px">Tính giao dịch demo</button>
        <div id="tradeResult"></div>
      </div>
      <div class="card"><h3>Lịch sử mô phỏng localStorage</h3><div id="tradeHistory" class="trade-history"></div><button id="clearOrders" class="btn secondary" style="margin-top:14px">Xóa lịch sử</button></div>
    </section>
  `;
  document.getElementById('tradeSide').value = side;
  document.getElementById('tradeSubmit').addEventListener('click', simulateTrade);
  document.getElementById('clearOrders').addEventListener('click', () => { orders = []; saveOrders(); renderOrderHistory(); });
  renderOrderHistory();
}

async function simulateTrade() {
  const result = document.getElementById('tradeResult');
  const side = document.getElementById('tradeSide').value;
  const amount = Number(document.getElementById('tradeAmount').value);
  if (!amount || amount <= 0) {
    result.innerHTML = `<div class="result-panel state-box error">Số tiền phải lớn hơn 0.</div>`;
    return;
  }
  result.innerHTML = `<div class="result-panel"><div class="skeleton" style="height:120px"></div></div>`;
  const res = await fetchJson('/api/p2p-spread?hours=168');
  const row = latestByTradeType(res.data.data || [], side);
  const price = row?.p2p_price || 26500;
  const fee = amount * 0.001;
  const tax = side === 'SELL' ? amount * 0.001 : 0;
  const usdt = amount / price;
  const net = side === 'SELL' ? amount - fee - tax : amount + fee;
  const order = { side, amount, price, fee, tax, usdt, net, createdAt: new Date().toISOString() };
  orders.unshift(order);
  orders = orders.slice(0, 20);
  saveOrders();
  result.innerHTML = `
    <div class="result-panel">
      <span class="badge ${side === 'SELL' ? 'red' : 'green'}">${side === 'SELL' ? 'BÁN USDT' : 'MUA USDT'}</span> ${sourcePill(res.source)}
      <h2 style="margin-top:10px">${formatNumber(usdt, 4)} USDT</h2>
      <p>Giá P2P dùng tính: ${formatVND(price)} / USDT</p>
      <p>Phí demo: ${formatVND(fee)} · Thuế demo: ${formatVND(tax)} · Giá trị ròng: ${formatVND(net)}</p>
    </div>
  `;
  renderOrderHistory();
}

function loadOrders() {
  try { return JSON.parse(localStorage.getItem('btc_bigdata_orders') || '[]'); } catch (_) { return []; }
}
function saveOrders() { localStorage.setItem('btc_bigdata_orders', JSON.stringify(orders)); }
function renderOrderHistory() {
  const el = document.getElementById('tradeHistory');
  if (!el) return;
  el.innerHTML = orders.length ? orders.map(o => `
    <div class="order-row"><div><strong>${o.side}</strong><div class="meta">${formatVNTime(o.createdAt)}</div></div><div style="text-align:right"><strong>${formatNumber(o.usdt, 4)} USDT</strong><div class="meta">${formatVND(o.amount)}</div></div></div>
  `).join('') : `<div class="state-box empty">Chưa có giao dịch mô phỏng.</div>`;
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

function drawTechnicalChart(id, data) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return;
  const chart = echarts.init(el);
  charts.push(chart);
  const labels = data.map(d => formatVNTime(d.timestamp, 'short'));
  const candle = data.map(d => [d.open, d.close, d.low, d.high]);
  chart.setOption({
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { top: 8, data: ['OHLC', 'EMA20', 'EMA50', 'EMA200', 'RSI'] },
    grid: [
      { left: 48, right: 40, top: 48, height: 260 },
      { left: 48, right: 40, top: 350, height: 90 }
    ],
    xAxis: [{ type: 'category', data: labels }, { type: 'category', data: labels, gridIndex: 1 }],
    yAxis: [{ scale: true }, { gridIndex: 1, min: 0, max: 100 }],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], bottom: 10 }],
    series: [
      { name: 'OHLC', type: 'candlestick', data: candle },
      { name: 'EMA20', type: 'line', smooth: true, showSymbol: false, data: data.map(d => d.ema_20 ?? null) },
      { name: 'EMA50', type: 'line', smooth: true, showSymbol: false, data: data.map(d => d.ema_50 ?? null) },
      { name: 'EMA200', type: 'line', smooth: true, showSymbol: false, data: data.map(d => d.ema_200 ?? null) },
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
