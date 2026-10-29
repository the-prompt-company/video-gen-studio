import { test } from "node:test";
import assert from "node:assert/strict";
import { ENDPOINTS, invalidBody } from "../../scripts/fake-higgsfield";
import { invalidImageRequest } from "../../scripts/fake-openai";
import {
  defaultParams,
  describeModel,
  costUsd,
  endpointsOf,
  FAMILIES,
  FAMILY_IDS,
  legacyBody,
  modesOf,
  planGeneration,
  resendRequest,
  routeMode,
  type Draft,
  type FamilyId,
  type Mode,
  type Plan,
  type TokenUsage,
  type WireBody,
} from "./catalog";

const IMG = "https://cdn.test/a.jpg";
const IMG2 = "https://cdn.test/b.jpg";
const VID = "https://cdn.test/c.mp4";
const SEEDANCE: FamilyId = "bytedance/seedance-2.0";
const H3: FamilyId = "minimax/h3";
const GPT: FamilyId = "openai/gpt-image-2";
const VIDEO_FAMILIES = FAMILY_IDS.filter((f) => FAMILIES[f].provider === "higgsfield");

function draft(over: Partial<Draft> = {}): Draft {
  return { family: SEEDANCE, mode: "t2v", prompt: "비 오는 밤거리", params: {}, images: [], videos: [], startFromImage: false, ...over };
}

function ready(plan: Plan) {
  assert.ok(plan.ready, plan.ready ? "" : plan.blocker);
  return { ...plan, body: JSON.parse(plan.body) as Record<string, unknown> };
}

function blocked(plan: Plan): string {
  assert.equal(plan.ready, false, `expected a blocker, planned ${plan.endpoint}`);
  return plan.ready ? "" : plan.blocker;
}

test("routeMode: nothing attached is text, one image the member starts from is image, anything else is reference", () => {
  const cases: [number, number, boolean, Mode][] = [
    [0, 0, false, "t2v"],
    [0, 0, true, "t2v"],
    [1, 0, false, "r2v"],
    [1, 0, true, "i2v"],
    [2, 0, true, "r2v"],
    [1, 1, true, "r2v"],
    [0, 1, true, "r2v"],
    [0, 3, false, "r2v"],
  ];
  for (const [images, videos, start, mode] of cases) assert.equal(routeMode(SEEDANCE, images, videos, start), mode, `${images} images, ${videos} videos, start ${start}`);
});

test("each model reaches its three Higgsfield endpoints by what is attached", () => {
  const want: Partial<Record<FamilyId, Partial<Record<Mode, string>>>> = {
    [SEEDANCE]: {
      t2v: "bytedance/seedance-2.0/text-to-video",
      i2v: "bytedance/seedance-2.0/image-to-video",
      r2v: "bytedance/seedance-2.0/reference-to-video",
    },
    [H3]: { t2v: "minimax/h3/text-to-video", i2v: "minimax/h3/image-to-video", r2v: "minimax/h3/reference-to-video" },
  };
  assert.deepEqual(FAMILY_IDS, [SEEDANCE, H3, GPT]);
  assert.deepEqual(VIDEO_FAMILIES, [SEEDANCE, H3]);
  const attach: Partial<Record<Mode, Partial<Draft>>> = {
    t2v: {},
    i2v: { mode: "i2v", images: [IMG], startFromImage: true },
    r2v: { mode: "r2v", images: [IMG, IMG2], videos: [{ url: VID, seconds: 3 }] },
  };
  for (const family of VIDEO_FAMILIES) {
    for (const mode of modesOf(family)) {
      const plan = ready(planGeneration(draft({ family, ...attach[mode] }), 0));
      assert.equal(plan.endpoint, want[family]?.[mode]);
      assert.equal(plan.mode, mode);
    }
  }
});

test("a prompt alone is enough: no reference is ever required", () => {
  for (const family of VIDEO_FAMILIES) {
    const plan = ready(planGeneration(draft({ family }), 0));
    assert.equal(plan.mode, "t2v");
    assert.deepEqual(plan.body, { ...defaultParams(family), prompt: "비 오는 밤거리" });
  }
});

