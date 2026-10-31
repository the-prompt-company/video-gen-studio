import { test } from "node:test";
import assert from "node:assert/strict";
import { parseThreadRef, threadTitle, TITLE_GRAPHEMES } from "./threads";

test("a title collapses every run of whitespace to one space and trims the ends", () => {
  assert.equal(threadTitle("  비 오는 밤\n\n한강   다리\t위　"), "비 오는 밤 한강 다리 위");
});

test(`a prompt of up to ${TITLE_GRAPHEMES} characters is the whole title, and a longer one is cut there with an ellipsis`, () => {
  assert.equal(TITLE_GRAPHEMES, 30);
  const thirty = "가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노";
  assert.equal([...thirty].length, 30);
  assert.equal(threadTitle(thirty), thirty);
  assert.equal(threadTitle(`${thirty}도`), `${thirty}…`);
  const zh = "雨夜里无人机掠过汉江大桥的镜头霓虹灯倒映在湿漉漉的路面上缓缓";
  assert.equal([...zh].length, 30);
  assert.equal(threadTitle(`${zh}上升`), `${zh}…`);
  assert.equal(threadTitle("A drone shot over the Han River bridge at night"), "A drone shot over the Han Rive…");
});

test("a title is cut between graphemes, so an emoji sequence or a decomposed syllable counts once and is never split", () => {
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
  assert.equal(threadTitle(family.repeat(31)), `${family.repeat(30)}…`);
  const flag = "\u{1F1F0}\u{1F1F7}";
  assert.equal(threadTitle(flag.repeat(30)), flag.repeat(30));
  const han = "한";
  assert.equal(threadTitle(han.repeat(31)), `${han.repeat(30)}…`);
});

test("a cut that ends on a space leaves no space before the ellipsis", () => {
  assert.equal(threadTitle(`${"a".repeat(29)} bcd`), `${"a".repeat(29)}…`);
});

test("an empty or blank prompt makes an empty title, which the playground shows as no prompt", () => {
  assert.equal(threadTitle(""), "");
  assert.equal(threadTitle(" \n\t "), "");
});

test("a thread is named by `earlier` or by a uuid, and nothing else names one", () => {
  assert.deepEqual(parseThreadRef("earlier"), { kind: "earlier" });
  assert.deepEqual(parseThreadRef("5F0C3D9E-1B2A-4C3D-8E9F-0A1B2C3D4E5F"), { kind: "chat", id: "5f0c3d9e-1b2a-4c3d-8e9f-0a1b2c3d4e5f" });
  for (const raw of ["Earlier", "", "new", "5f0c3d9e-1b2a-4c3d-8e9f", "{5f0c3d9e-1b2a-4c3d-8e9f-0a1b2c3d4e5f}", " 5f0c3d9e-1b2a-4c3d-8e9f-0a1b2c3d4e5f", undefined, null, 7, {}]) {
    assert.equal(parseThreadRef(raw), null, JSON.stringify(raw));
  }
});
