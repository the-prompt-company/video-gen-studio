import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type UsageSummary = {
  generations: number;
  completed: number;
  failed: number;
  totalCostUsd: number;
  totalSeconds: number;
  last30dCostUsd: number;
  byModel: { modelId: string; count: number; costUsd: number }[];
  byDay: { day: string; count: number; costUsd: number }[];
};

export async function usageFor(userId: number | null): Promise<UsageSummary> {
  const db = getDb();
  const g = schema.generations;
  const scope = userId === null ? undefined : eq(g.userId, userId);
  const since = new Date(Date.now() - 30 * 86400_000);

  const [totals] = await db
    .select({
      generations: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${g.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${g.status} in ('failed','nsfw'))::int`,
      totalCostUsd: sql<number>`coalesce(sum(${g.costUsd}), 0)::float`,
      totalSeconds: sql<number>`coalesce(sum(${g.durationS}) filter (where ${g.status} = 'completed'), 0)::int`,
    })
    .from(g)
    .where(scope);

  const [recent] = await db
    .select({ cost: sql<number>`coalesce(sum(${g.costUsd}), 0)::float` })
    .from(g)
    .where(scope ? and(scope, gte(g.createdAt, since)) : gte(g.createdAt, since));

  const byModel = await db
    .select({
      modelId: g.modelId,
      count: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${g.costUsd}), 0)::float`,
    })
    .from(g)
    .where(scope)
    .groupBy(g.modelId)
    .orderBy(desc(sql`count(*)`));

  const byDay = await db
    .select({
      day: sql<string>`to_char(${g.createdAt} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${g.costUsd}), 0)::float`,
    })
    .from(g)
    .where(scope ? and(scope, gte(g.createdAt, since)) : gte(g.createdAt, since))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return {
    generations: totals?.generations ?? 0,
    completed: totals?.completed ?? 0,
    failed: totals?.failed ?? 0,
    totalCostUsd: totals?.totalCostUsd ?? 0,
    totalSeconds: totals?.totalSeconds ?? 0,
    last30dCostUsd: recent?.cost ?? 0,
    byModel,
    byDay,
  };
}

export type UserUsageRow = {
  id: number;
  username: string;
  role: string;
  active: boolean;
  hasApiKey: boolean;
  note: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  generations: number;
  completed: number;
  totalCostUsd: number;
  lastUsedAt: Date | null;
};

export async function usageByUser(): Promise<UserUsageRow[]> {
  const db = getDb();
  const u = schema.users;
  const g = schema.generations;
  return db
    .select({
      id: u.id,
      username: u.username,
      role: u.role,
      active: u.active,
      hasApiKey: sql<boolean>`${u.apiKeyEnc} is not null`,
      note: u.note,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      generations: sql<number>`count(${g.id})::int`,
      completed: sql<number>`count(${g.id}) filter (where ${g.status} = 'completed')::int`,
      totalCostUsd: sql<number>`coalesce(sum(${g.costUsd}), 0)::float`,
      lastUsedAt: sql<Date | null>`max(${g.createdAt})`,
    })
    .from(u)
    .leftJoin(g, eq(g.userId, u.id))
    .groupBy(u.id)
    .orderBy(u.id);
}
