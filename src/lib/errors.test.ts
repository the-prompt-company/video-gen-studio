import { test } from "node:test";
import assert from "node:assert/strict";
import { errorResponse, HttpError } from "./auth";
import { ApiError, caught, parseAppError } from "./errors";

test("a refusal leaves the server as { error: { code, params } } and nothing else", async () => {
  const wrong = errorResponse(new HttpError(401, "wrongCredentials"));
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: { code: "wrongCredentials" } });
  const locked = errorResponse(new HttpError(423, "locked", { minutes: 15 }));
  assert.equal(locked.status, 423);
  assert.deepEqual(await locked.json(), { error: { code: "locked", params: { minutes: 15 } } });
});

test("an unexpected error answers 500 with only a reference, never its message", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const res = errorResponse(new Error('relation "users" does not exist at C:\\secret\\path'));
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: { code: string; params: { ref: string } } };
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.equal(body.error.code, "unexpected");
    assert.deepEqual(Object.keys(body.error.params), ["ref"]);
    assert.match(body.error.params.ref, /^[0-9a-f]{8}$/);
  } finally {
    console.error = quiet;
  }
});

test("the parser reads the code and keeps only text and number params", () => {
  assert.deepEqual(parseAppError({ error: { code: "locked", params: { minutes: 15 } } }, 423), { code: "locked", params: { minutes: 15 } });
  assert.deepEqual(parseAppError({ error: { code: "wrongCredentials" } }, 401), { code: "wrongCredentials" });
  assert.deepEqual(
    parseAppError({ error: { code: "nameTooLong", params: { kind: "nickname", max: 30, length: 31, nested: { x: 1 }, gone: null } } }, 400),
    { code: "nameTooLong", params: { kind: "nickname", max: 30, length: 31 } },
  );
});

test("a code this page has no message for still parses, so the page can say it does not know it", () => {
  assert.deepEqual(parseAppError({ error: { code: "fromANewerServer", params: { n: 1 } } }, 400), { code: "fromANewerServer", params: { n: 1 } });
});

test("a body without an error code reads as its HTTP status", () => {
  assert.deepEqual(parseAppError({ error: "ID 또는 비밀번호가 맞지 않습니다" }, 401), { code: "httpStatus", params: { status: 401 } }, "a string from a server before error codes");
  assert.deepEqual(parseAppError({}, 502), { code: "httpStatus", params: { status: 502 } });
  assert.deepEqual(parseAppError(null, 504), { code: "httpStatus", params: { status: 504 } }, "a proxy's HTML page, which res.json() could not read");
  assert.deepEqual(parseAppError({ error: { code: "" } }, 400), { code: "httpStatus", params: { status: 400 } });
  assert.deepEqual(parseAppError({ error: { code: 42 } }, 400), { code: "httpStatus", params: { status: 400 } });
});

test("a catch shows an ApiError's code and any other throw's own message", () => {
  assert.deepEqual(caught(new ApiError({ code: "noKey" })), { code: "noKey" });
  assert.deepEqual(caught(new Error("clip.mp4: 영상 길이를 읽지 못했습니다")), { text: "clip.mp4: 영상 길이를 읽지 못했습니다" });
  assert.deepEqual(caught("boom"), { text: "boom" });
});
