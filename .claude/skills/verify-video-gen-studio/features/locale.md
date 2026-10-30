# Locale

The site reads in Korean, English, or Simplified Chinese. A first visit follows the browser language, a visitor switches on the login screen, a member switches in 설정, and a member's choice follows them to every browser. URLs never change.

## Sub-features

- `locale-detect` a browser in `ko-*`, `en-*`, or any `zh-*` (Traditional included) gets `<html lang>` `ko`, `en`, or `zh-CN` on `/login` and `/`, with the h1, tab title (`<page> · Video Gen Studio`), and pressed language button to match. Anything else gets Korean. Detection writes no cookie.
- `locale-picker` the login screen's group of three buttons (`한국어`, `English`, `简体中文`, each in its own language) re-renders the page in place, keeps typed input, presses the chosen button, and sets the `vgs_locale` cookie, which a second tab and a reload keep.
- `locale-first-sign-in` a language picked on the login screen during this visit is stored on the account at sign-in, including the forced change of a temporary password.
- `locale-settings` 설정 has a language section with the same buttons. A pick stores `users.locale` and the cookie and re-renders the header.
- `locale-follows` after sign-out the login screen keeps the member's language, and a second browser in another language shows the member's language after sign-in.
- `locale-shared-browser` signing in without a pick never stores the browser's cookie on the account, and each member sees their own stored language on a browser another member used.
- `locale-refuse` `POST /api/locale` with anything but `ko`, `en`, or `zh-CN` answers 400 and changes nothing.
- `locale-fonts` Chinese UI text renders from a Simplified Chinese font, never Malgun Gothic, Apple SD Gothic Neo, or Noto Sans KR, and no page scrolls sideways.

## How to get to it (user POV)

- Open `/login` or `/` with the browser set to a language.
- Click a language button under the login form.
- Sign in, open 설정 from the header identity link, and use the language section.
- Sign out with the header button, or sign in from another browser.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true` and the account is an admin (the journey creates its two `vgs-loc-<stamp>-*@example.test` members through the admin API and deletes them in `finally`).
- A local database: the journey writes `users.locale` on its own members only, and reads the admin's before and after.

- **Detect.** `VGS_LOCALE=<ko-KR|en-US|zh-CN> vgs run locale` opens `/login` and `/` in ko-KR, en-US, zh-CN, and zh-TW contexts (`NN-visitor-<locale>-login`, `-change`, `-landing`).
- **Pick.** On `/login` in the run's language it types the ID, picks the next language, and checks the ID, the cookie, `aria-pressed`, the tab title, a second tab, and its reload (`login-picked`).
- **First sign-in.** It signs member A in with the temporary password, changes it in the picked language (`temporary-password`), and reads `users.locale` back (`signed-in-header`).
- **설정.** It picks the third language in the language section and reads back `users.locale`, the cookie, and the header (`settings-language`), then signs out (`signed-out`).
- **Second browser.** A context in another browser language signs A in and shows A's language (`second-browser`).
- **Shared browser.** On that context, member B signs in without a pick and stores nothing, picks a language in 설정, and then A and B alternate: each sees their own language and neither stored value moves (`shared-browser`).
- **Proof.** `result.json` is `ok: true`; `log.md` notes each read-back, the font families of the Chinese h1, and the admin's unchanged `users.locale`.

## Gotchas

- The pick is remembered for sign-in only in the login page's state. A reload of that page starts a new visit: the cookie still shows the language, but sign-in no longer stores it on the account.
- `ev.t(key)` reads `<html lang>` of the page you pass, so call it after the page loaded, and pass the right page when a journey drives several.
- Server refusals (wrong password, lockout) arrive as error codes and read in the page language. See [Errors](./errors.md).
- Run one locale journey at a time per admin account; the members it creates sign in many times.
