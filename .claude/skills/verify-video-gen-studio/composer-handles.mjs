const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MODES = ["t2v", "i2v", "r2v", "t2i", "r2i"];
const ROLES = ["none", "start", "end", "both"];

export const FAMILY_NAME = {
  "bytedance/seedance-2.0": "Seedance 2.0",
  "minimax/h3": "MiniMax H3",
  "openai/gpt-image-2": "GPT Image 2",
};

export async function composerHandles(ev, p) {
  const t = (key, values) => ev.t(key, values, p);
  const box = p.getByRole("region", { name: await t("playground.composer") });
  const stream = p.getByRole("region", { name: await t("playground.stream") });
  const menuName = await t("playground.modelMenu");
  const chip = box.getByRole("button", { name: new RegExp(`^${escape(menuName)} · `) });
  const uploadingText = await t("playground.uploading");
  const costLabel = await t("playground.cost.label");
  const prompt = box.getByLabel(await t("playground.prompt"));
  const generate = box.getByRole("button", { name: await t("playground.generate"), exact: true });

  const openMenu = async () => {
    await chip.click();
    const menu = p.getByRole("dialog", { name: menuName });
    await menu.waitFor();
    return menu;
  };

  /** The thumbnail button that opens an image's frame menu. Its name carries the frame the image holds now. */
  const frameNames = async (tag, name) => Promise.all(ROLES.map(async (role) => [role, await t("playground.frames.open", { tag, name, role })]));
  const frameButton = async (tag, name) => box.getByRole("button", { name: new RegExp(`^(${(await frameNames(tag, name)).map(([, n]) => escape(n)).join("|")})$`) });
  /** Files as the page sees them: a drop or a paste carries a DataTransfer built from these bytes. */
  const transfer = (files) =>
    p.evaluateHandle(
      (list) => {
        const dt = new DataTransfer();
        for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
        return dt;
      },
      files.map((f) => ({ name: f.name, type: f.mimeType, b64: f.buffer.toString("base64") })),
    );
  const modes = await Promise.all(MODES.map(async (m) => [m, await t(`mode.${m}`)]));

  return {
    t,
    box,
    stream,
    chip,
    prompt,
    generate,
    status: box.getByRole("status"),
    refs: box.getByRole("list", { name: await t("playground.refs.attached") }).getByRole("listitem"),
    imageInput: box.locator('input[type=file][accept^="image/"]'),
    videoInput: box.locator('input[type=file][accept="video/mp4"]'),
    turns: stream.locator("article[data-id]"),
    turn: (id) => stream.locator(`article[data-id="${id}"]`),
    openMenu,
    chipText: async () => (await chip.innerText()).trim(),
    /** The mode the attachments make, as the line under them names it; null with nothing attached (text). */
    async mode() {
      for (const [m, text] of modes) if (await box.getByText(text, { exact: true }).isVisible()) return m;
      return null;
    },
    frameButton,
    /** "none", "start", "end" or "both": the frame the image numbered `tag` holds, read from its thumbnail's name. */
    async frameOf(tag, name) {
      const label = await (await frameButton(tag, name)).getAttribute("aria-label");
      return (await frameNames(tag, name)).find(([, n]) => n === label)?.[0] ?? null;
    },
    /** Opens the image's frame menu and picks `role`, which marks it or, when it holds the role, takes the mark off. */
    async markFrame(tag, name, role) {
      await (await frameButton(tag, name)).click();
      const menu = p.getByRole("dialog", { name: await t("playground.frames.title", { tag }) });
      await menu.waitFor();
      await menu.getByRole("button", { name: new RegExp(`^${escape(await t("playground.frames.role", { role }))}`) }).click();
      await menu.waitFor({ state: "detached" });
    },
    /** Drags files over the composer and drops them. `hold` stops after the dragover so the drop state can be seen. */
    async dropFiles(files, { hold = false } = {}) {
      const dt = await transfer(files);
      const target = box.locator(":scope > div").first();
      await target.dispatchEvent("dragenter", { dataTransfer: dt });
      const accepted = await target.evaluate((el, d) => !el.dispatchEvent(new DragEvent("dragover", { dataTransfer: d, bubbles: true, cancelable: true })), dt);
      if (!accepted) ev.fail("the composer should accept files dragged over it (dragover default prevented)");
      const drop = () => target.dispatchEvent("drop", { dataTransfer: dt });
      if (hold) return drop;
      await drop();
    },
    /** Pastes files into the prompt, as a clipboard holding an image does. */
    async pasteFiles(files) {
      const dt = await transfer(files);
      const taken = await prompt.evaluate((el, d) => !el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })), dt);
      if (!taken) ev.fail("a paste carrying files should be taken by the composer (paste default prevented)");
    },
    async pickModel(family, output) {
      const menu = await openMenu();
      if (output) {
        const tab = menu.getByRole("group", { name: await t("playground.outputs") }).getByRole("button", { name: await t("playground.output", { output }) });
        if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
      }
      const option = menu.getByRole("button", { name: new RegExp(`^${escape(FAMILY_NAME[family])} · `) });
      if ((await option.getAttribute("aria-pressed")) === "true") await p.keyboard.press("Escape");
      else await option.click();
      await menu.waitFor({ state: "detached" });
    },
    async openSettings() {
      await box.getByRole("button", { name: new RegExp(`^${escape(await t("playground.settings.open", { summary: "" }))}`) }).click();
      const dialog = p.getByRole("dialog", { name: await t("playground.settings.title") });
      await dialog.waitFor();
      return dialog;
    },
    cost: async () => (await box.getByText(costLabel, { exact: true }).locator("xpath=following-sibling::*[1]").innerText()).trim(),
    async waitForUploads(why = "an attachment") {
      // setInputFiles returns before React renders the new attachments as uploading.
      await p.waitForTimeout(300);
      for (let i = 0; (await box.getByText(uploadingText).count()) > 0; i++) {
        if (i === 150) ev.fail(`${why}: an upload never finished`);
        await p.waitForTimeout(200);
      }
    },
    async submit(how = "click") {
      const answer = p.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/generations", { timeout: 30_000 });
      if (how === "keyboard") {
        await prompt.focus();
        await p.keyboard.press("Control+Enter");
      } else await generate.click();
      const res = await answer;
      return { status: res.status(), body: await res.json().catch(() => null) };
    },
  };
}

export function usd(n) {
  const v = Number(n ?? 0);
  return `$${v.toFixed(v >= 100 ? 0 : v >= 1 ? 2 : 4)}`;
}
