# Composer

The playground reads like a chat. Each generation of the thread is a turn: the prompt card the member sent (prompt, reference thumbnails, model, mode, settings summary, cost) with its result under it (status badge, elapsed or took time, cancel, download, 레퍼런스로, reuse). Reusing a result as a reference, by 레퍼런스로 or by "@" in the prompt, is its own feature: [Reuse](./reuse.md). The newest turn is at the bottom, and the composer is docked under the stream: the member picks the mode in the model menu, fills the frame slots or the references the mode takes, sets the parameters in a popover (a bottom sheet under 640 px), and generates.

Every handle is a message key the journey reads with `ev.t`; the Korean text follows in parentheses.

## Sub-features

- `cmp-new` a member with no thread opens on `playground.empty.title` in region `playground.stream` (생성 기록), with the model chip on the first model the member can use, in text mode.
- `cmp-menu` the model chip (`playground.modelMenu` + ` · ` + model and mode, 모델과 방식) opens dialog `playground.modelMenu` with the output tabs (`playground.outputs`), the model's modes as `playground.kind.*` + ` · ` + `mode.*` with `playground.kindHint.*`, and the models of the tab with their rates (`playground.rateHint`). A mode or model pick closes it; Enter picks; Esc closes and focus returns to the chip.
- `cmp-frames` 프레임 (`firstFrame`) shows a start slot (required) and an end slot (optional, for models whose image-to-video takes `end_image_url`: Seedance 2.0 and MiniMax H3). Without a start frame the status line reads `errors.startFrameRequired` and `playground.generate` is off. Each slot opens its own file picker.
- `cmp-end-frame` generating with both frames sends `image_url` then `end_image_url` to `…/image-to-video`; the row keeps both in `imageRefs`, and its turn labels them `playground.feed.frame` (시작, 끝).
- `cmp-settings` the settings chip (`playground.settings.open` with the summary) opens dialog `playground.settings.title` with pills, a slider and switches; the chip's summary and the estimate change with each pick. Seedance frames explain the aspect instead of pills (`playground.aspect.firstFrameRule` or the start frame's `firstFrameNote`).
- `cmp-switch` frames become references in order; choosing text takes the references away with `playground.note.removed` and `playground.note.undo` (되돌리기) puts them back; adding a reference in text mode switches to references with `playground.note.switched`.
- `cmp-limits` references stop at the model's limits (`playground.upload.tooMany`), the counter reads `playground.refs.imageCount` · `playground.refs.videoCount`, a model change keeps the attachments, and over the new model's limit the status line reads `errors.tooManyImages` (or `errors.noVideoRefs` for a video on GPT Image 2) with 생성하기 off.
- `cmp-add` + (`playground.refs.add`) opens a menu whose rows (`playground.refs.uploadImages`, `playground.refs.uploadVideos`) open the file picker; it stays open for more files. Files dropped on the composer are added too.
- `cmp-keyboard` Ctrl+Enter (Cmd+Enter) in the prompt generates.
- `cmp-spent` references kept in Blob (GPT Image 2 uploads, and Higgsfield files over 4 MB) leave the composer after a Higgsfield send with `playground.note.spent`, because the row deletes them when it ends; GPT Image 2 sends keep them.
- `cmp-threads` the first generation from a new thread creates it (the URL gains `?thread=`); the next one stays in it.
- `cmp-older` the stream shows the newest 12 turns and opens at the bottom; scrolling to the top loads 12 older ones (`playground.older.loading`) while the turn at the top stays in place, and the start reads `playground.older.start`. `playground.latest` jumps back to the newest turn.
- `cmp-reload` a reload keeps the thread and opens at its newest turn.
- `cmp-sideways` at 390 px nothing scrolls sideways, the page or any region inside it.

## How to get to it (user POV)

- Header nav `pages.playground` (플레이그라운드), or a thread in the list.

## Driving it with vgs

Preconditions:

- A local database (the journey refuses any other) and the fake for both providers and Blob, serving a real clip: `FAKE_HF_PORT=4900 FAKE_HF_VIDEO_FILE=public/mock/result-landscape.webm npm run fake:hf`, `.env.local` pointing `HIGGSFIELD_BASE_URL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY` and the Blob variables at it, and `VGS_FAKE_HF=http://localhost:4900`.
- Run it as the admin, once per language and viewport: `VGS_LOCALE=en-US VGS_MOBILE=1 VGS_FAKE_HF=http://localhost:4900 vgs run composer`.

- **Member.** Creates `vgs-cmp-<stamp>@example.test` with a fake key, sets the Seedance and H3 rates for the run, and deletes the member with its rows and threads and restores the rates in `finally`.
- **Steps.** `new-thread`, `composer-text`, `model-menu`, `blocker` (frames with no start frame), `composer-frames`, `settings` (720p and 8 s change the summary and the estimate), the frames generation into a new thread with the fake's body checked, frames → references → text → 되돌리기, seven images give six and a video (`composer-references`), H3's five-image blocker, a Ctrl+Enter generation into the same thread, GPT Image 2's video blocker, + in text mode, a dropped file (dragenter, a dragover the composer accepts, drop), the two Blob references sent with Seedance leaving with `playground.note.spent`, `stream`, 14 older rows inserted and the reload, `older-loading` held by the harness, the jump to the latest.
- **Proof.** Review images at `.impeccable/review/composer/<surface>-<ko|en|zh-CN>-<desktop|mobile>.png`; `log.md` records the end-frame body, the settings summary and cost, and the top turn's position before and after the older page.

## Gotchas

- An attach clears the last attach's error line, so the journey reads the limit error before attaching the video.
- A mode pick closes the model menu; picking a mode and then a model takes two openings.
- The older page is held with `page.route` until the review image is taken; without the hold it loads too fast to see.
