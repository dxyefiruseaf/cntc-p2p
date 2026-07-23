import type { ReactNode } from 'react';
import { Button, Card, Skeleton } from './ui';

export function PageLoader({ rows = 4 }: { rows?: number }) {
  return (
    <div className="page-enter space-y-4" aria-busy="true" aria-label="Đang tải dữ liệu">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: rows }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

export function InlineLoader({ label = 'Đang tải dữ liệu...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-sec)]" aria-live="polite">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#F7931A] border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="p-6 border-[#EF4444]/30">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EF4444]/12 text-[#EF4444]">!</span>
        <div className="flex-1">
          <h3 className="font-semibold text-[var(--text-main)]">Không thể tải dữ liệu</h3>
          <p className="mt-1 text-sm text-[var(--text-sec)]">{message}</p>
          {onRetry && <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>Thử lại</Button>}
        </div>
      </div>
    </Card>
  );
}

export function EmptyState({ icon = '∅', title, description, action }: { icon?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--elevated)]/50 px-6 py-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F7931A]/10 text-xl text-[#F7931A]">{icon}</div>
      <h3 className="font-semibold text-[var(--text-main)]">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-[var(--text-sec)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
