import { api, json } from "@/lib/api/handler";
import type { Doc } from "@/lib/doc/types";
import { saveContent } from "@/lib/service";

export const PUT = api<{ id: string }>(async ({ db, actor, req, params }) => {
  const { content } = await json<{ content: Doc }>(req);
  await saveContent(db, actor, params.id, content);
});
