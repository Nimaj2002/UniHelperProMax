/**
 * 014 e2e fixtures for chat attachments: a tiny PNG, a MediaRecorder-like WebM/Opus file (the
 * generator of backend/tests/webm_fixture.py), and the session's notes, documents and recordings
 * seeded through the API.
 */
import { expect, type Page } from "@playwright/test";
import { csrf } from "./chat-helpers";

/** A valid 2×2 PNG (the server checks the magic bytes). */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64",
);

// ---- WebM (EBML) ---------------------------------------------------------------------------------

const EBML = 0x1a45dfa3, SEGMENT = 0x18538067, INFO = 0x1549a966, TIMECODE_SCALE = 0x2ad7b1, TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675, TIMECODE = 0xe7, SIMPLE_BLOCK = 0xa3;

function bytesOf(n: number, width?: number): Buffer {
  const len = width ?? Math.max(1, Math.ceil(n.toString(16).length / 2));
  const b = Buffer.alloc(len);
  for (let i = len - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v & 0xff;
  return b;
}
const encodeId = (id: number) => bytesOf(id);
function encodeSize(size: number | "unknown"): Buffer {
  if (size === "unknown") return Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  let length = 1;
  while (size >= 2 ** (7 * length) - 1) length += 1;
  return bytesOf(2 ** (7 * length) + size, length);
}
const element = (id: number, payload: Buffer) => Buffer.concat([encodeId(id), encodeSize(payload.length), payload]);
const uint = (id: number, value: number) => {
  const v = bytesOf(value);
  return Buffer.concat([encodeId(id), encodeSize(v.length), v]);
};

/** Unknown-size Segment and Clusters with Opus-like 20 ms blocks, as Chrome's MediaRecorder writes. */
export function webm(seconds = 2, clusterMs = 1000, frameMs = 20): Buffer {
  const header = element(EBML, Buffer.concat([uint(0x4286, 1), element(0x4282, Buffer.from("webm"))]));
  const info = element(INFO, Buffer.concat([uint(TIMECODE_SCALE, 1_000_000), element(0x4d80, Buffer.from("Chrome"))]));
  const track = element(0xae, Buffer.concat([uint(0xd7, 1), uint(0x83, 2), element(0x86, Buffer.from("A_OPUS"))]));
  const parts = [info, element(TRACKS, track)];
  const total = Math.round(seconds * 1000);
  for (let start = 0; start < total; start += clusterMs) {
    const blocks: Buffer[] = [];
    for (let rel = 0; rel < Math.min(clusterMs, total - start); rel += frameMs) {
      const ts = Buffer.alloc(2);
      ts.writeInt16BE(rel);
      blocks.push(element(SIMPLE_BLOCK, Buffer.concat([Buffer.from([0x81]), ts, Buffer.from([0x80]), Buffer.alloc(40, rel % 251)])));
    }
    parts.push(Buffer.concat([encodeId(CLUSTER), encodeSize("unknown"), uint(TIMECODE, start), ...blocks]));
  }
  return Buffer.concat([header, encodeId(SEGMENT), encodeSize("unknown"), ...parts]);
}

// ---- seeding ---------------------------------------------------------------------------------

export async function seedNote(page: Page, sessionKey: string, name: string, content: string): Promise<{ id: string }> {
  const r = await page.request.post(`/api/v1/sessions/${encodeURIComponent(sessionKey)}/notes`, {
    headers: { "X-CSRF-Token": await csrf(page) },
    data: { name, content },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
}

async function rawUpload(page: Page, path: string, query: Record<string, string>, body: Buffer) {
  const r = await page.request.post(`${path}?${new URLSearchParams(query)}`, {
    headers: { "X-CSRF-Token": await csrf(page), "Content-Type": "application/octet-stream" },
    data: body,
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string; name: string };
}

export const seedDocument = (page: Page, sessionKey: string, fileName: string, pdf: Buffer) =>
  rawUpload(page, `/api/v1/sessions/${encodeURIComponent(sessionKey)}/documents/import`, { fileName }, pdf);

export const seedRecording = (page: Page, sessionKey: string, fileName: string, audio: Buffer, durationMs = 2000) =>
  rawUpload(page, `/api/v1/sessions/${encodeURIComponent(sessionKey)}/recordings/import`, { fileName, durationMs: String(durationMs) }, audio);
