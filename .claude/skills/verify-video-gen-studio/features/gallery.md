# Gallery

The gallery shows completed videos and images as tiles that keep their real aspect ratio, opens a detail dialog with the playable video or the image, references, parameters and a download link, lets a member in a team switch between their own, their teammates' and both, and lets an admin switch between their own and every member's results. It reads in the page language. Prompts, nicknames and member IDs stay as written.

## Sub-features

- `gal-grid` tiles for completed generations with aspect (`16:9`, `9:16`, …) and duration badges, prompt, model, cost, age, and the retention line `gallery.retention.line` (`보관 3일 남음`, `Kept: 3 days left`), rose when it reads `gallery.retention.expired`.
- `gal-detail` clicking a tile opens dialog `gallery.detail.title` (`생성 상세`) with the video `generation.video` or the image `generation.image`, meta line (model · aspect with `generation.shape` · size · duration · cost · status), prompt, references under `gallery.detail.refs`, and parameters named by `params.<key>` in the page language.
- `gal-download` link `generation.download` (`다운로드`) points at the same URL the media plays from.
- `gal-close` Esc or `common.close` (`닫기`) closes the dialog.
- `gal-scope` admins see `gallery.scope.mine` / `gallery.scope.everyone` (`내 것` / `전체`, `?scope=everyone`); everyone lists every member's completed results, each tile with the member's ID.
- `gal-team` a member in a team sees `gallery.scope.mine` / `gallery.scope.team` / `gallery.scope.all` (`내 것` / `팀` / `전체`, `?scope=team` and `?scope=all`) inside navigation `gallery.scope.label`. 팀 lists current teammates' rows without the member's own, 전체 lists both. A teammate's tile and detail show the nickname, or `gallery.owner.teammate` without one, and the member's own rows under 전체 show `gallery.owner.self`. An empty 팀 shows `gallery.emptyTeam`.
- `gal-no-team` a member without a team gets no switch and the line `gallery.scope.noTeam`; `?scope=team` or `?scope=all` shows their own rows.
- `gal-access` a teammate may read a finished row (`GET /api/generations/<id>` 200) and download it, but `DELETE` answers 403 `notYourGeneration`, a teammate's unfinished row and every row of another team or of a member without a team answer 404 `noSuchGeneration`, and the poll `?ids=` returns none of them.
- `gal-empty` with no completed results the page shows `gallery.empty`, whose link part opens the playground.

## How to get to it (user POV)

- Header nav `pages.gallery` (갤러리).
- The gallery link in the playground's stream header or thread bar (its count is the completed count).
- `/gallery?scope=team` or `/gallery?scope=all` as a member in a team, `/gallery?scope=everyone` as an admin. A filter the viewer is not offered shows their own rows.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- The account has at least one completed generation. Without a Higgsfield key, run `npm run db:mock` first (seeds `[목업]` rows with landscape, portrait, square and 21:9 results for the admin account).
- For `gal-scope`, sign in as an admin.

- **Open grid.** Sign in to `/gallery`. Run `vgs run gallery`; `01-grid` shows h1 `pages.gallery` and tiles named `gallery.openDetail` with the prompt (`<prompt> 자세히 보기`, `View details: <prompt>`). The journey matches tiles with a RegExp built from that message, so it passes in every `VGS_LOCALE`. Zero tiles is reported as an unmet precondition, not a pass.
- **Open detail.** Click the first tile. Dialog `gallery.detail.title` appears; the video `generation.video` (or the image `generation.image` for an image model) has a `src`, loads, and its pixel size is noted.
- **Check download.** Link `generation.download` is visible and its `href` is the media `src`, or the `src` with `?download=` (`02-detail`).
- **Close.** Press Escape. The dialog is gone.
- **Admin scope.** If link `gallery.scope.everyone` exists, click it; URL becomes `/gallery?scope=everyone` and the tile count is at least the `gallery.scope.mine` count (`03-everyone-scope`).
- **Team filters.** Run `vgs run team-gallery` as an admin against a local database (it refuses any other). It creates team A with two members, team B with one, and a member without a team, each with distinct completed rows, then checks every filter's exact rows, the nickname labels, no login ID in any member page, a teammate's detail and download, the refusals in `gal-access`, crafted `?scope=` values, the admin's 내 것 / 전체, and a member moved to team B taking their rows along. It saves `.impeccable/review/team-2/<surface>-<lang>-<viewport>.png` for `gallery-mine`, `gallery-team`, `gallery-all`, `teammate-detail`, `gallery-teamless` and `admin-everyone`, and deletes its members, teams and rows in `finally`.
- **Proof.** `result.json` `ok: true`; `02-detail.aria.txt` includes the dialog name, the download link, and the parameter labels in the page language (길이(초) and 해상도 in Korean, Duration (s) and Resolution in English).

## Gotchas

- Only `status = completed` rows appear. Queued, failed, cancelled, and NSFW-rejected rows live on the dashboard's recent list and the admin logs instead.
- Mock results are local `.webm` files under `/mock/`; real results are Higgsfield URLs that expire after 7 days (`gallery.retention.days`, `보관 N일 남음`), so a real tile can stop playing after expiry.
- Time left counts from the page's render time, not from when the dialog opens. Reload before comparing a countdown with the clock.
- Tiles autoplay on hover only; do not wait for playback to assert the grid.
- The detail video is `object-contain`, so a 9:16 result is pillarboxed inside the 58dvh frame: that is the designed behavior.
- Remove seeded rows afterwards with `npm run db:mock -- --clear` when they should not linger for the team; the proof artifacts remain.
