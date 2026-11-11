/** Stream, rather than buffer, so large videos do not exhaust server or browser memory. */
export async function streamDownload(url: URL, id: string, imageFormat: string | undefined, signal: AbortSignal) {
  const upstream = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(240_000)]), cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return Response.json({ error: { code: "resultGone" } }, {
      status: upstream.status === 404 || upstream.status === 410 ? 410 : 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const type = upstream.headers.get("content-type")?.split(";")[0];
  const extension = imageFormat ?? (type === "video/webm" ? "webm" : "mp4");
  return new Response(upstream.body, { headers: {
    "Content-Type": imageFormat ? `image/${extension}` : type?.startsWith("video/") ? type : "video/mp4",
    "Content-Disposition": `attachment; filename="${id}.${extension}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
