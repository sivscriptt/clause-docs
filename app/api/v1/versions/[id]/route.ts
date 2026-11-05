import { api } from "@/lib/api/handler";
import { getVersion } from "@/lib/service";

export const GET = api<{ id: string }>(({ db, actor, params }) => getVersion(db, actor, params.id));
