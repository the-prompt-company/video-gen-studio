# Password

A member signs in with the temporary password an admin gave them (`oooooooo` for imported members) and must choose their own before anything else. Anyone can change their password from the login screen with the current one; a change signs every other browser out. Email IDs sign in whatever their case. Every form reads in the page language.

## Sub-features

- `password-forced` a temporary password opens the `auth.heading.temporary.title` (새 비밀번호 정하기) form instead of a session; the ID and temporary password are kept, so only `auth.newPassword` and `auth.confirmPassword` are asked. Success lands on `/playground` (or `?next=`).
- `password-rules` the new password needs 8+ characters, must differ from the current one, and cannot be the initial password; a mismatched `auth.confirmPassword` is refused before any request (`auth.mismatch`).
- `password-change` the `auth.changePassword` button under `auth.signIn` opens a form with ID, `auth.currentPassword`, `auth.newPassword`, `auth.confirmPassword`; success signs in and lands on `/playground`.
- `password-revoke` a browser signed in before the change lands on the login form at its next page load; the browser that made the change stays signed in.
- `password-lockout` wrong current passwords in the change form count toward the same 10-attempt / 15-minute lock as sign-in.
- `password-email-case` an ID with `@` signs in in any case (`Kim@Example.COM` opens `kim@example.com`).
- `password-admin-reset` an admin's new password for another member is temporary: their sessions end and their next sign-in asks for a new one. The edit modal says `members.editor.temporaryNote` (임시 비밀번호 상태입니다…).

## How to get to it (user POV)

- `/login`, then `auth.changePassword` under the `auth.signIn` button.
- `/login` with a temporary password: the form switches by itself.
- Admin: `pages.admin` → `admin.tabs.users` → button `members.add.title` → dialog `members.add.title` (`members.add.password`), or a member's row → dialog `members.edit` → placeholder `members.password.temporary` → `members.password.change`.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and the run's user is an **admin** (the journey creates its member through the admin UI).
- Nothing else is signing in as a `vgs-pw-*@example.test` member.
- It runs in every language and on both viewports: `VGS_LOCALE=zh-CN VGS_MOBILE=1 vgs run password`.

- **Create a member.** The admin opens `members.add.title` and adds `VGS-PW-<stamp>@Example.TEST` with `oooooooo`; the dialog closes and the page says `members.notice.added` with `vgs-pw-<stamp>@example.test`. Run `vgs run password`; the note says it is stored lowercase with mustChangePassword=true.
- **Forced change.** Sign in with the temporary password. The h1 becomes `auth.heading.temporary.title`, no `vgs_session` cookie exists, and there is no `auth.currentPassword` field (`02-temporary`). A mismatched confirmation (`03`) and the initial password (`04`) show alerts; a valid one lands on `/playground` with the member in the header (`05`).
- **Old password.** After `nav.logout`, `oooooooo` shows `errors.wrongCredentials` (`06`).
- **Email case.** The mixed-case ID with the new password signs in (`07`).
- **Change from the login screen.** A second browser opens `auth.changePassword` (`08`), is refused the current password as the new one (`09`), then changes it and keeps its session on `/dashboard` (`10`).
- **Revoke.** The first browser's next load of `/gallery` shows the login form (`11`).
- **Admin reset.** The admin opens the member's row and types `oooooooo` into placeholder `members.password.temporary` in dialog `members.edit`, then `members.password.change`; the dialog says `members.editor.temporaryNote` (`12`). The second browser's `/playground` shows the login form and the reset password opens `auth.heading.temporary.title` (`13`).
- **Lockout.** Ten wrong `auth.currentPassword` submits answer 401; the eleventh, with the right one, answers 423 and the alert reads `errors.locked` with 15 minutes (`14`).
- **Proof.** `result.json` is `ok: true`; `log.md` ends with `cleanup: deleted 1 member row(s)`.

## Gotchas

- The journey deletes its member in `finally`, also on failure. If a run is killed, remove leftovers with `delete from users where username like 'vgs-pw-%'`.
- Revocation compares whole seconds (JWT `iat`): a session signed earlier in the same second as the change survives. Keep a second between signing in and changing when you check revocation by hand.
- The `auth.newPassword` field's accessible name includes its hint (`새 비밀번호 8자 이상`), and the `auth.confirmPassword` label contains `auth.newPassword` in every language; take `getByLabel(ev.t("auth.newPassword")).first()`.
- Never run this journey with the operator's account or change the seeded admin's password; it only needs the admin to create and reset its own member.
