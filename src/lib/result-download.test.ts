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
