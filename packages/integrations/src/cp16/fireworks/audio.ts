import { createHash, randomBytes } from "node:crypto";
import { sanitizedFireworksError } from "./errors.js";
import type {
  FireworksAudioMimeType,
  FireworksSpeechTask,
  FireworksTranscriptionRequest,
  FireworksTranscriptionResult,
  FireworksTranscriptionSegment,
  FireworksTranscriptionWord
} from "./types.js";
import {
  boundedString,
  finiteNumber,
  invalid,
  safeInteger,
  strictObject
} from "./validation.js";

const EXTENSION: Readonly<Record<FireworksAudioMimeType, string>> = Object.freeze({
  "audio/wav": "wav",
  "audio/flac": "flac",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a"
});

export function validateControlledAudio(input: {
  readonly request: FireworksTranscriptionRequest;
  readonly maximumBytes: number;
  readonly maximumDurationMs: number;
}): void {
  const request = input.request;
  if (request.source !== "authorized_private_media" || request.durationVerified !== true) {
    throw sanitizedFireworksError("invalid_audio", "Audio must come from authorized private media with verified duration.");
  }
  if (
    !(request.bytes instanceof Uint8Array) ||
    request.bytes.byteLength < 12 ||
    request.bytes.byteLength > input.maximumBytes ||
    !Number.isSafeInteger(request.durationMs) ||
    request.durationMs < 250 ||
    request.durationMs > input.maximumDurationMs ||
    !matchesMagic(request.mimeType, request.bytes)
  ) {
    throw sanitizedFireworksError("invalid_audio", "Audio failed MIME, magic-byte, size, or duration policy.");
  }
  if (request.language && !/^[a-z]{2}(?:-[a-z]{2,4})?$/iu.test(request.language)) {
    throw sanitizedFireworksError("invalid_audio", "Audio language hint is invalid.");
  }
  if ((request.medicalTermHints?.length ?? 0) > 64) {
    throw sanitizedFireworksError("invalid_audio", "Audio medical-term hints exceed the configured limit.");
  }
  for (const term of request.medicalTermHints ?? []) {
    if (
      typeof term !== "string" ||
      term.length < 1 ||
      term.length > 80 ||
      !/^[\p{L}\p{M}\p{N} .()+/-]+$/u.test(term)
    ) {
      throw sanitizedFireworksError("invalid_audio", "Audio medical-term hint is invalid.");
    }
  }
}

export function audioEndpoint(task: FireworksSpeechTask): string {
  return task === "speech_quality"
    ? "https://audio-prod.api.fireworks.ai/v1/audio/transcriptions"
    : "https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions";
}

export function buildAudioMultipart(input: {
  readonly request: FireworksTranscriptionRequest;
  readonly modelId: string;
  readonly boundary?: string;
}): { readonly contentType: string; readonly body: Uint8Array } {
  const boundary = input.boundary ?? `ClinicOS${randomBytes(18).toString("hex")}`;
  if (!/^[A-Za-z0-9_-]{16,80}$/u.test(boundary)) {
    throw sanitizedFireworksError("invalid_request", "Audio multipart boundary is invalid.");
  }
  const parts: Uint8Array[] = [];
  const textPart = (name: string, value: string) => {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8"
      )
    );
  };
  textPart("model", input.modelId);
  textPart("response_format", "verbose_json");
  textPart("timestamp_granularities", "word,segment");
  textPart("alignment_model", "mms_fa");
  textPart("diarize", "false");
  if (input.request.language) textPart("language", input.request.language);
  if ((input.request.medicalTermHints?.length ?? 0) > 0) {
    textPart(
      "prompt",
      `Medical vocabulary hints only; do not invent absent terms: ${input.request.medicalTermHints!.join(", ")}`
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${EXTENSION[input.request.mimeType]}"\r\nContent-Type: ${input.request.mimeType}\r\n\r\n`,
      "utf8"
    ),
    input.request.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  );
  return Object.freeze({
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(parts)
  });
}

