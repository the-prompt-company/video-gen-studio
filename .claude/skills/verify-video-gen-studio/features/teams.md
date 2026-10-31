# Teams

An administrator creates teams, renames and deletes them, and places members in them: many at once from the users table, or one at a time in the member editor. A member belongs to one team or none (`teams.none`, 미소속). Deleting a team makes its members `teams.none` and keeps their videos and usage. A member reads their own team in settings → account and cannot change it. Every screen reads in the page language; team names stay as written.

## Sub-features

- `adm-teams` tab `admin.tabs.teams` (팀) lists teams by name with `teams.table.size` and `teams.table.members`, under button `teams.create.title` (팀 만들기). Dialog `teams.create.title` takes `teams.name.label`: trimmed, at most 30 characters, one visible line, unique without regard to case (`errors.duplicateTeamName`). A row click, or Enter on `teams.edit` (`<팀 이름> 편집`, `Edit <team name>`), opens dialog `teams.edit` with `teams.name.label` + `common.save`, the member list `teams.members.label`, and `teams.delete.title`.
- `adm-teams-delete` `teams.delete.title` shows group `teams.delete.title` whose `teams.delete.confirm` says how many members become `teams.none` and that videos and usage stay; `teams.delete.submit` deletes the team and says `teams.notice.deleted` (`팀을 삭제했습니다: <name>. 팀원 N명이 미소속이 됐습니다.`).
- `adm-teams-assign` the users table has a checkbox per row (`members.select`, `<username> 선택`) and one in the header (`members.selectAll`, only the rows the filter shows). Button `members.assign.title` (팀 지정) opens dialog `members.assign.title` listing the chosen users in region `members.assign.chosenLabel` with their current team; a team (or `teams.none`) and `members.assign.submit` (`N명 지정`) move exactly them and say `members.notice.assigned`.
- `adm-teams-filter` combobox `members.filter.label` shows `members.filter.all`, `teams.none` or one team, each with its head count. Changing it clears the selection.
- `adm-user-team` dialog `members.edit` has a select labelled `members.field.team` (`teams.none` + every team) that saves on change.
- `settings-team` region `settings.account.title` in settings shows `settings.account.team` under ID: the team's name, or `teams.none`.

## How to get to it (user POV)

- Header nav `pages.admin` → tab `admin.tabs.teams`, or tab `admin.tabs.users` for the column, filter, checkboxes and `members.assign.title` (admins only).
- `/settings` → region `settings.account.title` (every member).

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and reports `role: "admin"`; the journey creates its two members through the admin API.
- The database has the `teams` table and `users.team_id` (migration applied).
- It runs in every language and on both viewports: `VGS_LOCALE=en-US VGS_MOBILE=1 vgs run teams`.

- **Members.** The admin API creates `vgs-team-<stamp>-a@example.test` and `-b`. Nothing else in the users table is selected or changed.
- **Create.** Tab `admin.tabs.teams`, `teams.create.title` with focus on `teams.name.label`: `vgs-team-<stamp>-alpha` and `-beta`, each announced as `teams.notice.created` (`01`). The upper-case alpha shows `errors.duplicateTeamName` and 31 characters show `errors.nameTooLong` (`팀 이름은 30자까지입니다 (지금 31자)` in Korean) inside the dialog (`02`).
- **Rename.** alpha's editor saves `  vgs-team-<stamp>-red ` and the dialog becomes `teams.edit` with red; `/api/admin/teams` lists red, trimmed, and no alpha (`03`).
- **Assign.** Tab `admin.tabs.users` has a `members.field.team` column. The two members' own checkboxes give `members.selected` with 2 without opening the editor; dialog `members.assign.title` lists exactly those two, `members.assign.submit` with 2 stays disabled until red is chosen (`04`), then says `members.notice.assigned` with 2 and red. `/api/admin/users` shows both in red and every other user's team unchanged (`05`).
- **Editor.** B's editor moves B to beta through `members.field.team`; the API and the select agree (`06`).
- **Filter.** `members.filter.label` = red shows only A; `members.selectAll` gives `members.selected` with 1 (`07`) and unchecking gives 0; beta shows only B; `teams.none` shows neither.
- **Delete.** beta's editor lists B; `teams.delete.title` says `teams.delete.confirm` with 1 (`08`); `teams.delete.submit` says `teams.notice.deleted` with beta and 1, beta is gone, B has no team and A is still in red (`09`); B's row shows `teams.none` (`10`).
- **Member.** A signs in (new password), and settings → `settings.account.title` → `settings.account.team` reads red (`11`); as A, `GET /api/admin/teams` and `PATCH /api/admin/users` answer 403. B's settings read `teams.none` (`12`).
- **Proof.** `result.json` is `ok: true`; `log.md` ends with `cleanup: deleted 2 member row(s) and 1 team row(s); 0 member(s) and 0 team(s) of this run left`.

## Gotchas

- The production database is the only one. The journey never ticks `members.selectAll` without a team filter, and refuses to press `members.assign.submit` unless the dialog lists exactly its two members.
- There is no user delete endpoint: `finally` deletes this run's `vgs-team-<stamp>-` users and teams straight from the database, also on failure. If a run is killed, delete leftovers with `delete from users where username like 'vgs-team-%'` and `delete from teams where name ilike 'vgs-team-%'`.
- A team's name is unique without regard to case, so `VGS-TEAM-…-ALPHA` collides with `vgs-team-…-alpha`.
- After a rename the editor's accessible name changes with the title; find it again by `teams.edit` with the new name.
- A field's accessible name is its label followed by more text: `teams.name.label` its hint, the `members.field.team` select its hint or the chosen team. Match each with a RegExp that starts with the label.
- Switching tabs remounts the panel, so the filter goes back to `members.filter.all` and the selection empties.
