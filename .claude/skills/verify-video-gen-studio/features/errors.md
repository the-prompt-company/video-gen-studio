# Errors

Every refusal the server sends and every failure reason a generation stores reaches the page as an error code, and the page words it in its own language. Provider text (Higgsfield, OpenAI) and the Korean reasons stored before error codes show exactly as written.

## Sub-features

- `err-wire` every refusal is `{ "error": { "code": ..., "params"?: {...} } }` with no Hangul; an unexpected error answers 500 with only `{ code: "unexpected", params: { ref } }`.
- `err-wrong` a wrong ID or password reads `errors.wrongCredentials` in the page language.
- `err-locked` after ten wrong passwords the right one answers 423 `{ code: "locked", params: { minutes: 15 } }` and the page names the 15 minutes in its language.
- `err-temporary` on the forced change, the initial password as the new one reads `errors.passwordIsInitial`, and a short one `errors.passwordTooShort` with the minimum.
- `err-composer` a member without a Higgsfield key sees `errors.noKey` in the composer `playground.composer` once Seedance is picked, and with an empty `playground.prompt` a second status line reads `errors.promptRequired` with the model and mode.
- `err-stream` a failed row stored with an error code reads in the page language in the stream `playground.stream`.
- `err-nickname` a 31-character nickname in the field labelled `profile.nickname.label` reads `errors.nameTooLong` on `pages.settings` after `profile.nickname.save`, from the browser's own check and from `PATCH /api/me`.
- `err-duplicate` adding a member with an existing ID reads `errors.duplicateUsername` in the `members.add.title` dialog.
- `err-logs` tab `admin.tabs.logs` shows an old Korean reason and provider text as written, and a coded reason in the page language.
- `err-image` a real GPT Image 2 submit that the fake answers with a 500 fails as `imageUnanswered` (maybe billed) and the stream reads it in the page language.
- `err-key` a submit the fake refuses with a 401 fails as `openaiKeyRejected`, and the sentence carries OpenAI's own words with the key fragment redacted (`Incorrect API key provided: sk-… … [code: invalid_api_key, type: invalid_request_error]`).

## How to get to it (user POV)

- `/login` with a wrong password, ten times, or with a temporary password.
- `/playground` as a member without a Higgsfield key; `/playground?thread=earlier` shows that member's failed generations, which have no thread.
- `/settings` → `profile.nickname.label`; `/admin` → `members.add.title` and `admin.tabs.logs`.

## Driving it with vgs

Preconditions:

- The app runs against a local database and the fake for every provider and storage, as for [Images](./images.md), with `OPENAI_API_KEY` set; `VGS_FAKE_HF` names the fake. The journey writes generation rows and refuses a non-local `DATABASE_URL`.
- Run it as the admin (the default credentials): it creates three `vgs-loc-i18n2-<stamp>-*@example.test` members through the admin API and deletes them, and their rows, in `finally`.
- Run it once per language and viewport: `VGS_LOCALE=en-US VGS_MOBILE=1 vgs run errors`.

- **Wire.** After the admin signs in, the journey sends six refusals with the admin's session and one without a session, fails on any body that is not `{ error: { code } }` or holds Hangul, and writes them to `.impeccable/review/i18n-2/wire.txt`. `err-locked` reads the 423 body and `err-nickname` the `PATCH /api/me` body.
- **Each surface.** `vgs run errors` drives the steps above in order and saves `login-wrong`, `login-locked`, `password-initial`, `password-short`, `playground-no-key`, `playground-blocker`, `playground-failure`, `settings-nickname`, `admin-duplicate`, `logs-old-row`, `logs-provider-text`, `logs-coded`, `playground-image-failure` and `playground-key-rejected` as `.impeccable/review/i18n-2/<surface>-<lang>-<viewport>.png`.
- **Proof.** Every expected sentence comes from `ev.t("errors.<code>", params)` in the page's language; `log.md` records the 423 body and the image row's stored reason.

## Gotchas

- The wrong-password step uses an ID that does not exist, so the admin's lockout counter never moves.
- The fake's OpenAI is set to fail with a 500, then a 401, for the image steps and reset in `finally`. Do not run this journey beside `lifecycle-check` or [Images](./images.md), which set the same fake.
- The stream shows the newest row at the bottom; the coded failure is inserted last.
- Every surface is found by key: the playground (`playground.composer`, `playground.modelMenu`, `playground.prompt`, the composer's `playground.generate`, `playground.stream`), settings (`profile.nickname.label`, `profile.nickname.save`) and the admin (`members.add.title`, `members.add.password`, `members.add.submit`, `admin.tabs.logs`). The old Korean reason and the `[목업]` prompts are stored data and stay as written in every language.
- Every run rewrites its review images under `.impeccable/review/i18n-2/`. When a run is not meant to refresh them, restore them with `git checkout -- .impeccable/review/i18n-2`.
