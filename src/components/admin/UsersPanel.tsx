"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import type { UserUsageRow } from "@/lib/stats";
import { INITIAL_PASSWORD, loginId } from "@/lib/credentials";
import { MAX_NICKNAME_LENGTH } from "@/lib/nickname";
import { usd, fmtDate } from "@/lib/format";
import { Badge, Button, Card, Field, Input, Select, Empty, ErrorText } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { api } from "./AdminPanels";
import { MemberImport } from "./MemberImport";

type Detail = { id: number; username: string; nickname: string | null; role: string; active: boolean; note: string | null; apiKeyMasked: string | null; lockedUntil: string | null; failedAttempts: number; mustChangePassword: boolean };

type Draft = { username: string; password: string; role: string; apiKey: string; note: string };

type Editing = { kind: "edit"; member: Detail; error: string | null };

type Open = { kind: "add"; busy: boolean; error: string | null } | { kind: "import" } | Editing;

const EMPTY: Draft = { username: "", password: "", role: "user", apiKey: "", note: "" };

const TEMPORARY_TONE = "bg-zinc-500/15 text-foreground-2 ring-zinc-500/30";

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function UsersPanel({ adminId }: { adminId: number }) {
  const [rows, setRows] = useState<UserUsageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [added, setAdded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await api<{ items: UserUsageRow[] }>("/api/admin/users");
      setRows(b.items);
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    api<{ items: UserUsageRow[] }>("/api/admin/users")
      .then((b) => setRows(b.items))
      .catch((e) => setError(message(e)));
  }, []);

  function show(next: Open) {
    setAdded(null);
    setOpen(next);
  }
  const close = () => setOpen(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setOpen({ kind: "add", busy: true, error: null });
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(draft) });
      setAdded(loginId(draft.username));
      setDraft(EMPTY);
      setOpen((o) => (o?.kind === "add" ? null : o));
      await load();
    } catch (err) {
      setOpen((o) => (o?.kind === "add" ? { kind: "add", busy: false, error: message(err) } : o));
    }
  }

  async function edit(id: number) {
    try {
      show({ kind: "edit", member: await api<Detail>(`/api/admin/users/${id}`), error: null });
    } catch (e) {
      setError(message(e));
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
      update((o) => ({ ...o, error: message(e) }));
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
        {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
        {added && <p role="status" className="mb-3 break-all text-sm text-foreground-2">{added} 계정을 추가했습니다.</p>}
        {rows.length === 0 ? (
          <Empty>사용자가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-subtle">
                <tr>
                  <th className="py-2 pr-3 font-medium">ID</th>
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">닉네임</th>
                  <th className="py-2 pr-3 font-medium">역할</th>
                  <th className="py-2 pr-3 font-medium">키</th>
                  <th className="py-2 pr-3 text-right font-medium">생성</th>
                  <th className="py-2 pr-3 text-right font-medium">비용</th>
                  <th className="py-2 pr-3 font-medium">마지막 사용</th>
                  <th className="py-2 font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    // The whole row is the pointer target. The ID button is the keyboard one and where focus returns when the editor closes.
                    onClick={(e) => {
                      e.currentTarget.querySelector("button")?.focus();
                      edit(r.id);
                    }}
                    className="cursor-pointer hover:bg-white/5"
                  >
                    <td className="py-2 pr-3 text-foreground">
                      <button type="button" aria-haspopup="dialog" className="text-left underline-offset-4 hover:underline">
                        {r.username}
                        <span className="sr-only"> 편집</span>
                      </button>
                      {r.note && <span className="ml-2 text-xs text-subtle">{r.note}</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-foreground-2">{r.nickname ?? <span className="text-subtle">—</span>}</td>
                    <td className="py-2 pr-3 text-muted">{r.role}</td>
                    <td className="py-2 pr-3">{r.hasApiKey ? <span className="text-emerald-300">할당</span> : <span className="text-amber-300">없음</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.generations}<span className="text-subtle"> / {r.completed}</span></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{usd(r.totalCostUsd)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-muted">{fmtDate(r.lastUsedAt)}</td>
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

      {open?.kind === "add" && <AddMember draft={draft} onChange={setDraft} busy={open.busy} error={open.error} onSubmit={create} onClose={close} />}
      {open?.kind === "import" && <MemberImport onCreated={load} onClose={close} />}
      {open?.kind === "edit" && <MemberEditor key={open.member.id} member={open.member} error={open.error} adminId={adminId} onPatch={(body) => patch(open.member.id, body)} onClose={close} />}
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

function MemberEditor({ member, error, adminId, onPatch, onClose }: { member: Detail; error: string | null; adminId: number; onPatch: (body: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  return (
    <Modal title={`${member.username} 편집`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {error && <ErrorText>{error}</ErrorText>}
        <NicknameForm current={member.nickname} onSave={(n) => onPatch({ nickname: n })} />
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
            잠금 해제 (실패 {member.failedAttempts}회{member.lockedUntil ? `, ${fmtDate(member.lockedUntil)}까지 잠김` : ""})
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
