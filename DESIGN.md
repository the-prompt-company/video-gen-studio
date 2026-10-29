---
name: Video Gen Studio
description: Higgsfield 위에 올린 팀용 영상 생성 도구. 결과 영상 하나가 무대를 다 가지는 검은 무대와 흰 글리프.
colors:
  void: "#0a0a0a"
  ink: "#121316"
  slate: "#1e2026"
  mist: "#2a2f39"
  white: "#ffffff"
  white-hover: "#e4e4e7"
  white-dim: "#d4d6db"
  muted: "#9aa3ad"
  subtle: "#838c98"
  sand: "#c7b9a6"
  status-running: "#7dd3fc"
  status-done: "#6ee7b7"
  status-failed: "#fda4af"
  status-blocked: "#fcd34d"
typography:
  display:
    fontFamily: "Bebas Neue, 'Arial Narrow', Impact, sans-serif"
    fontSize: "4.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.06em"
  numeral:
    fontFamily: "Bebas Neue, 'Arial Narrow', Impact, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.06em"
  wordmark:
    fontFamily: "Bebas Neue, 'Arial Narrow', Impact, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.06em"
  counter:
    fontFamily: "Bebas Neue, 'Arial Narrow', Impact, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.06em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  section:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.05em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  meta:
    fontFamily: "Inter, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1
rounded:
  xs: "4px"
  md: "6px"
  xl: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  field: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  peek: "72px"
components:
  button-primary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.void}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.white-hover}"
  button-primary-lg:
    backgroundColor: "{colors.white}"
    textColor: "{colors.void}"
    typography: "{typography.title}"
    rounded: "{rounded.pill}"
    padding: "0 28px"
    height: "48px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.white-dim}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-danger:
    backgroundColor: "rgba(225,29,72,0.9)"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  input:
    backgroundColor: "{colors.slate}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  textarea:
    backgroundColor: "{colors.slate}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  model-card:
    backgroundColor: "{colors.slate}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px"
  model-card-selected:
    backgroundColor: "{colors.white}"
    textColor: "{colors.void}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px"
  glyph:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    size: "52px"
  glyph-active:
    backgroundColor: "{colors.white}"
    textColor: "{colors.void}"
    rounded: "{rounded.pill}"
    size: "52px"
  nav-link-active:
    backgroundColor: "rgba(255,255,255,0.12)"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "40px"
  status-chip:
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "20px"
---

# Design System: Video Gen Studio

## Overview

**Creative North Star: "The Stage" (무대)**

결과 영상 하나가 무대를 다 가진다. 화면은 검은 무대(void)와 그 위에 서 있는 흰 글리프뿐이고, 색은 영상이 가져온다. 왼쪽 서랍의 폼은 오른쪽 무대에 올라갈 한 편을 준비하는 자리이며, 다음 결과는 한 번 스냅하면 온다. 이 시스템은 전문 디자이너·영상 제작자가 매일 들어와 프롬프트를 넣고 모델과 파라미터를 고르고 비용을 확인하는 **도구**다. 장난스럽거나 가벼운 소비자 앱 느낌은 거부했고, 검정+네온 글로우+그라데이션으로 된 흔한 AI 도구 외형도 거부했다. 2026-10-27에 보라 강조색 세계("The Night Render Desk")를 걷어내고 이 세계로 교체했으며, 이 라운드는 컴프 없이 코드로 바로 지었다.

강조색은 없다. 주 행동은 흰 채움에 검정 글자이고, 모델은 표준 select로 고른다. 숫자(비용, 길이, 카운터, 경과 시간)만 Bebas Neue와 Sand로 따로 목소리를 낸다. 깊이는 그림자가 아니라 네 단계 무채색 표면과 미디어 위의 검은 스크림으로 만든다. 밀도는 서랍 안에서는 중간(필드 사이 16px, 안쪽 20px), 무대에서는 비어 있음에 가깝다. 모션은 150ms 색 전환과 ETA가 없어서 채워지지 않고 **지나가는** 2px 진행선 하나뿐이다.

