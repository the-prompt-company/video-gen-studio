# Teams

An administrator creates teams, renames and deletes them, and places members in them: many at once from the users table, or one at a time in the member editor. A member belongs to one team or none (미소속). Deleting a team makes its members 미소속 and keeps their videos and usage. A member reads their own team in 설정 → 계정 and cannot change it.

## Sub-features

- `adm-teams` tab 팀 lists teams by name with 인원 and 팀원, under button 팀 만들기. Dialog 팀 만들기 takes 팀 이름: trimmed, at most 30 characters, one visible line, unique without regard to case (`이미 있는 팀 이름입니다…`). A row click, or Enter on `<팀 이름> 편집`, opens dialog `<팀 이름> 편집` with 팀 이름 + 저장, the member list, and 팀 삭제.
- `adm-teams-delete` 팀 삭제 shows group 팀 삭제 saying how many members become 미소속 and that videos and usage stay; 삭제 deletes the team and says `팀을 삭제했습니다: <name>. 팀원 N명이 미소속이 됐습니다.`
- `adm-teams-assign` the users table has a checkbox per row (`<username> 선택`) and one in the header (`보이는 사용자 모두 선택`, only the rows the filter shows). Button 팀 지정 opens dialog 팀 지정 listing the chosen users with their current team; a team (or 미소속) and `N명 지정` move exactly them.
- `adm-teams-filter` combobox 팀으로 거르기 shows 모든 팀, 미소속 or one team, each with its head count. Changing it clears the selection.
- `adm-user-team` dialog `<username> 편집` has a 팀 select (미소속 + every team) that saves on change.
- `settings-team` 설정 → 계정 shows 팀 under ID: the team's name, or 미소속.

## How to get to it (user POV)

- Header nav 어드민 → tab 팀, or tab 사용자 · API 키 for the column, filter, checkboxes and 팀 지정 (admins only).
- `/settings` → region 계정 (every member).

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and reports `role: "admin"`; the journey creates its two members through the admin API.
- The database has the `teams` table and `users.team_id` (migration applied).

- **Members.** The admin API creates `vgs-team-<stamp>-a@example.test` and `-b`. Nothing else in the users table is selected or changed.
- **Create.** Tab 팀, 팀 만들기 with focus on 팀 이름: `vgs-team-<stamp>-alpha` and `-beta`, each announced as `팀을 만들었습니다: <name>` (`01`). The upper-case alpha shows `이미 있는 팀 이름입니다` and 31 characters show `팀 이름은 30자까지입니다 (지금 31자)` inside the dialog (`02`).
- **Rename.** alpha's editor saves `  vgs-team-<stamp>-red ` and the dialog becomes `vgs-team-<stamp>-red 편집`; `/api/admin/teams` lists red, trimmed, and no alpha (`03`).
- **Assign.** Tab 사용자 · API 키 has a 팀 column. The two members' own checkboxes give `2명 선택` without opening the editor; dialog 팀 지정 lists exactly those two, `2명 지정` stays disabled until red is chosen (`04`), then says `2명을 <team>에 지정했습니다`. `/api/admin/users` shows both in red and every other user's team unchanged (`05`).
- **Editor.** B's editor moves B to beta through 팀; the API and the select agree (`06`).
- **Filter.** 팀으로 거르기 = red shows only A; 보이는 사용자 모두 선택 gives `1명 선택` (`07`) and unchecking gives `0명 선택`; beta shows only B; 미소속 shows neither.
- **Delete.** beta's editor lists B; 팀 삭제 says `팀원 1명은 미소속이 되고` (`08`); 삭제 says `팀을 삭제했습니다: <beta>. 팀원 1명이 미소속이 됐습니다`, beta is gone, B is 미소속 and A still in red (`09`); B's row shows 미소속 (`10`).
- **Member.** A signs in (new password), and 설정 → 계정 → 팀 reads red (`11`); as A, `GET /api/admin/teams` and `PATCH /api/admin/users` answer 403. B's 설정 reads 미소속 (`12`).
- **Proof.** `result.json` is `ok: true`; `log.md` ends with `cleanup: deleted 2 member row(s) and 1 team row(s); 0 member(s) and 0 team(s) of this run left`.

## Gotchas

- The production database is the only one. The journey never ticks 보이는 사용자 모두 선택 without a team filter, and refuses to press `2명 지정` unless the dialog lists exactly its two members.
- There is no user delete endpoint: `finally` deletes this run's `vgs-team-<stamp>-` users and teams straight from the database, also on failure. If a run is killed, delete leftovers with `delete from users where username like 'vgs-team-%'` and `delete from teams where name ilike 'vgs-team-%'`.
- A team's name is unique without regard to case, so `VGS-TEAM-…-ALPHA` collides with `vgs-team-…-alpha`.
- After a rename the editor's accessible name changes with the title; find it again by the new name.
- Switching tabs remounts the panel, so the filter goes back to 모든 팀 and the selection empties.
