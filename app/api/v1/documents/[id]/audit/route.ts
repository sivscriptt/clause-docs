import { api } from "@/lib/api/handler";
import { auditTrail } from "@/lib/service";

export const GET = api<{ id: string }>(({ db, actor, params }) => auditTrail(db, actor, params.id));
