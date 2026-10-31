"use client";

import { useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { INITIAL_PASSWORD } from "@/lib/credentials";
import { caught, type Reason } from "@/lib/errors";
import { MAX_IMPORT_ROWS, type ImportResponse, type ImportResult } from "@/lib/member-import";
import { COLUMNS, membersFromSheet, type SheetMember, type SheetProblem } from "@/lib/member-sheet";
import { Badge, Button, ErrorText } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { useErrorText } from "@/i18n/errors";
import { api } from "./AdminPanels";

type Checked = { file: string; members: SheetMember[]; results: ImportResult[] };

type Failure = { kind: "notXlsx" } | { kind: "unreadable" } | { kind: "server"; reason: Reason } | SheetProblem;

type Phase =
  | { step: "idle" }
  | { step: "working"; file: string; doing: "reading" | "checking" | "creating" }
  | ({ step: "preview"; error?: Reason } & Checked)
  | ({ step: "done" } & Checked)
  | { step: "failed"; file: string; failure: Failure };

const OUTCOME: Record<ImportResult["outcome"], { tone: string; order: number }> = {
  invalid: { tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30", order: 0 },
  duplicate: { tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30", order: 1 },
  exists: { tone: "bg-zinc-500/15 text-muted ring-zinc-500/30", order: 2 },
  create: { tone: "bg-sky-500/15 text-sky-300 ring-sky-500/30", order: 3 },
  created: { tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30", order: 3 },
};

const HEADERS = {
  nickname: COLUMNS.nickname.header,
  email: COLUMNS.email.header,
  nicknameAlias: COLUMNS.nickname.alias,
  emailAlias: COLUMNS.email.alias,
};

function submit(members: SheetMember[], dryRun: boolean) {
  const rows = members.map(({ nickname, email }) => ({ nickname, email }));
  return api<ImportResponse>("/api/admin/users/import", { method: "POST", body: JSON.stringify({ rows, dryRun }) });
}

export function MemberImport({ onCreated, onClose }: { onCreated: () => Promise<void>; onClose: () => void }) {
  const t = useTranslations("import");
  const errorText = useErrorText();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const file = picked.name;
    if (!/\.xlsx$/i.test(file)) return setPhase({ step: "failed", file, failure: { kind: "notXlsx" } });

    setPhase({ step: "working", file, doing: "reading" });
    let sheet: unknown[][];
    try {
      const { readSheet } = await import("read-excel-file/browser");
      sheet = await readSheet(picked, { trim: false });
    } catch {
      return setPhase({ step: "failed", file, failure: { kind: "unreadable" } });
    }
    const read = membersFromSheet(sheet);
    if (!read.ok) return setPhase({ step: "failed", file, failure: read.problem });

    setPhase({ step: "working", file, doing: "checking" });
    try {
      const { results } = await submit(read.members, true);
      setPhase({ step: "preview", file, members: read.members, results });
    } catch (err) {
      setPhase({ step: "failed", file, failure: { kind: "server", reason: caught(err) } });
    }
  }

  async function create({ file, members, results: preview }: Checked) {
    setPhase({ step: "working", file, doing: "creating" });
    try {
      const { results } = await submit(members, false);
      setPhase({ step: "done", file, members, results });
      await onCreated();
    } catch (err) {
      setPhase({ step: "preview", file, members, results: preview, error: caught(err) });
    }
  }

  function failureText(failure: Failure): string {
    switch (failure.kind) {
      case "notXlsx":
      case "unreadable":
        return t(`failure.${failure.kind}`);
      case "server":
        return errorText(failure.reason);
      case "empty":
        return t("failure.empty", HEADERS);
      case "missingColumns":
        return t("failure.missingColumns", { ...HEADERS, row: String(failure.headerRow), missing: failure.missing, found: failure.found.join(", ") });
    }
  }

  const busy = phase.step === "working";
  const picker = (label: string) => (
    <label className={`inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-full border border-foreground/40 px-5 text-sm font-medium text-foreground transition hover:border-foreground hover:bg-white/5 focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-background sm:h-10 ${busy ? "pointer-events-none opacity-40" : ""}`}>
      {label}
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={pick} disabled={busy} />
    </label>
  );

  return (
    <Modal
      title={t("title")}
      size="lg"
      onClose={onClose}
      footer={
        phase.step === "preview" ? (
          <PreviewActions checked={phase} error={phase.error && errorText(phase.error)} onCreate={() => create(phase)} onCancel={() => setPhase({ step: "idle" })} />
        ) : (
          picker(phase.step === "idle" || busy ? t("pick.first") : t("pick.another"))
        )
      }
    >
      <div className="space-y-4 text-sm">
        <p className="break-keep text-xs leading-relaxed text-muted">
          {t.rich("intro", { password: INITIAL_PASSWORD, pw: (chunks) => <span className="font-mono text-foreground-2">{chunks}</span> })}
        </p>
        <FormatExample />

        {phase.step === "working" && (
          <p role="status" className="truncate text-muted">
            {t.rich("working", { doing: phase.doing, file: phase.file, name: (chunks) => <span className="text-foreground-2">{chunks}</span> })}
          </p>
        )}
        {phase.step === "failed" && (
          <div className="space-y-2">
            <p className="truncate text-xs text-subtle" title={phase.file}>{phase.file}</p>
            <ErrorText>{failureText(phase.failure)}</ErrorText>
          </div>
        )}
        {(phase.step === "preview" || phase.step === "done") && <Results checked={phase} />}
      </div>
    </Modal>
  );
}

function FormatExample() {
  const t = useTranslations("import.example");
  return (
    <figure className="space-y-1.5">
      <div className="overflow-hidden rounded-md border border-border">
        <table aria-label={t("label")} className="w-full table-fixed text-xs">
          <thead className="bg-surface-2 text-left text-muted">
            <tr>
              <th className="w-2/5 px-2.5 py-1.5 font-medium">{HEADERS.nickname}</th>
              <th className="px-2.5 py-1.5 font-medium">{HEADERS.email}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-foreground-2">
            <tr>
              <td className="px-2.5 py-1.5">{t("nickname")}</td>
              <td className="truncate px-2.5 py-1.5">minji@company.com</td>
            </tr>
            <tr>
              <td className="px-2.5 py-1.5">Park Joon</td>
              <td className="truncate px-2.5 py-1.5">joon@company.com</td>
            </tr>
          </tbody>
        </table>
      </div>
      <figcaption className="break-keep text-xs text-subtle">
        {t("caption", { nicknameAlias: HEADERS.nicknameAlias, emailAlias: HEADERS.emailAlias, max: MAX_IMPORT_ROWS })}
      </figcaption>
    </figure>
  );
}

function Results({ checked }: { checked: Checked & { step: "preview" | "done" } }) {
  const t = useTranslations("import");
  const errorText = useErrorText();
  const { file, members, results } = checked;
  const counts = new Map<ImportResult["outcome"], number>();
  for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const rows = members
    .map((member, i) => ({ member, result: results[i] }))
    .sort((a, b) => OUTCOME[a.result.outcome].order - OUTCOME[b.result.outcome].order || a.member.sheetRow - b.member.sheetRow);

  function detail(result: ImportResult): string {
    switch (result.outcome) {
      case "create":
      case "created":
        return t("detail.nickname", { nickname: result.nickname });
      case "exists":
        return t("detail.exists");
      case "duplicate":
        return t("detail.duplicate", { row: String(members[result.firstIndex].sheetRow) });
      case "invalid":
        return errorText(result.reason);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-foreground-2" title={file}>{file}</span>
        <span className="shrink-0 text-xs tabular-nums text-subtle">{t("rowCount", { count: members.length })}</span>
      </div>
      {checked.step === "done" && (
        <p role="status" className="text-foreground">
          {t("done", { count: counts.get("created") ?? 0 })}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" aria-label={t("summary")}>
        {(Object.keys(OUTCOME) as ImportResult["outcome"][])
          .filter((o) => counts.has(o))
          .map((o) => (
            <Badge key={o} className={OUTCOME[o].tone}>
              {t(`outcome.${o}`)} <span className="ml-1 tabular-nums">{counts.get(o)}</span>
            </Badge>
          ))}
      </div>
      <ul aria-label={t("rows")} className="divide-y divide-border rounded-md border border-border">
        {rows.map(({ member, result }) => {
          const id = "username" in result ? result.username : member.email.trim() || t("noEmail");
          return (
            <li key={member.sheetRow} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-foreground" title={id}>{id}</div>
                <div className="break-keep text-xs text-muted">
                  <span className="tabular-nums text-subtle">{t("row", { row: String(member.sheetRow) })}</span> · {detail(result)}
                </div>
              </div>
              <Badge className={`mt-0.5 ${OUTCOME[result.outcome].tone}`}>{t(`outcome.${result.outcome}`)}</Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PreviewActions({ checked, error, onCreate, onCancel }: { checked: Checked; error?: string; onCreate: () => void; onCancel: () => void }) {
  const t = useTranslations("import");
  const tCommon = useTranslations("common");
  const creatable = checked.results.filter((r) => r.outcome === "create").length;
  return (
    <div className="space-y-2">
      {error && <ErrorText>{error}</ErrorText>}
      {creatable === 0 && <p className="break-keep text-xs text-muted">{t("nothingToCreate")}</p>}
      <div className="flex gap-2">
        <Button className="h-11 flex-1 sm:h-10" onClick={onCreate} disabled={creatable === 0}>
          {t("submit", { count: creatable })}
        </Button>
        <Button variant="ghost" className="h-11 sm:h-10" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>
    </div>
  );
}
