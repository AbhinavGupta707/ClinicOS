export interface MobileClock {
  now(): Date;
}

/**
 * Sole mobile system-time boundary. Workflow code accepts an injected clock so retries,
 * expiration checks and capture metadata remain deterministic under test.
 */
export const mobileSystemClock: MobileClock = {
  now: () => new Date()
};
