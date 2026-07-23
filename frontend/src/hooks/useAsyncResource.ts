import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAsyncResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList = [],
  options: { enabled?: boolean; keepData?: boolean } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(options.enabled ?? true));
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  const refresh = useCallback(async () => {
    if (options.enabled === false) return;
    const id = ++runId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    if (!options.keepData) setData(current => current);
    try {
      const value = await loader(controller.signal);
      if (runId.current === id) setData(value);
    } catch (reason) {
      if (controller.signal.aborted || runId.current !== id) return;
      setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu.');
    } finally {
      if (runId.current === id) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (options.enabled === false) return;
    const controller = new AbortController();
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    loader(controller.signal)
      .then(value => { if (!controller.signal.aborted && runId.current === id) setData(value); })
      .catch(reason => {
        if (!controller.signal.aborted && runId.current === id) {
          setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu.');
        }
      })
      .finally(() => { if (!controller.signal.aborted && runId.current === id) setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refresh };
}
