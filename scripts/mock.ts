/**
 * Mock generations for looking at the playground feed, gallery and dashboard
 * with real-shaped data before any Higgsfield key is assigned.
 *
 *   npm run db:mock            # insert rows for MOCK_USERNAME (default: ADMIN_USERNAME)
 *   npm run db:mock -- --clear # delete every mock row (prompt starts with "[목업]")
 *
 * Media lives in public/mock/ (generated locally, labelled 목업). Rows never get a
 * request_id, so nothing ever calls Higgsfield for them.
 */
import { eq, like, and } from "drizzle-orm";
import { getDb, schema } from "../src/db";

const TAG = "[목업]";
const username = process.env.MOCK_USERNAME ?? process.env.ADMIN_USERNAME ?? "admin";
const clear = process.argv.includes("--clear");

const h = (n: number) => n * 3600_000;
const d = (n: number) => n * 86400_000;

type Row = typeof schema.generations.$inferInsert;

function rows(userId: number): Row[] {
  const now = Date.now();
  const at = (ago: number, took = 0) => ({
    createdAt: new Date(now - ago),
    completedAt: took ? new Date(now - ago + took) : null,
    expiresAt: new Date(now - ago + d(7)),
  });
  return [
    {
      userId, modelId: "kling-video/v3.0/std/image-to-video", status: "completed",
      prompt: `${TAG} 비 내리는 서울 밤거리, 네온 간판이 젖은 아스팔트에 비치고, 카메라가 천천히 앞으로 돌리한다`,
      params: { duration: 5, sound: "off", cfg_scale: 0.5 },
      imageRefs: ["/mock/ref-landscape-1.jpg", "/mock/ref-landscape-2.jpg"], videoRefs: [],
      resultUrl: "/mock/result-landscape.webm", durationS: 5, costUsd: "0.2250", ...at(h(2), 48_000),
    },
    {
      userId, modelId: "bytedance/seedance-2.5/reference-to-video", status: "completed",
      prompt: `${TAG} 세로 숏폼: 카페 창가에서 라떼 아트를 완성하는 손, 자연광, 느린 틸트업`,
      params: { duration: 8, resolution: "1080p", aspect_ratio: "9:16", bitrate_mode: "high", generate_audio: true },
      imageRefs: ["/mock/ref-portrait-1.jpg", "/mock/ref-portrait-2.jpg", "/mock/ref-portrait-3.jpg"], videoRefs: ["/mock/ref-video.webm"],
      resultUrl: "/mock/result-portrait.webm", durationS: 8, costUsd: "0.4800", ...at(h(5), 71_000),
    },
    {
      userId, modelId: "alibaba/wan-3.0/reference-to-video", status: "completed",
      prompt: `${TAG} 정사각 제품 턴테이블: 무광 검정 스피커가 360도 회전, 스튜디오 조명`,
      params: { duration: 6, resolution: "1080p", aspect_ratio: "1:1", seed: 42, enable_thinking: false },
      imageRefs: ["/mock/ref-square.jpg"], videoRefs: [],
      resultUrl: "/mock/result-square.webm", durationS: 6, costUsd: "0.2280", ...at(d(1) + h(3), 64_000),
    },
    {
      userId, modelId: "bytedance/seedance-2.5/reference-to-video", status: "completed",
      prompt: `${TAG} 시네마 21:9 드론 샷, 노을 지는 해안도로를 따라 달리는 흰색 차`,
      params: { duration: 10, resolution: "1080p", aspect_ratio: "21:9", bitrate_mode: "high", generate_audio: false },
      imageRefs: ["/mock/ref-landscape-1.jpg"], videoRefs: [],
      resultUrl: "/mock/result-cinema.webm", durationS: 10, costUsd: "0.6000", ...at(d(2), 95_000),
    },
    {
      userId, modelId: "kling-video/v3.0/std/image-to-video", status: "failed",
      prompt: `${TAG} 군중 속 인물 클로즈업, 얼굴 교체`,
      params: { duration: 5, sound: "off", cfg_scale: 0.5 },
      imageRefs: ["/mock/ref-landscape-2.jpg"], videoRefs: [],
      error: "콘텐츠 정책에 걸려 생성이 거부됐습니다", durationS: 5, costUsd: "0", ...at(d(2) + h(6), 12_000),
    },
    {
      userId, modelId: "alibaba/wan-3.0/reference-to-video", status: "nsfw",
      prompt: `${TAG} 해변 파티 장면, 수영복 인물 다수`,
      params: { duration: 5, resolution: "720p", aspect_ratio: "16:9", seed: -1, enable_thinking: false },
      imageRefs: [], videoRefs: [],
      error: "NSFW 필터에 차단됐습니다", durationS: 5, costUsd: "0", ...at(d(3), 9_000),
    },
    {
      userId, modelId: "bytedance/seedance-2.5/reference-to-video", status: "canceled",
      prompt: `${TAG} 눈 내리는 산장 타임랩스 (취소함)`,
      params: { duration: 5, resolution: "720p", aspect_ratio: "16:9", bitrate_mode: "standard", generate_audio: false },
      imageRefs: ["/mock/ref-landscape-1.jpg"], videoRefs: [],
      durationS: 5, costUsd: "0", ...at(d(4)),
    },
    {
      userId, modelId: "kling-video/v3.0/std/image-to-video", status: "completed",
      prompt: `${TAG} 안개 낀 숲길을 걷는 뒷모습, 핸드헬드, 필름 그레인`,
      params: { duration: 5, sound: "on", cfg_scale: 0.6, negative_prompt: "텍스트, 워터마크" },
      imageRefs: ["/mock/ref-landscape-2.jpg"], videoRefs: [],
      resultUrl: "/mock/result-landscape.webm", durationS: 5, costUsd: "0.2250", ...at(d(6), 52_000),
    },
  ];
}

async function main() {
  const db = getDb();
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, username)).limit(1);
  if (!u) throw new Error(`user "${username}" not found (set MOCK_USERNAME)`);

  const removed = await db
    .delete(schema.generations)
    .where(and(eq(schema.generations.userId, u.id), like(schema.generations.prompt, `${TAG}%`)))
    .returning({ id: schema.generations.id });
  console.log(`removed ${removed.length} existing mock rows for ${username}`);
  if (clear) return;

  const inserted = await db.insert(schema.generations).values(rows(u.id)).returning({ id: schema.generations.id });
  console.log(`inserted ${inserted.length} mock rows for ${username}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
