#!/usr/bin/env node
/**
 * vgs — drive Video Gen Studio the way a user does and keep the evidence.
 *
 *   node .claude/skills/verify-video-gen-studio/vgs.mjs launch          # start a dedicated dev server (port 3100)
 *   node .claude/skills/verify-video-gen-studio/vgs.mjs doctor          # is OUR instance worth driving? (read-only)
 *   node .claude/skills/verify-video-gen-studio/vgs.mjs run <journey>   # drive one feature, write evidence
 *   node .claude/skills/verify-video-gen-studio/vgs.mjs stop            # kill only what launch started
 *
 * Journeys live in ./journeys/<name>.mjs. Evidence lands in <web>/.verify/evidence/<run-id>/<journey>/.
 * Env: VGS_PORT (3100), VGS_USER / VGS_PASS (default: ADMIN_USERNAME / ADMIN_PASSWORD from .env.local),
 *      VGS_RUN_ID (default: timestamp), VGS_MOBILE=1 (390×844 touch viewport), VGS_CHROME (chromium exe path),
 *      VGS_ALLOW_SPEND=1 (lets the playground journey actually submit a paid generation).
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";

const skillDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(skillDir, "..", "..", "..");
const verifyDir = join(webDir, ".verify");
const runDir = join(verifyDir, "run");
const evidenceRoot = join(verifyDir, "evidence");
const serverFile = join(runDir, "server.json");
const PORT = Number(process.env.VGS_PORT || 3100);
const isWin = process.platform === "win32";

function envLocal() {
  const p = join(webDir, ".env.local");
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}
function creds() {
  const e = envLocal();
  const username = process.env.VGS_USER || e.ADMIN_USERNAME;
  const password = process.env.VGS_PASS || e.ADMIN_PASSWORD;
  if (!username || !password) die("no credentials: set VGS_USER/VGS_PASS or ADMIN_USERNAME/ADMIN_PASSWORD in .env.local");
  return { username, password };
}
function die(msg, code = 1) {
  console.error("vgs: " + msg);
  process.exit(code);
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function portFree(port) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once("error", () => res(false));
    s.listen(port, "127.0.0.1", () => s.close(() => res(true)));
  });
}
function commit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: webDir, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
function nextVersion() {
  try {
    return JSON.parse(readFileSync(join(webDir, "node_modules", "next", "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}
function readServer() {
  if (!existsSync(serverFile)) return null;
  try {
    return JSON.parse(readFileSync(serverFile, "utf8"));
  } catch {
    return null;
  }
}
async function fetchJson(url, init) {
  const res = await fetch(url, { ...init, redirect: "manual" });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, headers: res.headers };
}
/** Usable = the login API accepts our credentials, which needs the DB and AUTH_SECRET too. */
async function probeLogin(base, c) {
  const r = await fetchJson(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(c),
  });
  return { ok: r.status === 200 && r.body?.ok === true, status: r.status, role: r.body?.role ?? null, error: r.body?.error ?? null };
}

