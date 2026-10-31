---
name: verify-video-gen-studio
description: "Drive Video Gen Studio (the Next.js web app in web/) through a real browser the way a team member does — sign in, generate from the playground composer, open gallery details, read the dashboard, edit admin settings — and keep screenshots, ARIA snapshots and API read-backs as proof. Use after any change to web/ UI, routes, auth, or the model catalog, or whenever you must prove a behavior works rather than assume it from code."
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

Data isolation: there is none. Every instance, including the developer's, shares the one Supabase database named in `.env.local`. Journeys therefore mutate only what they restore (admin price round-trip) or what is tagged disposable (`[목업]` mock rows). Three journeys create users, each under its own prefix. The password journey creates a `vgs-pw-*@example.test` member through the admin UI, the reuse journey (local database only) creates two `vgs-reuse-<stamp>*@example.test` members and their rows, the import journey creates 207 `vgs-imp-<stamp>-*@example.test` members from `.xlsx` fixtures, the settings journey creates two `vgs-set-*@example.test` members through the admin API, the teams journey creates two `vgs-team-<stamp>-*@example.test` members and `vgs-team-<stamp>-*` teams, the locale journey creates two `vgs-loc-<stamp>-*@example.test` members, and the team-gallery journey (local database only) creates four `vgs-tg-<stamp>-*@example.test` members, two `vgs-tg-<stamp>-*` teams and their generation rows; each deletes its own rows straight from the database in `finally` (there is no delete endpoint), and the settings journey first deletes its members' photos through the app. No other journey creates users or teams. Do not run two verification runs concurrently against the same account: the login journey's deliberate wrong password counts toward the 10-attempt / 15-minute lockout.

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

Journeys (`journeys/*.mjs`): `login`, `locale`, `password`, `import`, `settings`, `teams`, `playground`, `composer`, `reuse`, `threads`, `images`, `gallery`, `team-gallery`, `dashboard`, `admin`, `errors`, `formats`, `screens`. Each gets `{ page, context, ev, base, creds, env, webDir, local }` (`local` is `.env.local` parsed); `ev.login(to, p)` signs in through the real form, `ev.shot(label, { page })` captures PNG + ARIA snapshot, `ev.note()` logs, `ev.fail(reason)` aborts with the reason, `ev.api(path, init, p)` is a same-origin fetch with that page's session cookie for read-backs, and `ev.newPage(options)` opens a page in a fresh browser context (its own cookies, same viewport, `options` such as `{ locale: "en-US" }` override) for a second device, and `await ev.t(key, values, p)` returns a message from `src/messages/<lang>.json` in the language of `p`'s `<html lang>`, so a journey finds translated elements in any language. `p` defaults to the journey's page.

Stable handles this app exposes (prefer these over CSS or coordinates):

