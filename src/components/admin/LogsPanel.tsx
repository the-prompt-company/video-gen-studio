"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicGeneration } from "@/lib/generations";
import { CATALOG } from "@/lib/catalog";
import { usd, fmtDate, shortModel, STATUS_LABEL } from "@/lib/format";
import { Button, Card, Select, Empty } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "./AdminPanels";

type UserOpt = { id: number; username: string };

export function LogsPanel() {
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [f, setF] = useState({ userId: "", modelId: "", status: "" });
  const [items, setItems] = useState<PublicGeneration[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<PublicGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      if (f.userId) p.set("userId", f.userId);
      if (f.modelId) p.set("modelId", f.modelId);
      if (f.status) p.set("status", f.status);
      for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return p.toString();
    },
    [f],
  );

  useEffect(() => {
    api<{ items: UserOpt[] }>("/api/admin/users").then((b) => setUsers(b.items)).catch(() => {});
  }, []);
  useEffect(() => {
    api<{ items: PublicGeneration[]; total: number }>(`/api/admin/generations?${qs({ limit: "50" })}`)
      .then((b) => {
        setItems(b.items);
        setTotal(b.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [qs]);

  async function more() {
    const last = items[items.length - 1];
    if (!last) return;
    const b = await api<{ items: PublicGeneration[] }>(`/api/admin/generations?${qs({ limit: "50", before: new Date(last.createdAt).toISOString() })}`);
    setItems((x) => [...x, ...b.items]);
  }

  return (
    <Card
      title={`히스토리 ${total}건`}
      action={
        <a href={`/api/admin/generations?${qs({ format: "csv", limit: "500" })}`} className="text-xs text-accent-2 hover:underline">
          CSV 내보내기 (최근 500)
        </a>
      }
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
          <option value="">모든 사용자</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </Select>
        <Select value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value })}>
          <option value="">모든 모델</option>
          {CATALOG.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Select>
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">모든 상태</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </div>
      {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {items.length === 0 ? (
        <Empty>조건에 맞는 기록이 없습니다.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="py-2 pr-3 font-medium">시각</th>
                <th className="py-2 pr-3 font-medium">사용자</th>
                <th className="py-2 pr-3 font-medium">상태</th>
                <th className="py-2 pr-3 font-medium">모델</th>
                <th className="py-2 pr-3 font-medium">프롬프트</th>
                <th className="py-2 pr-3 text-right font-medium">길이</th>
                <th className="py-2 text-right font-medium">비용</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((g) => (
                <tr key={g.id} onClick={() => setOpen(g)} className="cursor-pointer hover:bg-white/5">
                  <td className="whitespace-nowrap py-2 pr-3 text-zinc-400">{fmtDate(g.createdAt)}</td>
                  <td className="py-2 pr-3 text-zinc-100">{g.username}</td>
                  <td className="py-2 pr-3"><StatusBadge status={g.status} /></td>
                  <td className="whitespace-nowrap py-2 pr-3 text-zinc-300">{shortModel(g.modelId)}</td>
                  <td className="max-w-[280px] truncate py-2 pr-3 text-zinc-300">{g.prompt || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-400">{g.durationS}s</td>
                  <td className="py-2 text-right tabular-nums">{usd(g.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length < total && (
            <div className="mt-3 text-center">
              <Button variant="outline" size="sm" onClick={more}>더 보기</Button>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-2xl space-y-3 rounded-2xl border border-border bg-surface p-5 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <StatusBadge status={open.status} />
              <span className="text-xs text-zinc-500">{open.username} · {fmtDate(open.createdAt)}</span>
            </div>
            {open.resultUrl && open.status === "completed" && <video src={open.resultUrl} controls className="w-full rounded-lg bg-black" />}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-zinc-400">
              <dt>모델</dt><dd className="font-mono text-zinc-200">{open.modelId}</dd>
              <dt>프롬프트</dt><dd className="text-zinc-200">{open.prompt || "—"}</dd>
              <dt>파라미터</dt><dd className="font-mono text-zinc-200">{JSON.stringify(open.params)}</dd>
              <dt>이미지</dt><dd className="break-all text-zinc-300">{open.imageRefs.join(", ") || "—"}</dd>
              <dt>영상</dt><dd className="break-all text-zinc-300">{open.videoRefs.join(", ") || "—"}</dd>
              <dt>비용</dt><dd className="text-zinc-200">{usd(open.costUsd)} ({open.durationS}s)</dd>
              {open.error && (<><dt>오류</dt><dd className="text-rose-300">{open.error}</dd></>)}
            </dl>
            <div className="text-right"><Button variant="outline" size="sm" onClick={() => setOpen(null)}>닫기</Button></div>
          </div>
        </div>
      )}
    </Card>
  );
}
