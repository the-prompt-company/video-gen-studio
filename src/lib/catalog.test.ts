import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { ENDPOINTS, invalidBody } from "../../scripts/fake-higgsfield";
import { invalidImageRequest } from "../../scripts/fake-openai";
import { LOCALES } from "../i18n/locale";
import type { AppError } from "./errors";
import {
  defaultParams,
  describeModel,
  costUsd,
  endpointsOf,
  endpointsOfProvider,
  FAMILIES,
  FAMILY_IDS,
  legacyBody,
  modelLine,
  MODES,
  modesOf,
  planGeneration,
  resendRequest,
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
const GPT: FamilyId = "openai/gpt-image-2.6-flare";
const VIDEO_FAMILIES = FAMILY_IDS.filter((f) => FAMILIES[f].provider === "higgsfield");

function draft(over: Partial<Draft> = {}): Draft {
  return { family: SEEDANCE, mode: "t2v", prompt: "비 오는 밤거리", params: {}, images: [], videos: [], endImage: null, ...over };
}

function ready(plan: Plan) {
  assert.ok(plan.ready, plan.ready ? "" : JSON.stringify(plan.blocker));
  return { ...plan, body: JSON.parse(plan.body) as Record<string, unknown> };
}

function blocked(plan: Plan): AppError | undefined {
  assert.equal(plan.ready, false, `expected a blocker, planned ${plan.endpoint}`);
  return plan.ready ? undefined : plan.blocker;
}

test("the member's mode decides the endpoint; the attachments only have to fit it", () => {
  const fits: [Mode, Partial<Draft>][] = [
    ["t2v", {}],
    ["i2v", { images: [IMG] }],
    ["i2v", { images: [IMG], endImage: IMG2 }],
    ["r2v", { images: [IMG] }],
    ["r2v", { videos: [{ url: VID, seconds: 3 }] }],
    ["r2v", { images: [IMG, IMG2], videos: [{ url: VID, seconds: 3 }] }],
  ];
  for (const [mode, over] of fits) assert.equal(ready(planGeneration(draft({ mode, ...over }), 0)).mode, mode, JSON.stringify(over));
  const misfits: [Mode, Partial<Draft>][] = [
    ["t2v", { images: [IMG] }],
    ["t2v", { endImage: IMG }],
    ["i2v", { images: [IMG, IMG2] }],
    ["i2v", { images: [IMG], videos: [{ url: VID, seconds: 3 }] }],
    ["r2v", { images: [IMG], endImage: IMG2 }],
  ];
  for (const [mode, over] of misfits) assert.deepEqual(blocked(planGeneration(draft({ mode, ...over }), 0)), { code: "modeMismatch", params: { mode } }, JSON.stringify(over));
});

test("a mode that needs attachments says which, until the member adds them", () => {
  assert.deepEqual(blocked(planGeneration(draft({ mode: "i2v", endImage: IMG2 }), 0)), { code: "startFrameRequired" });
  assert.deepEqual(blocked(planGeneration(draft({ mode: "r2v" }), 0)), { code: "referenceRequired", params: { mode: "r2v" } });
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "r2i" }), 0)), { code: "referenceRequired", params: { mode: "r2i" } });
});

