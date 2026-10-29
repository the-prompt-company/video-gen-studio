// Summarizes the guard prototype's ESLint JSON report by file and node type.
// Usage, from web/: npx eslint -c docs/plans/i18n/guard.eslint.mjs --format json src > guard.json; node docs/plans/i18n/guard-summary.cjs guard.json
const report = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const perFile = {};
const perNode = {};
let hits = 0;
let other = 0;
for (const file of report) {
  for (const m of file.messages) {
    if (m.ruleId !== "i18n/no-hangul") {
      other++;
      continue;
    }
    hits++;
    const name = file.filePath.replace(/\\/g, "/").replace(/.*?\/src\//, "src/");
    perFile[name] = (perFile[name] || 0) + 1;
    perNode[m.nodeType] = (perNode[m.nodeType] || 0) + 1;
  }
}
console.log(`i18n/no-hangul ${hits} hits in ${Object.keys(perFile).length} files · by node ${JSON.stringify(perNode)} · other rule messages ${other}`);
for (const [name, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`${String(n).padStart(5)}  ${name}`);
