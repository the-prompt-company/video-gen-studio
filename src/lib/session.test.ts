import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { revokedByPasswordChange, signSession, verifySessionToken } from "./session";

const USER = { id: 7, username: "kim@the-prompt.me", role: "user" as const };
const NOON = Date.UTC(2026, 9, 29, 12, 0, 0);

let savedSecret: string | undefined;
beforeEach(() => {
  savedSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "session-test-secret-0123456789abcdef";
  mock.timers.enable({ apis: ["Date"], now: NOON });
});
afterEach(() => {
  mock.timers.reset();
  if (savedSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedSecret;
});

async function signedNow() {
  const session = await verifySessionToken(await signSession(USER));
  assert.ok(session, "a freshly signed token verifies");
  return session;
}

test("the session a password change signs right after it, in the same second, stays valid", async () => {
  mock.timers.setTime(NOON + 900);
  const changedAt = new Date();
  mock.timers.setTime(NOON + 950);
  const session = await signedNow();
  assert.equal(revokedByPasswordChange(session.issuedAt, changedAt), false);
});

test("a session signed in an earlier second than the change is revoked", async () => {
  mock.timers.setTime(NOON - 1);
  const session = await signedNow();
  mock.timers.setTime(NOON + 1);
  assert.equal(revokedByPasswordChange(session.issuedAt, new Date()), true);
});

test("a session signed a day after the change stays valid", async () => {
  const changedAt = new Date();
  mock.timers.setTime(NOON + 86_400_000);
  const session = await signedNow();
  assert.equal(revokedByPasswordChange(session.issuedAt, changedAt), false);
});

test("an account whose password never changed revokes no session", async () => {
  const session = await signedNow();
  assert.equal(revokedByPasswordChange(session.issuedAt, null), false);
});
