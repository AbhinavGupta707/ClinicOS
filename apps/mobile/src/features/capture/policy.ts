import type { CaptureKind } from "./types";

export interface CaptureQueuePolicy {
  maxItemBytes: Readonly<Record<CaptureKind, number>>;
  maxAudioDurationMs: number;
  maxQueueBytes: number;
  maxQueueItems: number;
  minimumFreeBytesAfterWrite: number;
  leaseMs: number;
  maxAutomaticAttempts: number;
  retryBaseMs: number;
  retryCapMs: number;
  targetExpirySafetyMs: number;
}

export const productionCaptureQueuePolicy: CaptureQueuePolicy = Object.freeze({
  maxItemBytes: Object.freeze({
    photo: 15 * 1024 * 1024,
    audio: 24 * 1024 * 1024
  }),
  maxAudioDurationMs: 15 * 60 * 1000,
  maxQueueBytes: 250 * 1024 * 1024,
  maxQueueItems: 25,
  minimumFreeBytesAfterWrite: 200 * 1024 * 1024,
  leaseMs: 2 * 60 * 1000,
  maxAutomaticAttempts: 8,
  retryBaseMs: 5_000,
  retryCapMs: 15 * 60 * 1000,
  targetExpirySafetyMs: 30_000
});

export function boundedRetryDelayMs(
  attempt: number,
  randomUnit: number,
  policy: CaptureQueuePolicy
): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 20));
  const base = Math.min(policy.retryCapMs, policy.retryBaseMs * 2 ** exponent);
  const jitter = 0.75 + Math.max(0, Math.min(1, randomUnit)) * 0.5;
  return Math.round(base * jitter);
}
