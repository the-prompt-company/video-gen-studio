# Reuse

A member puts their own finished results, videos and images, back into the composer as references or frames without downloading and uploading them again. Each finished turn whose media is still there has `playground.actions.attach` (레퍼런스로), and typing "@" at the start of a word in the prompt opens a list of the member's results: this thread's first, then recent ones from every thread. A result attaches where an upload would, stays attached after a send, and the next request carries the result's stored URL. The server refuses another member's upload or result and a result whose media is gone.

Every handle is a message key the journey reads with `ev.t`; the Korean text follows in parentheses.

## Sub-features

- `reuse-action` a completed turn with media shows `playground.actions.attach` (레퍼런스로) beside 다운로드 and 다시; a failed turn, a live one, and one whose result is gone do not.
- `reuse-place` a reused result lands where an upload would: in text mode it switches to references (`playground.note.switched`), in frames an image fills the start frame and then the end frame, a video in frames is refused (`playground.upload.framesTakeImages`), and GPT Image 2 refuses a video (`errors.noVideoRefs`).
- `reuse-duplicate` the same result twice in the references is refused with `playground.upload.attached` and changes nothing; frames may start and end on one image.
- `reuse-length` a reused video counts its stored length in the estimate (`playground.fact.inputVideo`).
- `reuse-kept` a reused result is not an upload, so it stays in the composer after a Higgsfield send (no `playground.note.spent`), and the row's reference cleanup never deletes it: the turn's reference thumbnails keep loading.
- `reuse-picker` "@" opens listbox `playground.picker.label` above the composer with groups `playground.picker.thread` and `playground.picker.recent`; each option shows a thumbnail, the prompt, the model, `playground.picker.kind` and the age, and `playground.picker.attached` once it is in the composer. Typing after "@" filters by prompt (`playground.picker.noMatch`); frames and GPT Image 2 hide video results and say so (`playground.picker.hidden`).
- `reuse-keys` ArrowUp and ArrowDown move the active option (the prompt's `aria-activedescendant`, scrolled into view), Enter picks, Esc closes; a click or tap picks without taking focus from the prompt. A pick takes the "@" word out of the prompt, because Higgsfield's prompt has no syntax that names a reference.
- `reuse-wire` the next request carries the stored result URL: `image_urls` and `video_urls` for reference→video, `image_url` and `end_image_url` for frames, and `images[].image_url` for the OpenAI edit.
- `reuse-refused` POST /api/generations answers 400 `errors.refNotYours` for another member's result or upload (however its URL is respelled), 400 `errors.resultGone` for a result whose media is gone, and 400 `errors.refMismatch` for a result sent as another kind or length; a gone result offers no 레퍼런스로 and the picker leaves it out.
- `reuse-sideways` at 390 px nothing scrolls sideways, the page, the stream or the picker.

## How to get to it (user POV)

- 플레이그라운드 → a finished turn → 레퍼런스로.
- 플레이그라운드 → the prompt → type "@".

## Driving it with vgs

Preconditions:

- A local database (the journey refuses any other) and the fake for both providers and Blob, serving a real clip: `FAKE_HF_PORT=4900 FAKE_HF_VIDEO_FILE=public/mock/result-landscape.webm npm run fake:hf`, `.env.local` pointing `HIGGSFIELD_BASE_URL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY` and the Blob variables at it, and `VGS_FAKE_HF=http://localhost:4900`.
- Run it as the admin, once per language and viewport: `VGS_LOCALE=zh-CN VGS_MOBILE=1 VGS_FAKE_HF=http://localhost:4900 vgs run reuse`.

- **Members.** Creates `vgs-reuse-<stamp>@example.test` (with a fake key) and `vgs-reuse-<stamp>-b@example.test`, and deletes both with their rows and threads in `finally`.
- **Steps.** A Seedance text→video and two GPT Image 2 text→image results in one new thread, waited until each has a stored copy (`turn-actions`); 레퍼런스로 on the video and the first image (`attached`), the same image again (`duplicate`); a reference→video send with the fake's body checked and both results still attached (`sent`); the row's end with the store's delete list and the thumbnails checked; frames, "@" with the hidden-video note (`picker`), "beacon-b" and a click or tap for the start frame, " @" and ArrowDown and Enter for the end frame (`frames`); the frames send; GPT Image 2 turning the frames into edit references and the OpenAI body checked; the server refusals through the member's session; a reload, an expired result without 레퍼런스로, and "@expired-clip" answering `playground.picker.noMatch` (`gone`).
- **Proof.** Review images at `.impeccable/review/reuse/<surface>-<ko|en|zh-CN>-<desktop|mobile>.png`; `log.md` records the stored URLs, each request body's reference fields, the store's delete list, and the three refusals.

## Gotchas

- The prompt keeps its text after a send, so an "@" typed right after it is inside a word and opens nothing. The journey clears the prompt first.
- `?ids=` answers rows in the database's order, not the order asked; match them by id.
- A video result is reusable once Higgsfield's copy has more than an hour left or the stored copy landed; the journey waits for the stored copy so the request carries the Blob URL.
