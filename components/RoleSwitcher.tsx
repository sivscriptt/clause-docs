"use client";

import { useOptimistic, useTransition } from "react";
import { switchUser } from "@/app/actions";
import { confirmDiscard } from "@/lib/unsaved";

type U = { id: string; name: string; roles: string[] };

const label = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/** One button per demo person, labelled by their role. The pressed one is who you are. */
export function RoleSwitcher({ users, current }: { users: U[]; current: string }) {
  const [pending, start] = useTransition();
  const [active, setActive] = useOptimistic(current);
  const me = users.find((u) => u.id === active);

  return (
    <div className="flex items-center gap-x-3 max-sm:w-full">
      <p className="text-sm text-muted max-md:hidden" aria-live="polite">
        Signed in as <span className="font-medium text-ink">{me?.name}</span>
      </p>
      <div role="group" aria-label="View as" className="flex flex-wrap justify-center gap-y-1 rounded-full border border-line bg-paper p-1 max-sm:w-full max-sm:rounded-2xl" aria-busy={pending}>
        {users.map((u) => {
          const on = u.id === active;
          return (
            <button
              key={u.id}
              type="button"
              aria-pressed={on}
              title={u.name}
              disabled={pending && !on}
              onClick={() => {
                if (on || !confirmDiscard()) return;
                start(async () => {
                  setActive(u.id);
                  await switchUser(u.id);
                });
              }}
              className={`h-8 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-[background-color,color,scale] duration-150 ease-out motion-safe:enabled:active:scale-[0.96] max-sm:px-2.5 ${
                on ? "bg-ink text-white" : "text-muted hover:bg-white hover:text-ink"
              }`}
            >
              {label(u.roles[0])}
            </button>
          );
        })}
      </div>
    </div>
  );
}