test("the default for one image is reference; the first-frame choice is offered only for exactly one image and no video", () => {
  assert.equal(ready(planGeneration(draft({ mode: "r2v", images: [IMG] }), 0)).endpoint, "bytedance/seedance-2.0/reference-to-video");
  assert.equal(planGeneration(draft({ mode: "r2v", images: [IMG] }), 0).offersStartFromImage, true);
  assert.equal(planGeneration(draft({ mode: "r2v", images: [IMG, IMG2], startFromImage: true }), 0).offersStartFromImage, false);
  assert.equal(planGeneration(draft({ mode: "r2v", images: [IMG], videos: [{ url: VID, seconds: 2 }], startFromImage: true }), 0).offersStartFromImage, false);
  assert.equal(planGeneration(draft(), 0).offersStartFromImage, false);
});

test("a mode the screen showed but the attachments do not route to is refused, never rerouted", () => {
  assert.match(blocked(planGeneration(draft({ mode: "r2v" }), 0)), /새로고침/);
  assert.match(blocked(planGeneration(draft({ mode: "i2v", images: [IMG, IMG2], startFromImage: true }), 0)), /새로고침/);
});

test("bodies carry the media fields of their mode and only keys the endpoint's published schema lists", () => {
  const i2v = ready(planGeneration(draft({ mode: "i2v", images: [IMG], startFromImage: true, params: { aspect_ratio: "9:16", resolution: "720p", duration: 6 } }), 0));
  assert.equal(i2v.body.image_url, IMG);
  assert.equal("aspect_ratio" in i2v.body, false, "Seedance image-to-video takes no aspect_ratio");
  assert.deepEqual([i2v.body.resolution, i2v.body.duration], ["720p", 6]);

  const r2v = ready(planGeneration(draft({ mode: "r2v", images: [IMG], videos: [{ url: VID, seconds: 4 }] }), 0));
  assert.deepEqual([r2v.body.image_urls, r2v.body.video_urls], [[IMG], [VID]]);

  const media: Partial<Record<Mode, Partial<Draft>>> = {
    t2v: {},
    i2v: { mode: "i2v", images: [IMG], startFromImage: true },
    r2v: { mode: "r2v", images: [IMG], videos: [{ url: VID, seconds: 5 }] },
  };
  for (const family of VIDEO_FAMILIES) {
    for (const mode of modesOf(family)) {
      for (const params of [defaultParams(family), edgeParams(family)]) {
        const plan = ready(planGeneration(draft({ family, params, ...media[mode] }), 0));
        const schema = ENDPOINTS[plan.endpoint];
        assert.ok(schema, `the fake serves ${plan.endpoint}`);
        assert.equal(invalidBody(schema, plan.body), null, `${plan.endpoint} ${JSON.stringify(plan.body)}`);
      }
    }
  }
});

function edgeParams(family: FamilyId): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of FAMILIES[family].params) {
    if (p.type === "int") out[p.key] = p.max;
    else if (p.type === "enum") out[p.key] = p.options[p.options.length - 1];
    else out[p.key] = !p.default;
  }
  return out;
}

