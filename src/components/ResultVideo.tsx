"use client";

import { useState, type ComponentProps } from "react";

/** Retry a missing CDN object through the authorized original-source fallback. */
export function ResultVideo({ generationId, src, ...props }: Omit<ComponentProps<"video">, "src"> & { generationId: string; src?: string }) {
  const [failedSource, setFailedSource] = useState<string>();
  const recovered = src && failedSource === src;
  return <video {...props} src={recovered ? `/api/generations/${generationId}/download?inline=1` : src}
    onError={(event) => {
      if (src && !recovered) setFailedSource(src);
      else props.onError?.(event);
    }} />;
}
