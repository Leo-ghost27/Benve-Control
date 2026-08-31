type HistoryEntry = {
  id: string;
  action: string;
  entity_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function describeEntry(entry: HistoryEntry): string {
  const entity = entry.entity_type.replace(/_/g, " ");
  switch (entry.action) {
    case "created":
      return `${entity} created`;
    case "updated":
      return `${entity} updated`;
    case "status_changed":
      return `${entity} status changed to "${(entry.metadata?.status as string)?.replace(/_/g, " ") ?? "?"}"`;
    case "ai_assist_accepted":
      return `AI Assist generated draft for ${entry.metadata?.code ?? entity} – reviewed and accepted by ${entry.metadata?.actor_email ?? "auditor"}`;
    case "added":
      return `Step ${entry.metadata?.step_number ?? ""} added`;
    case "deleted":
      return `${entity} deleted`;
    case "reordered":
      return `Test steps reordered`;
    case "submitted":
      return `Evidence submitted by ${entry.metadata?.submitted_by ?? "client"} (${entry.metadata?.file_name ?? "file"})`;
    case "accepted":
      return `Evidence accepted${entry.metadata?.comment ? `: "${entry.metadata.comment}"` : ""}`;
    case "clarification_requested":
      return `Clarification requested: "${entry.metadata?.comment ?? ""}"`;
    case "rejected":
      return `Evidence rejected: "${entry.metadata?.comment ?? ""}"`;
    case "linked_to_test_step":
      return entry.metadata?.test_step_id
        ? "Linked to a test step"
        : "Unlinked from test step";
    default:
      return `${entity} ${entry.action}`;
  }
}

export function ChangeHistory({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-mute">
        No changes recorded yet.
      </div>
    );
  }

  return (
    <ul className="space-y-0 rounded-lg border border-line bg-panel">
      {entries.map((entry, i) => (
        <li
          key={entry.id}
          className={`flex items-center justify-between gap-3 px-4 py-2.5 text-xs ${
            i !== entries.length - 1 ? "border-b border-line" : ""
          }`}
        >
          <span className="text-paper">{describeEntry(entry)}</span>
          <span className="shrink-0 font-mono text-mute">
            {new Date(entry.created_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}