test("caps and prompts: H3 takes five images and always a prompt, Seedance six images, both three videos", () => {
  const six = Array.from({ length: 6 }, (_, i) => `https://cdn.test/${i}.jpg`);
  ready(planGeneration(draft({ family: H3, mode: "r2v", images: six.slice(0, 5) }), 0));
  assert.match(blocked(planGeneration(draft({ family: H3, mode: "r2v", images: six }), 0)), /최대 5장/);
  ready(planGeneration(draft({ mode: "r2v", images: six }), 0));
  assert.match(blocked(planGeneration(draft({ mode: "r2v", images: [...six, IMG] }), 0)), /최대 6장/);
  const fourVideos = Array.from({ length: 4 }, (_, i) => ({ url: `https://cdn.test/${i}.mp4`, seconds: 1 }));
  assert.match(blocked(planGeneration(draft({ mode: "r2v", videos: fourVideos }), 0)), /최대 3개/);
  assert.match(blocked(planGeneration(draft({ family: H3, prompt: "  " }), 0)), /프롬프트/);
  assert.match(blocked(planGeneration(draft({ family: H3, mode: "i2v", prompt: "", images: [IMG], startFromImage: true }), 0)), /프롬프트/);
  assert.match(blocked(planGeneration(draft({ prompt: "" }), 0)), /프롬프트/);
  const noPrompt = ready(planGeneration(draft({ mode: "r2v", prompt: "", images: [IMG] }), 0));
  assert.equal("prompt" in noPrompt.body, false, "Seedance reference-to-video goes without a prompt");
});

test("params are checked against the model's ranges, and the prompt is sent trimmed", () => {
  assert.match(blocked(planGeneration(draft({ params: { duration: 16 } }), 0)), /길이/);
  assert.match(blocked(planGeneration(draft({ family: H3, params: { duration: 7 } }), 0)), /길이/);
  assert.match(blocked(planGeneration(draft({ params: { resolution: "2K" } }), 0)), /해상도/);
  assert.equal(ready(planGeneration(draft({ prompt: "  밤  " }), 0)).body.prompt, "밤");
  assert.equal(ready(planGeneration(draft({ family: H3, params: { duration: "10" } }), 0)).durationS, 10);
});

test("every reference video needs a length the browser read", () => {
  for (const seconds of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
    assert.match(blocked(planGeneration(draft({ mode: "r2v", videos: [{ url: VID, seconds }] }), 0)), /영상 길이/, String(seconds));
  }
});

test("cost: Seedance follows Higgsfield's token meter from a USD-per-second rate at 480p 16:9", () => {
  const seedance = (params: Record<string, unknown>, mode: Mode = "t2v", inputVideoS = 0) => ({ family: SEEDANCE, mode, params: { ...defaultParams(SEEDANCE), ...params }, inputVideoS });
  const table = 0.0985;
  const list = 0.140616;
  assert.equal(costUsd(seedance({ resolution: "480p", aspect_ratio: "16:9", duration: 5 }), table), 0.4925, "Higgsfield's $0.0985/s at 480p");
  assert.equal(costUsd(seedance({ resolution: "480p", aspect_ratio: "16:9", duration: 5 }), list), 0.7031, "50,220 tokens × $0.014/1k");
  assert.equal(costUsd(seedance({ resolution: "720p", aspect_ratio: "9:16", duration: 5 }), list), 1.512, "108,000 tokens × $0.014/1k");
  assert.equal(costUsd(seedance({ resolution: "4k", aspect_ratio: "16:9", duration: 5 }), list), 7.776, "972,000 tokens × $0.008/1k");
  assert.equal(costUsd(seedance({ resolution: "4k", aspect_ratio: "16:9", duration: 1 }), 0.098431), 1.0886, "Higgsfield's $1.0887/s at 4K, before the table rounds up");
  assert.equal(costUsd(seedance({ resolution: "480p", aspect_ratio: "1:1", duration: 5 }), list), 0.672, "a square 480p frame is smaller");
  const withVideo = costUsd(seedance({ resolution: "480p", aspect_ratio: "16:9", duration: 5 }, "r2v", 5), table);
  assert.equal(withVideo, 0.591, "input seconds count at 0.6×: Higgsfield's $0.1182/s with a video as long as the output");
  assert.equal(costUsd(seedance({ resolution: "480p", aspect_ratio: "16:9", duration: 5 }, "r2v", 12.5), list), Number((Math.ceil(17.5 * 10_044) * 0.0084 / 1000).toFixed(4)));
  const i2v = costUsd({ family: SEEDANCE, mode: "i2v", params: { duration: 5, resolution: "720p", generate_audio: false }, inputVideoS: 0 }, list);
  assert.equal(i2v, Number((Math.ceil((5 * 1112 * 834 * 24) / 1024) * 0.014 / 1000).toFixed(4)), "image-to-video follows the image, so the largest 720p frame is billed");
  assert.equal(costUsd(seedance({ duration: 5 }), 0), 0, "no rate set, no cost");
});

