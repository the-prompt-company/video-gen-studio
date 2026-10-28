# Video Gen Studio

Higgsfield API 위에 올린 팀용 영상 생성 사이트. Next.js 16 (App Router) + Supabase Postgres (Drizzle) + Vercel Blob(선택).

| 경로 | 내용 |
|---|---|
| `/` | 랜딩 |
| `/login` | ID/비밀번호 로그인 (개별 배부) |
| `/playground` | 프롬프트 + 이미지 ≤6 + 영상 레퍼런스, 모델·하이퍼파라미터, 실시간 진행, 다운로드 |
| `/gallery` | 완료 영상 (본인; 관리자는 전체 토글) |
| `/dashboard` | 본인 사용량: 누적/30일 비용, 횟수, 모델별, 일별 차트, 최근 20건 |
| `/admin` | 사용자 추가 · API 키 할당 · 비밀번호/역할/활성 · 모델 단가 · 전체 로그(필터, CSV) |

## 동작 원리

- **인증**: 서버가 scrypt 해시로 비밀번호를 검증하고 7일짜리 HttpOnly JWT 쿠키를 발급합니다. 10회 실패 시 15분 잠금. `proxy.ts`가 보호 경로를 막습니다.
- **API 키**: 사용자가 입력하지 않습니다. 관리자가 어드민에서 사용자별로 할당하고, DB에는 `AUTH_SECRET`로 AES-GCM 암호화돼 저장됩니다. 서버만 복호화해 Higgsfield를 호출합니다.
- **생성 흐름**: `POST /api/generations` → Higgsfield `POST /{model_id}` (Idempotency-Key 포함) → `request_id` 저장. 브라우저가 `GET /api/generations/:id`를 2s→×1.5→최대 10s 간격으로 폴링하고, 서버가 그때 Higgsfield 상태를 한 번 조회해 DB를 갱신합니다. Hobby 플랜의 cron 제약(하루 1회) 때문에 서버 측 폴링은 두지 않았습니다.
- **비용**: Higgsfield 응답에 비용이 없으므로 `models.price_per_sec_usd × 요청 길이(초)`로 계산합니다. 완료 건만 과금. 어드민 → 모델 탭에서 단가를 넣어야 0이 아닌 값이 나옵니다.
- **레퍼런스 업로드**: 4 MB 이하 파일은 서버를 거쳐 Higgsfield 업로드 스토리지로 바로 갑니다(Blob 사용 안 함). 그보다 큰 mp4는 `BLOB_READ_WRITE_TOKEN`이 있을 때만 브라우저 → Vercel Blob 직접 업로드로 받고, 생성이 끝나면 삭제합니다.
- **결과 보관**: Higgsfield는 결과를 7일 뒤 지웁니다. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 있으면 완료 전이를 일으킨 요청이 응답 뒤(`after`)에 결과를 받아 Supabase Storage 공개 버킷에 `<생성 id>.mp4`로 복사하고, 갤러리와 피드는 그 복사본을 재생합니다(보관 "영구"). `SUPABASE_URL`이나 `SUPABASE_SERVICE_ROLE_KEY`가 비어 있으면 복사하지 않고 Higgsfield URL로 재생하며 갤러리에 남은 일수를 표시합니다(아래 완료 영상 보관).

## 데이터베이스 (Supabase)

