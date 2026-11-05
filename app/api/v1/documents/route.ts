import { api, json } from "@/lib/api/handler";
import type { Doc } from "@/lib/doc/types";
import { createDocument, listDocuments } from "@/lib/service";

export const GET = api(({ db, actor, req }) => listDocuments(db, actor, new URL(req.url).searchParams.get("q") ?? ""));

export const POST = api(async ({ db, actor, req }) => {
  const b = await json<{ metadata: unknown; content?: Doc }>(req);
  return createDocument(db, actor, b.metadata, b.content ?? { type: "doc", content: [] });
}, 201);