test("cost: MiniMax H3 is its rate per second at 2K", () => {
  for (const [duration, usd] of [[5, 0.325], [10, 0.65], [15, 0.975]] as const) {
    for (const mode of modesOf(H3)) assert.equal(costUsd({ family: H3, mode, params: { ...defaultParams(H3), duration }, inputVideoS: 0 }, 0.065), usd);
  }
});

test("the plan carries the cost the same function gives", () => {
  const plan = ready(planGeneration(draft({ mode: "r2v", images: [IMG], videos: [{ url: VID, seconds: 2.5 }, { url: VID, seconds: 2.5 }], params: { duration: 5 } }), 0.0985));
  assert.equal(plan.costUsd, costUsd({ family: SEEDANCE, mode: "r2v", params: plan.params, inputVideoS: 5 }, 0.0985));
  assert.equal(plan.costUsd, 0.591);
});

const BEFORE_0007 = [
  {
    row: { modelId: "bytedance/seedance-2.0/reference-to-video", prompt: " 세로 숏폼 ", params: { duration: 8, resolution: "720p", aspect_ratio: "9:16", generate_audio: true }, imageRefs: [IMG, IMG2], videoRefs: [VID] },
    body: `{"duration":8,"resolution":"720p","aspect_ratio":"9:16","generate_audio":true,"prompt":"세로 숏폼","image_urls":["${IMG}","${IMG2}"],"video_urls":["${VID}"]}`,
  },
  {
    row: { modelId: "bytedance/seedance-2.0/reference-to-video", prompt: "", params: { duration: 5, resolution: "480p", aspect_ratio: "16:9", generate_audio: false }, imageRefs: [], videoRefs: [VID] },
    body: `{"duration":5,"resolution":"480p","aspect_ratio":"16:9","generate_audio":false,"video_urls":["${VID}"]}`,
  },
  {
    row: { modelId: "minimax/hailuo-2.3/standard/image-to-video", prompt: "비", params: { duration: 6, prompt_optimizer: true }, imageRefs: [IMG], videoRefs: [] },
    body: `{"duration":6,"prompt_optimizer":true,"prompt":"비","image_url":"${IMG}"}`,
  },
];

test("a row from before request_body resends the exact body the old code sent", () => {
  for (const { row, body } of BEFORE_0007) assert.equal(legacyBody(row), body, row.modelId);
  assert.equal(legacyBody({ ...BEFORE_0007[0].row, modelId: "minimax/h3/text-to-video" }), null, "every newer row carries its own body");
});

test("a resend goes to the row's stored endpoint with its stored bytes, whatever the catalog would plan today", () => {
  const plan = planGeneration(draft({ family: H3, mode: "i2v", images: [IMG], startFromImage: true, params: { duration: 10 } }), 0.065);
  assert.ok(plan.ready);
  const stored = { modelId: plan.endpoint, requestBody: plan.body, prompt: plan.prompt, params: { ...plan.params }, imageRefs: [IMG], videoRefs: [] };
  assert.deepEqual(resendRequest(stored), {
    endpoint: "minimax/h3/image-to-video",
    body: `{"duration":10,"aspect_ratio":"auto","aigc_watermark":false,"prompt":"비 오는 밤거리","image_url":"${IMG}"}`,
  });
  assert.equal(routeMode(H3, stored.imageRefs.length, stored.videoRefs.length, false), "r2v", "without the member's choice, which the row does not keep, one image routes to reference today");

  const fromAnotherDeploy = `{"duration":7,"prompt":"옛 규칙","image_url":"${IMG}","seed":42}` as WireBody;
  assert.deepEqual(resendRequest({ ...stored, modelId: "minimax/h3/image-to-video", requestBody: fromAnotherDeploy }), { endpoint: "minimax/h3/image-to-video", body: fromAnotherDeploy });
  const retired = BEFORE_0007[2];
  assert.deepEqual(resendRequest({ ...retired.row, requestBody: null }), { endpoint: retired.row.modelId, body: retired.body });
  assert.equal(resendRequest({ ...retired.row, modelId: "alibaba/wan-3.0/reference-to-video", requestBody: null }), null);
});

