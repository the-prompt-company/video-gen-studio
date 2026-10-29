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
  const drawer = page.getByRole("complementary", { name: "생성 설정" });
  const model = page.getByLabel("모델");
  const groups = await model.locator("optgroup").evaluateAll((gs) =>
    gs.map((g) => ({ label: g.label, options: [...g.querySelectorAll("option")].map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled })) })),
  );
  ev.note(`img-model-groups: ${JSON.stringify(groups)}`);
  const gpt = groups.find((g) => g.label === "이미지")?.options.find((o) => o.value === GPT);
  if (!gpt) ev.fail("the 모델 select has no 이미지 group holding GPT Image 2");
  if (!groups.find((g) => g.label === "영상")?.options.length) ev.fail("the 영상 group is missing");

  if (gpt.disabled) {
    // img-no-key: the server has no OPENAI_API_KEY. The option is listed but cannot be picked, a status line says why, and the server refuses.
    const note = drawer.getByRole("status").filter({ hasText: "OPENAI_API_KEY" });
    if (!(await note.isVisible())) ev.fail("GPT Image 2 is disabled but no status line names OPENAI_API_KEY");
    if (!/사용 불가/.test(gpt.text)) ev.fail(`the disabled option should say 사용 불가: ${gpt.text}`);
    await ev.shot("image-no-key");
    const refused = await ev.api("/api/generations", { method: "POST", body: JSON.stringify({ family: GPT, mode: "t2i", prompt: "vgs-img 키 없음", params: {}, images: [], videos: [], startFromImage: false }) });
    if (refused.status !== 503 || !/OPENAI_API_KEY/.test(refused.body?.error ?? "")) ev.fail(`POST without OPENAI_API_KEY answered ${refused.status} ${refused.body?.error}`);
    ev.note(`img-no-key: option "${gpt.text}" disabled, status line names OPENAI_API_KEY, POST answered 503 "${refused.body.error}"`);
    return;
  }
  if (!fake) ev.fail("set VGS_FAKE_HF to the fake the app talks to; this journey generates images");

  await model.selectOption(GPT);
  const modes = drawer.getByRole("list", { name: "생성 방식" });
  const modeTexts = (await modes.locator("li").allTextContents()).map((t) => t.trim());
  if (modeTexts.join(",") !== "텍스트→이미지,레퍼런스→이미지") ev.fail(`image modes read ${modeTexts.join(",")}`);
  const current = async () => (await modes.locator('[aria-current="step"]').textContent())?.trim();
  if ((await current()) !== "텍스트→이미지") ev.fail(`with nothing attached the mode should be 텍스트→이미지, got ${await current()}`);
  const pills = (await page.getByRole("group", { name: "출력 화면비" }).getByRole("button").allTextContents()).map((t) => t.trim());
  if (pills.join(",") !== "정사각 1:1,가로 3:2,세로 2:3,가로 16:9,세로 9:16") ev.fail(`aspect pills read ${pills.join(",")}`);
  for (const [label, options] of [["품질", "낮음 · low,중간 · medium,높음 · high"], ["파일 형식", "PNG,JPEG,WebP"], ["배경", "자동,불투명,투명 (PNG·WebP)"]]) {
    const got = (await page.getByLabel(label).locator("option").allTextContents()).join(",");
    if (got !== options) ev.fail(`${label} offers ${got}`);
  }
  if (await drawer.getByText(/영상 \d+\/\d+/).count()) ev.fail("the reference counter still counts videos for an image model");
  ev.note(`img-drawer: modes ${modeTexts.join(" · ")}, pills ${pills.join(" · ")}`);

  const prompt = `vgs-img ${stamp} 안개 낀 새벽 등대, 35mm`;
  await page.getByLabel("프롬프트").fill(prompt);
  const costBar = drawer.locator(".font-display.text-2xl");
  const shown = (await costBar.textContent())?.trim();
  const note = (await drawer.getByText(/단가 \$/).textContent())?.trim();
  if (!/^\$0\.\d{4}$/.test(shown ?? "")) ev.fail(`the estimate should show before submit, got ${shown}`);
  ev.note(`img-estimate: ${shown} (${note})`);
  await ev.shot("image-drawer");

  const generate = async (label) => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/generations" && r.request().method() === "POST"),
      page.getByRole("button", { name: "생성하기" }).click(),
    ]);
    const body = await res.json();
    if (res.status() !== 201 || body.item?.status !== "in_progress") ev.fail(`${label}: POST answered ${res.status()} ${body.item?.status} ${body.error ?? ""}`);
    const stage = page.getByRole("region", { name: "결과 무대" });
    const item = stage.locator(`article[data-id="${body.item.id}"]`);
    const running = item.getByText("OpenAI가 이미지를 만드는 중입니다", { exact: false });
    await running.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await ev.shot(`${label}-running`);
    const img = item.getByRole("img", { name: "생성된 이미지" });
    await img.waitFor({ timeout: 90_000 });
    await page.waitForFunction((el) => el && el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 15_000 });
    const size = await img.evaluate((el) => `${el.naturalWidth}×${el.naturalHeight}`);
    const row = (await ev.api(`/api/generations/${body.item.id}`)).body?.item;
    if (row?.status !== "completed" || !row.image) ev.fail(`${label}: the row is ${row?.status} with image ${JSON.stringify(row?.image)}`);
    return { item: body.item, estimated: body.estimatedCostUsd, row, size };
  };

  const t2i = await generate("image-t2i");
  if (`$${t2i.estimated.toFixed(4)}` !== shown) ev.fail(`the drawer showed ${shown} but the row was quoted $${t2i.estimated}`);
  await ev.shot("image-t2i-done");
  const stats = async () => (await (await fetch(`${fake}/_stats`)).json()).openai.requests;
  const sentT2i = (await stats()).filter((r) => r.body.prompt === prompt);
  if (sentT2i.length !== 1 || sentT2i[0].op !== "generations" || "images" in sentT2i[0].body) ev.fail(`text→image sent ${JSON.stringify(sentT2i.map((r) => [r.op, r.status]))}`);
  const download = page.getByRole("link", { name: "다운로드" });
  const href = await download.getAttribute("href");
  const counter = (await page.getByText("PNG", { exact: true }).count()) > 0;
  const head = await page.request.get(href);
  if (!href?.endsWith("?download=1") || !counter || !/attachment; filename=".+\.png"/.test(head.headers()["content-disposition"] ?? "")) {
    ev.fail(`download glyph: href ${href}, PNG counter ${counter}, disposition ${head.headers()["content-disposition"]}`);
  }
  ev.note(`img-t2i: generations once, ${t2i.size}, quoted $${t2i.estimated}, recorded $${t2i.row.costUsd} from usage, download ${href}`);

  await page.getByRole("button", { name: "레퍼런스 추가" }).click();
  const dialog = page.getByRole("dialog", { name: "레퍼런스 추가" });
  await dialog.waitFor();
  if (!(await dialog.getByText("영상 레퍼런스를 받지 않는 모델").isVisible())) ev.fail("the video drop zone should be off for an image model");
  const refKeys = async () => Object.keys((await (await fetch(`${fake}/_stats`)).json()).storage.byKey).filter((k) => k.startsWith("refs/"));
  const before = new Set(await refKeys());
  const serverUploads = [];
  const onUpload = (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/uploads" && serverUploads.push(r.status());
  page.on("response", onUpload);
  await dialog.getByLabel("이미지 레퍼런스 추가").setInputFiles(IMAGES);
  await dialog.getByRole("list", { name: "첨부한 레퍼런스" }).locator("li").nth(1).waitFor({ timeout: 30_000 });
  page.off("response", onUpload);
  const added = (await refKeys()).filter((k) => !before.has(k));
  if (added.length !== 2 || serverUploads.length !== 0) ev.fail(`both references should go browser → Blob refs/, saw ${JSON.stringify(added)} and ${serverUploads.length} server uploads`);
  ev.note(`img-refs: uploaded straight to Blob as ${added.join(", ")}; /api/uploads (the Higgsfield path) was not called`);
  await ev.shot("image-refs-dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if ((await current()) !== "레퍼런스→이미지") ev.fail(`with two images the mode should be 레퍼런스→이미지, got ${await current()}`);
  if (!(await drawer.getByText("이미지 2장을 레퍼런스로 OpenAI 편집에 보냅니다.").isVisible())) ev.fail("the mode sentence does not explain the edit");
  await page.getByRole("group", { name: "출력 화면비" }).getByRole("button", { name: "가로 16:9" }).click();
  await page.getByLabel("파일 형식").selectOption("jpeg");
  const editPrompt = `vgs-img ${stamp} 두 사진의 빛으로 새벽 항구`;
  await page.getByLabel("프롬프트").fill(editPrompt);
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
  const tile = page.getByRole("button", { name: `${prompt} 자세히 보기` });
  await tile.waitFor({ timeout: 10_000 });
  if ((await tile.locator("img").count()) !== 1 || (await tile.locator("video").count()) !== 0) ev.fail("the gallery tile for an image should hold an <img>, not a <video>");
  await tile.scrollIntoViewIfNeeded();
  await ev.shot("gallery-image-tile");
  await tile.click();
  const detail = page.getByRole("dialog", { name: "생성 상세" });
  const detailImg = detail.getByRole("img", { name: "생성된 이미지" });
  await page.waitForFunction((el) => el && el.complete && el.naturalWidth > 0, await detailImg.elementHandle(), { timeout: 15_000 });
  if (!(await detail.getByText("영구").isVisible())) ev.fail("the image detail should say 보관 영구");
  const detailHref = await detail.getByRole("link", { name: "다운로드" }).getAttribute("href");
  if (detailHref !== t2i.row.image.downloadUrl) ev.fail(`detail download ${detailHref} differs from ${t2i.row.image.downloadUrl}`);
  await ev.shot("gallery-image-detail");
  await page.keyboard.press("Escape");
  ev.note("img-gallery: the tile holds an <img>, the detail shows the stored image, 보관 영구, and the download link");

  await page.goto(`${page.url().split("/gallery")[0]}/dashboard`, { waitUntil: "networkidle" });
  const byModel = page.getByText("GPT Image 2", { exact: true });
  if (!(await byModel.first().isVisible())) ev.fail("the dashboard's 모델별 card does not list GPT Image 2");
  const rowText = page.getByRole("row").filter({ hasText: prompt.slice(0, 30) });
  if (!(await rowText.getByText("GPT Image 2 · 텍스트→이미지").isVisible())) ev.fail("the recent table does not name the image row's model and mode");
  if ((await rowText.locator("td").nth(4).textContent())?.trim() !== "—") ev.fail("an image row's 길이 should read —");
  await ev.shot("dashboard-images", { fullPage: true });
  ev.note("img-dashboard: 모델별 lists GPT Image 2; the recent row reads GPT Image 2 · 텍스트→이미지 with 길이 —");
}
