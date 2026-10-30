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

Data isolation: there is none. Every instance, including the developer's, shares the one Supabase database named in `.env.local`. Journeys therefore mutate only what they restore (admin price round-trip) or what is tagged disposable (`[목업]` mock rows). Three journeys create users, each under its own prefix. The password journey creates a `vgs-pw-*@example.test` member through the admin UI, the import journey creates 207 `vgs-imp-<stamp>-*@example.test` members from `.xlsx` fixtures, the settings journey creates two `vgs-set-*@example.test` members through the admin API, the teams journey creates two `vgs-team-<stamp>-*@example.test` members and `vgs-team-<stamp>-*` teams, and the locale journey creates two `vgs-loc-<stamp>-*@example.test` members; each deletes its own rows straight from the database in `finally` (there is no delete endpoint), and the settings journey first deletes its members' photos through the app. No other journey creates users or teams. Do not run two verification runs concurrently against the same account: the login journey's deliberate wrong password counts toward the 10-attempt / 15-minute lockout.

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

Pick the browser language with `VGS_LOCALE=en-US` or `VGS_LOCALE=zh-CN` (default `ko-KR`); it sets `navigator.language` and `Accept-Language` for every context.

Journeys (`journeys/*.mjs`): `login`, `locale`, `password`, `import`, `settings`, `teams`, `playground`, `threads`, `images`, `gallery`, `dashboard`, `admin`, `errors`, `formats`, `screens`. Each gets `{ page, context, ev, base, creds, env, webDir, local }` (`local` is `.env.local` parsed); `ev.login(to, p)` signs in through the real form, `ev.shot(label, { page })` captures PNG + ARIA snapshot, `ev.note()` logs, `ev.fail(reason)` aborts with the reason, `ev.api(path, init, p)` is a same-origin fetch with that page's session cookie for read-backs, and `ev.newPage(options)` opens a page in a fresh browser context (its own cookies, same viewport, `options` such as `{ locale: "en-US" }` override) for a second device, and `await ev.t(key, values, p)` returns a message from `src/messages/<lang>.json` in the language of `p`'s `<html lang>`, so a journey finds translated elements in any language. `p` defaults to the journey's page.

Stable handles this app exposes (prefer these over CSS or coordinates):