test("old rows keep a name and labels: Hailuo and the old Seedance id resolve, an older id falls back to its path", () => {
  const hailuo = describeModel("minimax/hailuo-2.3/standard/image-to-video");
  assert.deepEqual([hailuo.name, hailuo.family, hailuo.mode, hailuo.paramLabel("prompt_optimizer")], ["Hailuo 2.3 Standard", null, "i2v", "프롬프트 자동 보정"]);
  const seedance = describeModel("bytedance/seedance-2.0/reference-to-video");
  assert.deepEqual([seedance.name, seedance.family, seedance.mode, seedance.group], ["Seedance 2.0", SEEDANCE, "r2v", SEEDANCE]);
  assert.equal(describeModel("bytedance/seedance-2.0/text-to-video").group, SEEDANCE, "all three endpoints fold into one model");
  assert.equal(describeModel("bytedance/seedance-2.0/text-to-video").paramLabel("resolution"), "해상도");
  const wan = describeModel("alibaba/wan-3.0/reference-to-video");
  assert.deepEqual([wan.name, wan.family, wan.mode, wan.paramLabel("seed")], ["alibaba/wan-3.0", null, null, "seed"]);
});

test("GPT Image 2: nothing attached goes to generations, any image reference to edits, and a video reference is refused", () => {
  assert.deepEqual(modesOf(GPT), ["t2i", "r2i"]);
  assert.deepEqual(endpointsOf(GPT), ["openai/gpt-image-2/generations", "openai/gpt-image-2/edits"]);
  const cases: [number, number, boolean, Mode][] = [
    [0, 0, false, "t2i"],
    [0, 0, true, "t2i"],
    [1, 0, false, "r2i"],
    [1, 0, true, "r2i"],
    [16, 0, false, "r2i"],
    [0, 1, false, "r2i"],
  ];
  for (const [images, videos, start, mode] of cases) assert.equal(routeMode(GPT, images, videos, start), mode, `${images} images, ${videos} videos, start ${start}`);

  const t2i = ready(planGeneration(draft({ family: GPT, mode: "t2i" }), 0));
  assert.deepEqual([t2i.endpoint, t2i.mode, t2i.durationS, t2i.offersStartFromImage], ["openai/gpt-image-2/generations", "t2i", 0, false]);
  const r2i = ready(planGeneration(draft({ family: GPT, mode: "r2i", images: [IMG], startFromImage: true }), 0));
  assert.deepEqual([r2i.endpoint, r2i.mode, r2i.offersStartFromImage], ["openai/gpt-image-2/edits", "r2i", false], "an image model has no first-frame mode");
  assert.match(blocked(planGeneration(draft({ family: GPT, mode: "r2i", videos: [{ url: VID, seconds: 3 }] }), 0)), /영상 레퍼런스를 받지 않습니다/);
  assert.match(blocked(planGeneration(draft({ family: GPT, mode: "t2v" }), 0)), /새로고침/, "a video mode shown for an image model is refused");
});

