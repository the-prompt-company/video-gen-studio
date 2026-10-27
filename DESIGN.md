---
name: Video Gen Studio
description: Higgsfield 위에 올린 팀용 영상 생성 도구. 어두운 작업실 책상의 차분한 렌더 콘솔.
colors:
  ink-black: "#09090b"
  desk-surface: "#121215"
  desk-surface-raised: "#19191e"
  hairline: "#27272a"
  paper-white: "#fafafa"
  paper-dim: "#d4d4d8"
  graphite: "#a1a1aa"
  graphite-faint: "#8a8a93"
  render-violet: "#7c3aed"
  render-violet-lit: "#8b5cf6"
  render-violet-soft: "#c4b5fd"
  status-queued: "#d4d4d8"
  status-running: "#7dd3fc"
  status-done: "#6ee7b7"
  status-failed: "#fda4af"
  status-blocked: "#fcd34d"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "0.025em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.render-violet}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.render-violet-lit}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.paper-dim}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.desk-surface-raised}"
    textColor: "{colors.paper-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.desk-surface}"
    rounded: "{rounded.xl}"
    padding: "20px"
  nav-link-active:
    backgroundColor: "rgba(255,255,255,0.10)"
    textColor: "{colors.paper-white}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "40px"
  status-chip:
    typography: "{typography.mono}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: Video Gen Studio

## Overview

**Creative North Star: "The Night Render Desk"**

불 꺼진 작업실의 책상. 모니터 하나가 렌더를 기다리며 켜져 있고, 그 빛 말고는 아무것도 반짝이지 않는다. 이 시스템은 팀이 하루에도 여러 번 들어와 프롬프트를 넣고, 모델을 고르고, 비용을 확인하고 나가는 **도구**다. 장식은 없고, 표면은 세 단계의 어두운 회색으로만 깊이를 만들며, 색은 단 하나의 보라가 "지금 이것이 선택됐다 / 진행 중이다 / 눌러라"를 말할 때만 켜진다.

밀도는 중간이다. 카드 안쪽은 20px, 카드 사이는 24px로 숨 쉴 자리를 두되, 한 화면에 입력·모델·비용·진행 상황이 모두 보인다. 글은 한국어 본문 14px이 기준이고, 숫자는 전부 고정폭 숫자로 정렬된다. 확인된 거부: 보라·시안 라디얼 글로우 배경, 격자 배경, 색 있는 글로우 그림자, 두 번째 강조색(시안). 이것들은 2026-10-27에 걷어냈고 다시 들이지 않는다.

**Key Characteristics:**
- 검정에 가까운 바탕 위에 세 단계 회색 표면과 1px 헤어라인으로만 구조를 세운다.
- 보라(render-violet)는 신호색이다. 선택, 주 행동, 포커스, 진행 중. 장식으로는 쓰지 않는다.
- 텍스트는 네 단계(paper-white, paper-dim, graphite, graphite-faint)만 쓰고, 모두 모든 표면에서 4.5:1을 넘긴다.
- 상태는 색 틴트 15% 배경 + 30% 링 + 밝은 글자의 작은 알약 배지로만 말한다.
- 모션은 150ms 색 전환과 진행 중 셔머 하나. reduced-motion이면 전부 정지한다.

## Colors

거의 무채색인 바탕 위에 보라 한 가지가 신호로 켜지는 팔레트다.

