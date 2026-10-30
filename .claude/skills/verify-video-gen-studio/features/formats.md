# Formats

Dates and times read in Seoul time in each language's short pattern (`26. 10. 29. 16:05`, `10/29/26, 16:05`, `2026/10/29 16:05`), relative times read `3분 전`, `3 minutes ago` or `3分钟前` and match between the server's HTML and the browser, and dollars read `$` with two or four places (`$0.2250`, `$12.50`, `$1234`) in every language.

## Sub-features

- `fmt-dashboard` the recent table's 시각 column uses the language's date pattern and its 비용 column `$0.2250`; 누적 비용 reads `$…`.
- `fmt-gallery` a tile made three minutes ago reads the language's "3 minutes ago" and `$0.2250`; the detail's 생성 and 완료 use the date pattern.
- `fmt-playground` the cost bar reads a `$0.xxxx` estimate.
- `fmt-admin` the users table's cost and last-used date, and the logs table's 시각 and 비용, use the same formats.
- `fmt-hydration` none of these pages logs a hydration warning or a page error.

## How to get to it (user POV)

- Header nav 대시보드, 갤러리, 플레이그라운드, and 어드민 (users and 로그 · 히스토리 tabs).

## Driving it with vgs

Preconditions:

- A local database with `npm run db:mock` rows for the admin. The journey adds one `[목업]` row made three minutes ago and deletes it in `finally`.
- Run it as the admin, once per language and viewport: `VGS_LOCALE=zh-CN vgs run formats`. Launch the app with `TZ=UTC` so a date formatted without the Seoul time zone would show.

- **Each surface.** `vgs run formats` checks each value against the language's pattern and saves `dashboard`, `gallery-tiles`, `gallery-detail`, `playground-cost`, `admin-users` and `admin-logs` as `.impeccable/review/i18n-2/<surface>-<lang>-<viewport>.png`.
- **Proof.** `log.md` records the strings it read; the journey fails on any console message about hydration.

## Gotchas

- Relative times count from the time the page was rendered, so a tile reads the same text until the page loads again.
- The gallery's 보관 line ("N일 남음") is still the gallery's own Korean text until the gallery's i18n PR.
