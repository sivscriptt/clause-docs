import { api } from "@/lib/api/handler";
import { getDocument } from "@/lib/service";

export const GET = api<{ id: string }>(async ({ db, actor, params }) => {
  const d = await getDocument(db, actor, params.id);
  return {
    ...d,
    versions: d.versions.map((v) => {
      const meta: Partial<typeof v> = { ...v };
      delete meta.content;
      return meta;
    }),
  };
});
