# Formats

Dates and times read in Seoul time in each language's short pattern (`26. 10. 29. 16:05`, `10/29/26, 16:05`, `2026/10/29 16:05`), relative times read `3분 전`, `3 minutes ago` or `3分钟前` and match between the server's HTML and the browser, and dollars read `$` with two or four places (`$0.2250`, `$12.50`, `$1234`) in every language.

## Sub-features

- `fmt-dashboard` the recent table's `dashboard.table.time` column uses the language's date pattern and its `dashboard.table.cost` column `$0.2250`; `dashboard.stats.totalSpend` reads `$…`.
- `fmt-gallery` a tile made three minutes ago reads the language's "3 minutes ago" and `$0.2250`; its `gallery.openDetail` button opens dialog `gallery.detail.title`, whose created and finished times (`gallery.detail.created`, `gallery.detail.completed`) use the date pattern.
- `fmt-playground` in the drawer `playground.drawer`, with GPT Image 2 picked in `playground.model` and a `playground.prompt` typed, the cost bar reads a `$0.xxxx` estimate.
- `fmt-admin` the users table's `members.table.cost` and `members.table.lastUsed`, and the `admin.tabs.logs` table's `logs.field.time` and `logs.field.cost`, use the same formats.
- `fmt-hydration` none of these pages logs a hydration warning or a page error.

## How to get to it (user POV)

- Header nav `pages.dashboard`, `pages.gallery`, `pages.playground`, and `pages.admin` (tabs `admin.tabs.users` and `admin.tabs.logs`).

## Driving it with vgs

Preconditions:

- A local database with `npm run db:mock` rows for the admin. The journey adds one `[목업]` row made three minutes ago and deletes it in `finally`.
- Run it as the admin, once per language and viewport: `VGS_LOCALE=zh-CN vgs run formats`. Launch the app with `TZ=UTC` so a date formatted without the Seoul time zone would show.

- **Each surface.** `vgs run formats` checks each value against the language's pattern and saves `dashboard`, `gallery-tiles`, `gallery-detail`, `playground-cost`, `admin-users` and `admin-logs` as `.impeccable/review/i18n-2/<surface>-<lang>-<viewport>.png`.
- **Proof.** `log.md` records the strings it read; the journey fails on any console message about hydration.

## Gotchas

- Relative times count from the time the page was rendered, so a tile reads the same text until the page loads again.
- Every run rewrites its review images under `.impeccable/review/i18n-2/`. When a run is not meant to refresh them, restore them with `git checkout -- .impeccable/review/i18n-2`.
