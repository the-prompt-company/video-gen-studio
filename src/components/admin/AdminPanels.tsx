"use client";

import { useState } from "react";
import { UsersPanel } from "./UsersPanel";
import { ModelsPanel } from "./ModelsPanel";
import { LogsPanel } from "./LogsPanel";

const TABS = [
  { id: "users", label: "사용자 · API 키" },
  { id: "models", label: "모델 · 단가" },
  { id: "logs", label: "로그 · 히스토리" },
] as const;

export function AdminPanels({ adminId }: { adminId: number }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("users");
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg border border-border p-1 text-sm">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1.5 ${tab === t.id ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersPanel adminId={adminId} />}
      {tab === "models" && <ModelsPanel />}
      {tab === "logs" && <LogsPanel />}
    </div>
  );
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
