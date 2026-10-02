import { describe, expect, it } from "vitest";
import { PRACTO_PATIENT_HEADERS } from "../lib/practo-patient-import";
import {
  PATIENT_FILE_MAX_BYTES,
  patientFileChunks,
  preparePatientFile
} from "../lib/practo-patient-file";

function csv(count: number, change?: (row: string[], index: number) => void) {
  const rows = [PRACTO_PATIENT_HEADERS.map(String)];
  for (let index = 0; index < count; index++) {
    const row = PRACTO_PATIENT_HEADERS.map(() => "");
    row[0] = `000${index}`;
    row[1] = `Synthetic Patient ${index}`;
    row[2] = `+919${String(index).padStart(9, "0")}`;
    row[6] = "Female";
    row[20] = 'EXCLUDED_PRIVATE_NOTE\nWith "quotes", commas and Unicode नमस्ते';
    change?.(row, index);
    rows.push(row);
  }
  return rows
    .map((row) => row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(","))
    .join("\r\n");
}

describe("whole patient file preparation", () => {
  it.each([1, 100, 101, 1000, 5000])(
    "preflights and regenerates every row of a %i patient file",
    async (count) => {
      const file = new Blob([csv(count)]);
      const first = await preparePatientFile(file);
      expect(first.manifest.rowCount).toBe(count);
      expect(first.manifest.chunks).toHaveLength(Math.ceil(count / 100));
      expect(first.excludedFieldsWithValues).toEqual(["Patient Notes"]);
      let received = 0;
      for await (const chunk of patientFileChunks(file)) {
        expect(chunk).toMatchObject(first.manifest.chunks[chunk.ordinal]!);
        expect(chunk.csv).not.toContain("EXCLUDED_PRIVATE_NOTE");
        expect(chunk.rowCount).toBeLessThanOrEqual(100);
        expect(new TextEncoder().encode(chunk.csv).length).toBeLessThanOrEqual(256_000);
        received += chunk.rowCount;
      }
      expect(received).toBe(count);
    },
    15000
  );
  it("rejects 5,001 records and duplicate IDs across distant chunks before upload", async () => {
    await expect(preparePatientFile(new Blob([csv(5001)]))).rejects.toThrow("up to 5,000");
    await expect(
      preparePatientFile(
        new Blob([
          csv(205, (row, index) => {
            if (index === 204) row[0] = "0000";
          })
        ])
      )
    ).rejects.toThrow("repeats a Patient Number");
  });
  it("rejects malformed tails, empty records, non-UTF8, oversized files and unsupported fields", async () => {
    for (const value of [csv(101) + '\r\n"unterminated', csv(101) + "\r\n\r\n"]) {
      await expect(preparePatientFile(new Blob([value]))).rejects.toThrow();
    }
    await expect(preparePatientFile(new Blob([new Uint8Array([0xff])]))).rejects.toThrow("UTF-8");
    await expect(preparePatientFile({ size: PATIENT_FILE_MAX_BYTES + 1 } as Blob)).rejects.toThrow(
      "25 MiB"
    );
    await expect(
      preparePatientFile(
        new Blob([
          csv(1, (row) => {
            row[1] = "X".repeat(513);
          })
        ])
      )
    ).rejects.toThrow("oversized mapped field");
    await expect(
      preparePatientFile(
        new Blob([
          csv(1, (row) => {
            row[0] = " 001";
          })
        ])
      )
    ).rejects.toThrow("outer whitespace");
  });
  it("handles UTF8, CRLF and escaped quotes split at every byte boundary", async () => {
    const source =
      "\uFEFF" +
      csv(2, (row) => {
        row[1] = 'Synthetic नमस्ते\n"quoted", patient';
      });
    const bytes = new TextEncoder().encode(source);
    let offset = 0;
    const fragmented = {
      size: bytes.length,
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset === bytes.length) controller.close();
            else controller.enqueue(bytes.slice(offset, ++offset));
          }
        })
    } as Blob;
    expect(await preparePatientFile(fragmented)).toEqual(
      await preparePatientFile(new Blob([source]))
    );
  }, 15000);
  it("changes the manifest for changed mapped evidence but never stores excluded field values", async () => {
    const initial = await preparePatientFile(new Blob([csv(101)]));
    const changed = await preparePatientFile(
      new Blob([
        csv(101, (row, index) => {
          if (index === 100) row[1] = "Corrected Synthetic Name";
        })
      ])
    );
    expect(changed.manifest.chunks[0]).toEqual(initial.manifest.chunks[0]);
    expect(changed.manifest.chunks[1]!.digest).not.toBe(initial.manifest.chunks[1]!.digest);
    expect(JSON.stringify(initial)).not.toMatch(/EXCLUDED_PRIVATE_NOTE|Synthetic Patient|0000/);
  });
  it("stops when preparation is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      preparePatientFile(new Blob([csv(1)]), undefined, controller.signal)
    ).rejects.toThrow();
  });
});
