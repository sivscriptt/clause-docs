import { api, json } from "@/lib/api/handler";
import { addComment, getVersion, listComments } from "@/lib/service";

export const GET = api<{ id: string }>(async ({ db, actor, params }) => {
  await getVersion(db, actor, params.id); // permission check
  return listComments(db, params.id);
});

export const POST = api<{ id: string }>(async ({ db, actor, req, params }) =>
  addComment(db, actor, params.id, await json(req)), 201);
