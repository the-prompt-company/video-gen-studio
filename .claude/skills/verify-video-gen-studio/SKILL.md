---
name: verify-video-gen-studio
description: "Drive Video Gen Studio (the Next.js web app in web/) through a real browser the way a team member does — sign in, use the playground drawer, open gallery details, read the dashboard, edit admin settings — and keep screenshots, ARIA snapshots and API read-backs as proof. Use after any change to web/ UI, routes, auth, or the model catalog, or whenever you must prove a behavior works rather than assume it from code."
---

# Verify Video Gen Studio

The app is a Korean-UI Next.js 16 site on Supabase Postgres. The user touches one surface: the **web UI** at `/login`, `/playground`, `/gallery`, `/dashboard`, `/admin`. JSON routes under `/api/*` exist only for that UI and are used here as side-effect read-backs, never as a substitute for the user path. Read `features/README.md` before driving; each feature file there is the recipe.

All commands run from `web/` (the folder with `package.json`). `vgs` below means:

```
node .claude/skills/verify-video-gen-studio/vgs.mjs
```

## Launch

One-time per checkout: install the harness (Playwright is **not** an app dependency; it lives in this skill folder, gitignored). The matching Chromium is usually already in `~/AppData/Local/ms-playwright`; if `run` complains about a missing browser, run the second line.

```
npm install --prefix .claude/skills/verify-video-gen-studio
node .claude/skills/verify-video-gen-studio/node_modules/playwright/cli.js install chromium
```

The error `Executable doesn't exist at …ms-playwright\chromium…` from `run` means the second line was skipped; it downloads the exact build the pinned Playwright expects. Alternatively point `VGS_CHROME` at a Chromium/Chrome executable you already have.

Preconditions the launcher checks and refuses without:

- `web/.env.local` with `DATABASE_URL` (Supabase transaction pooler), `AUTH_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`. Migrations and the admin row come from `npm run db:migrate && npm run db:seed` (README → 로컬 실행). The seed is idempotent.
- Port **3100** free (override `VGS_PORT`). The developer's own `npm run dev` on 3000 is never touched.

```
vgs launch
```

