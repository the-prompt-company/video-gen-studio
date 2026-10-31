import { test } from "node:test";
import assert from "node:assert/strict";
import type { Generation } from "@/db/schema";
import { chooseView, galleryFilters, galleryProps, type GalleryRow } from "./gallery";
import type { Viewer } from "./scope";
import type { Team, TeamId } from "./teams";

const member = (id: number) => ({ id, username: `u${id}@example.test`, nickname: null });
const red: Team = { id: 1 as TeamId, name: "레드", members: [member(1), member(2), member(3)] };
const blue: Team = { id: 2 as TeamId, name: "블루", members: [member(4)] };
const v: Record<number, Viewer> = {
  1: { id: 1, role: "user", team: red },
  2: { id: 2, role: "user", team: red },
  3: { id: 3, role: "admin", team: red },
  4: { id: 4, role: "user", team: blue },
  5: { id: 5, role: "user", team: null },
  6: { id: 6, role: "admin", team: null },
};

const gen = (userId: number) =>
  ({
    id: `6f1e2a5c-1d1b-4c55-9a59-6c3f1f1c2b1${userId}`,
    userId,
    modelId: "bytedance/seedance-2.0/text-to-video",
    prompt: `prompt ${userId}`,
    params: {},
    imageRefs: [],
    videoRefs: [],
    status: "completed",
    resultUrl: `https://cdn.invalid/${userId}.mp4`,
    storagePath: null,
    expiresAt: null,
    requestId: null,
    durationS: 5,
    costUsd: "0.5000",
    error: null,
    errorCode: null,
    errorParams: null,
    createdAt: new Date("2026-10-30T00:00:00Z"),
    completedAt: new Date("2026-10-30T00:01:00Z"),
  }) as unknown as Generation;
const rowOf = (userId: number, nickname: string | null = null): GalleryRow => ({ g: gen(userId), nickname, username: `u${userId}@example.test` });
const everyRow = [rowOf(1, "하나"), rowOf(2, "둘"), rowOf(3), rowOf(4, "넷"), rowOf(5), rowOf(6, "여섯")];

test("a member in a team is offered mine, team and all; a member without a team only mine; an admin mine and everyone, with or without a team", () => {
  for (const id of [1, 2, 4]) assert.deepEqual(galleryFilters(v[id]), ["mine", "team", "all"], `member ${id}`);
  assert.deepEqual(galleryFilters(v[5]), ["mine"]);
  assert.deepEqual(galleryFilters(v[3]), ["mine", "everyone"]);
  assert.deepEqual(galleryFilters(v[6]), ["mine", "everyone"]);
});

test("a filter that is unknown, crafted, an array or not on offer shows mine", () => {
  const cases: [Viewer, unknown][] = [
    [v[5], "team"],
    [v[5], "all"],
    [v[2], "everyone"],
    [v[2], ["team"]],
    [v[2], "Team"],
    [v[2], undefined],
    [v[3], "team"],
    [v[3], "all"],
  ];
  for (const [viewer, raw] of cases) assert.equal(chooseView(viewer, raw).filter, "mine", JSON.stringify({ viewer: viewer.id, raw }));
  assert.equal(chooseView(v[2], "team").filter, "team");
  assert.equal(chooseView(v[2], "all").filter, "all");
  assert.equal(chooseView(v[6], "everyone").filter, "everyone");
  assert.deepEqual(chooseView(v[5], "team").scope, { kind: "users", userIds: [5] }, "a crafted filter queries only the viewer's own rows");
});

test("tabs link mine to /gallery and the others to ?scope=<filter>", () => {
  assert.deepEqual(galleryProps(v[2], "mine", []).tabs, [
    { filter: "mine", href: "/gallery" },
    { filter: "team", href: "/gallery?scope=team" },
    { filter: "all", href: "/gallery?scope=all" },
  ]);
  assert.deepEqual(galleryProps(v[6], "everyone", []).tabs, [
    { filter: "mine", href: "/gallery" },
    { filter: "everyone", href: "/gallery?scope=everyone" },
  ]);
  for (const viewer of Object.values(v)) {
    for (const tab of galleryProps(viewer, "mine", []).tabs) {
      const raw = new URL(tab.href, "http://localhost").searchParams.get("scope") ?? undefined;
      assert.equal(chooseView(viewer, raw).filter, tab.filter, `viewer ${viewer.id} follows ${tab.href}`);
    }
  }
});

test("a member is never sent a login ID: the props for every filter on offer carry none", () => {
  for (const id of [1, 2, 4, 5]) {
    for (const filter of galleryFilters(v[id])) {
      const sent = JSON.stringify(galleryProps(v[id], filter, everyRow));
      assert.equal(sent.includes("example.test"), false, `member ${id} under ${filter}`);
    }
  }
  assert.equal(JSON.stringify(galleryProps(v[3], "everyone", everyRow)).includes("u1@example.test"), true, "the check sees a login ID when one is sent");
});

test("a member sees teammates by nickname, a nameless teammate as teammate, own rows as self under all and unlabelled under mine", () => {
  const owners = (filter: "mine" | "team" | "all", rows: GalleryRow[]) => galleryProps(v[2], filter, rows).items.map((i) => i.owner);
  const teamRows = [rowOf(1, "하나"), rowOf(2, "둘"), rowOf(3)];
  assert.deepEqual(owners("all", teamRows), [{ kind: "nickname", name: "하나" }, { kind: "self" }, { kind: "teammate" }]);
  assert.deepEqual(owners("team", [rowOf(1, "하나"), rowOf(3)]), [{ kind: "nickname", name: "하나" }, { kind: "teammate" }]);
  assert.deepEqual(owners("mine", [rowOf(2, "둘")]), [null]);
});

test("an admin sees the login ID on every row in every view, as today", () => {
  for (const admin of [v[3], v[6]]) {
    for (const filter of galleryFilters(admin)) {
      const owners = galleryProps(admin, filter, everyRow).items.map((i) => i.owner);
      assert.deepEqual(
        owners,
        [1, 2, 3, 4, 5, 6].map((n) => ({ kind: "login", id: `u${n}@example.test` })),
        `admin ${admin.id} under ${filter}`,
      );
    }
  }
});
