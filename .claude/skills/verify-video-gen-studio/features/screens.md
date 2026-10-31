# Screens

The gallery, the dashboard and the playground read fully in the browser's language (Korean, English or Simplified Chinese). Counts follow the language's plural rules, the Korean particles after a count or a shape agree with it, prompts and nicknames stay exactly as the member wrote them, and model names are never translated.

## Sub-features

- `scr-gallery` a tile is named by `gallery.openDetail` with the prompt as written, carries the `gallery.retention.*` line, and the header shows a Korean nickname as written.
- `scr-detail` the detail dialog (`gallery.detail.title`) shows the reference counts, a row per parameter labelled by `params.*`, `gallery.detail.on` for a true flag, and `generation.download`.
- `scr-plurals` the dashboard's by-model rows read `dashboard.modelUsage` for 2 and 1 generations and the outcomes line reads 0 failed.
- `scr-empty` a member with no results sees `gallery.empty` with a link to `/playground`.
- `scr-no-key` a member without an API key sees `errors.noKey` in the drawer and Generate stays off.
- `scr-scope` the admin's `gallery.scope.everyone` and `gallery.scope.mine` links switch scope, and the admin's `users.locale` does not move.
- `scr-blocker` reusing a row that asks for 20 s puts `errors.paramRange` with the `params.duration` label in the cost bar.
- `scr-drawers` each model's option starts with its untranslated name, its `families.*.note` shows, and GPT Image 2's options read `paramValues.*`.
- `scr-refs` the reference dialog shows `playground.refs.limits`, `playground.refs.attachedCount` and remove buttons named by `playground.refs.removeLabel`.
- `scr-particles` two images and one video read `playground.modeSentence.reference` (`이미지 2장과 영상 1개를` in Korean).
- `scr-cost` the estimate line names the 3.0 s input video and the rate.
- `scr-orientation` a square first frame reads `정사각으로` in Korean and the shape's branch in the other languages.
- `scr-image` GPT Image 2 generates against the fake, and the stage caption reads `GPT Image 2 · ` and `mode.t2i`.
- `scr-sideways` at 390 px no surface scrolls sideways (`scrollWidth` equals `innerWidth`).

## How to get to it (user POV)

- Header nav 갤러리, 대시보드 and 플레이그라운드 in the browser's language, as a member and as the admin (갤러리's 내 것 / 전체 links).

## Driving it with vgs

Preconditions:

- A local database (the journey refuses any other), `npm run db:mock` rows for the admin, and the fake serving a real clip: `FAKE_HF_PORT=4500 FAKE_HF_VIDEO_FILE=public/mock/result-landscape.webm npm run fake:hf`, then `VGS_FAKE_HF=http://localhost:4500`. `.env.local` points `HIGGSFIELD_BASE_URL` and `OPENAI_BASE_URL` at the same fake.
- Run it as the admin, once per language and viewport: `VGS_LOCALE=zh-CN VGS_MOBILE=1 vgs run screens`.

- **Each surface.** Saves `gallery-tiles`, `gallery-detail`, `gallery-empty`, `no-key-banner`, `admin-scope`, `dashboard`, `blocker`, `drawer-h3`, `drawer-gpt-image-2`, `drawer-seedance`, `reference-dialog`, `particles`, `cost-bar`, `orientation-note` and `image-model` as `.impeccable/review/i18n-3/<surface>-<lang>-<viewport>.png`.
- **Proof.** `log.md` records the strings it read. The journey creates two `vgs-loc-i18n3-*` members with three rows, sets the Seedance rate for the run, and deletes and restores all of it in `finally`.

## Gotchas

- The drawer opens on the first model the member can use. Without a Higgsfield key that is GPT Image 2, so the no-key banner shows only after picking Seedance.
- Without `FAKE_HF_VIDEO_FILE` the fake serves bytes that are not a video, and a gallery tile made from them never loads its metadata.
- The review images hide next dev's corner badge, which otherwise covers the cost bar.
