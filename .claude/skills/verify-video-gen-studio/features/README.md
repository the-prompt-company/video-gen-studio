# Video Gen Studio verification map

This directory is the maintained source for verifying the user-facing behavior of Video Gen Studio. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `vgs launch` from `web/`; the instance is `http://localhost:3100` (or `VGS_PORT`).
- `.env.local` points at the team Supabase project; there is no disposable database. Mutate only what a recipe restores, what is tagged `[목업]`, or a `vgs-pw-*@example.test`, `vgs-imp-<stamp>-*@example.test`, `vgs-set-*@example.test`, `vgs-team-<stamp>-*@example.test` or `vgs-loc-<stamp>-*@example.test` member (and `vgs-team-<stamp>-*` team) the password, import, settings, teams and locale recipes create and delete.
- Credentials are `VGS_USER`/`VGS_PASS`, defaulting to the seeded admin. Admin-only recipes say so.
- `vgs doctor` reports `ok: true` with the expected port, pid, and role before any drive.
- Never drive an instance that `vgs launch` did not start (the developer's `npm run dev` on 3000 is off limits).
- Completed generations exist for the account when a recipe needs them: `npm run db:mock` seeds `[목업]` rows; `npm run db:mock -- --clear` removes them.

## Driving conventions

- Start every recipe from a fresh browser context; `ev.login(path)` signs in through the real form.
- Prefer ARIA roles, accessible names, and labels over CSS selectors or DOM position. The handle table in `SKILL.md` lists the stable ones.
- Treat every command as literal. Keep quoted Korean names unchanged.
- Pick the browser language with `VGS_LOCALE` (`ko-KR` by default, `en-US`, `zh-CN`). Translated surfaces (sign-in, password forms, header, modal close, status badges, error messages, the playground, the gallery and the dashboard) are found by message key with `await ev.t("<key>", values, page)`, which reads the page's `<html lang>`; surfaces not yet translated keep their Korean names in every language.
- Run journeys through `vgs run <journey>`; add `VGS_MOBILE=1` for the 390px layout.
- A paid generation only happens with `VGS_ALLOW_SPEND=1`. Default runs prove the gate and stop.
- Restore mutated data inside the journey (`finally`). Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen (`ev.shot` after each meaningful step).
- UI proof includes an ARIA snapshot and a screenshot with the header identity (username, ADMIN badge) visible.
- Mutation proof includes a read-back through a second view: an API call with the same session, a reload, or another page.
- Record the feature ID and entry point used with every artifact (`log.md` and `result.json`).
- Report an unreachable path with the attempted step and the unmet precondition (`ev.fail("...precondition...")`).
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with vgs` starts with `Preconditions:` and uses labeled bullets that pair each user action with the harness step and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Login](./login.md) covers the form, wrong-password error, success, the signed-in redirect guard, and logout.
- [Locale](./locale.md) covers the browser language on first visit, the login picker and its cookie, a pick stored at the first sign-in, the 설정 language section, the language after sign-out and on a second browser, the shared-browser rule, and Chinese fonts. Creates and deletes two disposable members.
- [Password](./password.md) covers the forced change of a temporary password, the change from the login screen, other sessions ending, the shared lockout, email IDs in any case, and the admin reset. Creates and deletes one disposable member.
- [Import](./import.md) covers creating members from an `.xlsx` (header detection, the per-row preview, the 200-row cap), the nickname column and 임시 비밀번호 badge, the admin nickname edit, and 초기 비밀번호로 되돌리기. Creates and deletes 207 disposable members.
- [Settings](./settings.md) covers the header identity link, profile photo pick/preview/save/replace/remove with the stored 256×256 square, the photo delete guard, the nickname rule and header update, the read-only ID and team, and the password change that signs other browsers out. Creates and deletes two disposable members and their photos.
- [Teams](./teams.md) covers the 팀 tab (create, case-blind duplicate, rename, delete to 미소속), the users table's 팀 column, filter, checkboxes and 팀 지정, the editor's 팀 select, a member's team in 설정, and the admin team routes refusing members. Creates and deletes two disposable members and two teams.
- [Playground](./playground.md) covers the composer, the model menu, the modes per model, aspect pills and parameters in the settings, the add menu, the generate gate, every model and mode against the fake (end frame included), and live polling.
- [Composer](./composer.md) covers the chat stream and the docked composer: mode switching with 되돌리기, frame slots and the end frame the fake receives, settings changing the summary and the estimate, reference limits and blockers, drag and drop, Ctrl+Enter, older turns that keep their place, and reload. Creates and deletes one disposable member; local database only.
- [Threads](./threads.md) covers the playground's threads: the new-thread state, a thread created by its first generation and titled by its prompt, switching, reload and Back, the earlier history, delete with its confirmation (results kept in the gallery and the dashboard), another member's thread refused for members and admins, and the column, strip and sheet layouts. Creates and deletes two disposable members; local database only.
- [Images](./images.md) covers GPT Image 2: the 이미지 tab of the model menu, the no-key state, the image composer, text→image and reference→image against the fake, and the result in the stream, in the gallery and on the dashboard. Creates generation rows, so it runs on a local database only.
- [Gallery](./gallery.md) covers the tile grid, the detail dialog (video or image) with download, and the admin scope toggle.
- [Dashboard](./dashboard.md) covers the personal usage stats, chart/empty states, and agreement with the generations API.
- [Errors](./errors.md) covers server refusals and stored failure reasons in the page language, provider text and old Korean reasons as written, and the error wire format. Creates and deletes three disposable members; local database only.
- [Formats](./formats.md) covers dates in Seoul time per language, relative times, and dollars on the dashboard, gallery, playground and admin, with no hydration warning. Local database only.
- [Screens](./screens.md) covers the gallery, the dashboard and the playground in each language: plurals, the Korean particles, the first-frame note, untranslated prompts and nicknames, the no-key banner, the admin scope links, GPT Image 2 against the fake, and no sideways scroll at 390 px. Saves the PR 3 review images. Creates and deletes two disposable members; local database only.
- [Admin](./admin.md) covers the users table and its edit, add and import modals (name, focus, Esc, scroll lock), the three model rates with their units and published-rate fill, and the logs tab.
