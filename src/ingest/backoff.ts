export type BackoffOptions = {
  baseMs?: number;
  maxMs?: number;
  jitterRatio?: number;
  random?: () => number;
};

export class ExponentialBackoff {
  private attempt = 0;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;

  constructor(options: BackoffOptions = {}) {
    this.baseMs = options.baseMs ?? 1_000;
    this.maxMs = options.maxMs ?? 30_000;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.random = options.random ?? Math.random;
  }

  nextDelay(): number {
    const exponential = Math.min(this.maxMs, this.baseMs * 2 ** this.attempt);
    this.attempt += 1;
    const spread = exponential * this.jitterRatio;
    const jitter = (this.random() * 2 - 1) * spread;
    return Math.max(0, Math.round(exponential + jitter));
  }

  reset(): void {
    this.attempt = 0;
  }

  currentAttempt(): number {
    return this.attempt;
  }
}

export async function sleepWithSignal(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (milliseconds <= 0) return;
  if (signal?.aborted) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
