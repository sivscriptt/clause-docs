import { api } from "@/lib/api/handler";
import { resolveComment } from "@/lib/service";

export const POST = api<{ id: string }>(async ({ db, actor, params }) => {
  await resolveComment(db, actor, params.id);
});
