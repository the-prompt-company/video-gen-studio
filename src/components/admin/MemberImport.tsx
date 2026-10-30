"use client";

import { useState, type ChangeEvent } from "react";
import { INITIAL_PASSWORD } from "@/lib/credentials";
import { caught, type Reason } from "@/lib/errors";
import { MAX_IMPORT_ROWS, type ImportResponse, type ImportResult } from "@/lib/member-import";
import { membersFromSheet, type SheetMember } from "@/lib/member-sheet";
import { Badge, Button, ErrorText } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { useErrorText } from "@/i18n/errors";
import { api } from "./AdminPanels";

type Checked = { file: string; members: SheetMember[]; results: ImportResult[] };

type Phase =
  | { step: "idle" }
  | { step: "working"; file: string; doing: string }
  | ({ step: "preview"; error?: Reason } & Checked)
  | ({ step: "done" } & Checked)
  | { step: "failed"; file: string; error: Reason };

const OUTCOME: Record<ImportResult["outcome"], { label: string; tone: string; order: number }> = {
  invalid: { label: "확인 필요", tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30", order: 0 },
  duplicate: { label: "파일 안 중복", tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30", order: 1 },
  exists: { label: "이미 있음", tone: "bg-zinc-500/15 text-muted ring-zinc-500/30", order: 2 },
  create: { label: "만들 예정", tone: "bg-sky-500/15 text-sky-300 ring-sky-500/30", order: 3 },
  created: { label: "만듦", tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30", order: 3 },
};

const NOT_XLSX = "엑셀 통합 문서(.xlsx)만 읽을 수 있습니다. 엑셀에서 다른 이름으로 저장 → Excel 통합 문서(.xlsx)로 저장한 뒤 다시 고르세요";
const UNREADABLE = "파일을 읽지 못했습니다. 엑셀에서 열리는지 확인하고, 암호가 걸려 있으면 풀어서 .xlsx로 다시 저장한 뒤 고르세요";

function submit(members: SheetMember[], dryRun: boolean) {
  const rows = members.map(({ nickname, email }) => ({ nickname, email }));
  return api<ImportResponse>("/api/admin/users/import", { method: "POST", body: JSON.stringify({ rows, dryRun }) });
}

export function MemberImport({ onCreated, onClose }: { onCreated: () => Promise<void>; onClose: () => void }) {
  const errorText = useErrorText();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const file = picked.name;
    if (!/\.xlsx$/i.test(file)) return setPhase({ step: "failed", file, error: { text: NOT_XLSX } });

    setPhase({ step: "working", file, doing: "읽는 중…" });
    let sheet: unknown[][];
    try {
      const { readSheet } = await import("read-excel-file/browser");
      sheet = await readSheet(picked, { trim: false });
    } catch {
      return setPhase({ step: "failed", file, error: { text: UNREADABLE } });
    }
    const read = membersFromSheet(sheet);
    if (!read.ok) return setPhase({ step: "failed", file, error: { text: read.error } });

    setPhase({ step: "working", file, doing: "확인하는 중…" });
    try {
      const { results } = await submit(read.members, true);
      setPhase({ step: "preview", file, members: read.members, results });
    } catch (err) {
      setPhase({ step: "failed", file, error: caught(err) });
    }
  }

  async function create({ file, members, results: preview }: Checked) {
    setPhase({ step: "working", file, doing: "만드는 중…" });
    try {
      const { results } = await submit(members, false);
      setPhase({ step: "done", file, members, results });
      await onCreated();
    } catch (err) {
      setPhase({ step: "preview", file, members, results: preview, error: caught(err) });
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
      title="엑셀로 회원 만들기"
      size="lg"
      onClose={onClose}
      footer={
        phase.step === "preview" ? (
          <PreviewActions checked={phase} error={phase.error && errorText(phase.error)} onCreate={() => create(phase)} onCancel={() => setPhase({ step: "idle" })} />
        ) : (
          picker(phase.step === "idle" || busy ? "엑셀 파일 고르기" : "다른 파일 고르기")
        )
      }
    >
      <div className="space-y-4 text-sm">
        <p className="break-keep text-xs leading-relaxed text-muted">
          첫 시트에서 처음 채워진 줄을 제목으로 읽습니다. 이메일이 로그인 ID가 되고, 초기 비밀번호 <span className="font-mono text-foreground-2">{INITIAL_PASSWORD}</span>로 첫 로그인 때 새 비밀번호를 정합니다.
        </p>
        <FormatExample />

        {phase.step === "working" && (
          <p role="status" className="truncate text-muted">
            <span className="text-foreground-2">{phase.file}</span> {phase.doing}
          </p>
        )}
        {phase.step === "failed" && (
          <div className="space-y-2">
            <p className="truncate text-xs text-subtle" title={phase.file}>{phase.file}</p>
            <ErrorText>{errorText(phase.error)}</ErrorText>
          </div>
        )}
        {(phase.step === "preview" || phase.step === "done") && <Results checked={phase} />}
      </div>
    </Modal>
  );
}

function FormatExample() {
  return (
    <figure className="space-y-1.5">
      <div className="overflow-hidden rounded-md border border-border">
        <table aria-label="엑셀 형식 예시" className="w-full table-fixed text-xs">
          <thead className="bg-surface-2 text-left text-muted">
            <tr>
              <th className="w-2/5 px-2.5 py-1.5 font-medium">nickname</th>
              <th className="px-2.5 py-1.5 font-medium">email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-foreground-2">
            <tr>
              <td className="px-2.5 py-1.5">김민지</td>
              <td className="truncate px-2.5 py-1.5">minji@company.com</td>
            </tr>
            <tr>
              <td className="px-2.5 py-1.5">Park Joon</td>
              <td className="truncate px-2.5 py-1.5">joon@company.com</td>
            </tr>
          </tbody>
        </table>
      </div>
      <figcaption className="break-keep text-xs text-subtle">제목은 닉네임 · 이메일로 써도 됩니다. 다른 열은 읽지 않고, 한 번에 {MAX_IMPORT_ROWS}명까지 만듭니다.</figcaption>
    </figure>
  );
}

function detail(result: ImportResult, members: SheetMember[], errorText: (reason: Reason) => string): string {
  switch (result.outcome) {
    case "create":
    case "created":
      return `닉네임 ${result.nickname}`;
    case "exists":
      return "이 이메일의 ID가 이미 있습니다";
    case "duplicate":
      return `${members[result.firstIndex].sheetRow}행과 이메일이 같습니다. 첫 행만 만듭니다`;
    case "invalid":
      return errorText(result.reason);
  }
}

function Results({ checked }: { checked: Checked & { step: "preview" | "done" } }) {
  const errorText = useErrorText();
  const { file, members, results } = checked;
  const counts = new Map<ImportResult["outcome"], number>();
  for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const rows = members
    .map((member, i) => ({ member, result: results[i] }))
    .sort((a, b) => OUTCOME[a.result.outcome].order - OUTCOME[b.result.outcome].order || a.member.sheetRow - b.member.sheetRow);
  const created = counts.get("created") ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-foreground-2" title={file}>{file}</span>
        <span className="shrink-0 text-xs tabular-nums text-subtle">{members.length}행</span>
      </div>
      {checked.step === "done" && (
        <p role="status" className="text-foreground">
          {created > 0 ? `${created}명을 만들었습니다. 사용자 표에 임시 비밀번호로 표시됩니다.` : "새로 만든 회원이 없습니다."}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" aria-label="결과 요약">
        {(Object.keys(OUTCOME) as ImportResult["outcome"][])
          .filter((o) => counts.has(o))
          .map((o) => (
            <Badge key={o} className={OUTCOME[o].tone}>
              {OUTCOME[o].label} <span className="ml-1 tabular-nums">{counts.get(o)}</span>
            </Badge>
          ))}
      </div>
      <ul aria-label="행별 결과" className="divide-y divide-border rounded-md border border-border">
        {rows.map(({ member, result }) => {
          const id = "username" in result ? result.username : member.email.trim() || "이메일 없음";
          return (
            <li key={member.sheetRow} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-foreground" title={id}>{id}</div>
                <div className="break-keep text-xs text-muted">
                  <span className="tabular-nums text-subtle">{member.sheetRow}행</span> · {detail(result, members, errorText)}
                </div>
              </div>
              <Badge className={`mt-0.5 ${OUTCOME[result.outcome].tone}`}>{OUTCOME[result.outcome].label}</Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PreviewActions({ checked, error, onCreate, onCancel }: { checked: Checked; error?: string; onCreate: () => void; onCancel: () => void }) {
  const creatable = checked.results.filter((r) => r.outcome === "create").length;
  return (
    <div className="space-y-2">
      {error && <ErrorText>{error}</ErrorText>}
      {creatable === 0 && <p className="break-keep text-xs text-muted">만들 수 있는 행이 없습니다. 파일을 고친 뒤 다시 고르세요.</p>}
      <div className="flex gap-2">
        <Button className="h-11 flex-1 sm:h-10" onClick={onCreate} disabled={creatable === 0}>
          {creatable}명 만들기
        </Button>
        <Button variant="ghost" className="h-11 sm:h-10" onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  );
}
