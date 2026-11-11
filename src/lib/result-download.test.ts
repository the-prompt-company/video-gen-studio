import test from "node:test";
import assert from "node:assert/strict";
import { streamDownload } from "./result-download";

for (const format of [undefined, "png", "jpeg", "webp"]) {
  test(`downloads ${format ?? "video"} without depending on upstream CORS or disposition headers`, async (t) => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    t.mock.method(globalThis, "fetch", async () => new Response(bytes));
    const response = await streamDownload(new URL("https://provider.example/result"), "generation-id", format, new AbortController().signal);
    assert.equal(response.headers.get("content-disposition"), `attachment; filename="generation-id.${format ?? "mp4"}"`);
    assert.equal(response.headers.get("content-type"), format ? `image/${format}` : "video/mp4");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  });
}
test("expired and failed upstream files are errors, never saved as media", async (t) => {
  for (const [upstream, expected] of [[404, 410], [403, 502], [500, 502]]) {
    t.mock.method(globalThis, "fetch", async () => new Response("failure", { status: upstream }));
    const response = await streamDownload(new URL("https://provider.example/result"), "id", undefined, new AbortController().signal);
    assert.equal(response.status, expected);
    assert.equal(response.headers.has("content-disposition"), false);
    t.mock.restoreAll();
  }
});

test("missing stored blob falls back to original video, preserving range and bytes", async (t) => {
  const calls: string[] = [];
  const bytes = new Uint8Array([0, 0, 0, 24]);
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    calls.push(url.href);
    assert.equal(new Headers(init.headers).get("range"), "bytes=0-3");
    return calls.length === 1 ? new Response("Blob not found", { status: 404 }) : new Response(bytes, {
      status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-3/100", "accept-ranges": "bytes" },
    });
  });
  const response = await streamDownload(new URL("https://blob.example/missing"), "id", undefined, new AbortController().signal,
    { fallback: new URL("https://provider.example/original"), range: "bytes=0-3", inline: true });
  assert.equal(calls.length, 2);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/100");
  assert.match(response.headers.get("content-disposition")!, /^inline/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});
test("both sources missing return an error without an attachment", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Blob not found", { status: 404 }));
  const response = await streamDownload(new URL("https://blob.example/missing"), "id", undefined, new AbortController().signal,
    { fallback: new URL("https://provider.example/gone") });
  assert.equal(response.status, 410);
  assert.equal(response.headers.has("content-disposition"), false);
});
test("successful HTML error pages are not downloaded", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Error</html>", { headers: { "content-type": "text/html" } }));
  const response = await streamDownload(new URL("https://blob.example/error"), "id", undefined, new AbortController().signal);
  assert.equal(response.status, 502);
});