| Where | Handle |
|---|---|
| Login | `getByLabel("ID")`, `getByLabel(ev.t("auth.password"))`, button `ev.t("auth.signIn")` (exact), button `ev.t("auth.changePassword")`, `role=alert` for errors, whose text is `ev.t("errors.<code>", params)`, group `ev.t("language.label")` with buttons `한국어` / `English` / `简体中文` and `aria-pressed` on the current one |
| Password change | h1 `ev.t("auth.heading.change.title")` or `ev.t("auth.heading.temporary.title")` (temporary password), `getByLabel(ev.t("auth.currentPassword"))`, `getByLabel(ev.t("auth.newPassword")).first()` (the confirm label contains it), `getByLabel(ev.t("auth.confirmPassword"))`, button `ev.t("auth.changePassword")` (exact), button `ev.t("auth.backToSignIn")` |
| Header | link `<nickname or username> <ev.t("pages.settings")>` to `/settings` holding the photo `<img>` (or a letter) and the name text, `ADMIN` badge, button `ev.t("nav.logout")` (an icon under 640px, same name), nav `ev.t("nav.label")` links `ev.t("pages.playground" / "pages.gallery" / "pages.dashboard" / "pages.admin")`; every modal's close button is `ev.t("common.close")` |
| Settings | h1 `ev.t("pages.settings")`, regions `ev.t("settings.profile.title" / "settings.account.title" / "language.label" / "settings.password.title")`, buttons `ev.t("profile.photo.choose")` or `profile.photo.change` (file chooser), img `ev.t("profile.avatar.preview")`, buttons `profile.photo.save` / `common.cancel` / `profile.photo.remove`, `getByLabel` of a RegExp that starts with `ev.t("profile.nickname.label")` (the counter follows it) + button `profile.nickname.save`, `role=status` for results (`profile.done.*`) and for the no-Blob notice `profile.photo.storageOff`, region `settings.account.title` → the `dd` after `dt` ID (the ID as text) and after `dt` `settings.account.team` (the team name, never translated, or `teams.none`) |
| Playground | region `ev.t("playground.composer")` (the composer) and region `ev.t("playground.stream")` (the turns, `article[data-id]`, oldest first); `composer-handles.mjs` wraps them. In the composer: `getByLabel(ev.t("playground.prompt"))`, the model chip named `ev.t("playground.modelMenu")` + ` · <model>` → dialog `ev.t("playground.modelMenu")` with group `ev.t("playground.outputs")` (tabs `ev.t("playground.output", { output })`) and model rows `<name> · <vendor>` (`aria-pressed`) whose lines read `ev.t("playground.takes", …)` and the rate, with no row naming a mode; the line under the thumbnails names the mode the attachments make as the exact text `ev.t("mode.<mode>")` (no line with nothing attached); the settings chip named `ev.t("playground.settings.open", { summary })` → dialog `ev.t("playground.settings.title")` with pill groups named by `ev.t("params.<key>")` or `ev.t("playground.aspect.label")`, a slider and `role=switch` toggles; button `ev.t("playground.refs.add")` (exact, +) → dialog of the same name with rows `ev.t("playground.refs.uploadImages")` / `uploadVideos` (file chooser); hidden `input[type=file][accept^="image/"]` and `[accept="video/mp4"]`; list `ev.t("playground.refs.attached")` with one item per attachment: on a model that takes frames an image is a button named `ev.t("playground.frames.open", { tag, name, role })` (role `none`, `start`, `end` or `both`) → dialog `ev.t("playground.frames.title", { tag })` with rows whose names start with `ev.t("playground.frames.role", { role })`, each item's last button is remove `ev.t("playground.refs.removeLabel", { kind, tag, name })`, and an attachment the frames leave out is described by `ev.t("playground.frames.left")`; files dropped on the composer or pasted into the prompt land as references (`composer-handles.mjs` `dropFiles`, `pasteFiles`, `markFrame`, `frameOf`, `mode`); `role=status` lines for `errors.noKey` and the reason the plan is blocked; the note line (`playground.note.unmarked`, `note.reused`, `note.spent`); the estimate after the text `ev.t("playground.cost.label")`; button `ev.t("playground.generate")` (exact). In each turn: `role=progressbar` `ev.t("playground.feed.progress")` while live, `ev.t("playground.actions.cancel")`, link `ev.t("generation.download")` + format, `ev.t("playground.actions.attach")` (exact; only while the result can be a reference), `ev.t("playground.actions.reuse")`, and list `ev.t("playground.feed.refsLabel", { images, videos })` of reference thumbnails; "@" typed in the prompt opens listbox `ev.t("playground.picker.label")` with groups `playground.picker.thread` / `playground.picker.recent`, `role=option` rows (the active one is the prompt's `aria-activedescendant`), a `role=status` line under the listbox (`playground.picker.loading` while it loads, `playground.picker.noMatch` with `{ query }` or `playground.picker.empty` when nothing matches), and the note `playground.picker.hidden`; above the turns `ev.t("playground.older.load")` / `older.loading` / `older.start`, and `ev.t("playground.latest")` |
| Threads | from 1280px navigation `ev.t("threads.label")` left of the stream with button `ev.t("threads.new")` (exact) and links named by the thread title (`ev.t("threads.earlier")` for the earlier history, `generation.noPrompt` for an empty first prompt; the current one has `aria-current="page"`), each row with a button `ev.t("threads.delete.label", { title })`, button `ev.t("threads.collapse")`; 1024-1279px a strip with buttons `ev.t("threads.expand")` and `ev.t("threads.new")`; under 1024px a bar above the stream with a button named `ev.t("threads.picker")` and the current title (`#thread-bar-title`) → dialog `ev.t("threads.label")` holding the same list, the gallery link, and button `ev.t("threads.new")`; dialog `ev.t("threads.delete.title")` with buttons `ev.t("threads.delete.cancel")` / `ev.t("threads.delete.confirm")`; in the stream `ev.t("threads.fresh.title")` (new thread) or `ev.t("threads.missing.title")` (a thread the member cannot see); the URL's `?thread=<id or earlier>` names the thread; the gallery link is named `ev.t("playground.galleryCount", { count })` |
| Gallery | h1 `ev.t("pages.gallery")`, tile buttons named `ev.t("gallery.openDetail", { prompt })` (`generation.noPrompt` when empty), dialog `ev.t("gallery.detail.title")` with video `ev.t("generation.video")` or img `ev.t("generation.image")`, link `ev.t("generation.download")`, button `ev.t("common.close")`; navigation `ev.t("gallery.scope.label")` holding the filter links, each `aria-current="page"` when chosen: a member in a team gets `gallery.scope.mine` (`/gallery`), `gallery.scope.team` (`?scope=team`) and `gallery.scope.all` (`?scope=all`), an admin gets `gallery.scope.mine` and `gallery.scope.everyone` (`?scope=everyone`), and a member without a team gets no navigation and the line `gallery.scope.noTeam`; a member sees a teammate's nickname, `gallery.owner.teammate` without one, and `gallery.owner.self` on their own rows under 전체, never an ID; an empty gallery shows `gallery.empty` with a link to `/playground`, and an empty 팀 view shows `gallery.emptyTeam` |
| Dashboard | h1 `ev.t("pages.dashboard")`, stat labels `ev.t("dashboard.stats.totalSpend" / "generations" / "videoLength" / "apiKey")`, card titles `ev.t("dashboard.daily")`, `ev.t("dashboard.byModel")`, `ev.t("dashboard.recent", { count: 20 })`; model rows read `ev.t("dashboard.modelUsage", { count, cost })` |
| Admin | h1 `ev.t("pages.admin")`, tab buttons `ev.t("admin.tabs.users" / "teams" / "models" / "logs")` (exact), user rows by username, each with a button `ev.t("members.edit", { username })` (exact; the row click does the same) and a checkbox `members.select` (`{ username }`), header checkbox `members.selectAll`, combobox `members.filter.label`, text `members.selected` (`{ count }`), button `members.assign.title` → dialog `members.assign.title` (a combobox whose label starts with `members.field.team`, region `members.assign.chosenLabel`, button `members.assign.submit` with the count); tab teams: button `teams.create.title` → dialog `teams.create.title` (a field whose label starts with `teams.name.label`, button `teams.create.submit`), team rows with a button `teams.edit` (`{ name }`) → dialog `teams.edit` (`teams.name.label` + `common.save`, region `teams.members.label`, button `teams.delete.title` → group `teams.delete.title` with `teams.delete.submit`); every modal is a `dialog` named by its heading with a button `common.close`, and Esc closes it. Dialog `members.edit` with a field whose label starts with `members.field.nickname` + the first button `common.save`, a combobox whose name starts with `members.field.team` (its name also carries the chosen team) that saves on change, placeholder `members.password.temporary` (`{ min: 8 }`) + button `members.password.change` (another member), button `members.reset.title` → group `members.reset.title` (its text names `oooooooo`) with button `members.reset.confirm`, and text `members.editor.temporaryNote`; table badge `members.temporary` in the status column; button `ev.t("import.title")` (exact) → dialog `import.title` with table `import.example.label`, `input[type=file]` inside label `import.pick.first`, list `import.rows` (one listitem per row, `import.row` + badge `import.outcome.*`), button `import.submit` with the count, `role=status` `import.done` with the count, `role=alert` for file errors (`import.failure.*`, `errors.importTooMany`); button `members.add.title` (exact) → dialog `members.add.title` with `getByLabel("ID", { exact: true })` + `getByLabel(ev.t("members.add.password"))` + button `members.add.submit`, then `role=status` `members.notice.added` (`{ id }`); list `models.list` with one item per model (name `Seedance 2.0` / `MiniMax H3` / `GPT Image 2`, never translated): unit line `models.unit`, rate `spinbutton` + `common.save`, buttons `models.fill` (`{ label, rate }`, `rate` like `$0.13`) whose visible text is the label and then the rate, the `models.example` line, toggle `models.toggle` |

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
