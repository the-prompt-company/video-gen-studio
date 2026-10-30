"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { PublicGeneration } from "@/lib/generations";
import { caught, type Reason } from "@/lib/errors";
import { FAMILIES, FAMILY_IDS, modelLine, type Mode } from "@/lib/catalog";
import { GENERATION_STATUSES } from "@/lib/generation-status";
import { Button, Card, Select, Empty } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { useErrorText } from "@/i18n/errors";
import { dateTime, usd } from "@/i18n/format";
import { api } from "./AdminPanels";

type UserOpt = { id: number; username: string };

const CSV_ROWS = 500;

export function LogsPanel() {
  const t = useTranslations("logs");
  const tCommon = useTranslations("common");
  const tGeneration = useTranslations("generation");
  const tStatus = useTranslations("status");
  const tMode = useTranslations("mode");
  const modeName = (m: Mode) => tMode(m);
  const format = useFormatter();
  const errorText = useErrorText();
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [f, setF] = useState({ userId: "", modelId: "", status: "" });
  const [items, setItems] = useState<PublicGeneration[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<PublicGeneration | null>(null);
  const [error, setError] = useState<Reason | null>(null);

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
      .catch((e) => setError(caught(e)));
  }, [qs]);

  async function more() {
    const last = items[items.length - 1];
    if (!last) return;
    const b = await api<{ items: PublicGeneration[] }>(`/api/admin/generations?${qs({ limit: "50", before: new Date(last.createdAt).toISOString() })}`);
    setItems((x) => [...x, ...b.items]);
  }

  return (
    <Card
      title={t("title", { count: total })}
      action={
        <a href={`/api/admin/generations?${qs({ format: "csv", limit: String(CSV_ROWS) })}`} className="text-xs text-accent-soft hover:underline">
          {t("csv", { count: CSV_ROWS })}
        </a>
      }
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
          <option value="">{t("filter.allMembers")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </Select>
        <Select value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value })}>
          <option value="">{t("filter.allModels")}</option>
          {FAMILY_IDS.map((id) => (
            <option key={id} value={id}>{FAMILIES[id].name}</option>
          ))}
        </Select>
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">{t("filter.allStatuses")}</option>
          {GENERATION_STATUSES.map((s) => (
            <option key={s} value={s}>{tStatus(s)}</option>
          ))}
        </Select>
      </div>
      {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{errorText(error)}</p>}
      {items.length === 0 ? (
        <Empty>{t("empty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-subtle">
              <tr>
                <th className="py-2 pr-3 font-medium">{t("field.time")}</th>
                <th className="py-2 pr-3 font-medium">{t("field.member")}</th>
                <th className="py-2 pr-3 font-medium">{t("field.status")}</th>
                <th className="py-2 pr-3 font-medium">{t("field.model")}</th>
                <th className="py-2 pr-3 font-medium">{t("field.prompt")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("field.duration")}</th>
                <th className="py-2 text-right font-medium">{t("field.cost")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((g) => (
                <tr key={g.id} onClick={() => setOpen(g)} className="cursor-pointer hover:bg-white/5">
                  <td className="whitespace-nowrap py-2 pr-3 text-muted">{dateTime(format, g.createdAt)}</td>
                  <td className="py-2 pr-3 text-foreground">{g.username}</td>
                  <td className="py-2 pr-3"><StatusBadge status={g.status} /></td>
                  <td className="whitespace-nowrap py-2 pr-3 text-foreground-2">{modelLine(g.modelId, modeName)}</td>
                  <td className="max-w-[280px] truncate py-2 pr-3 text-foreground-2">{g.prompt || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted">{t("seconds", { seconds: String(g.durationS) })}</td>
                  <td className="py-2 text-right tabular-nums">{usd(format, g.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length < total && (
            <div className="mt-3 text-center">
              <Button variant="outline" size="sm" onClick={more}>{t("more")}</Button>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-2xl space-y-3 rounded-2xl border border-border bg-surface p-5 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <StatusBadge status={open.status} />
              <span className="text-xs text-subtle">{open.username} · {dateTime(format, open.createdAt)}</span>
            </div>
            {open.video && <video src={open.video.url} controls className="w-full rounded-lg bg-black" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {open.image && <img src={open.image.url} alt={tGeneration("image")} className="max-h-[60dvh] w-full rounded-lg bg-black object-contain" />}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs text-muted [&>dt]:whitespace-nowrap">
              <dt>{t("field.model")}</dt><dd className="break-words text-foreground-2">{modelLine(open.modelId, modeName)} <span className="break-all font-mono text-subtle">{open.modelId}</span></dd>
              <dt>{t("field.prompt")}</dt><dd className="break-words text-foreground-2">{open.prompt || "—"}</dd>
              <dt>{t("field.params")}</dt><dd className="break-all font-mono text-foreground-2">{JSON.stringify(open.params)}</dd>
              <dt>{t("field.images")}</dt><dd className="break-all text-foreground-2">{open.imageRefs.join(", ") || "—"}</dd>
              <dt>{t("field.videos")}</dt><dd className="break-all text-foreground-2">{open.videoRefs.join(", ") || "—"}</dd>
              <dt>{t("field.cost")}</dt><dd className="text-foreground-2">{usd(format, open.costUsd)} ({t("seconds", { seconds: String(open.durationS) })})</dd>
              {open.reason && (<><dt>{t("field.error")}</dt><dd className="break-words text-rose-300">{errorText(open.reason)}</dd></>)}
            </dl>
            <div className="text-right"><Button variant="outline" size="sm" onClick={() => setOpen(null)}>{tCommon("close")}</Button></div>
          </div>
        </div>
      )}
    </Card>
  );
}
