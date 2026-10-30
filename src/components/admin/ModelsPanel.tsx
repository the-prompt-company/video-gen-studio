"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { costUsd, FAMILIES, isFamilyId, type PricePreset } from "@/lib/catalog";
import { caught, type Reason } from "@/lib/errors";
import { Button, Card, Input } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { usd } from "@/i18n/format";
import { api } from "./AdminPanels";

type Row = { modelId: string; name: string; vendor: string; pricePerSecUsd: number; enabled: boolean; note: string | null };

export function ModelsPanel() {
  const format = useFormatter();
  const errorText = useErrorText();
  const tPrices = useTranslations("prices");
  const presetLabel = (p: PricePreset) => (p.preset === "higgsfieldTable" ? tPrices("preset.higgsfieldTable", { discount: String(p.discount) }) : tPrices(`preset.${p.preset}`));
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<Reason | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await api<{ items: Row[] }>("/api/admin/models");
      setRows(b.items);
      setDraft(Object.fromEntries(b.items.map((r) => [r.modelId, String(r.pricePerSecUsd)])));
    } catch (e) {
      setError(caught(e));
    }
  }, []);
  useEffect(() => {
    api<{ items: Row[] }>("/api/admin/models")
      .then((b) => {
        setRows(b.items);
        setDraft(Object.fromEntries(b.items.map((r) => [r.modelId, String(r.pricePerSecUsd)])));
      })
      .catch((e) => setError(caught(e)));
  }, []);

  async function save(modelId: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api("/api/admin/models", { method: "PATCH", body: JSON.stringify({ modelId, ...body }) });
      await load();
    } catch (e) {
      setError(caught(e));
    }
  }

  return (
    <Card title="모델 단가">
      <p className="mb-4 text-xs leading-relaxed text-subtle">
        Higgsfield 응답에는 비용이 없어서, 영상은 생성을 요청할 때 이 단가와 Higgsfield의 요금 규칙(해상도, 화면비, 길이, 영상 레퍼런스 길이)으로 비용을 정해 기록합니다. GPT Image 2는 OpenAI가 응답에 알려 준 토큰 수에 이 단가(이미지 출력 100만 토큰당)와 OpenAI의 입력 단가 비율(텍스트 5/30, 이미지 8/30)을 곱해 기록하고, 토큰 수가 없으면 예상 비용을 씁니다. 단가를 바꾸면 그다음 요청부터 적용되고, 실제 청구 금액은 각 회사의 인보이스가 기준입니다.
      </p>
      {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{errorText(error)}</p>}
      <ul aria-label="모델" className="divide-y divide-border text-sm">
        {rows.map((r) => {
            const family = isFamilyId(r.modelId) ? FAMILIES[r.modelId] : null;
            const typed = Number(draft[r.modelId]);
            const example = family && Number.isFinite(typed) && typed > 0 ? costUsd(family.rate.example, typed) : null;
            const unitId = `rate-unit-${r.modelId.replace(/\W/g, "-")}`;
            return (
              <li key={r.modelId} aria-label={r.name} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-start">
                <div>
                  <div className="text-foreground">{r.name} <span className="text-xs text-subtle">· {r.vendor}</span></div>
                  <div className="font-mono text-[11px] text-subtle">{r.modelId}</div>
                </div>
                <div>
                  {family && <div id={unitId} className="mb-1.5 text-xs font-medium text-muted">{tPrices(`basis.${family.key}`)} 기준 {tPrices("per", { unit: family.rate.unit })} USD</div>}
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
                          key={p.preset}
                          type="button"
                          onClick={() => setDraft({ ...draft, [r.modelId]: String(p.usd) })}
                          aria-label={`${presetLabel(p)} ${p.usd}로 채우기`}
                          className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 text-foreground-2 transition hover:border-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          {presetLabel(p)} <span className="tabular-nums text-foreground">${p.usd}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {family && (
                    <div className="mt-1.5 text-xs tabular-nums text-subtle">
                      {example === null ? "단가를 넣으면 예시 비용이 보입니다" : `예: ${tPrices(`example.${family.key}`)} ${usd(format, example)}`}
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
