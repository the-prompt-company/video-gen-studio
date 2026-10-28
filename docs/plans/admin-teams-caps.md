# Admin teams and spend caps plan

The operator runs Video Gen Studio for a 20-person team on a minimal budget and wants to control and see what each person and team spends.
After this program, every generation uses the requesting user's admin-assigned Higgsfield key, and every refused submit opens one dialog that names the reason, which is a missing key, a spend cap, or a disabled model.
An admin groups users into teams, at most one team per user, and sets cumulative USD caps for one user or many at once. A cap never resets.
A member sees their own and their team's videos and spend. An admin sees everything, per user and per team, and each user's generation log.
The rule the program enforces is that spend is derived from `generations` rows and that admission is atomic, so concurrent submits never push a user past their cap.
The data shape is `teams`, `users.team_id`, `users.spend_cap_usd`, and a price snapshot `generations.price_per_sec_usd`. Spent is the sum of completed `cost_usd`. Reserved is the sum of snapshot × seconds over live rows. Appendix E has the details.
The PRs are AT-1 (lifecycle owner and data), AT-2 (refusal dialog) and AT-3 (admin teams and caps) on AT-1, AT-4 (team gallery) on AT-3, and AT-5 (dashboards and per-user pages) on AT-4.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record. Read Appendix E before any PR section, because it defines the data shape, the derived spend, and the access rules every PR builds on. Appendix F lists the calls only the operator makes and the default each PR applies until the operator says otherwise.

The program runs `C:/Users/a/.claude/plugins/cache/cursor-plugins/pstack/0.15.36/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator merges every PR. Every PR stops at verified and green at its current head. AT-2, AT-3, AT-4, and AT-5 change an interaction, so they also wait for the operator's review in chat.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

The trunk branch of this repository is `master`. Read `origin/main` below as `origin/master`. The pstack skills live in the plugin cache at `C:/Users/a/.claude/plugins/cache/cursor-plugins/pstack/0.15.36/skills/`, not in the repository, so read them from that path in place of `git show`. The program starts after PRs #11, #12, #13, and #14 land on `master`.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Confirm that PRs #11 to #14 are merged into `master`. If #11 merged with the transaction client fix already in `src/db/index.ts` (Appendix F, decision 5), mark AT-1's `createDb()` box as skipped with that SHA. `scripts/db-check.ts` still lands as the regression check.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md` (the plugin cache copy) and `autopilot-full.md`, which it extends.
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md` (the plugin cache copy).
  - [ ] `git show origin/main:.claude/skills/verify-video-gen-studio/SKILL.md` (this repository's control skill) and its `features/README.md`.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md` (the plugin cache copy).
  - [ ] `git show origin/main:pstack/skills/principle-make-operations-idempotent/SKILL.md`, then `principle-model-the-domain`, `principle-separate-before-serializing-shared-state`, `principle-sequence-verifiable-units`, and `principle-prove-it-works` (the plugin cache copies).
  - [ ] `C:/Users/a/.claude/skills/house-style/SKILL.md`, which every commit message and PR body follows.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] Append this sentence to the `/loop` command after the tick prompt, so every tick sees the no-merge rule. `The execution playbook is C:/Users/a/.claude/plugins/cache/cursor-plugins/pstack/0.15.36/skills/poteto-mode/playbooks/autopilot-stack.md, and nobody merges.`
- [ ] Once AT-1's `scripts/lane-users.ts` exists, run `npx dotenv -e .env.local -- tsx scripts/lane-users.ts list --prefix vgs-lane-` at every tick. Delete every prefix that no running lane owns with `lane-users.ts delete`, so no lane account, team, or row outlives its lane.
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] AT-1 is first. It branches from `master` as `at-1-spend-admission`.
  - [ ] AT-2 and AT-3 are independent of each other. Both branch from AT-1's branch, as `at-2-refusal-dialog` and `at-3-admin-teams-caps`.
  - [ ] AT-4 after AT-3. It branches from AT-3's branch as `at-4-team-gallery`.
  - [ ] AT-5 after AT-4. It branches from AT-4's branch as `at-5-scoped-dashboards`.
- [ ] Hold the file boundaries. Each PR touches only the paths in its Files block.
  - [ ] AT-1 touches `src/db/**`, `drizzle/**`, `src/lib/spend*`, `src/lib/submit-block*`, `src/lib/auth.ts`, `src/lib/generations.ts`, `src/app/api/generations/route.ts`, `eslint.config.mjs`, four files under `scripts/`, three harness docs, and `README.md`.
  - [ ] AT-2 touches `src/components/ui.tsx`, `src/components/BlockedDialog.tsx`, `src/components/Playground.tsx`, `src/app/(app)/playground/page.tsx`, `src/lib/block-copy*`, and the playground harness files. AT-2 is the only PR that edits `ui.tsx`.
  - [ ] AT-3 touches `src/app/api/admin/**`, `src/lib/admin-input*`, `usageByUser` in `src/lib/stats.ts`, `src/components/admin/{AdminPanels,UsersPanel,TeamsPanel}.tsx`, the admin harness files, `PRODUCT.md`, and `README.md`.
  - [ ] AT-4 touches `src/lib/scope*`, `src/app/(app)/gallery/page.tsx`, `src/components/Gallery.tsx`, the gallery harness files, `PRODUCT.md`, and `README.md`.
  - [ ] AT-5 touches `src/lib/stats.ts`, `src/components/UsageDashboard.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/admin/**`, `src/components/admin/*.tsx`, `scripts/usage-check.ts`, the dashboard and admin harness files, and `README.md`.
- [ ] Hold the review gate. AT-2, AT-3, AT-4, and AT-5 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.
- [ ] Hold the database rule. Only AT-1 adds a migration. Its owner applies `drizzle/0005_teams_caps.sql` to the shared database once, at the code-ready head, before the first live lane (Appendix F, decision 4). Nobody edits an applied migration. A fix adds `0006`.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use `gh pr create --base <parent branch>`. A stack child targets its parent branch, and AT-1 targets `master`.
- [ ] Run `npm run typecheck` and `npm run lint` once before the PR-facing push. Push with hooks on.
- [ ] Write commit messages and PR bodies per the `house-style` skill. The PR body's `🧭 배경` section opens with the operator's goal from this plan's first line. `/deslop` and `/no-comments` come from `cursor-team-kit`, which this environment lacks, so apply their standard by hand (no narrating comments, no filler) and say so in the PR body.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`. Skipped in Claude Code when the PR has no Bugbot check.
- [ ] Rebase onto the parent branch before the code-ready report and babysit, and AT-1 onto `master`. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with the parent, on a CI failure that comes from a change on the parent, or when a known concurrent change to the same files lands. A new head on a lower PR restacks the PRs above it.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `pstack/skills/swarm/SKILL.md` (the plugin cache copy). One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The operator merges. The root stops each PR at verified and green at its current head and hands it over, and the operator lands the stack bottom-up, AT-1 first, then AT-2 and AT-3, then AT-4, then AT-5. After the handoff, nobody pushes without the operator's go. A restack that leaves a PR's `git patch-id` unchanged keeps its verdict, per the patch-id rule in `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs on this PC, not on a cloud VM, in a git worktree at the PR head. Drive through `.claude/skills/verify-video-gen-studio` (`vgs` below). The database is the shared production Supabase database, so every lane works only with accounts it creates and deletes.

- [ ] Prepare a worktree once per head. Run `git fetch origin <head-branch>` and `git worktree add .claude/worktrees/lane-<pr-id>-head <head SHA>`, copy `C:/Users/a/project_tpc/video-generation-workflow-page/web/.env.local` into it, then run `npm ci` and `npm install --prefix .claude/skills/verify-video-gen-studio`. The regression lane and the perf lane also prepare `.claude/worktrees/lane-<pr-id>-trunk` at the `master` SHA.
- [ ] Take the database lane lock before the first write. `mkdir C:/Users/a/project_tpc/video-generation-workflow-page/web/.verify/db-lane.lock` must succeed, because every lane worktree sees that one path. If it fails, another lane is writing, so wait. Only one database-writing lane runs at a time, and every lane below writes.
- [ ] Start the fake Higgsfield on the lane's port with `FAKE_HF_PORT=40<nn> npm run fake:hf`, where `<nn>` is the lane number in two digits.
- [ ] Launch the app against the fake Higgsfield and the fake Blob store from PR #13. Run `HIGGSFIELD_BASE_URL=http://localhost:40<nn> VERCEL_BLOB_API_URL=http://localhost:40<nn>/api/blob BLOB_PUBLIC_BASE_URL=http://localhost:40<nn>/blob BLOB_READ_WRITE_TOKEN=vercel_blob_rw_fake_fake VGS_PORT=31<nn> node .claude/skills/verify-video-gen-studio/vgs.mjs launch`. Leave `PUBLIC_BASE_URL` and `SWEEP_ALLOW_NONPROD` unset. Proceed only when `vgs doctor` reports `ok: true`.
- [ ] Create the lane's accounts with `npx dotenv -e .env.local -- tsx scripts/lane-users.ts create --prefix vgs-lane-<pr-id>-l<n>- --count <k>`, adding `--key`, `--cap <usd>`, or `--team` as the lane needs. Name every team the lane creates in the UI `vgs-lane-<pr-id>-l<n>-team-<x>`. The script writes the passwords to `.verify/vgs-lane-<pr-id>-l<n>-users.json`. Sign in with `VGS_USER` and `VGS_PASS` from that file, and never paste them into chat or evidence.
- [ ] Use the seeded `admin` account (`ADMIN_USERNAME`) only for admin journeys. Never sign in as, select, or change `jeongjun@the-prompt.me`. Never change `admin`'s own key, cap, or team. Never click a bulk action in 어드민 unless the `ID 검색` filter holds the lane prefix.
- [ ] Follow the admin key protocol. Lane users get the fake key `fake:<username>` from `lane-users.ts --key`, or from the admin edit card when the lane tests key assignment. No lane writes a key on an account it did not create. The existing `lifecycle-check.ts` groups send `admin`'s stored key to the fake, so before them the lane runs `npx dotenv -e .env.local -- tsx scripts/db-check.ts "select api_key_enc is not null as has_key from users where username = '<ADMIN_USERNAME>'"` and reports `false` as an unmet precondition in place of writing a key.
- [ ] Follow the price protocol. A lane that needs a nonzero price uses the practice model `minimax/hailuo-2.3/standard/image-to-video`. If its stored price is 0, set it to `0.0001` with `PATCH /api/admin/models` and put the stored value back in `finally`, within 2 minutes. If the stored price is nonzero, use it as it is. Below, "one estimate" means 6 seconds at that price, 0.0006 USD at 0.0001. Only the model-disabled lanes toggle `enabled`, for at most 10 seconds, restored in `finally` (Appendix F, decision 7).
- [ ] Set `VGS_ALLOW_SPEND=1` only together with a fake `HIGGSFIELD_BASE_URL`.
- [ ] Deliver input only through `vgs run <journey>` and `curl` with the lane user's session cookie. Read-only diagnostics are `.verify/run/server-31<nn>.log`, the fake's `GET /_stats`, and `scripts/db-check.ts "<select>"`, which runs inside a read-only transaction.
- [ ] Clean up in `finally`. Run `lane-users.ts delete --prefix vgs-lane-<pr-id>-l<n>-` and pass only when it prints `left 0 users, 0 rows, 0 teams`. Then run `vgs stop`, stop the fake, and remove the lock directory with `rmdir`.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Reserve spend at submit in the lifecycle owner (AT-1)

