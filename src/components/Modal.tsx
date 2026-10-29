"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui";

const WIDTH = { md: "sm:max-w-md", lg: "sm:max-w-2xl" };

/**
 * A modal on the native <dialog>: the page behind is inert and its scroll is locked (globals.css),
 * Esc, 닫기 and a click on the backdrop close it, and focus returns to whatever opened it.
 * Under 640px it fills the screen. Mount it to open it and unmount it to close it.
 * The first element marked `data-autofocus` takes focus; otherwise the browser focuses 닫기.
 */
export function Modal({ title, onClose, footer, size = "md", children }: { title: string; onClose: () => void; footer?: ReactNode; size?: keyof typeof WIDTH; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const unmounting = useRef(false);
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      unmounting.current = true;
      dialog.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // close() in the cleanup queues a close event of its own; only the browser's (Esc) should reach the owner.
      onClose={() => {
        if (unmounting.current) unmounting.current = false;
        else onClose();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
      className={`m-0 h-dvh max-h-none w-full max-w-none flex-col overflow-hidden bg-surface p-0 text-foreground backdrop:bg-background/85 backdrop:backdrop-blur-sm open:flex sm:m-auto sm:h-fit sm:max-h-[85dvh] sm:w-[calc(100%-2rem)] sm:rounded-xl sm:border sm:border-border ${WIDTH[size]}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border py-2 pl-5 pr-3">
        <h2 id={titleId} className="min-w-0 break-words text-base font-semibold">{title}</h2>
        <Button variant="ghost" size="sm" className="h-11 sm:h-9" onClick={onClose}>닫기</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
      {footer && <footer className="shrink-0 border-t border-border px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">{footer}</footer>}
    </dialog>
  );
}
