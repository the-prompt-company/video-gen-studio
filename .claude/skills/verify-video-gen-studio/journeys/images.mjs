/** Feature: images — GPT Image 2 in the composer, a generation and an edit against the fake, the stream, gallery and dashboard. See features/images.md. */
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composerHandles } from "../composer-handles.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(skillDir, "..", "..", "..");
const IMAGES = ["ref-landscape-1.jpg", "ref-landscape-2.jpg"].map((f) => join(webDir, "public", "mock", f));
const GPT = "openai/gpt-image-2";

export default async function images({ page, ev, env }) {
  const fake = env.VGS_FAKE_HF;
  const stamp = Date.now().toString(36);
  await ev.login("/playground");
  const h = await composerHandles(ev, page);
  const t = h.t;

  const menu = await h.openMenu();
  const outputs = menu.getByRole("group", { name: await t("playground.outputs") });
  const [imageTab, videoTab] = await Promise.all(["image", "video"].map(async (output) => outputs.getByRole("button", { name: await t("playground.output", { output }) })));
  if (!(await imageTab.count()) || !(await videoTab.count())) ev.fail("the model menu needs both tabs (playground.output) for video and image");
  if ((await imageTab.getAttribute("aria-pressed")) !== "true") await imageTab.click();
  const gpt = menu.getByRole("button", { name: /^GPT Image 2 · OpenAI/ });
  const gptText = (await gpt.innerText()).replace(/\s+/g, " ").trim();
  ev.note(`img-model-groups: image tab lists "${gptText}"`);

  if (await gpt.isDisabled()) {
    // img-no-key: the server has no OPENAI_API_KEY. The model is listed but cannot be picked, its row says why, and the server refuses.
    if (!gptText.includes(await t("playground.unavailable")) || !gptText.includes(await t("errors.noOpenAiKey"))) ev.fail(`the disabled row should say ${await t("playground.unavailable")} and name OPENAI_API_KEY: ${gptText}`);
    await ev.shot("image-no-key");
    const refused = await ev.api("/api/generations", { method: "POST", body: JSON.stringify({ family: GPT, mode: "t2i", prompt: "vgs-img 키 없음", params: {}, images: [], videos: [], endImage: null }) });
    if (refused.status !== 503 || refused.body?.error?.code !== "noOpenAiKey") ev.fail(`POST without OPENAI_API_KEY answered ${refused.status} ${JSON.stringify(refused.body?.error)}`);
    ev.note(`img-no-key: the row is disabled and names OPENAI_API_KEY, POST answered 503 ${JSON.stringify(refused.body.error)}`);
    return;
  }
  if (!fake) ev.fail("set VGS_FAKE_HF to the fake the app talks to; this journey generates images");
  if ((await gpt.getAttribute("aria-pressed")) !== "true") await gpt.click();
  else await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  await h.pickMode("text", "t2i");

  // img-composer: two modes, the aspect pills, and the three option groups in the settings.
  const modesMenu = await h.openMenu();
  const [t2iName, r2iName] = await Promise.all(["t2i", "r2i"].map((m) => t(`mode.${m}`)));
  const modeRows = (await modesMenu.getByRole("button", { name: new RegExp(`· (${t2iName}|${r2iName})`) }).allInnerTexts()).length;
  if (modeRows !== 2 || (await modesMenu.getByRole("button", { name: new RegExp(`· ${await t("mode.i2v")}`) }).count())) ev.fail("GPT Image 2 should offer text and references only");
  await page.keyboard.press("Escape");
  if ((await h.chipText()) !== `GPT Image 2 · ${t2iName}`) ev.fail(`with nothing attached the chip should read GPT Image 2 · ${t2iName}, got ${await h.chipText()}`);
  const pill = async (shape, ratio) => t("playground.aspect.pill", { shape: await t("generation.shape", { shape }), ratio });
  const settings = await h.openSettings();
  const aspect = settings.getByRole("group", { name: await t("playground.aspect.label") });
  const pills = (await aspect.getByRole("button").allInnerTexts()).map((s) => s.trim());
  const wantPills = await Promise.all([["square", "1:1"], ["landscape", "3:2"], ["portrait", "2:3"], ["landscape", "16:9"], ["portrait", "9:16"]].map(([s, r]) => pill(s, r)));
  if (pills.join(",") !== wantPills.join(",")) ev.fail(`aspect pills read ${pills.join(",")}, want ${wantPills.join(",")}`);
  for (const [key, values] of [["quality", ["low", "medium", "high"]], ["output_format", ["png", "jpeg", "webp"]], ["background", ["auto", "opaque", "transparent"]]]) {
    const want = (await Promise.all(values.map((value) => t(`paramValues.${key}`, { value })))).join(",");
    const got = (await settings.getByRole("group", { name: await t(`params.${key}`) }).getByRole("button").allInnerTexts()).map((s) => s.trim()).join(",");
    if (got !== want) ev.fail(`${key} offers ${got}, want ${want} (paramValues.${key})`);
  }
  await page.keyboard.press("Escape");
  await settings.waitFor({ state: "detached" });
  await h.box.getByRole("button", { name: await t("playground.refs.add"), exact: true }).click();
  const addMenu = page.getByRole("dialog", { name: await t("playground.refs.add") });
  await addMenu.waitFor();
  if (await addMenu.getByRole("button", { name: new RegExp(await t("playground.refs.uploadVideos")) }).count()) ev.fail("the add menu still offers videos for an image model");
  await page.keyboard.press("Escape");
  ev.note(`img-composer: modes ${t2iName} · ${r2iName}, pills ${pills.join(" · ")}`);

  const prompt = `vgs-img ${stamp} 안개 낀 새벽 등대, 35mm`;
  await h.prompt.fill(prompt);
  const shown = await h.cost();
  const note = (await h.box.getByText(await t("playground.cost.rate", { rate: "$" })).textContent())?.trim();
  if (!/^\$0\.\d{4}$/.test(shown)) ev.fail(`the estimate should show before submit, got ${shown}`);
  ev.note(`img-estimate: ${shown} (${note})`);
  await ev.shot("image-composer");

  const running = await t("playground.feed.imageNote");
  const resultName = await t("generation.image");
  const generate = async (label) => {
    const { status, body } = await h.submit();
    if (status !== 201 || body.item?.status !== "in_progress") ev.fail(`${label}: POST answered ${status} ${body?.item?.status} ${JSON.stringify(body?.error ?? "")}`);
    const item = h.turn(body.item.id);
    await item.getByText(running).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await ev.shot(`${label}-running`);
    const img = item.getByRole("img", { name: resultName });
    await img.waitFor({ timeout: 90_000 });
    await page.waitForFunction((el) => el && el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 15_000 });
    const size = await img.evaluate((el) => `${el.naturalWidth}×${el.naturalHeight}`);
    const row = (await ev.api(`/api/generations/${body.item.id}`)).body?.item;
    if (row?.status !== "completed" || !row.image) ev.fail(`${label}: the row is ${row?.status} with image ${JSON.stringify(row?.image)}`);
    return { item: body.item, estimated: body.estimatedCostUsd, row, size, turn: item };
  };

  const textToImage = await generate("image-t2i");
  if (`$${textToImage.estimated.toFixed(4)}` !== shown) ev.fail(`the composer showed ${shown} but the row was quoted $${textToImage.estimated}`);
  await ev.shot("image-t2i-done");
  const stats = async () => (await (await fetch(`${fake}/_stats`)).json()).openai.requests;
  const sentT2i = (await stats()).filter((r) => r.body.prompt === prompt);
  if (sentT2i.length !== 1 || sentT2i[0].op !== "generations" || "images" in sentT2i[0].body) ev.fail(`text→image sent ${JSON.stringify(sentT2i.map((r) => [r.op, r.status]))}`);
  const downloadName = await t("generation.download");
  const download = textToImage.turn.getByRole("link", { name: new RegExp(downloadName) });
  const href = await download.getAttribute("href");
  const counter = (await download.innerText()).includes("PNG");
  const head = await page.request.get(href);
  if (!href?.endsWith("?download=1") || !counter || !/attachment; filename=".+\.png"/.test(head.headers()["content-disposition"] ?? "")) {
    ev.fail(`download link: href ${href}, PNG label ${counter}, disposition ${head.headers()["content-disposition"]}`);
  }
  ev.note(`img-t2i: generations once, ${textToImage.size}, quoted $${textToImage.estimated}, recorded $${textToImage.row.costUsd} from usage, download ${href}`);

  const refKeys = async () => Object.keys((await (await fetch(`${fake}/_stats`)).json()).storage.byKey).filter((k) => k.startsWith("refs/"));
  const before = new Set(await refKeys());
  const serverUploads = [];
  const onUpload = (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/uploads" && serverUploads.push(r.status());
  page.on("response", onUpload);
  await h.imageInput.setInputFiles(IMAGES);
  await h.uploaded("the two references");
  page.off("response", onUpload);
  if ((await h.refs.count()) !== 2) ev.fail(`two references should be attached, found ${await h.refs.count()}`);
  const added = (await refKeys()).filter((k) => !before.has(k));
  if (added.length !== 2 || serverUploads.length !== 0) ev.fail(`both references should go browser → Blob refs/, saw ${JSON.stringify(added)} and ${serverUploads.length} server uploads`);
  ev.note(`img-refs: uploaded straight to Blob as ${added.join(", ")}; /api/uploads (the Higgsfield path) was not called`);
  if ((await h.chipText()) !== `GPT Image 2 · ${r2iName}`) ev.fail(`with two images the chip should read GPT Image 2 · ${r2iName}, got ${await h.chipText()}`);
  if (!(await h.box.getByText(await t("playground.note.switched", { mode: "r2i" })).isVisible())) ev.fail("the switch to OpenAI editing should be said (playground.note.switched)");
  await ev.shot("image-refs");
  const editSettings = await h.openSettings();
  await editSettings.getByRole("group", { name: await t("playground.aspect.label") }).getByRole("button", { name: await pill("landscape", "16:9"), exact: true }).click();
  await editSettings.getByRole("group", { name: await t("params.output_format") }).getByRole("button", { name: await t("paramValues.output_format", { value: "jpeg" }), exact: true }).click();
  await page.keyboard.press("Escape");
  const editPrompt = `vgs-img ${stamp} 두 사진의 빛으로 새벽 항구`;
  await h.prompt.fill(editPrompt);
  await ev.shot("image-edit-composer");
  const r2i = await generate("image-r2i");
  await ev.shot("image-r2i-done");
  const sentR2i = (await stats()).filter((r) => r.body.prompt === editPrompt);
  const refs = sentR2i[0]?.body.images ?? [];
  if (sentR2i.length !== 1 || sentR2i[0].op !== "edits" || refs.length !== 2 || !refs.every((i) => i.image_url.startsWith(`${fake}/blob/refs/`)) || sentR2i[0].body.size !== "1536x864") {
    ev.fail(`reference→image sent ${JSON.stringify(sentR2i.map((r) => r.body))}`);
  }
  if (r2i.row.image.format !== "jpeg" || !(await r2i.turn.getByRole("link", { name: new RegExp(downloadName) }).innerText()).includes("JPEG")) ev.fail(`the edit should be a JPEG with a JPEG download, got ${r2i.row.image.format}`);
  ev.note(`img-r2i: edits once with ${refs.length} Blob references at 1536x864, ${r2i.size}, quoted $${r2i.estimated}, recorded $${r2i.row.costUsd}`);

  await page.goto(`${page.url().split("/playground")[0]}/gallery`, { waitUntil: "networkidle" });
  const tile = page.getByRole("button", { name: await t("gallery.openDetail", { prompt }) });
  await tile.waitFor({ timeout: 10_000 });
  if ((await tile.locator("img").count()) !== 1 || (await tile.locator("video").count()) !== 0) ev.fail("the gallery tile for an image should hold an <img>, not a <video>");
  await tile.scrollIntoViewIfNeeded();
  await ev.shot("gallery-image-tile");
  await tile.click();
  const detail = page.getByRole("dialog", { name: await t("gallery.detail.title") });
  const detailImg = detail.getByRole("img", { name: resultName });
  await page.waitForFunction((el) => el && el.complete && el.naturalWidth > 0, await detailImg.elementHandle(), { timeout: 15_000 });
  if (!(await detail.getByText(await t("gallery.retention.permanent")).isVisible())) ev.fail("the image detail should say it is kept permanently (gallery.retention.permanent)");
  const detailHref = await detail.getByRole("link", { name: downloadName }).getAttribute("href");
  if (detailHref !== textToImage.row.image.downloadUrl) ev.fail(`detail download ${detailHref} differs from ${textToImage.row.image.downloadUrl}`);
  await ev.shot("gallery-image-detail");
  await page.keyboard.press("Escape");
  ev.note("img-gallery: the tile holds an <img>, the detail shows the stored image, kept permanently, and the download link");

  await page.goto(`${page.url().split("/gallery")[0]}/dashboard`, { waitUntil: "networkidle" });
  const byModel = page.getByText("GPT Image 2", { exact: true });
  if (!(await byModel.first().isVisible())) ev.fail("the dashboard's per-model card does not list GPT Image 2");
  const rowText = page.getByRole("row").filter({ hasText: prompt.slice(0, 30) });
  const line = `GPT Image 2 · ${t2iName}`;
  if (!(await rowText.getByText(line).isVisible())) ev.fail(`the recent table does not name the image row's model and mode (${line})`);
  if ((await rowText.locator("td").nth(4).textContent())?.trim() !== "—") ev.fail("an image row's length cell should read —");
  await ev.shot("dashboard-images", { fullPage: true });
  ev.note(`img-dashboard: the per-model card lists GPT Image 2; the recent row reads ${line} with length —`);
}
