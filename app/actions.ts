"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { DEMO_COOKIE } from "@/lib/auth";
import { withDb } from "@/lib/db/client";
import { ServiceError } from "@/lib/errors";
import type { Doc } from "@/lib/doc/types";
import type { Action } from "@/lib/lifecycle/machine";
import type { Target } from "@/lib/lifecycle/version";
import * as svc from "@/lib/service";
import { requireActor } from "@/lib/session";

export type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: (db: Parameters<Parameters<typeof withDb>[0]>[0]) => Promise<T>, path?: string): Promise<Result<T>> {
  try {
    const data = await withDb(fn);
    if (path) revalidatePath(path);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong on our side. Your work is not lost; try again in a moment." };
  }
}

export async function switchUser(id: string) {
  (await cookies()).set(DEMO_COOKIE, id, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
  revalidatePath("/", "layout");
}

export const transitionAction = async (docId: string, versionId: string, action: Action) =>
  run(async (db) => svc.transition(db, await requireActor(db), versionId, action), `/docs/${docId}`);

export const saveAction = async (docId: string, versionId: string, content: Doc) =>
  run(async (db) => svc.saveContent(db, await requireActor(db), versionId, content), `/docs/${docId}`);

export const reviseAction = async (docId: string, target: Target) =>
  run(async (db) => svc.createRevision(db, await requireActor(db), docId, target), `/docs/${docId}`);

export const commentAction = async (
  docId: string,
  versionId: string,
  input: { body: string; clauseId?: string | null; parentId?: string | null; critical?: boolean },
) => run(async (db) => svc.addComment(db, await requireActor(db), versionId, input), `/docs/${docId}`);

export const resolveAction = async (docId: string, commentId: string) =>
  run(async (db) => svc.resolveComment(db, await requireActor(db), commentId), `/docs/${docId}`);