export function parseTranscriptionResponse(input: {
  readonly value: unknown;
  readonly expectedDurationMs: number;
  readonly maximumDurationMs: number;
}): Omit<FireworksTranscriptionResult, "provenance"> {
  const value = strictObject(input.value, [
    "task",
    "language",
    "duration",
    "text",
    "words",
    "segments"
  ]);
  if (value.task !== "transcribe") invalid();
  const durationMs = Math.round(finiteNumber(value.duration, 0.001, input.maximumDurationMs / 1_000) * 1_000);
  const durationToleranceMs = Math.min(2_000, Math.max(500, input.expectedDurationMs * 0.02));
  if (Math.abs(durationMs - input.expectedDurationMs) > durationToleranceMs) {
    throw sanitizedFireworksError("invalid_response", "Transcription duration does not match verified media metadata.");
  }
  const words = parseWords(value.words, durationMs);
  const segments = parseSegments(value.segments, durationMs);
  return Object.freeze({
    language: boundedString(value.language, 2, 128),
    durationMs,
    text: boundedString(value.text, 1, 1_000_000),
    words,
    segments,
    reviewOnly: true
  });
}

function parseWords(value: unknown, durationMs: number): readonly FireworksTranscriptionWord[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100_000) invalid();
  return Object.freeze(
    value.map((item) => {
      const word = strictObject(item, [
        "word",
        "language",
        "probability",
        "hallucination_score",
        "start",
        "end"
      ], ["speaker_id"]);
      if (word.speaker_id !== undefined && word.speaker_id !== null) {
        throw sanitizedFireworksError("invalid_response", "Unexpected diarization data was returned.");
      }
      const startsAtMs = secondsToMs(word.start, durationMs);
      const endsAtMs = secondsToMs(word.end, durationMs);
      if (endsAtMs < startsAtMs) invalid();
      return Object.freeze({
        word: boundedString(word.word, 1, 512),
        language: boundedString(word.language, 2, 128),
        probability: finiteNumber(word.probability, 0, 1),
        hallucinationScore: finiteNumber(word.hallucination_score, 0, 1),
        startsAtMs,
        endsAtMs
      });
    })
  );
}

function parseSegments(value: unknown, durationMs: number): readonly FireworksTranscriptionSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20_000) invalid();
  return Object.freeze(
    value.map((item) => {
      const segment = strictObject(item, ["id", "text", "language", "start", "end"], [
        "speaker_id",
        "words"
      ]);
      if (segment.speaker_id !== undefined && segment.speaker_id !== null) {
        throw sanitizedFireworksError("invalid_response", "Unexpected diarization data was returned.");
      }
      const startsAtMs = secondsToMs(segment.start, durationMs);
      const endsAtMs = secondsToMs(segment.end, durationMs);
      if (endsAtMs < startsAtMs) invalid();
      return Object.freeze({
        id: safeInteger(segment.id, 0, 1_000_000),
        text: boundedString(segment.text, 1, 64_000),
        language: boundedString(segment.language, 2, 128),
        startsAtMs,
        endsAtMs,
        words: segment.words === undefined ? Object.freeze([]) : parseWords(segment.words, durationMs)
      });
    })
  );
}

function secondsToMs(value: unknown, durationMs: number): number {
  return Math.round(finiteNumber(value, 0, durationMs / 1_000) * 1_000);
}

function matchesMagic(mime: FireworksAudioMimeType, bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => Buffer.from(bytes.slice(start, end)).toString("ascii");
  if (mime === "audio/wav") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
  if (mime === "audio/flac") return ascii(0, 4) === "fLaC";
  if (mime === "audio/mpeg") {
    return ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
  }
  return ascii(4, 8) === "ftyp";
}

export function audioRequestDigest(
  request: FireworksTranscriptionRequest,
  modelId: string
): string {
  const audioDigest = createHash("sha256").update(request.bytes).digest("hex");
  return createHash("sha256")
    .update(JSON.stringify({
      model: modelId,
      audioDigest,
      mimeType: request.mimeType,
      durationMs: request.durationMs,
      language: request.language ?? null,
      medicalTermHints: request.medicalTermHints ?? [],
      responseFormat: "verbose_json",
      timestampGranularities: ["word", "segment"],
      alignmentModel: "mms_fa",
      diarize: false
    }))
    .digest("hex");
}
