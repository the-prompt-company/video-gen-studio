"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { MAX_TEAM_NAME_LENGTH, type Team, type TeamId } from "@/lib/teams";
import { Button, Card, Empty, ErrorText, Field, Input } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { api } from "./AdminPanels";

type Open = { kind: "create"; busy: boolean; error: string | null } | { kind: "edit"; id: TeamId; error: string | null };

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

const memberName = (m: Team["members"][number]) => m.nickname ?? m.username;

export function TeamsPanel() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => setTeams((await api<{ items: Team[] }>("/api/admin/teams")).items);
  const reload = () => load().catch((e) => setError(message(e)));
  useEffect(() => {
    api<{ items: Team[] }>("/api/admin/teams")
      .then((b) => setTeams(b.items))
      .catch((e) => setError(message(e)));
  }, []);

  function show(next: Open) {
    setNotice(null);
    setOpen(next);
  }
  const close = () => setOpen(null);
  const editError = (error: string | null) => setOpen((o) => (o?.kind === "edit" ? { ...o, error } : o));

  async function create(e: FormEvent) {
    e.preventDefault();
    setOpen({ kind: "create", busy: true, error: null });
    try {
      const team = await api<{ name: string }>("/api/admin/teams", { method: "POST", body: JSON.stringify({ name: draft }) });
      setDraft("");
      setOpen((o) => (o?.kind === "create" ? null : o));
      setNotice(`팀을 만들었습니다: ${team.name}. 사용자 탭에서 팀원을 고른 뒤 팀 지정을 누르세요.`);
    } catch (err) {
      setOpen((o) => (o?.kind === "create" ? { kind: "create", busy: false, error: message(err) } : o));
      return;
    }
    await reload();
  }

  async function rename(id: TeamId, name: string) {
    editError(null);
    try {
      await api(`/api/admin/teams/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      await load();
    } catch (e) {
      editError(message(e));
    }
  }

  async function remove(team: Team) {
    editError(null);
    try {
      const { released } = await api<{ released: number }>(`/api/admin/teams/${team.id}`, { method: "DELETE" });
      close();
      setNotice(`팀을 삭제했습니다: ${team.name}.${released > 0 ? ` 팀원 ${released}명이 미소속이 됐습니다.` : ""}`);
    } catch (e) {
      editError(message(e));
      return;
    }
    await reload();
  }

  const editing = open?.kind === "edit" ? teams?.find((t) => t.id === open.id) : undefined;
  const toolbar = (
    <Button size="sm" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => show({ kind: "create", busy: false, error: null })}>
      팀 만들기
    </Button>
  );

  return (
    <>
      <Card title={teams ? `팀 ${teams.length}개` : "팀"} action={toolbar}>
        {error && <div className="mb-3"><ErrorText>{error}</ErrorText></div>}
        {notice && <p role="status" className="mb-3 break-keep text-sm text-foreground-2">{notice}</p>}
        {teams?.length === 0 && <Empty>아직 팀이 없습니다. 팀을 만든 뒤 사용자 탭에서 팀원을 고르고 팀 지정을 누르세요.</Empty>}
        {teams && teams.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-subtle">
                <tr>
                  <th className="w-1/3 py-2 pr-3 font-medium">팀</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">인원</th>
                  <th className="py-2 font-medium">팀원</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {teams.map((t) => (
                  <tr
                    key={t.id}
                    onClick={(e) => {
                      e.currentTarget.querySelector("button")?.focus();
                      show({ kind: "edit", id: t.id, error: null });
                    }}
                    className="cursor-pointer hover:bg-white/5"
                  >
                    <td className="py-2 pr-3 text-foreground">
                      <button type="button" aria-haspopup="dialog" className="min-h-11 text-left underline-offset-4 hover:underline sm:min-h-0">
                        {t.name}
                        <span className="sr-only"> 편집</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-foreground-2">{t.members.length}명</td>
                    <td className="py-2 text-muted">
                      <div className="max-w-[12rem] truncate sm:max-w-md" title={t.members.map(memberName).join(", ")}>
                        {t.members.length > 0 ? t.members.map(memberName).join(", ") : <span className="text-subtle">없음</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open?.kind === "create" && <CreateTeam draft={draft} onChange={setDraft} busy={open.busy} error={open.error} onSubmit={create} onClose={close} />}
      {open?.kind === "edit" && editing && (
        <TeamEditor key={editing.id} team={editing} error={open.error} onRename={(name) => rename(editing.id, name)} onDelete={() => remove(editing)} onClose={close} />
      )}
    </>
  );
}

function CreateTeam({ draft, onChange, busy, error, onSubmit, onClose }: { draft: string; onChange: (v: string) => void; busy: boolean; error: string | null; onSubmit: (e: FormEvent) => void; onClose: () => void }) {
  const formId = useId();
  return (
    <Modal
      title="팀 만들기"
      onClose={onClose}
      footer={<Button type="submit" form={formId} className="h-11 w-full sm:h-10" disabled={busy}>{busy ? "만드는 중…" : "만들기"}</Button>}
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-3">
        {error && <ErrorText>{error}</ErrorText>}
        <Field label="팀 이름" hint={`${MAX_TEAM_NAME_LENGTH}자까지 · 대소문자만 다른 이름은 같은 이름`}>
          <Input data-autofocus value={draft} onChange={(e) => onChange(e.target.value)} required />
        </Field>
      </form>
    </Modal>
  );
}

function TeamEditor({ team, error, onRename, onDelete, onClose }: { team: Team; error: string | null; onRename: (name: string) => Promise<void>; onDelete: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(team.name);
  return (
    <Modal title={`${team.name} 편집`} onClose={onClose}>
      <div className="space-y-5 text-sm">
        {error && <ErrorText>{error}</ErrorText>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(name);
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label="팀 이름" hint={`${MAX_TEAM_NAME_LENGTH}자까지`}>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          </div>
          <Button type="submit" size="md" variant="outline" disabled={name.trim() === team.name}>저장</Button>
        </form>
        <section aria-label="팀원">
          <h3 className="text-xs font-medium text-muted">팀원 {team.members.length}명</h3>
          {team.members.length === 0 ? (
            <p className="mt-1.5 break-keep text-xs text-subtle">아직 팀원이 없습니다. 사용자 탭에서 사람을 고른 뒤 팀 지정을 누르세요.</p>
          ) : (
            <ul className="mt-1.5 divide-y divide-border rounded-md border border-border">
              {team.members.map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <span className="truncate text-foreground-2">{memberName(m)}</span>
                  {m.nickname && <span className="truncate text-xs text-subtle">{m.username}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <DeleteTeam team={team} onDelete={onDelete} />
      </div>
    </Modal>
  );
}

function DeleteTeam({ team, onDelete }: { team: Team; onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>팀 삭제</Button>;
  }
  const count = team.members.length;
  return (
    <div role="group" aria-label="팀 삭제" className="space-y-2 rounded-md border border-border p-3">
      <p className="break-keep text-xs text-muted">
        이 팀을 삭제합니다. {count > 0 ? `팀원 ${count}명은 미소속이 되고, ` : ""}영상과 사용 기록은 그대로 남습니다.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onDelete();
            setBusy(false);
          }}
        >
          {busy ? "삭제하는 중…" : "삭제"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>취소</Button>
      </div>
    </div>
  );
}
