import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noHangul from "./eslint-rules/no-hangul.mjs";

const SINGLE_WRITER = "generations 행은 src/lib/generations.ts만 고친다. settle, cancelGeneration 같은 소유자 함수를 부를 것.";
const ONE_CALL_PER_ROW = "OpenAI는 src/lib/generations.ts만 부른다. 이미지 행 하나에 호출 하나를 보장하는 claim이 거기 있다.";

// Files that still hold Korean screen text. Each i18n PR moves its surface's text into src/messages and deletes its
// files here; the last one deletes the list. Every other file under src/ fails `npm run lint` on a Hangul literal.
const I18N_PENDING = [
  // Settings, members, teams, import, model rates, logs (i18n PR 4)
  "src/app/(app)/admin/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/components/ProfileEditor.tsx",
  "src/components/admin/AdminPanels.tsx",
  "src/components/admin/LogsPanel.tsx",
  "src/components/admin/MemberImport.tsx",
  "src/components/admin/ModelsPanel.tsx",
  "src/components/admin/TeamsPanel.tsx",
  "src/components/admin/UsersPanel.tsx",
  "src/lib/member-sheet.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: ["src/lib/generations.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='update'] > MemberExpression.arguments:first-child[object.name='schema'][property.name='generations']",
          message: SINGLE_WRITER,
        },
        {
          selector: "CallExpression[callee.property.name='update'] > Identifier.arguments:first-child[name='generations']",
          message: SINGLE_WRITER,
        },
      ],
    },
  },
  {
    ignores: ["src/lib/generations.ts", "src/lib/openai.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/lib/openai", "**/lib/openai", "./openai"], message: ONE_CALL_PER_ROW }] }],
    },
  },
  // Its own rule, not another no-restricted-syntax block: a second block would replace the single-writer selectors above.
  {
    files: ["src/**/*.{ts,tsx}"],
    // ESLint 9 does not read .gitignore, and next-intl writes ko.d.json.ts into src/messages/.
    ignores: ["src/**/*.test.ts", "src/messages/**", ...I18N_PENDING],
    plugins: { i18n: { rules: { "no-hangul": noHangul } } },
    rules: { "i18n/no-hangul": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Verification harness output (verify-video-gen-studio skill): its own distDir and run evidence.
    ".next-verify/**",
    ".verify/**",
    // Local agent worktrees are full copies of the repo on other branches.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
