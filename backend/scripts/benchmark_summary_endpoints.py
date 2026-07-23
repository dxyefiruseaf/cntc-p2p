from __future__ import annotations

import argparse
import asyncio
import statistics
import time
from dataclasses import dataclass

import httpx


@dataclass(slots=True)
class BenchmarkResult:
    name: str
    requests_per_iteration: int
    samples_ms: list[float]
    failures: int

    @property
    def p50(self) -> float:
        return statistics.median(self.samples_ms) if self.samples_ms else 0.0

    @property
    def p95(self) -> float:
        if not self.samples_ms:
            return 0.0
        ordered = sorted(self.samples_ms)
        index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * 0.95)))
        return ordered[index]


async def timed_iteration(client: httpx.AsyncClient, paths: list[str]) -> tuple[float, bool]:
    started = time.perf_counter()
    responses = await asyncio.gather(*(client.get(path) for path in paths), return_exceptions=True)
    ok = all(isinstance(item, httpx.Response) and item.is_success for item in responses)
    return (time.perf_counter() - started) * 1000, ok


async def benchmark(
    client: httpx.AsyncClient,
    name: str,
    paths: list[str],
    iterations: int,
    concurrency: int,
) -> BenchmarkResult:
    samples: list[float] = []
    failures = 0
    semaphore = asyncio.Semaphore(concurrency)

    async def run_one() -> None:
        nonlocal failures
        async with semaphore:
            elapsed, ok = await timed_iteration(client, paths)
            if ok:
                samples.append(elapsed)
            else:
                failures += 1

    await asyncio.gather(*(run_one() for _ in range(iterations)))
    return BenchmarkResult(name, len(paths), samples, failures)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Compare aggregate endpoints with the legacy multi-request flow.")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--iterations", type=int, default=30)
    parser.add_argument("--concurrency", type=int, default=5)
    args = parser.parse_args()

    timeout = httpx.Timeout(20.0, connect=5.0)
    limits = httpx.Limits(max_connections=max(20, args.concurrency * 4), max_keepalive_connections=20)
    async with httpx.AsyncClient(base_url=args.base_url.rstrip("/"), timeout=timeout, limits=limits) as client:
        cases = [
            (
                "Dashboard aggregate",
                ["/api/overview?hours=72"],
            ),
            (
                "Dashboard legacy",
                [
                    "/api/latest",
                    "/api/indicators/summary",
                    "/api/ohlcv?hours=72",
                    "/api/risk-score",
                    "/api/market-alerts",
                    "/api/p2p-comparison",
                ],
            ),
        ]
        results = [
            await benchmark(client, name, paths, max(1, args.iterations), max(1, args.concurrency))
            for name, paths in cases
        ]

    print("\nPerformance benchmark")
    print("=" * 88)
    for result in results:
        print(
            f"{result.name:24} requests/iteration={result.requests_per_iteration:<2} "
            f"p50={result.p50:8.1f}ms p95={result.p95:8.1f}ms failures={result.failures}"
        )
    if len(results) == 2 and results[1].requests_per_iteration:
        reduction = 1 - results[0].requests_per_iteration / results[1].requests_per_iteration
        print(f"\nBrowser request reduction: {reduction:.1%}")


if __name__ == "__main__":
    asyncio.run(main())