**Depends on.** None. AT-1 branches from `master` after PRs #11 to #14 land.

**Files.**

- [ ] Edit `src/db/index.ts`.
- [ ] Edit `src/db/schema.ts`.
- [ ] Create `drizzle/0005_teams_caps.sql` and `drizzle/meta/0005_snapshot.json`, and edit `drizzle/meta/_journal.json`, all from `npm run db:generate`.
- [ ] Create `src/lib/spend.ts` and `src/lib/spend.test.ts`.
- [ ] Create `src/lib/submit-block.ts` and `src/lib/submit-block.test.ts`.
- [ ] Edit `src/lib/auth.ts`.
- [ ] Edit `src/lib/generations.ts`.
- [ ] Edit `src/app/api/generations/route.ts`.
- [ ] Edit `eslint.config.mjs`.
- [ ] Create `scripts/db-check.ts`, `scripts/lane-users.ts`, and `scripts/perf-probe.ts`.
- [ ] Edit `scripts/lifecycle-check.ts`.
- [ ] Edit `.claude/skills/verify-video-gen-studio/SKILL.md`, `.claude/skills/verify-video-gen-studio/features/README.md`, and `.claude/skills/verify-video-gen-studio/features/admin.md`.
- [ ] Edit `README.md`.

**Build.**

- [ ] Write `scripts/db-check.ts` first and watch it fail on `master`. With no argument it runs `select jsonb_typeof($1)` with a jsonb parameter inside `getDb().transaction()` under `set transaction read only`, prints `jsonb inside a transaction: <kind>`, and exits 1 unless the kind is `object`. With a SQL argument it runs that statement inside a read-only transaction and prints the rows as JSON, so lanes read the shared database without a write path.
- [ ] Fix `createDb()` in `src/db/index.ts`. Keep PR #11's transaction client in a variable, and after `drizzle(client, { schema })` copy `client.options.parsers` and `client.options.serializers` into its `options` with `Object.assign`. Drizzle installs its pass-through type handlers only on the client it wraps, so today a jsonb value written inside `db.transaction()` is encoded twice and stored as a JSON string (Appendix A).
- [ ] Add the data shape to `src/db/schema.ts` as Appendix E lists it. Add the `teams` table, `users.teamId` (foreign key, on delete set null), `users.spendCapUsd` (null means no cap, check constraint `spend_cap_usd >= 0`), and `generations.pricePerSecUsd` (not null, default `'0'`). Export `type Team`.
- [ ] Generate `drizzle/0005_teams_caps.sql` with `npm run db:generate`. Check that it holds only `CREATE TABLE`, `ADD COLUMN`, and `ADD CONSTRAINT` statements, then apply it with `npm run db:migrate` once, before the first live lane.
- [ ] Create `src/lib/spend.ts` with the derived spend from Appendix E. It exports `rowCostUsd`, `spentUsd`, `reservedUsd`, `type Budget`, `remainingUsd(budget)`, and `budgetOf(userId)`. `reservedUsd` reads `LIVE_STATUSES` from `src/lib/generation-status.ts`, so the live set keeps one definition.
- [ ] Create `src/lib/submit-block.ts` with `type SubmitBlock` and `parseSubmitBlock(x: unknown)`. It imports nothing from the server, so the playground can import it.
- [ ] Give `HttpError` in `src/lib/auth.ts` an optional `block: SubmitBlock`, and make `errorResponse` send `{ error, block }`.
- [ ] Rewrite `submitGeneration` in `src/lib/generations.ts` around one admission transaction (Appendix E, admission).
  - [ ] Validate the arguments with `buildArguments`, then read the model row. Throw 400 `관리자가 비활성화한 모델입니다` with the `model_disabled` block for a disabled model.
  - [ ] Run one `getDb().transaction()`. Set `lock_timeout` to 5 s, lock the user row with `.for("update")` while reading `api_key_enc` and `spend_cap_usd`, compute spent, reserved, and `fits` in SQL numeric, and insert the row with `pricePerSecUsd` set to the model's price.
  - [ ] Throw 403 `API 키가 아직 할당되지 않았습니다. 관리자에게 문의하세요` with the `no_api_key` block, or 403 `사용 한도를 넘어 생성할 수 없습니다. 관리자에게 한도 조정을 요청하세요` with the `spend_cap` block and its four amounts. Map SQLSTATE `55P03` to 503 `다른 생성 요청을 처리하는 중입니다. 잠시 후 다시 시도하세요`.
  - [ ] Call `send()` after the commit, with the key read under the lock, so no Higgsfield call runs inside the transaction. Return `{ row, budget }`.
- [ ] Charge the snapshot on completion. In `decide()`, the completed patch sets `costUsd` to `rowCostUsd`, and `ctx` loses `pricePerSecUsd`. `refresh()` stops reading prices. Update the transition table comment.
- [ ] Make `POST /api/generations` in `src/app/api/generations/route.ts` call the new `submitGeneration`. Drop its own models read and its `priceFor` call, and answer `{ item, budget, estimatedCostUsd }` with the estimate from the row's snapshot.
- [ ] Delete `priceFor` from `src/lib/generations.ts` once the route and `scripts/lifecycle-check.ts` no longer call it.
- [ ] Forbid inserts into `generations` under `src/**` outside `src/lib/generations.ts`. Add a second `no-restricted-syntax` block to `eslint.config.mjs` with `files: ["src/**"]`, the existing two selectors with `insert` in place of `update`, and the `SINGLE_WRITER` message. Scripts keep inserting test rows directly.
- [ ] Create `scripts/lane-users.ts` with the commands `create`, `cap`, `list`, and `delete` from Appendix E, lane accounts. It refuses any prefix that does not match `^vgs-lane-[a-z0-9-]+-$`, refuses to touch `ADMIN_USERNAME` or `jeongjun@the-prompt.me`, and `delete` prints `left <n> users, <n> rows, <n> teams` and exits 1 unless all three are 0.
- [ ] Add a `--caps` group to `scripts/lifecycle-check.ts` with the checks `capRace`, `capResubmit`, `capRelease`, `capPriceChange`, `capZeroPrice`, `capLowered`, and `capBlocks`, described under Verify, unit. `--only` accepts their names.
  - [ ] Give `capRace` a child mode, `--reserve-once <userId> <startAtMs>`, and spawn six children. Submits inside one process share PR #11's one-connection transaction client and would pass even without the lock.
  - [ ] Create the group's users through the `lane-users.ts` functions with the prefix `vgs-lane-caps-`, and delete them in `finally`. `--keep` skips that cleanup so a lane can look at the rows, and the lane then runs `lane-users.ts delete --prefix vgs-lane-caps-`.
  - [ ] Run `capZeroPrice` on a model whose stored price is 0. When no model is stored at 0, print the stored prices and skip it, because a lane never lowers a nonzero price.
  - [ ] Lower `TEST_PRICE` to `0.0001`. Make the existing cost checks read the row's `pricePerSecUsd` in place of `owner.priceFor`.
- [ ] Create `scripts/perf-probe.ts`, the latency lever every perf block uses. It signs in as a lane user, or as `admin` with `--admin`, on two bases, alternates requests to A then B for `--n` samples after 3 warmups each, times `select 1` against the database in the same run, and prints p50 and p95 for A, B, and the round trip as JSON. `--a-path` and `--b-path` compare two paths. `--post-generation` submits a 6 s practice-model generation in place of a GET.
- [ ] Update the harness docs. In `SKILL.md` and `features/README.md`, replace "never create users" with the lane account rule from the boot recipe. In `features/admin.md`, replace the gotcha about verification users the same way.
- [ ] Update the cost bullet of `README.md`. A row is charged the price its model had when the row was admitted. A cap counts completed costs plus live reservations. A deploy after prices were entered runs the SQL from Appendix C, risk 9, once.

**You see.**

