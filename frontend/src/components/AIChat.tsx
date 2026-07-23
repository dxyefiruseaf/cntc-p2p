import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';

type Message = { id: number; role: 'user' | 'ai'; text: string; loading?: boolean };
const STORAGE_KEY = 'btc_react_ai_chat_v1';
const suggestions = ['Giờ nên mua hay bán?', 'Giải thích RSI hiện tại', 'P2P đang lợi hay thiệt?', 'Rủi ro thị trường là gì?'];

function initialMessages(): Message[] {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]') as Message[]; }
  catch { return []; }
}

export default function AIChat() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.filter(item => !item.loading).slice(-30)));
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);

  const send = async (value = input) => {
    const question = value.trim();
    if (!question || loading) return;
    const id = Date.now();
    setMessages(current => [...current, { id, role: 'user', text: question }, { id: id + 1, role: 'ai', text: '', loading: true }]);
    setInput('');
    setLoading(true);
    try {
      const response = await apiRequest<Record<string, unknown>>('/api/ai/ask', {
        method: 'POST',
        body: { question, risk_profile: 'moderate' },
        timeout: 30_000,
      });
      const answer = String(response.answer || response.summary || 'AI chưa tạo được câu trả lời.');
      const verdict = response.verdict ? `\n\nTín hiệu: ${String(response.verdict)}` : '';
      const disclaimer = response.disclaimer ? `\n\n${String(response.disclaimer)}` : '';
      setMessages(current => current.map(item => item.loading ? { ...item, loading: false, text: `${answer}${verdict}${disclaimer}` } : item));
    } catch (error) {
      setMessages(current => current.map(item => item.loading ? { ...item, loading: false, text: `Không thể kết nối AI: ${error instanceof Error ? error.message : 'Lỗi không xác định'}` } : item));
    } finally {
      setLoading(false);
    }
  };

  if (!auth.isAuthenticated) return null;

  return (
    <div className="ai-chat-shell fixed bottom-5 right-5 z-[75] flex flex-col items-end gap-2">
      {open && (
        <section className="modal-in flex h-[min(520px,calc(100vh-120px))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--elevated)] shadow-2xl" aria-label="AI Advisor">
          <header className="flex items-center gap-3 border-b border-[var(--border-soft)] bg-[#8B5CF6]/[0.07] px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#8B5CF6] text-sm text-white">✨</span>
            <div className="min-w-0 flex-1"><h3 className="text-xs font-semibold text-[var(--text-main)]">AI Advisor</h3><p className="truncate text-[10px] text-[#A78BFA]">Tham khảo · Không phải tư vấn tài chính</p></div>
            <button onClick={() => setOpen(false)} className="icon-control h-7 w-7" aria-label="Thu gọn chat">✕</button>
          </header>

          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#8B5CF6]/12 text-2xl">🤖</div>
                <p className="max-w-[280px] text-xs leading-relaxed text-[var(--text-sec)]">Hỏi về tín hiệu kỹ thuật, giá P2P, rủi ro hoặc kế hoạch giao dịch sandbox.</p>
                <div className="flex flex-wrap justify-center gap-1.5">{suggestions.map(item => <button key={item} onClick={() => void send(item)} className="rounded-full border border-[#8B5CF6]/25 bg-[#8B5CF6]/10 px-2.5 py-1 text-[10px] text-[#A78BFA] hover:bg-[#8B5CF6]/20">{item}</button>)}</div>
              </div>
            )}
            {messages.map(message => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[86%] whitespace-pre-line rounded-xl px-3 py-2 text-xs leading-relaxed ${message.role === 'user' ? 'rounded-br-sm bg-[#F7931A]/18 text-[var(--text-main)]' : 'rounded-bl-sm bg-[var(--surface-2)] text-[var(--text-main)]'}`}>
                  {message.loading ? <div className="flex items-center gap-1 py-1">{[0, 1, 2].map(index => <span key={index} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8B5CF6]" style={{ animationDelay: `${index * 140}ms` }} />)}</div> : message.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-[var(--border-soft)] p-2.5">
            <div className="flex gap-2">
              <input value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) void send(); }} placeholder="Đặt câu hỏi..." className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] focus:border-[#8B5CF6]" />
              <button onClick={() => void send()} disabled={!input.trim() || loading} className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#8B5CF6] text-white transition-colors hover:bg-[#7C3AED] disabled:opacity-40" aria-label="Gửi câu hỏi">➤</button>
            </div>
          </div>
        </section>
      )}

      <button onClick={() => setOpen(value => !value)} className="relative flex h-13 w-13 items-center justify-center rounded-full bg-[#8B5CF6] text-lg text-white shadow-[0_12px_36px_rgba(139,92,246,0.32)] transition-[filter,transform] hover:brightness-110 active:scale-95" aria-label={open ? 'Đóng AI Advisor' : 'Mở AI Advisor'}>
        {open ? '✕' : '✨'}
        {!open && messages.some(item => item.role === 'ai') && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--app-bg)] bg-[#F7931A]" />}
      </button>
    </div>
  );
}
