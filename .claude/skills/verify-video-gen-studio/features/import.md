# Import

An admin creates members from an Excel file with `nickname` and `email` columns, in a modal opened from the users tab. The browser reads the `.xlsx`, the server checks every row and answers one outcome per row, the admin confirms, and each new member signs in with `oooooooo` and must choose a password first. The users table shows each nickname and a 임시 비밀번호 badge until that first change, and the member's edit modal can edit the nickname or put the password back to `oooooooo`.

## Sub-features

- `imp-format` button 엑셀로 회원 만들기 opens dialog 엑셀로 회원 만들기, which shows an example table (`엑셀 형식 예시`) with the two headers. The file picker, `N명 만들기` and 취소 sit in its footer, which stays in view while the rows scroll.
- `imp-headers` the header is the first non-empty row; `nickname`/`닉네임` and `email`/`이메일` match trimmed and in any case, in any column order; other columns and rows with both cells blank are skipped.
- `imp-header-error` a missing column is an alert naming the missing column and the headers found.
- `imp-preview` a dry run lists each row with its sheet row number and one badge: 만들 예정, 이미 있음 (ID exists), 파일 안 중복 (same email earlier in the file, the first row wins), 확인 필요 (with the reason: email format, empty nickname, over 30 characters, control characters). Nothing is created.
- `imp-create` `N명 만들기` creates the 만들 예정 rows as role user with the email lowercased as the ID, the trimmed nickname, and a temporary `oooooooo`; the modal says `N명을 만들었습니다` and keeps the result until it is closed, and the users table reloads. Opening it again starts from 엑셀 파일 고르기.
- `imp-cap` more than 200 rows is an alert asking to split the file.
- `imp-table` the users table has a 닉네임 column and a 임시 비밀번호 badge in 상태 while the member has not chosen a password.
- `imp-nickname` the edit modal's 닉네임 field saves a trimmed nickname, refuses over 30 characters (the error shows inside the modal), and an empty field removes it.
- `imp-reset` 초기 비밀번호로 되돌리기 asks once more, then sets `oooooooo`: the member's sessions end and their next sign-in asks for a new password. Not shown on the admin's own row.

## How to get to it (user POV)

- 어드민 → 사용자 · API 키 → button 엑셀로 회원 만들기 (in the users table's header) → 엑셀 파일 고르기.
- 어드민 → 사용자 · API 키 → a member's row → dialog `<username> 편집` for 닉네임 and 초기 비밀번호로 되돌리기.
- `/login` with an imported email and `oooooooo` for the member's first sign-in.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and the run's user is an **admin**.
- `write-excel-file` is installed (a dev dependency of the app): the journey writes its fixtures with `scripts/import-fixtures.mjs` into the evidence folder.
- Nothing else is using `vgs-imp-*@example.test` members.

- **Format.** Run `vgs run import`. Click 엑셀로 회원 만들기; the dialog and its example table are visible (`01-import-modal`).
- **Header error.** Pick `missing-column.xlsx`. The alert names `email(또는 이메일)` and `찾은 제목: 이름, 메일, nickname` (`02`).
- **Cap.** Pick `too-many.xlsx` (201 rows). The alert says `200명까지` and `201명` (`03`).
- **English headers.** Pick `english-headers.xlsx`. Three rows show 만들 예정 and the API has none of them yet (`04`). `3명 만들기` creates them; the API reads them back as users with their nicknames and `mustChangePassword: true` (`05`). A second later the result is still in the modal; 닫기 closes it with focus back on 엑셀로 회원 만들기, and the table row shows the nickname and 임시 비밀번호 (`06`).
- **Mixed file.** Reopen the modal: it starts from 엑셀 파일 고르기 with no result list. Pick `mixed.xlsx` (header on row 3, extra columns, blank rows). Rows 4 and 6 are 만들 예정 (row 4 is an uppercase email), 7 is 파일 안 중복 of 4, 8 is 이미 있음, 9 to 12 are 확인 필요 with their reasons (`07`). `2명 만들기` creates exactly those two, lowercased and trimmed (`08`).
- **Korean headers and 200 rows.** `korean-headers.xlsx` creates 2. `two-hundred.xlsx` previews 200: the modal fits the viewport, its body scrolls inside with nothing sideways, and `200명 만들기` stays in view (note, `09`). It creates them in one request; the note records the request time (`10`), then 닫기.
- **First sign-in.** A second browser signs in with the uppercase imported email and `oooooooo` and gets 새 비밀번호 정하기 (`11`), chooses a password and lands on `/playground` (`12`). The admin table drops the badge.
- **Nickname.** The member's row opens dialog `<email> 편집`; it refuses 31 characters and saves a padded name trimmed (`13`).
- **Reset.** 초기 비밀번호로 되돌리기 → 되돌리기 (`14`): the dialog says 임시 비밀번호 상태입니다 and the badge is back (`15`); the member's `/playground` goes to `/login`, the chosen password is refused, and `oooooooo` opens 새 비밀번호 정하기 (`16`).
- **Proof.** `result.json` is `ok: true`, no browser errors other than HTTP statuses, and `log.md` ends with `cleanup: deleted 207 member row(s) with prefix vgs-imp-<stamp>-`.

## Gotchas

- The journey deletes every `vgs-imp-<stamp>-%` row in `finally`, also on failure. If a run is killed, remove leftovers with `delete from users where username like 'vgs-imp-%'`.
- Each run uses a fresh random stamp, so desktop and mobile runs never collide; never reuse a stamp by hand.
- The file input is visually hidden inside the 엑셀 파일 고르기 label in the modal's footer; drive it with `setInputFiles` on `input[type=file]` inside the dialog. While a preview is shown the footer holds `N명 만들기` and 취소 instead, so there is no file input until one of them is pressed.
- Close the import modal before checking the users table: the table is behind the modal (inert, though Playwright's role queries still find it).
- 200 rows take several seconds (one scrypt hash per member); the journey waits up to 90 s for the create request.
- Never import the operator's account or the seeded admin's email; an `이미 있음` row changes nothing, but keep fixtures on `example.test`.
