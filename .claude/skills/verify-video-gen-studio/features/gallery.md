# Gallery

The gallery shows a member's completed videos as tiles that keep their real aspect ratio, opens a detail dialog with the playable video, references, parameters and a download link, and lets an admin switch between their own and everyone's videos.

## Sub-features

- `gal-grid` tiles for completed generations with aspect (`16:9`, `9:16`, …) and duration badges, prompt, model, cost, age, and retention countdown.
- `gal-detail` clicking a tile opens dialog 생성 상세 with the video, meta line (model · aspect · size · duration · cost · status), prompt, references, and parameters in Korean labels.
- `gal-download` the 다운로드 link points at the same URL the video plays from.
- `gal-close` Esc or 닫기 closes the dialog.
- `gal-scope` admins see 내 것 / 전체; 전체 lists every user's completed videos.
- `gal-empty` with no completed videos the page shows the empty copy with a link to the playground.

## How to get to it (user POV)

- Header nav 갤러리.
- The 갤러리 glyph on the playground rail (its counter is the completed count).
- `/gallery?all=1` as an admin for the team-wide view.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- The account has at least one completed generation. Without a Higgsfield key, run `npm run db:mock` first (seeds `[목업]` rows with landscape, portrait, square and 21:9 results for the admin account).
- For `gal-scope`, sign in as an admin.

- **Open grid.** Sign in to `/gallery`. Run `vgs run gallery`; `01-grid` shows h1 갤러리 and tiles named `<prompt> 자세히 보기`. Zero tiles is reported as an unmet precondition, not a pass.
- **Open detail.** Click the first tile. Dialog 생성 상세 appears; the video 생성된 영상 has a `src`, loads metadata, and its pixel size is noted.
- **Check download.** Link 다운로드 is visible and its `href` equals the video `src` (`02-detail`).
- **Close.** Press Escape. The dialog is gone.
- **Admin scope.** If link 전체 exists, click it; URL becomes `/gallery?all=1` and the tile count is at least the 내 것 count (`03-all-scope`).
- **Proof.** `result.json` `ok: true`; `02-detail.aria.txt` includes 생성 상세, 다운로드, and the parameter labels (길이(초), 해상도 or 프롬프트 자동 보정).

## Gotchas

- Only `status = completed` rows appear. Queued, failed, cancelled, and NSFW-rejected rows live on the dashboard's recent list and the admin logs instead.
- Mock results are local `.webm` files under `/mock/`; real results are Higgsfield URLs that expire after 7 days (`보관 N일 남음`), so a real tile can stop playing after expiry.
- Tiles autoplay on hover only; do not wait for playback to assert the grid.
- The detail video is `object-contain`, so a 9:16 result is pillarboxed inside the 58dvh frame: that is the designed behavior.
- Remove seeded rows afterwards with `npm run db:mock -- --clear` when they should not linger for the team; the proof artifacts remain.
