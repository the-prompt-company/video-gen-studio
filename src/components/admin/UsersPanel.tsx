"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useFormatter } from "next-intl";
import type { UserUsageRow } from "@/lib/stats";
import { INITIAL_PASSWORD, loginId } from "@/lib/credentials";
import { MAX_NICKNAME_LENGTH } from "@/lib/nickname";
import type { Team, TeamId } from "@/lib/teams";
import { caught, type Reason } from "@/lib/errors";
import { Badge, Button, Card, Field, Input, Select, Empty, ErrorText } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { useErrorText } from "@/i18n/errors";
import { dateTime, usd } from "@/i18n/format";
import { api } from "./AdminPanels";
import { MemberImport } from "./MemberImport";

type Detail = { id: number; username: string; nickname: string | null; role: string; teamId: TeamId | null; active: boolean; note: string | null; apiKeyMasked: string | null; lockedUntil: string | null; failedAttempts: number; mustChangePassword: boolean };

type Draft = { username: string; password: string; role: string; apiKey: string; note: string };

type Editing = { kind: "edit"; member: Detail; error: Reason | null };

type Open = { kind: "add"; busy: boolean; error: Reason | null } | { kind: "import" } | { kind: "assign"; busy: boolean; error: Reason | null } | Editing;

const EMPTY: Draft = { username: "", password: "", role: "user", apiKey: "", note: "" };

const TEMPORARY_TONE = "bg-zinc-500/15 text-foreground-2 ring-zinc-500/30";

const ALL_TEAMS = "";
const NO_TEAM = "none";

const inFilter = (filter: string) => (r: UserUsageRow) => filter === ALL_TEAMS || (filter === NO_TEAM ? r.teamId === null : String(r.teamId) === filter);