test("an end frame goes to image-to-video as end_image_url after image_url, and the row keeps both frames in order", () => {
  for (const family of VIDEO_FAMILIES) {
    assert.equal(FAMILIES[family].modes.endFrame, true, `${family} takes end_image_url`);
    const plan = ready(planGeneration(draft({ family, mode: "i2v", images: [IMG], endImage: IMG2 }), 0));
    const keys = Object.keys(plan.body);
    assert.deepEqual([plan.body.image_url, plan.body.end_image_url], [IMG, IMG2]);
    assert.equal(keys.indexOf("end_image_url"), keys.indexOf("image_url") + 1);
    assert.deepEqual(plan.imageUrls, [IMG, IMG2]);
    assert.equal(invalidBody(ENDPOINTS[plan.endpoint], plan.body), null, `the fake's ${plan.endpoint} schema takes it`);
    const single = ready(planGeneration(draft({ family, mode: "i2v", images: [IMG] }), 0));
    assert.equal("end_image_url" in single.body, false);
    assert.deepEqual(single.imageUrls, [IMG]);
  }
  assert.equal(FAMILIES[GPT].modes.endFrame, false, "an image model has no first-frame mode, so no end frame");
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
    i2v: { mode: "i2v", images: [IMG] },
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

test("bodies carry the media fields of their mode and only keys the endpoint's published schema lists", () => {
  const i2v = ready(planGeneration(draft({ mode: "i2v", images: [IMG], params: { aspect_ratio: "9:16", resolution: "720p", duration: 6 } }), 0));
  assert.equal(i2v.body.image_url, IMG);
  assert.equal("aspect_ratio" in i2v.body, false, "Seedance image-to-video takes no aspect_ratio");
  assert.deepEqual([i2v.body.resolution, i2v.body.duration], ["720p", 6]);

  const r2v = ready(planGeneration(draft({ mode: "r2v", images: [IMG], videos: [{ url: VID, seconds: 4 }] }), 0));
  assert.deepEqual([r2v.body.image_urls, r2v.body.video_urls], [[IMG], [VID]]);

  const media: Partial<Record<Mode, Partial<Draft>>> = {
    t2v: {},
    i2v: { mode: "i2v", images: [IMG], endImage: IMG2 },
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
  assert.deepEqual(blocked(planGeneration(draft({ family: H3, mode: "r2v", images: six }), 0)), { code: "tooManyImages", params: { model: "MiniMax H3", max: 5 } });
  ready(planGeneration(draft({ mode: "r2v", images: six }), 0));
  assert.deepEqual(blocked(planGeneration(draft({ mode: "r2v", images: [...six, IMG] }), 0)), { code: "tooManyImages", params: { model: "Seedance 2.0", max: 6 } });
  const fourVideos = Array.from({ length: 4 }, (_, i) => ({ url: `https://cdn.test/${i}.mp4`, seconds: 1 }));
  assert.deepEqual(blocked(planGeneration(draft({ mode: "r2v", videos: fourVideos }), 0)), { code: "tooManyVideos", params: { model: "Seedance 2.0", max: 3 } });
  assert.deepEqual(blocked(planGeneration(draft({ family: H3, prompt: "  " }), 0)), { code: "promptRequired", params: { model: "MiniMax H3", mode: "t2v" } });
  assert.deepEqual(blocked(planGeneration(draft({ family: H3, mode: "i2v", prompt: "", images: [IMG] }), 0)), { code: "promptRequired", params: { model: "MiniMax H3", mode: "i2v" } });
  assert.deepEqual(blocked(planGeneration(draft({ prompt: "" }), 0)), { code: "promptRequired", params: { model: "Seedance 2.0", mode: "t2v" } });
  const noPrompt = ready(planGeneration(draft({ mode: "r2v", prompt: "", images: [IMG] }), 0));
  assert.equal("prompt" in noPrompt.body, false, "Seedance reference-to-video goes without a prompt");
});

test("params are checked against the model's ranges, and the prompt is sent trimmed", () => {
  assert.deepEqual(blocked(planGeneration(draft({ params: { duration: 16 } }), 0)), { code: "paramRange", params: { param: "duration", min: 4, max: 15 } });
  assert.deepEqual(blocked(planGeneration(draft({ family: H3, params: { duration: 7 } }), 0)), { code: "paramChoice", params: { param: "duration", options: "5 | 10 | 15" } });
  assert.deepEqual(blocked(planGeneration(draft({ params: { resolution: "2K" } }), 0)), { code: "paramChoice", params: { param: "resolution", options: "480p | 720p | 1080p | 4k" } });
  assert.equal(ready(planGeneration(draft({ prompt: "  밤  " }), 0)).body.prompt, "밤");
  assert.equal(ready(planGeneration(draft({ family: H3, params: { duration: "10" } }), 0)).durationS, 10);
});

test("every reference video needs a length the browser read", () => {
  for (const seconds of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(blocked(planGeneration(draft({ mode: "r2v", videos: [{ url: VID, seconds }] }), 0)), { code: "videoLengthUnknown" }, String(seconds));
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
  const plan = planGeneration(draft({ family: H3, mode: "i2v", images: [IMG], endImage: IMG2, params: { duration: 10 } }), 0.065);
  assert.ok(plan.ready);
  const stored = { modelId: plan.endpoint, requestBody: plan.body, prompt: plan.prompt, params: { ...plan.params }, imageRefs: [...plan.imageUrls], videoRefs: [] };
  assert.deepEqual(resendRequest(stored), {
    endpoint: "minimax/h3/image-to-video",
    body: `{"duration":10,"aspect_ratio":"auto","aigc_watermark":false,"prompt":"비 오는 밤거리","image_url":"${IMG}","end_image_url":"${IMG2}"}`,
  });

  const fromAnotherDeploy = `{"duration":7,"prompt":"옛 규칙","image_url":"${IMG}","seed":42}` as WireBody;
  assert.deepEqual(resendRequest({ ...stored, modelId: "minimax/h3/image-to-video", requestBody: fromAnotherDeploy }), { endpoint: "minimax/h3/image-to-video", body: fromAnotherDeploy });
  const retired = BEFORE_0007[2];
  assert.deepEqual(resendRequest({ ...retired.row, requestBody: null }), { endpoint: retired.row.modelId, body: retired.body });
  assert.equal(resendRequest({ ...retired.row, modelId: "alibaba/wan-3.0/reference-to-video", requestBody: null }), null);
});

test("old rows keep a name and a mode: Hailuo and the old Seedance id resolve, an older id falls back to its path", () => {
  const hailuo = describeModel("minimax/hailuo-2.3/standard/image-to-video");
  assert.deepEqual([hailuo.name, hailuo.family, hailuo.mode], ["Hailuo 2.3 Standard", null, "i2v"]);
  const seedance = describeModel("bytedance/seedance-2.0/reference-to-video");
  assert.deepEqual([seedance.name, seedance.family, seedance.mode, seedance.group], ["Seedance 2.0", SEEDANCE, "r2v", SEEDANCE]);
  assert.equal(describeModel("bytedance/seedance-2.0/text-to-video").group, SEEDANCE, "all three endpoints fold into one model");
  const wan = describeModel("alibaba/wan-3.0/reference-to-video");
  assert.deepEqual([wan.name, wan.family, wan.mode], ["alibaba/wan-3.0", null, null]);
});

test("a stored row's line is its model and the page's name for its mode, or the model alone when the mode is unknown", () => {
  const modeName = (m: Mode) => `<${m}>`;
  assert.equal(modelLine("bytedance/seedance-2.0/text-to-video", modeName), "Seedance 2.0 · <t2v>");
  assert.equal(modelLine("minimax/hailuo-2.3/standard/image-to-video", modeName), "Hailuo 2.3 Standard · <i2v>");
  assert.equal(modelLine("openai/gpt-image-2.6-flare/edits", modeName), "GPT Image 2.6 Flare · <r2i>");
  assert.equal(modelLine("alibaba/wan-3.0/reference-to-video", modeName), "alibaba/wan-3.0");
});

test("GPT Image 2.6 Flare: text goes to generations, references to edits, and a video reference or a frame is refused", () => {
  assert.deepEqual(modesOf(GPT), ["t2i", "r2i"]);
  assert.deepEqual(endpointsOf(GPT), ["openai/gpt-image-2.6-flare/generations", "openai/gpt-image-2.6-flare/edits"]);
  const t2i = ready(planGeneration(draft({ family: GPT, mode: "t2i" }), 0));
  assert.deepEqual([t2i.endpoint, t2i.mode, t2i.durationS], ["openai/gpt-image-2.6-flare/generations", "t2i", 0]);
  const r2i = ready(planGeneration(draft({ family: GPT, mode: "r2i", images: [IMG] }), 0));
  assert.deepEqual([r2i.endpoint, r2i.mode], ["openai/gpt-image-2.6-flare/edits", "r2i"]);
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "r2i", videos: [{ url: VID, seconds: 3 }] }), 0)), { code: "noVideoRefs", params: { model: "GPT Image 2.6 Flare" } });
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "t2v" }), 0)), { code: "modeMismatch", params: { mode: "t2v" } }, "a video mode for an image model is refused");
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "i2v", images: [IMG] }), 0)), { code: "modeMismatch", params: { mode: "i2v" } }, "an image model has no first-frame mode");
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "r2i", images: [IMG], endImage: IMG2 }), 0)), { code: "modeMismatch", params: { mode: "r2i" } });
});

