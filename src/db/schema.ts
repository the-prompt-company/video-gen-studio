import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { LOCALES, type Locale } from "../i18n/locale";
import type { WireBody } from "../lib/catalog";
import type { ErrorCode, ErrorParams } from "../lib/errors";
import { GENERATION_STATUSES } from "../lib/generation-status";
import type { RequestId } from "../lib/higgsfield";
import type { ObjectKey } from "../lib/storage";
import type { TeamId } from "../lib/teams";

export const teams = pgTable(
  "teams",
  {
    id: serial("id").$type<TeamId>().primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("teams_name_lower_key").on(sql`lower(${t.name})`), check("teams_name_not_blank", sql`btrim(${t.name}) <> ''`)],
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    nickname: text("nickname"),
    avatarKey: text("avatar_key").$type<ObjectKey>(),
    passwordHash: text("password_hash").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    teamId: integer("team_id").$type<TeamId>().references(() => teams.id, { onDelete: "set null" }),
    // Higgsfield "key-id:key-secret", encrypted at rest with AUTH_SECRET.
    apiKeyEnc: text("api_key_enc"),
    active: boolean("active").notNull().default(true),
    note: text("note"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** The member's chosen language. Null until they choose, and then the cookie or the browser decides. */
    locale: text("locale").$type<Locale>(),
  },
  (t) => [check("users_locale_check", sql`${t.locale} in (${sql.raw(LOCALES.map((l) => `'${l}'`).join(", "))})`)],
);

export const models = pgTable("models", {
  modelId: text("model_id").primaryKey(),
  name: text("name").notNull(),
  pricePerSecUsd: numeric("price_per_sec_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  enabled: boolean("enabled").notNull().default(true),
  note: text("note"),
});

export const generations = pgTable(
  "generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("user_id").notNull().references(() => users.id),
    modelId: text("model_id").notNull(),
    prompt: text("prompt").notNull().default(""),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * The exact JSON text the first submit sent to model_id, written once at insert. Every resend sends these bytes, so
     * a later deploy cannot change what a row Higgsfield may already hold asks for. Null on rows inserted before 0007.
     */
    requestBody: text("request_body").$type<WireBody>(),
    imageRefs: jsonb("image_refs").$type<string[]>().notNull().default([]),
    videoRefs: jsonb("video_refs").$type<string[]>().notNull().default([]),
    status: text("status", { enum: GENERATION_STATUSES }).notNull().default("pending"),
    requestId: text("request_id").$type<RequestId>(),
    /** Earliest time any caller may ask Higgsfield about this row. A conditional UPDATE on it is the per-row check claim. */
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Higgsfield may hold a job for this pending row although no answer said so: a submit timed out, lost its
     * connection or got a 5xx, or its submitter died holding the lease. A 429 refuses one attempt, not earlier ones, so
     * this never goes back to false. Only the same Idempotency-Key sent again can tell, so cancel and the deadline resend.
     */
    maybeAccepted: boolean("maybe_accepted").notNull().default(false),
    resultUrl: text("result_url"),
    /** Object key in the videos bucket, set only after the upload finished. Non-null means playable from storage. */
    storagePath: text("storage_path").$type<ObjectKey>(),
    sizeBytes: integer("size_bytes"),
    mirrorAttempts: integer("mirror_attempts").notNull().default(0),
    /** Copy lease and back-off in one column. A claim pushes it at least 360 s ahead, past every copying route's maxDuration. */
    mirrorNextAt: timestamp("mirror_next_at", { withTimezone: true }),
    mirrorError: text("mirror_error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    durationS: integer("duration_s").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    /**
     * Why the row failed, or why a pending row waits, in one of two forms that never both hold. `error` is text shown
     * as written (the provider's own words, or a Korean reason stored before 0010). `error_code` with `error_params` is
     * a reason the page translates. Only generations.ts writes them, all three at once.
     */
    error: text("error"),
    errorCode: text("error_code").$type<ErrorCode>(),
    errorParams: jsonb("error_params").$type<ErrorParams>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("generations_user_created_idx").on(t.userId, t.createdAt),
    index("generations_status_idx").on(t.status),
  ],
);

export type User = typeof users.$inferSelect;
export type Model = typeof models.$inferSelect;
export type Generation = typeof generations.$inferSelect;