- [ ] `npx dotenv -e .env.local -- tsx scripts/db-check.ts` prints `jsonb inside a transaction: string` on `master` and `jsonb inside a transaction: object` at the head.
- [ ] A lane user with a cap of one estimate and one completed practice-model row clicks `생성하기`, and the drawer shows the ErrorText `사용 한도를 넘어 생성할 수 없습니다. 관리자에게 한도 조정을 요청하세요`. The POST answered 403 with `"block":{"code":"spend_cap"`, and the fake's `/_stats` shows no new submit.
- [ ] `lifecycle-check.ts --caps` prints `ok   6 processes raced for a cap of 2 estimates: 2 admitted, 4 refused` and ends with `all cap checks passed`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/db-check.ts` fails on `master` and passes at the head. Run `npx dotenv -e .env.local -- tsx scripts/db-check.ts` on both.
- [ ] `src/lib/spend.test.ts` covers `remainingUsd` without a cap, under the cap, at the cap, and over it. `src/lib/submit-block.test.ts` accepts each code and rejects an unknown code and a missing amount. Run `node --test --import tsx src/lib/*.test.ts`.
- [ ] `lifecycle-check.ts --caps` passes. Run `FAKE_HF_PORT=4011 npm run fake:hf`, then `HIGGSFIELD_BASE_URL=http://localhost:4011 npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts --caps`.
  - [ ] `capRace` admits exactly two of six cross-process submits against a cap of two estimates, and spent plus reserved never exceeds the cap.
  - [ ] `capResubmit` keeps a pending row's reservation through a 429, refuses a second submit while it waits, and the fake accepts the row's key once.
  - [ ] `capRelease` frees the reservation on cancel and on the 30-minute deadline, and the next submit fits.
  - [ ] `capPriceChange` charges the snapshot price after the model's price changes mid-flight.
  - [ ] `capZeroPrice` admits a 0 USD submit at cap 0, and refuses one when committed spend already exceeds the cap (Appendix F, decision 2).
  - [ ] `capLowered` lets a live row finish and be charged after the cap drops below spend, and refuses the next submit.
  - [ ] `capBlocks` proves that the no-key and disabled-model refusals insert no row and send nothing to the fake.
- [ ] The race check catches a broken lock. Delete `.for("update")` locally, run `--caps --only capRace`, keep the `FAIL` output, restore the line, and paste both outputs in the PR.
- [ ] The default `lifecycle-check.ts` groups still pass with the snapshot cost rule. Run `HIGGSFIELD_BASE_URL=http://localhost:4011 npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts`, which takes about seven minutes.
- [ ] The lint rule fires. A planted `getDb().insert(schema.generations)` in `src/app/api/probe.ts` makes `npm run lint` fail with the `SINGLE_WRITER` message. Delete the probe, then run `npm run lint` and `npm run typecheck`.
- [ ] `lane-users.ts` round-trips. Run `create --prefix vgs-lane-at1-unit- --count 2 --key --cap 1 --team`, then `delete` with the same prefix, and see `left 0 users, 0 rows, 0 teams`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. A keyed lane user without a cap submits one 6 s practice-model generation from `플레이그라운드` on trunk and on head. Save `at1-regression.png`. Pass when both rows reach `완료`, and on head `db-check.ts` shows `cost_usd` equal to `price_per_sec_usd` × 6 with `price_per_sec_usd` equal to the model's price at submit, while trunk has no such column, which the lane records.
- [ ] Lane 2. A lane user with a cap of one estimate and one completed row clicks `생성하기`. Save `at1-cap-refused.png`. Pass when the drawer shows `사용 한도를 넘어 생성할 수 없습니다. 관리자에게 한도 조정을 요청하세요`, the POST answered 403 with block code `spend_cap` and four amounts, the fake's accepted count did not move, and the user's row count did not change.
- [ ] Lane 3. Run `lifecycle-check.ts --caps --only capRace --keep`, open 어드민 `로그 · 히스토리` filtered to the race user, then run `lane-users.ts delete --prefix vgs-lane-caps-`. Save `at1-race.png`. Pass when the output has `2 admitted, 4 refused` and the logs list exactly 2 rows for that user.
- [ ] Lane 4. With `POST /_config {"firstN429": 1}` on the fake and a cap of one estimate, click `생성하기` twice, then wait. Save `at1-pending-reserved.png`. Pass when the first item shows `제출 대기` and later `완료`, the second POST answered 403 `spend_cap`, the fake accepted the first row's key once, and afterwards spent is one estimate and reserved is 0.
- [ ] Lane 5. With `FAKE_HF_DURATION_MS=60000` and a cap of one estimate, submit, cancel with `취소` while the item shows `대기`, then submit again. Save `at1-cancel-release.png`. Pass when the first row is `취소` with `cost_usd` 0 and the second POST answers 201.
- [ ] Lane 6. Submit at the practice price p, change the price to 2p with `PATCH /api/admin/models` before completion, and restore it after. Save `at1-price-change.png`. Pass when the completed row has `price_per_sec_usd` p and `cost_usd` 6p, and the next POST answers `estimatedCostUsd` 12p.
- [ ] Lane 7. If a model's stored price is 0, a lane user with cap 0 submits on it, then the price protocol sets the practice model to 0.0001 and a second lane user with cap 0 submits. Save `at1-zero-price.png`. Pass when the first POST answers 201 and its row completes with `cost_usd` 0, and the second answers 403 `spend_cap`, or the lane records every stored price when none is 0.
- [ ] Lane 8. A lane user who spent two estimates has one live row under `FAKE_HF_DURATION_MS=60000`, and `lane-users.ts cap` lowers the cap to one estimate. Save `at1-lowered-cap.png`. Pass when the live row still completes and is charged one estimate, the next POST answers 403 `spend_cap`, and no row was canceled.
- [ ] Lane 9. A lane user without a key POSTs with `curl`, then the practice model is disabled for at most 10 s while a keyed lane user clicks `생성하기`. Save `at1-blocks.png`. Pass when the answers are 403 `no_api_key` and 400 `model_disabled`, the drawer shows `관리자가 비활성화한 모델입니다`, neither call inserted a row or reached the fake, and the model is enabled again.
- [ ] Lane 10. Run `db-check.ts`, then open a completed lane row in `갤러리`. Save `at1-params.png`. Pass when `db-check.ts` prints `object`, a `db-check.ts` select of `jsonb_typeof(params)` and `jsonb_typeof(image_refs)` returns `object` and `array` for every lane row, and the `생성 상세` dialog lists `길이(초)` with its value.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The client-side `time_total` of `POST /api/generations` for a lane user with a cap, with the fake accepting, on trunk and on head, plus the database round trip (`select 1`) timed in the same run.
- [ ] Probe. Build both worktrees with `NEXT_DIST_DIR=.next-perf npx next build` and start them with the same `NEXT_DIST_DIR` as `npx next start -p 3201` (trunk) and `npx next start -p 3202` (head), both pointed at one fake on port 4099. Run `npx dotenv -e .env.local -- tsx scripts/perf-probe.ts --a http://localhost:3201 --b http://localhost:3202 --post-generation --n 30 --users .verify/vgs-lane-at1-perf-users.json` three times. It interleaves trunk and head per sample.
- [ ] Baseline. Record the trunk p50 and p95 first.
- [ ] Rule. Fail when the head p50 exceeds the trunk p50 by more than 5 database round trips, or the head p95 exceeds the trunk p95 by more than 8. Admission sends six statements where today's insert sends one (BEGIN, the lock timeout, the locked select, the sum, the insert, and COMMIT). The prototype's six-statement transaction cost 2.2 to 2.7 round trips more than one statement, in three runs from this PC (Appendix A).

**Review gate.** None. AT-1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto `master` after the verdict, patch-id unchanged.
- [ ] The root stops at verified and green and hands AT-1 to the operator, who lands the stack bottom-up.

## Show refused submits in one dialog (AT-2)

**Depends on.** AT-1. AT-2 branches from AT-1's branch and does not need AT-3.

**Files.**

- [ ] Edit `src/components/ui.tsx`.
- [ ] Create `src/lib/block-copy.ts` and `src/lib/block-copy.test.ts`.
- [ ] Create `src/components/BlockedDialog.tsx`.
- [ ] Edit `src/components/Playground.tsx`.
- [ ] Edit `src/app/(app)/playground/page.tsx`.
- [ ] Create `.claude/skills/verify-video-gen-studio/journeys/blocked.mjs`, and edit `.claude/skills/verify-video-gen-studio/features/playground.md` and `.claude/skills/verify-video-gen-studio/features/README.md`.

**Build.**

- [ ] Add `AlertDialog` to `src/components/ui.tsx`. It renders `role="alertdialog"` with `aria-modal`, points `aria-labelledby` at the title and `aria-describedby` at the body, moves focus to its first action, keeps Tab inside, closes on Esc and on a backdrop click, locks page scroll, and returns focus to the element that opened it.
  - [ ] Style it like `RefDialog` and DESIGN.md. The backdrop is `bg-background/85` with `backdrop-blur-sm`. The panel is ink with a 1px Mist border and a 12px radius, and a bottom sheet with `rounded-t-xl` under 640px. Actions are the existing `Button`, at least 44px tall on touch. No shadow.
- [ ] Create `src/lib/block-copy.ts` with `BLOCK_COPY`, typed with `satisfies` over every `SubmitBlock["code"]`, so a new code fails the build until it has copy. Use these strings exactly.
  - [ ] `no_api_key`. Title `API 키가 아직 할당되지 않았습니다`. Body `관리자가 어드민에서 키를 넣어야 생성할 수 있습니다. 관리자에게 문의하세요.` One action, `닫기`.
  - [ ] `spend_cap`. Title `사용 한도를 넘습니다`. Body `이번 생성을 더하면 사용 한도를 넘습니다. 한도를 늘리려면 관리자에게 문의하세요.` Rows `한도`, `사용`, `진행 중`, and `이번 생성 예상`, each formatted with `usd()` in Inter `tabular-nums`. One action, `닫기`.
  - [ ] `model_disabled`. Title `사용할 수 없는 모델입니다`. Body `관리자가 이 모델을 껐습니다. 목록을 새로 고친 뒤 다른 모델을 고르세요.` Actions `모델 목록 새로 고침`, which calls `router.refresh()`, and `닫기`.
- [ ] Create `src/components/BlockedDialog.tsx`, which renders `AlertDialog` from a `SubmitBlock` through `BLOCK_COPY`.
- [ ] Change `generate()` in `src/components/Playground.tsx`. When the response body carries a block that `parseSubmitBlock` accepts, open `BlockedDialog` with it in place of `setError`. Other errors keep `ErrorText`. Drop `hasApiKey` from `canGenerate`, so `생성하기` and the 생성 glyph stay enabled without a key. Keep the `role="status"` key banner.
- [ ] Show the budget in the drawer's bottom bar. `src/app/(app)/playground/page.tsx` passes `budgetOf(user.id)` as `budget`, and each POST response replaces it.
  - [ ] When `capUsd` is set, a line under the estimate reads `한도 <cap> · 남은 금액 <remaining>`.
  - [ ] When committed spend already exceeds the cap, that line reads `한도 <cap> · 한도 초과 <over>` in place of a negative remaining amount.
  - [ ] When the estimate exceeds the remaining amount, a line with the amber dot from the key banner reads `이 생성은 남은 한도를 넘습니다`, and the button stays enabled.
- [ ] Add `journeys/blocked.mjs` for the feature `pg-blocked-dialog`. It signs in as a lane user and proves the dialog for the code in `VGS_BLOCK` (`no_api_key`, `spend_cap`, or `model_disabled`). With `VGS_REPEAT=<n>` it repeats the click and logs click-to-dialog times. Rewrite `pg-generate-gate` in `features/playground.md` and list the journey in `features/README.md`.

**You see.**

- [ ] A lane user without a key sees the banner and an enabled `생성하기`. A click opens the dialog `API 키가 아직 할당되지 않았습니다` with focus on `닫기`, and Esc puts focus back on `생성하기`.
- [ ] A lane user at their cap sees `사용 한도를 넘습니다` with the four amounts from the 403 body, and the bottom bar reads `한도 <cap> · 남은 금액 $0.0000`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/lib/block-copy.test.ts` checks that every `SubmitBlock` code has a title, a body, and a `닫기` action, and that the `spend_cap` rows show the block's four amounts through `usd()`. Run `node --test --import tsx src/lib/*.test.ts`.
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] Run `VGS_BLOCK=no_api_key node .claude/skills/verify-video-gen-studio/vgs.mjs run blocked` and `VGS_BLOCK=spend_cap node .claude/skills/verify-video-gen-studio/vgs.mjs run blocked`, each with `VGS_USER` and `VGS_PASS` from a matching lane user file. Both pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. A lane user without a key opens `플레이그라운드` on trunk and on head. Save `at2-no-key.png`. Pass when trunk shows the banner and a disabled `생성하기`, which the lane records, and head shows the banner and an enabled `생성하기` whose click opens `API 키가 아직 할당되지 않았습니다` with focus on `닫기` and inserts no row.
- [ ] Lane 2. A lane user at their cap clicks `생성하기`. Save `at2-cap-dialog.png`. Pass when the dialog `사용 한도를 넘습니다` shows `한도`, `사용`, `진행 중`, and `이번 생성 예상` equal to the 403 body's amounts through `usd()`.
- [ ] Lane 3. With the page open, the practice model is disabled for at most 10 s, and the lane user clicks `생성하기` and then `모델 목록 새로 고침`. Save `at2-model-disabled.png`. Pass when the dialog `사용할 수 없는 모델입니다` appears, the refreshed `모델` select no longer lists the model, and the model is enabled again afterwards.
- [ ] Lane 4. Keyboard only. Tab to `생성하기`, press Enter, Tab through the dialog several times, then press Esc. Save `at2-keyboard.png`. Pass when focus never leaves the open dialog and lands on `생성하기` after Esc.
- [ ] Lane 5. Click the rail glyph `생성` in place of the button. Save `at2-rail.png`. Pass when the same dialog opens for the same block.
- [ ] Lane 6. Run the cap scenario with `VGS_MOBILE=1`. Save `at2-mobile.png`. Pass when the dialog is a bottom sheet inside the 390×844 viewport, its buttons are at least 44px tall, and the page behind it does not scroll.
- [ ] Lane 7. A lane user with a cap of two estimates submits once. Save `at2-budget.png`. Pass when the bottom bar reads `한도 <cap> · 남은 금액 <cap>` before the click and shows `남은 금액` one estimate lower after the 201.
- [ ] Lane 8. A lane user whose remaining amount is below one estimate opens the playground. Save `at2-over-hint.png`. Pass when the bar shows `이 생성은 남은 한도를 넘습니다`, `생성하기` stays enabled, and a click opens the cap dialog.
- [ ] Lane 9. Read the ARIA snapshot of the open dialog. Save `at2-aria.png`. Pass when it shows an `alertdialog` named by the title and described by the body, and the `role=status` key banner is still there for a lane user without a key.
- [ ] Lane 10. A keyed lane user without a cap submits. Save `at2-happy.png`. Pass when no dialog opens, the item reaches `완료` on the stage, and `console.txt` has no error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The time to first byte of `GET /playground` for a lane user with a cap on trunk and on head, because the page now reads `budgetOf`. The diff also adds the click-to-dialog time at head, which trunk lacks.
- [ ] Probe. Run `perf-probe.ts --a http://localhost:3201 --b http://localhost:3202 --path /playground --n 30` three times against the two `next start` builds from AT-1's recipe. At head, run `perf-probe.ts --a http://localhost:3202 --b http://localhost:3202 --post-generation --n 30` once for the POST p95, then `VGS_BLOCK=spend_cap VGS_REPEAT=10 vgs run blocked` and read its click-to-dialog times.
- [ ] Baseline. Record the trunk `/playground` p50 and p95 first.
- [ ] Rule. Fail when the head `/playground` p50 exceeds the trunk p50 by more than 2 database round trips. Fail when the click-to-dialog p95 exceeds that session's head POST p95 by more than 150 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 1, 2, and 6 screenshots into `.impeccable/review/at-2-review-no-key.png`, `.impeccable/review/at-2-review-cap.png`, and `.impeccable/review/at-2-review-mobile.png`.
- [ ] Record a 30 to 60 second video with `VGS_VIDEO=1` while the lane runs the no-key and cap dialogs. Save it as `.impeccable/review/at-2-review.webm`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto AT-1's branch after the verdict, patch-id unchanged.
- [ ] The root stops at verified and green and hands AT-2 to the operator, who lands the stack bottom-up.

## Manage teams and spend caps in admin (AT-3)

**Depends on.** AT-1. AT-3 branches from AT-1's branch and does not need AT-2.

**Files.**

- [ ] Create `src/app/api/admin/teams/route.ts` and `src/app/api/admin/teams/[id]/route.ts`.
- [ ] Edit `src/app/api/admin/users/route.ts` and `src/app/api/admin/users/[id]/route.ts`.
- [ ] Create `src/lib/admin-input.ts` and `src/lib/admin-input.test.ts`.
- [ ] Edit `src/lib/stats.ts`, only `usageByUser` and `UserUsageRow`.
- [ ] Edit `src/components/admin/AdminPanels.tsx` and `src/components/admin/UsersPanel.tsx`.
- [ ] Create `src/components/admin/TeamsPanel.tsx`.
- [ ] Create `.claude/skills/verify-video-gen-studio/journeys/teams.mjs`, and edit `.claude/skills/verify-video-gen-studio/features/admin.md` and `.claude/skills/verify-video-gen-studio/features/README.md`.
- [ ] Edit `PRODUCT.md` and `README.md`.

**Build.**

- [ ] Create `src/lib/admin-input.ts` with pure parsers that throw `HttpError(400)`.
  - [ ] `parseCapUsd` accepts null for no cap, or a number from 0 to 999999.9999 with at most 4 decimals. Anything else throws `한도는 0 이상 999999 이하의 USD 금액입니다`.
  - [ ] `parseTeamName` trims to 1 to 40 characters, else it throws `팀 이름은 1~40자입니다`.
  - [ ] `parseUserIds` accepts 1 to 200 distinct positive integers, else it throws `사용자를 한 명 이상 고르세요`.
- [ ] Add `GET` and `POST` to `src/app/api/admin/teams/route.ts`, both behind `requireAdmin()`. GET lists teams with member counts and spent and reserved totals. POST creates a team and answers 409 `이미 있는 팀 이름입니다` on a duplicate name.
- [ ] Add `PATCH` (rename) and `DELETE` to `src/app/api/admin/teams/[id]/route.ts`, behind `requireAdmin()`. DELETE leaves the members with no team through the `on delete set null` foreign key and never touches `generations`. An unknown id answers 404 `없는 팀입니다`.
- [ ] Add a bulk `PATCH` to `src/app/api/admin/users/route.ts`, behind `requireAdmin()`. The body is `{ userIds, capUsd?, teamId? }`, and one `UPDATE ... WHERE id IN (...)` answers `{ updated }`. An unknown `teamId` answers 400 `없는 팀입니다`. There is no "all users" form, because the client sends the ids the admin selected.
- [ ] Extend `GET` and `PATCH` in `src/app/api/admin/users/[id]/route.ts` with `capUsd` and `teamId`, and add `budget` from `budgetOf` to the GET answer.
- [ ] Extend `usageByUser()` in `src/lib/stats.ts` with `teamId`, `teamName`, `capUsd`, `spentUsd`, and `reservedUsd` in the same single query, using the fragments from `spend.ts`. `totalCostUsd` becomes `spentUsd`.
- [ ] Rework the users table in `UsersPanel.tsx`.
  - [ ] Add the columns `팀`, `한도`, and `사용 · 진행 중`, and a rose `Badge` reading `한도 초과` when spent plus reserved exceeds the cap.
  - [ ] Add a filter row with the field `ID 검색` (placeholder `ID로 찾기`) and a team select with `모든 팀`, `팀 없음`, and then the team names.
  - [ ] Add a 16px checkbox per row labeled `<username> 선택` and a header checkbox labeled `보이는 사용자 모두 선택`, which selects only the rows the filter shows.
  - [ ] When at least one row is selected, show a bulk bar inside the card with `선택 <n>명`, a `한도(USD)` field, `한도 적용`, `한도 해제`, a team select that includes `팀 없음`, and `팀 배정`.
  - [ ] Add a `한도(USD)` field with the hint `비우면 한도 없음` and a `저장` button, and a `팀` select, to the edit card `<username> 편집`.
- [ ] Show the notice `모델 단가가 모두 0이라 한도가 아무것도 막지 않습니다. 모델 · 단가 탭에서 단가를 넣으세요.` above the users table when every enabled model's stored price is 0.
- [ ] Create `TeamsPanel.tsx` and add the tab `팀` to `AdminPanels.tsx` after `사용자 · API 키`.
  - [ ] The panel lists teams with the columns `팀`, `인원`, and `사용`, and creates one from a `팀 이름` field and an `추가` button.
  - [ ] A click on a team opens the edit card `<팀 이름> 편집` with `이름 바꾸기`, the member list, and `팀 삭제`. `팀 삭제` first shows `삭제하면 팀원 <n>명이 팀 없음이 됩니다` inline, with a danger `삭제` and `취소`.
- [ ] Add `journeys/teams.mjs` for the features `adm-teams`, `adm-caps-bulk`, and `adm-user-cap`. It reads the lane prefix from `VGS_LANE_PREFIX` and refuses to click `한도 적용`, `한도 해제`, or `팀 배정` unless every visible row starts with it. Document the three features in `features/admin.md` and list the journey in `features/README.md`.
- [ ] Add 팀 and 한도 to `PRODUCT.md`, under the admin capabilities and under 용어, and to the `/admin` row of the route table in `README.md`.

**You see.**

- [ ] In 어드민, the admin types the lane prefix into `ID 검색`, checks `보이는 사용자 모두 선택`, enters `1` in `한도(USD)`, and clicks `한도 적용`. Every visible row shows `$1.00` under `한도`, and `/api/admin/users` shows no other user changed.
- [ ] The tab `팀` creates a team, and a user moved from one team to another is listed under the second team only.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/lib/admin-input.test.ts` covers the bounds and the messages of the three parsers. Run `node --test --import tsx src/lib/*.test.ts`.
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] After `lane-users.ts create --prefix vgs-lane-at3-unit- --count 3`, `VGS_LANE_PREFIX=vgs-lane-at3-unit- node .claude/skills/verify-video-gen-studio/vgs.mjs run teams` passes as `admin`, and `lane-users.ts delete` prints `left 0 users, 0 rows, 0 teams`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `vgs run admin` as `admin` on trunk and on head. Save `at3-admin.png`. Pass when both pass, and head's users table also shows `팀`, `한도`, and `사용 · 진행 중`.
- [ ] Lane 2. In the tab `팀`, create `<prefix>team-a`, rename it to `<prefix>team-b`, then create `<prefix>team-b` again. Save `at3-team-create.png`. Pass when `GET /api/admin/teams` lists the renamed team once and the second create shows `이미 있는 팀 이름입니다`.
- [ ] Lane 3. In the edit card, put a lane user in team A, then in team B. Save `at3-team-move.png`. Pass when the user's `teamId` is B and team A's `인원` dropped by one.
- [ ] Lane 4. Filter `ID 검색` to the lane prefix, check `보이는 사용자 모두 선택`, enter `1`, and click `한도 적용`. Save `at3-bulk-cap.png`. Pass when every lane user's `capUsd` is 1 and a diff of `/api/admin/users` before and after shows no change to any other user.
- [ ] Lane 5. With the same selection, click `한도 해제`. Save `at3-bulk-clear.png`. Pass when every selected `capUsd` is null and no other user changed.
- [ ] Lane 6. Select two of three lane users and assign `<prefix>team-a` with `팀 배정`. Save `at3-bulk-team.png`. Pass when exactly those two carry the team.
- [ ] Lane 7. Enter `-1`, `abc`, and `1000000` as a cap in the edit card and in the bulk bar. Save `at3-validation.png`. Pass when each attempt shows `한도는 0 이상 999999 이하의 USD 금액입니다` and no cap changed.
- [ ] Lane 8. Delete a team with two members through `팀 삭제` and `삭제`. Save `at3-team-delete.png`. Pass when the inline warning named 2 members, both now show `팀 없음`, and their generation rows are unchanged.
- [ ] Lane 9. A keyed lane user completes one generation at the practice price, `lane-users.ts cap` lowers their cap below that spend, and the admin reloads the users table. Save `at3-badges.png`. Pass when that row shows `한도 초과`, and the zero-price notice shows if and only if every enabled model's stored price is 0.
- [ ] Lane 10. A non-admin lane user calls the bulk `PATCH /api/admin/users` and `POST /api/admin/teams` with `curl` and opens `/admin`. Save `at3-member-denied.png`. Pass when both calls answer 403 `관리자만 사용할 수 있습니다` and `/admin` redirects to `/dashboard`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The time to first byte of `GET /api/admin/users` as `admin` on trunk and on head, where head adds the team join and the spend aggregates to the same single query. The diff also adds one bulk `PATCH /api/admin/users` for 10 lane users at head, which trunk lacks.
- [ ] Probe. Run `perf-probe.ts --admin --a http://localhost:3201 --b http://localhost:3202 --path /api/admin/users --n 30` three times against the two `next start` builds, then time 10 bulk PATCH calls at head with `curl -w %{time_total}`.
- [ ] Baseline. Record the trunk p50 and p95 first.
- [ ] Rule. Fail when the head p50 exceeds the trunk p50 by more than 1 database round trip, or when the bulk PATCH p95 exceeds 3 round trips plus 100 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 2, 4, and 9 screenshots into `.impeccable/review/at-3-review-teams.png`, `.impeccable/review/at-3-review-bulk-cap.png`, and `.impeccable/review/at-3-review-badges.png`.
- [ ] Record a 30 to 60 second video with `VGS_VIDEO=1` of the filter, select-visible, bulk cap, and team assignment flow. Save it as `.impeccable/review/at-3-review.webm`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto AT-1's branch after the verdict, patch-id unchanged.
- [ ] The root stops at verified and green and hands AT-3 to the operator, who lands the stack bottom-up.

## Show the team's videos in the gallery (AT-4)

**Depends on.** AT-3, on AT-3's branch. Teams must exist to assign members.

**Files.**

- [ ] Create `src/lib/scope.ts` and `src/lib/scope.test.ts`.
- [ ] Edit `src/app/(app)/gallery/page.tsx`.
- [ ] Edit `src/components/Gallery.tsx`.
- [ ] Edit `.claude/skills/verify-video-gen-studio/journeys/gallery.mjs` and `.claude/skills/verify-video-gen-studio/features/gallery.md`.
- [ ] Edit `PRODUCT.md` and `README.md`.

**Build.**

- [ ] Create `src/lib/scope.ts` from Appendix E with `Scope`, `ScopeName`, `viewerScope(viewer, name)`, `adminScope(viewer, target)`, and `scopeWhere(scope)`. `viewerScope` is the one place that says what a member may see.
  - [ ] `mine` is the viewer's own rows.
  - [ ] `team` is the rows of users whose `team_id` equals the viewer's own `team_id`, read from the users row and never from the request. It is null when the viewer has no team.
  - [ ] `all` is null unless the viewer is an admin.
  - [ ] `scopeWhere` turns a team scope into `user_id in (select id from users where team_id = $1)`.
- [ ] Rework `src/app/(app)/gallery/page.tsx` to read `?scope=mine`, `?scope=team`, or `?scope=all` and resolve it with `viewerScope`. A null `all` falls back to `mine`. A null `team` renders the team tab's empty state. Keep the completed-only filter and the 120-row limit. Drop `?all=1`.
- [ ] Turn the scope links in `src/components/Gallery.tsx` into the tabs `내 영상` and `팀 영상`, plus `전체` for admins, as links with `aria-current="page"` and 44px targets on touch.
  - [ ] The team tab's subtitle reads `<팀 이름> · 완료된 영상 <n>건`, and each tile keeps its username.
  - [ ] Without a team, the team tab shows `아직 팀이 없습니다. 관리자가 팀을 정하면 팀원의 영상이 여기 보입니다.`
  - [ ] With a team and no videos, it shows `팀원이 완료한 영상이 아직 없습니다.`
- [ ] Update `journeys/gallery.mjs` for the new tabs and `?scope=all`, add a `gal-team` step, and rewrite `gal-scope` in `features/gallery.md`.
- [ ] Update Positioning 3 in `PRODUCT.md` and the `/gallery` row of the route table in `README.md`.

**You see.**

- [ ] A lane member of team A opens `갤러리`, clicks `팀 영상`, and sees the completed videos of every team A member with their usernames, and none from team B.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/lib/scope.test.ts` checks the access table. A member gets `mine`, gets `team` only with a team and only for their own team id, and never gets `all`. An admin gets all three. `adminScope` returns null for a member. Run `node --test --import tsx src/lib/*.test.ts`.
- [ ] Run `npm run typecheck` and `npm run lint`.
- [ ] `vgs run gallery` passes as `admin` and as a lane member with a team.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. A lane user with three completed rows opens `갤러리` on trunk, under `내 것`, and on head, under `내 영상`. Save `at4-mine.png`. Pass when both show the same three prompts.
- [ ] Lane 2. Three lane users in team A and one in team B each complete one row, and a team A member clicks `팀 영상`. Save `at4-team-tab.png`. Pass when it shows exactly the three team A videos with their usernames.
- [ ] Lane 3. A lane user without a team clicks `팀 영상`. Save `at4-no-team.png`. Pass when it shows `아직 팀이 없습니다. 관리자가 팀을 정하면 팀원의 영상이 여기 보입니다.`
- [ ] Lane 4. A team A member opens `/gallery?scope=all` and `/gallery?scope=team&teamId=<team B id>`. Save `at4-tamper.png`. Pass when the first renders `내 영상` and the second still shows only team A's videos.
- [ ] Lane 5. A team A member opens a teammate's tile. Save `at4-teammate-detail.png`. Pass when `생성 상세` plays `생성된 영상` and `다운로드` points at the same URL.
- [ ] Lane 6. As `admin`, click `전체`. Save `at4-admin-all.png`. Pass when the URL is `/gallery?scope=all` and the tile count is at least the `내 영상` count.
- [ ] Lane 7. Move a team A member to team B in 어드민, then reload `팀 영상` for a member of each team. Save `at4-move.png`. Pass when the moved member's video shows under team B and no longer under team A, per Appendix F, decision 1.
- [ ] Lane 8. A teammate has a live row under `FAKE_HF_DURATION_MS=60000` and a failed row. Save `at4-completed-only.png`. Pass when neither appears in `팀 영상`.
- [ ] Lane 9. Open the team tab with `VGS_MOBILE=1`. Save `at4-mobile.png`. Pass when the tabs fit at 390px with 44px targets and the grid is one column.
- [ ] Lane 10. Drive the tabs by keyboard. Save `at4-tabs-aria.png`. Pass when Tab reaches each tab, Enter switches to it, and the ARIA snapshot marks exactly one tab `aria-current="page"`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The time to first byte of `GET /gallery` for a lane user with 5 completed rows on trunk and on head. The diff also adds `GET /gallery?scope=team` for a team of 3, which trunk lacks.
- [ ] Probe. Run `perf-probe.ts --a http://localhost:3201 --b http://localhost:3202 --path /gallery --n 30` three times against the two `next start` builds, then `perf-probe.ts --a http://localhost:3202 --a-path /gallery --b http://localhost:3202 --b-path "/gallery?scope=team" --n 30` three times at head.
- [ ] Baseline. Record the trunk `/gallery` p50 and p95 first.
- [ ] Rule. Fail when the head `/gallery` p50 exceeds the trunk p50 by more than 1 database round trip, or when the team tab p95 exceeds the head `/gallery` p95 by more than 2 round trips.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 2, 3, and 9 screenshots into `.impeccable/review/at-4-review-team.png`, `.impeccable/review/at-4-review-no-team.png`, and `.impeccable/review/at-4-review-mobile.png`.
- [ ] Record a 30 to 60 second video with `VGS_VIDEO=1` of a member switching between `내 영상` and `팀 영상` and opening a teammate's video. Save it as `.impeccable/review/at-4-review.webm`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto AT-3's branch after the verdict, patch-id unchanged.
- [ ] The root stops at verified and green and hands AT-4 to the operator, who lands the stack bottom-up.

## Scope the dashboards and add per-user and per-team admin pages (AT-5)

**Depends on.** AT-4, on AT-4's branch. It reuses `src/lib/scope.ts`.

**Files.**

- [ ] Edit `src/lib/stats.ts`.
- [ ] Create `src/components/UsageDashboard.tsx`.
- [ ] Edit `src/app/(app)/dashboard/page.tsx`.
- [ ] Edit `src/app/(app)/admin/page.tsx`, and create `src/app/(app)/admin/users/[id]/page.tsx` and `src/app/(app)/admin/teams/[id]/page.tsx`.
- [ ] Edit `src/components/admin/AdminPanels.tsx`, `src/components/admin/UsersPanel.tsx`, `src/components/admin/TeamsPanel.tsx`, and `src/components/admin/LogsPanel.tsx`.
- [ ] Create `scripts/usage-check.ts`.
- [ ] Edit `.claude/skills/verify-video-gen-studio/journeys/dashboard.mjs`, create `.claude/skills/verify-video-gen-studio/journeys/admin-user.mjs`, and edit `.claude/skills/verify-video-gen-studio/features/dashboard.md`, `.claude/skills/verify-video-gen-studio/features/admin.md`, and `.claude/skills/verify-video-gen-studio/features/README.md`.
- [ ] Edit `README.md`.

**Build.**

- [ ] Replace `usageFor(userId | null)` in `src/lib/stats.ts` with `usageFor(scope: Scope)`. It returns today's totals with `spentUsd` in place of `totalCostUsd`, plus `reservedUsd`, `members` (one row per user, for team and all scopes), `teams` (one row per team plus a `팀 없음` row, for the all scope), and `budget` (for a user scope). Every amount uses the `spend.ts` fragments. Migrate `dashboard/page.tsx` and `admin/page.tsx`, then delete the old signature.
- [ ] Create `src/components/UsageDashboard.tsx`, one presentational component for every scope, built from `Stat`, `Card`, `Empty`, and `UsageChart`.
  - [ ] A user scope shows today's four stats plus `사용 한도`, whose value is the cap or `없음` and whose sub line is `남은 금액 <x> · 진행 중 <y>`, or `한도 초과 <x>` when over.
  - [ ] A team scope shows `팀 누적 비용`, `생성 횟수`, `생성한 영상 길이`, and `진행 중`, then the card `팀원별` with the columns `팀원`, `생성`, `완료`, `비용`, `진행 중`, and `마지막 생성`.
  - [ ] The all scope adds the card `팀별` with the columns `팀`, `인원`, `비용`, and `진행 중`.
- [ ] Turn `src/app/(app)/dashboard/page.tsx` into the tabs `내 사용량` and `팀 사용량`, read from `?scope=mine` or `?scope=team` and resolved with `viewerScope`. `내 사용량` keeps `최근 생성 20건`. Without a team, `팀 사용량` shows `아직 팀이 없습니다. 관리자가 팀을 정하면 팀 사용량이 여기 보입니다.`
- [ ] Add the tab `비용` to `AdminPanels.tsx`. `admin/page.tsx` computes `usageFor({ kind: "all" })` on the server and passes it down.
- [ ] Create `src/app/(app)/admin/users/[id]/page.tsx`.
  - [ ] Re-check the admin role from the users row, as `admin/page.tsx` does, and redirect anyone else to `/dashboard`. Resolve the target with `adminScope` and answer `notFound()` for an unknown id.
  - [ ] Show the username as the h1, a link `사용자 목록으로` to `/admin`, `UsageDashboard` for the user, and then the card `생성 로그` with `LogsPanel` fixed to that user.
  - [ ] Give `LogsPanel` an optional `userId` prop that fixes the user filter and hides the user select. The model and status filters and the CSV link keep working.
- [ ] Create `src/app/(app)/admin/teams/[id]/page.tsx` the same way, with the team name as the h1 and `UsageDashboard` for the team.
- [ ] Link the pages. Each `UsersPanel` row gets a link `사용량 · 로그`, with the accessible name `<username> 사용량 · 로그`, to `/admin/users/<id>`. Each `TeamsPanel` row gets a link `대시보드` to `/admin/teams/<id>`.
- [ ] Create `scripts/usage-check.ts`. It creates lane users in two teams with `lane-users.ts`, inserts rows with known statuses, costs, and snapshots straight into `generations`, asserts `usageFor` for each user, each team, and all, and deletes everything in `finally`. Team totals must equal the sum of their member rows, and the all scope must equal the `팀별` rows plus `팀 없음`.
- [ ] Update the harness. `journeys/dashboard.mjs` checks `사용 한도` and the team tab. The new `journeys/admin-user.mjs` covers `adm-user-page`, `adm-team-page`, and `adm-cost` and opens a lane user's page from the users table. Update `features/dashboard.md` with `dash-cap` and `dash-team`, `features/admin.md` with the three admin features, and `features/README.md`.
- [ ] Update the `/dashboard` and `/admin` rows of the route table in `README.md`.

**You see.**

- [ ] A lane member of a 3-person team opens `대시보드`, clicks `팀 사용량`, and sees `팀 누적 비용` equal to the sum of the `팀원별` rows.
- [ ] In 어드민, `사용량 · 로그` on a lane user's row opens `/admin/users/<id>`. Its stats match that user's row in `/api/admin/users`, and `생성 로그` lists only that user's rows.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/usage-check.ts` passes. Run `npx dotenv -e .env.local -- tsx scripts/usage-check.ts`.
- [ ] Run `node --test --import tsx src/lib/*.test.ts`, `npm run typecheck`, and `npm run lint`.
- [ ] `vgs run dashboard` passes as a lane member with a team, and `VGS_LANE_PREFIX=<prefix> vgs run admin-user` passes as `admin`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. A lane user with known completed and failed rows opens `대시보드` on trunk and on head. Save `at5-mine.png`. Pass when `누적 비용`, `생성 횟수`, and `생성한 영상 길이` match on both, and head adds `사용 한도`.
- [ ] Lane 2. A member of a 3-person lane team opens `팀 사용량`. Save `at5-team.png`. Pass when `팀 누적 비용` equals the sum of the `팀원별` rows, and each row equals that user's `spentUsd` in `/api/admin/users`.
- [ ] Lane 3. A lane user without a team opens `팀 사용량`. Save `at5-no-team.png`. Pass when it shows `아직 팀이 없습니다. 관리자가 팀을 정하면 팀 사용량이 여기 보입니다.`
- [ ] Lane 4. A team A member opens `/dashboard?scope=team&teamId=<team B id>` and `/dashboard?scope=all`. Save `at5-tamper.png`. Pass when the first shows team A and the second shows `내 사용량`.
- [ ] Lane 5. As `admin`, click `사용량 · 로그` on a lane user's row. Save `at5-admin-user.png`. Pass when the URL is `/admin/users/<id>`, the stats match that user's row in `/api/admin/users`, and `생성 로그` lists only that user's rows with the model and status filters working.
- [ ] Lane 6. As `admin`, click `대시보드` on a lane team in the tab `팀`. Save `at5-admin-team.png`. Pass when `/admin/teams/<id>` shows the same totals and `팀원별` rows as a member's `팀 사용량`.
- [ ] Lane 7. As `admin`, open the tab `비용`. Save `at5-admin-cost.png`. Pass when the `팀별` rows plus `팀 없음` add up to the overall totals.
- [ ] Lane 8. A lane user has one live row under `FAKE_HF_DURATION_MS=60000`, and the lane reloads `대시보드` before and after it completes. Save `at5-reserved.png`. Pass when the amount shows under `진행 중` first and under `누적 비용` after.
- [ ] Lane 9. Open `팀 사용량` and `/admin/users/<id>` with `VGS_MOBILE=1`. Save `at5-mobile.png`. Pass when the tables scroll inside their cards and the page has no horizontal scroll.
- [ ] Lane 10. A non-admin lane user opens `/admin/users/<id>` and `/admin/teams/<id>`. Save `at5-member-denied.png`. Pass when both redirect to `/dashboard` and the response carries none of the target's data.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. The time to first byte of `GET /dashboard` for a lane user on trunk and on head, where head adds the budget read. The diff also adds `GET /dashboard?scope=team` and `GET /admin/users/<id>`, which trunk lacks.
- [ ] Probe. Run `perf-probe.ts --a http://localhost:3201 --b http://localhost:3202 --path /dashboard --n 30` three times against the two `next start` builds. At head, run `perf-probe.ts --a http://localhost:3202 --a-path /dashboard --b http://localhost:3202 --b-path "/dashboard?scope=team" --n 30` and `perf-probe.ts --admin --a http://localhost:3202 --a-path /admin --b http://localhost:3202 --b-path /admin/users/<id> --n 30` three times each.
- [ ] Baseline. Record the trunk `/dashboard` p50 and p95 first.
- [ ] Rule. Fail when the head `/dashboard` p50 exceeds the trunk p50 by more than 2 database round trips, or when the team tab or the per-user page p95 exceeds the head `/dashboard` p95 by more than 3 round trips.

**Review gate.** The operator reviews before merge.

- [ ] Copy the lane 2, 5, and 7 screenshots into `.impeccable/review/at-5-review-team.png`, `.impeccable/review/at-5-review-admin-user.png`, and `.impeccable/review/at-5-review-cost.png`.
- [ ] Record a 30 to 60 second video with `VGS_VIDEO=1` of a member's two dashboard tabs and the admin's path from the users table to a per-user page. Save it as `.impeccable/review/at-5-review.webm`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto AT-4's branch after the verdict, patch-id unchanged.
- [ ] The root stops at verified and green and hands AT-5 to the operator, who lands the stack bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] `lane-users.ts list --prefix vgs-lane-` prints nothing, so no lane account, team, or row is left in the shared database.
- [ ] Reply to the operator with the report the execution playbook names, which lists each PR with its verdict.

## Appendix A. Prototype evidence

One question could not be settled by reading code alone, so a read-only prototype settled it. Does PR #11's database client break drizzle transactions, which the cap check needs?

- Run. `node docs/plans/admin-teams-caps/proto-tx-serializers.mjs .env.local` on 2026-10-29 from this PC, against the shared Supabase database through the transaction pooler, on branch `plan-admin-teams-caps`. Every transaction in it starts with `set transaction read only`, and nothing outside a transaction writes. The output is `docs/plans/admin-teams-caps/proto-tx-serializers.out.txt`.
- Finding 1. With `createDb()` copied from `origin/fix-db-pool`, a jsonb parameter is a JSON object on the pooled client (`jsonb_typeof` returns `object`) and a JSON string inside `db.transaction()` (`string`). An INSERT of `params`, `image_refs`, or `video_refs` inside a transaction would store a string. `buildArguments` would then read a string, and the submit would be rejected or wrong.
- Finding 2. Typed selects return the same shapes inside and outside a transaction. `created_at` is a `Date`, `params` is an object, and `cost_usd` is a string.
- Finding 3. Copying the pooled client's `options.parsers` and `options.serializers` onto the transaction client after `drizzle()` makes the transaction answer `object`. AT-1's second Build box is that fix.
- Finding 4. A read-only transaction with `set local lock_timeout`, an advisory lock, and a per-user sum took 105 to 136 ms from this PC in two committed runs of 8 samples, against 31 to 44 ms for the sum alone. A first run from the scratchpad measured 38 against 12 ms. In every run the difference was 2.2 to 2.7 times the round trip of the sum alone, so the cost is network round trips, not server time. `explain (analyze)` of the per-user sum reported 0.065 ms of execution over 16 rows. The output file holds the last run.
- Finding 5. The database held 11 MB, 16 generations, and 2 users during the last run. Another agent was writing rows at the time, and the count grew from 1 to 16 across the three runs.
- Code reading that explains finding 1. In drizzle-orm 0.45.4, `construct()` in `postgres-js/driver.js` installs pass-through parsers for the date and time types and pass-through serializers for types 114 and 3802 on the `options` of the client it wraps, and only that one. In postgres-js 3.4.9, `Bind()` in `src/connection.js` serializes each parameter by the type the server described, and the default serializer for jsonb is `JSON.stringify`. Drizzle's `PgJsonb.mapToDriverValue` already returns `JSON.stringify(value)`, so the transaction client encodes the value a second time.
- Code reading for Appendix B. Drizzle 0.45.4's `$with(...).as()` accepts an update builder, because `PgUpdateBase` has `getSelectedFields()`. Design B is expressible with typed builders.

These stay unproven until a PR runs them.

- Contention on Vercel. PR #11 gives each warm instance one transaction connection, so admissions on one instance queue. AT-1's perf block bounds the local cost. Production numbers come from the Vercel logs after deploy.
- The production round trip between `icn1` and the Seoul pooler. The estimate of about 5 ms per admission in Appendix B and Appendix C assumes a 1 to 2 ms round trip, which nobody measured.
- Whether a lock-free admission overshoots in practice on the pooler. AT-1's mutation run of `capRace` answers it.
- Whether PR #14 adds a migration numbered `0005`.
- The look of the dialog, the bulk bar, the team tabs, and the dashboards. No visual prototype was built. The review gates of AT-2 to AT-5 show them to the operator before merge.

## Appendix B. Alternatives rejected

This appendix is the architect rationale for the data shape. The run could not spawn subagents, so the architect skill's arena of runner models did not run. I designed two structurally different candidates myself, screened both against `architect/references/design-red-flags.md`, and kept the comparison here.

### Problem

A cap must hold under concurrent submits from several Vercel instances, across PR #12's pending and resubmit flow, and across crashes between any two statements. Spend must count completed charges plus the estimate of every live row. The database is shared and on the Free plan, so every migration is additive. `src/lib/generations.ts` is the only writer of `generations` rows, and the ESLint rule enforces that for updates.

### Design A, chosen. Derive spend from rows and admit under a row lock

- Shape. `teams`, `users.team_id`, `users.spend_cap_usd`, and `generations.price_per_sec_usd` as a price snapshot written at insert (Appendix E). There is no counter.
- Admission. One transaction in `submitGeneration` locks the user row, sums spent and reserved, compares in SQL numeric, and inserts.
- Release. No write. A terminal move already sets `cost_usd` to 0 for failed, canceled, and NSFW rows, and a terminal row leaves the live set, so the reserved sum drops by itself. Completion charges `price_per_sec_usd × duration_s`, the same amount it reserved.
- Convergence. Nothing can drift, because there is nothing stored to converge. A crash before COMMIT leaves no row and nothing counted. A crash after COMMIT leaves a pending row that counts, and the existing resubmit flow carries it forward. A resubmit never inserts and never re-checks.
- Interface depth. Callers still call `submitGeneration(user, req, schedule)` and now receive `{ row, budget }` or an `HttpError` with a `SubmitBlock`. The lock, the sum, the snapshot, and the comparison stay inside one function. Readers use three SQL fragments from `spend.ts`.
- Cost. One transaction per submit, measured at 26 to 90 ms more from this PC, which is 2.2 to 2.7 round trips (Appendix A), and estimated near 5 ms more in production. It also needs the transaction client fix, and admissions on one instance queue on PR #11's one transaction connection.

### Design B, rejected. Keep a spend counter on users, maintained by single-statement CTEs

- Shape. `users.committed_usd numeric not null default 0` beside the cap, and `generations.team_id` stamped at submit so team history stays put.
- Admission. One statement, `with r as (update users set committed_usd = committed_usd + $est where id = $u and (spend_cap_usd is null or committed_usd + $est <= spend_cap_usd) returning id) insert into generations ... select ... from r returning *`. Under READ COMMITTED, the UPDATE re-evaluates its WHERE against the newest committed version of the locked row, so concurrent admissions serialize without a transaction.
- Release. Every terminal move in `apply()` becomes `with m as (update generations ... returning user_id, price_per_sec_usd * duration_s as est) update users set committed_usd = committed_usd - m.est from m where ...` for failed, canceled, and NSFW rows. Drizzle 0.45's `$with().as()` takes an update builder, so this stays typed.
- Convergence. Each counter change shares a statement with the status change it accounts for, so retries and crashes cannot split them. It still drifts whenever anything writes `generations` outside those statements, and four scripts do. `mock.ts` inserts and deletes rows, and the cleanups of `lifecycle-check.ts`, `burst.ts`, and `lane-users.ts` delete them. Design B therefore also needs a backfill in the migration and a reconcile query in the sweep that compares the counter with the derived sum.
- Why it lost. It keeps two sources of truth for one fact, which the red-flag list calls split ownership and a hand-synced list. It adds a write to every terminal move, and every future writer must know the counter exists. Its O(1) admission buys nothing here. The per-user sum executes in 0.065 ms, and Design A's cost is round trips that Design B mostly avoids only by moving work into every release.

### Synthesis decision

Design A is the base. From Design B I took the single-statement discipline for every state change outside admission, so releases stay inside the one existing `apply()` UPDATE. I left team stamping out and made it Appendix F, decision 1, because it is a product call, not a storage need.

### Tradeoffs accepted

- We accept a transaction per submit, a few milliseconds in production, in exchange for one source of truth that cannot drift.
- We accept that completion no longer re-reads the model price, in exchange for a charge that equals the reservation and the estimate the user saw. A price change applies to the next admission.
- We accept the transaction client fix as part of AT-1, in exchange for not inventing a lock-free admission.
- We accept no new index, in exchange for nothing to maintain at about 300 rows a month (Appendix C, risk 13).

### Other alternatives

- One `insert ... select` that checks the sum, with no lock. Under READ COMMITTED each statement reads a snapshot taken when it starts, so two concurrent submits both see the old sum and both insert.
- Lock and sum in one statement, as a CTE with `for update`. The sum's snapshot still predates the lock wait, so the race stays. The lock must be its own statement, and the sum must run after it.
- A SERIALIZABLE transaction with retries. It is correct, but it needs a retry loop around serialization failures, while the row lock is simpler and also reads the key and the cap.
- `pg_advisory_xact_lock(user_id)`. It serializes the same way. The users-row lock won because the same statement returns the current key and cap.
- Keeping the reservation in `cost_usd` while a row is live. That is one column fewer, but `publicGeneration` shows `cost_usd` as 비용 on live rows, and the column's meaning would depend on status.
- Re-pricing at completion, which is today's behavior. A price rise between submit and completion would push committed spend past a cap after admission.
- A `team_members` join table. "At most one team" would need a unique constraint, while `users.team_id` says it by construction.
- A server-side "all users" bulk form. The explicit id list is exactly what the admin selected, and lanes cannot reach real users through it.
- JSON routes for dashboards. Server components read `stats.ts` directly, so no new member-facing route needs a guard.
- A caps history table. A cumulative cap that never resets needs only its current value.

## Appendix C. Risks

1. PR #11 changes before it lands, and the transaction client fix no longer fits. AT-1's owner re-runs `proto-tx-serializers.mjs` and `db-check.ts` on `master` before editing (AT-1).
2. Each warm instance has one transaction connection, so admissions on one instance queue. Each admission holds it for six statements, measured at 2.2 to 2.7 round trips more than one statement from this PC (Appendix A). The production cost is estimated near 5 ms per admission, not measured. After deploy, the owner of AT-1 reads `POST /api/generations` p95 in the Vercel logs and raises the transaction client's `max` if it grows with load (AT-1).
3. A lock wait longer than 5 s answers 503. Only one user's own concurrent submits wait on each other, so this needs a stuck transaction (AT-1).
4. In-process race tests pass even without the lock, because PR #11's transaction client has one connection. `capRace` uses child processes, and the mutation run proves it fails without `.for("update")` (AT-1).
5. Lanes run against the shared production database. A dead lane leaves accounts and rows with fake request ids, and production cron would ask the real Higgsfield about them with a fake key and fail them. The tick's `lane-users.ts list` and `delete` remove them within an hour (all PRs).
6. The price and model-toggle windows touch the shared `models` table (Appendix F, decision 7). The windows are bounded and restored in `finally` (all PRs).
7. PR #14 may add its own `0005` migration. AT-1's owner regenerates after rebasing onto `master` and before applying (AT-1).
8. Caps block nothing while every price is 0, which is the state today. The zero-price notice in 어드민 says so. The operator must enter prices for caps to take effect (AT-3).
9. Rows live at deploy time have a snapshot of 0 and complete at 0. Prices are 0 today, so nothing changes. If the operator enters prices before AT-1 deploys, run this once right after the deploy. `update generations g set price_per_sec_usd = m.price_per_sec_usd from models m where g.model_id = m.model_id and g.status in ('pending','queued','in_progress') and g.price_per_sec_usd = 0` (AT-1, `README.md`).
10. The team tab shows teammates' prompts, references, and parameters. That is the requested behavior. If some reference must stay private inside a team, the operator says so before AT-4 merges (AT-4).
11. A demoted admin's session token says admin for up to 7 days, and `proxy.ts` lets it reach `/admin/*`. Every admin page and route re-reads the role from the users row, and AT-5's new pages must do the same (AT-5).
12. Mock rows (`[목업]`) carry nonzero `cost_usd`, so they count toward the mock user's spend and team totals. Clear them with `npm run db:mock -- --clear` after use (AT-5).
13. No new index. The per-user sum ran in 0.065 ms. When `generations` passes 100,000 rows, add `(user_id) include (status, cost_usd, price_per_sec_usd, duration_s)` in a new migration (AT-1).
14. A bulk action without the filter would change real users. `journeys/teams.mjs` refuses to click unless every visible row carries `VGS_LANE_PREFIX`, and the boot recipe forbids it (AT-3).
15. Moving a user between teams moves their history between team views (Appendix F, decision 1). If the operator wants history to stay, AT-4 gains a stamped `generations.team_id` and a migration (AT-4).

## Appendix D. Links and reading list

- The previous program's plan and its conventions are in `docs/plans/generation-pipeline.md`.
- Read this code before editing. `src/lib/generations.ts` (`submitGeneration`, `resubmit`, `send`, `decide`, `apply`, `claimSubmit`), `src/db/index.ts` on `master` after PR #11, `src/db/schema.ts`, `src/lib/stats.ts`, `src/lib/auth.ts`, `src/proxy.ts`, `src/app/api/generations/route.ts`, `src/app/api/admin/**`, `src/components/Playground.tsx`, `src/components/Gallery.tsx`, `src/components/admin/*.tsx`, `src/app/(app)/dashboard/page.tsx`, `scripts/lifecycle-check.ts`, and `scripts/burst.ts` (how it creates and deletes users).
- Read `PRODUCT.md` and `DESIGN.md`. DESIGN.md calls the gallery, dashboard, and admin pages 문서형 페이지 and builds them from `PageContainer`, `Card`, `Stat`, and `Empty`. The brief's "Operate mode" means those pages.
- Read the control skill, `.claude/skills/verify-video-gen-studio/SKILL.md` and its `features/` map.
- Per `AGENTS.md`, read the Next.js 16 guide in `node_modules/next/dist/docs/` before writing pages or routes. AT-4 and AT-5 use `searchParams` as a promise, `redirect()`, and `notFound()`, and AT-2 uses `router.refresh()`.
- The prototype is `docs/plans/admin-teams-caps/proto-tx-serializers.mjs`, with its output beside it.
- AT-1's owner runs the `how` skill over `submitGeneration`, `resubmit`, `apply`, and `src/db/index.ts` before editing, and the `interrogate` skill on the admission transaction at the code-ready head. AT-4's and AT-5's owners run `interrogate` on `src/lib/scope.ts`.
- The root keeps the decision trail per `pstack/skills/show-me-your-work/SKILL.md` in `docs/plans/admin-teams-caps.trail.tsv` and deletes it when the program closes.

## Appendix E. Data shape, derived spend, and access rules

### Data shape, added by AT-1

```ts
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// users gains two columns
teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }), // at most one team, by construction
spendCapUsd: numeric("spend_cap_usd", { precision: 10, scale: 4 }), // null = no cap; check (spend_cap_usd >= 0)

// generations gains one column
/** The model's price when this row was admitted. Live rows reserve price × duration_s; completion charges the same. */
pricePerSecUsd: numeric("price_per_sec_usd", { precision: 10, scale: 4 }).notNull().default("0"),
```

The migration `drizzle/0005_teams_caps.sql` holds only `CREATE TABLE "teams"`, three `ADD COLUMN`, the foreign key, and the check constraint. Postgres adds a column with a constant default without rewriting the table.

### Derived spend

| Term | Definition |
|---|---|
| spent | `sum(cost_usd)` over the user's rows with status `completed` |
| reserved | `sum(price_per_sec_usd * duration_s)` over the user's rows in `LIVE_STATUSES` (`pending`, `queued`, `in_progress`) |
| committed | spent plus reserved |
| remaining | cap minus committed, or none without a cap |

`src/lib/spend.ts` defines these once as SQL fragments, and the owner, `stats.ts`, and the admin routes read them. Admission keeps one invariant. After every admission, committed is at most the cap. Completion charges exactly what the row reserved, and every other terminal status charges 0, so committed never rises after admission. Only an admin lowering the cap can leave a user over it.

### Admission

```sql
begin;
set local lock_timeout = '5s';
select api_key_enc, spend_cap_usd from users where id = $user for update;
select coalesce(sum(cost_usd) filter (where status = 'completed'), 0) as spent,
       coalesce(sum(price_per_sec_usd * duration_s) filter (where status in ('pending','queued','in_progress')), 0) as reserved
  from generations where user_id = $user;
