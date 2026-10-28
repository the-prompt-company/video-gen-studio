# Dashboard

The dashboard shows a member their own usage: cumulative and 30-day cost, generation counts, total seconds, whether an API key is assigned, a daily cost chart, a per-model breakdown, and the 20 most recent generations with status.

## Sub-features

- `dash-stats` four stat tiles: 누적 비용 (with 최근 30일), 생성 횟수 (완료 · 실패), 생성한 영상 길이, API 키 (할당됨 / 미할당).
- `dash-chart` card 최근 30일 · 일별 비용 renders a bar chart, or `아직 데이터가 없습니다.` when empty.
- `dash-models` card 모델별 lists count and cost per model with a share bar, or the empty copy.
- `dash-recent` the recent list shows status badges for every status, not only completed.

## How to get to it (user POV)

- Header nav 대시보드.
- Non-admins who open `/admin` are redirected here.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- Optional: completed generations (real or `npm run db:mock`) so the chart and breakdown are populated rather than empty.

- **Open.** Sign in to `/dashboard`. Run `vgs run dashboard`; h1 대시보드 and the four stat labels are visible.
- **Read key state.** The API 키 tile value (`할당됨` or `미할당`) is noted.
- **Cards.** Headings 최근 30일 · 일별 비용 and 모델별 exist; the note says whether they are populated or in the empty state.
- **Cross-check.** `/api/generations?limit=50` is read with the page session; if it lists items while 생성 횟수 shows 0, the journey fails (`01-dashboard`, full page).
- **Proof.** `result.json` `ok: true`; `01-dashboard.aria.txt` contains the stat labels and both card headings.

## Gotchas

- Costs come from admin-entered prices × seconds. With prices at 0 every cost reads `$0.00` even with completed rows; that is expected.
- Failed, cancelled, and NSFW rows count in 생성 횟수 but not in cost or seconds.
- The chart card is server-rendered from the last 30 days; mock rows older than that (the seeded set spans about two weeks) still appear in 생성 횟수.
- The API cross-check lists the latest 50 rows; 생성 횟수 is the all-time count, so compare only for "zero vs non-zero".
