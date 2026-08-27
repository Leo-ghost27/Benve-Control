type ErrorStateProps = {
  message?: string;
};

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-rose-900/50 bg-rose-950/20 px-6 py-16 text-center">
      <p className="text-sm font-semibold text-rose-400">
        Couldn&apos;t load this data
      </p>
      <p className="mt-1.5 max-w-sm text-sm text-mute">
        {message ?? "Something went wrong talking to the database. Try refreshing the page."}
      </p>
    </div>
  );
}