Starts `next dev -p 3100` detached with `NEXT_DIST_DIR=.next-verify` (Next 16 locks one dev server per `distDir`, so this is what lets the developer's own server on 3000 keep running; `next.config.ts` reads that variable), records `{pid, port, log, commit}` in `.verify/run/server.json`, and waits until **usable**, which means `GET /login` is 200 *and* `POST /api/auth/login` accepts the verification credentials. A 200 on `/login` alone proves nothing about the DB; the login probe does. Turbopack compiles each route on first hit, so the first journey is slower than later ones.

Credentials: `VGS_USER` / `VGS_PASS`, defaulting to `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env.local`. Use an **admin** for the admin and gallery-scope journeys. Never paste credentials into chat or into evidence.

Data isolation: there is none. Every instance, including the developer's, shares the one Supabase database named in `.env.local`. Journeys therefore mutate only what they restore (admin price round-trip) or what is tagged disposable (`[목업]` mock rows). Two journeys create users. The password journey creates a `vgs-pw-*@example.test` member through the admin UI, and the settings journey creates two `vgs-set-*@example.test` members through the admin API; each deletes its own rows straight from the database in `finally` (there is no delete endpoint), and the settings journey first deletes its members' photos through the app. No other journey creates users. Do not run two verification runs concurrently against the same account: the login journey's deliberate wrong password counts toward the 10-attempt / 15-minute lockout.

## Doctor

```
vgs doctor
```

Read-only. Prints JSON and exits 0 only when: `server.json` exists (we started it), the pid is alive, `GET /login` is 200, and the login API accepts the credentials (reports the role). It also reports the Next version and whether `HEAD` moved since launch. If anything looks off during a run, run this first; if it fails, `vgs stop` then `vgs launch`.

## Drive

```
vgs run <journey>            # desktop 1440×900
VGS_MOBILE=1 vgs run <journey>   # 390×844 touch viewport, evidence folder gets a -mobile suffix
```

Journeys (`journeys/*.mjs`): `login`, `password`, `settings`, `playground`, `gallery`, `dashboard`, `admin`. Each gets `{ page, context, ev, base, creds, env, webDir, local }` (`local` is `.env.local` parsed); `ev.login(to, p)` signs in through the real form, `ev.shot(label, { page })` captures PNG + ARIA snapshot, `ev.note()` logs, `ev.fail(reason)` aborts with the reason, `ev.api(path, init, p)` is a same-origin fetch with that page's session cookie for read-backs, and `ev.newPage()` opens a page in a fresh browser context (its own cookies, same viewport) for a second device. `p` defaults to the journey's page.

Stable handles this app exposes (prefer these over CSS or coordinates):

| Where | Handle |
|---|---|
| Login | `getByLabel("ID")`, `getByLabel("비밀번호")`, button `로그인` (exact), button `비밀번호 변경`, `role=alert` for errors |
| Password change | h1 `비밀번호 변경` or `새 비밀번호 정하기` (temporary password), `getByLabel("현재 비밀번호")`, `getByLabel(/^새 비밀번호(?! 확인)/)`, `getByLabel("새 비밀번호 확인")`, button `비밀번호 변경` (exact), button `로그인으로 돌아가기` |
| Header | link `<nickname or username> 설정` to `/settings` holding the photo `<img>` (or a letter) and the name text, `ADMIN` badge, button `로그아웃` (an icon under 640px, same name), nav `주 메뉴` links 플레이그라운드/갤러리/대시보드/어드민 |
| Settings | h1 `설정`, regions `프로필` / `계정` / `비밀번호`, buttons `사진 고르기` or `사진 바꾸기` (file chooser), img `새 프로필 사진 미리보기`, buttons `사진 저장` / `취소` / `사진 삭제`, `getByLabel(/^닉네임/)` + button `닉네임 저장`, `role=status` for results and for the no-Blob notice, region `계정` → the ID as text in its `dd` |
| Playground | `aside[aria-label="생성 설정"]` (role complementary), `section[aria-label="결과 무대"]` (region), `getByLabel("프롬프트")`, `getByLabel("모델")` (native select), group `출력 화면비` with `aria-pressed` pills, `getByLabel("길이(초)")`, button `레퍼런스 추가` → dialog `레퍼런스 추가` with `input[type=file]` per kind, list `첨부한 레퍼런스`, `role=status` no-API-key banner, button `생성하기`, rail glyphs 생성/취소/다운로드/갤러리/다시 |
| Gallery | h1 `갤러리`, tile buttons named `<prompt> 자세히 보기`, dialog `생성 상세` with video `생성된 영상`, link `다운로드`, button `닫기`; admin links `내 것` / `전체` |
| Dashboard | h1 `대시보드`, stat labels 누적 비용 / 생성 횟수 / 생성한 영상 길이 / API 키, cards `최근 30일 · 일별 비용`, `모델별` |
| Admin | h1 `어드민`, tab buttons `사용자 · API 키` / `모델 · 단가` / `로그 · 히스토리`, user rows by username, edit card h2 `<username> 편집` with placeholder `임시 비밀번호 (8자 이상)` + button `변경` (another member) and text `임시 비밀번호 상태입니다`, 사용자 추가 form `getByLabel("ID", { exact: true })` + `getByLabel("임시 비밀번호")` + button `추가`, price `spinbutton` + `저장` per model row, `사용 중 · 끄기` toggle |

Paid actions: `생성하기` with a real API key calls Higgsfield and costs money. The playground journey only clicks it when `VGS_ALLOW_SPEND=1`; otherwise it proves the gate and stops. Reference uploads also hit Higgsfield storage when a key exists (free), and are refused without one; both outcomes are recorded as what they are.

## Evidence

Every run writes `.verify/evidence/<run-id>/<journey>[-mobile]/`:

- `NN-<label>.png` and `NN-<label>.aria.txt`: the state after each user action, in order.
- `log.md`: one line per step/note, base URL, user, commit, viewport.
- `console.txt`: browser console errors and page errors during the journey.
- `result.json`: `ok`, steps, error, timing, commit, Next version. `99-failure.png` on failure.

Proof standard: the journey walks the real user path (form, select, dialog, Esc), captures the action *and* the resulting state, and checks the side effect through a second view (API read-back, reload, or another page) rather than trusting the UI alone. Nothing is mocked: the dev server talks to the real Supabase and, where a key exists, to Higgsfield. When a journey reports `FAIL` with an unmet precondition (no completed generations, not an admin), that is a reported skip, not a pass through another path.

Gallery and dashboard need completed generations. Without a Higgsfield key, seed disposable ones: `npm run db:mock` (rows prefixed `[목업]` for `MOCK_USERNAME`, default the admin), remove with `npm run db:mock -- --clear`. They never call Higgsfield.

## Cleanup

```
vgs stop
```

Kills **only** the pid recorded in `server.json` (process tree on Windows via `taskkill /T`, process group elsewhere), then deletes `server.json`. It never kills by process name, so the developer's server on 3000 survives. The compile cache in `.next-verify/` stays (gitignored, makes the next launch faster); delete it only if a build looks stale. `next dev` also appends `.next-verify/types/**` to `tsconfig.json` `include` on first launch; that edit is committed, so a later launch leaves the tree clean. Evidence under `.verify/evidence/` is never removed; `.verify/` is gitignored, so copy anything worth keeping into `.impeccable/review/` or a PR. If you seeded mock rows for a run and they are not wanted, `npm run db:mock -- --clear`. Run `vgs stop` after a failed iteration too, so ports and processes are not stranded.

## Helpers

| File | Role |
|---|---|
| `vgs.mjs` | the CLI (`launch`, `doctor`, `run`, `stop`); plain Node 24 ESM, no build step |
| `journeys/*.mjs` | one driver per feature; add one when the feature map grows |
| `features/` | the maintained feature map (what to verify, from the user's point of view) |
| `package.json` | pins Playwright for the harness only |

Keep `features/` honest with `/pstack:maintain-verification-skill` after UI changes.
