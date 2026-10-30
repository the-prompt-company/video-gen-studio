import { createRequire } from "node:module";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const INITIAL = "oooooooo";

/** A browser-made image as bytes: a noisy photo-like JPEG, or a PNG of three vertical bands (red, green, blue). */
async function makeImage(p, kind) {
  const b64 = await p.evaluate(async (kind) => {
    const c = document.createElement("canvas");
    const x = c.getContext("2d");
    let type;
    if (kind === "jpeg") {
      c.width = 3200;
      c.height = 2400;
      const img = x.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const px = (i >> 2) % c.width;
        const py = Math.floor((i >> 2) / c.width);
        const noise = (Math.imul(i >> 2, 2654435761) >>> 24) - 128;
        img.data[i] = (px / c.width) * 255 + noise / 2;
        img.data[i + 1] = (py / c.height) * 200 + noise / 2;
        img.data[i + 2] = 160 + noise / 2;
        img.data[i + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      type = "image/jpeg";
    } else {
      c.width = 1200;
      c.height = 400;
      ["#ff0000", "#00ff00", "#0000ff"].forEach((fill, i) => {
        x.fillStyle = fill;
        x.fillRect(i * 400, 0, 400, 400);
      });
      type = "image/png";
    }
    const blob = await new Promise((r) => c.toBlob(r, type, 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, kind);
  return Buffer.from(b64, "base64");
}

/** Width, height and three sampled pixels of an image, decoded by the browser from its bytes. */
async function inspectImage(p, bytes, type) {
  return p.evaluate(
    async ([b64, type]) => {
      const img = new Image();
      img.src = `data:${type};base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3));
      return { width: img.naturalWidth, height: img.naturalHeight, corner: at(4, 4), center: at(c.width >> 1, c.height >> 1), far: at(c.width - 5, c.height - 5) };
    },
    [bytes.toString("base64"), type],
  );
}

export default async function settings({ page, ev, base, webDir, local }) {
  const stamp = Date.now().toString(36);
  const memberA = `vgs-set-${stamp}-a@example.test`;
  const memberB = `vgs-set-${stamp}-b@example.test`;
  const passwords = { [memberA]: INITIAL, [memberB]: INITIAL };
  const admin = await ev.newPage();
  const second = await ev.newPage();
  const bPage = await ev.newPage();
  const postgres = createRequire(join(webDir, "package.json"))("postgres");
  // One connection, one query at a time: the transaction pooler cannot answer pipelined queries.
  const sql = postgres(local.DATABASE_URL, { prepare: false, ssl: "require", max: 1, max_pipeline: 0 });
  const row = async (username) => (await sql`select id, nickname, avatar_key from users where username = ${username}`)[0];
  let fakeStore = null;

  const signIn = async (p, id) => {
    await p.goto(`${base}/login`, { waitUntil: "networkidle" });
    await p.getByLabel("ID").fill(id);
    await p.getByLabel(await ev.t("auth.password", undefined, p)).fill(passwords[id]);
    await p.getByRole("button", { name: await ev.t("auth.signIn", undefined, p), exact: true }).click();
  };
  const signInFirstTime = async (p, id) => {
    await signIn(p, id);
    await p.getByRole("heading", { level: 1, name: await ev.t("auth.heading.temporary.title", undefined, p) }).waitFor({ timeout: 20_000 });
    const chosen = `set-${stamp}-${id === memberA ? "a" : "b"}-1`;
    await p.getByLabel(await ev.t("auth.newPassword", undefined, p)).first().fill(chosen);
    await p.getByLabel(await ev.t("auth.confirmPassword", undefined, p)).fill(chosen);
    await p.getByRole("button", { name: await ev.t("auth.changePassword", undefined, p), exact: true }).click();
    await p.waitForURL("**/playground", { timeout: 30_000 });
    await p.waitForLoadState("networkidle");
    passwords[id] = chosen;
  };
  const identity = async (p) => p.getByRole("banner").getByRole("link", { name: new RegExp(` ${await ev.t("pages.settings", undefined, p)}$`) });
  const headerShows = async (p, text, what) => {
    try {
      await (await identity(p)).getByText(text, { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      ev.fail(`${what}: the header should show "${text}", it shows "${await (await identity(p)).innerText().catch(() => "?")}"`);
    }
  };
  const headerPhoto = async (p) => {
    const img = (await identity(p)).locator("img");
    return (await img.count()) ? img.getAttribute("src") : null;
  };
  const statusSays = async (p, pattern, what) => {
    try {
      await p.getByRole("status").filter({ hasText: pattern }).first().waitFor({ timeout: 30_000 });
    } catch {
      const alerts = await p.locator("main").getByRole("alert").allTextContents();
      ev.fail(`${what}: expected a status matching ${pattern}${alerts.length ? `, alerts: ${alerts.join(" | ")}` : ""}`);
    }
  };
  const served = async (url) => (await fetch(url, { cache: "no-store" })).status;
  const storeStats = async () => (fakeStore ? (await (await fetch(`${fakeStore}/_stats`)).json()).storage : null);
  const pickPhoto = async (file) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /^사진 (고르기|바꾸기)$/ }).click()]);
    await chooser.setFiles(file);
    await page.getByRole("img", { name: "새 프로필 사진 미리보기" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "사진 저장" }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
  };
  const savePhoto = async () => {
    const [req, res] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith("/api/me/avatar") && r.method() === "PUT", { timeout: 30_000 }),
      page.waitForResponse((r) => r.url().endsWith("/api/me/avatar") && r.request().method() === "PUT", { timeout: 60_000 }),
      page.getByRole("button", { name: "사진 저장" }).click(),
    ]);
    if (res.status() !== 200) ev.fail(`PUT /api/me/avatar answered ${res.status()}: ${await res.text()}`);
    await statusSays(page, /사진을 저장했습니다/, "photo save");
    return { sentBytes: Number((await req.allHeaders())["content-length"] ?? 0), contentType: req.headers()["content-type"] };
  };
  const storedPhoto = async (what) => {
    const { avatar_key: key } = await row(memberA);
    if (!key || !new RegExp(`^avatars/${(await row(memberA)).id}/[0-9a-f]{32}\\.(webp|jpg|png)$`).test(key)) ev.fail(`${what}: users.avatar_key should be avatars/<id>/<hex>.<ext>, got ${key}`);
    try {
      await (await identity(page)).locator(`img[src$="/${key}"]`).waitFor({ timeout: 20_000 });
    } catch {
      ev.fail(`${what}: the header photo ${await headerPhoto(page)} should become the stored key ${key} without a reload`);
    }
    const src = await headerPhoto(page);
    const res = await fetch(src, { cache: "no-store" });
    if (res.status !== 200) ev.fail(`${what}: the stored photo answered ${res.status}`);
    const type = res.headers.get("content-type");
    const bytes = Buffer.from(await res.arrayBuffer());
    const seen = await inspectImage(page, bytes, type);
    if (seen.width !== 256 || seen.height !== 256) ev.fail(`${what}: the stored photo is ${seen.width}×${seen.height}, not 256×256`);
    if (bytes.length > 100 * 1024) ev.fail(`${what}: the stored photo is ${bytes.length} bytes`);
    return { key, url: src, type, bytes: bytes.length, ...seen };
  };

  try {
    const stranger = await ev.newPage();
    await stranger.goto(`${base}/settings`, { waitUntil: "networkidle" });
    if (!/\/login\?next=%2Fsettings$/.test(stranger.url())) ev.fail(`/settings without a session should go to /login?next=%2Fsettings, got ${stranger.url()}`);
    ev.note("/settings without a session redirects to /login?next=%2Fsettings");

    await ev.login("/admin", admin);
    if (!(await admin.locator("header").getByText("ADMIN", { exact: true }).isVisible())) ev.fail("run with an admin's VGS_USER/VGS_PASS: the journey creates its members through the admin API");
    for (const id of [memberA, memberB]) {
      const made = await ev.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: id, password: INITIAL }) }, admin);
      if (made.status !== 201) ev.fail(`creating ${id} answered ${made.status}: ${JSON.stringify(made.body)}`);
    }
    ev.note(`admin API created ${memberA} and ${memberB} with the temporary password`);

    await signInFirstTime(page, memberA);
    await headerShows(page, memberA, "a member without a nickname");
    if (await headerPhoto(page)) ev.fail("a member without a photo should get the letter fallback, not an <img>");
    await ev.shot("nav-id-and-letter");
    await (await identity(page)).click();
    await page.waitForURL("**/settings", { timeout: 30_000 });
    await page.getByRole("heading", { level: 1, name: "설정" }).waitFor({ timeout: 30_000 });
    if ((await (await identity(page)).getAttribute("aria-current")) !== "page") ev.fail("the identity link should be the current page on /settings");
    const account = page.getByRole("region", { name: "계정" });
    const shownId = (await account.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^ID$/ }) }).locator("dd").innerText()).trim();
    if (shownId !== memberA) ev.fail(`계정 should show the ID, got "${shownId}"`);
    const shownTeam = (await account.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^팀$/ }) }).locator("dd").innerText()).trim();
    if (shownTeam !== "미소속") ev.fail(`계정 should show 미소속 for a member without a team, got "${shownTeam}"`);
    if (await account.getByRole("textbox").count()) ev.fail("계정 should show the ID as text, not as a field");
    if (await page.getByRole("region", { name: "비밀번호" }).getByRole("textbox", { name: "ID" }).count()) ev.fail("the password form should not repeat the ID visibly");
    ev.note("the nav links the member's ID to /settings, which shows the ID once, as text, and 미소속 as the team");
    await ev.shot("settings");

    const storageOff = await page.getByRole("status").filter({ hasText: "사진 저장소" }).isVisible();
    if (storageOff) {
      if (await page.getByRole("button", { name: "사진 고르기" }).isEnabled()) ev.fail("without a Blob store 사진 고르기 should be disabled");
      const put = await page.evaluate(async () => (await fetch("/api/me/avatar", { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })).status);
      const del = (await ev.api("/api/me/avatar", { method: "DELETE" })).status;
      if (put !== 503 || del !== 503) ev.fail(`without a Blob store PUT and DELETE should answer 503, got ${put} and ${del}`);
      ev.note("storage off: the photo controls are disabled with an explanation, PUT and DELETE /api/me/avatar answer 503; photo steps skipped");
      await ev.shot("photo-storage-off");
    } else {
      const large = await makeImage(page, "jpeg");
      const largeFile = join(ev.dir, "large-photo.jpg");
      writeFileSync(largeFile, large);
      await pickPhoto(largeFile);
      await ev.shot("photo-preview-large-jpeg");
      const sent = await savePhoto();
      const first = await storedPhoto("large JPEG");
      try {
        fakeStore = (await fetch(`${new URL(first.url).origin}/_stats`)).ok ? new URL(first.url).origin : null;
      } catch {
        fakeStore = null;
      }
      ev.note(`large JPEG ${large.length} bytes picked; the browser sent ${sent.sentBytes} bytes as ${sent.contentType}; stored ${first.key} ${first.width}×${first.height} ${first.type} ${first.bytes} bytes`);
      if (!(sent.sentBytes > 0 && sent.sentBytes === first.bytes && sent.sentBytes * 20 < large.length)) ev.fail(`the request should carry the stored square alone, not the original: sent ${sent.sentBytes}, stored ${first.bytes}`);
      await ev.shot("photo-saved-large-jpeg", { fullPage: true });

      const png = await makeImage(page, "png");
      const pngFile = join(ev.dir, "bands.png");
      writeFileSync(pngFile, png);
      await pickPhoto(pngFile);
      await ev.shot("photo-preview-png");
      await savePhoto();
      const replaced = await storedPhoto("PNG");
      if (replaced.key === first.key) ev.fail("a replaced photo should get a new key");
      const green = ([r, g, b]) => g > 200 && r < 60 && b < 60;
      if (![replaced.corner, replaced.center, replaced.far].every(green)) ev.fail(`the PNG's center square is the green band, sampled ${JSON.stringify(replaced)}`);
      const oldStatus = await served(first.url);
      if (oldStatus !== 404) ev.fail(`the replaced photo should be deleted, ${first.url} answered ${oldStatus}`);
      const afterReplace = await storeStats();
      if (afterReplace && !afterReplace.deleteUrls.includes(first.url)) ev.fail("del() should have received the old photo's canonical URL");
      ev.note(`PNG ${png.length} bytes (1200×400 red|green|blue) stored as ${replaced.key} ${replaced.width}×${replaced.height} ${replaced.bytes} bytes, all green (center crop); the old object answers ${oldStatus}${afterReplace ? " and del() got its canonical URL" : ""}`);
      await ev.shot("photo-replaced-png");

      await page.getByRole("button", { name: "사진 삭제" }).click();
      await statusSays(page, /사진을 지웠습니다/, "photo removal");
      if ((await row(memberA)).avatar_key !== null) ev.fail("removing the photo should clear users.avatar_key");
      try {
        await (await identity(page)).locator("img").waitFor({ state: "detached", timeout: 20_000 });
      } catch {
        ev.fail("after removal the header should show the letter fallback without a reload");
      }
      const removedStatus = await served(replaced.url);
      if (removedStatus !== 404) ev.fail(`the removed photo should be deleted, it answered ${removedStatus}`);
      ev.note(`removed: users.avatar_key is null, ${replaced.url} answers ${removedStatus}, the header shows the letter again`);
      await ev.shot("photo-removed");
    }

    const nickname = page.getByLabel(/^닉네임/);
    const saveNickname = page.getByRole("button", { name: "닉네임 저장" });
    await nickname.fill("가".repeat(31));
    await saveNickname.click();
    await page.locator("main").getByRole("alert").filter({ hasText: /30자/ }).waitFor({ timeout: 10_000 });
    const control = await ev.api("/api/me", { method: "PATCH", body: JSON.stringify({ nickname: "설정\n테스터" }) });
    const long = await ev.api("/api/me", { method: "PATCH", body: JSON.stringify({ nickname: "a".repeat(31) }) });
    if (control.status !== 400 || long.status !== 400) ev.fail(`the server should refuse a line break and 31 characters, got ${control.status} and ${long.status}`);
    ev.note(`31 characters: the form says ${await page.locator("main").getByRole("alert").first().innerText()}; the server answers 400 to a line break and to 31 characters`);
    await ev.shot("nickname-too-long");

    await nickname.fill("  설정 테스터 ");
    await saveNickname.click();
    await statusSays(page, /닉네임을 저장했습니다/, "nickname save");
    await headerShows(page, "설정 테스터", "after the nickname save, without a reload");
    if ((await row(memberA)).nickname !== "설정 테스터") ev.fail("users.nickname should be the trimmed nickname");
    await ev.shot("nickname-saved", { fullPage: true });
    await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    await headerShows(page, "설정 테스터", "on another page");
    ev.note("nickname saved trimmed; the header switched without a reload and keeps it on /dashboard");
    await ev.shot("nickname-on-dashboard");

    await (await identity(page)).click();
    await page.waitForURL("**/settings", { timeout: 30_000 });
    await nickname.fill("");
    await saveNickname.click();
    await statusSays(page, /닉네임을 지웠습니다/, "nickname clear");
    await headerShows(page, memberA, "after clearing the nickname");
    if ((await row(memberA)).nickname !== null) ev.fail("clearing should store null");
    ev.note("an empty nickname clears it and the header falls back to the ID");
    await ev.shot("nickname-cleared");

    if (!storageOff) {
      await signInFirstTime(bPage, memberB);
      const bPut = await bPage.evaluate(async () => {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const x = c.getContext("2d");
        x.fillStyle = "#3355ff";
        x.fillRect(0, 0, 256, 256);
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        const res = await fetch("/api/me/avatar", { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
        return { status: res.status, body: await res.json() };
      });
      if (bPut.status !== 200) ev.fail(`member B's photo upload answered ${bPut.status}`);
      const bKey = (await row(memberB)).avatar_key;
      const bUrl = bPut.body.avatarUrl;
      const aId = (await row(memberA)).id;

      const crafted = [
        await ev.api(`/api/me/avatar?key=${encodeURIComponent(bKey)}&url=${encodeURIComponent(bUrl)}`, { method: "DELETE", body: JSON.stringify({ key: bKey, avatarKey: bKey, url: bUrl }) }),
        await ev.api("/api/me", { method: "PATCH", body: JSON.stringify({ nickname: null, avatarKey: bKey, avatar_key: bKey }) }),
      ];
      if ((await row(memberA)).avatar_key !== null) ev.fail("a PATCH must not set avatar_key from the body");
      const refusals = await page.evaluate(async () => {
        const put = async (body, type) => (await fetch("/api/me/avatar", { method: "PUT", headers: { "Content-Type": type }, body })).status;
        const big = new Uint8Array(600 * 1024);
        big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        return {
          htmlAsPng: await put(new TextEncoder().encode("<!doctype html><script>alert(1)</script>"), "image/png"),
          svg: await put('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml"),
          jpegAsPng: await put(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), "image/png"),
          over512KB: await put(big, "image/png"),
        };
      });
      const expected = { htmlAsPng: 415, svg: 415, jpegAsPng: 415, over512KB: 413 };
      if (JSON.stringify(refusals) !== JSON.stringify(expected)) ev.fail(`PUT refusals should be ${JSON.stringify(expected)}, got ${JSON.stringify(refusals)}`);
      if ((await row(memberA)).avatar_key !== null) ev.fail("a refused upload must not set avatar_key");
      ev.note(`PUT /api/me/avatar refuses by magic bytes and size: ${JSON.stringify(refusals)}; avatar_key stays null`);
      await sql`update users set avatar_key = ${bKey} where id = ${aId} and username like 'vgs-set-%'`;
      const tamperedDelete = await ev.api("/api/me/avatar", { method: "DELETE" });
      const afterDelete = (await row(memberA)).avatar_key;
      await sql`update users set avatar_key = ${bKey} where id = ${aId} and username like 'vgs-set-%'`;
      const tamperedPut = await page.evaluate(async () => {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        c.getContext("2d").fillRect(0, 0, 256, 256);
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        return (await fetch("/api/me/avatar", { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob })).status;
      });
      const aKeyAfterPut = (await row(memberA)).avatar_key;
      const bStatus = await served(bUrl);
      const stats = await storeStats();
      if (bStatus !== 200) ev.fail(`member B's photo should survive member A's crafted requests, it answered ${bStatus}`);
      if ((await row(memberB)).avatar_key !== bKey) ev.fail("member B's row should still name its photo");
      if (stats && stats.deleted.includes(bKey)) ev.fail("del() was asked for member B's photo");
      if (tamperedDelete.status !== 200 || afterDelete !== null) ev.fail(`A's DELETE with A's row naming B's photo should clear A's row only, got ${tamperedDelete.status} and ${afterDelete}`);
      if (tamperedPut !== 200 || !aKeyAfterPut?.startsWith(`avatars/${aId}/`)) ev.fail(`A's PUT should store A's own photo, got ${tamperedPut} and ${aKeyAfterPut}`);
      ev.note(
        `crafted: DELETE with B's key in query and body → ${crafted[0].status}, PATCH with avatarKey → ${crafted[1].status}; A's row set to B's key then DELETE → ${tamperedDelete.status} (A's row cleared), then PUT → ${tamperedPut} (A's row ${aKeyAfterPut}); B's photo ${bKey} still answers ${bStatus}${stats ? ", and del() never received it" : ""}`,
      );
      await bPage.goto(`${base}/settings`, { waitUntil: "networkidle" });
      await ev.shot("member-b-photo-kept", { page: bPage });
      await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "사진 삭제" }).click();
      await statusSays(page, /사진을 지웠습니다/, "removing A's own photo after the crafted requests");
    }

    await signIn(second, memberA);
    await second.waitForURL("**/playground", { timeout: 30_000 });
    await second.waitForLoadState("networkidle");
    await headerShows(second, memberA, "the second browser");
    await new Promise((r) => setTimeout(r, 1_100));
    const password = page.getByRole("region", { name: "비밀번호" });
    const next = `set-${stamp}-a-2`;
    await password.getByLabel(await ev.t("auth.currentPassword")).fill(passwords[memberA]);
    await password.getByLabel(await ev.t("auth.newPassword")).first().fill(next);
    await password.getByLabel(await ev.t("auth.confirmPassword")).fill(next);
    await password.getByRole("button", { name: await ev.t("auth.changePassword"), exact: true }).click();
    await statusSays(page, await ev.t("auth.changed"), "password change from settings");
    passwords[memberA] = next;
    if (!page.url().endsWith("/settings")) ev.fail(`the change should stay on /settings, got ${page.url()}`);
    await ev.shot("password-changed");
    await page.reload({ waitUntil: "networkidle" });
    if (!page.url().endsWith("/settings")) ev.fail(`this browser should stay signed in, a reload went to ${page.url()}`);
    await headerShows(page, memberA, "this browser after the change");
    await second.goto(`${base}/settings`, { waitUntil: "networkidle" });
    if (new URL(second.url()).pathname !== "/login") ev.fail(`the second browser should be signed out, /settings went to ${second.url()}`);
    if (!(await second.getByRole("heading", { level: 1, name: await ev.t("auth.heading.login.title", undefined, second) }).isVisible())) ev.fail("the second browser should see the login form");
    ev.note("the password change kept this browser on /settings and sent the second browser's /settings to the login form");
    await ev.shot("second-browser-signed-out", { page: second });
  } finally {
    try {
      for (const id of [memberA, memberB]) {
        const r = await row(id);
        if (!r?.avatar_key) continue;
        const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: id, password: passwords[id] }) });
        const cookie = login.headers.get("set-cookie")?.split(";")[0];
        const del = cookie ? await fetch(`${base}/api/me/avatar`, { method: "DELETE", headers: { cookie } }) : null;
        ev.note(`cleanup: ${id}'s photo DELETE → ${del?.status ?? `no session (login ${login.status})`}`);
      }
      if (fakeStore) {
        const ids = (await sql`select id from users where username in (${memberA}, ${memberB})`).map((r) => r.id);
        const stats = await storeStats();
        const left = Object.keys(stats.byKey).filter((k) => ids.some((id) => k.startsWith(`avatars/${id}/`)) && !stats.deleted.includes(k));
        ev.note(`cleanup: ${left.length} photo object(s) of this run left in the store${left.length ? `: ${left.join(", ")}` : ""}`);
      }
      const gone = await sql`delete from users where username in (${memberA}, ${memberB}) and username like 'vgs-set-%' returning id`;
      ev.note(`cleanup: deleted ${gone.length} member row(s)`);
    } finally {
      await sql.end();
    }
  }
}
