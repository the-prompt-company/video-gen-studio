# Settings

A signed-in member opens 설정 from their photo and name at the right of the header. They pick a profile photo, which the browser crops to a centered 256×256 square before upload, see a preview, save it, replace it or remove it. They set or clear a nickname, which the header shows in place of the ID. They see their ID read-only and change their password, which keeps this browser signed in and signs every other browser out.

## Sub-features

- `settings-nav` the header shows the member's photo (or the first letter of the name) and nickname (or ID) as a link named `<name> 설정` to `/settings`; on `/settings` it is the current page. `/settings` without a session goes to `/login?next=%2Fsettings`.
- `settings-photo` 사진 고르기 opens the file picker; any image the browser can open becomes a 256×256 WebP (JPEG where WebP cannot be encoded) preview with 사진 저장 and 취소. Saving stores it at `avatars/<user id>/<32 hex>.<ext>` and the header photo changes without a reload. The original file never leaves the browser.
- `settings-photo-replace` saving another photo stores a new key and deletes the previous object.
- `settings-photo-remove` 사진 삭제 clears the photo; the header shows the letter again and the object is deleted.
- `settings-photo-off` with no Blob store the photo buttons are disabled under a status saying 사진 저장소(Vercel Blob)가 연결되지 않아…, and `PUT`/`DELETE /api/me/avatar` answer 503.
- `settings-photo-guard` no request a member can send deletes another member's photo, a video or a reference, even when the member's own row names another member's key.
- `settings-nickname` 닉네임 is trimmed, at most 30 characters, without control or invisible characters, and need not be unique. Saving updates the header without a reload; an empty save clears it and the header shows the ID.
- `settings-account` 계정 shows the ID once, as text; the password form keeps it only as a hidden username field for password managers.
- `settings-password` 비밀번호 asks for 현재 비밀번호, 새 비밀번호 and 확인 with the ID fixed. Success stays on `/settings` and says 비밀번호를 바꿨습니다. 다른 기기와 브라우저의 로그인은 모두 끝났습니다; another browser signed in as the member lands on the login form at its next page load.

## How to get to it (user POV)

- The photo and name at the right of the header, on any app page.
- `/settings` directly.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and the run's user is an **admin** (the journey creates its two members through the admin API).
- For the photo steps the app runs with a Blob store. Locally that is the fake: start `FAKE_HF_PORT=4330 npm run fake:hf`, then `vgs launch` with `BLOB_READ_WRITE_TOKEN=vercel_blob_rw_fake_fake`, `VERCEL_BLOB_API_URL=http://localhost:4330/api/blob`, `NEXT_PUBLIC_VERCEL_BLOB_API_URL=http://localhost:4330/api/blob` and `BLOB_PUBLIC_BASE_URL=http://localhost:4330/blob` in its environment. Without them the journey proves `settings-photo-off` instead and skips the photo steps.

- **Protection.** A browser with no session opens `/settings` and lands on `/login?next=%2Fsettings` (note).
- **Members.** The admin API creates `vgs-set-<stamp>-a@example.test` and `-b`; member A sets a password through 새 비밀번호 정하기.
- **Nav.** A's header shows the ID and a letter, no `<img>` (`01`); clicking it opens `/settings` with the link `aria-current="page"`, 계정 shows the ID as text and the 비밀번호 region has no visible ID field (`02`).
- **Photo.** A ~5 MB 3200×2400 JPEG goes through the real file chooser (`03` preview); 사진 저장 sends about 2 KB, `users.avatar_key` becomes `avatars/<id>/<hex>.webp`, the header `<img>` points at it, and the stored object decodes to 256×256 (`04`, full page). A 1200×400 PNG of red, green and blue bands replaces it: the stored square is all green (center crop), the old URL answers 404 and the fake's `deleteUrls` holds its canonical URL (`05`, `06`). 사진 삭제 clears the key and the object answers 404 (`07`).
- **Nickname.** 31 characters show `닉네임은 30자 이하로 정하세요`; the API refuses a bidi override and 31 characters with 400 (`08`). `  설정 테스터 ` is saved trimmed and the header changes without a reload (`09`, full page) and stays on `/dashboard` (`10`). An empty save brings the ID back (`11`).
- **Guard.** Member B uploads a photo. A sends DELETE with B's key in query and body, and PATCH with `avatarKey`. A's PUTs of HTML declared as PNG, an SVG, and JPEG bytes declared as PNG answer 415, and 600 KB answers 413, with `avatar_key` still null. Then A's row is set to B's key and A sends DELETE and PUT. B's photo still answers 200, B's row still names it and `del()` never received it (`12`, B's settings).
- **Password.** A second browser signs in as A; a second later A changes the password in 비밀번호 (`13`). A reload keeps A on `/settings`; the second browser's `/settings` shows the login form (`14`).
- **Proof.** `result.json` is `ok: true`; `log.md` ends with `cleanup: 0 photo object(s) of this run left in the store` and `cleanup: deleted 2 member row(s)`.

## Gotchas

- The journey deletes its members' photos through the app and their rows straight from the database in `finally`, also on failure. If a run is killed, delete leftovers with `delete from users where username like 'vgs-set-%'`; their photos stay in the store under `avatars/<id>/`.
- Revocation compares whole seconds (JWT `iat`): the journey waits a second between the second browser's sign-in and the change.
- A revoked session passes `proxy.ts` (the cookie still verifies) and the app layout sends it to `/login` without `?next`; a browser with no cookie gets `?next=`.
- Chromium does not expose a Blob request body to Playwright, so the sent size comes from the request's `content-length`.
- Never run it with the operator's account; it only needs the admin to create its own members.
