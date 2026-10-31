"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { UserUsageRow } from "@/lib/stats";
import { INITIAL_PASSWORD, MIN_PASSWORD_LENGTH, loginId } from "@/lib/credentials";
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

type Notice = { kind: "added"; id: string } | { kind: "assigned"; count: number; team: string } | { kind: "unassigned"; count: number };

const EMPTY: Draft = { username: "", password: "", role: "user", apiKey: "", note: "" };

const TEMPORARY_TONE = "bg-zinc-500/15 text-foreground-2 ring-zinc-500/30";

const ALL_TEAMS = "";
const NO_TEAM = "none";

const inFilter = (filter: string) => (r: UserUsageRow) => filter === ALL_TEAMS || (filter === NO_TEAM ? r.teamId === null : String(r.teamId) === filter);

export function UsersPanel({ adminId }: { adminId: number }) {
  const t = useTranslations("members");
  const tTeams = useTranslations("teams");
  const tImport = useTranslations("import");
  const format = useFormatter();
  const errorText = useErrorText();
  const [rows, setRows] = useState<UserUsageRow[]>([]);
  const [error, setError] = useState<Reason | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [notice, setNotice] = useState<Notice | null>(null);
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
      setNotice({ kind: "added", id: loginId(draft.username) });
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
      const team = teams.find((candidate) => candidate.id === teamId);
      setSelected(new Set());
      setOpen((o) => (o?.kind === "assign" ? null : o));
      setNotice(team ? { kind: "assigned", count: updated, team: team.name } : { kind: "unassigned", count: updated });
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

  function noticeText(n: Notice): string {
    switch (n.kind) {
      case "added":
        return t("notice.added", { id: n.id });
      case "assigned":
        return t("notice.assigned", { count: n.count, team: n.team });
      case "unassigned":
        return t("notice.unassigned", { count: n.count });
    }
  }

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => show({ kind: "import" })}>{tImport("title")}</Button>
      <Button size="sm" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => show({ kind: "add", busy: false, error: null })}>{t("add.title")}</Button>
    </div>
  );

  return (
    <>
      <Card title={t("title", { count: rows.length })} action={toolbar}>
        {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{errorText(error)}</p>}
        {notice && <p role="status" className="mb-3 break-all text-sm text-foreground-2">{noticeText(notice)}</p>}
        {rows.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Select
              aria-label={t("filter.label")}
              value={teamFilter}
              onChange={(e) => {
                setTeamFilter(e.target.value);
                setSelected(new Set());
              }}
              className="h-11 sm:h-9 sm:max-w-xs"
            >
              <option value={ALL_TEAMS}>{t("filter.all", { count: rows.length })}</option>
              <option value={NO_TEAM}>{t("filter.team", { team: tTeams("none"), count: rows.filter(inFilter(NO_TEAM)).length })}</option>
              {teams.map((team) => (
                <option key={team.id} value={String(team.id)}>{t("filter.team", { team: team.name, count: rows.filter(inFilter(String(team.id))).length })}</option>
              ))}
            </Select>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-muted">{t("selected", { count: chosen.length })}</span>
              <Button size="sm" variant="outline" className="h-11 sm:h-9" aria-haspopup="dialog" disabled={chosen.length === 0} onClick={() => show({ kind: "assign", busy: false, error: null })}>
                {t("assign.title")}
              </Button>
            </div>
          </div>
        )}
        {visible.length === 0 ? (
          <Empty>{rows.length === 0 ? t("empty.none") : teamFilter === NO_TEAM ? t("empty.noTeam") : t("empty.team")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-subtle">
                <tr>
                  <th className="w-8 py-0 pr-2 font-medium">
                    <label className="flex min-h-11 w-full min-w-11 cursor-pointer items-center sm:min-h-9 sm:min-w-0">
                      <input
                        type="checkbox"
                        aria-label={t("selectAll")}
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
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">{t("field.nickname")}</th>
                  <th className="py-2 pr-3 font-medium">{t("field.team")}</th>
                  <th className="py-2 pr-3 font-medium">{t("field.role")}</th>
                  <th className="py-2 pr-3 font-medium">{t("table.key")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("table.generations")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("table.cost")}</th>
                  <th className="py-2 pr-3 font-medium">{t("table.lastUsed")}</th>
                  <th className="py-2 font-medium">{t("table.status")}</th>
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
                        <input type="checkbox" aria-label={t("select", { username: r.username })} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 cursor-pointer" />
                      </label>
                    </td>
                    <td className="py-2 pr-3 text-foreground">
                      <button type="button" aria-haspopup="dialog" aria-label={t("edit", { username: r.username })} className="text-left underline-offset-4 hover:underline">
                        {r.username}
                      </button>
                      {r.note && <span className="ml-2 text-xs text-subtle">{r.note}</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-foreground-2">{r.nickname ?? <span className="text-subtle">—</span>}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-foreground-2">{r.teamName ?? <span className="text-subtle">{tTeams("none")}</span>}</td>
                    <td className="py-2 pr-3 text-muted">{r.role}</td>
                    <td className="py-2 pr-3">{r.hasApiKey ? <span className="text-emerald-300">{t("key.assigned")}</span> : <span className="text-amber-300">{t("key.none")}</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.generations}<span className="text-subtle"> / {r.completed}</span></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{usd(format, r.totalCostUsd)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-muted">{dateTime(format, r.lastUsedAt)}</td>
                    <td className="whitespace-nowrap py-2">
                      {r.active ? <span className="text-foreground-2">{t("active")}</span> : <span className="text-rose-300">{t("inactive")}</span>}
                      {r.mustChangePassword && <Badge className={`ml-2 ${TEMPORARY_TONE}`}>{t("temporary")}</Badge>}
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
  const t = useTranslations("members");
  const formId = useId();
  return (
    <Modal
      title={t("add.title")}
      onClose={onClose}
      footer={<Button type="submit" form={formId} className="h-11 w-full sm:h-10" disabled={busy}>{busy ? t("add.submitting") : t("add.submit")}</Button>}
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-3">
        {error && <ErrorText>{error}</ErrorText>}
        <Field label="ID"><Input data-autofocus value={draft.username} onChange={(e) => onChange({ ...draft, username: e.target.value })} required /></Field>
        <Field label={t("add.password")} hint={t("add.passwordHint", { min: MIN_PASSWORD_LENGTH })}><Input type="text" value={draft.password} onChange={(e) => onChange({ ...draft, password: e.target.value })} required /></Field>
        <Field label={t("add.apiKey")} hint={t("add.apiKeyHint")}><Input value={draft.apiKey} onChange={(e) => onChange({ ...draft, apiKey: e.target.value })} placeholder={t("add.optional")} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("field.role")}>
            <Select value={draft.role} onChange={(e) => onChange({ ...draft, role: e.target.value })}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </Select>
          </Field>
          <Field label={t("field.note")}><Input value={draft.note} onChange={(e) => onChange({ ...draft, note: e.target.value })} placeholder={t("add.optional")} /></Field>
        </div>
      </form>
    </Modal>
  );
}

function AssignTeam({ members, teams, busy, error, onAssign, onClose }: { members: UserUsageRow[]; teams: Team[]; busy: boolean; error: string | null; onAssign: (teamId: TeamId | null) => void; onClose: () => void }) {
  const t = useTranslations("members");
  const tTeams = useTranslations("teams");
  const formId = useId();
  const [choice, setChoice] = useState("");
  return (
    <Modal
      title={t("assign.title")}
      onClose={onClose}
      footer={
        <Button type="submit" form={formId} className="h-11 w-full sm:h-10" disabled={busy || choice === "" || members.length === 0}>
          {busy ? t("assign.submitting") : t("assign.submit", { count: members.length })}
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
        <Field label={t("field.team")} hint={t("assign.hint")}>
          <Select data-autofocus value={choice} onChange={(e) => setChoice(e.target.value)} required>
            <option value="" disabled>{t("assign.placeholder")}</option>
            {teams.map((team) => (
              <option key={team.id} value={String(team.id)}>{team.name}</option>
            ))}
            <option value={NO_TEAM}>{tTeams("none")}</option>
          </Select>
        </Field>
        {teams.length === 0 && <p className="break-keep text-xs text-muted">{t("assign.noTeams")}</p>}
        <section aria-label={t("assign.chosenLabel")}>
          <h3 className="text-xs font-medium text-muted">{t("assign.chosen", { count: members.length })}</h3>
          <ul className="mt-1.5 divide-y divide-border rounded-md border border-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-foreground-2" title={m.username}>{m.username}</span>
                <span className="shrink-0 text-xs text-subtle">{m.teamName ?? tTeams("none")}</span>
              </li>
            ))}
          </ul>
        </section>
      </form>
    </Modal>
  );
}

function MemberEditor({ member, teams, error, adminId, onPatch, onClose }: { member: Detail; teams: Team[]; error: string | null; adminId: number; onPatch: (body: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const t = useTranslations("members");
  const tTeams = useTranslations("teams");
  const format = useFormatter();
  return (
    <Modal title={t("edit", { username: member.username })} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {error && <ErrorText>{error}</ErrorText>}
        <NicknameForm current={member.nickname} onSave={(n) => onPatch({ nickname: n })} />
        <Field label={t("field.team")}>
          <Select value={member.teamId ?? ""} onChange={(e) => onPatch({ teamId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{tTeams("none")}</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-muted">{t("editor.apiKey")}</span>
          <span className="font-mono text-foreground-2">{member.apiKeyMasked ?? t("key.none")}</span>
        </div>
        <ApiKeyForm onSave={(k) => onPatch({ apiKey: k })} onClear={() => onPatch({ apiKey: null })} hasKey={Boolean(member.apiKeyMasked)} />
        <PasswordForm temporary={member.id !== adminId} onSave={(p) => onPatch({ password: p })} />
        {member.id !== adminId && <ResetToInitial onReset={() => onPatch({ password: INITIAL_PASSWORD })} />}
        {member.mustChangePassword && <p className="text-xs text-muted">{t("editor.temporaryNote")}</p>}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Select value={member.role} onChange={(e) => onPatch({ role: e.target.value })} disabled={member.id === adminId}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </Select>
          <Button variant={member.active ? "outline" : "primary"} onClick={() => onPatch({ active: !member.active })} disabled={member.id === adminId}>
            {member.active ? t("editor.deactivate") : t("editor.activate")}
          </Button>
        </div>
        {(member.failedAttempts > 0 || member.lockedUntil) && (
          <Button variant="ghost" size="sm" onClick={() => onPatch({ unlock: true })}>
            {member.lockedUntil
              ? t("editor.unlockUntil", { failures: member.failedAttempts, until: dateTime(format, member.lockedUntil) })
              : t("editor.unlock", { failures: member.failedAttempts })}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function ApiKeyForm({ onSave, onClear, hasKey }: { onSave: (k: string) => void; onClear: () => void; hasKey: boolean }) {
  const t = useTranslations("members");
  const tCommon = useTranslations("common");
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="key-id:key-secret" className="font-mono text-xs" />
      <Button size="md" onClick={() => { if (v.trim()) { onSave(v.trim()); setV(""); } }} disabled={!v.trim()}>{tCommon("save")}</Button>
      {hasKey && <Button size="md" variant="ghost" onClick={onClear}>{t("editor.removeKey")}</Button>}
    </div>
  );
}

function NicknameForm({ current, onSave }: { current: string | null; onSave: (n: string) => void }) {
  const t = useTranslations("members");
  const tCommon = useTranslations("common");
  const [v, setV] = useState(current ?? "");
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Field label={t("field.nickname")} hint={t("nickname.hint", { max: MAX_NICKNAME_LENGTH })}>
          <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={t("nickname.placeholder")} />
        </Field>
      </div>
      <Button size="md" variant="outline" onClick={() => onSave(v)} disabled={v.trim() === (current ?? "")}>{tCommon("save")}</Button>
    </div>
  );
}

function ResetToInitial({ onReset }: { onReset: () => Promise<void> }) {
  const t = useTranslations("members");
  const tCommon = useTranslations("common");
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>{t("reset.title")}</Button>;
  }
  return (
    <div role="group" aria-label={t("reset.title")} className="space-y-2 rounded-md border border-border p-3">
      <p className="break-keep text-xs text-muted">
        {t.rich("reset.body", {
          password: INITIAL_PASSWORD,
          mono: (chunks) => <span className="font-mono text-foreground-2">{chunks}</span>,
        })}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={async () => { await onReset(); setConfirming(false); }}>{t("reset.confirm")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{tCommon("cancel")}</Button>
      </div>
    </div>
  );
}

function PasswordForm({ onSave, temporary }: { onSave: (p: string) => void; temporary: boolean }) {
  const t = useTranslations("members");
  const [v, setV] = useState("");
  const short = v.length < MIN_PASSWORD_LENGTH;
  return (
    <div className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={t(temporary ? "password.temporary" : "password.new", { min: MIN_PASSWORD_LENGTH })} />
      <Button size="md" variant="outline" onClick={() => { if (!short) { onSave(v); setV(""); } }} disabled={short}>{t("password.change")}</Button>
    </div>
  );
}
