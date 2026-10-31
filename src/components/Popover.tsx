"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";

const WIDE = "(min-width: 640px)";
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

type Place = { left: number; bottom: number; maxHeight: number } | "sheet";

/** Mount it to open it. Focus starts on the child marked `data-autofocus`, else the first control. */
export function Popover({ anchor, title, width, onClose, children }: { anchor: RefObject<HTMLElement | null>; title: string; width: number; onClose: () => void; children: ReactNode }) {
  const t = useTranslations("common");
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect || !window.matchMedia(WIDE).matches) return setPlace("sheet");
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      setPlace({ left, bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(160, rect.top - 72) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor, width]);

  const shown = place !== null;
  useEffect(() => {
    const el = panel.current;
    if (shown && el) (el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
  }, [shown]);

  useEffect(() => {
    const el = panel.current;
    const trigger = anchor.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      } else if (e.key === "Tab") {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (items.length === 0) return;
        const [first, last] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!el.contains(target) && !trigger?.contains(target)) close.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      if (el.contains(document.activeElement) || document.activeElement === document.body) trigger?.focus();
    };
  }, [anchor]);

  const sheet = place === "sheet";
  const style = place && place !== "sheet" ? { left: place.left, bottom: place.bottom, maxHeight: place.maxHeight, width } : undefined;
  return createPortal(
    <>
      {sheet && <div aria-hidden className="fixed inset-0 z-40 bg-background/85 backdrop-blur-sm" />}
      <div
        ref={panel}
        role="dialog"
        aria-label={title}
        aria-modal={sheet || undefined}
        tabIndex={-1}
        style={style}
        className={`fixed z-50 grid content-start gap-3 overflow-y-auto overscroll-contain border border-border bg-surface text-foreground focus:outline-none ${
          sheet ? "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-x-0 border-b-0 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2" : "rounded-xl p-3"
        } ${place === null ? "invisible" : ""}`}
      >
        {sheet && (
          <>
            <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{title}</h2>
              <Button variant="ghost" size="sm" className="h-11" onClick={() => close.current()}>
                {t("close")}
              </Button>
            </div>
          </>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}