test("GPT Image 2.6 Flare bodies carry the documented parameters in a fixed order, and edits add the references as image_url", () => {
  const t2i = planGeneration(draft({ family: GPT, mode: "t2i" }), 0);
  assert.ok(t2i.ready);
  assert.equal(t2i.body, `{"model":"gpt-image-2.6-flare","prompt":"비 오는 밤거리","size":"1024x1024","quality":"medium","output_format":"png","background":"auto"}`);
  const r2i = planGeneration(
    draft({ family: GPT, mode: "r2i", images: [IMG, IMG2], prompt: " 이 제품을 대리석 위에 ", params: { aspect_ratio: "16:9", quality: "high", output_format: "webp", background: "transparent" } }),
    0,
  );
  assert.ok(r2i.ready);
  assert.equal(
    r2i.body,
    `{"model":"gpt-image-2.6-flare","prompt":"이 제품을 대리석 위에","size":"1536x864","quality":"high","output_format":"webp","background":"transparent","images":[{"image_url":"${IMG}"},{"image_url":"${IMG2}"}]}`,
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
      assert.equal(plan.endpoint, `openai/gpt-image-2.6-flare/${op}`);
      assert.equal(invalidImageRequest(op, plan.body), null, `${plan.endpoint} ${JSON.stringify(plan.body)}`);
      assert.equal("input_fidelity" in plan.body, false, "gpt-image-2 takes no input_fidelity");
    }
  }
});