-- fits = cap is null or spent + reserved + $price * $duration <= cap, computed in SQL numeric
insert into generations (..., price_per_sec_usd) values (..., $price) returning *;   -- only when fits
commit;
-- send() to Higgsfield runs after commit, never inside the transaction
```

The lock comes first and the sum is a separate statement. Under READ COMMITTED, the sum's snapshot starts after the lock is granted, so it sees every admission that held the lock before it.

### Behavior at the edges

- A pending row and its resubmits. The cap check runs once per row, at insert. `resubmit`, `send`, `settle`, `sweep`, and `onProviderHook` never insert and never re-check, so a row counts once in reserved however often it is sent. It leaves reserved when it reaches a terminal status. A completed row moves the same amount into spent. A failed row, from a rejection or the 30-minute deadline, and a canceled row release it.
- An admin lowers a cap below committed spend. The change is allowed. Live rows continue and are charged, and nothing is canceled. The next submit is refused, 어드민 shows `한도 초과`, and the user's `사용 한도` shows `한도 초과 <x>`.
- A price changes between submit and completion. The row is charged its snapshot. The new price applies from the next admission.
- Prices are 0. The estimate is 0, so a submit fits whenever committed is at most the cap. With no past spend, caps block nothing, and 어드민 says so. A cap of 0 blocks every paid submit. A user already over the cap is refused even a 0 USD submit (Appendix F, decision 2).
- A lock wait passes 5 s. The submit answers 503 `다른 생성 요청을 처리하는 중입니다. 잠시 후 다시 시도하세요`, and nothing was inserted.
- The key. Admission reads `api_key_enc` under the lock and `send()` uses that key, so a key removed a moment earlier refuses with `no_api_key`. Resubmits keep reading the owner's current key through `ownerKey()`, as today.

### Usage, the caller's view

```ts
// src/app/api/generations/route.ts, POST (AT-1)
const { row, budget } = await submitGeneration(user, { spec, prompt, params, imageUrls, videoUrls }, after);
// a refusal throws HttpError(status, message, block); errorResponse sends { error, block }

