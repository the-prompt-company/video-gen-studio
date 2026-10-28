# 생성 파이프라인 계획 (generation pipeline)

`generations` 행이 곧 작업이 된다. 행을 앞으로 움직이는 코드는 `src/lib/generations.ts` 하나뿐이고, 브라우저 폴링, Higgsfield 웹훅, 1분 크론이 모두 같은 함수를 부른다. 완료된 영상은 Supabase Storage(Pro)로 복사돼 7일 뒤에도 재생된다. 20명이 수백 건을 몰아 넣어도 429는 사용자에게 오류 대신 "제출 대기"로 보인다.
대상은 팀원 20명(영상이 사라지지 않고 탭을 닫아도 완료 처리됨)과 다음 담당 엔지니어(상태를 쓰는 곳이 한 군데)다.
지켜야 할 규칙은 하나다. 행의 상태는 앞으로만 움직이고, 같은 전이를 두 번 실행해도 결과가 같다.
PR 순서는 GP-1, GP-2, GP-3, GP-4, GP-5, GP-6이다.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `C:\Users\a\.claude\plugins\cache\cursor-plugins\pstack\0.15.36\skills\poteto-mode\playbooks/autopilot-stack.md`. 운영자(operator)가 PR을 직접 머지한다. 모든 PR은 merge-ready에서 멈춘다. GP-1, GP-4, GP-6은 화면 동작이 바뀌므로 review-gated다.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

이 저장소의 trunk 브랜치 이름은 `master`다. 아래 `origin/main`이라고 적힌 곳은 `origin/master`로 읽는다. pstack 스킬 파일은 저장소가 아니라 플러그인 캐시 `C:\Users\a\.claude\plugins\cache\cursor-plugins\pstack\0.15.36\skills\`에 있으므로 `git show` 대신 그 경로를 읽는다.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md` (플러그인 캐시의 같은 파일)
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md` (플러그인 캐시의 같은 파일)
  - [ ] `git show origin/main:.claude/skills/verify-video-gen-studio/SKILL.md` (이 저장소의 control skill)
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md` (플러그인 캐시의 같은 파일)
  - [ ] `git show origin/main:pstack/skills/principle-make-operations-idempotent/SKILL.md` 그리고 `principle-model-the-domain`, `principle-sequence-verifiable-units`, `principle-prove-it-works` (플러그인 캐시)
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] GP-1 and GP-2 are independent and first. Both branch from `master`.
  - [ ] GP-3 after GP-2.
  - [ ] GP-4 after GP-3.
  - [ ] GP-5 after GP-4.
  - [ ] GP-6 after GP-5.
- [ ] Hold the file boundaries. GP-1 touches only `src/components/Playground.tsx`, `scripts/mock.ts`, `.claude/skills/verify-video-gen-studio/**`. GP-2 touches only `scripts/fake-higgsfield.ts`, `src/lib/higgsfield.ts`, `package.json`, `.env.example`, `README.md`. GP-3 이후는 각 PR의 Files 블록만 만진다.
- [ ] Hold the review gate. GP-1, GP-4, GP-6 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use `gh pr create --base <base-branch>`. A stack child targets its parent branch.
- [ ] Run `npm run typecheck` and `npm run lint` once before the PR-facing push. Push with hooks on.
- [ ] 커밋 메시지는 저장소의 `house-style` 스킬 양식을 따른다. `/deslop`와 `/no-comments`는 이 환경에 없으므로 같은 기준(설명 주석 제거, 군더더기 제거)을 직접 적용하고 그렇게 했다고 PR 본문에 적는다.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`. Skipped in Claude Code when the PR has no Bugbot check.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per the swarm skill. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] 머지는 운영자가 한다. 루트는 검증된 PR을 base-branch 스택에 순서대로 쌓고, 운영자가 아래에서 위로 올린다. patch-id가 바뀌지 않은 리베이스는 판정을 유지한다.

### Boot recipe, for every live lane

각 라이브 레인은 이 PC의 git worktree 하나에서 돈다. 드라이브는 `.claude/skills/verify-video-gen-studio` (이하 `vgs`)로 한다.

- [ ] `git fetch origin <head-branch> && git worktree add ../lane-<n> <head SHA>` 뒤 `npm install`.
- [ ] GP-2 이후 레인은 가짜 Higgsfield를 먼저 띄운다. `npm run fake:hf` 그리고 `HIGGSFIELD_BASE_URL=http://localhost:4010`.
- [ ] `VGS_PORT=31<nn> node .claude/skills/verify-video-gen-studio/vgs.mjs launch` 뒤 `doctor`가 `ok: true`일 때만 진행한다.
- [ ] 입력은 `vgs run <journey>`와 `curl`로만 넣는다. 읽기 전용 진단은 `.verify/run/server-*.log`, 가짜 서버의 `GET /_stats`, `psql`의 SELECT다.
- [ ] 레인이 끝나면 `vgs stop`으로 자기 서버만 내린다. 증거는 `web/.verify/evidence/<run-id>/`에 남고, 스크린샷은 `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png`로 복사해 보고와 함께 경로를 돌려준다.

## 피드 폴링 id 고치기 (GP-1)

**Depends on.** None.

**Files.**

- [ ] Edit `src/components/Playground.tsx`.
- [ ] Edit `scripts/mock.ts`.
- [ ] Edit `.claude/skills/verify-video-gen-studio/journeys/playground.mjs`.
- [ ] Edit `.claude/skills/verify-video-gen-studio/features/playground.md`.

**Build.**

- [ ] `Playground.tsx`의 폴링 effect에서 `liveKey.split(",").map(Number)`를 `liveKey.split(",")`로 바꾼다. id는 uuid 문자열이다.
- [ ] `scripts/mock.ts`에 `status: "in_progress"`, `requestId` 없음인 `[목업]` 행 하나를 추가한다. 폴링이 관찰 가능해진다. `--clear`가 이 행도 지운다.
- [ ] `journeys/playground.mjs`에 `page.on("request")`로 `/api/generations/` 요청을 모아 모든 응답이 200이고 경로에 `NaN`이 없음을 단정하는 단계를 추가한다. `features/playground.md`의 Sub-features에 `pg-poll`을 적는다.

**You see.**

