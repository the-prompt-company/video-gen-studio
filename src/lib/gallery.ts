import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Generation, User } from "@/db/schema";
import { publicGeneration, type PublicGeneration } from "./generations";
import { parseScopeFilter, resolveScope, SCOPE_FILTERS, scopeCondition, viewerOf, type Scope, type ScopeFilter, type Viewer } from "./scope";

const OFFERED: Record<ScopeFilter, (v: Viewer) => boolean> = {
  mine: () => true,
  team: (v) => v.role !== "admin" && v.team !== null,
  all: (v) => v.role !== "admin" && v.team !== null,
  everyone: (v) => v.role === "admin",
};

export function galleryFilters(viewer: Viewer): readonly ScopeFilter[] {
  return SCOPE_FILTERS.filter((f) => OFFERED[f](viewer));
}

export function chooseView(viewer: Viewer, raw: unknown): { filter: ScopeFilter; scope: Scope } {
  const asked = parseScopeFilter(raw);
  const scope = asked && OFFERED[asked](viewer) ? resolveScope(viewer, asked) : null;
  return asked && scope ? { filter: asked, scope } : { filter: "mine", scope: resolveScope(viewer, "mine") };
}

export function galleryHref(filter: ScopeFilter): string {
  return filter === "mine" ? "/gallery" : `/gallery?scope=${filter}`;
}

export type OwnerLabel = { kind: "self" } | { kind: "nickname"; name: string } | { kind: "teammate" } | { kind: "login"; id: string };

export function ownerLabel(
  viewer: Pick<Viewer, "id" | "role">,
  filter: ScopeFilter,
  owner: { id: number; nickname: string | null; username: string },
): OwnerLabel | null {
  if (viewer.role === "admin") return { kind: "login", id: owner.username };
  if (filter === "mine") return null;
  if (owner.id === viewer.id) return { kind: "self" };
  return owner.nickname ? { kind: "nickname", name: owner.nickname } : { kind: "teammate" };
}

export type GalleryItem = Omit<PublicGeneration, "username"> & { owner: OwnerLabel | null };

export type GalleryTab = { filter: ScopeFilter; href: string };

export type GalleryProps = { items: GalleryItem[]; filter: ScopeFilter; tabs: readonly GalleryTab[] };

export type GalleryRow = { g: Generation; nickname: string | null; username: string };

export function galleryProps(viewer: Viewer, filter: ScopeFilter, rows: readonly GalleryRow[]): GalleryProps {
  return {
    items: rows.map(({ g, nickname, username }) => ({ ...publicGeneration(g), owner: ownerLabel(viewer, filter, { id: g.userId, nickname, username }) })),
    filter,
    tabs: galleryFilters(viewer).map((f) => ({ filter: f, href: galleryHref(f) })),
  };
}

export async function loadGallery(user: Pick<User, "id" | "role" | "teamId">, query: Record<string, string | string[] | undefined>): Promise<GalleryProps> {
  const viewer = await viewerOf(user);
  const { filter, scope } = chooseView(viewer, query.scope);
  const g = schema.generations;
  const u = schema.users;
  const rows = await getDb()
    .select({ g, nickname: u.nickname, username: u.username })
    .from(g)
    .innerJoin(u, eq(u.id, g.userId))
    .where(and(scopeCondition(scope), eq(g.status, "completed")))
    .orderBy(desc(g.createdAt))
    .limit(120);
  return galleryProps(viewer, filter, rows);
}