// src/components/Playground.tsx (AT-2)
const block = parseSubmitBlock(body.block);
if (block) setBlocked(block); // <BlockedDialog block={blocked} onClose={...} />

// src/app/(app)/gallery/page.tsx (AT-4)
const scope = viewerScope(user, name) ?? viewerScope(user, "mine")!;
const rows = await db.select(...).from(g).where(and(scopeWhere(scope), eq(g.status, "completed")));

// src/app/(app)/dashboard/page.tsx (AT-5)
const usage = await usageFor(scope); // members for a team, budget for a user
```

### Types

```ts
// src/lib/spend.ts (AT-1)
export const rowCostUsd: SQL<string>;  // price_per_sec_usd * duration_s
export const spentUsd: SQL<string>;
export const reservedUsd: SQL<string>;
export type Budget = { capUsd: number | null; spentUsd: number; reservedUsd: number };
export function remainingUsd(b: Budget): number | null;
export function budgetOf(userId: number): Promise<Budget>;

// src/lib/submit-block.ts (AT-1)
export type SubmitBlock =
  | { code: "no_api_key" }
  | { code: "spend_cap"; capUsd: number; spentUsd: number; reservedUsd: number; estimateUsd: number }
  | { code: "model_disabled"; modelId: string };
export function parseSubmitBlock(x: unknown): SubmitBlock | null;