- [ ] 목업 live 행이 있는 상태에서 플레이그라운드를 열면 브라우저 네트워크 탭에 `GET /api/generations/<uuid>` 200이 2초, 3초, 4.5초 간격으로 찍힌다. 수정 전에는 `GET /api/generations/NaN` 500이 찍힌다(2026-10-28 `curl`로 확인한 응답 본문은 `Failed query ... params: NaN,1`).

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `journeys/playground.mjs`가 `pg-poll` 단계를 얻는다. Run `node .claude/skills/verify-video-gen-studio/vgs.mjs run playground` (목업 live 행을 `npm run db:mock`으로 넣은 뒤). PASS이고 `log.md`에 `poll requests N, all 200`이 남는다.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk와 head에서 목업 live 행을 넣고 플레이그라운드 저니를 돌려 폴링 요청 경로를 기록한다. Save `poll-trunk-vs-head.png`. Pass when trunk shows `/api/generations/NaN` 500 and head shows `/api/generations/<uuid>` 200.
- [ ] Lane 2. 데스크톱에서 플레이그라운드를 열고 30초 대기. Save `poll-desktop.png`. Pass when 요청 간격이 2000, 3000, 4500, 6750, 10000 ms 순서로 늘어나고 10000에서 멈춘다 (±300 ms).
- [ ] Lane 3. `VGS_MOBILE=1`로 같은 시나리오. Save `poll-mobile.png`. Pass when 모바일 레이아웃에서도 요청이 200이고 무대의 진행 표시가 보인다.
- [ ] Lane 4. live 목업 행 없이 로그인. Save `poll-none.png`. Pass when `/api/generations/` 폴링 요청이 0건이다.
- [ ] Lane 5. live 목업 행 3개. Save `poll-three.png`. Pass when 한 틱에 요청 3건이 나가고 모두 200이다.
- [ ] Lane 6. 폴링 중 탭을 갤러리로 이동했다가 돌아온다. Save `poll-navigate.png`. Pass when 돌아온 뒤 폴링이 2000 ms부터 다시 시작한다.
- [ ] Lane 7. `npm run db:mock -- --clear` 뒤 갤러리와 대시보드. Save `mock-cleared.png`. Pass when `[목업]` 행이 0건이고 콘솔 오류가 없다.
- [ ] Lane 8. 폴링 응답 본문. Save `poll-body.png`. Pass when 응답 JSON의 `item.id`가 요청 경로의 uuid와 같다.
- [ ] Lane 9. 관리자가 아닌 계정으로 같은 저니. Save `poll-user.png`. Pass when 본인 행만 폴링되고 200이다.
- [ ] Lane 10. 콘솔. Save `poll-console.png`. Pass when `console.txt`에 `pageerror`가 없다.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. live 행 1개를 30초 폴링하는 동안의 `/api/generations/` 요청 수. trunk와 head 모두 측정한다.
- [ ] Probe. 플레이그라운드 저니에 30초 대기와 요청 카운트를 넣고 trunk, head 순으로 번갈아 3회씩 돌린다.
- [ ] Baseline. Record the trunk 요청 수 first (예상은 head와 같은 6건, 응답 코드만 다름).
- [ ] Rule. head의 요청 수가 trunk의 요청 수 ±1 안에 있고 모두 200이면 통과. 요청 수가 2배 이상이면 실패.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 screenshot into `.impeccable/review/gp-1-review-poll.png`.
- [ ] Record a 30 to 60 second video of the change on a lane. Save it as `.impeccable/review/gp-1-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## 가짜 Higgsfield 레버 만들기 (GP-2)

**Depends on.** None.

**Files.**

- [ ] Create `scripts/fake-higgsfield.ts`.
- [ ] Edit `src/lib/higgsfield.ts`.
- [ ] Edit `package.json`.
- [ ] Edit `.env.example`.
- [ ] Edit `README.md`.

**Build.**

- [ ] `higgsfield.ts`의 `BASE`를 `process.env.HIGGSFIELD_BASE_URL ?? "https://api.higgsfield.ai"`로 바꾼다.
- [ ] `scripts/fake-higgsfield.ts`를 `node:http`로 쓴다. 포트 `FAKE_HF_PORT`(기본 4010). 엔드포인트는 `POST /<model id>`, `GET /requests/:id/status`, `POST /requests/:id/cancel`, `GET /media/:id.mp4`, `GET /_stats`, `POST /_reset`. `Idempotency-Key`가 같으면 같은 `request_id`를 돌려주고 본문이 다르면 422. `FAKE_HF_DURATION_MS`(기본 `3000-8000`) 뒤 `queued`에서 `in_progress`를 거쳐 `completed`가 되고 `video.url`은 자기 `/media/` URL, `expires_at`은 7일 뒤. `FAKE_HF_429_FIRST_N`은 키별 처음 N건에 429와 `Retry-After`를 준다. `?hf_webhook` 쿼리를 읽어 두었다가 종료 시 POST하고 `FAKE_HF_DROP_WEBHOOKS`(비율), `FAKE_HF_DUP_WEBHOOKS`(두 번 전송)를 지원한다. `FAKE_HF_VIDEO_BYTES`(기본 2 MB) 크기의 결정적 바이트를 `FAKE_HF_MEDIA_DELAY_MS` 지연 뒤 내려준다.
- [ ] `/_stats`는 idempotency 키별 수락 수, 키별 초당 상태 조회 수, 보낸 웹훅 수, 미디어 다운로드 수를 JSON으로 돌려준다.
- [ ] `package.json`에 `"fake:hf": "tsx scripts/fake-higgsfield.ts"`를 넣는다. `.env.example`과 README 로컬 실행 절에 `HIGGSFIELD_BASE_URL`을 적는다.

**You see.**

- [ ] `npm run fake:hf`가 `fake higgsfield on http://localhost:4010`을 찍고, `HIGGSFIELD_BASE_URL=http://localhost:4010 npm run dev`에서 가짜 키 `fake:key`를 가진 사용자가 생성하기를 누르면 무대의 항목이 대기, 생성 중, 완료 순으로 바뀐다(GP-1이 머지된 base에서).

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/fake-higgsfield.test.ts`(node test runner)가 같은 키 두 번 제출, 다른 본문 422, 429 N건, 웹훅 2회 전송을 단정한다. Run `node --test --import tsx scripts/fake-higgsfield.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk에는 가짜 서버가 없으므로 그 사실을 기록하고, head에서 `HIGGSFIELD_BASE_URL` 없이 띄운 서버가 실제 `api.higgsfield.ai`로 향함을 `server-*.log`의 요청 로그로 확인한다. Save `base-default.png`. Pass when 기본 BASE가 바뀌지 않았다.
- [ ] Lane 2. 가짜 키 사용자로 생성 1건. Save `fake-submit.png`. Pass when `/_stats`의 수락 수가 1이고 무대가 완료를 보인다.
- [ ] Lane 3. 같은 요청을 Idempotency-Key 재사용으로 `curl` 2회. Save `fake-idem.png`. Pass when `request_id`가 같고 수락 수가 1이다.
- [ ] Lane 4. `FAKE_HF_429_FIRST_N=1`. Save `fake-429.png`. Pass when 첫 제출이 502와 "큐가 가득 참" 문구를 보이고(현재 동작), 두 번째는 수락된다.
- [ ] Lane 5. 대기 중 취소. Save `fake-cancel.png`. Pass when 행이 취소로 바뀌고 가짜 서버 상태가 `canceled`다.
- [ ] Lane 6. `FAKE_HF_DURATION_MS=60000-90000`. Save `fake-long.png`. Pass when 60초 넘게 생성 중이 유지되고 그동안 서버 함수 호출마다 1초 안에 응답한다.
- [ ] Lane 7. 완료 후 다운로드 글리프. Save `fake-download.png`. Pass when `href`가 가짜 `/media/` URL이고 GET이 `FAKE_HF_VIDEO_BYTES` 바이트를 준다.
- [ ] Lane 8. `FAKE_HF_DUP_WEBHOOKS=1`로 제출. Save `fake-dup.png`. Pass when 가짜 서버가 웹훅 2건을 보냈다고 `/_stats`에 적고 앱은 아직 웹훅 라우트가 없어 404를 받는다(기록만).
- [ ] Lane 9. `POST /_reset` 뒤 `/_stats`. Save `fake-reset.png`. Pass when 모든 카운터가 0이다.
- [ ] Lane 10. 모바일 뷰포트로 Lane 2 반복. Save `fake-mobile.png`. Pass when 완료까지 도달한다.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 가짜 서버의 상태 조회 응답 시간 p95와, 앱의 `GET /api/generations/:id` 응답 시간 p95. trunk는 가짜가 없으므로 앱 쪽은 목업 행 조회로 같은 라우트를 잰다.
- [ ] Probe. `autocannon`이 아니라 `curl -w %{time_total}` 30회를 trunk, head 순으로 번갈아 돌리는 셸 루프.
- [ ] Baseline. Record the trunk `GET /api/generations/:id` p95 first.
- [ ] Rule. head의 앱 p95가 trunk p95의 1.2배를 넘으면 실패. 가짜 서버 자체는 p95 50 ms 이하.

