# Admin

Admin lets an administrator add users and assign each one a Higgsfield API key, change passwords, roles and active state, unlock locked accounts, set each model's base rate (USD per second of its reference format) and enabled state, and browse every generation with filters and CSV export. The users tab is the member table; editing a member, adding one and importing from Excel each open in a modal from that table.

## Sub-features

- `adm-stats` four tiles: 전체 비용, 전체 생성, 생성한 영상 길이, 모델 수.
- `adm-users` tab 사용자 · API 키 lists users with role, key state, counts, cost, last use, active state, under a header with buttons 엑셀로 회원 만들기 and 사용자 추가. Nothing else is open until a button or row is pressed.
- `adm-modal` every modal is a dialog named by its heading. Opening it moves focus inside, the page behind stops scrolling, and Esc, 닫기 or a click on the backdrop closes it and puts focus back on what opened it. Under 640px it fills the screen.
- `adm-user-edit` a row click, or Enter on the row's `<username> 편집` button, opens dialog `<username> 편집` with the nickname, API key and password forms, role select, 활성화/비활성화, and 잠금 해제 when locked. It stays open after each save and shows errors inside.
- `adm-user-create` button 사용자 추가 opens dialog 사용자 추가 with ID (focused), 임시 비밀번호 (8+), optional key, role, memo. 추가 closes it, reloads the table and says `<id> 계정을 추가했습니다`. Text typed and then closed is still there when it opens again.
- `adm-models` tab 모델 · 단가 lists exactly Seedance 2.0, MiniMax H3 and GPT Image 2 (rows left by earlier catalogs are never shown), one list item each. GPT Image 2's unit reads 이미지 출력 기준 100만 토큰당 USD, its fill is `OpenAI 정가 30로 채우기`, and its example is `예: 1024×1024 중간 품질 1장`.
- `adm-rate-meaning` each model says what its rate prices: `480p·16:9 기준 초당 USD` for Seedance, `2K 기준 초당 USD` for H3, with Higgsfield's published rates as buttons (`Higgsfield 표 · 30% 할인 $0.0985`, `정가 $0.1406`; `Higgsfield 표 · 50% 할인 $0.065`, `정가 $0.13`) that fill the field, and an example cost at the typed rate (`예: 10초 $0.65`).
- `adm-price` per model a rate spinbutton with 저장 (enabled only when changed) and an enable toggle (`사용 중 · 끄기` / `꺼짐 · 켜기`).
- `adm-logs` tab 로그 · 히스토리: filterable table of all generations with CSV export and a per-row detail.

## How to get to it (user POV)

- Header nav 어드민 (admins only).
- `/admin` directly; non-admins are redirected to `/dashboard`.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and reports `role: "admin"` for the credentials in use.
- At least one model row exists (seeded by `npm run db:seed`).

- **Open.** Sign in as admin; the header shows the ADMIN badge. Run `vgs run admin`; h1 어드민 is visible.
- **Users table.** Click tab 사용자 · API 키. The admin's row (by its exact `<username> 편집` button) and the two header buttons are there, and no 사용자 추가 or 엑셀로 회원 만들기 heading is open (`01-users`).
- **Scroll control.** With no modal open, a mouse wheel scrolls the page. When the page fits the viewport (few members), the journey shrinks the viewport height to 60% of the page for this and the next step and notes it.
- **Add modal.** Click 사용자 추가. Dialog 사용자 추가 opens with focus in ID, `html` has `overflow: hidden`, and a wheel over the backdrop (toward the side the page could move) leaves `scrollY` where it was (note). Type a draft ID (`02-modal-add`), press Esc: the dialog closes and focus is on 사용자 추가. Reopen: the draft is still there; clear it and close with a backdrop click (desktop) or 닫기 (mobile).
- **Import modal.** Click 엑셀로 회원 만들기. Dialog 엑셀로 회원 만들기 opens with focus inside and the example table (`03-modal-import`). 닫기 closes it and focus is on its button.
- **Edit modal.** Focus the admin's `<username> 편집` button and press Enter: dialog `<username> 편집` opens with focus inside; Esc closes it with focus back on the button. A row click opens it again with the `key-id:key-secret` field (`04-user-edit`). Nothing is saved.
- **Models and their units.** Click tab 모델 · 단가. `/api/admin/models` lists `bytedance/seedance-2.0` then `minimax/h3` and nothing else, and each list item shows its unit line.
- **Price round-trip.** Wait until every `/api/admin/models` load has finished and the MiniMax H3 item shows the stored rate. Click the published-rate button that differs from it (`Higgsfield 표 · 50% 할인 0.065로 채우기`, or `정가 0.13로 채우기` when 0.065 is stored); the field takes that value and the example line reads `예: 10초` at that rate. Click 저장 and poll `/api/admin/models` until it returns the new value (`05-price-saved`). The journey then PATCHes the original value back, in `finally`.
- **Logs.** Click tab 로그 · 히스토리. The table or `조건에 맞는 기록이 없습니다.` renders with no HTTP error banner (`06-logs`, full page).
- **Proof.** `result.json` `ok: true`; `log.md` holds the `adm-modal-*` and `adm-user-edit` notes, `adm-rate-meaning`, the `price round-trip … (persisted)` and `price restored` lines with HTTP status.

## Gotchas

- There is no user delete endpoint. This journey creates no users; it types a draft ID into 사용자 추가 and clears it without pressing 추가. The password and import journeys create members under their own prefixes and delete them from the database in `finally`. Bulk creation from `.xlsx`, nicknames and 초기 비밀번호로 되돌리기 are in [import.md](./import.md).
- Find the admin's row by the exact button name `<username> 편집`, not by row text: `hasText: "admin"` also matches every row whose role is admin.
- Playwright scrolls a button into view before clicking it, so the page is often not at the top when a modal opens. Compare `scrollY` with its value at opening, not with 0.
- Under 640px the sheet covers the page, so the wheel never reaches it; there the `overflow: hidden` check is what proves the lock.
- The admin cannot change their own role or deactivate themselves (controls disabled on their own row).
- `저장` is disabled while the input equals the stored rate, so the probe value must differ. The restore uses the API, not the UI, so a UI regression in the save button cannot leave the rate changed.
- A model with no stored row reads as rate 0 and enabled. The first save creates the row keyed by the model id (`minimax/h3`); restoring 0 leaves that row at 0, which reads the same.
- A rate change applies to requests made after it. Rows already submitted keep the cost decided when they were submitted.
- Under `next dev` the 모델 · 단가 panel loads twice on mount; a price typed before the second load lands is reset. The journey waits for both loads before typing.
- Toggling a model off hides it from everyone's playground immediately. The journey never toggles.
- Disabling the currently selected model in another tab leaves the playground on the next enabled one after reload.
