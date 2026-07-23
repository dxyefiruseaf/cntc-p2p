import { useNavigate } from 'react-router-dom';

const columns: Array<{ title: string; links: Array<[string, string]> }> = [
  {
    title: 'Sản phẩm',
    links: [
      ['/dashboard', 'Dashboard'], ['/chart', 'Biểu đồ kỹ thuật'], ['/exchange', 'Giao dịch demo'],
      ['/decision', 'Decision Hub'], ['/settlement', 'Tính thực nhận'], ['/tax', 'Ước tính thuế'],
    ],
  },
  {
    title: 'Minh bạch dữ liệu',
    links: [
      ['/data', 'Nguồn dữ liệu'], ['/data', 'Độ tin cậy dữ liệu'], ['/decision', 'Cảnh báo rủi ro'], ['/guide', 'Phương pháp tính toán'],
    ],
  },
  {
    title: 'Pháp lý & Tuân thủ',
    links: [
      ['/legal/terms', 'Điều khoản sử dụng'], ['/legal/privacy', 'Chính sách quyền riêng tư'], ['/legal/compliance', 'Tuân thủ Sandbox'],
      ['/legal/compliance', 'Nguyên tắc AML/KYC'], ['/legal/disclaimer', 'Miễn trừ trách nhiệm'], ['/legal/risk', 'Công bố rủi ro'],
    ],
  },
];

export default function Footer() {
  const navigate = useNavigate();
  return (
    <footer className="mt-8 border-t border-[var(--border-soft)] bg-[var(--app-bg)]">
      <div className="mx-auto max-w-[1500px] px-5 pb-6 pt-10">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <button onClick={() => navigate('/dashboard')} className="mb-3 flex items-center gap-2 text-left">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F7931A] font-black text-black">₿</span>
              <span><strong className="block text-sm text-[var(--text-main)]">BTC BigData Platform</strong><small className="text-[10px] text-[var(--text-sec)]">Bitcoin Sandbox · FinTech Analytics · AI Advisor</small></span>
            </button>
            <p className="max-w-sm text-xs leading-relaxed text-[var(--text-sec)]">Nền tảng phân tích Bitcoin sandbox dành cho học tập, nghiên cứu và trình diễn công nghệ tài chính tại Việt Nam.</p>
          </div>
          {columns.map(column => (
            <div key={column.title}>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-main)]">{column.title}</h4>
              <div className="flex flex-col gap-2">
                {column.links.map(([path, label]) => <button key={`${path}-${label}`} onClick={() => navigate(path)} className="text-left text-xs text-[var(--text-sec)] transition-colors hover:text-[#F7931A]">{label}</button>)}
              </div>
            </div>
          ))}
        </div>

        <div className="my-6 rounded-xl border border-[#F7931A]/15 bg-[#F7931A]/[0.055] p-4">
          <p className="text-xs leading-relaxed text-[var(--text-sec)]"><span className="font-medium text-[#F7931A]">⚠ Tuyên bố miễn trừ trách nhiệm: </span>Nền tảng phục vụ mục đích học tập, nghiên cứu và trình diễn công nghệ. Không vận hành sàn giao dịch thật, không lưu ký tài sản, không bảo đảm lợi nhuận và không thay thế tư vấn đầu tư, pháp lý hoặc thuế.</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-4">
          <span className="text-xs text-[var(--text-dim)]">© 2026 BTC BigData Platform. Bảo lưu mọi quyền.</span>
          <div className="flex flex-wrap items-center gap-2">{['Sandbox Only', 'No Custody', 'No Real Money', 'Privacy by Design'].map(tag => <span key={tag} className="rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--text-sec)]">{tag}</span>)}</div>
        </div>
      </div>
    </footer>
  );
}
