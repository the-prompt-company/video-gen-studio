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
- **결과 보관**: Higgsfield는 결과를 7일 뒤 지웁니다. 갤러리에 남은 일수를 표시하고 다운로드 버튼을 둡니다. 결과를 영구 보관하려면 Blob 미러링을 켜야 하는데, Hobby의 Blob 1 GB 한도 때문에 기본으로 끄는 쪽을 권합니다(아래 Free 티어 검토).

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
| `FAKE_HF_MEDIA_DELAY_MS` | `0` | `/media/` 응답 지연 |

`GET /_stats`는 Idempotency-Key별 수락 수, 요청별·키별 상태 조회 수(초당 최대 포함), 웹훅 전송 수, 미디어 다운로드 수를 돌려주고 `POST /_reset`은 모두 비웁니다. 단위 테스트는 `node --test --import tsx scripts/fake-higgsfield.test.ts`입니다.

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
