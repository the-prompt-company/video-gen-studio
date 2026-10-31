# Screens: settings and admin

설정 and the admin's members, teams, member import, model rates and logs read fully in the browser's language (Korean, English or Simplified Chinese). Counts follow the language's plural rules, nicknames, IDs, team names and prompts stay exactly as typed, model names are never translated, and no screen scrolls sideways at 390 px.

## Sub-features

- `scra-settings` a member's 설정 shows the `settings.*` regions, and 계정 → `settings.account.team` reads `teams.none` for a member without a team.
- `scra-profile` a square photo saves with `profile.done.photoSaved`, a nickname with `profile.done.nicknameSaved`, and the header link shows the photo and the Korean nickname as typed.
- `scra-profile-errors` 31 characters show `errors.nameTooLong` (kind nickname, max 30, length 31), and a file that is not an image shows `profile.photo.unreadable`.
- `scra-users` the members tab's `members.title` and every `members.filter.*` option carry the head counts the API gives.
- `scra-add` adding an existing ID shows `errors.duplicateUsername` inside the `members.add.title` dialog.
- `scra-assign` two `members.select` checkboxes give `members.selected`, the `members.assign.title` dialog lists both with `members.assign.submit`, and assigning says `members.notice.assigned` with the team name as typed.
- `scra-edit` the `members.edit` dialog with the `members.reset.title` group open has no button or label wider than its box.
- `scra-import` the `import.title` dialog shows its format example; `mixed.xlsx` previews each row with an `import.outcome.*` badge and the invalid rows' `errors.*` text; `missing-column.xlsx` shows `import.failure.missingColumns`; `korean-headers.xlsx` previews in every language. Cancelling creates nobody.
- `scra-teams` the teams tab reads `teams.count` and `teams.size`; the editor's delete group reads `teams.delete.confirm`; create, rename and delete say `teams.notice.created` and `teams.notice.deleted` with the name as typed.
- `scra-models` each model card has its `models.unit` line and fill buttons named by `models.fill`; a published Seedance rate saves and reads back, then the old rate comes back.
- `scra-logs` the logs tab reads `logs.title`, `logs.field.*` columns, `status.*` badges and `logs.seconds`; the failed row's detail shows `errors.submitDeadline` for 30 minutes; at 390 px the table scrolls inside its box.
- `scra-clean` the console has no `MISSING_MESSAGE` and no hydration warning, and the admin's stored language does not move.

## How to get to it (user POV)

- Header link `<nickname or ID> <pages.settings>` → 설정 (every member).
- Header nav `pages.admin` → tabs `admin.tabs.users`, `admin.tabs.teams`, `admin.tabs.models`, `admin.tabs.logs` (admins only).

## Driving it with vgs

Preconditions:

- A local database (the journey refuses any other), the fake on `VGS_FAKE_HF` with its Blob store, and `.env.local` pointing the photo store at it, so 설정 offers `profile.photo.choose`.
- Run it as the admin, once per language and viewport: `TZ=UTC VGS_FAKE_HF=http://localhost:4600 VGS_LOCALE=zh-CN VGS_MOBILE=1 vgs run screens-admin`.

- **Data.** The admin API creates `vgs-loc-i18n4-<stamp>-a@example.test` and `-b` (each signs in once through the forced change) and team `검증팀 <stamp>`; the database gets one completed and one failed (`submitDeadline`, 30 minutes) row for A, prompts `[목업] i18n4 <stamp> …`. The import fixtures go to a temporary folder.
- **Member screens.** B's 설정 (`settings`, full page), then A saves `public/mock/ref-square.jpg` and `검증용 닉네임` (`profile-saved`), tries 31 characters (`profile-errors`) and picks `notes.txt` (`profile-photo-error`). `users.nickname` and `users.avatar_key` are read back.
- **Members tab.** `users`, `users-add`, `users-assign` (then `/api/admin/teams` lists A and B on the team), `users-edit`, `users-import`, `import-results`, `import-header-error`.
- **Teams tab.** `teams`, `teams-edit` (delete cancelled, the team stays), then `검증 임시팀 <stamp>` is created, renamed to `검증 새이름팀 <stamp>` and deleted through the dialogs, each step read back through `/api/admin/teams`.
- **Models and logs.** `models` (full page), the Seedance fill → 저장 → `/api/admin/models` → restore round trip, `logs`, `logs-detail`.
- **Proof.** Each surface is saved as `.impeccable/review/i18n-4/<surface>-<lang>-<viewport>.png`; `log.md` records the strings read and ends with the list of review images and `cleanup: deleted 2 member(s), their rows and 1 team(s)`. `finally` deletes A's photo through the app, then the members, their rows and the teams from the database.

## Gotchas

- Another journey can add or remove members, teams and rows at the same moment. The member, team and log counts are compared with one API read and the view is reopened up to twice before the journey fails.
- Options of a closed `<select>` are never visible to Playwright; wait for them `attached`.
- The Seedance rate is shared with the `screens` journey, which sets its own rate for its run. Run the two one after another, not side by side.
- The logs detail is not a `dialog`; find it by its `dl` and close it with `common.close`.
