import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarType } from "./avatar";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));

const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ", [0x18, 0, 0, 0]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF", [0]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d], "IHDR");

test("WebP, JPEG and PNG bytes sent as their own type are accepted with the stored extension", () => {
  assert.deepEqual(avatarType(WEBP, "image/webp"), { contentType: "image/webp", ext: "webp" });
  assert.deepEqual(avatarType(JPEG, "image/jpeg"), { contentType: "image/jpeg", ext: "jpg" });
  assert.deepEqual(avatarType(PNG, "image/png"), { contentType: "image/png", ext: "png" });
  assert.deepEqual(avatarType(PNG, "IMAGE/PNG; charset=binary"), { contentType: "image/png", ext: "png" });
});

test("bytes that are not the declared image type are refused, whatever the header says", () => {
  const html = bytes("<!doctype html><script>alert(1)</script>");
  const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const gif = bytes("GIF89a", [1, 0, 1, 0]);
  const wave = bytes("RIFF", [0x24, 0, 0, 0], "WAVEfmt ");
  for (const [body, declared] of [
    [html, "image/png"],
    [svg, "image/webp"],
    [gif, "image/jpeg"],
    [wave, "image/webp"],
    [bytes([0xff, 0xd8]), "image/jpeg"],
    [PNG.subarray(0, 7), "image/png"],
    [bytes(), "image/png"],
  ] as const) {
    assert.equal(avatarType(body, declared), null, `${Buffer.from(body).toString("latin1").slice(0, 12)} as ${declared}`);
  }
});

test("a real image declared as another type, or as no image type, is refused", () => {
  assert.equal(avatarType(JPEG, "image/png"), null);
  assert.equal(avatarType(PNG, "image/webp"), null);
  assert.equal(avatarType(WEBP, "image/jpeg"), null);
  assert.equal(avatarType(PNG, "image/gif"), null);
  assert.equal(avatarType(PNG, "image/svg+xml"), null);
  assert.equal(avatarType(PNG, "application/octet-stream"), null);
  assert.equal(avatarType(PNG, null), null);
});
