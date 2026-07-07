import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedSourceAnchors, defaultAiRetentionPolicy, type UUID } from "../src/index.ts";

test("CP8 AI retention defaults are conservative and deny provider training", () => {
  const policy = defaultAiRetentionPolicy({
    rawAudioRetentionAllowed: false,
    providerMode: "simulator"
  });
  assert.equal(policy.rawAudioRetention, "disabled");
  assert.equal(policy.rawAudioDeleteAfterHours, 0);
  assert.equal(policy.providerTrainingAllowed, false);
  assert.equal(policy.providerRawPayloadStorage, "digest_only");
});

test("CP8 source anchor validation rejects unsupported anchors", () => {
  const supportedId = "10000000-0000-4000-8000-000000081001" as UUID;
  const unsupportedId = "10000000-0000-4000-8000-000000081002" as UUID;
  assert.doesNotThrow(() =>
    assertSupportedSourceAnchors(
      [
        { id: supportedId, supported: true, unsupportedReason: null },
        { id: unsupportedId, supported: false, unsupportedReason: "external_document_parser_not_enabled" }
      ],
      [supportedId]
    )
  );
  assert.throws(
    () =>
      assertSupportedSourceAnchors(
        [
          { id: supportedId, supported: true, unsupportedReason: null },
          { id: unsupportedId, supported: false, unsupportedReason: "external_document_parser_not_enabled" }
        ],
        [unsupportedId]
      ),
    /unsupported/
  );
});