test("GPT Image 2 bodies carry the documented parameters in a fixed order, and edits add the references as image_url", () => {
  const t2i = planGeneration(draft({ family: GPT, mode: "t2i" }), 0);
  assert.ok(t2i.ready);
  assert.equal(t2i.body, `{"model":"gpt-image-2","prompt":"비 오는 밤거리","size":"1024x1024","quality":"medium","output_format":"png","background":"auto"}`);
  const r2i = planGeneration(
    draft({ family: GPT, mode: "r2i", images: [IMG, IMG2], prompt: " 이 제품을 대리석 위에 ", params: { aspect_ratio: "16:9", quality: "high", output_format: "webp", background: "transparent" } }),
    0,
  );
  assert.ok(r2i.ready);
  assert.equal(
    r2i.body,
    `{"model":"gpt-image-2","prompt":"이 제품을 대리석 위에","size":"1536x864","quality":"high","output_format":"webp","background":"transparent","images":[{"image_url":"${IMG}"},{"image_url":"${IMG2}"}]}`,
  );

  const aspect = FAMILIES[GPT].params.find((p) => p.key === "aspect_ratio");
  assert.ok(aspect?.type === "enum");
  const sizes = Object.fromEntries(
    aspect.options.map((a) => [a, ready(planGeneration(draft({ family: GPT, mode: "t2i", params: { aspect_ratio: a } }), 0)).body.size]),
  );
  assert.deepEqual(sizes, { "1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536", "16:9": "1536x864", "9:16": "864x1536" });

  const sixteen = Array.from({ length: 16 }, (_, i) => `https://cdn.test/${i}.png`);
  for (const params of [defaultParams(GPT), edgeParams(GPT)]) {
    for (const [mode, images] of [["t2i", []], ["r2i", [IMG]], ["r2i", sixteen]] as const) {
      const plan = ready(planGeneration(draft({ family: GPT, mode, images, params }), 0));
      const op = mode === "t2i" ? "generations" : "edits";
      assert.equal(plan.endpoint, `openai/gpt-image-2/${op}`);
      assert.equal(invalidImageRequest(op, plan.body), null, `${plan.endpoint} ${JSON.stringify(plan.body)}`);
      assert.equal("input_fidelity" in plan.body, false, "gpt-image-2 takes no input_fidelity");
    }
  }
});

test("GPT Image 2 blockers: a prompt in both modes, at most 16 images and 32,000 characters, transparency only in PNG or WebP", () => {
  assert.match(blocked(planGeneration(draft({ family: GPT, mode: "t2i", prompt: " " }), 0)), /프롬프트가 필요합니다/);
  assert.match(blocked(planGeneration(draft({ family: GPT, mode: "r2i", prompt: "", images: [IMG] }), 0)), /프롬프트가 필요합니다/);
  const seventeen = Array.from({ length: 17 }, (_, i) => `https://cdn.test/${i}.png`);
  assert.match(blocked(planGeneration(draft({ family: GPT, mode: "r2i", images: seventeen }), 0)), /최대 16장/);
  ready(planGeneration(draft({ family: GPT, mode: "t2i", prompt: "가".repeat(32_000) }), 0));
  assert.match(blocked(planGeneration(draft({ family: GPT, mode: "t2i", prompt: "가".repeat(32_001) }), 0)), /32,000자/);
  assert.match(blocked(planGeneration(draft({ family: GPT, mode: "t2i", params: { background: "transparent", output_format: "jpeg" } }), 0)), /투명 배경/);
  ready(planGeneration(draft({ family: GPT, mode: "t2i", params: { background: "transparent", output_format: "png" } }), 0));
  assert.match(blocked(planGeneration(draft({ family: GPT, mode: "t2i", params: { quality: "auto" } }), 0)), /품질/);
});

function gpt(params: Record<string, unknown>, extra: { promptChars?: number; inputImages?: number; usage?: TokenUsage } = {}) {
  return { family: GPT, mode: (extra.inputImages ? "r2i" : "t2i") as Mode, params: { ...defaultParams(GPT), ...params }, inputVideoS: 0, ...extra };
}

