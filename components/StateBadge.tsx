import { stateLabel } from "@/lib/lifecycle/labels";
import type { State } from "@/lib/lifecycle/machine";

const LOOK: Record<State, { cls: string }> = {
  draft: { cls: "bg-white text-ink ring-line-strong" },
  in_review: { cls: "bg-accent-soft text-accent ring-accent/30" },
  changes_requested: { cls: "bg-warn-bg text-warn ring-warn/30" },
  pending_approval: { cls: "bg-accent-soft text-accent ring-accent/30" },
  approved: { cls: "bg-ins-bg text-ins ring-ins/30" },
  active: { cls: "bg-ins text-white ring-ins" },
  superseded: { cls: "bg-paper text-muted ring-line-strong" },
  retired: { cls: "bg-paper text-muted ring-line-strong" },
};

export { stateLabel };

export function StateBadge({ state }: { state: State }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${LOOK[state].cls}`}>
      {stateLabel(state)}
    </span>
  );
}
