# Video Gen Studio verification map

This directory is the maintained source for verifying the user-facing behavior of Video Gen Studio. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `vgs launch` from `web/`; the instance is `http://localhost:3100` (or `VGS_PORT`).
- `.env.local` points at the team Supabase project; there is no disposable database. Mutate only what a recipe restores, what is tagged `[목업]`, a `vgs-pw-*@example.test` member the password recipe creates and deletes, or the `vgs-imp-<stamp>-*@example.test` members the import recipe creates and deletes.
- Credentials are `VGS_USER`/`VGS_PASS`, defaulting to the seeded admin. Admin-only recipes say so.
- `vgs doctor` reports `ok: true` with the expected port, pid, and role before any drive.
- Never drive an instance that `vgs launch` did not start (the developer's `npm run dev` on 3000 is off limits).
- Completed generations exist for the account when a recipe needs them: `npm run db:mock` seeds `[목업]` rows; `npm run db:mock -- --clear` removes them.

## Driving conventions

- Start every recipe from a fresh browser context; `ev.login(path)` signs in through the real form.
- Prefer ARIA roles, accessible names, and labels over CSS selectors or DOM position. The handle table in `SKILL.md` lists the stable ones.
- Treat every command as literal. Keep quoted Korean names unchanged.
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
- [Password](./password.md) covers the forced change of a temporary password, the change from the login screen, other sessions ending, the shared lockout, email IDs in any case, and the admin reset. Creates and deletes one disposable member.
- [Import](./import.md) covers creating members from an `.xlsx` (header detection, the per-row preview, the 200-row cap), the nickname column and 임시 비밀번호 badge, the admin nickname edit, and 초기 비밀번호로 되돌리기. Creates and deletes 207 disposable members.
- [Playground](./playground.md) covers the drawer, model select, aspect pills, parameters, the reference dialog, and the generate gate.
- [Gallery](./gallery.md) covers the tile grid, the detail dialog with download, and the admin scope toggle.
- [Dashboard](./dashboard.md) covers the personal usage stats, chart/empty states, and agreement with the generations API.
- [Admin](./admin.md) covers the users table and edit card, the model price round-trip, and the logs tab.
