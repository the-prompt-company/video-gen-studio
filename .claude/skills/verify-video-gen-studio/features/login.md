# Login

Login lets a team member sign in with a distributed ID and password, tells them when the pair is wrong, keeps them out of app pages until they sign in, and signs them out from the header.

## Sub-features

- `login-form` renders the ID / 비밀번호 form with the wordmark and h1 로그인, and a 비밀번호 변경 button under 로그인 (see [Password](./password.md)).
- `login-wrong` shows a generic error (`ID 또는 비밀번호가 맞지 않습니다`) and stays on `/login`.
- `login-ok` signs in and lands on `/playground` (or `?next=`), header shows the username.
- `login-guard` a signed-in visit to `/login` redirects to `/playground`; a signed-out visit to a protected page redirects to `/login?next=<path>`. A session ended by a password change counts as signed out: it gets the form, not a redirect.
- `logout` the header button clears the session and returns to `/login`.

## How to get to it (user POV)

- Open `/login` directly, or any protected page while signed out (bounces there with `?next=`).
- The landing page `/` links to 로그인.
- Sign out with the 로그아웃 button in the header of any app page.

## Driving it with vgs

Preconditions:

- `vgs doctor` is `ok: true`.
- The account has fewer than 10 recent failed attempts (the recipe adds one, then resets it by succeeding).

- **Open form.** Visit `/login`. Run `vgs run login`; step `01-form` shows h1 로그인 with the ID and 비밀번호 fields.
- **Wrong password.** Submit the right ID with a wrong password. A `role=alert` reading `ID 또는 비밀번호가 맞지 않습니다` appears and the URL is still `/login` (`02-wrong-password`).
- **Sign in.** Submit the right pair. The page navigates to `/playground` and the header shows the username (`03-signed-in`).
- **Guard.** Visit `/login` again while signed in. The URL ends on `/playground` (logged as a note).
- **Log out.** Click 로그아웃. The URL becomes `/login`; a visit to `/playground` lands on `/login?next=%2Fplayground` (`04-after-logout`).
- **Proof.** `result.json` is `ok: true`; `03-signed-in.aria.txt` contains the username and the 주 메뉴 navigation.

## Gotchas

- Ten failures in a row lock the account for 15 minutes (HTTP 423, `실패가 누적되어 잠겼습니다`). Only run one login journey at a time per account; an admin can clear it with 잠금 해제 in the user's edit modal.
- The error text is deliberately the same for an unknown ID and a wrong password. Do not assert on which.
- Login performs a full page navigation, not a client transition. Wait for the URL, not for a React state.
- The button reads `확인 중…` while the request is in flight; a hang there means the database pool, not the form (see README).
