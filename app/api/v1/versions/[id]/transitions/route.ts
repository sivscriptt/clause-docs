import { api, json } from "@/lib/api/handler";
import type { Action } from "@/lib/lifecycle/machine";
import { transition } from "@/lib/service";

export const POST = api<{ id: string }>(async ({ db, actor, req, params }) => {
  const { action, note } = await json<{ action: Action; note?: string }>(req);
  return transition(db, actor, params.id, action, note);
});
