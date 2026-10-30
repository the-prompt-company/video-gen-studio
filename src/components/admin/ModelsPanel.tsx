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
  const t = useTranslations("models");
  const tCommon = useTranslations("common");
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
    <Card title={t("title")}>
      <p className="mb-4 text-xs leading-relaxed text-subtle">{t("lead")}</p>
      {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{errorText(error)}</p>}
      <ul aria-label={t("list")} className="divide-y divide-border text-sm">
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
                  {family && (
                    <div id={unitId} className="mb-1.5 text-xs font-medium text-muted">
                      {t("unit", { basis: tPrices(`basis.${family.key}`), per: tPrices("per", { unit: family.rate.unit }) })}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="w-36">
                      <Input
                        type="number"
                        step="0.0001"
                        min={0}
                        aria-label={t("rateLabel", { model: r.name })}
                        aria-describedby={family ? unitId : undefined}
                        value={draft[r.modelId] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [r.modelId]: e.target.value })}
                        className="font-mono"
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => save(r.modelId, { pricePerSecUsd: typed })} disabled={typed === r.pricePerSecUsd}>
                      {tCommon("save")}
                    </Button>
                  </div>
                  {family && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                      {family.rate.published.map((p) => {
                        const rate = `$${p.usd}`;
                        return (
                          <button
                            key={p.preset}
                            type="button"
                            onClick={() => setDraft({ ...draft, [r.modelId]: String(p.usd) })}
                            aria-label={t("fill", { label: presetLabel(p), rate })}
                            className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 text-foreground-2 transition hover:border-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          >
                            {presetLabel(p)} <span className="tabular-nums text-foreground">{rate}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {family && (
                    <div className="mt-1.5 text-xs tabular-nums text-subtle">
                      {example === null ? t("exampleEmpty") : t("example", { example: tPrices(`example.${family.key}`), cost: usd(format, example) })}
                    </div>
                  )}
                </div>
                <div>
                  <Button size="sm" variant={r.enabled ? "ghost" : "primary"} onClick={() => save(r.modelId, { enabled: !r.enabled })}>
                    {t("toggle", { enabled: r.enabled ? "yes" : "no" })}
                  </Button>
                </div>
              </li>
            );
          })}
      </ul>
    </Card>
  );
}
