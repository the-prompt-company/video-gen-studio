# Dashboard

The dashboard shows a member their own usage: cumulative and 30-day cost, generation counts, total seconds, whether an API key is assigned, a daily cost chart, a per-model breakdown, and the 20 most recent generations with status. It reads in the page language. The member's ID and prompts stay as written.

## Sub-features

- `dash-stats` four stat tiles: `dashboard.stats.totalSpend` with `dashboard.stats.last30`, `dashboard.stats.generations` with `dashboard.stats.outcomes`, `dashboard.stats.videoLength` with the value `dashboard.seconds`, and `dashboard.stats.apiKey` reading `dashboard.stats.keyAssigned` or `dashboard.stats.keyMissing` (누적 비용, 생성 횟수, 생성한 영상 길이, API 키 in Korean).
- `dash-chart` card `dashboard.daily` (최근 30일 · 일별 비용) renders a bar chart whose hover tips read `dashboard.chartTip`, or `dashboard.noData` (`아직 데이터가 없습니다.`) when empty.
- `dash-models` card `dashboard.byModel` (모델별) lists `dashboard.modelUsage` (count and cost) per model with a share bar, or the empty copy.
- `dash-recent` card `dashboard.recent` (count 20) shows status badges for every status, not only completed, or `dashboard.noHistory`.

## How to get to it (user POV)

- Header nav `pages.dashboard` (대시보드).
- Non-admins who open `/admin` are redirected here.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- Optional: completed generations (real or `npm run db:mock`) so the chart and breakdown are populated rather than empty.

- **Open.** Sign in to `/dashboard`. Run `vgs run dashboard`; h1 `pages.dashboard` and the four stat labels, each found with `ev.t`, are visible.
- **Read key state.** The `dashboard.stats.apiKey` tile value (`dashboard.stats.keyAssigned` or `dashboard.stats.keyMissing`) is noted.
- **Cards.** Headings `dashboard.daily`, `dashboard.byModel` and `dashboard.recent` with count 20 exist; the note says whether the cards are populated or show `dashboard.noData`.
- **Cross-check.** `/api/generations?limit=50` is read with the page session; if it lists items while the `dashboard.stats.generations` value is 0, the journey fails (`01-dashboard`, full page).
- **Proof.** `result.json` `ok: true`; `01-dashboard.aria.txt` contains the stat labels and the three card headings in the page language.

## Gotchas

- Costs come from admin-entered prices × seconds. With prices at 0 every cost reads `$0.0000` even with completed rows; that is expected.
- Failed, cancelled, and NSFW rows count in `dashboard.stats.generations` but not in cost or seconds.
- The chart card is server-rendered from the last 30 days; mock rows older than that (the seeded set spans about two weeks) still appear in the generations count.
- The API cross-check lists the latest 50 rows; the generations stat is the all-time count, so compare only for "zero vs non-zero".
- The recent card's title is the query's limit, so it reads 20 even for a member with fewer generations.
