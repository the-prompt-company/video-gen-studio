# Import

An admin creates members from an Excel file with `nickname` and `email` columns, in a modal opened from the users tab. The browser reads the `.xlsx`, the server checks every row and answers one outcome per row, the admin confirms, and each new member signs in with `oooooooo` and must choose a password first. The users table shows each nickname and a `members.temporary` (임시 비밀번호) badge until that first change, and the member's edit modal can edit the nickname or put the password back to `oooooooo`. The modal reads in the page language; the sheet headers, nicknames and emails stay as written.

## Sub-features

- `imp-format` button `import.title` (엑셀로 회원 만들기) opens dialog `import.title`, which shows an example table `import.example.label` with the two headers. The file picker `import.pick.first`, `import.submit` and `common.cancel` sit in its footer, which stays in view while the rows scroll.
- `imp-headers` the header is the first non-empty row; `nickname`/`닉네임` and `email`/`이메일` match trimmed and in any case, in any column order; other columns and rows with both cells blank are skipped.
- `imp-header-error` a missing column is an alert, `import.failure.missingColumns`, naming the header row, the missing column and the headers found.
- `imp-preview` a dry run lists each row in list `import.rows` with its sheet row number `import.row` and one badge: `import.outcome.create` (만들 예정), `import.outcome.exists` (ID exists), `import.outcome.duplicate` (same email earlier in the file, the first row wins, `import.detail.duplicate`), `import.outcome.invalid` (with the reason: `errors.emailInvalid`, `errors.nameBlank`, `errors.nameTooLong`, `errors.nameControl`). Nothing is created.
- `imp-create` `import.submit` (`N명 만들기`) creates the `import.outcome.create` rows as role user with the email lowercased as the ID, the trimmed nickname, and a temporary `oooooooo`; the modal says `import.done` (`N명을 만들었습니다…`) and keeps the result until it is closed, and the users table reloads. Opening it again starts from `import.pick.first`.
- `imp-cap` more than 200 rows is an alert, `errors.importTooMany`, asking to split the file.
- `imp-table` the users table has a `members.field.nickname` column and a `members.temporary` badge in `members.table.status` while the member has not chosen a password.
- `imp-nickname` the edit modal's `members.field.nickname` field saves a trimmed nickname, refuses over 30 characters (the error shows inside the modal), and an empty field removes it.
- `imp-reset` `members.reset.title` (초기 비밀번호로 되돌리기) asks once more in group `members.reset.title`, whose text names `oooooooo` (`초기 비밀번호(oooooooo)로 되돌립니다`); `members.reset.confirm` sets it: the member's sessions end and their next sign-in asks for a new password. Not shown on the admin's own row.

## How to get to it (user POV)

- `pages.admin` → `admin.tabs.users` → button `import.title` (in the users table's header) → `import.pick.first`.
- `pages.admin` → `admin.tabs.users` → a member's row → dialog `members.edit` for `members.field.nickname` and `members.reset.title`.
- `/login` with an imported email and `oooooooo` for the member's first sign-in.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and the run's user is an **admin**.
- `write-excel-file` is installed (a dev dependency of the app): the journey writes its fixtures with `scripts/import-fixtures.mjs` into the evidence folder.
- Nothing else is using `vgs-imp-*@example.test` members.
- It runs in every language and on both viewports: `VGS_LOCALE=en-US VGS_MOBILE=1 vgs run import`.

- **Format.** Run `vgs run import`. Click `import.title`; the dialog and its example table are visible (`01-import-modal`).
- **Header error.** Pick `missing-column.xlsx`. The alert reads `import.failure.missingColumns` for header row 1, the missing `email` column and the headers found, `이름, 메일, nickname` (`02`).
- **Cap.** Pick `too-many.xlsx` (201 rows). The alert reads `errors.importTooMany` with 200 and 201 (`03`).
- **English headers.** Pick `english-headers.xlsx`. Three rows show `import.outcome.create` and the API has none of them yet (`04`). `import.submit` with 3 creates them; the API reads them back as users with their nicknames and `mustChangePassword: true` (`05`). A second later `import.done` is still in the modal; `common.close` closes it with focus back on `import.title`, and the table row shows the nickname and `members.temporary` (`06`).
- **Mixed file.** Reopen the modal: it starts from `import.pick.first` with no result list. Pick `mixed.xlsx` (header on row 3, extra columns, blank rows). Rows 4 and 6 are `import.outcome.create` (row 4 is an uppercase email), 7 is `import.outcome.duplicate` of 4, 8 is `import.outcome.exists`, 9 to 12 are `import.outcome.invalid` with their reasons (`07`). `import.submit` with 2 creates exactly those two, lowercased and trimmed (`08`).
- **Korean headers and 200 rows.** `korean-headers.xlsx` creates 2. `two-hundred.xlsx` previews 200: the modal fits the viewport, its body scrolls inside with nothing sideways, and `import.submit` with 200 stays in view (note, `09`). It creates them in one request; the note records the request time (`10`), then `common.close`.
- **First sign-in.** A second browser signs in with the uppercase imported email and `oooooooo` and gets `auth.heading.temporary.title` (`11`), chooses a password and lands on `/playground` (`12`). The admin table drops the badge.
- **Nickname.** The member's row opens dialog `members.edit` with the email; it refuses 31 characters and saves a padded name trimmed (`13`).
- **Reset.** `members.reset.title` opens its group, whose text names `oooooooo` (`14`); `members.reset.confirm`: the dialog says `members.editor.temporaryNote` and the badge is back (`15`); the member's `/playground` goes to `/login`, the chosen password is refused, and `oooooooo` opens `auth.heading.temporary.title` (`16`).
- **Proof.** `result.json` is `ok: true`, no browser errors other than HTTP statuses, and `log.md` ends with `cleanup: deleted 207 member row(s) with prefix vgs-imp-<stamp>-`.

## Gotchas

- The journey deletes every `vgs-imp-<stamp>-%` row in `finally`, also on failure. If a run is killed, remove leftovers with `delete from users where username like 'vgs-imp-%'`.
- Each run uses a fresh random stamp, so desktop and mobile runs never collide; never reuse a stamp by hand.
- The file input is visually hidden inside the `import.pick.first` label in the modal's footer; drive it with `setInputFiles` on `input[type=file]` inside the dialog. While a preview is shown the footer holds `import.submit` and `common.cancel` instead, so there is no file input until one of them is pressed.
- A result row's text runs the email straight into the row label, so the journey reads the row number with a RegExp built from `import.row` (`(\d+)행`, `Row (\d+)`, `第 (\d+) 行`).
- `members.reset.body` holds a `<mono>` tag, so `ev.t` cannot render it; the journey checks that the confirm group's text contains `oooooooo` instead.
- Close the import modal before checking the users table: the table is behind the modal (inert, though Playwright's role queries still find it).
- 200 rows take several seconds (one scrypt hash per member); the journey waits up to 90 s for the create request.
- Never import the operator's account or the seeded admin's email; an `import.outcome.exists` row changes nothing, but keep fixtures on `example.test`.
