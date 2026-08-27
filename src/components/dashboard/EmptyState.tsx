type EmptyStateProps = {
  title: string;
  description: string;
  action?: { label: string; href: string };
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-16 text-center">
      <p className="text-sm font-semibold text-paper">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm text-mute">{description}</p>
      {action && (
        <a
          href={action.href}
          className="mt-5 rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
