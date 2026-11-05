import "server-only";
import { cookies } from "next/headers";
import type pg from "pg";
import { DEFAULT_DEMO_USER, DEMO_COOKIE, type Actor } from "@/lib/auth";
import { withDb } from "@/lib/db/client";
import { ServiceError } from "@/lib/errors";
import { getActor } from "@/lib/service";

type Ctx<P> = { db: pg.Client; actor: Actor; req: Request; params: P };

/**
 * Wraps a route handler: resolves the caller, opens a connection, and maps
 * service errors to JSON problem responses. In the demo the caller comes from
 * an X-Demo-User header or the role-switcher cookie; production reads the OIDC session.
 */
export function api<P>(fn: (c: Ctx<P>) => Promise<unknown>, status = 200) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const params = await ctx.params;
      const id = req.headers.get("x-demo-user") ?? (await cookies()).get(DEMO_COOKIE)?.value ?? DEFAULT_DEMO_USER;
      const body = await withDb(async (db) => {
        const actor = await getActor(db, id);
        if (!actor) throw new ServiceError(401, "unauthenticated", "Unknown user.");
        return fn({ db, actor, req, params });
      });
      return body === undefined ? new Response(null, { status: 204 }) : Response.json(body, { status });
    } catch (e) {
      if (e instanceof ServiceError) return Response.json({ code: e.code, message: e.message }, { status: e.status });
      if (e instanceof SyntaxError) return Response.json({ code: "bad_json", message: "The request body is not valid JSON." }, { status: 400 });
      console.error(e);
      return Response.json({ code: "internal", message: "Something went wrong on our side." }, { status: 500 });
    }
  };
}

export const json = async <T>(req: Request): Promise<T> => (await req.json()) as T;
