"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { api } from "./AdminPanels";

type Row = { modelId: string; name: string; vendor: string; pricePerSecUsd: number; enabled: boolean; note: string | null };

export function ModelsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await api<{ items: Row[] }>("/api/admin/models");
      setRows(b.items);
      setDraft(Object.fromEntries(b.items.map((r) => [r.modelId, String(r.pricePerSecUsd)])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    api<{ items: Row[] }>("/api/admin/models")
      .then((b) => {
        setRows(b.items);
        setDraft(Object.fromEntries(b.items.map((r) => [r.modelId, String(r.pricePerSecUsd)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save(modelId: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api("/api/admin/models", { method: "PATCH", body: JSON.stringify({ modelId, ...body }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card title="모델 단가 (USD / 초)">
      <p className="mb-4 text-xs text-zinc-500">
        Higgsfield API 응답에는 비용이 없으므로 여기 단가 × 요청한 길이(초)로 과금을 계산합니다. 단가는 Higgsfield 콘솔의 모델 가격표를 보고 넣으세요.
      </p>
      {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="py-2 pr-3 font-medium">모델</th>
            <th className="py-2 pr-3 font-medium">단가</th>
            <th className="py-2 font-medium">상태</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.modelId}>
              <td className="py-3 pr-3">
                <div className="text-zinc-100">{r.name} <span className="text-xs text-zinc-500">· {r.vendor}</span></div>
                <div className="font-mono text-[11px] text-zinc-500">{r.modelId}</div>
              </td>
              <td className="py-3 pr-3">
                <div className="flex items-center gap-2">
                  <Input type="number" step="0.0001" min={0} value={draft[r.modelId] ?? ""} onChange={(e) => setDraft({ ...draft, [r.modelId]: e.target.value })} className="w-32 font-mono" />
                  <Button size="sm" variant="outline" onClick={() => save(r.modelId, { pricePerSecUsd: Number(draft[r.modelId]) })} disabled={Number(draft[r.modelId]) === r.pricePerSecUsd}>
                    저장
                  </Button>
                </div>
              </td>
              <td className="py-3">
                <Button size="sm" variant={r.enabled ? "ghost" : "primary"} onClick={() => save(r.modelId, { enabled: !r.enabled })}>
                  {r.enabled ? "사용 중 · 끄기" : "꺼짐 · 켜기"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