// src/lib/generations.ts (AT-1)
export type Admission = { row: Generation; budget: Budget };
export function submitGeneration(user: User, req: GenerationRequest, schedule: Scheduler): Promise<Admission>;

// src/lib/scope.ts (AT-4)
export type Scope = { kind: "user"; userId: number } | { kind: "team"; teamId: number } | { kind: "all" };
export type ScopeName = "mine" | "team" | "all";
export function viewerScope(viewer: User, name: ScopeName): Scope | null;
export function adminScope(viewer: User, target: { userId: number } | { teamId: number }): Scope | null;
export function scopeWhere(scope: Scope): SQL | undefined;
```

### Access rules

| Route or page | Who | What it returns | Guard | PR |
|---|---|---|---|---|
| `POST /api/generations` | any signed-in user | own admission, refusals carry `block` | `requireUser()` | AT-1 |
| `/playground` | any signed-in user | own budget | `proxy.ts` session, `getCurrentUser()` | AT-2 |
| `GET /api/admin/users`, bulk `PATCH /api/admin/users` (new) | admin | every user, changes by explicit ids | `requireAdmin()` | AT-3 |
| `GET` and `PATCH /api/admin/users/[id]` | admin | adds cap, team, and budget | `requireAdmin()` | AT-3 |
| `GET` and `POST /api/admin/teams`, `PATCH` and `DELETE /api/admin/teams/[id]` (new) | admin | teams | `requireAdmin()` | AT-3 |
| `/gallery?scope=` | member and admin | own, own team, or all for admins | `proxy.ts` session, `getCurrentUser()`, `viewerScope()` | AT-4 |
| `/dashboard?scope=` | member and admin | own or own team | `proxy.ts` session, `getCurrentUser()`, `viewerScope()` | AT-5 |
| `/admin`, tab `비용` | admin | all | `proxy.ts` role, page role re-check | AT-5 |
| `/admin/users/[id]`, `/admin/teams/[id]` (new) | admin | one user or one team | `proxy.ts` role, page role re-check, `adminScope()` | AT-5 |

Unchanged routes keep their rules. `GET /api/generations` and `GET` and `DELETE /api/generations/[id]` serve the caller's own rows, plus any row for an admin's GET. `GET /api/admin/generations` stays admin-only and already filters by `userId`. Uploads, the webhook, the cron route, and the auth routes do not change.

`proxy.ts` does not change. Its matcher already covers `/admin/:path*`, `/gallery/:path*`, and `/dashboard/:path*`, so the new admin pages inherit its redirect of non-admins to `/dashboard`. It checks only the signed session token, never `/api/*`, and never a query string. Every page and route re-reads the users row through `getCurrentUser()`, `requireUser()`, or `requireAdmin()`. A member's team id comes from that row, never from the URL, so `?teamId=` has no effect.

### Indexes

No migration adds an index. `generations_user_created_idx (user_id, created_at)` serves the per-user sum, the per-user log, and the team queries, which select the team's user ids from the 20-row `users` table first. `generations_status_idx` serves status filters. The per-user sum executed in 0.065 ms (Appendix A), and the projection is about 300 rows a month. Appendix C, risk 13, names the index to add at 100,000 rows.

### Lane accounts

`scripts/lane-users.ts` is the only way lanes create and delete accounts. It is safe to rerun, and a prefix marks its leftovers as stale.

- `create --prefix <p> --count <k> [--key] [--cap <usd>] [--team]` creates `<p>01` to `<p><k>` with random passwords, written to `.verify/<p>users.json`. `--key` encrypts `fake:<username>` the way the admin screen does. `--team` creates the team `<p>team` and puts every created user in it. It refuses a prefix that already has users.
- `cap --prefix <p> --usd <amount or none>` sets every matching user's cap.
- `list --prefix vgs-lane-` prints each live prefix with its user, row, and team counts.
- `delete --prefix <p>` deletes the generations of matching users, then the users, then teams whose names start with `<p>`, and prints `left <n> users, <n> rows, <n> teams`. It exits 1 unless all three are 0.
- Every command refuses a prefix that does not match `^vgs-lane-[a-z0-9-]+-$`, and refuses any row for `ADMIN_USERNAME` or `jeongjun@the-prompt.me`.

## Appendix F. Decisions only the operator makes

Each PR applies the default below. The operator can say any of the alternatives in their own words, and the owner of the named PR changes course.

1. Team views follow current membership (AT-4, AT-5). A user's videos and spend show under the team they are in now, so moving a user moves their history. The alternative is to stamp `generations.team_id` at submit, so history stays with the team it was made in. That adds a column, a migration, and a rule for rows made before the user joined a team.
2. A user already over the cap is refused even a 0 USD submit (AT-1). The rule is spent plus reserved plus the estimate must not exceed the cap. The alternative is to let a 0 USD estimate through whenever the cap is already exceeded.
3. A row is charged the price its model had at submit, not at completion as the code does today (AT-1). The alternative is to re-price at completion and accept that a price rise can push a user past their cap.
4. AT-1 applies the additive migration `0005` to the shared production database at its code-ready head, before the operator merges, because its live lanes need the columns (AT-1). Production code on `master` ignores the new columns. The alternative is to apply it only after the merge, and to run AT-1's live lanes after that.
5. The transaction client fix lands in AT-1 (AT-1). The alternative is to fold those few lines into PR #11 before it merges, and AT-1 drops its `createDb()` box but keeps `scripts/db-check.ts`.
6. Members see teammates' spend in `팀원별` but not their caps (AT-5). The alternative is to show caps too.
7. Lanes may set the practice model's price to 0.0001 USD/s for under 2 minutes when it is 0, and switch the model off for under 10 seconds, as `lifecycle-check.ts` and the admin journey already do to the shared `models` table (all PRs). A real user who submits that model in the window is charged at most 0.001 USD, or sees the model-disabled dialog. The alternative is to run those lanes only in a window the operator announces, or never.
8. Admins can carry caps, and their own submits are checked like anyone's (AT-1, AT-3). The alternative is to exempt admins.
