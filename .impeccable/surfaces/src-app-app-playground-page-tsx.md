---
version: 1
slug: "src-app-app-playground-page-tsx"
primary_target: "src/app/(app)/playground/page.tsx"
related_targets: ["src/components/Playground.tsx"]
---

# Surface brief: /playground

## Scope and mode

Operate. 팀의 디자이너·영상 제작자가 매일 들어와 프롬프트와 레퍼런스를 넣고, 모델과 파라미터를 고르고, 생성하고, 결과를 보고 내려받는 작업 화면. 이 화면이 Video Gen Studio의 시각 세계를 처음 증명하고, 로그인·갤러리·대시보드는 여기서 정해진 토큰과 타입을 이어받는다.

## Audience, job, constraints

- 사용자: 전문 디자이너·영상 제작자. 파라미터를 숨기지 않는다. 비용은 생성 전·후·누적 모두 보여야 한다(PRODUCT.md 원칙 2·5).
- 반드시 지킬 것: 표준 웹 컨트롤(textarea, input, select, range, button). API 키는 화면에 없다. 남은 시간 추정치는 Higgsfield가 주지 않으므로 지어내지 않고 경과 시간을 보여 준다.
- 피할 것(사용자 확정): 장난스럽고 가벼운 소비자 앱 느낌, 흔한 AI 도구(검정+네온 글로우+그라데이션).
- 2026-10-27 결정 라운드에서 사용자가 고른 카드: 세로 영상 피드(딜된 챌린저). 리소 프레스(배정), 콜시트(픽), 게이트 보드, 고밀도 그리드, 카테고리 표준은 선택되지 않음.

## Direction contract

THESIS: 결과 영상 하나가 무대를 다 가진다. 작업 화면이 "폼 + 사이드 카드"로 갈라지는 카테고리 기본 배치를 거부하고, 왼쪽 서랍의 폼이 오른쪽 무대에 올라가는 한 편의 영상을 만든다는 관계를 화면 구조로 말한다. 다음 결과는 한 번 튕기면 온다.

OWN-WORLD: Void #0a0a0a 바탕, Ink #121316 패널, Slate #1e2026 입력, Mist #2a2f39 헤어라인. 글자와 글리프는 흰색 하나이고 보조 글자는 #9aa3ad, 비용·메타 숫자는 Sand #c7b9a6. 강조색은 없다: 주 행동은 흰 채움에 검정 글자, 선택된 모델 카드도 흰 채움. 디스플레이는 Bebas Neue(워드마크, 레일 카운터, 상태 숫자), 본문은 Inter + 시스템 한글. 컨트롤은 Slate 바탕 1px Mist 테두리 6px 라운드, 버튼은 알약. 상태색은 배지와 선에만: 완료 emerald, 실패 rose, 대기 zinc, 생성 중 흰색 진행선. 미디어 아래는 검정 스크림이 글자를 받친다. 글로우·그라데이션 배경·보라 없음.

STORY: 들어오면 무대에 마지막 결과(또는 생성 중인 것)가 크게 보이고 아래 스크림에 모델·길이·비용·프롬프트가 읽힌다. 왼쪽 서랍에서 프롬프트와 레퍼런스를 넣고 모델·파라미터를 조정하면 예상 비용이 즉시 바뀐다. 생성을 누르면 새 항목이 무대 맨 위로 올라와 진행선이 차오르고, 완료되면 그 자리에서 재생된다. 이전 결과는 한 번 스냅하면 온다. 레일의 글리프로 취소·다운로드·갤러리·다시 만들기를 한다.

FIRST VIEWPORT: 1440×900 기준. 상단 56px 내비(워드마크 Bebas Neue, 링크, 사용자, 알약 로그아웃). 그 아래 2열: 왼쪽 480px 서랍(스크롤), 오른쪽 나머지가 무대. 서랍: "1 · 프롬프트와 레퍼런스"(textarea 4줄, 16:9 썸네일 판, 업로드 존), "2 · 모델과 하이퍼파라미터"(모델 카드 3개 가로, 파라미터 2열), 하단 고정 바에 예상 비용(Sand 숫자)과 흰 알약 "생성하기". 무대: 세로 스냅 피드. 첫 항목이 무대 높이를 다 채우고(영상은 object-contain, 바탕 Ink), 하단 스크림에 작성자 줄(모델 · 길이 · 비용), 상태 줄("생성 중 · 경과 0:42" 또는 상태 배지), 프롬프트 캡션 2줄. 무대 오른쪽 가장자리에 세로 글리프 레일 5개(생성·취소·다운로드·갤러리·다시), 각 글리프 아래 Bebas 카운터(비용·경과·MP4·갤러리 건수·×n). 다음 항목의 윗부분 72px이 무대 아래에 비친다. 빈 상태는 무대에 "첫 영상을 만들어 보세요" 한 줄과 서랍을 가리키는 안내.

FORM: 세로 영상 피드(pop-culture-shelf-vertical-video-feed-surface), 딜된 챌린저 카드. 내 그라운디드 목록 밖의 선택. seed:d4c107fa0fab67c0.

Signature interaction and motion: 피드는 scroll-snap-type y mandatory, 항목 높이 100%. 생성 제출 시 새 항목이 맨 위에 삽입되고 피드가 맨 위로 부드럽게 스냅한다(reduced-motion이면 즉시). 진행선은 하단 2px 흰 선이 경과에 따라 차오르되 ETA가 없으므로 결정형(ease-out, 90%에서 멈춤) 대신 "경과 시간" 숫자가 1초마다 바뀐다. 글리프 버튼은 hover에 흰 채움, 활성(생성 가능)은 항상 흰 채움.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- 모바일: 무대를 먼저(약 70vh) 두고 서랍을 아래에 둔다. 레일은 무대 아래 가로 바. 사용자 확인 전 가정.
- 결과 영상 화면비가 세로(9:16)인 경우 무대를 꽉 채우고, 16:9는 contain. 크롭하지 않는다.
