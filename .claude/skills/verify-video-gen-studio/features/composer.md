# Composer

The playground reads like a chat. Each generation of the thread is a turn: the prompt card the member sent (prompt, reference thumbnails, model, mode, settings summary, cost) with its result under it (status badge, elapsed or took time, cancel, download, 레퍼런스로, reuse). Reusing a result as a reference, by 레퍼런스로 or by "@" in the prompt, is its own feature: [Reuse](./reuse.md). The newest turn is at the bottom, and the composer is docked under the stream. The member never picks a mode: they write a prompt, drop, paste or pick files (each lands as a reference), may mark an attached image as the start or end frame, set the parameters in a popover (a bottom sheet under 640 px), and generate. No attachments sends the prompt alone, a marked frame sends image to video, anything else sends references.

Every handle is a message key the journey reads with `ev.t`; the Korean text follows in parentheses.

## Sub-features

- `cmp-new` a member with no thread opens on `playground.empty.title` in region `playground.stream` (생성 기록), with the model chip on the first model the member can use and nothing attached, so the prompt goes alone.
- `cmp-menu` the model chip (`playground.modelMenu` + ` · ` + the model name, 모델) opens dialog `playground.modelMenu` with the output tabs (`playground.outputs`) and the models of the tab, each with what it takes (`playground.takes`) and its rate (`playground.rateHint`). No row names a mode. A pick closes it; Enter picks; Esc closes and focus returns to the chip.
- `cmp-derived` the line under the thumbnails names the mode the attachments make (`mode.r2v`, `mode.i2v`, `mode.r2i`), then `playground.refs.imageCount` · `playground.refs.videoCount`, and `playground.frames.hint` while no frame is marked on a model that takes frames. With nothing attached there is no line.
- `cmp-drop` files dragged over the composer show `playground.dropHere` (여기에 놓으면 레퍼런스로 들어갑니다) with `playground.takes` in a dashed white frame; dropped files land as references with no frame mark.
- `cmp-paste` files pasted into the prompt land as references and leave the prompt text as it was; a clipboard that also carries other text (Word, Excel and PowerPoint put a picture of the text beside it) pastes as text.
- `cmp-frames` an image thumbnail on Seedance 2.0 or MiniMax H3 is a button named `playground.frames.open` that opens dialog `playground.frames.title` with rows `playground.frames.role` (시작 프레임, 끝 프레임); a pick marks the image, a pick on a role it holds takes the mark off, and a role another image holds moves here. A marked thumbnail has a white ring and the badge `playground.frames.badge` (시작, 끝, 시작·끝). Videos never take a frame.
- `cmp-frames-others` a marked frame beside other attachments dims the others (each described by `playground.frames.left`), reads `errors.framesWithOthers` with the count, and keeps `playground.generate` off until they go or the marks come off. An end frame alone reads `errors.startFrameRequired`.
- `cmp-end-frame` generating with both frames sends `image_url` then `end_image_url` to `…/image-to-video` and nothing else; the row keeps both in `imageRefs`, and its turn labels them `playground.feed.frame` (시작, 끝).
- `cmp-reuse-frames` 다시 (`playground.actions.reuse`) on an image-to-video turn puts its first image back as 시작 and its second as 끝, with `playground.note.reused` (`refs: frames`). Generate waits (`playground.uploading`) until each frame is known to still load; a frame that no longer loads, or one uploaded under `refs/` (its row deletes it), stays out and the note reads `refs: missing`.
- `cmp-settings` the settings chip (`playground.settings.open` with the summary) opens dialog `playground.settings.title` with pills, a slider and switches; the chip's summary and the estimate change with each pick. Seedance image to video explains the aspect instead of pills (`playground.aspect.firstFrameRule` or the start frame's `firstFrameNote`).
- `cmp-limits` references stop at the model's limits (`playground.upload.tooMany`), a model change keeps the attachments and the marks, and over the new model's limit the status line reads `errors.tooManyImages` (or `errors.noVideoRefs` for a video on GPT Image 2) with 생성하기 off.
- `cmp-unmark` switching to GPT Image 2 takes the frame marks off with `playground.note.unmarked`, and its images offer no frame menu.
- `cmp-add` + (`playground.refs.add`) opens a menu whose rows (`playground.refs.uploadImages`, `playground.refs.uploadVideos`) open the file picker; it stays open for more files, and its note (`playground.refs.menuNote`) names the drop, the paste and the frames.
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
- **Steps.** `new-thread`, `composer-text` (the empty composer), `model-menu` (no mode rows, `playground.takes` on Seedance), two images dragged in (`drop-state` held before the drop, then `dropped`), an image pasted into the prompt, the frame menu on image 1 (`frame-menu`), 시작 on image 1 with two images dimmed and `errors.framesWithOthers` (`frames-blocked`), 끝 on image 2, 시작 moved to image 2 and back, the third image removed (`frames`), `settings` (720p and 8 s change the summary and the estimate), the frames generation into a new thread with the fake's body checked, every attachment removed and 다시 on that turn restoring 시작 and 끝 (`reused-frames`), the marks taken off and seven images giving six and a video (`composer-references`), H3's five-image blocker, a Ctrl+Enter generation into the same thread, 시작 marked on H3 and GPT Image 2 taking it off with its video blocker (`gpt-no-frames`), + on GPT Image 2 and a dropped file, the two Blob references sent with Seedance leaving with `playground.note.spent`, `stream`, 14 older rows inserted and the reload, `older-loading` held by the harness, the jump to the latest.
- **Proof.** Review images at `.impeccable/review/composer/<surface>-<ko|en|zh-CN>-<desktop|mobile>.png`; `log.md` records the end-frame body, the settings summary and cost, the frames that 다시 restored, and the top turn's position before and after the older page.

## Gotchas

- An attach clears the last attach's error line, so the journey reads the limit error before attaching the video.
- A model pick closes the model menu, and a frame pick closes the frame menu; marking two frames takes two openings.
- An image thumbnail has two buttons, the frame menu and remove; the remove button is the last one in its list item.
- A drop and a paste are dispatched with a `DataTransfer` built in the page (`composer-handles.mjs` `dropFiles`, `pasteFiles`); Chromium honors `clipboardData` in a synthetic `ClipboardEvent`.
- The older page is held with `page.route` until the review image is taken; without the hold it loads too fast to see.
