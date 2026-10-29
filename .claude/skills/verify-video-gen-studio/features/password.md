# Password

A member signs in with the temporary password an admin gave them (`oooooooo` for imported members) and must choose their own before anything else. Anyone can change their password from the login screen with the current one; a change signs every other browser out. Email IDs sign in whatever their case.

## Sub-features

- `password-forced` a temporary password opens the 새 비밀번호 정하기 form instead of a session; the ID and temporary password are kept, so only 새 비밀번호 and 새 비밀번호 확인 are asked. Success lands on `/playground` (or `?next=`).
- `password-rules` the new password needs 8+ characters, must differ from the current one, and cannot be the initial password; a mismatched 확인 is refused before any request.
- `password-change` the 비밀번호 변경 button under 로그인 opens a form with ID, 현재 비밀번호, 새 비밀번호, 새 비밀번호 확인; success signs in and lands on `/playground`.
- `password-revoke` a browser signed in before the change lands on the login form at its next page load; the browser that made the change stays signed in.
- `password-lockout` wrong current passwords in the change form count toward the same 10-attempt / 15-minute lock as sign-in.
- `password-email-case` an ID with `@` signs in in any case (`Kim@Example.COM` opens `kim@example.com`).
- `password-admin-reset` an admin's new password for another member is temporary: their sessions end and their next sign-in asks for a new one. The edit modal says 임시 비밀번호 상태입니다.

## How to get to it (user POV)

- `/login`, then 비밀번호 변경 under the 로그인 button.
- `/login` with a temporary password: the form switches by itself.
- Admin: 어드민 → 사용자 · API 키 → button 사용자 추가 → dialog 사용자 추가 (임시 비밀번호), or a member's row → dialog `<username> 편집` → 임시 비밀번호 → 변경.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and the run's user is an **admin** (the journey creates its member through the admin UI).
- Nothing else is signing in as a `vgs-pw-*@example.test` member.

- **Create a member.** The admin opens 사용자 추가 and adds `VGS-PW-<stamp>@Example.TEST` with `oooooooo`; the dialog closes and the page says `vgs-pw-<stamp>@example.test 계정을 추가했습니다`. Run `vgs run password`; the note says it is stored lowercase with mustChangePassword=true.
- **Forced change.** Sign in with the temporary password. The h1 becomes 새 비밀번호 정하기, no `vgs_session` cookie exists, and there is no 현재 비밀번호 field (`02-temporary`). A mismatched 확인 (`03`) and the initial password (`04`) show alerts; a valid one lands on `/playground` with the member in the header (`05`).
- **Old password.** After 로그아웃, `oooooooo` shows `ID 또는 비밀번호가 맞지 않습니다` (`06`).
- **Email case.** The mixed-case ID with the new password signs in (`07`).
- **Change from the login screen.** A second browser opens 비밀번호 변경 (`08`), is refused the current password as the new one (`09`), then changes it and keeps its session on `/dashboard` (`10`).
- **Revoke.** The first browser's next load of `/gallery` shows the login form (`11`).
- **Admin reset.** The admin opens the member's row and sets `oooooooo` in dialog `<username> 편집`; the dialog says 임시 비밀번호 상태입니다 (`12`). The second browser's `/playground` shows the login form and the reset password opens 새 비밀번호 정하기 (`13`).
- **Lockout.** Ten wrong 현재 비밀번호 submits answer 401; the eleventh, with the right one, answers 423 `실패가 누적되어 잠겼습니다` (`14`).
- **Proof.** `result.json` is `ok: true`; `log.md` ends with `cleanup: deleted 1 member row(s)`.

## Gotchas

- The journey deletes its member in `finally`, also on failure. If a run is killed, remove leftovers with `delete from users where username like 'vgs-pw-%'`.
- Revocation compares whole seconds (JWT `iat`): a session signed earlier in the same second as the change survives. Keep a second between signing in and changing when you check revocation by hand.
- The 새 비밀번호 field's accessible name includes its hint (`새 비밀번호 8자 이상`); match it with `getByLabel(/^새 비밀번호(?! 확인)/)`.
- Never run this journey with the operator's account or change the seeded admin's password; it only needs the admin to create and reset its own member.
