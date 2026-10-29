# Admin

Admin lets an administrator add users and assign each one a Higgsfield API key, change passwords, roles and active state, unlock locked accounts, set the per-second price and enabled state of each model, and browse every generation with filters and CSV export.

## Sub-features

- `adm-stats` four tiles: 전체 비용, 전체 생성, 생성한 영상 길이, 모델 수.
- `adm-users` tab 사용자 · API 키 lists users with role, key state, counts, cost, last use, active state.
- `adm-user-edit` clicking a row opens card `<username> 편집` with the API key form, password form, role select, 활성화/비활성화, and 잠금 해제 when locked.
- `adm-user-create` card 사용자 추가 with ID, 비밀번호 (8+), optional key, role, memo.
- `adm-price` tab 모델 · 단가: per model a price spinbutton with 저장 (enabled only when changed) and an enable toggle (`사용 중 · 끄기` / `꺼짐 · 켜기`).
- `adm-logs` tab 로그 · 히스토리: filterable table of all generations with CSV export and a per-row detail.

## How to get to it (user POV)

- Header nav 어드민 (admins only).
- `/admin` directly; non-admins are redirected to `/dashboard`.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and reports `role: "admin"` for the credentials in use.
- At least one model row exists (seeded by `npm run db:seed`).

- **Open.** Sign in as admin; the header shows the ADMIN badge. Run `vgs run admin`; h1 어드민 is visible.
- **Users table.** Click tab 사용자 · API 키. A row containing the admin's username exists (`01-users`).
- **Edit card.** Click that row. Heading `<username> 편집` and the `key-id:key-secret` field appear (`02-user-edit`).
- **Price round-trip.** Click tab 모델 · 단가. Read the current prices from `/api/admin/models`, set the Hailuo row's spinbutton to current + 0.0001, click 저장. The API read-back returns the new value (`03-price-saved`). The journey then PATCHes the original value back, in `finally`.
- **Logs.** Click tab 로그 · 히스토리. The table or `조건에 맞는 기록이 없습니다.` renders with no HTTP error banner (`04-logs`, full page).
- **Proof.** `result.json` `ok: true`; `log.md` holds the `price round-trip … (persisted)` and `price restored` lines with HTTP status.

## Gotchas

- There is no user delete endpoint. This journey creates no users; the password and import journeys create members under their own prefixes and delete them from the database in `finally`. Bulk creation from `.xlsx`, nicknames and 초기 비밀번호로 되돌리기 are in [import.md](./import.md).
- The admin cannot change their own role or deactivate themselves (controls disabled on their own row).
- `저장` is disabled while the input equals the stored price, so the probe value must differ. The restore uses the API, not the UI, so a UI regression in the save button cannot leave the price changed.
- Toggling a model off hides it from everyone's playground immediately. The journey never toggles.
- Disabling the currently selected model in another tab leaves the playground on the next enabled one after reload.
