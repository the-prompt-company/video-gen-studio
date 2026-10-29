"use client";

import { useCallback, useEffect, useState } from "react";
import { estimateCostUsd, FAMILIES, isFamilyId } from "@/lib/catalog";
import { usd } from "@/lib/format";
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
    <Card title="모델 단가">
      <p className="mb-4 text-xs leading-relaxed text-subtle">
        Higgsfield 응답에는 비용이 없어서, 생성을 요청할 때 이 단가와 Higgsfield의 요금 규칙(해상도, 화면비, 길이, 영상 레퍼런스 길이)으로 비용을 정해 기록합니다. 단가를 바꾸면 그다음 요청부터 적용되고, 실제 청구 금액은 Higgsfield 인보이스가 기준입니다.
      </p>
      {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      <ul aria-label="모델" className="divide-y divide-border text-sm">
        {rows.map((r) => {
            const family = isFamilyId(r.modelId) ? FAMILIES[r.modelId] : null;
            const typed = Number(draft[r.modelId]);
            const example = family && Number.isFinite(typed) && typed > 0 ? estimateCostUsd(family.rate.example.basis, typed) : null;
            const unitId = `rate-unit-${r.modelId.replace(/\W/g, "-")}`;
            return (
              <li key={r.modelId} aria-label={r.name} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-start">
                <div>
                  <div className="text-foreground">{r.name} <span className="text-xs text-subtle">· {r.vendor}</span></div>
                  <div className="font-mono text-[11px] text-subtle">{r.modelId}</div>
                </div>
                <div>
                  {family && <div id={unitId} className="mb-1.5 text-xs font-medium text-muted">{family.rate.basis} 기준 초당 USD</div>}
                  <div className="flex items-center gap-2">
                    <div className="w-36">
                      <Input
                        type="number"
                        step="0.0001"
                        min={0}
                        aria-label={`${r.name} 단가`}
                        aria-describedby={family ? unitId : undefined}
                        value={draft[r.modelId] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [r.modelId]: e.target.value })}
                        className="font-mono"
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => save(r.modelId, { pricePerSecUsd: typed })} disabled={typed === r.pricePerSecUsd}>
                      저장
                    </Button>
                  </div>
                  {family && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                      {family.rate.published.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setDraft({ ...draft, [r.modelId]: String(p.usd) })}
                          aria-label={`${p.label} ${p.usd}로 채우기`}
                          className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 text-foreground-2 transition hover:border-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          {p.label} <span className="tabular-nums text-foreground">${p.usd}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {family && (
                    <div className="mt-1.5 text-xs tabular-nums text-subtle">
                      {example === null ? "단가를 넣으면 예시 비용이 보입니다" : `예: ${family.rate.example.label} ${usd(example)}`}
                    </div>
                  )}
                </div>
                <div>
                  <Button size="sm" variant={r.enabled ? "ghost" : "primary"} onClick={() => save(r.modelId, { enabled: !r.enabled })}>
                    {r.enabled ? "사용 중 · 끄기" : "꺼짐 · 켜기"}
                  </Button>
                </div>
              </li>
            );
          })}
      </ul>
    </Card>
  );
}
