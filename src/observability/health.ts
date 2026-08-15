export function estimateLagSeconds(
  lastReceivedAt: string | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!lastReceivedAt) return undefined;
  const receivedMs = Date.parse(lastReceivedAt);
  if (!Number.isFinite(receivedMs)) return undefined;
  return Math.max(0, Math.round((nowMs - receivedMs) / 1_000));
}