async function launch() {
  mkdirSync(runDir, { recursive: true });
  const existing = readServer();
  if (existing && pidAlive(existing.pid)) {
    console.log(`already running: pid ${existing.pid} on http://localhost:${existing.port} (run doctor)`);
    return;
  }
  if (existing) rmSync(serverFile, { force: true });
  if (!(await portFree(PORT))) die(`port ${PORT} is taken by a process this skill did not start. Pick another with VGS_PORT; never drive someone else's instance.`);
  if (!existsSync(join(webDir, ".env.local"))) die(".env.local missing (DATABASE_URL, AUTH_SECRET, ADMIN_*). See README.md → 로컬 실행.");
  const c = creds();
  const log = join(runDir, `server-${PORT}.log`);
  const fd = openSync(log, "a");
  const nextBin = join(webDir, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], {
    cwd: webDir,
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    // Own distDir → own <distDir>/dev/lock, so the developer's `npm run dev` on 3000 keeps running.
    env: { ...process.env, PORT: String(PORT), BROWSER: "none", NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || ".next-verify" },
  });
  child.unref();
  const info = { pid: child.pid, port: PORT, startedAt: new Date().toISOString(), log, commit: commit(), next: nextVersion() };
  writeFileSync(serverFile, JSON.stringify(info, null, 2));
  const base = `http://localhost:${PORT}`;
  const deadline = Date.now() + 180_000;
  let last = "";
  while (Date.now() < deadline) {
    if (!pidAlive(child.pid)) die(`dev server exited early; see ${log}`);
    try {
      const r = await fetch(`${base}/login`, { redirect: "manual" });
      const html = await r.text();
      if (r.status === 200 && html.includes("로그인")) {
        const p = await probeLogin(base, c);
        if (p.ok) {
          console.log(`ready: ${base} (pid ${child.pid}, next ${info.next}, commit ${info.commit}, user ${c.username}/${p.role})`);
          return;
        }
        last = `login API ${p.status} ${p.error ?? ""}`;
        if (p.status === 401 || p.status === 403 || p.status === 423) break; // credentials problem, waiting will not help
      } else last = `GET /login ${r.status}`;
    } catch (e) {
      last = String(e.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.error(`not usable after wait: ${last}. Server left running for inspection (log: ${log}); run \`stop\` to tear it down.`);
  process.exit(1);
}

async function doctor() {
  const s = readServer();
  const out = { ok: false, ours: Boolean(s), pid: s?.pid ?? null, port: s?.port ?? null, base: s ? `http://localhost:${s.port}` : null, next: nextVersion(), commitNow: commit(), commitAtLaunch: s?.commit ?? null, log: s?.log ?? null };
  if (!s) {
    out.reason = "no server.json: nothing launched by this skill. Run `launch`.";
    return finish(out);
  }
  if (!pidAlive(s.pid)) {
    out.reason = `pid ${s.pid} is gone. Run \`stop\` to clear state, then \`launch\`.`;
    return finish(out);
  }
  try {
    const r = await fetch(`${out.base}/login`, { redirect: "manual" });
    out.loginPage = r.status;
    if (r.status !== 200) {
      out.reason = `GET /login returned ${r.status}`;
      return finish(out);
    }
    const c = creds();
    const p = await probeLogin(out.base, c);
    out.user = c.username;
    out.role = p.role;
    out.loginApi = p.status;
    if (!p.ok) {
      out.reason = `login API ${p.status}: ${p.error}`;
      return finish(out);
    }
  } catch (e) {
    out.reason = `unreachable: ${e.message ?? e}`;
    return finish(out);
  }
  if (out.commitAtLaunch && out.commitAtLaunch !== out.commitNow) out.warning = "HEAD moved since launch; next dev hot-reloads source, but restart if routes or env changed";
  out.ok = true;
  return finish(out);
  function finish(o) {
    console.log(JSON.stringify(o, null, 2));
    process.exit(o.ok ? 0 : 1);
  }
}

function stop() {
  const s = readServer();
  if (!s) {
    console.log("nothing to stop (no server.json)");
    return;
  }
  if (pidAlive(s.pid)) {
    try {
      if (isWin) execFileSync("taskkill", ["/PID", String(s.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-s.pid, "SIGTERM");
      console.log(`stopped pid ${s.pid} (port ${s.port})`);
    } catch (e) {
      // taskkill fails with "no tasks" when the process exited between the liveness check and the kill.
      if (pidAlive(s.pid)) console.error(`could not kill pid ${s.pid}: ${e.message ?? e}`);
      else console.log(`pid ${s.pid} exited on its own (port ${s.port})`);
    }
  } else console.log(`pid ${s.pid} already gone`);
  rmSync(serverFile, { force: true });
  console.log(`evidence kept in ${evidenceRoot}`);
}

async function run(name) {
  if (!name) die("usage: run <journey> — one of: " + listJourneys().join(", "));
  const file = join(skillDir, "journeys", `${name}.mjs`);
  if (!existsSync(file)) die(`unknown journey "${name}". Available: ${listJourneys().join(", ")}`);
  const s = readServer();
  if (!s || !pidAlive(s.pid)) die("no live instance of ours. Run `launch` (then `doctor`).");
  const base = `http://localhost:${s.port}`;
  const c = creds();
  const runId = process.env.VGS_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const mobile = process.env.VGS_MOBILE === "1";
  const dir = join(evidenceRoot, runId, name + (mobile ? "-mobile" : ""));
  mkdirSync(dir, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.VGS_CHROME || undefined });
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleLog = join(dir, "console.txt");
  page.on("console", (m) => appendFileSync(consoleLog, `[${m.type()}] ${m.text()}\n`));
  page.on("pageerror", (e) => appendFileSync(consoleLog, `[pageerror] ${e}\n`));
  const result = { journey: name, runId, base, mobile, user: c.username, commit: commit(), next: nextVersion(), startedAt: new Date().toISOString(), steps: [], ok: false };
  let n = 0;
  const ev = {
    dir,
    /** Screenshot + ARIA snapshot of the current state. */
    async shot(label, opts = {}) {
      const stem = `${String(++n).padStart(2, "0")}-${label}`;
      await page.screenshot({ path: join(dir, stem + ".png"), fullPage: Boolean(opts.fullPage) });
      try {
        writeFileSync(join(dir, stem + ".aria.txt"), await page.locator("body").ariaSnapshot());
      } catch (e) {
        writeFileSync(join(dir, stem + ".aria.txt"), `ariaSnapshot failed: ${e.message}`);
      }
      result.steps.push({ step: stem, url: page.url() });
      appendFileSync(join(dir, "log.md"), `- **${stem}** ${page.url()}\n`);
    },
    note(text) {
      result.steps.push({ note: text });
      appendFileSync(join(dir, "log.md"), `- ${text}\n`);
    },
    /** Fail the journey with a precise reason (unmet precondition, wrong state). */
    fail(reason) {
      throw new Error(reason);
    },
    /** Sign in through the real form; resolves on /playground. */
    async login(to = "/playground") {
      await page.goto(`${base}/login?next=${encodeURIComponent(to)}`, { waitUntil: "networkidle" });
      await page.getByLabel("ID").fill(c.username);
      await page.getByLabel("비밀번호").fill(c.password);
      await page.getByRole("button", { name: "로그인" }).click();
      await page.waitForURL(`**${to}**`, { timeout: 30_000 });
      await page.waitForLoadState("networkidle");
    },
    /** Same-origin JSON call with the page's session cookie, for side-effect checks. */
    async api(path, init) {
      return page.evaluate(
        async ([p, i]) => {
          const r = await fetch(p, { ...i, headers: { "Content-Type": "application/json", ...(i?.headers ?? {}) }, cache: "no-store" });
          return { status: r.status, body: await r.json().catch(() => null) };
        },
        [path, init ?? {}],
      );
    },
  };
  writeFileSync(join(dir, "log.md"), `# ${name} · ${runId}\n\n- base ${base} · user ${c.username} · commit ${result.commit} · ${mobile ? "mobile 390×844" : "desktop 1440×900"}\n`);
  try {
    const mod = await import(pathToFileURL(file).href);
    await mod.default({ page, context, ev, base, creds: c, env: process.env });
    result.ok = true;
  } catch (e) {
    result.error = String(e?.message ?? e);
    appendFileSync(join(dir, "log.md"), `\n**FAILED:** ${result.error}\n`);
    try {
      await page.screenshot({ path: join(dir, "99-failure.png") });
    } catch {}
  } finally {
    result.finishedAt = new Date().toISOString();
    writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
    await browser.close();
  }
  console.log(`${result.ok ? "PASS" : "FAIL"} ${name} → ${dir}${result.error ? "\n  " + result.error : ""}`);
  process.exit(result.ok ? 0 : 1);
}
function listJourneys() {
  try {
    return execFileSync(isWin ? "cmd" : "ls", isWin ? ["/c", "dir", "/b", join(skillDir, "journeys")] : [join(skillDir, "journeys")], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => f.replace(/\.mjs$/, ""));
  } catch {
    return [];
  }
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "launch":
    await launch();
    break;
  case "doctor":
    await doctor();
    break;
  case "stop":
    stop();
    break;
  case "run":
    await run(arg);
    break;
  default:
    die("usage: vgs.mjs <launch|doctor|run <journey>|stop>", 2);
}
