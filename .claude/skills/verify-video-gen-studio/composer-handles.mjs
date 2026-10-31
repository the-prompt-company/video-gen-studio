const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    modeLabel: async (family, mode) => `${FAMILY_NAME[family]} · ${await t(`mode.${mode}`)}`,
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
    async pickMode(kind, mode) {
      const menu = await openMenu();
      await menu.getByRole("button", { name: new RegExp(`^${escape(await t(`playground.kind.${kind}`))} · ${escape(await t(`mode.${mode}`))}`) }).click();
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
