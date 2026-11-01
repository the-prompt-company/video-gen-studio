---
name: Video Gen Studio
description: Higgsfield 위에 올린 팀용 영상 생성 도구. 검은 바탕 위에 프롬프트와 결과가 대화처럼 쌓이고, 아래에 붙은 입력창 하나가 다음 생성을 보낸다.
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
  stream: "820px"
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
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.white-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "36px"
  chip-open:
    backgroundColor: "rgba(255,255,255,0.05)"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    height: "36px"
  composer:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "12px"
  prompt-card:
    backgroundColor: "{colors.slate}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
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

**Creative North Star: "The Session" (세션)**

한 스레드가 한 번의 작업 대화다. 회원이 보낸 프롬프트 카드 아래에 그 결과가 오고, 다음 프롬프트는 아래에 붙은 입력창에서 나간다. 어떤 프롬프트와 설정이 어떤 결과를 냈는지가 늘 한 화면에 붙어 있어, 고쳐 가며 다시 만들기 좋다. 화면은 검은 바탕(void)과 그 위의 흰 행동뿐이고, 색은 결과 영상과 이미지가 가져온다. 이 시스템은 전문 디자이너·영상 제작자가 매일 들어와 프롬프트와 파일을 넣고 모델과 파라미터를 고르고 비용을 확인하는 **도구**다. 장난스럽거나 가벼운 소비자 앱 느낌은 거부했고, 검정+네온 글로우+그라데이션으로 된 흔한 AI 도구 외형도 거부했다. 2026-10-27에 보라 강조색 세계("The Night Render Desk")를 걷어내고 검은 무대와 흰 글리프 세계로 바꿨고, 2026-10-31에 왼쪽 480px 서랍·레퍼런스 대화상자·글리프 레일·스냅 무대를 Google Flow식 대화형 스트림과 하단 입력창으로 바꿨다(운영자가 세 후보 중 C "대화형 스트림"을 고름). 색·글꼴·버튼은 그대로다.

강조색은 없다. 주 행동은 흰 채움에 검정 글자이고, 모델은 입력창의 모델 칩에서 고르며 생성 방식은 첨부가 정한다(2026-10-31, 방식 고르기를 없앰). 숫자(비용, 길이, 카운터, 경과 시간)만 Bebas Neue와 Sand로 따로 목소리를 낸다. 깊이는 그림자가 아니라 네 단계 무채색 표면으로 만든다. 밀도는 입력창 안에서는 촘촘하게(칩 36px, 간격 6–8px), 스트림에서는 턴 사이 28px로 넉넉하게. 모션은 150ms 색 전환과 ETA가 없어서 채워지지 않고 **지나가는** 2px 진행선 하나뿐이다.

