import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPasswords, signToken, verifyPassword, verifyToken } from "./crypto";

const ID = "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60";
const OTHER_ID = "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f61";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function withSecret<T>(secret: string, run: () => T): T {
  const saved = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = secret;
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  }
}

const SECRET = "crypto-test-secret-0123456789abcdef";

test("a hook token is 32 base64url chars, the same on every call, and verifies for its id", () => {
  withSecret(SECRET, () => {
    const token = signToken("hf-hook", ID);
    assert.equal(token.length, 32);
    assert.match(token, BASE64URL);
    assert.equal(signToken("hf-hook", ID), token);
    assert.equal(verifyToken("hf-hook", ID, token), true);
  });
});

test("changing any one character of the token is rejected", () => {
  withSecret(SECRET, () => {
    const token = signToken("hf-hook", ID);
    for (let i = 0; i < token.length; i++) {
      const swapped = token[i] === "A" ? "B" : "A";
      const tampered = token.slice(0, i) + swapped + token.slice(i + 1);
      assert.equal(verifyToken("hf-hook", ID, tampered), false, `position ${i}`);
    }
  });
});

test("a token is rejected for another id, cut short, extended, or empty", () => {
  withSecret(SECRET, () => {
    const token = signToken("hf-hook", ID);
    assert.equal(verifyToken("hf-hook", OTHER_ID, token), false);
    assert.equal(verifyToken("hf-hook", ID, token.slice(0, -1)), false);
    assert.equal(verifyToken("hf-hook", ID, `${token}A`), false);
    assert.equal(verifyToken("hf-hook", ID, ""), false);
  });
});

test("a token signed under one AUTH_SECRET does not verify under another", () => {
  const token = withSecret(SECRET, () => signToken("hf-hook", ID));
  withSecret(`${SECRET}-rotated`, () => assert.equal(verifyToken("hf-hook", ID, token), false));
});

test("signing without AUTH_SECRET throws instead of signing with an empty key", () => {
  withSecret("", () => assert.throws(() => signToken("hf-hook", ID), /AUTH_SECRET/));
});

test("hashPasswords gives one hash per account, each with its own salt, and each signs in with that password only", async () => {
  const hashes = await hashPasswords("oooooooo", 3);
  assert.equal(hashes.length, 3);
  assert.equal(new Set(hashes.map((h) => h.split("$")[1])).size, 3);
  for (const hash of hashes) {
    assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(verifyPassword("oooooooo", hash), true);
    assert.equal(verifyPassword("ooooooo0", hash), false);
  }
});

test("hashPasswords for no accounts hashes nothing", async () => {
  assert.deepEqual(await hashPasswords("oooooooo", 0), []);
});