export function UsersPanel({ adminId }: { adminId: number }) {
  const format = useFormatter();
  const errorText = useErrorText();
  const [rows, setRows] = useState<UserUsageRow[]>([]);
  const [error, setError] = useState<Reason | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  const visible = rows.filter(inFilter(teamFilter));
  const chosen = visible.filter((r) => selected.has(r.id));
  const allChosen = visible.length > 0 && chosen.length === visible.length;

  const load = useCallback(async () => {
    try {
      const b = await api<{ items: UserUsageRow[] }>("/api/admin/users");
      setRows(b.items);
    } catch (e) {
      setError(caught(e));
    }
  }, []);
  useEffect(() => {
    api<{ items: UserUsageRow[] }>("/api/admin/users")
      .then((b) => setRows(b.items))
      .catch((e) => setError(caught(e)));
    api<{ items: Team[] }>("/api/admin/teams")
      .then((b) => setTeams(b.items))
      .catch((e) => setError(caught(e)));
  }, []);

  function show(next: Open) {
    setNotice(null);
    setOpen(next);
  }

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  const close = () => setOpen(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setOpen({ kind: "add", busy: true, error: null });
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(draft) });
      setNotice(`${loginId(draft.username)} 계정을 추가했습니다.`);
      setDraft(EMPTY);
      setOpen((o) => (o?.kind === "add" ? null : o));
      await load();
    } catch (err) {
      setOpen((o) => (o?.kind === "add" ? { kind: "add", busy: false, error: caught(err) } : o));
    }
  }

  async function assign(teamId: TeamId | null) {
    setOpen({ kind: "assign", busy: true, error: null });
    try {
      const { updated } = await api<{ updated: number }>("/api/admin/users", { method: "PATCH", body: JSON.stringify({ userIds: chosen.map((r) => r.id), teamId }) });
      const team = teams.find((t) => t.id === teamId);
      setSelected(new Set());
      setOpen((o) => (o?.kind === "assign" ? null : o));
      setNotice(team ? `${updated}명을 ${team.name}에 지정했습니다.` : `${updated}명을 미소속으로 바꿨습니다.`);
      await load();
    } catch (err) {
      setOpen((o) => (o?.kind === "assign" ? { kind: "assign", busy: false, error: caught(err) } : o));
    }
  }

  async function edit(id: number) {
    try {
      show({ kind: "edit", member: await api<Detail>(`/api/admin/users/${id}`), error: null });
    } catch (e) {
      setError(caught(e));
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const update = (change: (o: Editing) => Editing) => setOpen((o) => (o?.kind === "edit" && o.member.id === id ? change(o) : o));
    update((o) => ({ ...o, error: null }));
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
      const member = await api<Detail>(`/api/admin/users/${id}`);
      update((o) => ({ ...o, member }));
    } catch (e) {
      update((o) => ({ ...o, error: caught(e) }));
    }
  }

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => show({ kind: "import" })}>엑셀로 회원 만들기</Button>
      <Button size="sm" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => show({ kind: "add", busy: false, error: null })}>사용자 추가</Button>
    </div>
  );

  return (
    <>
      <Card title={`사용자 ${rows.length}명`} action={toolbar}>
        {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{errorText(error)}</p>}
        {notice && <p role="status" className="mb-3 break-all text-sm text-foreground-2">{notice}</p>}
        {rows.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Select
              aria-label="팀으로 거르기"
              value={teamFilter}
              onChange={(e) => {
                setTeamFilter(e.target.value);
                setSelected(new Set());
              }}
              className="h-11 sm:h-9 sm:max-w-xs"
            >
              <option value={ALL_TEAMS}>모든 팀 ({rows.length}명)</option>
              <option value={NO_TEAM}>미소속 ({rows.filter(inFilter(NO_TEAM)).length}명)</option>
              {teams.map((t) => (
                <option key={t.id} value={String(t.id)}>{t.name} ({rows.filter(inFilter(String(t.id))).length}명)</option>
              ))}
            </Select>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-muted">{chosen.length}명 선택</span>
              <Button size="sm" variant="outline" className="h-11 sm:h-9" aria-haspopup="dialog" disabled={chosen.length === 0} onClick={() => show({ kind: "assign", busy: false, error: null })}>
                팀 지정
              </Button>
            </div>
          </div>
        )}
        {visible.length === 0 ? (
          <Empty>{rows.length === 0 ? "사용자가 없습니다." : teamFilter === NO_TEAM ? "미소속인 사용자가 없습니다." : "이 팀에 속한 사용자가 없습니다. 모든 팀으로 바꾼 뒤 사람을 골라 팀 지정을 누르세요."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-subtle">
                <tr>
                  <th className="w-8 py-0 pr-2 font-medium">
                    <label className="flex min-h-11 w-full min-w-11 cursor-pointer items-center sm:min-h-9 sm:min-w-0">
                      <input
                        type="checkbox"
                        aria-label="보이는 사용자 모두 선택"
                        checked={allChosen}
                        ref={(el) => {
                          if (el) el.indeterminate = chosen.length > 0 && !allChosen;
                        }}
                        onChange={() => setSelected(allChosen ? new Set() : new Set(visible.map((r) => r.id)))}
                        className="h-4 w-4 cursor-pointer"
                      />
                    </label>
                  </th>
                  <th className="py-2 pr-3 font-medium">ID</th>
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">닉네임</th>
                  <th className="py-2 pr-3 font-medium">팀</th>
                  <th className="py-2 pr-3 font-medium">역할</th>
                  <th className="py-2 pr-3 font-medium">키</th>
                  <th className="py-2 pr-3 text-right font-medium">생성</th>
                  <th className="py-2 pr-3 text-right font-medium">비용</th>
                  <th className="py-2 pr-3 font-medium">마지막 사용</th>
                  <th className="py-2 font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((r) => (
                  <tr
                    key={r.id}
                    // The whole row is the pointer target. The ID button is the keyboard one and where focus returns when the editor closes.
                    onClick={(e) => {
                      e.currentTarget.querySelector("button")?.focus();
                      edit(r.id);
                    }}
                    className={`cursor-pointer hover:bg-white/5 ${selected.has(r.id) ? "bg-white/5" : ""}`}
                  >
                    <td className="py-0 pr-2" onClick={(e) => e.stopPropagation()}>
                      <label className="flex min-h-11 w-full min-w-11 cursor-pointer items-center sm:min-h-9 sm:min-w-0">
                        <input type="checkbox" aria-label={`${r.username} 선택`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 cursor-pointer" />
                      </label>
                    </td>
                    <td className="py-2 pr-3 text-foreground">
                      <button type="button" aria-haspopup="dialog" className="text-left underline-offset-4 hover:underline">
                        {r.username}
                        <span className="sr-only"> 편집</span>
                      </button>
                      {r.note && <span className="ml-2 text-xs text-subtle">{r.note}</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-foreground-2">{r.nickname ?? <span className="text-subtle">—</span>}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-foreground-2">{r.teamName ?? <span className="text-subtle">미소속</span>}</td>
                    <td className="py-2 pr-3 text-muted">{r.role}</td>
                    <td className="py-2 pr-3">{r.hasApiKey ? <span className="text-emerald-300">할당</span> : <span className="text-amber-300">없음</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.generations}<span className="text-subtle"> / {r.completed}</span></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{usd(format, r.totalCostUsd)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-muted">{dateTime(format, r.lastUsedAt)}</td>
                    <td className="whitespace-nowrap py-2">
                      {r.active ? <span className="text-foreground-2">활성</span> : <span className="text-rose-300">비활성</span>}
                      {r.mustChangePassword && <Badge className={`ml-2 ${TEMPORARY_TONE}`}>임시 비밀번호</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open?.kind === "add" && <AddMember draft={draft} onChange={setDraft} busy={open.busy} error={open.error && errorText(open.error)} onSubmit={create} onClose={close} />}
      {open?.kind === "import" && <MemberImport onCreated={load} onClose={close} />}
      {open?.kind === "assign" && <AssignTeam members={chosen} teams={teams} busy={open.busy} error={open.error && errorText(open.error)} onAssign={assign} onClose={close} />}
      {open?.kind === "edit" && <MemberEditor key={open.member.id} member={open.member} teams={teams} error={open.error && errorText(open.error)} adminId={adminId} onPatch={(body) => patch(open.member.id, body)} onClose={close} />}
    </>
  );
}

function AddMember({ draft, onChange, busy, error, onSubmit, onClose }: { draft: Draft; onChange: (d: Draft) => void; busy: boolean; error: string | null; onSubmit: (e: FormEvent) => void; onClose: () => void }) {
  const formId = useId();
  return (
    <Modal
      title="사용자 추가"
      onClose={onClose}
      footer={<Button type="submit" form={formId} className="h-11 w-full sm:h-10" disabled={busy}>{busy ? "추가 중…" : "추가"}</Button>}
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-3">
        {error && <ErrorText>{error}</ErrorText>}
        <Field label="ID"><Input data-autofocus value={draft.username} onChange={(e) => onChange({ ...draft, username: e.target.value })} required /></Field>
        <Field label="임시 비밀번호" hint="8자 이상 · 첫 로그인 때 바꾸게 함"><Input type="text" value={draft.password} onChange={(e) => onChange({ ...draft, password: e.target.value })} required /></Field>
        <Field label="Higgsfield API 키" hint="key-id:key-secret · 나중에 넣어도 됨"><Input value={draft.apiKey} onChange={(e) => onChange({ ...draft, apiKey: e.target.value })} placeholder="선택" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="역할">
            <Select value={draft.role} onChange={(e) => onChange({ ...draft, role: e.target.value })}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </Select>
          </Field>
          <Field label="메모"><Input value={draft.note} onChange={(e) => onChange({ ...draft, note: e.target.value })} placeholder="선택" /></Field>
        </div>
      </form>
    </Modal>
  );
}

function AssignTeam({ members, teams, busy, error, onAssign, onClose }: { members: UserUsageRow[]; teams: Team[]; busy: boolean; error: string | null; onAssign: (teamId: TeamId | null) => void; onClose: () => void }) {
  const formId = useId();
  const [choice, setChoice] = useState("");
  return (
    <Modal
      title="팀 지정"
      onClose={onClose}
      footer={
        <Button type="submit" form={formId} className="h-11 w-full sm:h-10" disabled={busy || choice === "" || members.length === 0}>
          {busy ? "지정하는 중…" : `${members.length}명 지정`}
        </Button>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          onAssign(choice === NO_TEAM ? null : (Number(choice) as TeamId));
        }}
        className="space-y-4 text-sm"
      >
        {error && <ErrorText>{error}</ErrorText>}
        <Field label="팀" hint="한 사람은 한 팀에만 속합니다">
          <Select data-autofocus value={choice} onChange={(e) => setChoice(e.target.value)} required>
            <option value="" disabled>팀을 고르세요</option>
            {teams.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.name}</option>
            ))}
            <option value={NO_TEAM}>미소속</option>
          </Select>
        </Field>
        {teams.length === 0 && <p className="break-keep text-xs text-muted">아직 팀이 없습니다. 팀 탭에서 팀을 만든 뒤 다시 여세요.</p>}
        <section aria-label="고른 사용자">
          <h3 className="text-xs font-medium text-muted">고른 사용자 {members.length}명</h3>
          <ul className="mt-1.5 divide-y divide-border rounded-md border border-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-foreground-2" title={m.username}>{m.username}</span>
                <span className="shrink-0 text-xs text-subtle">{m.teamName ?? "미소속"}</span>
              </li>
            ))}
          </ul>
        </section>
      </form>
    </Modal>
  );
}

