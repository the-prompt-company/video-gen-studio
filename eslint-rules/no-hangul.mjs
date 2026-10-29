// Screen text lives in src/messages/ko.json and reaches the UI through t(). A Hangul string, JSX text, or template
// part anywhere else under src/ is copy that English and Chinese readers would see untranslated.
const HANGUL = /[가-힣ㄱ-ㆎ]/;

const noHangul = {
  meta: {
    type: "problem",
    docs: { description: "Disallow Korean text outside src/messages; add a message key and read it with t()." },
    messages: {
      hangul: "Korean text belongs in src/messages/ko.json. Add a key there, translate it in en.json and zh-CN.json, and read it with t().",
    },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text === "string" && HANGUL.test(text)) context.report({ node, messageId: "hangul" });
    };
    return {
      Literal: (node) => check(node, node.value),
      JSXText: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.raw),
    };
  },
};

export default noHangul;
