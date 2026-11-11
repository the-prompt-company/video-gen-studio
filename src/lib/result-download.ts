/** Stream authorized result candidates without buffering large videos. */
export async function streamDownload(url: URL, id: string, imageFormat: string | undefined, signal: AbortSignal,
  options: { fallback?: URL; inline?: boolean; range?: string | null } = {}) {
  let status = 410;
  const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
  for (const candidate of [url, ...(options.fallback && options.fallback.href !== url.href ? [options.fallback] : [])]) {
    let upstream: Response;
    try {
      upstream = await fetch(candidate, {
        signal: fetchSignal, cache: "no-store",
        headers: options.range ? { Range: options.range } : undefined,
      });
    } catch (error) {
      if (fetchSignal.aborted) throw error;
      status = 502;
      continue;
    }
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      status = upstream.status === 404 || upstream.status === 410 ? 410 : upstream.status === 416 ? 416 : 502;
      continue;
    }
    const type = upstream.headers.get("content-type")?.split(";")[0];
    // Never offer an upstream HTML/JSON error page as a successful media download.
    if (type && !type.startsWith("video/") && !type.startsWith("image/") && type !== "application/octet-stream") {
      await upstream.body.cancel();
      status = 502;
      continue;
    }
    const extension = imageFormat ?? (type === "video/webm" ? "webm" : "mp4");
    const headers = new Headers({
      "Content-Type": imageFormat ? `image/${extension}` : type?.startsWith("video/") ? type : "video/mp4",
      "Content-Disposition": `${options.inline ? "inline" : "attachment"}; filename="${id}.${extension}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  return Response.json({ error: { code: "resultGone" } }, { status, headers: { "Cache-Control": "private, no-store" } });
}
