import { afterEach, expect, test, vi } from "vitest";
import { ClinicOsApiError } from "@clinic-os/api-client-generated";
import { patientFileRequest } from "../lib/patient-file-request";

function refusal(status = 429, retryAfterSeconds: number | null = 60) {
  return new ClinicOsApiError(
    status,
    { error: { code: "RATE_LIMITED", message: "Wait", details: {}, request_id: "synthetic" } },
    { status, requestId: "synthetic", etag: null, idempotencyReplayed: false, retryAfterSeconds }
  );
}
afterEach(() => vi.useRealTimers());

test("whole-file requests respect Retry-After before a bounded retry", async () => {
  vi.useFakeTimers();
  const operation = vi.fn().mockRejectedValueOnce(refusal()).mockResolvedValue("saved");
  const onWait = vi.fn();
  const result = patientFileRequest(operation, { onWait });
  await vi.advanceTimersByTimeAsync(60000);
  expect(operation).toHaveBeenCalledTimes(1);
  expect(onWait).toHaveBeenCalledWith(60);
  await vi.advanceTimersByTimeAsync(50);
  expect(await result).toBe("saved");
  expect(operation).toHaveBeenCalledTimes(2);
});

test("permission errors, unknown outcomes and invalid retry metadata are never retried", async () => {
  for (const error of [
    refusal(403),
    refusal(500),
    refusal(429, null),
    refusal(429, 301),
    new Error("network outcome unknown")
  ]) {
    const operation = vi.fn().mockRejectedValue(error);
    await expect(patientFileRequest(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  }
});

test("closing the workspace cancels a wait without another request", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const operation = vi.fn().mockRejectedValue(refusal());
  const result = patientFileRequest(operation, { signal: controller.signal });
  const rejected = expect(result).rejects.toBeInstanceOf(DOMException);
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await rejected;
  expect(operation).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("persistent throttling stops after three waits", async () => {
  vi.useFakeTimers();
  const error = refusal(429, 1),
    operation = vi.fn().mockRejectedValue(error);
  const result = patientFileRequest(operation);
  const rejected = expect(result).rejects.toBe(error);
  await vi.runAllTimersAsync();
  await rejected;
  expect(operation).toHaveBeenCalledTimes(4);
});