test("GPT Image 2.6 Flare blockers: a prompt in both modes, at most 16 images and 32,000 characters, transparency only in PNG or WebP", () => {
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "t2i", prompt: " " }), 0)), { code: "promptRequired", params: { model: "GPT Image 2.6 Flare", mode: "t2i" } });
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "r2i", prompt: "", images: [IMG] }), 0)), { code: "promptRequired", params: { model: "GPT Image 2.6 Flare", mode: "r2i" } });
  const seventeen = Array.from({ length: 17 }, (_, i) => `https://cdn.test/${i}.png`);
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "r2i", images: seventeen }), 0)), { code: "tooManyImages", params: { model: "GPT Image 2.6 Flare", max: 16 } });
  ready(planGeneration(draft({ family: GPT, mode: "t2i", prompt: "가".repeat(32_000) }), 0));
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "t2i", prompt: "가".repeat(32_001) }), 0)), { code: "promptTooLong", params: { max: 32_000 } });
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "t2i", params: { background: "transparent", output_format: "jpeg" } }), 0)), { code: "transparentNeedsAlpha" });
  ready(planGeneration(draft({ family: GPT, mode: "t2i", params: { background: "transparent", output_format: "png" } }), 0));
  assert.deepEqual(blocked(planGeneration(draft({ family: GPT, mode: "t2i", params: { quality: "auto" } }), 0)), { code: "paramChoice", params: { param: "quality", options: "low | medium | high" } });
});

function gpt(params: Record<string, unknown>, extra: { promptChars?: number; inputImages?: number; usage?: TokenUsage } = {}) {
  return { family: GPT, mode: (extra.inputImages ? "r2i" : "t2i") as Mode, params: { ...defaultParams(GPT), ...params }, inputVideoS: 0, ...extra };
}

test("cost: at $30 per 1M output tokens, Image 2.6 retains the historical Image 2 pre-generation estimate heuristic", () => {
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
  assert.equal(costUsd(FAMILIES[GPT].rate.example, FAMILIES[GPT].rate.defaultUsd), 0.053, "the admin page's example at the default rate");
});

test("cost: with usage, GPT Image 2.6 Flare is priced from OpenAI's token counts at text $5, image input $8 and output $30 per 1M", () => {
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
  assert.deepEqual(plan.facts, [
    { kind: "token", text: "1024×1024" },
    { kind: "token", text: "medium" },
    { kind: "refImages", count: 2 },
  ]);
  const video = planGeneration(draft({ mode: "r2v", videos: [{ url: VID, seconds: 3 }], params: { resolution: "720p", duration: 6 } }), 0.0985);
  assert.deepEqual(video.facts, [
    { kind: "seconds", seconds: 6 },
    { kind: "token", text: "720p" },
    { kind: "inputVideo", seconds: 3 },
  ]);
  const h3 = planGeneration(draft({ family: H3, mode: "r2v", videos: [{ url: VID, seconds: 3 }], params: { duration: 10 } }), 0.065);
  assert.deepEqual(h3.facts, [{ kind: "seconds", seconds: 10 }], "H3 bills no input seconds and has one resolution, so neither is a fact");
});