**Key Characteristics:**
- 바탕 void 위에 ink, slate, mist 세 단계 무채색과 1px 헤어라인으로만 구조를 세운다. 색 있는 강조색은 없고 흰색이 강조색이다.
- Bebas Neue는 숫자와 라틴 한 단어(워드마크, 카운터, 비용, 경과 시간, MP4)에만 쓰고, Inter + 시스템 한글이 본문을 맡는다.
- Sand(#c7b9a6)는 Bebas 숫자에만 얹는 따뜻한 색이다. 본문·라벨·아이콘에는 쓰지 않는다.
- 결과는 세로 스냅 피드 위에서 한 번에 하나만 무대를 차지하고, 다음 항목의 72px이 아래에 비친다.
- 상태색(sky, emerald, rose, amber)은 알약 배지와 오류 상자 안에서만 켜진다.
- 그림자 없음. 깊이는 표면 단계와 스크림. reduced-motion이면 스냅·진행선·펄스·색 전환이 모두 정지한다.

## Colors

거의 완전한 무채색 위에 흰색이 행동을 말하고, Sand가 숫자를 말하며, 색은 영상과 상태 배지만 가져온다.

### Primary
- **White** (`white`, --accent): 주 행동의 채움색이자 글자색이다. "생성하기" 알약, 활성 글리프, 포커스 링 2px, 캐럿, 슬라이더·체크박스의 accent-color, 진행선. 바탕이 될 때는 글자가 void로 뒤집힌다.
- **White, Hover** (`white-hover`, --accent-hover): 흰 채움 요소의 hover에만. 살짝 가라앉는 정도로 충분하다.

### Secondary
- **Sand** (`sand`, --sand / --accent-soft): 따뜻한 모래색. Bebas Neue 숫자 전용이다. 하단 바의 예상 비용(24px), 레일 글리프 카운터(16px), 피크 스트립의 "01 / 04"와 캡션의 "5S · $0.2250"(14px), 내비의 ADMIN 태그(12px). 그 밖의 어떤 글자나 면에도 쓰지 않는다.

### Neutral
- **Void** (`void`, --background): 페이지와 무대의 바탕. 내비는 이 색 85% + backdrop-blur, 서랍 하단 바는 90% + blur.
- **Ink** (`ink`, --surface): 피드 항목의 바탕(영상은 object-contain이므로 레터박스가 이 색), 문서형 페이지의 카드, API 키 경고 상자.
- **Slate** (`slate`, --surface-2): 입력·textarea·select, 모델 select, 레퍼런스 썸네일 바탕. 서랍에서 한 단 올라온 것.
- **Mist** (`mist`, --border): 모든 1px 테두리와 구분선. 내비 아래, 서랍과 무대 사이, 레일 왼쪽, 업로드 존의 점선.
- **White, Dim** (`white-dim`, --foreground-2): 캡션 프롬프트, 카드 제목, 고스트 버튼과 prev/next 화살표, 내비의 사용자명, queued 배지 글자.
- **Muted** (`muted`): 필드 라벨, 섹션 번호 헤딩, 설명문, 피크 스트립 프롬프트, 글리프 라벨, 내비 비활성 링크. void 위 7.9:1, ink 위 6.6:1.
- **Subtle** (`subtle`): 힌트, 메타, 플레이스홀더, 모델 select 힌트의 단가, 빈 상태 문구, Stat 라벨. 가장 어두운 글자이며 slate 위 4.8:1. 이보다 어두운 글자는 없다.

### Status
- **Running** (`status-running`, sky-300 글자 + sky-500 15% 틴트 + 30% 링), **Done** (`status-done`, emerald), **Failed** (`status-failed`, rose), **Blocked/NSFW** (`status-blocked`, amber), **Queued/Canceled** (zinc-500 15% 틴트에 white-dim 또는 muted 글자). 배지 안에서만 쓴다. 오류 문구는 rose-500 10% 틴트 상자 안의 rose-300 글자, 위험 버튼은 rose-600 90%. API 키 경고의 점은 amber-400.

### Named Rules
**The White Is The Accent Rule.** 강조색은 흰색 하나다. 행동·선택·포커스·진행은 흰 채움 또는 흰 선으로 말하고, 색상(hue)을 가진 면은 상태 배지와 오류 상자 외에는 없다. 보라·시안·네온 글로우는 2026-10-27에 걷어냈고 다시 들이지 않는다.

**The Sand Numeral Rule.** Sand는 Bebas Neue 숫자 위에만 얹는다. 본문, 라벨, 아이콘, 테두리에 Sand를 쓰면 숫자의 목소리가 사라진다.

**The Four Tiers Rule.** 글자 색은 white, white-dim, muted, subtle 네 토큰(`text-foreground`, `text-foreground-2`, `text-muted`, `text-subtle`)만 쓴다. `text-zinc-*`와 임의 rgba 글자색은 쓰지 않는다. 유일한 예외는 흰 채움 위의 `text-background` 와 `text-background/70`.

## Typography

**Display Font:** Bebas Neue (fallback: Arial Narrow, Impact) — `.font-display`, letter-spacing 0.06em
**Body Font:** Inter (fallback: system-ui, Apple SD Gothic Neo, Noto Sans KR, Malgun Gothic)
**Label/Mono Font:** 없음. 숫자 정렬은 Inter의 `tabular-nums`로 한다.

**Character:** Bebas Neue는 포스터의 숫자처럼 좁고 높다. 라틴과 숫자만 있으므로 워드마크·카운터·경과 시간처럼 한 단어 이하의 라틴·숫자에만 쓰고, 한글이 들어가는 모든 글은 Inter + 시스템 고딕이 맡는다. 굵기는 Bebas 400 하나, Inter는 400·500·600 세 단계.

### Hierarchy
- **Display** (Bebas 400, 72px → 640px 이상 96px, 1, +0.06em): 무대 가운데의 경과 시간 "0:47"과 실패·취소 상태의 한 단어. 이 크기는 무대에만 있다.
- **Numeral** (Bebas 400, 24px, 1): 서랍 하단 바의 예상 비용. Sand.
- **Wordmark** (Bebas 400, 22px, 1): 내비·로그인·랜딩의 "Video Gen Studio". 흰색.
- **Counter** (Bebas 400, 16px, 1): 레일 글리프 아래 카운터(비용, 경과, MP4, 갤러리 건수, ×n). 14px 변형은 피크 스트립의 "01 / 04", 캡션의 "5S · $0.2250", 썸네일 번호. 12px은 ADMIN 태그. Sand(썸네일 번호만 흰색).
- **Headline** (Inter 600, 24px, 1.33): 문서형 페이지(갤러리·대시보드·어드민)와 로그인의 h1. 바로 아래 muted 14px 설명 한 줄.
- **Title** (Inter 600, 16px, 1.5): 서랍의 h1 "플레이그라운드", 48px 주 버튼 글자. 빈 상태 제목은 20px → 24px.
- **Section** (Inter 600, 12px, +0.05em, muted): 서랍의 번호 헤딩 "1 · 프롬프트와 레퍼런스". 순서가 정보일 때만 번호를 붙인다.
- **Body** (Inter 400, 14px, 1.43): 본문, 입력, 버튼, 캡션 상태 줄, 내비 링크. 캡션 프롬프트는 1.625 행간에 2줄 클램프, 최대 폭 672px.
- **Label** (Inter 500, 12px, 1.33): 필드 라벨(muted), 힌트는 subtle 400 tabular. 작은 알약 버튼(sm) 글자.
- **Meta** (Inter 400, 11px, 1): 글리프 라벨, 상태 배지(500), 하단 바의 계산식, 썸네일 "제거". 11px 아래로는 내려가지 않는다.

### Named Rules
**The Bebas Is A Numeral Rule.** Bebas Neue는 숫자와 라틴 한 단어에만 쓴다. 한글 본문·라벨·버튼에 `.font-display`를 얹지 않는다. Bebas에는 한글이 없어 시스템 글꼴로 떨어진다.

**The Tabular Rule.** 비용, 길이, 횟수, 개수 등 Inter로 쓴 숫자는 모두 `tabular-nums`. 비용은 `usd()`로 소수 자릿수를 맞춘다(≥100은 정수, ≥1은 2자리, 그 아래는 4자리).

## Layout

플레이그라운드는 1024px 이상에서 내비 아래 전체 높이(`100dvh − 56px`)를 두 열로 나눈다. 왼쪽 480px 서랍(내부 스크롤, 안쪽 20px, 하단 고정 바), 오른쪽 나머지가 무대. 무대는 세로 스냅 피드와 그 오른쪽 96px 글리프 레일(왼쪽 1px Mist)로 나뉜다. 1024px 미만에서는 무대가 먼저(72dvh, 최소 480px), 레일이 그 아래 가로 바(위 1px Mist)로, 서랍이 그 아래로 온다. 서랍의 썸네일 판·업로드 존·파라미터는 640px 이상에서 2열.

문서형 페이지(갤러리·대시보드·설정·어드민)는 `PageContainer`: 최대 폭 1280px, 좌우 16px, 상하 32px. 로그인은 최대 폭 384px 가운데 정렬. 설정은 카드 없이 구역을 Mist 1px 선으로 나누고, 768px 이상에서 구역마다 왼쪽 240px 제목(16px 600)과 muted 설명, 오른쪽 384px 폼의 두 열이며 선은 그 두 열 너비(672px)에서 끝난다. 그 아래로는 한 열.

간격 리듬은 4의 배수에 6px 하나. 라벨과 입력 사이 6px, 필드 사이 16px, 서랍 섹션 사이 16px, 섹션 안 12px, 카드 안쪽 20px, 카드 사이 24px, 문서형 페이지 섹션 사이 32px. 레일 글리프 사이 16px(모바일 12px), 글리프와 카운터 사이 6px.

내비는 sticky 56px. 640px 미만에서는 워드마크·사용자·로그아웃 한 줄 아래에 가로 스크롤되는 링크 줄(44px)이 붙는다. 터치 타깃은 44px: 글리프는 모바일 44px, 데스크톱 52px; 링크·버튼·체크박스 행은 `min-h-11`(모바일) 또는 `min-h-10`(데스크톱).

### Named Rules
**The One Snap Rule.** 피드는 `scroll-snap-type: y mandatory`, 항목은 `scroll-snap-stop: always`. 한 번에 하나의 결과만 무대를 가지며, 중간에 멈추지 않는다. 항목 높이는 무대 높이 − 72px이라 다음 항목의 피크 스트립(번호 · 프롬프트 · 배지)이 항상 아래에 비친다. 무대의 60% 이상이 보이는 항목이 활성(`aria-current`)이고 레일의 카운터는 그 항목을 따른다.

## Elevation & Depth

그림자가 없다. 깊이는 **톤 단계**(void → ink → slate)와 1px Mist 헤어라인, 그리고 미디어 위의 **스크림**으로 만든다. 캡션 스크림은 투명 → 55%(40%) → 94% void 그라데이션(`.scrim`), 피크 스트립은 90% → 투명(`.scrim-top`). 그라데이션은 이 두 스크림이 전부이고, 글자를 받치는 용도 외에는 없다. 떠 있는 면은 내비(void 85% + blur)와 서랍 하단 바(void 90% + blur)뿐이며, 둘 다 스크롤 콘텐츠 위에 얹히는 반투명 띠다. 흰 채움 버튼에도 그림자는 없다.

### Shadow Vocabulary
- **Thumbnail numeral only** (`drop-shadow`, Tailwind 기본 `0 1px 2px rgba(0,0,0,.1), 0 1px 1px rgba(0,0,0,.06)`): 레퍼런스 썸네일 왼쪽 위 Bebas 번호가 밝은 이미지 위에서도 읽히도록. 유일한 그림자이고, 면이 아니라 글자에 있다.

### Named Rules
**The Scrim Not Shadow Rule.** 면은 뜨지 않는다. 글자가 미디어 위에 놓여야 하면 검은 스크림으로 받치고, 면이 면 위에 놓여야 하면 톤 한 단계와 1px Mist로 구분한다. `box-shadow`와 색 있는 글로우는 어디에도 없다.

## Shapes

행동은 알약, 컨트롤은 6px, 면은 12px, 글리프는 원. 버튼(primary·outline·ghost·danger), 내비 링크, 로그아웃, 상태 배지, 랜딩의 모델 태그는 완전한 알약(9999px). 입력·textarea·select·업로드 존·썸네일·오류 상자·API 키 경고는 6px. 문서형 페이지의 Card, Stat, Empty는 12px. 레일 글리프는 1.5px 흰 선(80%)의 원, 활성이면 흰 채움. prev/next 화살표는 36px 원형 히트 영역, 위치 점은 6px 원(활성 흰색, 나머지 흰색 30%). ADMIN 태그만 4px. 업로드 존은 1px 점선 Mist로 "비어 있음"을 말하고 hover에서 흰색 60%, focus-within에서 흰 실선 + 흰색 40% 링. 썸네일은 16:9, 112px 너비. 영상은 크롭하지 않는다(object-contain, 레터박스는 ink).

## Components

### Buttons
- **Shape:** 알약(9999px), 글자 500, 줄바꿈 없음. 높이 sm 36 / md 40 / lg 48px, 좌우 16 / 20 / 28px, 글자 12 / 14 / 16px.
- **Primary:** 흰 채움에 void 글자. hover white-hover. 비활성 40% 투명 + not-allowed. "생성하기"(lg)와 "로그인"(lg, 꽉 찬 너비).
- **Hover / Focus:** 150ms 색 전환. focus-visible에 흰 2px 링 + void 2px 오프셋(모든 버튼·글리프 공통). 입력의 링은 흰색 40%.
- **Outline:** 투명, 흰색 40% 테두리, 흰 글자. hover 테두리 흰색 + 흰색 5% 틴트. 빈 상태의 "생성 설정으로 이동"(sm).
- **Ghost:** 투명, white-dim 글자. hover 흰색 10% 틴트 + 흰 글자.
- **Danger:** rose-600 90% 바탕, 흰 글자, hover rose-500. 삭제·비활성화에만.

### Chips (StatusBadge)
- **Style:** 알약, 11px 500, 2px 8px, 색 15% 틴트 바탕 + 30% 인셋 링 + 300 단계 글자.
- **State:** queued/in_progress는 글자색 6px 점이 2s pulse(reduced-motion이면 정지). 피크 스트립 오른쪽 위와 문서형 페이지 목록에서 쓴다.

### Cards / Containers
- **Corner Style:** 12px(Card, Stat, Empty).
- **Background:** ink, 1px Mist. Empty는 점선.
- **Shadow Strategy:** 없음(Scrim Not Shadow Rule).
- **Internal Padding:** 20px. 제목 줄은 h2 14px 600 white-dim + 0.025em, 오른쪽에 액션 슬롯, 아래 16px. 플레이그라운드에는 카드가 없다. 서랍은 면 없이 Mist 구분선과 섹션 헤딩으로만 나뉜다.

### Inputs / Fields
- **Style:** slate 바탕, 1px Mist, 6px 라운드, 40px 높이(textarea는 8px 12px, 1.625 행간), 흰 글자, subtle 플레이스홀더. 체크박스 16px, range 44px 높이(accent-color 흰색).
- **Focus:** 테두리 흰색 60%, focus-visible에 흰색 40% 2px 링. 캐럿 흰색, 선택 영역 흰색 28%.
- **Error / Disabled:** 오류는 필드 아래 rose 틴트 상자(`role="alert"`, 6px), 비활성 50% 투명.
- **Field:** 라벨 12px 500 muted, 오른쪽 힌트 subtle 400 tabular(글자 수, 범위, "선택"). 라벨이 입력을 감싸므로 클릭하면 포커스된다.

### Navigation
- Sticky 56px, void 85% + blur, 아래 1px Mist. 워드마크 Bebas 22px 흰색. 링크는 알약 14px, 비활성 muted → hover 흰색, 활성 흰색 12% 틴트 + 흰 글자 + `aria-current="page"`. 로그인한 사람은 28px Avatar와 이름(닉네임, 없으면 ID; white-dim, 먼저 잘림)을 묶은 알약 링크로 `/settings`에 이어지고, hover 흰색 10%, 설정에 있으면 흰색 12% 틴트 + `aria-current="page"`. ADMIN은 Bebas 12px Sand의 4px 테두리 태그, 로그아웃은 36px 알약 outline(Mist 테두리, 12px white-dim, hover 흰색)이며 640px 미만에서는 같은 테두리의 44px 원형 아이콘 버튼(문 밖으로 나가는 화살표, 접근 이름 "로그아웃"). 모바일은 링크 줄이 가로 스크롤, 44px.

### Avatar
원형, 1px Mist 테두리, slate 바탕. 사진은 object-cover로 원을 채우고, 사진이 없으면 같은 원에 이름 첫 글자(Inter 500, white-dim, 대문자). 내비 28px, 설정 96px. 사진은 업로드 전에 브라우저가 가운데 정사각형 256×256으로 줄인다.

### Model Select
표준 `<select>`(Slate 바탕, Mist 1px, 6px, 40px). 라벨 "모델", 오른쪽 힌트에 단가(`$0.0985/s`, tabular). 옵션 텍스트는 "이름 · 공급사 · 단가". 아래에 모델 설명 한 줄(muted)과 고정 제약 한 줄(subtle, 예: "출력은 768p로 고정"). 모델을 바꾸면 파라미터와 레퍼런스가 초기화된다. 카드형 선택은 2026-10-27에 select로 교체했다.

### Stage Feed (signature)
무대는 void 위의 세로 스냅 피드. 각 항목은 ink 바탕에 높이 `100% − 72px`, `overflow-hidden`. 세 층이 겹친다. (1) 위 72px 피크 스트립: `.scrim-top`, 왼쪽에 Bebas 14px Sand "01 / 04"와 프롬프트 한 줄(12px muted, 말줄임), 오른쪽에 StatusBadge. (2) 가운데: 완료면 `<video>` object-contain(활성 항목만 controls·autoPlay·preload), 진행 중이면 56px 2px 흰 스피너(1.4s) + Bebas 72/96px 경과 시간(`aria-live="polite"`) + "생성 중 · 경과 시간", 실패·취소면 Bebas 72/96px 상태 단어(white-dim) + 사유 한 줄. (3) 아래 캡션 `.scrim`(위 96px 패딩, 좌우 20px, 아래 20px 또는 영상 컨트롤을 피해 64px): 모델명 white-dim 12px + Bebas 14px Sand "5S · $0.2250", 상태 줄 14px 500 흰색 + muted 경과/소요, 프롬프트 14px white-dim 2줄 클램프, 진행 중이면 그 아래 2px 진행선(흰색 15% 트랙 위를 25% 너비 흰 선이 1.8s마다 지나감, `role="progressbar"` + "진행률을 알 수 없음"). 새 생성은 맨 위에 삽입되고 피드가 맨 위로 스냅하며 무대가 뷰포트에 들어온다. 피드는 최근 12개까지.

### Glyph Rail (signature)
무대 오른쪽(모바일은 아래) 레일. 위에서부터 prev/next 화살표와 위치 점 열(2개 이상일 때, 점은 데스크톱만), 그 아래 글리프 5개: 생성 · 취소 · 다운로드 · 갤러리 · 다시. 글리프는 52px(모바일 44px) 원, 1.5px 흰색 80% 선, 안에 20px 1.75 stroke 라인 아이콘. hover 흰색 15% 틴트. 활성(생성 가능)은 흰 채움 + void 아이콘, hover white-hover. 비활성 35% 투명 + not-allowed. 원 아래 6px 간격으로 Bebas 16px Sand 카운터(예상 비용, 경과 시간, MP4, 갤러리 건수, ×재사용 횟수; 없으면 "—"), 그 아래 11px muted 라벨. 모든 글리프에 `aria-label`. 다운로드는 `<a download>`, 갤러리는 `<Link>`, 나머지는 버튼.

### Upload Zone
최소 80px 높이의 점선 Mist 상자, 6px, subtle 14px 문구. 파일 input은 `sr-only`로 두어 키보드로 닿고, hover 테두리 흰색 60% + white-dim 글자, focus-within 흰 테두리 + 흰색 40% 링. 꽉 차면 "N장 모두 추가됨"으로 바뀌고 60% 투명, 미지원 모델이면 50% 투명. 위에 12px muted 라벨과 tabular 카운트 "0/2". 추가된 레퍼런스는 112px 16:9 썸네일(slate, 6px)에 Bebas 14px 번호, 아래에 rose-300 "제거" 띠(hover·focus-visible·터치에서 표시).

## Do's and Don'ts

### Do:
- **Do** 행동은 흰색으로. 주 버튼·활성 글리프·선택 카드는 흰 채움 + void 글자, 포커스는 흰 2px 링 + 2px 오프셋.
- **Do** 숫자가 목소리를 내야 하면 Bebas Neue + Sand(카운터 16px, 비용 24px, 무대 72/96px). Inter 숫자는 `tabular-nums`.
- **Do** 글자 색은 네 토큰만(white, white-dim, muted, subtle). 흰 채움 위에서만 `text-background`.
- **Do** 미디어 위의 글자는 `.scrim` / `.scrim-top`으로 받친다. 면 위의 면은 톤 한 단계 + 1px Mist.
- **Do** 상태는 StatusBadge로만, 오류는 ErrorText(`role="alert"`)로만, 비어 있음은 Empty(점선)로만.
- **Do** 모든 조작은 44px(모바일) 이상, 글리프에 `aria-label`, 피드 항목에 `aria-current`. 모션은 `prefers-reduced-motion`에서 전부 정지.
- **Do** 진행률을 모르면 지나가는 선과 경과 시간을 보여 준다. ETA를 지어내지 않는다.

### Don't:
- **Don't** 보라·시안·네온 글로우, 색 있는 그라데이션 배경, 색 있는 강조 버튼. 2026-10-27 교체 때 걷어냈다.
- **Don't** `box-shadow`. 뜨는 면은 내비와 하단 바의 반투명 블러 띠뿐이다.
- **Don't** 한글에 `.font-display`. Bebas Neue는 숫자와 라틴 한 단어에만.
- **Don't** Sand를 본문·라벨·아이콘·테두리에. Sand는 Bebas 숫자 위에만.
- **Don't** `text-zinc-*`, `hover:text-white`, 임의 rgba 글자색, 11px 아래 글자.
- **Don't** 플레이그라운드에 카드나 패널을 들이지 않는다. 서랍은 Mist 구분선과 섹션 헤딩으로 나누고, 무대에는 영상·스크림·레일 외에 아무것도 없다.
- **Don't** 영상을 크롭하지 않는다(object-contain). 피드 항목 사이에 간격이나 카드 테두리를 두지 않는다. 다음 항목은 72px 피크로만 예고한다.