**Review gate.** None. GP-2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## 생명주기 소유자를 하나로 만들기 (GP-3)

**Depends on.** GP-2.

**Files.**

- [ ] Create `src/lib/generation-status.ts`.
- [ ] Edit `src/lib/higgsfield.ts`.
- [ ] Edit `src/lib/generations.ts`.
- [ ] Edit `src/db/schema.ts`.
- [ ] Create `drizzle/0001_next_check_at.sql` (`npm run db:generate` 산출물).
- [ ] Edit `src/app/api/generations/route.ts`.
- [ ] Edit `src/app/api/generations/[id]/route.ts`.
- [ ] Edit `src/lib/format.ts`, `src/components/StatusBadge.tsx`, `src/components/admin/LogsPanel.tsx`, `src/components/Playground.tsx`.
- [ ] Edit `eslint.config.mjs`.
- [ ] Create `scripts/lifecycle-check.ts`.

**Build.**

- [ ] `generation-status.ts`에 `GENERATION_STATUSES` 튜플, `RANK`(queued 1, in_progress 2, 종료 3), `isLive()`, `predecessorsOf()`, `STATUS_LABEL`과 `STATUS_TONE`을 `Record<GenerationStatus, string>`으로 둔다. `format.ts`의 두 맵을 지우고 네 군데(`Playground.tsx`의 `LIVE`, `StatusBadge.tsx`, `[id]/route.ts`, `generations.ts`의 `TERMINAL`)가 이 모듈을 쓴다.
- [ ] `higgsfield.ts`는 와이어 JSON을 도메인 결과로 파싱한다. `SubmitOutcome`(accepted, deferred, rejected), `ProviderState`(running, completed, ended, missing), `ProviderUnavailable`. `HfSubmitResponse`와 `HfStatusResponse`는 모듈 내부로 숨긴다. `submit`은 `{ idempotencyKey, webhookUrl }`을 받고 `webhookUrl`이 있으면 `?hf_webhook=`을 붙인다. 상태 조회는 `AbortSignal.timeout(8000)`.
- [ ] `schema.ts`에 `nextCheckAt timestamptz NOT NULL DEFAULT now()`를 추가한다. 이 열은 "다음에 Higgsfield에 물어봐도 되는 시각"이자 claim이다.
- [ ] `generations.ts`를 소유자로 다시 쓴다. 공개 함수는 `submitGeneration`, `settle`, `cancelGeneration`, `publicGeneration`, `apiKeyFor`, `priceFor`. 내부는 순수 함수 `decide(row, observation, ctx)`가 전이표를 들고, `apply(row, step)`가 `UPDATE ... WHERE id = $1 AND status = ANY(predecessorsOf(to))`로 상태를 쓰는 유일한 문장이다. `refresh`는 `UPDATE SET next_check_at = now() + 15 s WHERE id AND status IN ('queued','in_progress') AND next_check_at <= now() RETURNING id`로 claim을 잡은 호출자만 Higgsfield를 부른다. 느린 후속 작업은 호출자가 넘긴 `Scheduler` 함수로 실행하고, 이 모듈은 `next/server`를 import하지 않는다. `syncStatus`와 `TERMINAL`은 지운다.
- [ ] `submitGeneration`은 행 id를 먼저 만들어 `Idempotency-Key`로 쓰고, 제출 뒤 insert한다(insert-first 전환은 GP-6).
- [ ] `GET /api/generations?ids=a,b,c`(최대 24개)를 추가한다. 소유 행을 모아 `settle`하고 `{ items }`를 돌려준다. `[id]` GET은 `settle` 한 줄이 되고, DELETE는 `cancelGeneration`을 부른다. 두 라우트 모두 id를 uuid 정규식으로 먼저 검사해 아니면 404를 준다. 지금은 잘못된 id가 500과 SQL 문자열을 그대로 노출한다(2026-10-28 `curl`로 확인).
- [ ] `Playground.tsx`의 폴링은 틱마다 요청 하나(`?ids=`)를 보내고, 지연은 `useRef`에 두어 live 집합이 바뀌어도 2초로 되돌아가지 않는다. 이 탭이 직접 제출했을 때만 2초로 초기화한다.
- [ ] `eslint.config.mjs`에 `no-restricted-syntax`로 `src/lib/generations.ts` 밖에서 `.update(schema.generations)`를 금지한다.
- [ ] `scripts/lifecycle-check.ts`는 가짜 서버와 `.env.local`의 DB로 아래 Verify, unit의 단정을 실행하고 첫 실패에서 0이 아닌 코드로 끝난다. 생성한 행은 끝에 지운다.

**You see.**

