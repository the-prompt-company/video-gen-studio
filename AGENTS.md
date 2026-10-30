<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Internationalization

Every screen speaks Korean, English, and Simplified Chinese (`ko`, `en`, `zh-CN`). Korean in `src/messages/ko.json` is the source. `npm run lint` (rule `i18n/no-hangul`) and `npm run i18n:check` enforce the mechanics. These are the judgment calls they cannot make.

- Add screen text as a key in `ko.json` and write the `en.json` and `zh-CN.json` translations in the same change, with `src/messages/glossary.md` open. Keep its terms. Change a term only in the glossary first.
- Name a key for its purpose (`heading.login.title`, `changeFailed`), not for its Korean words.
- Write natural English and natural Mainland Simplified Chinese, not word-for-word renderings of the Korean.
- Never translate model names, `Higgsfield`, or user content (prompts, nicknames, IDs, team names, provider error text). Pass user content as an ICU argument.
- Use an argument for every value and `plural` for every count. After an open value, write Korean that needs no batchim-dependent particle, or use `select` for a closed set.
- A file in `I18N_PENDING` (`eslint.config.mjs`) still holds Korean. When you move its last Korean string into the messages, delete it from the list.
