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
} from "drizzle-orm/pg-core";
import { GENERATION_STATUSES } from "../lib/generation-status";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  // Higgsfield "key-id:key-secret", encrypted at rest with AUTH_SECRET.
  apiKeyEnc: text("api_key_enc"),
  active: boolean("active").notNull().default(true),
  note: text("note"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

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
    imageRefs: jsonb("image_refs").$type<string[]>().notNull().default([]),
    videoRefs: jsonb("video_refs").$type<string[]>().notNull().default([]),
    status: text("status", { enum: GENERATION_STATUSES }).notNull().default("queued"),
    requestId: text("request_id"),
    resultUrl: text("result_url"),
    blobUrl: text("blob_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    durationS: integer("duration_s").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    error: text("error"),
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
