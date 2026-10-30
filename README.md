# Video Gen Studio

Higgsfield API(영상)와 OpenAI API(이미지) 위에 올린 팀용 생성 사이트. Next.js 16 (App Router) + Supabase Postgres (Drizzle, Free 플랜) + Vercel Blob(완료 영상·이미지 보관과 레퍼런스 업로드).

| 경로 | 내용 |
|---|---|
| `/` | 랜딩 |
| `/login` | ID/비밀번호 로그인 (개별 배부), 비밀번호 변경, 임시 비밀번호면 새 비밀번호 정하기 |
| `/playground` | 프롬프트만으로, 또는 레퍼런스와 함께. 영상은 Seedance 2.0 · MiniMax H3(이미지 ≤6 · 영상 ≤3), 이미지는 GPT Image 2(이미지 ≤16). 생성 방식 표시, 하이퍼파라미터, 예상 비용, 실시간 진행, 다운로드 |
| `/gallery` | 완료 결과(영상과 이미지). 기본은 내 것이고, 팀에 속한 회원은 팀(팀원 것)과 전체(내 것과 팀원 것)로 바꿔 봄(`?scope=team`, `?scope=all`). 팀원 것은 보고 내려받기만 함. 관리자는 내 것과 전체(모든 회원, `?scope=everyone`) |
| `/dashboard` | 본인 사용량: 누적/30일 비용, 횟수, 모델별, 일별 차트, 최근 20건 |
| `/settings` | 프로필 사진·닉네임 변경, ID와 팀 확인, 비밀번호 변경. 상단 메뉴의 사진과 이름을 누르면 열림 |
| `/admin` | 사용자 추가 · 엑셀(nickname, email)로 회원 일괄 생성 · API 키 할당 · 닉네임/비밀번호/역할/활성 · 팀 만들기와 팀원 지정(여러 명 한 번에, 팀으로 거르기) · 모델 단가 · 전체 로그(필터, CSV) |

## 동작 원리

- **인증**: 서버가 scrypt 해시로 비밀번호를 검증하고 7일짜리 HttpOnly JWT 쿠키를 발급합니다. 10회 실패 시 15분 잠금이고, 로그인 화면의 비밀번호 변경(`POST /api/auth/password`)도 같은 실패 횟수를 셉니다. `@`가 든 ID는 대소문자를 가리지 않습니다. `proxy.ts`가 쿠키만으로 보호 경로를 먼저 막고, 페이지와 API는 DB로 다시 확인합니다. 비밀번호가 바뀐 시각(`password_changed_at`)보다 먼저 발급된 쿠키는 그때 끊깁니다. 관리자가 만든 계정이나 남의 비밀번호를 바꾼 계정은 임시 비밀번호(`must_change_password`)라 첫 로그인 때 세션 없이 새 비밀번호부터 정합니다. 초기 비밀번호는 `src/lib/credentials.ts`의 `INITIAL_PASSWORD`입니다.
- **API 키**: 사용자가 입력하지 않습니다. 관리자가 어드민에서 사용자별로 할당하고, DB에는 `AUTH_SECRET`로 AES-GCM 암호화돼 저장됩니다. 서버만 복호화해 Higgsfield를 호출합니다.
- **모델과 엔드포인트**: 모델은 Seedance 2.0과 MiniMax H3 두 개이고(`src/lib/catalog.ts`), 첨부에 따라 Higgsfield 엔드포인트가 정해집니다. 레퍼런스가 없으면 `…/text-to-video`, 이미지 한 장만 올리고 "이 이미지로 시작"을 고르면 `…/image-to-video`(첫 프레임), 그 밖에는 `…/reference-to-video`입니다. 레퍼런스는 필수가 아닙니다. 서랍은 어느 방식으로 생성될지 늘 보여 주고, 서버는 같은 함수(`planGeneration`)로 다시 정해 화면과 다르면 400으로 거절합니다. 옛 Hailuo 2.3 행과 옛 Seedance 행도 이름과 파라미터 이름이 그대로 보입니다.
- **생성 흐름**: `POST /api/generations` → 행을 먼저 "제출 대기"(`pending`)로 저장하면서 `model_id`에 보낼 엔드포인트, `request_body`에 보낼 JSON 본문을 그대로 적음 → Higgsfield `POST /{엔드포인트}` (Idempotency-Key는 행 id, `hf_webhook` 포함) → 받으면 "대기"(`queued`)와 `request_id` 저장. 다시 보낼 때는 카탈로그를 거치지 않고 저장된 엔드포인트와 본문 바이트를 그대로 보내므로, 그 사이 배포로 라우팅이나 파라미터 규칙이 바뀌어도 같은 요청입니다(`request_body`가 없는 0007 이전 행은 그때 코드의 본문 규칙 `legacyBody`로). 행을 움직이는 코드는 `src/lib/generations.ts` 하나이고, 아래 세 트리거가 모두 그 함수를 부릅니다. 같은 일을 두 번 해도 결과가 같습니다.
  - **브라우저 폴링**: 열린 탭이 live 행을 `GET /api/generations?ids=`로 2s→×1.5→최대 10s 간격으로 폴링하고, 서버가 그때 Higgsfield 상태를 한 번 조회합니다.
  - **웹훅**: Higgsfield가 끝나면 `POST /api/hooks/higgsfield?g=<생성 id>&t=<토큰>`을 부릅니다. 웹훅은 초인종일 뿐이라 본문은 읽지 않고, `AUTH_SECRET`으로 만든 토큰을 확인한 뒤 사용자 키로 상태를 다시 조회합니다. 행이 종료됐거나 없으면 204(행은 제출 전에 저장되므로 없는 행은 지워진 행), 토큰이 틀리면 401이고, 조회가 실패했거나, 행이 아직 제출 대기거나, 다른 호출자가 1초 안에 같은 행의 강제 조회를 이미 잡았으면(중복·재전송 웹훅은 행당 초당 한 번만 조회) 503이며 Higgsfield는 5xx를 2시간 동안 다시 보냅니다. 제출 대기 행의 웹훅은 받아진 제출의 답을 놓쳤다는 뜻이라, 아무도 제출 중이 아니면 그 자리에서 다시 제출해 원래 `request_id`를 받고 상태를 조회합니다. 탭을 닫아도 완료 직후 비용 기록과 영상 복사가 끝납니다.
  - **크론**: Vercel Cron이 매분 `GET /api/cron/settle`을 부르면 다시 보낼 때가 된 제출 대기 행, 조회 시각이 지난 live 행, 복사가 밀린 완료 행을 오래된 순으로 240초 동안 처리하고 `{"submitted":0,"checked":3,"moved":3,"stored":3,"failures":0,"truncated":false}` 같은 JSON을 돌려줍니다. 놓친 웹훅, 피드에 보이지 않는 오래된 live 행, 탭을 닫은 제출 대기 행, 실패한 복사를 이 크론이 마저 처리합니다.
