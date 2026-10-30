/** Feature: images — GPT Image 2 in the drawer, a generation and an edit against the fake, the stage, gallery and dashboard. See features/images.md. */
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(skillDir, "..", "..", "..");
const IMAGES = ["ref-landscape-1.jpg", "ref-landscape-2.jpg"].map((f) => join(webDir, "public", "mock", f));
const GPT = "openai/gpt-image-2";

export default async function images({ page, ev, env }) {
  const fake = env.VGS_FAKE_HF;
  const stamp = Date.now().toString(36);
  await ev.login("/playground");
  const drawer = page.getByRole("complementary", { name: await ev.t("playground.drawer") });
  const stage = page.getByRole("region", { name: await ev.t("playground.stage") });
  const model = drawer.getByLabel(await ev.t("playground.model"));
  const groups = await model.locator("optgroup").evaluateAll((gs) =>
    gs.map((g) => ({ label: g.label, options: [...g.querySelectorAll("option")].map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled })) })),
  );
  ev.note(`img-model-groups: ${JSON.stringify(groups)}`);
  const [imageGroup, videoGroup] = await Promise.all(["image", "video"].map((output) => ev.t("playground.output", { output })));
  const gpt = groups.find((g) => g.label === imageGroup)?.options.find((o) => o.value === GPT);
  if (!gpt) ev.fail(`the model select has no ${imageGroup} group (playground.output) holding GPT Image 2`);
  if (!groups.find((g) => g.label === videoGroup)?.options.length) ev.fail(`the ${videoGroup} group (playground.output) is missing`);

  if (gpt.disabled) {
    // img-no-key: the server has no OPENAI_API_KEY. The option is listed but cannot be picked, a status line says why, and the server refuses.
    const note = drawer.getByRole("status").filter({ hasText: await ev.t("errors.noOpenAiKey") });
    if (!(await note.isVisible())) ev.fail("GPT Image 2 is disabled but no status line says why (errors.noOpenAiKey)");
    const unavailable = await ev.t("playground.unavailable");
    if (!gpt.text.includes(unavailable)) ev.fail(`the disabled option should say ${unavailable} (playground.unavailable): ${gpt.text}`);
    await ev.shot("image-no-key");
    const refused = await ev.api("/api/generations", { method: "POST", body: JSON.stringify({ family: GPT, mode: "t2i", prompt: "vgs-img 키 없음", params: {}, images: [], videos: [], startFromImage: false }) });
    if (refused.status !== 503 || refused.body?.error?.code !== "noOpenAiKey") ev.fail(`POST without OPENAI_API_KEY answered ${refused.status} ${JSON.stringify(refused.body?.error)}`);
    ev.note(`img-no-key: option "${gpt.text}" disabled, status line names OPENAI_API_KEY, POST answered 503 ${JSON.stringify(refused.body.error)}`);
    return;
  }
  if (!fake) ev.fail("set VGS_FAKE_HF to the fake the app talks to; this journey generates images");

  await model.selectOption(GPT);
  const modes = drawer.getByRole("list", { name: await ev.t("playground.modes") });
  const modeTexts = (await modes.locator("li").allTextContents()).map((t) => t.trim());
  const [t2i, r2iName] = await Promise.all(["t2i", "r2i"].map((m) => ev.t(`mode.${m}`)));
  if (modeTexts.join(",") !== `${t2i},${r2iName}`) ev.fail(`image modes read ${modeTexts.join(",")}`);
  const current = async () => (await modes.locator('[aria-current="step"]').textContent())?.trim();
  if ((await current()) !== t2i) ev.fail(`with nothing attached the mode should be ${t2i} (mode.t2i), got ${await current()}`);
  const pill = async (shape, ratio) => ev.t("playground.aspect.pill", { shape: await ev.t("generation.shape", { shape }), ratio });
  const aspect = drawer.getByRole("group", { name: await ev.t("playground.aspect.label") });
  const pills = (await aspect.getByRole("button").allTextContents()).map((t) => t.trim());
  const wantPills = await Promise.all([["square", "1:1"], ["landscape", "3:2"], ["portrait", "2:3"], ["landscape", "16:9"], ["portrait", "9:16"]].map(([s, r]) => pill(s, r)));
  if (pills.join(",") !== wantPills.join(",")) ev.fail(`aspect pills read ${pills.join(",")}, want ${wantPills.join(",")}`);
  for (const [key, values] of [["quality", ["low", "medium", "high"]], ["output_format", ["png", "jpeg", "webp"]], ["background", ["auto", "opaque", "transparent"]]]) {
    const want = (await Promise.all(values.map((value) => ev.t(`paramValues.${key}`, { value })))).join(",");
    const got = (await drawer.getByLabel(await ev.t(`params.${key}`)).locator("option").allTextContents()).join(",");
    if (got !== want) ev.fail(`${key} offers ${got}, want ${want} (paramValues.${key})`);
  }
  if (await drawer.getByText(await ev.t("playground.refs.videoCount", { count: "0", max: "0" })).count()) ev.fail("the reference counter still counts videos for an image model");
  ev.note(`img-drawer: modes ${modeTexts.join(" · ")}, pills ${pills.join(" · ")}`);

  const promptBox = drawer.getByLabel(await ev.t("playground.prompt"));
  const prompt = `vgs-img ${stamp} 안개 낀 새벽 등대, 35mm`;
  await promptBox.fill(prompt);
  const costBar = drawer.locator(".font-display.text-2xl");
  const shown = (await costBar.textContent())?.trim();
  const note = (await drawer.getByText(await ev.t("playground.cost.rate", { rate: "$" })).textContent())?.trim();
  if (!/^\$0\.\d{4}$/.test(shown ?? "")) ev.fail(`the estimate should show before submit, got ${shown}`);
  ev.note(`img-estimate: ${shown} (${note})`);
  await ev.shot("image-drawer");

  const generateButton = drawer.getByRole("button", { name: await ev.t("playground.generate"), exact: true });
  const running = await ev.t("playground.feed.imageNote");
  const resultName = await ev.t("generation.image");
  const generate = async (label) => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/generations" && r.request().method() === "POST"),
      generateButton.click(),
    ]);
    const body = await res.json();
    if (res.status() !== 201 || body.item?.status !== "in_progress") ev.fail(`${label}: POST answered ${res.status()} ${body.item?.status} ${JSON.stringify(body.error ?? "")}`);
    const item = stage.locator(`article[data-id="${body.item.id}"]`);
    await item.getByText(running).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await ev.shot(`${label}-running`);
    const img = item.getByRole("img", { name: resultName });
    await img.waitFor({ timeout: 90_000 });
    await page.waitForFunction((el) => el && el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 15_000 });
    const size = await img.evaluate((el) => `${el.naturalWidth}×${el.naturalHeight}`);
    const row = (await ev.api(`/api/generations/${body.item.id}`)).body?.item;
    if (row?.status !== "completed" || !row.image) ev.fail(`${label}: the row is ${row?.status} with image ${JSON.stringify(row?.image)}`);
    return { item: body.item, estimated: body.estimatedCostUsd, row, size };
  };

  const textToImage = await generate("image-t2i");
  if (`$${textToImage.estimated.toFixed(4)}` !== shown) ev.fail(`the drawer showed ${shown} but the row was quoted $${textToImage.estimated}`);
  await ev.shot("image-t2i-done");
  const stats = async () => (await (await fetch(`${fake}/_stats`)).json()).openai.requests;
  const sentT2i = (await stats()).filter((r) => r.body.prompt === prompt);
  if (sentT2i.length !== 1 || sentT2i[0].op !== "generations" || "images" in sentT2i[0].body) ev.fail(`text→image sent ${JSON.stringify(sentT2i.map((r) => [r.op, r.status]))}`);
  const downloadName = await ev.t("generation.download");
  const download = stage.getByRole("link", { name: downloadName });
  const href = await download.getAttribute("href");
  const counter = (await page.getByText("PNG", { exact: true }).count()) > 0;
  const head = await page.request.get(href);
  if (!href?.endsWith("?download=1") || !counter || !/attachment; filename=".+\.png"/.test(head.headers()["content-disposition"] ?? "")) {
    ev.fail(`download glyph: href ${href}, PNG counter ${counter}, disposition ${head.headers()["content-disposition"]}`);
  }
  ev.note(`img-t2i: generations once, ${textToImage.size}, quoted $${textToImage.estimated}, recorded $${textToImage.row.costUsd} from usage, download ${href}`);

  const addRefs = await ev.t("playground.refs.add");
  await drawer.getByRole("button", { name: addRefs, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: addRefs });
  await dialog.waitFor();
  if (!(await dialog.getByText(await ev.t("playground.drop.off", { kind: "video" })).isVisible())) ev.fail("the video drop zone should be off for an image model (playground.drop.off)");
  const refKeys = async () => Object.keys((await (await fetch(`${fake}/_stats`)).json()).storage.byKey).filter((k) => k.startsWith("refs/"));
  const before = new Set(await refKeys());
  const serverUploads = [];
  const onUpload = (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/uploads" && serverUploads.push(r.status());
  page.on("response", onUpload);
  await dialog.getByLabel(await ev.t("playground.drop.add", { kind: "image" })).setInputFiles(IMAGES);
  await dialog.getByRole("list", { name: await ev.t("playground.refs.attached") }).locator("li").nth(1).waitFor({ timeout: 30_000 });
  page.off("response", onUpload);
  const added = (await refKeys()).filter((k) => !before.has(k));
  if (added.length !== 2 || serverUploads.length !== 0) ev.fail(`both references should go browser → Blob refs/, saw ${JSON.stringify(added)} and ${serverUploads.length} server uploads`);
  ev.note(`img-refs: uploaded straight to Blob as ${added.join(", ")}; /api/uploads (the Higgsfield path) was not called`);
  await ev.shot("image-refs-dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if ((await current()) !== r2iName) ev.fail(`with two images the mode should be ${r2iName} (mode.r2i), got ${await current()}`);
  if (!(await drawer.getByText(await ev.t("playground.modeSentence.edit", { images: 2 })).isVisible())) ev.fail("the mode sentence does not explain the edit (playground.modeSentence.edit)");
  await aspect.getByRole("button", { name: await pill("landscape", "16:9"), exact: true }).click();
  await drawer.getByLabel(await ev.t("params.output_format")).selectOption("jpeg");
  const editPrompt = `vgs-img ${stamp} 두 사진의 빛으로 새벽 항구`;
  await promptBox.fill(editPrompt);
  await ev.shot("image-edit-drawer");
  const r2i = await generate("image-r2i");
  await ev.shot("image-r2i-done");
  const sentR2i = (await stats()).filter((r) => r.body.prompt === editPrompt);
  const refs = sentR2i[0]?.body.images ?? [];
  if (sentR2i.length !== 1 || sentR2i[0].op !== "edits" || refs.length !== 2 || !refs.every((i) => i.image_url.startsWith(`${fake}/blob/refs/`)) || sentR2i[0].body.size !== "1536x864") {
    ev.fail(`reference→image sent ${JSON.stringify(sentR2i.map((r) => r.body))}`);
  }
  if (r2i.row.image.format !== "jpeg" || (await page.getByText("JPEG", { exact: true }).count()) === 0) ev.fail(`the edit should be a JPEG with a JPEG download counter, got ${r2i.row.image.format}`);
  ev.note(`img-r2i: edits once with ${refs.length} Blob references at 1536x864, ${r2i.size}, quoted $${r2i.estimated}, recorded $${r2i.row.costUsd}`);

  await page.goto(`${page.url().split("/playground")[0]}/gallery`, { waitUntil: "networkidle" });
  const tile = page.getByRole("button", { name: await ev.t("gallery.openDetail", { prompt }) });
  await tile.waitFor({ timeout: 10_000 });
  if ((await tile.locator("img").count()) !== 1 || (await tile.locator("video").count()) !== 0) ev.fail("the gallery tile for an image should hold an <img>, not a <video>");
  await tile.scrollIntoViewIfNeeded();
  await ev.shot("gallery-image-tile");
  await tile.click();
  const detail = page.getByRole("dialog", { name: await ev.t("gallery.detail.title") });
  const detailImg = detail.getByRole("img", { name: resultName });
  await page.waitForFunction((el) => el && el.complete && el.naturalWidth > 0, await detailImg.elementHandle(), { timeout: 15_000 });
  if (!(await detail.getByText(await ev.t("gallery.retention.permanent")).isVisible())) ev.fail("the image detail should say it is kept permanently (gallery.retention.permanent)");
  const detailHref = await detail.getByRole("link", { name: downloadName }).getAttribute("href");
  if (detailHref !== textToImage.row.image.downloadUrl) ev.fail(`detail download ${detailHref} differs from ${textToImage.row.image.downloadUrl}`);
  await ev.shot("gallery-image-detail");
  await page.keyboard.press("Escape");
  ev.note("img-gallery: the tile holds an <img>, the detail shows the stored image, kept permanently, and the download link");

  await page.goto(`${page.url().split("/gallery")[0]}/dashboard`, { waitUntil: "networkidle" });
  const byModel = page.getByText("GPT Image 2", { exact: true });
  if (!(await byModel.first().isVisible())) ev.fail("the dashboard's per-model card does not list GPT Image 2");
  const rowText = page.getByRole("row").filter({ hasText: prompt.slice(0, 30) });
  const line = `GPT Image 2 · ${t2i}`;
  if (!(await rowText.getByText(line).isVisible())) ev.fail(`the recent table does not name the image row's model and mode (${line})`);
  if ((await rowText.locator("td").nth(4).textContent())?.trim() !== "—") ev.fail("an image row's length cell should read —");
  await ev.shot("dashboard-images", { fullPage: true });
  ev.note(`img-dashboard: the per-model card lists GPT Image 2; the recent row reads ${line} with length —`);
}
