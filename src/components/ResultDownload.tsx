"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export function ResultDownload({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const t = useTranslations("errors");
  const href = `/api/generations/${id}/download`;
  return <>
    <button type="button" className={className} disabled={busy} aria-busy={busy} onClick={async () => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setFailed(false);
      try {
        // Probe only the first byte. Cancel even if an upstream ignores Range.
        const response = await fetch(href, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(30_000) });
        await response.body?.cancel();
        if (!response.ok) throw new Error("download unavailable");
        const link = document.createElement("a");
        link.href = href;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch {
        setFailed(true);
      } finally {
        pending.current = false;
        setBusy(false);
      }
    }}>{children}</button>
    {failed && <p role="alert" className="text-sm text-red-400">{t("downloadUnavailable")}</p>}
  </>;
}
