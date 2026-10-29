// Prototype of the I18N-1 guard. Run from web/: npx eslint -c docs/plans/i18n/guard.eslint.mjs src
// A local rule, not a second no-restricted-syntax block: flat config replaces a rule's options per block,
// so a second block would drop the single-writer selectors in eslint.config.mjs.
import base from "../../../eslint.config.mjs";

const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
const noHangul = {
  meta: { type: "problem", messages: { hangul: "화면 문구는 src/messages/ko.json에 키로 넣고 t()로 읽는다. 한글을 코드에 직접 쓰지 않는다." } },
  create(context) {
    const check = (node, text) => typeof text === "string" && HANGUL.test(text) && context.report({ node, messageId: "hangul" });
    return {
      Literal: (node) => check(node, node.value),
      JSXText: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.raw),
    };
  },
};

export default [
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts", "src/messages/**"],
    plugins: { i18n: { rules: { "no-hangul": noHangul } } },
    rules: { "i18n/no-hangul": "error" },
  },
];
