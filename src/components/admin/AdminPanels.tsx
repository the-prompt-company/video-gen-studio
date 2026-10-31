"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, parseAppError } from "@/lib/errors";
import { UsersPanel } from "./UsersPanel";
import { TeamsPanel } from "./TeamsPanel";
import { ModelsPanel } from "./ModelsPanel";
import { LogsPanel } from "./LogsPanel";

const TABS = ["users", "teams", "models", "logs"] as const;

export function AdminPanels({ adminId }: { adminId: number }) {
  const t = useTranslations("admin.tabs");
  const [tab, setTab] = useState<(typeof TABS)[number]>("users");
  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border p-1 text-sm">
        {TABS.map((id) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`min-h-11 shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 sm:min-h-0 ${tab === id ? "bg-white/10 text-white" : "text-muted hover:text-foreground"}`}>
            {t(id)}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersPanel adminId={adminId} />}
      {tab === "teams" && <TeamsPanel />}
      {tab === "models" && <ModelsPanel />}
      {tab === "logs" && <LogsPanel />}
    </div>
  );
}

/** Every admin request. A refusal or a lost connection throws an ApiError, which the panels show with useErrorText. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  } catch {
    throw new ApiError({ code: "network" });
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(parseAppError(body, res.status));
  return body as T;
}