**Key Characteristics:**
- 바탕 void 위에 ink, slate, mist 세 단계 무채색과 1px 헤어라인으로만 구조를 세운다. 색 있는 강조색은 없고 흰색이 강조색이다.
- Bebas Neue는 숫자와 라틴 한 단어(워드마크, 카운터, 비용, 경과 시간, MP4)에만 쓰고, Inter + 시스템 한글이 본문을 맡는다.
- Sand(#c7b9a6)는 Bebas 숫자에만 얹는 따뜻한 색이다. 본문·라벨·아이콘에는 쓰지 않는다.
- 스레드는 대화처럼 위에서 아래로 쌓인다. 턴마다 오른쪽에 프롬프트 카드(slate), 그 아래 왼쪽에 결과 상자(ink)가 오고, 최신 턴이 맨 아래, 입력창이 그 아래에 붙는다.
- 상태색(sky, emerald, rose, amber)은 알약 배지, 오류 상자, 막힌 이유의 점 안에서만 켜진다.
- 그림자 없음. 깊이는 표면 단계. reduced-motion이면 진행선·펄스·스피너·색 전환이 모두 정지한다.

## Colors

거의 완전한 무채색 위에 흰색이 행동을 말하고, Sand가 숫자를 말하며, 색은 영상과 상태 배지만 가져온다.

### Primary
- **White** (`white`, --accent): 주 행동의 채움색이자 글자색이다. "생성하기" 알약, 고른 알약과 탭, 포커스 링 2px, 캐럿, 슬라이더·체크박스의 accent-color, 진행선. 바탕이 될 때는 글자가 void로 뒤집힌다.
- **White, Hover** (`white-hover`, --accent-hover): 흰 채움 요소의 hover에만. 살짝 가라앉는 정도로 충분하다.

### Secondary
- **Sand** (`sand`, --sand / --accent-soft): 따뜻한 모래색. Bebas Neue 숫자 전용이다. 입력창의 예상 비용(24px), 스레드 머리줄의 갤러리 건수(16px), 프롬프트 카드의 비용과 다운로드의 MP4·PNG(14px), 내비의 ADMIN 태그(12px). 그 밖의 어떤 글자나 면에도 쓰지 않는다.

### Neutral
- **Void** (`void`, --background): 페이지와 스트림의 바탕. 내비는 이 색 85% + backdrop-blur.
- **Ink** (`ink`, --surface): 결과 상자의 바탕(영상과 이미지는 object-contain이므로 레터박스가 이 색), 입력창, 팝오버와 시트, 문서형 페이지의 카드, API 키 경고 상자.
- **Slate** (`slate`, --surface-2): 프롬프트 카드, 입력·textarea·select, 첨부 썸네일 바탕, 설정의 고정 안내 상자. 입력창에서 한 단 올라온 것.
- **Mist** (`mist`, --border): 모든 1px 테두리와 구분선. 내비 아래, 스레드 열 오른쪽, 스레드 머리줄 아래, 입력창과 프롬프트 카드의 테두리, 칩 테두리, 프레임 메뉴에서 고르지 않은 배지의 테두리.
- **White, Dim** (`white-dim`, --foreground-2): 칩 글자, 결과 줄의 동작(취소·다운로드·다시), 카드 제목, 고스트 버튼, 내비의 사용자명, queued 배지 글자.
- **Muted** (`muted`): 필드 라벨, 팝오버의 섹션 헤딩, 프롬프트 카드의 모델·방식·설정 줄, 결과 줄의 걸린 시간, 알림 줄, 내비 비활성 링크. void 위 7.9:1, ink 위 6.6:1.
- **Subtle** (`subtle`): 힌트, 메타, 플레이스홀더, 메뉴 행의 보조 줄(방식 설명, 단가), 예상 비용의 계산식, 빈 상태 문구, Stat 라벨. 가장 어두운 글자이며 slate 위 4.8:1. 이보다 어두운 글자는 없다.

### Status
- **Running** (`status-running`, sky-300 글자 + sky-500 15% 틴트 + 30% 링), **Done** (`status-done`, emerald), **Failed** (`status-failed`, rose), **Blocked/NSFW** (`status-blocked`, amber), **Queued/Canceled** (zinc-500 15% 틴트에 white-dim 또는 muted 글자). 배지 안에서만 쓴다. 오류 문구는 rose-500 10% 틴트 상자 안의 rose-300 글자, 위험 버튼은 rose-600 90%. API 키 경고의 점은 amber-400.

### Named Rules
**The White Is The Accent Rule.** 강조색은 흰색 하나다. 행동·선택·포커스·진행은 흰 채움 또는 흰 선으로 말하고, 색상(hue)을 가진 면은 상태 배지와 오류 상자 외에는 없다. 보라·시안·네온 글로우는 2026-10-27에 걷어냈고 다시 들이지 않는다.

**The Sand Numeral Rule.** Sand는 Bebas Neue 숫자 위에만 얹는다. 본문, 라벨, 아이콘, 테두리에 Sand를 쓰면 숫자의 목소리가 사라진다.

**The Four Tiers Rule.** 글자 색은 white, white-dim, muted, subtle 네 토큰(`text-foreground`, `text-foreground-2`, `text-muted`, `text-subtle`)만 쓴다. `text-zinc-*`와 임의 rgba 글자색은 쓰지 않는다. 유일한 예외는 흰 채움 위의 `text-background` 와 `text-background/70`.

## Typography

**Display Font:** Bebas Neue (fallback: Arial Narrow, Impact) — `.font-display`, letter-spacing 0.06em
**Body Font:** Inter (fallback: system-ui, Apple SD Gothic Neo, Noto Sans KR, Malgun Gothic). 중국어 화면(`<html lang="zh-CN">`)과 다른 언어 화면 안의 `lang="zh-CN"` 요소는 Inter 다음에 PingFang SC, Microsoft YaHei, Noto Sans SC, Noto Sans CJK SC, Source Han Sans SC를 먼저 두고 한국어 글꼴을 그 뒤에 둔다. 한 줄의 한자가 한 글꼴에서 나오고, 한글 닉네임·프롬프트는 여전히 한국어 글꼴로 보인다.
**Label/Mono Font:** 없음. 숫자 정렬은 Inter의 `tabular-nums`로 한다.

**Character:** Bebas Neue는 포스터의 숫자처럼 좁고 높다. 라틴과 숫자만 있으므로 워드마크·카운터·경과 시간처럼 한 단어 이하의 라틴·숫자에만 쓰고, 한글이 들어가는 모든 글은 Inter + 시스템 고딕이 맡는다. 굵기는 Bebas 400 하나, Inter는 400·500·600 세 단계.

### Hierarchy
- **Display** (Bebas 400, 48px, 1, +0.06em): 진행 중인 결과 상자 가운데의 경과 시간 "0:47". 이 크기는 결과 상자에만 있다.
- **Numeral** (Bebas 400, 24px, 1): 입력창의 예상 비용. Sand.
- **Wordmark** (Bebas 400, 22px, 1): 내비·로그인·랜딩의 "Video Gen Studio". 흰색.
- **Counter** (Bebas 400, 16px, 1): 스레드 머리줄의 갤러리 건수. 14px 변형은 프롬프트 카드의 비용 "$0.4925", 다운로드의 "MP4", 첨부 썸네일 번호. 12px은 ADMIN 태그. Sand(썸네일 번호만 흰색).
- **Headline** (Inter 600, 24px, 1.33): 문서형 페이지(갤러리·대시보드·어드민)와 로그인의 h1. 바로 아래 muted 14px 설명 한 줄. 플레이그라운드의 h1은 화면 읽기 프로그램에만 있다.
- **Title** (Inter 600, 16px, 1.5): 시트 제목, 실패·취소 결과 상자의 상태 단어(24px). 빈 스트림의 제목은 20px → 24px.
- **Section** (Inter 600, 12px, +0.05em, muted): 팝오버 안의 헤딩 "모델", "이미지 2 · 프레임 지정". 순서가 정보일 때만 번호를 붙인다.
- **Body** (Inter 400, 14px, 1.43): 본문, 프롬프트 카드의 프롬프트(1.625 행간, 최대 높이 240px 안에서 스크롤), 버튼, 내비 링크. 입력창의 프롬프트는 15px.
- **Label** (Inter 500, 12px, 1.33): 필드 라벨(muted), 힌트는 subtle 400 tabular. 칩 글자는 13px.
- **Meta** (Inter 400, 11px, 1): 상태 배지(500), 예상 비용의 계산식, 썸네일 캡션. 11px 아래로는 내려가지 않는다.

### Named Rules
**The Bebas Is A Numeral Rule.** Bebas Neue는 숫자와 라틴 한 단어에만 쓴다. 한글 본문·라벨·버튼에 `.font-display`를 얹지 않는다. Bebas에는 한글이 없어 시스템 글꼴로 떨어진다. 어느 언어에서도 Bebas는 숫자와 라틴 한 단어만 싣고, 중국어는 싣지 않는다.

**The Chinese Wraps Rule.** `break-keep`(word-break: keep-all)은 한국어 단어를 통째로 지키지만, 띄어쓰기가 없는 중국어 문장은 한 줄로 늘어나 상자를 넘친다. 그래서 `globals.css`가 `:lang(zh-CN) .break-keep`을 `word-break: normal`로 되돌린다. 새 글에 `break-keep`을 써도 중국어는 저절로 줄을 바꾼다.

**The Tabular Rule.** 비용, 길이, 횟수, 개수 등 Inter로 쓴 숫자는 모두 `tabular-nums`. 비용은 `usd()`로 소수 자릿수를 맞춘다(≥100은 정수, ≥1은 2자리, 그 아래는 4자리).

## Layout

플레이그라운드는 내비 아래 화면 높이를 고정해 쓰고(`body:has([data-fill-viewport]) { height: 100dvh }`), 스트림만 안에서 스크롤한다. 1024px 이상에서는 [스레드 열][본문] 두 열이고, 본문은 위에서부터 48px 스레드 머리줄(지금 스레드 이름 + 갤러리 링크와 완료 건수), 스트림, 하단 입력창이다. 1024px 미만에서는 스레드 열 대신 스트림 위 막대(목록 버튼과 지금 스레드 이름, 갤러리 링크, 새 스레드)가 목록을 시트로 연다. 스트림의 턴과 입력창은 가운데 정렬된 최대 폭 820px 한 열(좌우 12px, 640px 이상 16px)이다. 스레드 목록은 1280px 이상에서 240px 열(오른쪽 1px Mist, 접기 가능), 1024–1279px에서는 56px 띠(펼치기·새 스레드)로 시작한다. 행은 내비 링크처럼 알약이고 지금 스레드는 흰색 12% 틴트 + `aria-current="page"`, 삭제 버튼은 hover·지금 행·터치에서 보인다.

턴은 위아래 28px 간격이다. 턴 안에서 프롬프트 카드는 오른쪽 정렬(최대 620px 또는 92%), 그 아래 10px에 결과 상자가 왼쪽 정렬로 온다. 결과 상자는 요청한 화면비(`aspect_ratio`, 없으면 16:9)로 자리를 미리 잡아 결과가 들어와도 높이가 바뀌지 않는다. 너비는 `min(100%, 720px, min(60dvh, 560px) × 비율)`이라 세로 결과도 화면을 다 차지하지 않는다. 결과 상자 아래 8px에 결과 줄(배지 · 걸린 시간 · 동작)이 온다.

입력창은 ink 면(12px 라운드, 1px Mist, 안쪽 12px) 하나에 위에서부터 첨부 영역(첨부가 있을 때만: 번호 썸네일 줄과 그 아래 보낼 생성 방식·개수 한 줄), 프롬프트(자동 높이, 데스크톱 160px·모바일 120px까지), 알림·오류·막힌 이유 줄, 아래 막대를 둔다. 막대 왼쪽에 + · 모델 칩 · 설정 칩, 오른쪽에 예상 비용과 생성하기. 640px 미만에서는 칩 줄이 가로로 스크롤되고 비용과 생성하기가 그 아래 줄로 내려간다.

문서형 페이지(갤러리·대시보드·설정·어드민)는 `PageContainer`: 최대 폭 1280px, 좌우 16px, 상하 32px. 로그인은 최대 폭 384px 가운데 정렬. 설정은 카드 없이 구역을 Mist 1px 선으로 나누고, 768px 이상에서 구역마다 왼쪽 240px 제목(16px 600)과 muted 설명, 오른쪽 384px 폼의 두 열이며 선은 그 두 열 너비(672px)에서 끝난다. 그 아래로는 한 열.

간격 리듬은 4의 배수에 6px 하나. 라벨과 입력 사이 6px, 필드 사이 12–16px, 칩 사이 6px, 입력창 안 줄 사이 8px, 카드 안쪽 20px, 카드 사이 24px, 턴 사이 28px, 문서형 페이지 섹션 사이 32px.

내비는 sticky 56px. 640px 미만에서는 워드마크·사용자·로그아웃 한 줄 아래에 가로 스크롤되는 링크 줄(44px)이 붙는다. 터치 타깃은 44px: 칩·결과 줄의 동작·메뉴 행·알약은 모바일 44px, 데스크톱 32–40px; 링크·버튼·체크박스 행은 `min-h-11`(모바일) 또는 `min-h-10`(데스크톱).

### Named Rules
**The Follow The Bottom Rule.** 스트림은 회원이 맨 아래(80px 이내)에 있을 때만 새 결과와 커지는 입력창을 따라 내려간다. 위의 턴을 읽는 중에는 아무것도 화면을 옮기지 않고, 대신 "최신 결과로" 알약이 뜬다. 이전 턴은 맨 위 표시가 화면 200px 안에 들어오면 12건씩 붙고, 붙기 전 맨 아래에서의 거리를 지켜 보던 턴이 제자리에 남는다. 브라우저의 스크롤 고정은 끄고(`overflow-anchor: none`) 이 규칙 하나로만 움직인다.

## Elevation & Depth

그림자가 없다. 깊이는 **톤 단계**(void → ink → slate)와 1px Mist 헤어라인으로 만든다. 결과 상자는 ink, 그 위에 오는 프롬프트 카드는 slate, 입력창과 팝오버는 ink에 Mist 테두리다. 떠 있는 면은 내비(void 85% + blur), 칩 위에 뜨는 팝오버(ink, 1px Mist, 12px), 640px 미만의 하단 시트(위만 12px 라운드, 뒤에 void 85% + blur 막)뿐이다. 흰 채움 버튼에도 그림자는 없다.

### Shadow Vocabulary
- **Thumbnail numeral only** (`drop-shadow`, Tailwind 기본 `0 1px 2px rgba(0,0,0,.1), 0 1px 1px rgba(0,0,0,.06)`): 첨부 썸네일 왼쪽 위 Bebas 번호와 캡션이 밝은 이미지 위에서도 읽히도록. 유일한 그림자이고, 면이 아니라 글자에 있다.

### Named Rules
**The Tone Not Shadow Rule.** 면은 그림자로 뜨지 않는다. 면이 면 위에 놓여야 하면 톤 한 단계와 1px Mist로 구분하고, 미디어 위에 글자를 얹지 않는다(결과의 상태와 동작은 상자 아래 줄에 둔다). `box-shadow`와 색 있는 글로우는 어디에도 없다.

## Shapes

행동은 알약, 컨트롤은 6px, 면은 12px. 버튼(primary·outline·ghost·danger), 칩, 메뉴의 탭, 설정의 알약, 내비 링크, 로그아웃, 상태 배지는 완전한 알약(9999px). 입력·썸네일·결과 상자·오류 상자·API 키 경고는 6px. 입력창, 프롬프트 카드, 팝오버, 문서형 페이지의 Card·Stat·Empty는 12px. 하단 시트는 위 두 모서리만 12px. ADMIN 태그만 4px. 파일을 끌고 들어온 동안의 놓을 자리는 입력창 안쪽 6px에 흰색 60% 1px 점선(8px 라운드)이다. 첨부 썸네일은 96×54, 프롬프트 카드의 레퍼런스 썸네일은 56×32. 프레임으로 정한 썸네일은 흰 2px 링(2px ink 오프셋)과 왼쪽 아래 흰 알약 배지(11px 600 void 글자 "시작", "끝", "시작·끝")를 단다. 영상과 이미지 결과는 크롭하지 않는다(object-contain, 레터박스는 ink). 썸네일은 크롭한다(object-cover).

## Components

### Buttons
- **Shape:** 알약(9999px), 글자 500, 줄바꿈 없음. 높이 sm 36 / md 40 / lg 48px, 좌우 16 / 20 / 28px, 글자 12 / 14 / 16px.
- **Primary:** 흰 채움에 void 글자. hover white-hover. 비활성 40% 투명 + not-allowed. "생성하기"(lg)와 "로그인"(lg, 꽉 찬 너비).
- **Hover / Focus:** 150ms 색 전환. focus-visible에 흰 2px 링 + void 2px 오프셋(모든 버튼·칩 공통). 입력의 링은 흰색 40%.
- **Outline:** 투명, 흰색 40% 테두리, 흰 글자. hover 테두리 흰색 + 흰색 5% 틴트. 스레드 목록의 "새 스레드"(sm).
- **Ghost:** 투명, white-dim 글자. hover 흰색 10% 틴트 + 흰 글자.
- **Danger:** rose-600 90% 바탕, 흰 글자, hover rose-500. 삭제·비활성화에만.

### Chips (StatusBadge)
- **Style:** 알약, 11px 500, 2px 8px, 색 15% 틴트 바탕 + 30% 인셋 링 + 300 단계 글자.
- **State:** queued/in_progress는 글자색 6px 점이 2s pulse(reduced-motion이면 정지). 피크 스트립 오른쪽 위와 문서형 페이지 목록에서 쓴다.

### Cards / Containers
- **Corner Style:** 12px(Card, Stat, Empty).
- **Background:** ink, 1px Mist. Empty는 점선.
- **Shadow Strategy:** 없음(Scrim Not Shadow Rule).
- **Internal Padding:** 20px. 제목 줄은 h2 14px 600 white-dim + 0.025em, 오른쪽에 액션 슬롯, 아래 16px. 플레이그라운드의 면은 입력창, 프롬프트 카드, 팝오버뿐이고 그 밖의 패널은 없다.

### Modal
- **Element:** `Modal`(`src/components/Modal.tsx`)은 네이티브 `<dialog>`를 `showModal()`로 연다. 뒤 페이지는 inert가 되고 스크롤이 잠긴다(`html:has(dialog:modal)`). 접근 이름은 제목 h2다.
- **Surface:** ink, 1px Mist, 12px, 그림자 없음. 백드롭은 void 85% + blur. 폭 448px(`md`) 또는 672px(`lg`), 높이는 뷰포트의 85%까지이고 넘치면 본문만 스크롤한다.
- **Structure:** 머리(제목 16px 600, 오른쪽에 고스트 `닫기`, 아래 1px Mist), 본문(안쪽 20px), 있으면 발(위 1px Mist, 그 화면의 주 행동).
- **Close:** Esc, `닫기`, 백드롭 클릭. 닫히면 연 버튼으로 포커스가 돌아간다. 640px 미만에서는 화면 전체 높이의 시트가 되고 모서리와 테두리가 없다.
- **Use:** 어드민 사용자 탭의 편집, 사용자 추가, 엑셀로 회원 만들기, 팀 지정과 팀 탭의 팀 만들기, 팀 편집. 갤러리 상세는 아직 같은 백드롭의 `div` 대화상자다. 플레이그라운드의 메뉴와 설정은 모달이 아니라 팝오버(640px 미만은 하단 시트)다. 어드민 모델 탭은 모달 없이 모델마다 한 줄(640px 미만에서는 세로로 쌓임): 단가 기준 라벨, 144px 숫자 칸과 저장, Higgsfield 공시 단가를 채우는 알약 버튼들, 지금 칸의 단가로 계산한 예시 비용 한 줄.

### Inputs / Fields
- **Style:** slate 바탕, 1px Mist, 6px 라운드, 40px 높이(textarea는 8px 12px, 1.625 행간), 흰 글자, subtle 플레이스홀더. 체크박스 16px, range 44px 높이(accent-color 흰색).
- **Focus:** 테두리 흰색 60%, focus-visible에 흰색 40% 2px 링. 캐럿 흰색, 선택 영역 흰색 28%.
- **Error / Disabled:** 오류는 필드 아래 rose 틴트 상자(`role="alert"`, 6px), 비활성 50% 투명.
- **Field:** 라벨 12px 500 muted, 오른쪽 힌트 subtle 400 tabular(글자 수, 범위, "선택"). 라벨이 입력을 감싸므로 클릭하면 포커스된다.

### Navigation
- Sticky 56px, void 85% + blur, 아래 1px Mist. 워드마크 Bebas 22px 흰색. 링크는 알약 14px, 비활성 muted → hover 흰색, 활성 흰색 12% 틴트 + 흰 글자 + `aria-current="page"`. 로그인한 사람은 28px Avatar와 이름(닉네임, 없으면 ID; white-dim, 먼저 잘림)을 묶은 알약 링크로 `/settings`에 이어지고, hover 흰색 10%, 설정에 있으면 흰색 12% 틴트 + `aria-current="page"`. ADMIN은 Bebas 12px Sand의 4px 테두리 태그, 로그아웃은 36px 알약 outline(Mist 테두리, 12px white-dim, hover 흰색)이며 640px 미만에서는 같은 테두리의 44px 원형 아이콘 버튼(문 밖으로 나가는 화살표, 접근 이름 "로그아웃"). 모바일은 링크 줄이 가로 스크롤, 44px.

### Avatar
원형, 1px Mist 테두리, slate 바탕. 사진은 object-cover로 원을 채우고, 사진이 없으면 같은 원에 이름 첫 글자(Inter 500, white-dim, 대문자). 내비 28px, 설정 96px. 사진은 업로드 전에 브라우저가 가운데 정사각형 256×256으로 줄인다.

### Composer (signature)
스트림 아래에 붙은 입력창. ink 면에 1px Mist, 12px 라운드. 생성 방식을 고르는 곳은 없다. 첨부가 없으면 프롬프트만, 첨부가 있으면 프롬프트와 첨부를 레퍼런스로 보내고, 이미지를 시작(과 끝) 프레임으로 정하면 이미지→영상으로 보낸다. 파일은 입력창 어디에 끌어다 놓아도, 프롬프트에 붙여 넣어도, + 메뉴로 골라도 레퍼런스로 들어간다. 끌고 들어오는 동안 테두리가 흰색이 되고, 아래 내용을 가리는 ink 면 위 흰색 60% 점선 자리에 + 아이콘, "여기에 놓으면 레퍼런스로 들어갑니다"(14px 500 흰색), 그 모델이 받는 것("이미지 최대 6장 · 영상 최대 3개 · 시작·끝 프레임", 12px muted)이 뜬다.
- **첨부 줄:** 첨부가 있을 때만 프롬프트 위에 번호 썸네일 줄(96×54, 이미지 1, 2…, 영상 V1…; 넘치면 가로 스크롤, 링이 잘리지 않게 안쪽 4px)과 그 아래 한 줄: 보낼 생성 방식(white-dim 500, 예 "레퍼런스→영상") · "이미지 n/6 · 영상 n/3"(muted tabular) · 프레임을 정할 수 있고 아직 정하지 않았으면 "이미지를 누르면 시작·끝 프레임으로 정합니다"(subtle).
- **프레임 지정:** 프레임을 받는 모델(Seedance 2.0, MiniMax H3)에서는 이미지 썸네일 자체가 버튼이다(hover 흰색 10% 막, 키보드 포커스는 안쪽 2px 흰 외곽선). 누르면 썸네일 위에 "이미지 n · 프레임 지정" 팝오버가 뜨고, 행 "시작 프레임"·"끝 프레임"(앞에 배지 미리보기 알약, 보조 줄 "영상이 이 이미지에서 시작합니다" / 다른 이미지가 가졌으면 "지금은 이미지 2에 있습니다. 고르면 이 이미지로 옮깁니다" / 이미 가졌으면 "다시 누르면 표시를 풉니다")을 고르면 닫힌다. 시작과 끝은 하나씩만 있어 다른 이미지에 주면 옮겨 가고, 한 이미지가 둘 다 가질 수 있다(루프). 정한 썸네일은 흰 2px 링 + 2px ink 오프셋과 왼쪽 아래 흰 알약 배지 "시작"·"끝"·"시작·끝"(11px 600 void)을 단다. 영상과 GPT Image 2의 이미지는 버튼이 아니다.
- **프레임과 다른 첨부:** 이미지→영상은 프레임만 보내므로, 프레임 밖의 첨부가 있으면 그 썸네일은 35%로 흐려지고 캡션 자리에 막힌 이유와 같은 amber 6px 점이 뜨며, 막힌 이유 줄이 "흐리게 표시된 첨부 n개를 빼거나, 프레임 표시를 풀어 모두 레퍼런스로 보내세요"라 말하고 생성하기가 꺼진다. 요청에서 파일을 몰래 빼지 않는다.
올리는 중인 첨부는 미리보기 위에 스피너가 돌고, 그동안 생성하기는 "업로드 중…"으로 꺼진다. 프롬프트는 테두리 없는 15px textarea(placeholder subtle). 그 아래 줄은 순서대로 알림(muted), 오류(ErrorText), 막힌 이유(amber 점 + white-dim 12px, `role="status"`, 모델을 쓸 수 없는 이유와 계획이 막힌 이유를 각각 한 줄). 아래 막대는 왼쪽에 + (레퍼런스 추가), 모델 칩(아이콘 영상·이미지 + 모델 이름 + 아래 화살표), 설정 칩(조절 아이콘 + 한 줄 요약 "가로 16:9 · 5초 · 480p", 좁으면 말줄임), 오른쪽에 예상 비용 한 줄(11px subtle 계산식 "5s · 480p"이 좁으면 말줄임되고, 이어서 muted "예상" + Bebas 24px Sand, 단가가 없으면 "미정", 막히면 "—". 단가는 여기 쓰지 않고 모델 메뉴에만 둔다)과 생성하기(흰 알약, Ctrl/Cmd+Enter).

### Chips and Menus
칩은 36px(모바일 44px) 알약, 1px Mist, 13px white-dim. hover 테두리 흰색 60%, 열려 있으면 흰 테두리 + 흰색 5% 틴트. 칩이 여는 팝오버는 640px 이상에서 칩 위 8px에 뜨고(ink, 1px Mist, 12px, 안쪽 12px, 화면 위 72px까지), 미만에서는 하단 시트(제목 16px 600 + 고스트 닫기, 위 손잡이 36×4)가 된다. Esc·바깥 클릭·닫기로 닫히고, Tab은 안에서 돌고, 닫히면 칩으로 포커스가 돌아간다.
- **모델:** 폭 400px. 영상 | 이미지 탭(테두리 알약 안의 흰 채움 탭), "모델" 헤딩 아래 모델 행 한 열. 행은 "Seedance 2.0 · ByteDance"와 보조 줄 둘: 받는 것("이미지 최대 6장 · 영상 최대 3개 · 시작·끝 프레임", GPT Image 2는 "이미지 최대 16장")과 단가("480p·16:9 기준 $0.0985/s", "단가 미설정", 쓸 수 없으면 "사용 불가 · 이유"로 꺼짐). 고른 행은 흰색 12% 틴트 + 오른쪽 체크(`aria-pressed`). 모델을 고르면 닫힌다. 아래에 그 모델의 note 한 줄(subtle). note는 모델마다 있을 수도 없을 수도 있고, Seedance는 없다. 생성 방식 열은 없다.
- **설정:** "모델 · 생성 방식"(첨부가 정한 방식, 읽기 전용) 헤딩 아래 화면비 알약(Seedance 프레임은 알약 대신 시작 프레임의 크기와 방향을 말하는 slate 안내 상자), 길이 슬라이더(값 "8초 · 4~15") 또는 길이 알약, 해상도·품질·파일 형식·배경 알약, 스위치(오디오 생성, AI 생성 워터마크). 고른 알약은 흰 채움 + void 글자. 바꾸면 칩의 요약과 예상 비용이 바로 바뀐다. 아래에 모델 note(있는 모델만).
- **레퍼런스 추가:** 행 "이미지 올리기"(형식·크기 힌트, 오른쪽 n/max)와 "영상 올리기"(영상을 받는 모델만). 가득 차면 "이미지 6장 모두 추가됨"으로 꺼진다. 파일을 몇 번 올려도 열려 있고, 아래에 순서, 끌어다 놓기와 붙여 넣기, 프레임 지정을 말하는 한 줄.

### Attachments Decide The Mode
회원은 생성 방식을 고르지 않는다(2026-10-31 운영자 결정). 첨부가 없으면 텍스트→영상(이미지 모델은 텍스트→이미지), 시작이나 끝으로 정한 이미지가 있으면 이미지→영상, 그 밖에는 레퍼런스→영상(레퍼런스→이미지). 끝만 있고 시작이 없으면 막힌 이유가 시작 프레임을 정하라고 말한다. 모델을 바꾸면 파라미터는 그 모델 기본값으로 돌아가고 첨부와 프레임 표시는 남는다(새 모델의 상한을 넘거나 영상을 받지 않으면 막힌 이유가 그렇게 말하고 생성하기가 꺼진다). 프레임을 받지 않는 모델(GPT Image 2)로 바꾸면 프레임 표시를 풀고 알림 줄이 "GPT Image 2 모델은 시작·끝 프레임을 받지 않아 프레임 표시를 풀었습니다"라 말한다. 레퍼런스로와 @로 넣은 결과도 언제나 레퍼런스로 들어가고, 프레임은 회원이 정한다.

### Stream (signature)
스레드의 결과를 대화처럼 보인다. 턴 하나는 (1) 오른쪽 프롬프트 카드: slate 면, 1px Mist, 12px, 안쪽 10×14px. 프롬프트(흰색 14px, 줄바꿈 유지), 레퍼런스 썸네일 줄(56×32, 번호 또는 "시작"·"끝", 지워진 업로드는 번호만 남은 빈 칸), muted 12px "Seedance 2.0 · 이미지→영상 · 시작 프레임 비율 · 8초 · 720p"와 Bebas 14px Sand 비용(진행 중이면 "예상 $1.71", 실패·취소면 없음). (2) 왼쪽 결과 상자: ink, 6px, 요청한 화면비로 미리 잡은 자리. 완료면 `<video controls>`(자동 재생 없음, metadata만 미리 받음) 또는 `<img>`, 진행 중이면 가운데 36px 2px 스피너 + Bebas 48px 경과 시간(서버 시계 기준, 1초마다 그 글자만 다시 그림) + "생성 중 · 경과 시간"과 상자 바닥의 2px 진행선(`role="progressbar"`), 실패·취소면 상태 단어(24px 600 white-dim)와 사유 한 줄. (3) 결과 줄: StatusBadge, "0:17 걸림", 오른쪽에 취소(제출 대기·대기일 때), 다운로드 + Bebas Sand "MP4"/"PNG", 다시(그 결과의 모델·프롬프트·설정을 입력창에 다시 넣음. 이미지→영상 결과면 첫 이미지를 시작, 둘째를 끝 프레임으로 다시 넣고, 불러오지 못한 이미지나 레퍼런스는 다시 넣으라고 알림 줄이 말함). 동작은 고스트 알약(32px, 모바일 44px). 스트림 맨 위에는 "이전 결과 더 보기"(불러오는 중에는 "이전 결과를 불러오는 중…", 끝이면 "이 스레드의 처음입니다"), 바닥을 떠나면 아래 가운데에 "최신 결과로" 알약(ink, 1px Mist). 빈 스레드는 가운데에 제목(20→24px)과 한 줄 안내.

## Do's and Don'ts

### Do:
- **Do** 행동은 흰색으로. 주 버튼·고른 알약·고른 탭은 흰 채움 + void 글자, 포커스는 흰 2px 링 + 2px 오프셋.
- **Do** 숫자가 목소리를 내야 하면 Bebas Neue + Sand(카운터 16px, 비용 14·24px, 경과 시간 48px). Inter 숫자는 `tabular-nums`.
- **Do** 글자 색은 네 토큰만(white, white-dim, muted, subtle). 흰 채움 위에서만 `text-background`.
- **Do** 결과의 상태와 동작은 결과 상자 아래 줄에. 면 위의 면은 톤 한 단계 + 1px Mist.
- **Do** 상태는 StatusBadge로만, 오류는 ErrorText(`role="alert"`)로만, 막힌 이유는 amber 점 한 줄(`role="status"`)로만.
- **Do** 모든 조작은 44px(모바일) 이상, 칩과 동작에 이름, 메뉴는 Enter로 고르고 Esc로 닫힌다. 모션은 `prefers-reduced-motion`에서 전부 정지.
- **Do** 결과 자리는 요청한 화면비로 미리 잡는다. 결과가 들어와 화면이 튀지 않게.
- **Do** 진행률을 모르면 지나가는 선과 경과 시간을 보여 준다. ETA를 지어내지 않는다.

### Don't:
- **Don't** 보라·시안·네온 글로우, 색 있는 그라데이션 배경, 색 있는 강조 버튼. 2026-10-27 교체 때 걷어냈다.
- **Don't** `box-shadow`. 뜨는 면은 내비, 팝오버, 하단 시트뿐이다.
- **Don't** 한글에 `.font-display`. Bebas Neue는 숫자와 라틴 한 단어에만.
- **Don't** Sand를 본문·라벨·아이콘·테두리에. Sand는 Bebas 숫자 위에만.
- **Don't** `text-zinc-*`, `hover:text-white`, 임의 rgba 글자색, 11px 아래 글자.
- **Don't** 회원이 위의 턴을 읽는 중에 스트림을 움직이지 않는다. 따라 내려가는 것은 바닥에 있을 때뿐이다.
- **Don't** 영상과 이미지 결과를 크롭하지 않는다(object-contain). 입력창 밖에 생성 설정을 흩어 놓지 않는다.