- **제출 대기**: Higgsfield가 제출에 429, 5xx로 답하거나 네트워크 오류나 20초 타임아웃이 나면 행은 "제출 대기"로 남고 `POST`는 202와 그 행을 돌려줍니다(받으면 201, 그 밖의 4xx는 실패 행과 502). `Retry-After`(5초에서 300초 사이로 자름) 뒤 다음 폴링, 웹훅, 크론이 같은 Idempotency-Key와 저장된 행에서 다시 만든 같은 본문으로 다시 보냅니다. 앞선 시도가 실제로 받아졌다면 Higgsfield는 원래 `request_id`를 돌려주고 두 번 과금하지 않으며, 본문이 달라지면 422로 실패합니다. 한 행은 30초 제출 lease로 한 호출자만 보내고, lease 동안의 취소는 409 "제출 중"입니다. Higgsfield가 429로만 거절한 대기 행은 바로 취소됩니다. 5xx, 네트워크 오류, 타임아웃으로 답을 잃었거나 제출하던 호출자가 lease 중에 죽은 행은 Higgsfield가 이미 받았을 수 있으므로(뒤에 429를 받아도 그대로), 취소가 같은 키로 한 번 더 보내 원래 `request_id`를 받은 뒤 Higgsfield에서 취소합니다. 이미 시작된 작업이면 409와 함께 그 작업을 끝까지 추적하고, 그 재전송도 답이 없으면 409 "제출 중"입니다. DB 시계로 `created_at`부터 30분 넘게 받아지지 않은 행은 "Higgsfield가 30분 동안 요청을 받지 않았습니다"로 실패합니다. 단, 답을 잃은 적이 있는 행은 실패시키지 않고 계속 다시 보내 Higgsfield가 가진 작업을 찾습니다. 그 작업이 없었다면 30분 뒤에 새로 시작될 수 있고, 대기 중일 때 사용자가 취소할 수 있습니다. 그런 행의 주인 키를 관리자가 지웠다면 실패시키지 않고 1분마다 키를 다시 확인하며 기다리고(그동안 취소는 403), 키가 돌아오면 같은 Idempotency-Key로 다시 보내 원래 작업을 찾습니다. 30분이 지나도 키가 없으면 키 없음으로 실패합니다. Higgsfield가 429로만 거절한 행은 키가 없으면 바로 실패합니다. 이 30분은 사용자가 더는 기다리지 않는 생성을 늦게 시작해 과금하지 않으려는 제품 결정이고, `src/lib/generations.ts`의 `SUBMIT_DEADLINE_MIN` 한 곳만 바꾸면 됩니다.
- **이미지 비용**: GPT Image 2의 단가는 이미지 출력 100만 토큰당 USD(OpenAI 정가 $30, 어드민에 행이 없으면 이 값)입니다. OpenAI의 텍스트 입력 $5와 이미지 입력 $8은 그 5/30, 8/30으로 따라갑니다. 생성 전 예상은 OpenAI가 공개한 장당 가격(1024×1024 low $0.006 · medium $0.053 · high $0.211, 1536×1024·1024×1536 $0.005 · $0.041 · $0.165)을 출력 토큰으로 바꾸고, 프롬프트 글자 수를 텍스트 토큰으로, 레퍼런스 한 장을 이미지 입력 6,563토큰(gpt-image-2는 공개하지 않아 gpt-image-1의 고충실도 규칙으로 잡은 값)으로 더합니다. 16:9와 9:16은 공개 가격이 없어 같은 방향 표준 크기의 가격으로 잡습니다. 완료되면 응답의 `usage`(입력 텍스트·이미지 토큰, 출력 토큰)를 같은 함수 `costUsd`에 넣어 실제 비용으로 바꾸고, `usage`가 없으면 예상을 그대로 둡니다. 예: 1024×1024 medium, 120자 → 예상 $0.0536. `usage`가 출력 1,800 · 이미지 입력 8,800 · 텍스트 200이면 $0.1254. 청구됐을 수 있는 실패는 예상 비용을, 청구되지 않은 실패는 0을 남깁니다.
- **비용**: Higgsfield 응답에 비용이 없으므로 생성을 요청할 때 `costUsd`(한 순수 함수, 서버와 서랍이 같이 씀)로 정해 `cost_usd`에 적습니다. 완료되면 그대로 두고, 실패·NSFW·취소·제출 기한 초과는 0으로 돌립니다. 그래서 합계에는 진행 중인 건의 견적도 들어갑니다. 단가(`models.price_per_sec_usd`)는 모델마다 기준 형식 1초의 USD입니다. Seedance 2.0은 480p·16:9 1초이고, Higgsfield 토큰 공식(출력 가로×세로×24fps/1024 토큰, 4K는 토큰값 0.008/0.014배, 영상 레퍼런스가 있으면 0.6배에 입력 영상 길이까지 셈)을 해상도·화면비·길이에 적용합니다. 이미지→영상은 화면비가 이미지를 따르므로 그 해상도의 가장 큰 프레임으로 셉니다. MiniMax H3는 2K 1초이고 길이만큼 곱합니다(레퍼런스 이미지는 5장까지라 장당 추가 요금이 붙지 않음). 어드민 → 모델 탭에서 단가를 넣어야 0이 아닌 값이 나오고, 칸 옆에 Higgsfield 공시 단가(Seedance 표 $0.0985·정가 $0.1406, H3 표 $0.065·정가 $0.13, 2026-10-29)를 한 번에 채우는 버튼이 있습니다. 실제 청구는 Higgsfield 인보이스가 기준입니다.
- **이미지 (GPT Image 2)**: 모델 고르기의 "이미지" 묶음에 있습니다. 레퍼런스가 없으면 OpenAI `POST /v1/images/generations`(텍스트→이미지, `model_id` `openai/gpt-image-2/generations`), 이미지 레퍼런스가 있으면 `POST /v1/images/edits`(레퍼런스→이미지, `…/edits`, 레퍼런스는 `images: [{ image_url }]`로 최대 16장)입니다. 화면비 1:1·3:2·2:3(OpenAI 표준 크기 1024×1024·1536×1024·1024×1536)와 16:9·9:16(1536×864·864×1536), 품질 low·medium·high, 파일 형식 PNG·JPEG·WebP, 배경 자동·불투명·투명(투명은 PNG·WebP만)을 고르고, `n`은 1장, `input_fidelity`는 gpt-image-2에서 빼야 하므로 보내지 않습니다. 키는 서버 환경 변수 `OPENAI_API_KEY` 하나를 팀 전체가 같이 쓰고 브라우저로 나가지 않으며, 멤버의 Higgsfield 키는 필요 없습니다. 요청에는 멤버마다 다른 `safety_identifier`(`AUTH_SECRET`으로 만든 HMAC 32자)가 붙어, OpenAI가 오남용을 공유 키가 아닌 한 사람 단위로 다룹니다. `OPENAI_API_KEY`나 `BLOB_READ_WRITE_TOKEN`이 없으면 서랍에서 "사용 불가"와 이유가 보이고 서버는 503입니다. 레퍼런스는 크기와 상관없이 브라우저에서 Blob `refs/<사용자 id>/`로 바로 올라가고(png·jpeg·webp, 50 MB 이하), 다음 생성에 다시 쓸 수 있도록 이미지 생성이 끝나도 지우지 않습니다.
- **이미지 생성 흐름**: OpenAI의 이미지 API는 한 요청이 수십 초에서 2분 걸리는 동기 호출이고, 요청 id·상태 조회·취소·웹훅이 없으며 같은 요청을 알아보는 키(Idempotency-Key)도 문서에 없습니다. 그래서 다시 보내면 두 번 청구될 수 있습니다. `POST /api/generations`는 행을 "생성 중"(`in_progress`, `maybe_accepted` false = 아직 안 보냄)으로 저장하고 201로 바로 답한 뒤, 같은 함수의 `after()`가 행을 한 번만 잡고(`maybe_accepted`를 true로 바꾸는 조건부 UPDATE, 되돌리지 않음) OpenAI를 부릅니다. 이 runner 말고는 아무도 OpenAI를 부르지 않습니다(ESLint가 `src/lib/openai.ts`의 import를 `generations.ts`로 막음). 답의 base64 이미지를 Blob `images/<생성 id>.<png|jpg|webp>`에 올린 뒤에 행을 "완료"로 바꿉니다. 다시 보내는 것은 OpenAI가 일을 시작하기 전에 돌려보낸 답(분당 한도 429, 과부하 503)뿐이고, 같은 runner가 같은 바이트로 예산 안에서만 보냅니다. 시간 예산은 `maxDuration` 300초 안에서 OpenAI 한 번 225초, Blob 저장 40초, 전체 270초이고, 잡은 행의 lease는 360초라 lease가 지났다면 runner는 이미 없습니다. 폴링·크론은 lease가 지난 이미지 행만, OpenAI를 부르지 않고 마무리합니다. 안 보낸 행(서버가 `after()` 전에 멈춤, 60초)은 비용 0으로 실패하고, 보낸 행은 Blob에 이미지가 있으면 완료, 없으면 "요금이 청구됐을 수 있어 예상 비용을 기록했습니다"로 실패합니다. 타임아웃·연결 끊김·500/502/504처럼 OpenAI가 이미 만들었을 수 있는 답도 같은 문구로 실패하고 다시 보내지 않습니다. 안전 정책 거절은 "NSFW 차단", 키·한도·잘못된 요청은 실패이며 둘 다 비용 0입니다. 이미지 행은 취소할 수 없습니다(OpenAI에 취소가 없음).
- **레퍼런스 업로드**: 4 MB 이하 파일은 서버를 거쳐 Higgsfield 업로드 스토리지로 바로 갑니다(Blob 사용 안 함). 그보다 큰 mp4는 `BLOB_READ_WRITE_TOKEN`이 있을 때만 브라우저 → Vercel Blob 직접 업로드로 올린 사람의 `refs/<사용자 id>/` 아래에 받고, 생성이 끝나면 삭제합니다.
- **프로필**: 상단 메뉴는 닉네임(없으면 ID)과 사진(없으면 이름 첫 글자)을 보여 주고 `/settings`로 이어집니다. 닉네임은 앞뒤 공백을 지우고 NFC로 맞춘 30자 이하, 제어 문자 없이 받으며 다른 사람과 같아도 되고, 비워 두고 저장하면 지워집니다(`PATCH /api/me`, 규칙은 `src/lib/nickname.ts` 하나). 사진은 브라우저가 가운데를 정사각형으로 잘라 256×256 WebP(못 만드는 브라우저는 JPEG)로 줄여 `PUT /api/me/avatar`로 보내므로 원본은 브라우저를 떠나지 않습니다. 서버는 512 KB 이하이면서 첫 바이트까지 WebP·JPEG·PNG인 것만 Blob의 `avatars/<사용자 id>/<임의 32자>.<확장자>`에 저장하고, 행이 새 사진을 가리킨 뒤에 옛 사진을 지웁니다. 사진 삭제(`DELETE /api/me/avatar`)도 행을 먼저 비우고, `del()`은 그 회원의 `avatars/<id>/` 바로 아래 생성 규칙 이름에만, 키로 다시 만든 공개 URL로 닿습니다. `BLOB_READ_WRITE_TOKEN`이 없으면 사진 버튼이 꺼지고 이유를 보여 주며 두 API는 503입니다.
- **결과 보관**: Higgsfield는 결과를 7일 뒤 지웁니다. `BLOB_READ_WRITE_TOKEN`이 있으면 완료 전이를 일으킨 요청이 응답 뒤(`after`)에 결과를 받아 Vercel Blob 공개 스토어에 `videos/<생성 id>.mp4`로 복사하고, 갤러리와 피드는 그 복사본을 재생합니다(보관 "영구"). 토큰이 비어 있으면 복사하지 않고 Higgsfield URL로 재생하며 갤러리에 남은 일수를 표시합니다(아래 완료 영상 보관).

