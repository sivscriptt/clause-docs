import { api, json } from "@/lib/api/handler";
import { updateMetadata } from "@/lib/service";

export const PUT = api<{ id: string }>(async ({ db, actor, req, params }) => {
  await updateMetadata(db, actor, params.id, await json(req));
});
