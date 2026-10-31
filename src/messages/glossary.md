# Glossary

Korean (`ko.json`) is the source. Draft `en.json` and `zh-CN.json` from it with this file open, then run `npm run i18n:check`.
The operator and the reviewers own the final words. Record every change to a term here in the same PR that changes the messages.

## Style

- English is sentence case (`Change password`, not `Change Password`). Page names are capitalized as names (`the Gallery`, `the Playground`).
- English uses contractions in short messages (`Can't reach the server`) and full sentences with a period in leads and results. Button labels have no period.
- Simplified Chinese is Mainland usage, with full-width punctuation (`，。：（）`) and a space between Han characters and Latin words or digits (`最多 6 张图片`, `基于 Higgsfield 的`).
- Simplified Chinese addresses the reader as 您, to match the polite Korean register (`입력하세요`).
- Keep `…` (one character) for an action in progress in all three languages (`확인 중…`, `Checking…`, `正在验证…`).
- Use an ICU argument for every value and `plural` for every count, even when Korean and Chinese need only `other`.
- Dates, times, relative times and dollar amounts come from `src/i18n/format.ts` (Intl, CLDR) exactly as it prints them, such as `2026/10/29 16:05` and `3分钟前`. The spacing rule above is for the messages, not for these.

## Never translated

`Video Gen Studio`, `Higgsfield`, `OpenAI`, model names (`Seedance 2.0`, `MiniMax H3`, `Hailuo 2.3 Standard`, `GPT Image 2`), the `ADMIN` badge, `MP4`, `NSFW`, `API`, resolution and ratio tokens (`480p`, `16:9`), Bebas counters (`5S`), prompts, nicknames, IDs, team names, file names, provider error text, and `[목업]` rows.
Each language button in the picker shows its own name (`한국어`, `English`, `简体中文`) in every locale.

## Terms

| Korean | English | Simplified Chinese | Notes |
|---|---|---|---|
| 플레이그라운드 | Playground | 创作台 | Page name |
| 갤러리 | Gallery | 作品库 | Holds videos and images |
| 대시보드 | Dashboard | 数据看板 | |
| 어드민 | Admin | 管理后台 | |
| 설정 | Settings | 设置 | |
| 로그인 | Sign in | 登录 | Page name and action |
| 로그아웃 | Sign out | 退出登录 | Pairs with Sign in |
| 비밀번호 | password | 密码 | |
| 비밀번호 변경 | Change password | 修改密码 | |
| 임시 비밀번호 | temporary password | 临时密码 | Set by an admin, changed at first sign-in |
| 초기 비밀번호 | initial password | 初始密码 | |
| 언어 | Language | 语言 | |
| 주 메뉴 | Main menu | 主菜单 | Name of the header navigation |
| 닫기 | Close | 关闭 | |
| 생성 (noun) | generation | 生成任务 | One request and its result |
| 생성하기 (button) | Generate | 生成 | |
| 레퍼런스 | reference | 参考素材 | An attached image or video |
| 이미지 레퍼런스, 영상 레퍼런스 | image reference, video reference | 参考图, 参考视频 | |
| 텍스트→영상 | Text to video | 文生视频 | Mode |
| 이미지→영상 | Image to video | 图生视频 | Mode |
| 레퍼런스→영상 | Reference to video | 参考生视频 | Mode |
| 텍스트→이미지 | Text to image | 文生图 | Mode |
| 레퍼런스→이미지 | Reference to image | 参考生图 | Mode |
| 이 이미지로 시작 | Start from this image | 以此图作为首帧 | Checkbox |
| 프롬프트 | prompt | 提示词 | |
| 화면비 | aspect ratio | 画面比例 | |
| 해상도 | resolution | 分辨率 | |
| 길이(초) | Duration (s) | 时长（秒） | |
| 결과 무대 | result stage | 结果展示区 | Name of the result area |
| 제출 대기 | Waiting to submit | 等待提交 | Status `pending` |
| 대기 | Queued | 排队中 | Status `queued` |
| 생성 중 | Generating | 生成中 | Status `in_progress` |
| 완료 | Done | 已完成 | Status `completed` |
| 실패 | Failed | 失败 | Status `failed` |
| NSFW 차단 | Blocked (NSFW) | 已拦截（NSFW） | Status `nsfw` |
| 취소 | Canceled | 已取消 | Status `canceled` |
| 보관, 영구, 만료됨 | Kept, Permanent, Expired | 保存, 永久, 已过期 | Gallery storage row |
| 단가 | rate | 单价 | Price per second |
| 예상 비용 | Estimated cost | 预计费用 | |
| 누적 비용 | Total spend | 累计费用 | |
| 닉네임 | nickname | 昵称 | |
| ID | ID | ID | The sign-in ID, an email address |
| 회원, 사용자 | member | 成员 | One word per language for a person with an account |
| 관리자 | admin | 管理员 | The person; the page is 어드민 |
| 팀 | team | 团队 | |
| 팀원 | teammate | 团队成员 | A member of the viewer's own team. Also stands in for a teammate's name in the gallery when they have no nickname |
| 미소속 | No team | 未分配团队 | |
| API 키 | API key | API 密钥 | |
| 생성 설정 | Generation settings | 生成设置 | The playground's form, called the drawer in code |
| 생성 방식 | Mode | 生成方式 | Label of the mode list |
| 첫 프레임 | first frame | 首帧 | |
| 출력 화면비 | Output aspect ratio | 输出画面比例 | |
| 가로, 세로, 정사각 | Landscape, Portrait, Square | 横版, 竖版, 方形 | Orientation of an image or a video |
| OpenAI 편집 | OpenAI editing | OpenAI 编辑 | The edits endpoint, used when references are attached |
| 정가 | List price | 原价 | A provider's published price before a discount |
| 사용 불가 | Unavailable | 不可用 | A model the server cannot run |