function MemberEditor({ member, teams, error, adminId, onPatch, onClose }: { member: Detail; teams: Team[]; error: string | null; adminId: number; onPatch: (body: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const format = useFormatter();
  return (
    <Modal title={`${member.username} 편집`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {error && <ErrorText>{error}</ErrorText>}
        <NicknameForm current={member.nickname} onSave={(n) => onPatch({ nickname: n })} />
        <Field label="팀">
          <Select value={member.teamId ?? ""} onChange={(e) => onPatch({ teamId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">미소속</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-muted">API 키</span>
          <span className="font-mono text-foreground-2">{member.apiKeyMasked ?? "없음"}</span>
        </div>
        <ApiKeyForm onSave={(k) => onPatch({ apiKey: k })} onClear={() => onPatch({ apiKey: null })} hasKey={Boolean(member.apiKeyMasked)} />
        <PasswordForm temporary={member.id !== adminId} onSave={(p) => onPatch({ password: p })} />
        {member.id !== adminId && <ResetToInitial onReset={() => onPatch({ password: INITIAL_PASSWORD })} />}
        {member.mustChangePassword && (
          <p className="text-xs text-muted">임시 비밀번호 상태입니다. 다음 로그인 때 새 비밀번호를 정해야 들어올 수 있습니다.</p>
        )}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Select value={member.role} onChange={(e) => onPatch({ role: e.target.value })} disabled={member.id === adminId}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </Select>
          <Button variant={member.active ? "outline" : "primary"} onClick={() => onPatch({ active: !member.active })} disabled={member.id === adminId}>
            {member.active ? "비활성화" : "활성화"}
          </Button>
        </div>
        {(member.failedAttempts > 0 || member.lockedUntil) && (
          <Button variant="ghost" size="sm" onClick={() => onPatch({ unlock: true })}>
            잠금 해제 (실패 {member.failedAttempts}회{member.lockedUntil ? `, ${dateTime(format, member.lockedUntil)}까지 잠김` : ""})
          </Button>
        )}
      </div>
    </Modal>
  );
}

function ApiKeyForm({ onSave, onClear, hasKey }: { onSave: (k: string) => void; onClear: () => void; hasKey: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="key-id:key-secret" className="font-mono text-xs" />
      <Button size="md" onClick={() => { if (v.trim()) { onSave(v.trim()); setV(""); } }} disabled={!v.trim()}>저장</Button>
      {hasKey && <Button size="md" variant="ghost" onClick={onClear}>제거</Button>}
    </div>
  );
}

function NicknameForm({ current, onSave }: { current: string | null; onSave: (n: string) => void }) {
  const [v, setV] = useState(current ?? "");
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Field label="닉네임" hint={`${MAX_NICKNAME_LENGTH}자까지 · 비우면 없앰`}>
          <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="닉네임 없음" />
        </Field>
      </div>
      <Button size="md" variant="outline" onClick={() => onSave(v)} disabled={v.trim() === (current ?? "")}>저장</Button>
    </div>
  );
}

function ResetToInitial({ onReset }: { onReset: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>초기 비밀번호로 되돌리기</Button>;
  }
  return (
    <div role="group" aria-label="초기 비밀번호로 되돌리기" className="space-y-2 rounded-md border border-border p-3">
      <p className="break-keep text-xs text-muted">
        비밀번호를 <span className="font-mono text-foreground-2">{INITIAL_PASSWORD}</span>로 되돌립니다. 이 회원은 모든 기기에서 로그아웃되고, 다음 로그인 때 새 비밀번호를 정해야 합니다.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={async () => { await onReset(); setConfirming(false); }}>되돌리기</Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>취소</Button>
      </div>
    </div>
  );
}

function PasswordForm({ onSave, temporary }: { onSave: (p: string) => void; temporary: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={temporary ? "임시 비밀번호 (8자 이상)" : "새 비밀번호 (8자 이상)"} />
      <Button size="md" variant="outline" onClick={() => { if (v.length >= 8) { onSave(v); setV(""); } }} disabled={v.length < 8}>변경</Button>
    </div>
  );
}
