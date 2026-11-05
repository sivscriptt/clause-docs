import type { State } from "@/lib/lifecycle/machine";

const LOOK: Record<State, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-white text-ink ring-line-strong" },
  in_review: { label: "In review", cls: "bg-accent-soft text-accent ring-accent/30" },
  changes_requested: { label: "Changes requested", cls: "bg-warn-bg text-warn ring-warn/30" },
  pending_approval: { label: "Awaiting approval", cls: "bg-accent-soft text-accent ring-accent/30" },
  approved: { label: "Approved", cls: "bg-ins-bg text-ins ring-ins/30" },
  active: { label: "Active", cls: "bg-ins text-white ring-ins" },
  superseded: { label: "Superseded", cls: "bg-paper text-muted ring-line-strong" },
  retired: { label: "Retired", cls: "bg-paper text-muted ring-line-strong" },
};

export const stateLabel = (s: State) => LOOK[s].label;

export function StateBadge({ state }: { state: State }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${LOOK[state].cls}`}>
      {LOOK[state].label}
    </span>
  );
}