### Primary
- **Render Violet** (#7c3aed): 주 행동 버튼의 바탕, 선택된 모델 카드의 테두리와 10% 틴트, 포커스 링, 캐럿과 선택 영역, 슬라이더·체크박스의 accent-color. 한 화면에서 10%를 넘지 않는다.
- **Render Violet, Lit** (#8b5cf6): 주 행동 버튼 hover에만.
- **Render Violet, Soft** (#c4b5fd): 어두운 바탕 위의 보라 글자. ADMIN 배지, 링크, 랜딩 헤드라인의 강조 구절.

### Neutral
- **Ink Black** (#09090b): 페이지 바탕. 헤더는 이 색 80%에 backdrop-blur.
- **Desk Surface** (#121215): 카드와 패널.
- **Desk Surface, Raised** (#19191e): 입력 필드, 비선택 모델 카드, 썸네일 바탕. 카드 안에서 한 단 더 올라온 것.
- **Hairline** (#27272a): 모든 테두리와 구분선. 1px, 그 이상은 없다.
- **Paper White** (#fafafa): 제목, 값, 입력 글자.
- **Paper Dim** (#d4d4d8): 카드 제목, 목록 본문, 고스트 버튼.
- **Graphite** (#a1a1aa): 필드 라벨, 설명문, 내비 비활성 링크. 표면 위 7.6:1.
- **Graphite, Faint** (#8a8a93): 힌트, 메타, 플레이스홀더, 빈 상태 문구. 가장 어두운 글자이며 표면 위 5.5:1. 이보다 어두운 글자는 없다.

### Status
- **Queued** (#d4d4d8 글자, zinc 15% 틴트), **Running** (#7dd3fc, sky), **Done** (#6ee7b7, emerald), **Failed** (#fda4af, rose), **Blocked/NSFW** (#fcd34d, amber). 배지 안에서만 쓰고, 패널 전체를 이 색으로 칠하지 않는다. 오류 문구는 rose 10% 틴트 박스 안의 rose-300 글자.

### Named Rules
**The One Signal Rule.** 보라는 "선택됐다·눌러라·진행 중이다"를 뜻할 때만 켜진다. 배경, 테두리 장식, 아이콘 색, 그라데이션으로는 쓰지 않는다. 두 번째 강조색은 없다.

**The Four Tiers Rule.** 글자 색은 paper-white, paper-dim, graphite, graphite-faint 네 토큰(`text-foreground`, `text-foreground-2`, `text-muted`, `text-subtle`)만 쓴다. `text-zinc-*`를 직접 쓰지 않는다.

## Typography

**Display Font:** Geist (fallback: Apple SD Gothic Neo, Noto Sans KR, system sans)
**Body Font:** Geist (같은 패밀리)
**Label/Mono Font:** Geist Mono (썸네일 번호, 상태 배지 같은 고정폭 숫자·코드에만)

**Character:** 라틴은 Geist, 한글은 시스템 고딕으로 떨어진다. 둘 다 기하학적이고 조용해서 섞여도 티가 나지 않는다. 굵기는 400과 600 두 단계만 쓴다.

### Hierarchy
- **Display** (600, clamp 36→60px, 1.1, -0.025em): 랜딩 헤드라인에만.
- **Headline** (600, 24px, 1.33): 각 앱 페이지의 h1. "플레이그라운드", "대시보드". 바로 아래 graphite 14px 설명 한 줄이 따라온다.
- **Title** (600, 14px, +0.025em): 카드 제목. "1 · 프롬프트와 레퍼런스"처럼 순서가 정보일 때만 번호를 붙인다.
- **Body** (400, 14px, 1.5): 본문, 입력, 버튼, 목록. 설명문은 최대 약 65자에서 줄바꿈.
- **Label** (500, 12px): 필드 라벨과 힌트. 힌트는 graphite-faint 400.
- **Mono** (400, 11px): 번호·배지. 11px 아래로는 내려가지 않는다.

### Named Rules
**The Tabular Rule.** 비용, 길이, 횟수, 개수 등 숫자가 있는 글자는 모두 `tabular-nums`. 숫자가 바뀌어도 폭이 흔들리지 않는다.

## Layout

최대 폭 1280px(max-w-7xl) 컨테이너, 좌우 16px 패딩. 플레이그라운드는 1024px 이상에서 `minmax(0,1fr) 380px` 2열(작업 영역 + 진행/최근 사이드), 그 아래에서는 한 열로 쌓이고 사이드 카드가 폼 뒤에 온다. 대시보드는 Stat 4열 → 2열 → 1열.

간격 리듬은 4의 배수다. 라벨과 입력 사이 6px, 필드 사이 16px, 카드 안쪽 20px, 카드 사이 24px, 섹션 사이 32px. 헤딩 위는 아래보다 넓다.

헤더는 sticky 56px. 640px 미만에서는 로고·사용자·로그아웃 한 줄 아래에 가로 스크롤되는 링크 줄이 붙는다. 로고와 로그아웃은 줄바꿈하지 않고 사용자 이름이 먼저 잘린다.

터치 타깃은 44px. 링크·버튼·슬라이더·목록 행은 `min-h-11`(모바일) 또는 `min-h-10`(데스크톱 내비)로 맞춘다.

## Elevation & Depth

그림자가 아니라 **톤 단계**로 깊이를 만든다. Ink Black 위에 Desk Surface, 그 위에 Raised. 각 단계는 1px Hairline으로 경계를 긋는다. 패널이 떠 있다는 느낌은 주지 않는다. 헤더만 bg 80% + backdrop-blur로 스크롤 콘텐츠 위에 얹힌다.

### Shadow Vocabulary
- **Primary button only** (`inset 0 1px 0 rgba(255,255,255,.12), 0 8px 20px -10px rgba(0,0,0,.8)`): 위쪽 1px 하이라이트로 눌리는 물성을, 아래 짧은 검정 그림자로 살짝 뜬 느낌을. 보라색 그림자는 쓰지 않는다.

### Named Rules
**The Tonal Depth Rule.** 깊이는 표면 색 단계와 1px 테두리로만. 그림자는 주 행동 버튼 하나에만 허용되고, 색 있는 글로우(0 0 Npx 보라)는 어디에도 없다.

## Shapes

둥근 모서리는 네 단계. 카드·패널 16px, 업로드 영역·모델 카드·오류 박스 12px, 입력·버튼 8px, 내비 링크·작은 버튼 6px. 상태 배지는 완전한 알약. 업로드 영역은 1px 점선 Hairline으로 "비어 있음"을 말하고, hover/focus-within에서 점선이 보라 실선처럼 읽힌다. 썸네일은 80px 정사각, 8px 라운드, 왼쪽 위 번호.

## Components

### Buttons
- **Shape:** 8px 라운드, 글자 500, 줄바꿈 없음. 높이 sm 36 / md 40 / lg 48px.
- **Primary:** Render Violet 바탕에 흰 글자, 위 설명의 그림자. hover Lit, 비활성 50% 투명 + not-allowed 커서.
- **Hover / Focus:** 150ms 색 전환. focus-visible에 보라 2px 링 + 바탕색 2px 오프셋.
- **Outline:** 투명 바탕, Hairline 테두리, Paper White 글자, hover 흰색 5% 틴트.
- **Ghost:** 투명, Paper Dim 글자, hover 흰색 5% 틴트 + Paper White.
- **Danger:** rose-600 90% 바탕, 흰 글자. 삭제·비활성화에만.

### Chips (StatusBadge)
- **Style:** 알약, 11px 500, 색 15% 틴트 바탕 + 30% 링 + 300 단계 글자.
- **State:** queued/in_progress는 글자색의 작은 점이 pulse한다(reduced-motion이면 정지).

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Desk Surface, 1px Hairline.
- **Shadow Strategy:** 없음(Tonal Depth Rule).
- **Border:** Hairline 1px. 빈 상태는 점선.
- **Internal Padding:** 20px. 제목 줄은 h2 14px 600 Paper Dim, 오른쪽에 액션 슬롯.

### Inputs / Fields
- **Style:** Raised 바탕, Hairline 1px, 8px 라운드, 40px 높이, Paper White 글자, graphite-faint 플레이스홀더.
- **Focus:** 테두리가 Render Violet으로, focus-visible에 보라 50% 2px 링. 캐럿도 보라.
- **Error / Disabled:** 오류는 필드 아래 rose 틴트 박스(`role="alert"`), 비활성은 50% 투명.
- **Field:** 라벨 12px 500 graphite, 오른쪽 힌트 graphite-faint tabular. 라벨이 입력을 감싸므로 클릭하면 포커스된다.

### Navigation
- Sticky 56px 헤더, Ink Black 80% + blur, 아래 Hairline. 링크 14px, 비활성 graphite → hover Paper White, 활성 흰색 10% 틴트 + Paper White + `aria-current="page"`. 모바일은 가로 스크롤 줄, 44px 높이.

### Model Card (signature)
`aria-pressed` 토글 버튼. 비선택은 Raised 바탕 + Hairline, hover 시 테두리만 한 단 밝게. 선택은 Render Violet 테두리 + 10% 틴트. 안에는 이름 14px 500, 공급사·단가 12px graphite-faint tabular, 설명 12px graphite.

### Upload Zone (signature)
최소 96px 높이의 점선 박스. 파일 input은 `sr-only`로 두어 키보드로도 닿고, `focus-within`에서 보라 테두리와 링이 켜진다. 꽉 차면 문구가 "N장 모두 추가됨"으로 바뀌고 60% 투명.

## Do's and Don'ts

### Do:
- **Do** 글자 색은 네 토큰만. 새 회색이 필요하면 토큰을 늘리지 말고 네 단계 중 하나를 고른다.
- **Do** 숫자는 전부 `tabular-nums`. 비용은 `usd()`로 소수 자릿수를 맞춘다.
- **Do** 모든 조작은 44px(모바일) 이상, 키보드 포커스 링 표시, 오류는 `role="alert"`.
- **Do** 상태는 StatusBadge로만, 비어 있음은 Empty(점선 박스)로만.
- **Do** 페이지마다 h1 24px + graphite 설명 한 줄로 시작한다.

### Don't:
- **Don't** 보라·시안 라디얼 글로우, 격자 배경, 색 있는 글로우 그림자. 2026-10-27에 제거했다.
- **Don't** 두 번째 강조색. 시안(#22d3ee)은 토큰에서 지웠다.
- **Don't** `text-zinc-*`, `hover:text-white`, 임의 rgba 글자색.
- **Don't** 11px 아래 글자, hover에서만 나타나는 조작(터치와 키보드에서 사라진다).
- **Don't** 카드 안에 카드. 카드 안의 구획은 Raised 표면이나 Hairline 구분선으로.