- [supabase.com](https://supabase.com)에서 프로젝트를 만들고 **Connect → Transaction pooler** URI(포트 6543)를 `DATABASE_URL`에 넣습니다. Vercel 서버리스에서는 이 주소를 써야 연결 수가 폭주하지 않습니다.
- 드라이버는 `postgres`(postgres-js)이고 pooler 호환을 위해 `prepare: false`로 둡니다. 마이그레이션(`npm run db:migrate`)도 같은 URI로 동작합니다.
- Neon 전용 코드는 없으므로 일반 Postgres(로컬 Docker 포함)에도 그대로 붙습니다.

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

API 키 없이 생성 흐름을 끝까지 보려면 `scripts/fake-higgsfield.ts`를 띄우고 앱이 그쪽을 보게 합니다. 실제 API와 같은 경로와 응답 모양(`POST /{model_id}`, `GET /requests/{id}/status`, `POST /requests/{id}/cancel`, `Idempotency-Key`)을 씁니다.

```bash
npm run fake:hf                                        # fake higgsfield on http://localhost:4010
HIGGSFIELD_BASE_URL=http://localhost:4010 npm run dev  # 또는 .env.local에 적기
```

어드민에서 사용자에게 `fake:key` 같은 임의의 `id:secret` 문자열을 API 키로 넣으면 생성하기가 동작합니다. 요청은 `FAKE_HF_DURATION_MS`(기본 `3000-8000`) 안에 대기 → 생성 중 → 완료로 바뀌고 결과 영상은 가짜 서버의 `/media/{id}.mp4`(`FAKE_HF_VIDEO_BYTES`, 기본 2 MB)입니다. `HIGGSFIELD_BASE_URL`을 비우면 실제 `https://api.higgsfield.ai`로 갑니다.

| 환경 변수 | 기본 | 동작 |
|---|---|---|
| `FAKE_HF_PORT` | `4010` | 포트 |
| `FAKE_HF_DURATION_MS` | `3000-8000` | 제출부터 완료까지 걸리는 시간(범위 또는 고정값) |
| `FAKE_HF_429_FIRST_N` | `0` | API 키별 처음 N건 제출에 429와 `Retry-After: 5` |
| `FAKE_HF_DROP_WEBHOOKS` | `0` | `?hf_webhook=` 웹훅을 이 비율만큼 보내지 않음 |
| `FAKE_HF_DUP_WEBHOOKS` | 없음 | `1`이면 완료 웹훅을 두 번 보냄 |
| `FAKE_HF_VIDEO_BYTES` | `2097152` | `/media/` 응답 크기 |
| `FAKE_HF_VIDEO_FILE` | 없음 | `/media/` 응답으로 보낼 실제 영상 파일. 브라우저에서 재생까지 보려면 `public/mock/result-landscape.webm` 같은 파일을 주고, 주면 `FAKE_HF_VIDEO_BYTES`는 무시 |
| `FAKE_HF_MEDIA_DELAY_MS` | `0` | `/media/` 응답 지연 |
| `FAKE_HF_STORAGE_FAIL_N` | `0` | 스토리지 쓰기 처음 N건에 500 |
| `FAKE_HF_STATUS_FAIL_N` | `0` | 상태 조회 처음 N건에 503 |
| `FAKE_HF_WEBHOOK_RETRY_MS` | `2000` | 웹훅이 5xx나 연결 오류를 받으면 이 간격부터 두 배씩 늘려 2시간 동안 다시 보냄. 4xx는 다시 보내지 않음(Higgsfield와 같음) |

가짜 서버는 Supabase Storage의 부분집합(`POST|PUT /storage/v1/object/{bucket}/{key}`, `GET /storage/v1/object/public/{bucket}/{key}`)도 받으므로 `SUPABASE_URL=http://localhost:4010 SUPABASE_SERVICE_ROLE_KEY=fake`로 복사 흐름까지 로컬에서 돌릴 수 있습니다. `GET /_stats`는 Idempotency-Key별 수락 수, 요청별·키별 상태 조회 수(초당 최대 포함), 웹훅 전송·재전송 수와 요청별 응답 코드 목록, 미디어 다운로드 수, 스토리지 키별 쓰기 횟수·크기·sha256을 돌려주고 `POST /_reset`은 모두 비웁니다. `POST /_config`에 `{"mediaDelayMs": 250000}`, `{"storageFailN": 3}`(다음 3건 실패), `{"statusFailN": 1}`, `{"dropWebhooks": 1}`, `{"dupWebhooks": true}`를 보내면 서버를 다시 띄우지 않고 그 값을 바꿉니다. 단위 테스트는 `node --test --import tsx scripts/fake-higgsfield.test.ts`, 생명주기와 복사 단정은 `HIGGSFIELD_BASE_URL=http://localhost:4010 SUPABASE_URL=http://localhost:4010 SUPABASE_SERVICE_ROLE_KEY=fake npx dotenv -e .env.local -- tsx scripts/lifecycle-check.ts`입니다.

## 완료 영상 보관 (Supabase Storage)

1. Supabase 대시보드 → Storage → New bucket. 이름 `videos`, **Public bucket** 켬. Storage Settings의 Global file size limit을 1 GB 이상으로 올립니다(복사는 1 GB 넘는 결과를 거부합니다). Free는 50 MB를 넘길 수 없고 Pro는 500 GB까지 올릴 수 있습니다.
2. Project Settings → API에서 `SUPABASE_URL`(Project URL)과 `SUPABASE_SERVICE_ROLE_KEY`(service_role)를 `.env.local`과 Vercel 환경 변수에 넣습니다. 버킷 이름을 바꿨으면 `SUPABASE_VIDEO_BUCKET`도 넣습니다.
3. 생성이 완료되면 몇 초 뒤 서버 로그에 `{"evt":"video_stored","id":...,"bytes":...,"fetchMs":...,"uploadMs":...,"attempt":1}` 한 줄이 찍히고, 갤러리 상세의 보관 행이 "영구"로 바뀝니다. 실패하면 `generations.mirror_error`에 이유가 남고 `mirror_next_at`(최소 6분, 시도마다 2배, 최대 6시간)이 지나야 다시 복사할 수 있습니다. 아직 자동 재시도는 없으므로 그 행은 만료 전까지 Higgsfield URL로 재생됩니다.

복사는 완료 전이를 일으킨 요청 하나가 응답 뒤에 합니다(`maxDuration = 300`). 결과 전체를 메모리에 올리므로 1 GB를 넘는 결과는 거부합니다. 행은 URL이 아니라 객체 키(`<id>.mp4`)만 저장하므로 버킷이나 벤더를 옮길 때는 객체를 복사하고 env만 바꾸면 됩니다.

공개 버킷이라 uuid를 아는 사람은 누구나 볼 수 있습니다(지금 Higgsfield URL과 같은 수준). 사내 영상을 링크로도 공유하면 안 되면 버킷을 Private으로 바꾸고 `src/lib/storage.ts`의 `videoUrls`가 `getPublicUrl` 대신 `createSignedUrl`(예: 1시간)을 쓰도록 고칩니다. 그러면 갤러리를 열 때마다 서명 요청이 한 번 더 가고, 오래 열어 둔 탭의 영상 주소는 만료됩니다.

## Vercel 배포 (Hobby 기준)

```bash
cd web
vercel link --yes --project video-gen-studio     # 프로젝트 만들기/연결
vercel env add DATABASE_URL production           # Supabase 대시보드 → Connect → Transaction pooler URI (6543)
vercel blob create-store video-gen-refs          # 선택: 4 MB 초과 업로드용 → BLOB_READ_WRITE_TOKEN
vercel env add AUTH_SECRET production            # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
vercel env pull .env.local --yes
npm run db:migrate && npm run db:seed            # 로컬에서 운영 DB에 적용 (ADMIN_* 은 .env.local에)
vercel --prod
```

`AUTH_SECRET`을 바꾸면 저장된 API 키를 복호화할 수 없게 되니 바꾸지 마세요.

## Free(Hobby) 티어 검토

Vercel 공식 문서 기준(2026-10):

| 항목 | Hobby | 이 앱에서 |
|---|---|---|
| 상업적 사용 | **비상업·개인 용도만** (fair use) | 회사 팀이 쓰는 도구라면 약관상 Pro 대상. 가장 큰 리스크 |
| 함수 최대 실행 | 300초 | 모든 요청이 수 초 안에 끝남. 생성 대기는 클라이언트 폴링 |
| 요청/응답 본문 | 4.5 MB | 큰 영상은 Blob 직접 업로드로 우회. 결과 영상은 Higgsfield URL을 그대로 재생 |
| Cron | 하루 1회 | 안 씀 (폴링으로 대체) |
| Blob | 1 GB 저장, 10 GB 전송/월, 초과 시 차단 | 입력 파일은 생성 후 삭제. 결과 미러링은 끔 |
| 함수 호출 | 월 100만 | 폴링 한 건당 수십 회. 월 수천 건 생성도 여유 |
| Active CPU / 메모리 | 4 CPU-hr / 360 GB-hr | 업로드 프록시(≤4 MB)가 가장 무거움. 수천 건 수준이면 충분 |
| 대역폭 | 100 GB | 영상은 Higgsfield CDN에서 직접 내려받으므로 Vercel 대역폭을 거의 안 씀 |
| 초과 시 | 구매 불가, 30일 대기 | 한도 도달 시 서비스 중단 가능 |
| 팀원 | 개인 계정 1명 | 어드민은 앱 안의 역할이라 Vercel 팀원은 필요 없음 |
| Supabase (Free) | 0.5 GB 저장, 프로젝트 2개, 7일 미사용 시 일시정지 | 생성 1건 ≈ 1 KB. 수십만 건 가능. 오래 안 쓰면 대시보드에서 재개 필요 |

결론: 기술적으로는 Hobby에서 그대로 돌아가게 설계했습니다. 단, (1) 회사 업무용이면 약관상 Pro(월 $20)가 맞고, (2) 결과를 영구 보관하려면 Blob 1 GB가 금방 차므로 다운로드 운영이나 Pro/외부 스토리지가 필요합니다.
