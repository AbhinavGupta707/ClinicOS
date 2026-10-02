import { ClinicOsApiError } from "@clinic-os/api-client-generated";

// Retry only an explicit 429 rejection. Unknown write outcomes must instead be
// reconciled with saved receipts; authentication/validation failures need review.
export async function patientFileRequest<T>(
  operation: () => Promise<T>,
  options: { signal?: AbortSignal; onWait?: (seconds: number) => void } = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ClinicOsApiError) || error.status !== 429 || attempt >= 3) throw error;
      const seconds = error.responseMetadata.retryAfterSeconds;
      if (seconds === null || seconds < 1 || seconds > 300) throw error;
      options.onWait?.(seconds);
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer);
          reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(
          () => {
            options.signal?.removeEventListener("abort", aborted);
            resolve();
          },
          seconds * 1000 + 50
        );
        options.signal?.addEventListener("abort", aborted, { once: true });
        if (options.signal?.aborted) aborted();
      });
    }
  }
}
