"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { caught, type Reason } from "@/lib/errors";
import { MAX_TEAM_NAME_LENGTH, type Team, type TeamId } from "@/lib/teams";
import { Button, Card, Empty, ErrorText, Field, Input } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { useErrorText } from "@/i18n/errors";
import { api } from "./AdminPanels";

type Open = { kind: "create"; busy: boolean; error: Reason | null } | { kind: "edit"; id: TeamId; error: Reason | null };

type Notice = { kind: "created"; name: string } | { kind: "deleted"; name: string; released: number };

const memberName = (m: Team["members"][number]) => m.nickname ?? m.username;

export function TeamsPanel() {
  const t = useTranslations("teams");
  const errorText = useErrorText();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<Reason | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = async () => setTeams((await api<{ items: Team[] }>("/api/admin/teams")).items);
  const reload = () => load().catch((e) => setError(caught(e)));
  useEffect(() => {
    api<{ items: Team[] }>("/api/admin/teams")
      .then((b) => setTeams(b.items))
      .catch((e) => setError(caught(e)));
  }, []);

  function show(next: Open) {
    setNotice(null);
    setOpen(next);
  }
  const close = () => setOpen(null);
  const editError = (error: Reason | null) => setOpen((o) => (o?.kind === "edit" ? { ...o, error } : o));

  async function create(e: FormEvent) {
    e.preventDefault();
    setOpen({ kind: "create", busy: true, error: null });
    try {
      const team = await api<{ name: string }>("/api/admin/teams", { method: "POST", body: JSON.stringify({ name: draft }) });
      setDraft("");
      setOpen((o) => (o?.kind === "create" ? null : o));
      setNotice({ kind: "created", name: team.name });
    } catch (err) {
      setOpen((o) => (o?.kind === "create" ? { kind: "create", busy: false, error: caught(err) } : o));
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
      editError(caught(e));
    }
  }

  async function remove(team: Team) {
    editError(null);
    try {
      const { released } = await api<{ released: number }>(`/api/admin/teams/${team.id}`, { method: "DELETE" });
      close();
      setNotice({ kind: "deleted", name: team.name, released });
    } catch (e) {
      editError(caught(e));
      return;
    }
    await reload();
  }

  const editing = open?.kind === "edit" ? teams?.find((team) => team.id === open.id) : undefined;
  const toolbar = (
    <Button size="sm" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => show({ kind: "create", busy: false, error: null })}>
      {t("create.title")}
    </Button>
  );

  return (
    <>
      <Card title={teams ? t("count", { count: teams.length }) : t("title")} action={toolbar}>
        {error && <div className="mb-3"><ErrorText>{errorText(error)}</ErrorText></div>}
        {notice && (
          <p role="status" className="mb-3 break-keep text-sm text-foreground-2">
            {notice.kind === "created" ? t("notice.created", { name: notice.name }) : t("notice.deleted", { name: notice.name, released: notice.released })}
          </p>
        )}
        {teams?.length === 0 && <Empty>{t("empty")}</Empty>}
        {teams && teams.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-subtle">
                <tr>
                  <th className="w-1/3 py-2 pr-3 font-medium">{t("table.team")}</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{t("table.size")}</th>
                  <th className="py-2 font-medium">{t("table.members")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {teams.map((team) => (
                  <tr
                    key={team.id}
                    onClick={(e) => {
                      e.currentTarget.querySelector("button")?.focus();
                      show({ kind: "edit", id: team.id, error: null });
                    }}
                    className="cursor-pointer hover:bg-white/5"
                  >
                    <td className="py-2 pr-3 text-foreground">
                      <button type="button" aria-haspopup="dialog" aria-label={t("edit", { name: team.name })} className="min-h-11 text-left underline-offset-4 hover:underline sm:min-h-0">
                        {team.name}
                      </button>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-foreground-2">{t("size", { count: team.members.length })}</td>
                    <td className="py-2 text-muted">
                      <div className="max-w-[12rem] truncate sm:max-w-md" title={team.members.map(memberName).join(", ")}>
                        {team.members.length > 0 ? team.members.map(memberName).join(", ") : <span className="text-subtle">{t("noMembers")}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open?.kind === "create" && <CreateTeam draft={draft} onChange={setDraft} busy={open.busy} error={open.error && errorText(open.error)} onSubmit={create} onClose={close} />}
      {open?.kind === "edit" && editing && (
        <TeamEditor key={editing.id} team={editing} error={open.error && errorText(open.error)} onRename={(name) => rename(editing.id, name)} onDelete={() => remove(editing)} onClose={close} />
      )}
    </>
  );
}

function CreateTeam({ draft, onChange, busy, error, onSubmit, onClose }: { draft: string; onChange: (v: string) => void; busy: boolean; error: string | null; onSubmit: (e: FormEvent) => void; onClose: () => void }) {
  const t = useTranslations("teams");
  const formId = useId();
  return (
    <Modal
      title={t("create.title")}
      onClose={onClose}
      footer={<Button type="submit" form={formId} className="h-11 w-full sm:h-10" disabled={busy}>{busy ? t("create.submitting") : t("create.submit")}</Button>}
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-3">
        {error && <ErrorText>{error}</ErrorText>}
        <Field label={t("name.label")} hint={t("create.hint", { max: MAX_TEAM_NAME_LENGTH })}>
          <Input data-autofocus value={draft} onChange={(e) => onChange(e.target.value)} required />
        </Field>
      </form>
    </Modal>
  );
}

function TeamEditor({ team, error, onRename, onDelete, onClose }: { team: Team; error: string | null; onRename: (name: string) => Promise<void>; onDelete: () => Promise<void>; onClose: () => void }) {
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(team.name);
  return (
    <Modal title={t("edit", { name: team.name })} onClose={onClose}>
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
            <Field label={t("name.label")} hint={t("name.hint", { max: MAX_TEAM_NAME_LENGTH })}>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          </div>
          <Button type="submit" size="md" variant="outline" disabled={name.trim() === team.name}>{tCommon("save")}</Button>
        </form>
        <section aria-label={t("members.label")}>
          <h3 className="text-xs font-medium text-muted">{t("members.count", { count: team.members.length })}</h3>
          {team.members.length === 0 ? (
            <p className="mt-1.5 break-keep text-xs text-subtle">{t("members.empty")}</p>
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
  const t = useTranslations("teams");
  const tCommon = useTranslations("common");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>{t("delete.title")}</Button>;
  }
  return (
    <div role="group" aria-label={t("delete.title")} className="space-y-2 rounded-md border border-border p-3">
      <p className="break-keep text-xs text-muted">{t("delete.confirm", { count: team.members.length })}</p>
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
          {busy ? t("delete.submitting") : t("delete.submit")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{tCommon("cancel")}</Button>
      </div>
    </div>
  );
}
