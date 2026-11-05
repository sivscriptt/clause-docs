"use client";

import { useTransition } from "react";
import { switchUser } from "@/app/actions";

type U = { id: string; name: string; roles: string[] };

export function RoleSwitcher({ users, current }: { users: U[]; current: string }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted max-sm:sr-only">Signed in as</span>
      <select
        className="h-9 rounded-md border border-line-strong bg-white ps-2 pe-8 text-sm font-medium text-ink disabled:opacity-60"
        value={current}
        disabled={pending}
        onChange={(e) => start(() => switchUser(e.target.value))}
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.roles.join(", ")})
          </option>
        ))}
      </select>
    </label>
  );
}