| Where | Handle |
|---|---|
| Login | `getByLabel("ID")`, `getByLabel(ev.t("auth.password"))`, button `ev.t("auth.signIn")` (exact), button `ev.t("auth.changePassword")`, `role=alert` for errors, whose text is `ev.t("errors.<code>", params)`, group `ev.t("language.label")` with buttons `한국어` / `English` / `简体中文` and `aria-pressed` on the current one |
| Password change | h1 `ev.t("auth.heading.change.title")` or `ev.t("auth.heading.temporary.title")` (temporary password), `getByLabel(ev.t("auth.currentPassword"))`, `getByLabel(ev.t("auth.newPassword")).first()` (the confirm label contains it), `getByLabel(ev.t("auth.confirmPassword"))`, button `ev.t("auth.changePassword")` (exact), button `ev.t("auth.backToSignIn")` |
| Header | link `<nickname or username> <ev.t("pages.settings")>` to `/settings` holding the photo `<img>` (or a letter) and the name text, `ADMIN` badge, button `ev.t("nav.logout")` (an icon under 640px, same name), nav `ev.t("nav.label")` links `ev.t("pages.playground" / "pages.gallery" / "pages.dashboard" / "pages.admin")`; every modal's close button is `ev.t("common.close")` |
| Settings | h1 `설정`, regions `프로필` / `계정` / `비밀번호`, buttons `사진 고르기` or `사진 바꾸기` (file chooser), img `새 프로필 사진 미리보기`, buttons `사진 저장` / `취소` / `사진 삭제`, `getByLabel(/^닉네임/)` + button `닉네임 저장`, `role=status` for results and for the no-Blob notice, region `계정` → the `dd` after `dt` ID (the ID as text) and after `dt` 팀 (team name or 미소속) |
| Playground | complementary `ev.t("playground.drawer")` (`aside#generation-settings`), region `ev.t("playground.stage")`, inside the drawer `getByLabel(ev.t("playground.prompt"))` and `getByLabel(ev.t("playground.model"))` (native select), list `ev.t("playground.modes")` whose `[aria-current="step"]` item reads `ev.t("mode.<mode>")`, checkbox `ev.t("playground.startFromImage")`, group `ev.t("playground.aspect.label")` with `aria-pressed` pills `ev.t("playground.aspect.pill", { shape, ratio })` (`shape` from `generation.shape`) or `ev.t("playground.aspect.auto")`, `getByLabel(ev.t("params.<key>"))` per parameter, button `ev.t("playground.refs.add")` (exact) → dialog `ev.t("playground.refs.add")` with `input[type=file]` per kind, list `ev.t("playground.refs.attached")` whose items hold one remove button each, `role=status` lines `ev.t("errors.noKey")` and the cost bar's reason, button `ev.t("playground.generate")` (exact, inside the drawer), rail glyphs inside the stage `ev.t("playground.rail.generate")` (exact; English and Chinese share the drawer button's name) / `playground.rail.cancel` / `generation.download` / `pages.gallery` / `playground.rail.reuse` (the counter under the generate glyph is the estimate) |
| Threads | from 1280px navigation `ev.t("threads.label")` left of the drawer with button `ev.t("threads.new")` (exact) and links named by the thread title (`ev.t("threads.earlier")` for the earlier history, `generation.noPrompt` for an empty first prompt; the current one has `aria-current="page"`), each row with a button `ev.t("threads.delete.label", { title })`, button `ev.t("threads.collapse")`; 1024-1279px a strip with buttons `ev.t("threads.expand")` and `ev.t("threads.new")`; under 1024px a bar above the stage with a button named `ev.t("threads.picker")` and the current title (`#thread-bar-title`) → dialog `ev.t("threads.label")` holding the same list, and button `ev.t("threads.new")`; dialog `ev.t("threads.delete.title")` with buttons `ev.t("threads.delete.cancel")` / `ev.t("threads.delete.confirm")`; on the stage `ev.t("threads.fresh.title")` (new thread) or `ev.t("threads.missing.title")` (a thread the member cannot see); the URL's `?thread=<id or earlier>` names the thread |
| Gallery | h1 `ev.t("pages.gallery")`, tile buttons named `ev.t("gallery.openDetail", { prompt })` (`generation.noPrompt` when empty), dialog `ev.t("gallery.detail.title")` with video `ev.t("generation.video")` or img `ev.t("generation.image")`, link `ev.t("generation.download")`, button `ev.t("common.close")`; admin links `ev.t("gallery.scope.mine")` / `ev.t("gallery.scope.all")`; an empty gallery shows `gallery.empty` with a link to `/playground` |
| Dashboard | h1 `ev.t("pages.dashboard")`, stat labels `ev.t("dashboard.stats.totalSpend" / "generations" / "videoLength" / "apiKey")`, card titles `ev.t("dashboard.daily")`, `ev.t("dashboard.byModel")`, `ev.t("dashboard.recent", { count: 20 })`; model rows read `ev.t("dashboard.modelUsage", { count, cost })` |
| Admin | h1 `어드민`, tab buttons `사용자 · API 키` / `팀` / `모델 · 단가` / `로그 · 히스토리`, user rows by username, each with a button `<username> 편집` (exact; the row click does the same) and a checkbox `<username> 선택`, header checkbox `보이는 사용자 모두 선택`, combobox `팀으로 거르기`, text `N명 선택`, button `팀 지정` → dialog `팀 지정` (combobox named `팀…`, region `고른 사용자`, button `N명 지정`); tab 팀: button `팀 만들기` → dialog `팀 만들기` (`getByLabel(/^팀 이름/)`, button `만들기`), team rows with a button `<팀 이름> 편집` → dialog `<팀 이름> 편집` (팀 이름 + `저장`, region `팀원`, button `팀 삭제` → group `팀 삭제` with `삭제`); every modal is a `dialog` named by its heading with a button `닫기`, and Esc closes it. Dialog `<username> 편집` with `getByLabel(/^닉네임/)` + the first button `저장`, combobox `getByRole("combobox", { name: /^팀/ })` (its name also carries the chosen team) that saves on change, placeholder `임시 비밀번호 (8자 이상)` + button `변경` (another member), button `초기 비밀번호로 되돌리기` → group `초기 비밀번호로 되돌리기` with button `되돌리기`, and text `임시 비밀번호 상태입니다`; table badge `임시 비밀번호` in 상태; button `엑셀로 회원 만들기` (exact) → dialog `엑셀로 회원 만들기` with table `엑셀 형식 예시`, `input[type=file]` inside label `엑셀 파일 고르기`, list `행별 결과` (one listitem per row, `N행` + badge), button `N명 만들기`, `role=status` `N명을 만들었습니다`, `role=alert` for file errors; button `사용자 추가` (exact) → dialog `사용자 추가` with `getByLabel("ID", { exact: true })` + `getByLabel("임시 비밀번호")` + button `추가`, then `role=status` `<id> 계정을 추가했습니다`; list `모델` with one item per model (name `Seedance 2.0` / `MiniMax H3`): unit line, rate `spinbutton` + `저장`, buttons `<label> <rate>로 채우기`, the `예:` example line, `사용 중 · 끄기` toggle |

Paid actions: `생성하기` with a real API key calls Higgsfield and costs money. The playground journey only clicks it when `VGS_ALLOW_SPEND=1`, or when `VGS_FAKE_HF` names the fake the app talks to, and then only after an upload came back from that fake; otherwise it proves the gate and stops. Reference uploads also hit Higgsfield storage when a key exists (free), and are refused without one; both outcomes are recorded as what they are.

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