test("cost: at $30 per 1M output tokens, GPT Image 2's estimate is OpenAI's published price per image", () => {
  const published: [string, string, number][] = [
    ["low", "1:1", 0.006], ["low", "3:2", 0.005], ["low", "2:3", 0.005],
    ["medium", "1:1", 0.053], ["medium", "3:2", 0.041], ["medium", "2:3", 0.041],
    ["high", "1:1", 0.211], ["high", "3:2", 0.165], ["high", "2:3", 0.165],
  ];
  for (const [quality, aspect, usd] of published) assert.equal(costUsd(gpt({ quality, aspect_ratio: aspect }), 30), usd, `${quality} ${aspect}`);
  assert.equal(costUsd(gpt({ quality: "high", aspect_ratio: "16:9" }), 30), 0.165, "16:9 has fewer pixels than 3:2 and is priced at the 3:2 figure");
  assert.equal(costUsd(gpt({ quality: "medium", aspect_ratio: "1:1" }, { promptChars: 120 }), 30), 0.0536, "120 prompt characters add 120 text tokens at $5 per 1M");
  assert.equal(costUsd(gpt({ quality: "medium", aspect_ratio: "1:1" }, { promptChars: 200, inputImages: 2 }), 30), 0.159, "each reference adds 6,563 image tokens at $8 per 1M");
  assert.equal(costUsd(gpt({ quality: "medium", aspect_ratio: "1:1" }), 15), 0.0265, "the admin's rate scales the whole price list");
  assert.equal(costUsd(gpt({ quality: "high" }), 0), 0, "no rate, no cost");
  assert.equal(costUsd(FAMILIES[GPT].rate.example.basis, FAMILIES[GPT].rate.defaultUsd), 0.053, "the admin page's example at the default rate");
});

test("cost: with usage, GPT Image 2 is priced from OpenAI's token counts at text $5, image input $8 and output $30 per 1M", () => {
  const usage: TokenUsage = { inputTextTokens: 200, inputImageTokens: 8_800, outputTokens: 1_800 };
  assert.equal(costUsd(gpt({ quality: "medium" }, { promptChars: 200, inputImages: 2, usage }), 30), 0.1254, "1,800 × $30 + 8,800 × $8 + 200 × $5, per 1M");
  assert.equal(costUsd(gpt({ quality: "high" }, { usage }), 15), 0.0627);
  assert.equal(costUsd(gpt({ quality: "low" }, { usage: { inputTextTokens: 50, inputImageTokens: 0, outputTokens: 1_756 } }), 30), 0.0529);
});

test("the plan keeps what it priced and at which rate, so the server can price OpenAI's usage the same way", () => {
  const plan = planGeneration(draft({ family: GPT, mode: "r2i", images: [IMG, IMG2], prompt: "가".repeat(200) }), 30);
  assert.ok(plan.ready);
  assert.equal(plan.rateUsd, 30);
  const { params, ...basis } = plan.costBasis;
  assert.deepEqual(params, plan.params);
  assert.deepEqual(basis, { family: GPT, mode: "r2i", inputVideoS: 0, promptChars: 200, inputImages: 2 });
  assert.equal(plan.costUsd, costUsd(plan.costBasis, 30));
  assert.equal(plan.costUsd, 0.159);
  assert.deepEqual(plan.facts, ["1024×1024", "medium", "레퍼런스 2장"]);
  const video = planGeneration(draft({ mode: "r2v", videos: [{ url: VID, seconds: 3 }], params: { resolution: "720p", duration: 6 } }), 0.0985);
  assert.deepEqual(video.facts, ["6s", "720p", "입력 영상 3.0s"]);
});

test("stored image endpoints read as GPT Image 2, an image model of OpenAI", () => {
  for (const [id, mode] of [["openai/gpt-image-2/generations", "t2i"], ["openai/gpt-image-2/edits", "r2i"]] as const) {
    const m = describeModel(id);
    assert.deepEqual([m.name, m.group, m.family, m.mode, m.provider, m.output, m.paramLabel("quality")], ["GPT Image 2", GPT, GPT, mode, "openai", "image", "품질"]);
  }
  const seedance = describeModel("bytedance/seedance-2.0/text-to-video");
  assert.deepEqual([seedance.provider, seedance.output], ["higgsfield", "video"]);
  const hailuo = describeModel("minimax/hailuo-2.3/standard/image-to-video");
  assert.deepEqual([hailuo.provider, hailuo.output], ["higgsfield", "video"]);
});
