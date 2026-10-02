import { describe, expect, it, vi } from "vitest";
import {
  createOperationsCommand,
  dashboardMetric,
  evidence,
  ifMatch,
  knownRejected,
  labCaseDisplay,
  operationsCommandForScope
} from "../features/cp13/continuity-operations/operations-ui";

describe("operations operator contracts", () => {
  it("displays dashboard money in rupees and rates as percentages without changing counts", () => {
    expect(dashboardMetric("invoicedMinor", 100000, "INR")).toBe("₹1,000.00");
    expect(dashboardMetric("reconciliationVarianceMinor", -125, "INR")).toBe("−₹1.25");
    expect(dashboardMetric("noShowRateBasisPoints", 1250, "INR")).toBe("12.50%");
    expect(dashboardMetric("completed", 1250, "INR")).toBe("1,250");
    expect(dashboardMetric("collectedMinor", 100, "USD")).toBe("Amount unavailable");
    expect(dashboardMetric("completed", NaN, "INR")).toBe("Unavailable");
  });

  it("uses the versioned resource ETag and structured manual evidence", () => {
    expect(ifMatch({ id: "task-1", rowVersion: 3 })).toBe('"rv-3"');
    expect(evidence("  Called patient  ")).toEqual({
      note: "Called patient",
      source: "staff_manual"
    });
    expect(() => evidence(" ")).toThrow(/Describe what was observed/);
  });

  it("extracts the actual nested lab list response", () => {
    const detail = labCaseDisplay({
      labCase: { id: "case-1", rowVersion: 2, title: "Crown" },
      vendor: { id: "vendor-1", displayName: "Lab" },
      items: []
    });
    expect(detail?.case).toMatchObject({ id: "case-1", rowVersion: 2 });
    expect(detail?.vendor).toMatchObject({ displayName: "Lab" });
    expect(labCaseDisplay({ labCase: { id: "case-1" } })).toBeNull();
  });

  it("retains exact request and key after uncertain outcome, including remount within actor scope", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "stable-key" });
    const command = operationsCommandForScope("tenant:clinic:actor-a");
    const payload = { title: "Check", evidence: { note: "Observed" } };
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ ok: true });
    const run = (key: string) => send(key, payload);
    await expect(command.execute("Check", run)).rejects.toThrow("connection lost");
    expect(operationsCommandForScope("tenant:clinic:actor-a").hasPending()).toBe(true);
    await expect(command.recover()).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenNthCalledWith(1, "stable-key", payload);
    expect(send).toHaveBeenNthCalledWith(2, "stable-key", payload);
    expect(command.hasPending()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("rejects a simultaneous different submission and discards command on actor change", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "first-key" });
    const command = createOperationsCommand();
    let finish!: (value: unknown) => void;
    const send = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = command.execute("first", send);
    const secondSend = vi.fn();
    const second = command.execute("second", secondSend);
    await expect(second).rejects.toThrow(/still being recorded/);
    expect(secondSend).not.toHaveBeenCalled();
    await Promise.resolve();
    finish({ ok: true });
    await first;
    const previous = operationsCommandForScope("tenant:clinic:actor-a");
    const next = operationsCommandForScope("tenant:clinic:actor-b");
    expect(next).not.toBe(previous);
    vi.unstubAllGlobals();
  });

  it("treats in-progress idempotency conflicts as uncertain", () => {
    expect(
      knownRejected({ status: 409, details: { reason: "idempotency_request_in_progress" } })
    ).toBe(false);
    expect(knownRejected({ status: 409, details: { reason: "if_match_failed" } })).toBe(true);
  });

  it("does not carry an unresolved clinic request into another scope", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "scope-key" });
    const first = operationsCommandForScope("tenant:clinic-a:actor");
    await expect(
      first.execute("patient task", () => Promise.reject(new Error("offline")))
    ).rejects.toThrow("offline");
    const other = operationsCommandForScope("tenant:clinic-b:actor");
    expect(other.hasPending()).toBe(false);
    expect(operationsCommandForScope("tenant:clinic-a:actor").hasPending()).toBe(false);
    vi.unstubAllGlobals();
  });
});
