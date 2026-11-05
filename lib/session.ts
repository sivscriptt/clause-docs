import "server-only";
import { cookies } from "next/headers";
import type pg from "pg";
import { cache } from "react";
import { DEFAULT_DEMO_USER, DEMO_COOKIE, type Actor, type AuthProvider } from "./auth";
import { requestDb } from "./db/request";
import { getActor, listUsers } from "./service";

/** Demo auth: the role switcher sets a cookie. Swap for an OIDC provider in production. */
export const demoAuth: AuthProvider = {
  async currentUserId() {
    return (await cookies()).get(DEMO_COOKIE)?.value ?? DEFAULT_DEMO_USER;
  },
};

export async function requireActor(db: pg.Client): Promise<Actor> {
  const actor = (await getActor(db, await demoAuth.currentUserId())) ?? (await getActor(db, DEFAULT_DEMO_USER));
  if (!actor) throw new Error("Demo users are missing. Run the seed.");
  return actor;
}

/** Signed-in actor and the user list, once per request. */
export const session = cache(async () => {
  // Read the cookie first: it marks the route as per-request before any
  // database work, so builds never try to prerender with a live connection.
  const id = await demoAuth.currentUserId();
  const db = await requestDb();
  const users = await listUsers(db);
  const me = users.find((u) => u.id === id) ?? users.find((u) => u.id === DEFAULT_DEMO_USER);
  if (!me) throw new Error("Demo users are missing. Run the seed.");
  return { db, me, users };
});
