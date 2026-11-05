import { api, json } from "@/lib/api/handler";
import type { Target } from "@/lib/lifecycle/version";
import { createRevision } from "@/lib/service";

export const POST = api<{ id: string }>(async ({ db, actor, req, params }) => {
  const { target } = await json<{ target: Target }>(req);
  return createRevision(db, actor, params.id, target);
}, 201);
