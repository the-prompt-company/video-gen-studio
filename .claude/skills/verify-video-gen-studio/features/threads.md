# Threads

The playground keeps a member's generations in threads, like chats. A thread is created by the first generation made from the new-thread state and is titled by that generation's prompt. Picking a thread shows only its results on the stage, and the URL (`/playground?thread=<id>`) keeps the pick across a reload and Back. Generations made before threads existed sit in one thread called `threads.earlier` (이전 기록). Deleting a thread only takes it off the list: its results stay in the gallery and every usage number. A thread is private to its owner, admins included.

## Sub-features

- `thr-new` `/playground` with no thread opens the new-thread state: the stage reads `threads.fresh.title` (새 스레드), or `playground.empty.title` for a member with no thread at all, and nothing is created until the first generation.
- `thr-create` the first generation from the new-thread state creates the thread under the id the browser chose; the URL gains `?thread=<id>` and the list gains the thread, titled by the prompt with its whitespace collapsed and cut after 30 characters with `…`. An empty first prompt reads `generation.noPrompt`.
- `thr-stay` later generations, including one after `playground.rail.reuse`, stay in the thread on the stage.
- `thr-switch` picking a thread in the list shows only its results, newest first; the list is ordered by each thread's newest generation.
- `thr-url` reload keeps the thread and Back returns to the one picked before.
- `thr-earlier` the `threads.earlier` thread holds the generations made with no thread, before the migration or by an old tab.
- `thr-delete` each row's button `threads.delete.label` opens dialog `threads.delete.title` with `threads.delete.body` and `threads.delete.keeps`; `threads.delete.confirm` takes the thread off the list, and deleting the thread on the stage lands on the new-thread state. The results stay in the gallery, the dashboard's numbers do not move, and a live generation runs to its end.
- `thr-private` another member's thread id, in the URL or any thread route, reads like a deleted one: the stage shows `threads.missing.title` and `GET /api/generations?thread=`, `POST /api/generations` and `DELETE /api/threads/:id` answer 404 `errors.noSuchThread`. The same holds for an admin.
- `thr-layout` from 1280 px the list is a column left of the drawer with `threads.collapse`; from 1024 to 1279 px it starts as a strip with `threads.expand` and `threads.new`; under 1024 px a bar above the stage names the current thread and opens the list in a sheet (`threads.picker`). Nothing scrolls sideways at 390 px.

## How to get to it (user POV)

- Header nav `pages.playground` (플레이그라운드), which opens a new thread.
- A thread row in the list (column, strip after `threads.expand`, or the sheet under 1024 px).
- A shared or bookmarked `/playground?thread=<id>` link.

## Driving it with vgs

Preconditions:

- A local database (the journey refuses any other) and the fake serving a real clip: `FAKE_HF_PORT=4800 FAKE_HF_VIDEO_FILE=public/mock/result-landscape.webm npm run fake:hf`, `.env.local` pointing `HIGGSFIELD_BASE_URL` and the Blob variables at it, and `VGS_FAKE_HF=http://localhost:4800`.
- Run it as the admin, once per language and viewport: `VGS_LOCALE=zh-CN VGS_MOBILE=1 VGS_FAKE_HF=http://localhost:4800 vgs run threads`.

- **Members.** Creates `vgs-thr-<stamp>-a` (a fake key and two rows with no thread) and `vgs-thr-<stamp>-b` (one thread with one row) and deletes both with their rows and threads in `finally`.
- **New thread.** `new-thread` shows the stage's `threads.fresh.title` and a list holding only `threads.earlier`.
- **Two threads.** Two generations make thread one (the second stays in it), `threads.new` and one more make thread two; the URL, the stage's articles and the POST answers' `thread` agree at each step, and the title matches the rule above.
- **Order and switch.** The list reads thread two, thread one, `threads.earlier` (`thread-list` on desktop, `thread-picker` on mobile); picking each shows only its articles (`thread-feed`).
- **Reload and Back.** Reload stays on thread two; Back returns to thread one.
- **Earlier history.** `threads.earlier` shows the two rows with no thread (`earlier-history`).
- **Delete.** On thread one, its row's delete button opens the confirmation (`delete-confirm`); confirming answers 200, lands on the new-thread state, and the list drops it. Its feed answers 404, both results are still gallery tiles and in `GET /api/generations?limit=50`, and the dashboard's `dashboard.stats.generations` and `dashboard.stats.totalSpend` read the same as before.
- **Foreign thread.** As the member and as the admin, `/playground?thread=<b's thread>` reads `threads.missing.title` without B's prompt anywhere in the page (`missing-thread`), and the three routes answer 404 `noSuchThread`.
- **Proof.** Review images at `.impeccable/review/threads/<surface>-<ko|en|zh-CN>-<desktop|mobile>.png`; `log.md` records the ids, the list order and the dashboard numbers.

## Gotchas

- The column starts collapsed between 1024 and 1279 px, so a desktop run at those widths has to press `threads.expand` first. The journey runs at 1440.
- The delete button shows on hover, on the current row and on touch screens; the journey hovers the row first.
- In the sheet, picking or deleting closes the sheet before the next step.
- A thread with no generation (its first submit failed after the thread was created) never shows in the list; sending the same first submit again fills it.
- The review images hide next dev's corner badge, which otherwise covers the bottom of the thread column.