test("stored image endpoints read as GPT Image 2.6 Flare, an image model of OpenAI", () => {
  for (const [id, mode] of [["openai/gpt-image-2.6-flare/generations", "t2i"], ["openai/gpt-image-2.6-flare/edits", "r2i"]] as const) {
    const m = describeModel(id);
    assert.deepEqual([m.name, m.group, m.family, m.mode, m.provider, m.output], ["GPT Image 2.6 Flare", GPT, GPT, mode, "openai", "image"]);
  }
  const seedance = describeModel("bytedance/seedance-2.0/text-to-video");
  assert.deepEqual([seedance.provider, seedance.output], ["higgsfield", "video"]);
  const hailuo = describeModel("minimax/hailuo-2.3/standard/image-to-video");
  assert.deepEqual([hailuo.provider, hailuo.output], ["higgsfield", "video"]);
});

type Tree = { [key: string]: string | Tree };
const MESSAGES = LOCALES.map((locale) => ({ locale, tree: JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")) as Tree }));

function message(tree: Tree, key: string): string | undefined {
  const found = key.split(".").reduce<Tree | string | undefined>((node, part) => (typeof node === "object" ? node[part] : undefined), tree);
  return typeof found === "string" && found.length > 0 ? found : undefined;
}

test("every parameter a model takes, and the retired Hailuo's prompt_optimizer, has a label in all three languages", () => {
  const keys = new Set([...FAMILY_IDS.flatMap((f) => FAMILIES[f].params.map((p) => p.key)), "prompt_optimizer"]);
  for (const { locale, tree } of MESSAGES) for (const key of keys) assert.ok(message(tree, `params.${key}`), `${locale} params.${key}`);
});

test("quality, output format and background name every option a model offers, in all three languages", () => {
  for (const key of ["quality", "output_format", "background"]) {
    const options = FAMILY_IDS.flatMap((f) => FAMILIES[f].params).flatMap((p) => (p.key === key && p.type === "enum" ? p.options : []));
    assert.ok(options.length > 0, `a model offers ${key}`);
    for (const { locale, tree } of MESSAGES) {
      const [select, ...rest] = parse(message(tree, `paramValues.${key}`) ?? "");
      assert.ok(select?.type === TYPE.select && select.value === "value" && rest.length === 0, `${locale} paramValues.${key} is one select on value`);
      for (const option of options) assert.ok(option in select.options, `${locale} paramValues.${key} names ${option}`);
    }
  }
});

test("every model has a price basis and an example, and every published price a label, in all three languages", () => {
  for (const { locale, tree } of MESSAGES) {
    for (const f of FAMILY_IDS.map((id) => FAMILIES[id])) {
      for (const key of [`prices.basis.${f.key}`, `prices.example.${f.key}`]) assert.ok(message(tree, key), `${locale} ${key}`);
      for (const p of f.rate.published) assert.ok(message(tree, `prices.preset.${p.preset}`), `${locale} prices.preset.${p.preset}`);
    }
  }
});

test("every format an image result is stored in is one each model takes as an image reference, so reusing a result needs no type check", () => {
  const spec = FAMILIES["openai/gpt-image-2.6-flare"].params.find((p) => p.key === "output_format");
  assert.ok(spec?.type === "enum");
  for (const f of FAMILY_IDS) for (const format of spec.options) assert.ok(FAMILIES[f].refImages.types.includes(`image/${format}`), `${f} takes image/${format}`);
});

test("every mode has a name in all three languages", () => {
  for (const { locale, tree } of MESSAGES) for (const m of MODES) assert.ok(message(tree, `mode.${m}`), `${locale} mode.${m}`);
});

test("historical Image 2 results remain images with their original name", () => {
  for (const op of ["generations", "edits"]) {
    const label = describeModel(`openai/gpt-image-2/${op}`);
    assert.equal(label.name, "GPT Image 2");
    assert.equal(label.output, "image");
    assert.equal(label.provider, "openai");
    assert.equal(label.mode, op === "edits" ? "r2i" : "t2i");
    assert.ok(endpointsOfProvider("openai").includes(`openai/gpt-image-2/${op}`));
  }
});
