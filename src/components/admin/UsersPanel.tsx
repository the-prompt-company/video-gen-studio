"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserUsageRow } from "@/lib/stats";
import { INITIAL_PASSWORD } from "@/lib/credentials";
import { MAX_NICKNAME_LENGTH } from "@/lib/nickname";
import { usd, fmtDate } from "@/lib/format";
import { Badge, Button, Card, Field, Input, Select, Empty } from "@/components/ui";
import { api } from "./AdminPanels";
import { MemberImport } from "./MemberImport";

type Detail = { id: number; username: string; nickname: string | null; role: string; active: boolean; note: string | null; apiKeyMasked: string | null; lockedUntil: string | null; failedAttempts: number; mustChangePassword: boolean };

const TEMPORARY_TONE = "bg-zinc-500/15 text-foreground-2 ring-zinc-500/30";

export function UsersPanel({ adminId }: { adminId: number }) {
  const [rows, setRows] = useState<UserUsageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [form, setForm] = useState({ username: "", password: "", role: "user", apiKey: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await api<{ items: UserUsageRow[] }>("/api/admin/users");
      setRows(b.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    api<{ items: UserUsageRow[] }>("/api/admin/users")
      .then((b) => setRows(b.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ username: "", password: "", role: "user", apiKey: "", note: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: number) {
    try {
      setSelected(await api<Detail>(`/api/admin/users/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
      if (selected?.id === id) await openDetail(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card title={`사용자 ${rows.length}명`}>
        {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
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
                  <tr key={r.id} onClick={() => openDetail(r.id)} className={`cursor-pointer hover:bg-white/5 ${selected?.id === r.id ? "bg-white/5" : ""}`}>
                    <td className="py-2 pr-3 text-foreground">{r.username}{r.note && <span className="ml-2 text-xs text-subtle">{r.note}</span>}</td>
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

      <div className="space-y-6">
        {selected && (
          <Card key={selected.id} title={`${selected.username} 편집`} action={<button className="text-xs text-subtle hover:text-foreground" onClick={() => setSelected(null)}>닫기</button>}>
            <div className="space-y-3 text-sm">
              <NicknameForm current={selected.nickname} onSave={(n) => patch(selected.id, { nickname: n })} />
              <div className="flex items-center justify-between">
                <span className="text-muted">API 키</span>
                <span className="font-mono text-foreground-2">{selected.apiKeyMasked ?? "없음"}</span>
              </div>
              <ApiKeyForm onSave={(k) => patch(selected.id, { apiKey: k })} onClear={() => patch(selected.id, { apiKey: null })} hasKey={Boolean(selected.apiKeyMasked)} />
              <PasswordForm temporary={selected.id !== adminId} onSave={(p) => patch(selected.id, { password: p })} />
              {selected.id !== adminId && <ResetToInitial onReset={() => patch(selected.id, { password: INITIAL_PASSWORD })} />}
              {selected.mustChangePassword && (
                <p className="text-xs text-muted">임시 비밀번호 상태입니다. 다음 로그인 때 새 비밀번호를 정해야 들어올 수 있습니다.</p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Select value={selected.role} onChange={(e) => patch(selected.id, { role: e.target.value })} disabled={selected.id === adminId}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </Select>
                <Button variant={selected.active ? "outline" : "primary"} onClick={() => patch(selected.id, { active: !selected.active })} disabled={selected.id === adminId}>
                  {selected.active ? "비활성화" : "활성화"}
                </Button>
              </div>
              {(selected.failedAttempts > 0 || selected.lockedUntil) && (
                <Button variant="ghost" size="sm" onClick={() => patch(selected.id, { unlock: true })}>
                  잠금 해제 (실패 {selected.failedAttempts}회{selected.lockedUntil ? `, ${fmtDate(selected.lockedUntil)}까지 잠김` : ""})
                </Button>
              )}
            </div>
          </Card>
        )}

        <Card title="사용자 추가">
          <form onSubmit={create} className="space-y-3">
            <Field label="ID"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></Field>
            <Field label="임시 비밀번호" hint="8자 이상 · 첫 로그인 때 바꾸게 함"><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
            <Field label="Higgsfield API 키" hint="key-id:key-secret · 나중에 넣어도 됨"><Input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="선택" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="역할">
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </Select>
              </Field>
              <Field label="메모"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="선택" /></Field>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "추가 중…" : "추가"}</Button>
          </form>
        </Card>

        <MemberImport onCreated={load} />
      </div>
    </div>
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