- [ ] 가짜 키 사용자가 생성하기를 누르면 무대가 대기, 생성 중, 완료로 바뀌고, 브라우저 네트워크 탭에는 틱마다 `GET /api/generations?ids=...` 하나만 보인다. `npm run lint`는 `generations.ts` 밖의 `.update(schema.generations)`를 `no-restricted-syntax` 오류로 막는다.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/lifecycle-check.ts`가 다음을 단정한다. 한 행에 `settle` 50개를 동시에 불러도 15초당 가짜 상태 조회는 1건이고 `completed_at`과 `cost_usd`는 한 번만 써진다. `in_progress`와 `completed` 관찰이 뒤바뀐 순서로 들어와도 행은 뒤로 가지 않는다. 취소와 완료가 경쟁하면 제공자 상태로 끝난다. `[목업]` 행(requestId 없음)은 Higgsfield 호출 0건. Run `HIGGSFIELD_BASE_URL=http://localhost:4010 npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts`.
- [ ] `src/lib/generation-status.test.ts`가 `predecessorsOf`와 `isLive`를 모든 상태에 대해 단정한다. Run `node --test --import tsx src/lib/generation-status.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk와 head에서 가짜 서버로 생성 1건을 완료까지 돌린다. Save `lifecycle-trunk-vs-head.png`. Pass when 두 쪽 모두 완료에 도달하고 head의 폴링 요청 수가 trunk 이하다.
- [ ] Lane 2. live 항목 5개를 한 탭에서 폴링. Save `batch-poll.png`. Pass when 틱마다 `?ids=` 요청 1건이고 `/_stats`의 상태 조회가 행당 15초에 1건 이하다.
- [ ] Lane 3. 같은 계정으로 탭 3개. Save `three-tabs.png`. Pass when `/_stats`의 행당 상태 조회가 여전히 15초에 1건 이하다.
- [ ] Lane 4. `GET /api/generations/not-a-uuid`를 `curl`. Save `bad-id.png`. Pass when 404이고 본문에 `Failed query`가 없다.
- [ ] Lane 5. 가짜 서버를 `FAKE_HF_DURATION_MS=20000`으로 두고 생성 중에 취소. Save `cancel-race.png`. Pass when 행이 취소 또는 완료 중 가짜 서버가 말한 쪽으로만 끝난다.
- [ ] Lane 6. 가짜 서버를 끈 채 폴링. Save `provider-down.png`. Pass when 폴링 응답이 200으로 현재 행을 돌려주고 콘솔 오류가 없다.
- [ ] Lane 7. 관리자가 다른 사용자의 행을 `[id]` GET. Save `admin-view.png`. Pass when 행을 읽을 수 있고 상태 조회는 소유자 키로 일어난다(`/_stats` 키별 카운트).
- [ ] Lane 8. 어드민 로그 탭과 대시보드 상태 배지. Save `labels.png`. Pass when 여섯 상태의 라벨과 색이 이전과 같다.
- [ ] Lane 9. 모바일 뷰포트로 Lane 2. Save `batch-mobile.png`. Pass when 동일.
- [ ] Lane 10. `npm run lint`에 두 번째 writer를 심은 브랜치. Save `lint-guard.png`. Pass when lint가 `no-restricted-syntax`로 실패한다.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. live 행 15개를 가진 사용자 1명의 60초 동안 앱 요청 수와 가짜 서버 상태 조회 수. trunk와 head 모두.
- [ ] Probe. `scripts/lifecycle-check.ts --measure`가 행 15개를 넣고 플레이그라운드 저니를 60초 돌린 뒤 두 수를 찍는다. trunk, head 번갈아 3회.
- [ ] Baseline. Record the trunk 요청 수 first (코드로 추정하면 60초에 약 200건 이상, 측정으로 대체).
- [ ] Rule. head의 앱 요청 수가 12건 이하(10초 간격 수렴)이고 상태 조회가 행당 4건 이하가 아니면 실패.

**Review gate.** None. GP-3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## 완료 영상을 Supabase Storage로 복사하기 (GP-4)

**Depends on.** GP-3.

**Files.**

- [ ] Create `src/lib/storage.ts`.
- [ ] Edit `src/lib/generations.ts`.
- [ ] Edit `src/db/schema.ts`.
- [ ] Create `drizzle/0002_storage.sql`.
- [ ] Edit `src/app/api/generations/route.ts`, `src/app/api/generations/[id]/route.ts`.
- [ ] Edit `src/components/Playground.tsx`, `src/components/Gallery.tsx`, `src/components/admin/LogsPanel.tsx`, `src/app/api/admin/generations/route.ts`.
- [ ] Edit `scripts/fake-higgsfield.ts`.
- [ ] Edit `package.json`, `.env.example`, `README.md`.

**Build.**

- [ ] `schema.ts`에서 `blob_url`을 지우고(쓰는 곳 없음) `storage_path text`, `size_bytes integer`, `mirror_attempts integer NOT NULL DEFAULT 0`, `mirror_next_at timestamptz`, `mirror_error text`를 추가한다. `storage_path`는 URL이 아니라 객체 키 `<id>.mp4`다. 인덱스는 추가하지 않는다(수천 행에 `status` 인덱스로 충분).
- [ ] `storage.ts`는 `@supabase/storage-js`로 `storageEnabled()`, `videoKey(id)`, `putVideo(key, bytes, contentType)`(upsert, Cache-Control 1년), `videoUrls(key, downloadName)`(공개 URL과 `?download=` URL)만 노출한다. 버킷 이름은 `SUPABASE_VIDEO_BUCKET`(기본 `videos`).
- [ ] `generations.ts`에 `storeVideo(row)`를 넣는다. claim은 `UPDATE SET mirror_attempts = mirror_attempts + 1, mirror_next_at = now() + greatest(360, least(60 * 2^attempts, 21600)) s WHERE id AND status = 'completed' AND result_url IS NOT NULL AND storage_path IS NULL AND (mirror_next_at IS NULL OR mirror_next_at <= now()) AND (expires_at IS NULL OR expires_at > now()) RETURNING *`. 360초는 모든 복사 라우트의 `maxDuration` 300초보다 길어 만료된 lease는 죽은 복사자를 뜻한다. 결과 URL을 `AbortSignal.timeout(240000)`으로 받아 메모리에 올리고(1 GB 초과 거부) upsert한 뒤 `storage_path`와 `size_bytes`를 쓴다. 실패하면 `mirror_error`만 쓴다. 한 줄 JSON 로그 `video_stored`에 `bytes`, `fetchMs`, `uploadMs`, `attempt`를 남긴다.
- [ ] `settle`은 완료 전이를 실제로 일으킨 호출자만 `Scheduler`로 `storeVideo`를 예약한다. 라우트는 `after`를 넘기고 `export const maxDuration = 300`을 둔다.
- [ ] `publicGeneration`은 `resultUrl`과 `expiresAt` 대신 `video: { kind: "stored", url, downloadUrl } | { kind: "provider", url, downloadUrl, expiresAt } | null`을 돌려준다. Playground, Gallery, LogsPanel, 어드민 CSV가 이 union을 쓴다. 갤러리 상세의 보관 행은 stored면 "영구", provider면 "<날짜>까지 · N일 남음".
- [ ] `Gallery.tsx`의 타일은 IntersectionObserver로 뷰포트 근처일 때만 `src`를 붙인다. 지금은 열 때마다 최대 120개 타일이 `preload="metadata"`로 메타데이터를 받는다.
- [ ] 가짜 서버에 Supabase Storage 부분집합(`POST|PUT /storage/v1/object/:bucket/*`, sha256과 크기 기록, 키별 쓰기 횟수)을 넣어 `SUPABASE_URL`을 가짜로 돌릴 수 있게 한다.
- [ ] README에 버킷 만들기(Supabase 대시보드에서 `videos` 공개 버킷), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_VIDEO_BUCKET`, 그리고 env가 없으면 복사를 건너뛰고 Higgsfield URL로 재생한다는 점을 적는다.

**You see.**

- [ ] 생성이 완료되면 몇 초 동안 Higgsfield(가짜) URL로 재생되다가 다음 폴링 응답부터 `video.url`이 `.../storage/v1/object/public/videos/<id>.mp4`로 바뀌고 갤러리 상세 보관 행이 "영구"가 된다. 서버 로그에 `{"evt":"video_stored","bytes":2097152,...}` 한 줄이 찍힌다.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/lifecycle-check.ts`에 다음 단정을 추가한다. 완료 행에 `storeVideo` 10개를 동시에 불러도 가짜 스토리지의 키별 쓰기는 1회. 객체 sha256과 `size_bytes`가 가짜 미디어와 같다. `FAKE_HF_MEDIA_DELAY_MS=250000`이면 `mirror_error`가 남고 lease 뒤 재시도가 성공한다. env 없이 돌리면 `storage_path`가 null로 남고 `video.kind`는 provider다. Run `HIGGSFIELD_BASE_URL=http://localhost:4010 SUPABASE_URL=http://localhost:4010 SUPABASE_SERVICE_ROLE_KEY=fake npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk는 복사 기능이 없다. 그 사실을 기록하고 head에서 생성 1건이 완료 뒤 60초 안에 `video.kind === "stored"`가 되는지 본다. Save `store-head.png`. Pass when 갤러리 상세가 영구를 보이고 객체가 존재한다.
- [ ] Lane 2. 20 MB 가짜 미디어(`FAKE_HF_VIDEO_BYTES=20971520`). Save `store-20mb.png`. Pass when `video_stored` 로그의 `bytes`가 20971520이고 `fetchMs + uploadMs < 30000`이다.
- [ ] Lane 3. 완료 직후 탭 2개가 동시에 폴링. Save `store-race.png`. Pass when 가짜 스토리지 키별 쓰기가 1회다.
- [ ] Lane 4. 스토리지 PUT이 500을 돌려주도록 가짜를 설정. Save `store-fail.png`. Pass when `mirror_error`가 남고 `mirror_next_at`이 최소 360초 뒤이며 화면은 provider URL로 재생된다.
- [ ] Lane 5. env 3개를 빼고 기동. Save `store-off.png`. Pass when 복사가 일어나지 않고 보관 N일 남음 라벨이 그대로다.
- [ ] Lane 6. 갤러리에 `[목업]` 완료 행 40개. Save `gallery-lazy.png`. Pass when 첫 화면에서 `<video src>`가 붙은 타일이 12개 이하다.
- [ ] Lane 7. 다운로드 버튼. Save `download.png`. Pass when 링크가 `?download=<id>.mp4`를 가지고 응답 헤더에 `Content-Disposition`이 있다.
- [ ] Lane 8. 어드민 CSV. Save `csv.png`. Pass when `result_url` 열이 stored URL이다.
- [ ] Lane 9. 모바일 갤러리 상세. Save `store-mobile.png`. Pass when 영구 라벨과 다운로드 버튼이 보인다.
- [ ] Lane 10. 실제 Supabase 버킷으로 프리뷰 배포에서 `[목업]` 프로브 행(`result_url`이 공개 100 MB mp4) 1건. Save `store-real.png`. Pass when `video_stored` 로그에 `fetchMs`와 `uploadMs`가 찍히고 둘의 합이 240000 미만이다. 이 레인이 복사 시간 질문에 답한다.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 갤러리 첫 화면에서 받는 바이트 수(DevTools 네트워크 합계)와 100 MB 복사의 `fetchMs + uploadMs`. trunk는 복사가 없으므로 갤러리 바이트만 양쪽에서 잰다.
- [ ] Probe. 완료 행 40개를 넣고 갤러리를 3회 열어 전송 바이트를 기록한다. trunk, head 번갈아. 복사 시간은 Lane 10의 로그 3회.
- [ ] Baseline. Record the trunk 갤러리 첫 화면 바이트 first.
- [ ] Rule. head의 갤러리 바이트가 trunk의 40% 이하가 아니면 실패. 복사 합계가 240000 ms를 넘으면 실패.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and lane 6 screenshots into `.impeccable/review/gp-4-review-store.png` and `.impeccable/review/gp-4-review-gallery.png`.
- [ ] Record a 30 to 60 second video of the change on a lane. Save it as `.impeccable/review/gp-4-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## 서버 쪽 트리거 붙이기 (GP-5)

**Depends on.** GP-4.

**Files.**

- [ ] Edit `src/lib/crypto.ts`.
- [ ] Edit `src/lib/generations.ts`.
- [ ] Create `src/app/api/hooks/higgsfield/route.ts`.
- [ ] Create `src/app/api/cron/settle/route.ts`.
- [ ] Create `vercel.json`.
- [ ] Edit `.env.example`, `README.md`, `PRODUCT.md`.

**Build.**

- [ ] `crypto.ts`에 `signToken("hf-hook", id)`와 `verifyToken`(HMAC-SHA256, `AUTH_SECRET` 파생 키, base64url 32자, `timingSafeEqual`)을 넣는다.
- [ ] `generations.ts`에 `onProviderHook(url)`과 `sweep({ deadline })`을 추가한다. 훅은 초인종이다. URL의 `g`와 `t`를 검증하고 본문은 읽지 않으며, 소유자 키로 상태를 강제 조회한다(`forceCheck`). 상태 조회 실패나 아직 `request_id`가 없는 행이면 `retry`를 돌려주고 라우트가 503을 준다. Higgsfield는 2시간 동안 재전송한다. `hookUrl(id)`는 `PUBLIC_BASE_URL ?? https://${VERCEL_PROJECT_PRODUCTION_URL}`에 `?g=<id>&t=<token>`을 붙이고, 둘 다 없으면 null(로컬)이다. 프리뷰 배포는 보호돼 있어 훅을 받을 수 없으므로 항상 프로덕션 URL을 쓴다.
- [ ] `sweep`은 due 행을 오래된 순으로 100개까지 읽어 순차로 `settle`한다. due는 `status IN ('queued','in_progress') AND request_id IS NOT NULL AND next_check_at <= now()` 또는 `status = 'completed' AND storage_path IS NULL AND result_url IS NOT NULL AND (mirror_next_at IS NULL OR mirror_next_at <= now()) AND (expires_at IS NULL OR expires_at > now())`. 복사는 inline으로 await한다. 240초 deadline을 넘기면 `truncated: true`.
- [ ] 훅 라우트는 `{ done: 204, unauthorized: 401, retry: 503 }`를 돌려주고 `maxDuration = 300`. 크론 라우트는 `Authorization: Bearer ${CRON_SECRET}`가 아니면 401, 아니면 `sweep` 결과 JSON.
- [ ] `vercel.json`은 `regions: ["icn1"]`와 `crons: [{ path: "/api/cron/settle", schedule: "* * * * *" }]`. README에 Hobby면 스케줄을 `0 18 * * *`(KST 03시)로 바꿔야 배포된다고 적는다.
- [ ] `PRODUCT.md` 운영 문맥 절에서 "서버 측 폴링이나 cron은 없다"를 세 트리거 설명으로 바꾸고, Vercel Pro 전환은 운영자 결정으로 남긴다.

**You see.**

- [ ] 가짜 서버에 `?hf_webhook=`이 기록되고, 생성 뒤 탭을 닫아도 가짜 웹훅 한 번으로 행이 완료와 복사까지 간다. `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3100/api/cron/settle`이 `{"submitted":0,"checked":3,"moved":3,"stored":3,"failures":0,"truncated":false}` 같은 JSON을 돌려준다.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/lifecycle-check.ts`에 단정 추가. 중복 훅 2건은 전이 1회. 잘못된 토큰은 401이고 상태 조회 0건. `request_id` 없는 행의 훅은 503. `FAKE_HF_DROP_WEBHOOKS=1`에서 두 번의 `sweep` 호출 안에 모든 live 행이 종료된다. 동시에 부른 `sweep` 2개는 행당 상태 조회 1건. Run `HIGGSFIELD_BASE_URL=http://localhost:4010 PUBLIC_BASE_URL=http://localhost:3100 npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts`.
- [ ] `src/lib/crypto.test.ts`가 토큰 왕복과 변조 거부를 단정한다. Run `node --test --import tsx src/lib/crypto.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk에는 훅과 크론이 없다. 그 사실을 기록하고 head에서 제출 직후 브라우저를 닫은 행이 90초 안에 종료되고 복사되는지 본다. Save `hook-closed-tab.png`. Pass when `/_stats`에 브라우저 폴링 0건, 훅 1건이고 행이 stored다.
- [ ] Lane 2. `FAKE_HF_DUP_WEBHOOKS=1`. Save `hook-dup.png`. Pass when 전이 1회, `completed_at` 1개 값, 복사 1회다.
- [ ] Lane 3. 토큰을 바꾼 훅을 `curl`. Save `hook-401.png`. Pass when 401이고 상태 조회 0건이다.
- [ ] Lane 4. 가짜 서버를 멈춘 상태에서 훅. Save `hook-503.png`. Pass when 503이고 가짜 서버가 재전송 큐에 넣었다고 기록한다.
- [ ] Lane 5. `FAKE_HF_DROP_WEBHOOKS=1`로 live 행 5개, 크론 라우트를 60초 간격 두 번 `curl`. Save `sweep-drop.png`. Pass when 두 번째 호출 뒤 5개 모두 종료 및 stored다.
- [ ] Lane 6. 크론 라우트를 시크릿 없이 호출. Save `cron-401.png`. Pass when 401이다.
- [ ] Lane 7. 프리뷰 배포에서 실제 Higgsfield 없이 `hookUrl`이 프로덕션 호스트를 가리키는지 로그로 확인. Save `hook-url.png`. Pass when URL 호스트가 `VERCEL_PROJECT_PRODUCTION_URL`이다.
- [ ] Lane 8. live 행 150개를 넣고 크론 1회. Save `sweep-150.png`. Pass when `truncated: false`이고 응답 시간이 240초 미만이다.
- [ ] Lane 9. 프로덕션 첫 배포 뒤 첫 크론 틱. Save `sweep-prod.png`. Pass when 과거에 멈춰 있던 queued 행이 종료 상태로 바뀐다(2026-10-28 기준 실제 키 배정 전이면 0건이라고 기록).
- [ ] Lane 10. 모바일에서 제출 뒤 앱 종료, 5분 뒤 재방문. Save `hook-mobile.png`. Pass when 무대에 완료가 보인다.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `GET /api/generations?ids=`(행 5개) p50과 p95, 그리고 DB 쿼리 1건의 왕복 시간. trunk(`iad1`)와 head(`icn1`) 프리뷰 배포 양쪽.
- [ ] Probe. 같은 프리뷰 URL 쌍에 `curl -w %{time_total}` 30회씩 번갈아. DB 왕복은 `SELECT 1` 라우트가 없으므로 `GET /api/admin/models`로 잰다.
- [ ] Baseline. Record the trunk `iad1` p50 first.
- [ ] Rule. head p50이 trunk p50보다 작지 않으면 실패. 차이의 원인으로 DB 왕복 시간을 로그에 함께 남긴다.

**Review gate.** None. GP-5 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## 제출 대기와 429 흡수하기 (GP-6)

**Depends on.** GP-5.

**Files.**

- [ ] Edit `src/lib/generation-status.ts`.
- [ ] Edit `src/lib/generations.ts`.
- [ ] Edit `src/db/schema.ts`.
- [ ] Create `drizzle/0003_pending_default.sql`.
- [ ] Edit `src/app/api/generations/route.ts`, `src/app/api/generations/[id]/route.ts`.
- [ ] Edit `src/components/Playground.tsx`, `src/components/StatusBadge.tsx`.
- [ ] Create `scripts/burst.ts`.
- [ ] Edit `README.md`.

**Build.**

- [ ] `GENERATION_STATUSES`에 `pending`(rank 0, 라벨 "제출 대기")을 추가한다. 빌드가 라벨과 색을 요구한다.
- [ ] 제출을 insert-first로 바꾼다. 행을 `pending`으로 넣고 `Idempotency-Key = row id`, 본문은 행에서 `buildArguments`로 다시 만든다. `accepted`면 `queued`로, `deferred`(429, 5xx, 네트워크, 타임아웃)면 `next_check_at = now() + clamp(Retry-After, 5, 300)`으로 대기, `rejected`면 `failed`. 30분 넘게 pending이면 `failed`("Higgsfield가 30분 동안 요청을 받지 않았습니다"). 제출 lease는 `next_check_at`으로 30초.
- [ ] `settle`과 `sweep`이 due pending 행을 다시 제출한다. 훅은 pending 행에 503. pending 취소는 `next_check_at <= now()`(제출 중 아님)일 때만.
- [ ] POST 응답은 queued 201, pending 202, failed 502이고 세 경우 모두 `item`을 포함한다. `Playground.tsx`는 `res.ok`가 아니어도 `item`을 피드에 올리고 오류 문구를 보인다.
- [ ] `scripts/burst.ts`는 가짜 사용자 20명 × 15건을 실제 라우트로 제출한다(서명된 세션 쿠키). `FAKE_HF_429_FIRST_N=5`, 훅 10% 누락, 중복 훅 조건.

**You see.**

- [ ] 가짜 서버가 429를 주면 무대의 항목이 "제출 대기"로 올라오고 몇 초 뒤 스스로 "대기"로 바뀐다. 사용자는 502를 보지 않는다.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/burst.ts`가 300행 모두 종료, 완료 행 모두 stored, idempotency 키별 수락 1건, 키별 초당 상태 조회 1건 이하, 502 응답 0건을 단정하고 p50, p95 클릭-완료 시간을 찍는다. Run `HIGGSFIELD_BASE_URL=http://localhost:4010 FAKE_HF_429_FIRST_N=5 FAKE_HF_DROP_WEBHOOKS=0.1 npx dotenv -e .env.local -- tsx scripts/burst.ts`.
- [ ] `scripts/lifecycle-check.ts`에 추가. 제출 중 크래시를 흉내 내어(가짜가 수락했지만 UPDATE 전에 중단) 재시도가 같은 `request_id`를 받는다. Run as in GP-5.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk와 head에서 `FAKE_HF_429_FIRST_N=1`로 제출 1건. Save `pending-trunk-vs-head.png`. Pass when trunk는 502 문구를 보이고 head는 제출 대기 뒤 대기로 넘어간다.
- [ ] Lane 2. 제출 대기 중 취소. Save `pending-cancel.png`. Pass when 행이 취소되고 가짜 서버 수락 0건이다.
- [ ] Lane 3. 제출 lease 중 취소(가짜 제출을 10초 지연). Save `pending-cancel-409.png`. Pass when 409 "제출 중"이다.
- [ ] Lane 4. 30분 지난 pending 행(created_at 조작). Save `pending-expired.png`. Pass when 크론 뒤 failed와 사유 문구다.
- [ ] Lane 5. `scripts/burst.ts` 전체. Save `burst.png`. Pass when 단정이 모두 통과하고 p95가 기록된다.
- [ ] Lane 6. 가짜가 5xx를 3번 주고 수락. Save `pending-5xx.png`. Pass when 사용자는 오류를 보지 않고 행이 queued가 된다.
- [ ] Lane 7. 다른 본문으로 같은 키 재제출을 가짜가 422로 거부. Save `pending-422.png`. Pass when 행이 failed이고 로그 탭에 사유가 보인다.
- [ ] Lane 8. 어드민 로그에서 상태 필터 "제출 대기". Save `pending-filter.png`. Pass when 필터가 동작한다.
- [ ] Lane 9. 모바일에서 Lane 1. Save `pending-mobile.png`. Pass when 동일.
- [ ] Lane 10. 대시보드 생성 횟수. Save `pending-dashboard.png`. Pass when pending 행이 횟수에 포함되고 비용은 0이다.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `scripts/burst.ts`의 클릭-완료 p95와 사용자에게 보인 오류 응답 수. trunk는 pending이 없으므로 같은 스크립트를 429 없이(`FAKE_HF_429_FIRST_N=0`) 돌려 p95만 비교한다.
- [ ] Probe. 스크립트를 trunk(429 없음), head(429 없음), head(429 5건) 순으로 각 2회.
- [ ] Baseline. Record the trunk p95 first.
- [ ] Rule. head(429 없음) p95가 trunk p95의 1.2배를 넘으면 실패. head(429 5건)에서 502가 1건이라도 있으면 실패.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 screenshot into `.impeccable/review/gp-6-review-pending.png`.
- [ ] Record a 30 to 60 second video of the change on a lane. Save it as `.impeccable/review/gp-6-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done, or recorded as skipped in Claude Code.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends it to the base-branch stack and the operator lands it bottom-up.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

실행해서 확인한 것.

- 폴링 id 결함. `Playground.tsx` 384행이 uuid에 `Number()`를 적용한다(코드). 2026-10-28에 검증 서버(커밋 `9186b75`, 포트 3100)에 로그인한 뒤 `GET /api/generations/NaN`을 `curl`하면 HTTP 500과 `Failed query ... params: NaN,1` 본문이 온다. 임의 uuid는 404 `없는 생성 건입니다`. 즉 서버는 멀쩡하고 클라이언트가 보내는 id가 틀리다. 같은 응답이 SQL 전문을 노출하므로 GP-3에서 uuid 검사를 경계에 둔다.
- 300초 전제. 코드 읽기로 확인. 어떤 함수도 생성 완료를 기다리지 않는다. `POST /api/generations`는 제출 뒤 바로 돌아오고, `GET /api/generations/:id`는 상태 조회 1회다.
- 폴링 지연 초기화. `Playground.tsx`의 effect가 `liveKey`에 의존하므로 live 집합이 바뀔 때마다 2초부터 다시 시작한다(코드). 실행하지 않았다.

실행하지 못한 것(실행 전까지 추정).

- Higgsfield 웹훅이 Vercel 라우트에 실제로 도달하는지. 키가 배정된 계정이 없다. GP-5 Lane 1과 Lane 9가 실제 키로 답한다. 설계는 이 답에 정확성을 걸지 않는다(크론과 폴링이 수렴시킨다).
- 결과 파일 크기. 모델과 해상도별로 측정된 값이 없다. GP-4가 `size_bytes`와 `video_stored` 로그로 답한다.
- 100 MB 복사 시간. GP-4 Lane 10이 실제 버킷으로 답한다.
- Higgsfield 키별 동시성과 큐 깊이. 문서에 없다. GP-6의 burst가 가짜로 흉내 내고, 실제 값은 첫 burst의 pending 횟수로 드러난다.

## Appendix B. Alternatives rejected

설계 후보 2개를 병렬로 만들었다(architect arena, 후보 1은 opus xhigh, 후보 2는 세션 모델). 다른 모델 계열이 없어 교차 심사는 건너뛰었고 아래 기준으로 직접 채점했다. 두 후보는 같은 모양으로 수렴했다. 행이 작업이고, 소유자 모듈 하나가 상태를 쓰고, 웹훅은 본문을 믿지 않는 초인종이며, 1분 크론이 남은 일을 치우고, 복사는 `after()`로 한 번의 호출 안에서 끝낸다. 후보 1을 base로 골랐다. 폴링 폭주(지연 초기화, 항목별 요청)를 실제로 다루고, 429를 pending으로 흡수하며, 갤러리 전송량까지 계산했기 때문이다. 후보 2에서 접목한 것은 `Scheduler` 매개변수(소유자 모듈이 `next/server`를 import하지 않음)와 `mirror_attempts`를 어드민 로그에 보이게 하는 운영 가시성이다. 후보 2의 부분 인덱스와 2초 claim은 받지 않았다. 수천 행 규모에 인덱스는 불필요하고 2초 claim은 세 탭이 동시에 조회하는 경우만 막는다.

거부한 모양.

- 크론만 쓰고 웹훅 없음. Hobby에서 하루 1회라 탭을 닫으면 하루를 기다린다. Pro에서도 완료마다 최대 1분 지연이 스케줄의 속성이 된다. 초인종은 라우트 하나로 모든 플랜에서 동작한다.
- 생성 1건당 Vercel Workflow. 재시도와 대기를 잘 숨기지만 상태 저장소가 둘(워크플로 런과 `generations.status`)이 되어 소유권이 갈린다. 베타 의존성과 사용량 과금, 다른 로컬 개발 경로도 생긴다. Higgsfield가 기다림을 대신하므로 내구성이 필요한 단계는 복사뿐이고, 360초 lease와 sweep이 그걸 준다.
- 서명 검증한 웹훅 본문을 신뢰. 상태 조회 1회를 아끼지만 20개 키 뒤의 Higgsfield 계정마다 `whsec_` 비밀을 드러내 저장해야 하고, 비밀을 드러내기 전엔 서명이 없어 위조 URL이 우리 버킷으로 복사될 수 있다. 본문과 상태 엔드포인트가 한 상태의 두 파서가 된다.
- 자체 제출 큐(Vercel Queues 또는 사용자별 동시 상한). 관측된 적 없는 키별 한도를 막기 위한 인프라다. pending 상태가 같은 사용자 경험을 준다. 첫 burst에서 queued 기아가 보이면 pending에 조건 하나를 더하는 것으로 충분하다.
- 브라우저만으로 처리. 코드가 가장 적지만 닫힌 탭마다 복사와 비용 기록을 잃고 7일 만료가 사용자 문제로 남는다.
- Supabase pg_cron으로 sweep 호출. Hobby에서 가장 좋은 대안이고 README에 Hobby 대안으로 적는다. v1은 운영 콘솔을 하나로 유지하기 위해 Vercel 크론을 쓴다.
- Supabase Realtime으로 브라우저에 푸시. 폴링 3 req/s를 없애지만 anon 키, RLS, 두 번째 인증 모델을 브라우저에 더한다. 지금 부하에는 과하다.

저장소 선택.

| 시나리오(추정) | 영상당 | 300건 burst | 12개월 300건/월 |
|---|---|---|---|
| A 연습 위주(480p 50%, Hailuo 30%, 1080p 15%, 4k 5%) | 9.9 MB | 3.0 GB | 36 GB |
| B 납품 위주(480p 20%, Hailuo 20%, 1080p 45%, 4k 15%) | 24.3 MB | 7.3 GB | 88 GB |
| C 전부 4k 15초 | 150 MB | 45 GB | 540 GB |

- Supabase Free. 저장 1 GB, 전송 5 GB, 파일당 50 MB, 1주 미사용 시 일시정지. 첫 burst가 3배에서 7배 넘친다. 불가.
- Supabase Pro $25/월. 저장 100 GB, 전송 250 GB 포함, 초과 $0.0213/GB-월, $0.09/GB. A와 B는 1년 동안 포함량 안이다. C만 4개월째 100 GB를 넘고 12개월째 약 $9/월 초과다. DB도 Pro여야 일시정지와 백업 문제가 없다. 서울 리전이라 사용자와 함수(`icn1`) 옆이다. 채택.
- Vercel Blob. Hobby 1 GB 상한. Pro는 저장 $0.023/GB-월, 전송 $0.05/GB로 비용은 같은 자릿수이나 벤더가 둘이 되고 리전이 `iad1`이다. 대용량 레퍼런스 업로드 용도로는 그대로 둔다.
- Cloudflare R2. 가장 싸고 전송 무료지만 새 벤더와 키, 공개 도메인이 필요하다. Supabase 전송 초과 요금이 두 달 연속 $25를 넘으면 전환한다. 행이 URL이 아니라 키를 저장하므로 전환은 객체 복사와 `storage.ts` 수정으로 끝난다.

전송량 추정. 영상 1건이 평균 5회 재생되면 300건/월에 A 15 GB, B 36 GB. 갤러리 그리드가 열릴 때마다 타일 120개가 메타데이터를 받으면 월 약 50 GB가 더 나가므로 GP-4의 지연 로드가 그걸 약 5 GB로 줄인다. 모두 추정이며 GP-4가 측정한다.

## Appendix C. Risks

- 공개 버킷. uuid 키라 추측은 불가능하지만 링크를 가진 누구나 볼 수 있다. 지금 Higgsfield URL과 같은 노출 수준이다. 사내 영상이 외부에 공유되면 안 되면 비공개 버킷과 `createSignedUrls`로 바꾼다. GP-4 소유자가 README에 전환 절차를 적는다.
- Vercel 플랜. `PRODUCT.md`는 Hobby로 운영한다고 적혀 있고 Pro 전환은 미결이다. 이 계획은 Pro를 기본으로 하고 Hobby에서는 크론이 하루 1회라 탭을 닫은 행이 다음 방문이나 다음 날에 수렴한다. 회사 업무용은 약관상 Pro가 맞다. 운영자가 결정한다. GP-5 소유자가 `vercel.json` 스케줄을 플랜에 맞춘다.
- 오류 본문의 SQL 노출. 지금 잘못된 id가 `Failed query ...` 전문을 인증된 사용자에게 돌려준다. GP-3에서 uuid 검사로 막고, `errorResponse`가 쿼리 문자열을 그대로 내보내지 않도록 GP-3 소유자가 확인한다.
- 프리뷰 배포가 프로덕션 DB를 공유한다. 프리뷰에서 만든 훅 URL은 프로덕션을 가리키고, 프로덕션이 같은 DB의 행을 처리하므로 동작은 맞다. 프리뷰 DB를 분리하는 날 깨진다. GP-5 소유자가 README에 적는다.
- 복사 메모리. 결과 전체를 메모리에 올린다. 2 GB 함수에서 1 GB까지 거부선을 둔다. 측정된 크기가 500 MB를 넘으면 스트리밍 업로드로 바꾼다. GP-4가 지켜본다.
- Blob 레퍼런스 누수. 종료 전이와 정리 사이에 함수가 죽으면 임시 입력 파일이 남는다. 몇 MB 수준이라 받아들인다.
- 30분 제출 기한. Hobby에서 탭을 닫은 pending 행은 다음 방문 전에 실패할 수 있다. 제품 결정이다. GP-6 소유자가 README에 적는다.
- `icn1` 이전. DB가 서울이라 유리하다는 추정이다. GP-5 perf 블록이 측정하고 느려지면 한 줄 되돌린다.
- Idempotency-Key 재사용 시 본문이 다르면 422. 재제출 본문은 반드시 행에서 재구성한다. GP-6 unit이 단정한다.

## Appendix D. Links and reading list

- 설계 후보 2개와 그라운딩. `C:\Users\a\AppData\Local\Temp\claude\C--Users-a-project-tpc-video-generation-workflow-page\f668dad7-d0a9-4be9-9891-868032cf443c\scratchpad\arena\` (grounding.md, candidate-1/design.md, candidate-2/design.md). 세션 임시 폴더라 보존이 필요하면 `docs/plans/`로 옮긴다.
- Higgsfield 문서. `https://docs.higgsfield.ai/docs/how-to/webhooks.md`, `https://docs.higgsfield.ai/docs/concepts/requests.md`, `https://docs.higgsfield.ai/docs/concepts/idempotency.md`.
- Vercel 문서. `https://vercel.com/docs/functions/limitations`, `https://vercel.com/docs/cron-jobs/usage-and-pricing`, `https://vercel.com/docs/workflows`.
- Supabase 문서. `https://supabase.com/pricing`, `https://supabase.com/docs/guides/storage/uploads/standard-uploads`.
- 현재 코드. `src/lib/generations.ts`, `src/lib/higgsfield.ts`, `src/app/api/generations/route.ts`, `src/app/api/generations/[id]/route.ts`, `src/components/Playground.tsx`, `src/db/schema.ts`.
- GP-3과 GP-6 소유자는 시작 전에 `how` 스킬로 `generations.ts`와 `Playground.tsx`의 폴링 흐름을 설명한 뒤 시작한다. GP-4와 GP-5는 code-ready에서 `interrogate` 스킬로 경쟁 조건을 공격한다.
- 결정 기록은 `show-me-your-work` 스킬대로 `docs/plans/generation-pipeline.trail.tsv`에 남기고 프로그램이 끝나면 지운다.
