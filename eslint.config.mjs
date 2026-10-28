import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const SINGLE_WRITER = "generations 행은 src/lib/generations.ts만 고친다. settle, cancelGeneration 같은 소유자 함수를 부를 것.";

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
  ]),
]);

export default eslintConfig;