## 데이터베이스 (Supabase)

- [supabase.com](https://supabase.com)에서 프로젝트를 만들고 **Connect → Transaction pooler** URI(포트 6543)를 `DATABASE_URL`에 넣습니다. Vercel 서버리스에서는 이 주소를 써야 연결 수가 폭주하지 않습니다.
- 드라이버는 `postgres`(postgres-js)이고 pooler 호환을 위해 `prepare: false`로 둡니다. 마이그레이션(`npm run db:migrate`)도 같은 URI로 동작합니다.
- `DB_POOL_MAX`(선택, 양의 정수, 기본 5)는 서버 인스턴스 하나가 pooler에 여는 연결 수 상한입니다. Supabase Free의 transaction pooler는 클라이언트를 200개까지 받으므로 인스턴스 수 × `DB_POOL_MAX` ≤ 100으로 둡니다. 계산과 근거는 `docs/notes/db-pool-diagnosis.md`에 있습니다.
- Neon 전용 코드는 없으므로 일반 Postgres(로컬 Docker 포함)에도 그대로 붙습니다.
- Supabase는 Free 플랜으로 두고 DB만 씁니다. Free의 Storage는 저장 1 GB, 파일당 50 MB, 전송 5 GB/월이라 영상을 담을 수 없으므로 영상은 Vercel Blob에 둡니다(아래 완료 영상 보관과 비용).

## 로컬 실행

```bash
cd web
npm install
cp .env.example .env.local      # DATABASE_URL(Supabase pooler URI), AUTH_SECRET, ADMIN_*, (선택) BLOB_READ_WRITE_TOKEN, HIGGSFIELD_BASE_URL
npm run db:migrate              # drizzle/ 의 SQL 적용
npm run db:seed                 # 모델 행 + ADMIN_USERNAME/ADMIN_PASSWORD 관리자
npm run dev
```

### 가짜 Higgsfield로 돌리기

API 키 없이 생성 흐름을 끝까지 보려면 `scripts/fake-higgsfield.ts`를 띄우고 앱이 그쪽을 보게 합니다. 실제 API와 같은 경로와 응답 모양(`POST /{model_id}`, `GET /requests/{id}/status`, `POST /requests/{id}/cancel`, `Idempotency-Key`)을 쓰고, 카탈로그의 여섯 엔드포인트와 옛 Hailuo 엔드포인트만 받습니다. 모르는 엔드포인트는 404, 그 엔드포인트의 공개 스키마(open.higgsfield.ai)에 없는 필드나 빠진 필수 필드, 범위 밖 값은 422입니다.

```bash
npm run fake:hf                                        # fake higgsfield on http://localhost:4010
HIGGSFIELD_BASE_URL=http://localhost:4010 npm run dev  # 또는 .env.local에 적기
```

같은 가짜 서버가 `/openai/v1/images/generations`와 `/openai/v1/images/edits`로 OpenAI 이미지 API도 흉내 냅니다(`scripts/fake-openai.ts`). 앱을 `OPENAI_BASE_URL=http://localhost:4010/openai/v1 OPENAI_API_KEY=sk-fake`로 띄우면 GPT Image 2가 켜지고, 가짜는 본문을 gpt-image-2의 문서화된 파라미터로 검사해(모르는 키, 범위 밖 크기, `input_fidelity` 등은 OpenAI 모양의 400) 프롬프트로 그린 작은 PNG(JPEG·WebP 요청에는 실제 JPEG·WebP)와 `usage`를 `FAKE_OPENAI_DELAY_MS`(기본 1500) 뒤에 돌려줍니다. `POST /_config`에 `{"openai": {"refuseFirstN": 1}}`(429), `{"openai": {"overloadedFirstN": 1}}`(503), `{"openai": {"fail": "moderation" | "badkey" | "quota" | "server" | "hangup"}}`, `{"openai": {"usage": false}}`, `{"openai": {"delayMs": 60000}}`을 보내 바꾸고, `GET /_stats`의 `openai`에 요청마다 엔드포인트·본문·응답 코드·`usage`가 남습니다.

어드민에서 사용자에게 `fake:key` 같은 임의의 `id:secret` 문자열을 API 키로 넣으면 생성하기가 동작합니다. 요청은 `FAKE_HF_DURATION_MS`(기본 `3000-8000`) 안에 대기 → 생성 중 → 완료로 바뀌고 결과 영상은 가짜 서버의 `/media/{id}.mp4`(`FAKE_HF_VIDEO_BYTES`, 기본 2 MB)입니다. `HIGGSFIELD_BASE_URL`을 비우면 실제 `https://api.higgsfield.ai`로 갑니다.

| 환경 변수 | 기본 | 동작 |
|---|---|---|
| `FAKE_HF_PORT` | `4010` | 포트 |
| `FAKE_HF_DURATION_MS` | `3000-8000` | 제출부터 완료까지 걸리는 시간(범위 또는 고정값) |
| `FAKE_HF_429_FIRST_N` | `0` | API 키별 처음 N건 제출에 429와 `Retry-After` |
| `FAKE_HF_RETRY_AFTER_S` | `5` | 429와 제출 5xx에 붙이는 `Retry-After` 초 |
| `FAKE_HF_SUBMIT_FAIL_N` | `0` | 제출 처음 N건에 503(키와 상관없이) |
| `FAKE_HF_SUBMIT_DELAY_MS` | `0` | 제출 응답 지연. 제출 lease 중 취소를 재현할 때 씀 |
| `FAKE_HF_DROP_WEBHOOKS` | `0` | `?hf_webhook=` 웹훅을 이 비율만큼 보내지 않음 |
| `FAKE_HF_DUP_WEBHOOKS` | 없음 | `1`이면 완료 웹훅을 두 번 보냄 |
| `FAKE_HF_VIDEO_BYTES` | `2097152` | `/media/` 응답 크기 |
| `FAKE_HF_VIDEO_FILE` | 없음 | `/media/` 응답으로 보낼 실제 영상 파일. 브라우저에서 재생까지 보려면 `public/mock/result-landscape.webm` 같은 파일을 주고, 주면 `FAKE_HF_VIDEO_BYTES`는 무시 |
| `FAKE_HF_MEDIA_DELAY_MS` | `0` | `/media/` 응답 지연 |
| `FAKE_HF_STORAGE_FAIL_N` | `0` | Blob 쓰기 요청(put, multipart의 각 요청) 처음 N건을 재시도하지 않는 400으로 거절 |
| `FAKE_HF_STATUS_FAIL_N` | `0` | 상태 조회 처음 N건에 503 |
| `FAKE_HF_WEBHOOK_RETRY_MS` | `2000` | 웹훅이 5xx나 연결 오류를 받으면 이 간격부터 두 배씩 늘려 2시간 동안 다시 보냄. 4xx는 다시 보내지 않음(Higgsfield와 같음) |

가짜 서버는 실제 `@vercel/blob` 클라이언트가 보내는 Vercel Blob API의 부분집합(단일 put, multipart create·upload·complete, head, del)도 받고 저장한 바이트를 `/blob/{pathname}`에서 Range와 `?download=1` 첨부로 돌려주므로, 앱을 `VERCEL_BLOB_API_URL=http://localhost:4010/api/blob BLOB_PUBLIC_BASE_URL=http://localhost:4010/blob BLOB_READ_WRITE_TOKEN=vercel_blob_rw_fake_fake`로 띄우면 복사와 재생까지 로컬에서 돌릴 수 있습니다. 브라우저의 4 MB 초과 레퍼런스 업로드까지 가짜로 보내려면 `NEXT_PUBLIC_VERCEL_BLOB_API_URL=http://localhost:4010/api/blob`도 넣습니다. 가짜 서버는 `/api/blob`의 CORS preflight에 답하고, 클라이언트 토큰의 서명은 확인하지 않지만 실제 스토어처럼 토큰에 적힌 pathname에만 쓰게 합니다. `GET /_stats`는 받은 제출마다 엔드포인트·Idempotency-Key·본문·응답 코드(`submits`), Idempotency-Key별 수락 수, 요청별·키별 상태 조회 수(초당 최대 포함), 웹훅 전송·재전송 수와 요청별 응답 코드 목록, 미디어 다운로드 수, Blob pathname별 쓰기 횟수·크기·sha256·part 수와 del이 요청한 pathname 목록과 받은 그대로의 URL 목록(`deleteUrls`)을 돌려주고 `POST /_reset`은 모두 비웁니다. `POST /_config`에 `{"mediaDelayMs": 250000}`, `{"storageFailN": 3}`(다음 3건 실패), `{"statusFailN": 1}`, `{"dropWebhooks": 1}`, `{"dupWebhooks": true}`, `{"firstN429": 1}`(키별 횟수를 처음부터 다시 셈), `{"retryAfterS": 60}`, `{"submitFailN": 3}`, `{"submitDelayMs": 10000}`을 보내면 서버를 다시 띄우지 않고 그 값을 바꾸고, 응답으로 현재 값 전부를 돌려줍니다. DB 없이 도는 단위 테스트는 `node --expose-gc --test --import tsx scripts/fake-higgsfield.test.ts scripts/storage.test.ts`(storage.test.ts는 복사의 크기·sha256, 1 GB 거부, 타임아웃, 512 MB 복사의 메모리 정점, 레퍼런스 정리 가드, 사진 저장과 삭제 가드를 봅니다. `src/lib/*.test.ts`도 같은 방식으로 돕니다), 생명주기와 복사 단정은 `HIGGSFIELD_BASE_URL=http://localhost:4010 npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts`입니다(`--submits`는 제출 대기 단정만, `--triggers`는 웹훅과 크론 단정만, `--images`는 이미지 단정만). 행을 만들므로 `.env.local`의 `DATABASE_URL`은 로컬 Docker Postgres(마이그레이션 적용, `ssl=on`)여야 하고, 프로덕션 DB를 가리키면 안 됩니다. 이미지 단정은 `OPENAI_BASE_URL`을 가짜로, `OPENAI_API_KEY`를 가짜 값으로 스스로 맞추므로 실제 OpenAI를 부르지 않습니다. lifecycle-check는 Blob env를 스스로 가짜에 맞추고 토큰을 가짜로 바꾸므로 `.env.local`에 실제 Blob 토큰이 있어도 실제 스토어에 쓰지 않습니다.

출시 burst는 `scripts/burst.ts`로 재현합니다. 가짜 서버를 `FAKE_HF_429_FIRST_N=5 FAKE_HF_DROP_WEBHOOKS=0.1 FAKE_HF_DUP_WEBHOOKS=1 npm run fake:hf`로, 앱을 `HIGGSFIELD_BASE_URL`과 위의 Blob env 세 개를 가짜로, `PUBLIC_BASE_URL`을 앱 자신으로, 크론까지 보려면 `SWEEP_ALLOW_NONPROD=1`도 넣어 띄운 뒤 `HIGGSFIELD_BASE_URL=http://localhost:4010 BURST_BASE=http://localhost:3000 CRON_SECRET=<앱과 같은 값> npx dotenv -e .env.local -- tsx scripts/burst.ts`를 실행합니다. `gp6-burst-01`부터 20명을 DB에 직접 만들어 실제 로그인과 생성 라우트로 15건씩 제출하고, 모든 행 종료, 완료 행 저장, 키별 수락 1회, 502 0건을 단정한 뒤 클릭부터 완료까지 p50·p95를 찍습니다. 끝나면 그 사용자와 행을 지우고 남은 것이 0인지 확인합니다. 공용 DB의 행을 건드리지 않도록 다른 사용자의 due 행이 있으면 크론을 부르지 않습니다.

## 완료 영상 보관 (Vercel Blob)

1. Vercel 프로젝트에 **공개(public)** Blob 스토어를 하나 연결합니다. `vercel blob create-store video-gen-studio --access public --yes`(또는 대시보드 Storage → Create → Blob → Public)가 `BLOB_READ_WRITE_TOKEN`을 모든 환경에 넣고, 로컬은 `vercel env pull .env.local --yes`로 받습니다. 4 MB 초과 레퍼런스 업로드도 같은 스토어를 씁니다. 이미 레퍼런스용 스토어가 있으면 그 스토어가 공개인지 확인하고 그대로 씁니다.
2. 생성이 완료되면 몇 초 뒤 서버 로그에 `{"evt":"video_stored","id":...,"bytes":...,"ms":...,"attempt":1}` 한 줄이 찍히고, 갤러리 상세의 보관 행이 "영구"로 바뀝니다. 실패하면 `generations.mirror_error`에 이유가 남고 `mirror_next_at`(최소 6분, 시도마다 2배, 최대 6시간)이 지난 뒤 크론이 다시 복사합니다. 그동안 그 행은 Higgsfield URL로 재생됩니다.

복사는 완료 전이를 일으킨 요청 하나(브라우저 폴링이나 웹훅)가 응답 뒤에 하고(`maxDuration = 300`), 크론은 sweep 안에서 복사가 끝나기를 기다립니다. 결과를 받는 대로 8 MB part로 잘라 올리므로(한 part에 다 들어가면 put 한 번, 아니면 multipart로 4개씩 동시에) 메모리 정점은 결과 크기와 상관없고, 다른 프로세스의 가짜에서 받아 올릴 때 arrayBuffers 증가가 300 MB 결과 13회에 117–236 MB, 600 MB 결과 8회에 133–256 MB였습니다. 늘 살아 있는 것은 동시에 올리는 part 4개 × 24 MB(우리 8 MB part에 `@vercel/blob`의 fetch가 만드는 본문 사본과 redirect용 tee 사본 8 MB씩)와 채우는 part 8 MB, 합쳐 약 104 MB이고, 앞뒤 part의 요청이 겹치는 순간 165 MB까지 오릅니다. 나머지는 V8이 아직 수거하지 않은 사본입니다(20 ms마다 GC를 강제하면 152–168 MB). 받기와 올리기를 합쳐 240초 안에 끝나야 하고, `Content-Length`나 세어 본 바이트가 1 GB를 넘으면 거부합니다. 같은 키를 덮어쓰므로 lease가 끝난 뒤의 재시도도 안전합니다.

행은 URL이 아니라 객체 키(`videos/<id>.mp4`)만 저장합니다. 공개 주소는 네트워크 호출 없이 토큰(`vercel_blob_rw_<store id>_…`)의 store id로 `https://<store id>.public.blob.vercel-storage.com/videos/<id>.mp4`를 만들고, 다운로드 버튼은 Blob의 `?download=1`(첨부, 파일명 `<id>.mp4`)을 씁니다. 업로드 결과의 URL이 이렇게 만든 주소와 다르면 키를 기록하지 않고 `mirror_error`에 `blob URL mismatch`를 남깁니다. 그때만 `BLOB_PUBLIC_BASE_URL`에 실제 공개 주소를 넣습니다. 다른 스토어나 벤더로 옮길 때는 객체를 복사하고 env만 바꾸면 됩니다.

레퍼런스 업로드 토큰(`/api/uploads/blob`)은 올리는 사람의 `refs/<사용자 id>/<파일 이름>` 경로에만 나가고, 파일 이름은 영문, 숫자, `.`, `-`, `_`만 받습니다(`src/lib/ref-name.ts`의 `REF_NAME`). 플레이그라운드는 원래 이름 대신 `<시각>-<임의 8자><확장자>`로 올리므로 한글이나 공백이 든 파일도 그대로 올라갑니다. 레퍼런스 정리(`cleanupRefs`)는 그 행의 `imageRefs`·`videoRefs` 중 이 스토어에서 URL이 가리키는 경로가 같은 규칙으로 행 주인의 `refs/<사용자 id>/` 바로 아래 파일 하나인 것만 지우고, `del()`에는 받은 URL이 아니라 그 경로로 다시 만든 공개 URL을 넘깁니다. 그래서 퍼센트 인코딩, `..`, 겹친 `/`, 쿼리, 프래그먼트, 전각 마침표 같은 표기로는 다른 사람의 파일에 닿지 않습니다. 브라우저가 다른 행의 보관 영상이나 다른 사용자의 레퍼런스 URL을 보내도 그 파일은 남습니다. 이 규칙 전의 경로(`refs/<시각>-<파일 이름>`)로 올라간 레퍼런스는 더는 지우지 않습니다.

공개 스토어라 uuid를 아는 사람은 누구나 볼 수 있습니다(지금 Higgsfield URL과 같은 수준). 사내 영상을 링크로도 공유하면 안 되면 비공개 스토어로 옮기고 `src/lib/storage.ts`의 `videoUrls`가 서명 URL을 만들도록 고칩니다. 그러면 영상이 함수를 거쳐 나가 전송 비용이 늘고, 오래 열어 둔 탭의 영상 주소는 만료됩니다.

이 변경 전에 Supabase Storage로 복사된 행은 `storage_path`가 `<id>.mp4`(접두사 없음)라 Blob에서 찾을 수 없습니다. 배포 전에 `select count(*) from generations where storage_path is not null and storage_path not like 'videos/%'`로 확인하고, 0이 아니면 그 객체를 Blob의 `videos/<id>.mp4`로 옮긴 뒤 `storage_path`를 고칩니다.

### 비용

운영 목표는 지출 최소입니다. Supabase는 Free 플랜으로 DB만 쓰고, 영상은 Vercel Pro 월 $20 크레딧에서 나가는 Blob에 둡니다(Vercel 공식 문서 기준, 2026-10).

| 항목 | 요율 | 이 앱에서 |
|---|---|---|
| Blob 저장 | $0.023/GB-월 | 월 300건 × 평균 25 MB(추정)면 매달 7.5 GB씩 쌓여 12개월 뒤 90 GB, 약 $2/월 |
| Blob 전송 | Pro는 Flat Rate CDN에 포함 | 재생과 다운로드는 브라우저가 Blob CDN에서 직접 받음 |
| 올리기(Advanced Operation) | $5/백만 건 | put 한 번은 1건, multipart는 시작 1 + part마다 1 + 완료 1. 25 MB 영상은 6건, 월 300건이면 약 1,800건($0.01) |
| CDN 요청, 캐시 MISS의 Fast Origin Transfer | CDN 요율 | 512 MB를 넘는 blob은 캐시되지 않아 볼 때마다 MISS |
| Supabase | Free | DB만. 생성 1건 ≈ 1 KB |

결과 크기가 추정보다 크면 저장 비용이 비례해 늘어납니다. `generations.size_bytes`의 합이 실제 사용량입니다.

## Vercel 배포 (Pro 기준)

```bash
cd web
vercel link --yes --project video-gen-studio     # 프로젝트 만들기/연결
vercel env add DATABASE_URL production           # Supabase 대시보드 → Connect → Transaction pooler URI (6543)
vercel blob create-store video-gen-studio --access public --yes  # 완료 영상 보관 + 4 MB 초과 업로드 → BLOB_READ_WRITE_TOKEN
vercel env add AUTH_SECRET production            # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
vercel env add CRON_SECRET production            # 같은 방법으로 만든 임의 문자열. Vercel Cron이 Bearer로 보냄
vercel env add OPENAI_API_KEY production         # 이미지 생성(GPT Image 2). 팀이 같이 쓰는 키 하나. 다음 배포부터 적용
vercel env pull .env.local --yes
npm run db:migrate && npm run db:seed            # 로컬에서 운영 DB에 적용 (ADMIN_* 은 .env.local에)
vercel --prod
```

`AUTH_SECRET`을 바꾸면 저장된 API 키를 복호화할 수 없게 되니 바꾸지 마세요. 진행 중인 생성의 웹훅 URL도 401이 되고(Higgsfield는 4xx를 다시 보내지 않음), 그 행은 크론과 폴링이 마무리합니다.

### 서버 쪽 트리거와 플랜

- `vercel.json`은 함수를 Supabase DB와 같은 서울(`icn1`)에 두고 `/api/cron/settle`을 매분 부릅니다. 크론 라우트는 `CRON_SECRET`이 없으면 항상 401입니다.
- **Hobby**는 매분 크론이 든 `vercel.json`을 배포 단계에서 거부합니다. Hobby에 배포하려면 `schedule`을 `0 18 * * *`(KST 03시, 하루 1회)로 바꿉니다. 그러면 탭을 닫았고 웹훅까지 놓친 행은 다음 방문이나 다음 날 크론에 정리됩니다. 웹훅과 `after` 복사는 플랜과 상관없이 같습니다.
- 웹훅 주소는 `PUBLIC_BASE_URL`, 없으면 `https://$VERCEL_PROJECT_PRODUCTION_URL`입니다. 프리뷰 배포는 배포 보호 뒤에 있어 웹훅을 받을 수 없으므로 프리뷰에서 제출한 생성도 프로덕션 주소로 등록됩니다. 프리뷰와 프로덕션이 같은 DB를 쓰므로 프로덕션이 그 행을 처리합니다. 프리뷰에 별도 DB를 붙이면 프로덕션은 그 행을 찾지 못해 204로 끝내고, 그 프리뷰의 행은 폴링과 크론으로만 움직입니다.
- 로컬에서는 `PUBLIC_BASE_URL`을 비워 둡니다. 웹훅 없이 브라우저 폴링으로 동작하고, 크론은 `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/settle`로 직접 부릅니다. 가짜 Higgsfield의 웹훅까지 보려면 `PUBLIC_BASE_URL=http://localhost:3000`을 넣습니다.
- **주의: 로컬 크론도 공용 DB 전체를 처리합니다.** `.env.local`의 DB는 프로덕션과 같은 하나뿐이고 sweep은 모든 사용자의 due 행을 처리합니다. 가짜 Higgsfield로 sweep하면 실제 live 행이 `request not found`로 실패하고, 실제 완료 행에 가짜에만 있는 복사본 경로가 기록됩니다. 그래서 `HIGGSFIELD_BASE_URL`이 실제 API가 아닌 서버의 크론 라우트는 sweep하지 않고 409를 돌려줍니다. DB의 due 행이 모두 이 실행의 것일 때만 `SWEEP_ALLOW_NONPROD=1`로 띄워 엽니다(`scripts/burst.ts`는 다른 사용자의 due 행이 있으면 크론을 부르지 않습니다).

## Free(Hobby) 티어 검토

Vercel 공식 문서 기준(2026-10):

| 항목 | Hobby | 이 앱에서 |
|---|---|---|
| 상업적 사용 | **비상업·개인 용도만** (fair use) | 회사 팀이 쓰는 도구라면 약관상 Pro 대상. 가장 큰 리스크 |
| 함수 최대 실행 | 300초 | 모든 요청이 수 초 안에 끝남. 생성 대기는 웹훅, 크론, 클라이언트 폴링이 나눠 맡고 크론 sweep은 240초에서 멈춤 |
| 요청/응답 본문 | 4.5 MB | 큰 영상은 Blob 직접 업로드로 우회. 결과 영상은 브라우저가 Blob(복사 전에는 Higgsfield)에서 직접 재생 |
| Cron | 하루 1회 | `vercel.json`을 `0 18 * * *`로 바꿔야 배포됨. 탭을 닫고 웹훅을 놓친 행은 다음 방문이나 다음 날 정리 |
| Blob | 1 GB 저장, 10 GB 전송/월, 초과 시 차단 | 완료 영상 복사가 1 GB를 금방 채우고, 넘으면 레퍼런스 업로드까지 30일 막힘. Hobby에서는 복사를 끄거나(토큰 없이 운영) Pro |
| 함수 호출 | 월 100만 | 폴링 한 건당 수십 회. 월 수천 건 생성도 여유 |
| Active CPU / 메모리 | 4 CPU-hr / 360 GB-hr | 업로드 프록시(≤4 MB)가 가장 무거움. 수천 건 수준이면 충분 |
| 대역폭 | 100 GB | 영상은 Blob CDN(복사 전에는 Higgsfield)에서 직접 내려받으므로 함수 대역폭을 거의 안 씀 |
| 초과 시 | 구매 불가, 30일 대기 | 한도 도달 시 서비스 중단 가능 |
| 팀원 | 개인 계정 1명 | 어드민은 앱 안의 역할이라 Vercel 팀원은 필요 없음 |
| Supabase (Free) | DB 0.5 GB, Storage 1 GB·파일당 50 MB, 프로젝트 2개, 7일 미사용 시 일시정지 | DB만 씀. 생성 1건 ≈ 1 KB라 수십만 건 가능. 영상은 Storage에 두지 않음. 오래 안 쓰면 대시보드에서 재개 필요 |

결론: 기술적으로는 Hobby에서 그대로 돌아가게 설계했습니다. 단, (1) 회사 업무용이면 약관상 Pro(월 $20)가 맞고, (2) 결과를 영구 보관하려면 Hobby의 Blob 1 GB가 금방 차므로 Pro에서 Blob을 씁니다(위 비용). 지금 운영은 Vercel Pro + Supabase Free입니다.
