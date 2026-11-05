import { openapi } from "@/lib/api/openapi";

export const GET = () => Response.json(openapi);
