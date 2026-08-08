export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10 xl:px-12">
      <div role="status" aria-label="Loading Atlas" className="space-y-5">
        <div className="h-10 w-48 rounded-xl bg-surface-raised" />
        <div className="h-4 w-80 max-w-full rounded-lg bg-surface-raised" />
        <div className="grid gap-5 pt-4 lg:grid-cols-[1.5fr_0.8fr]">
          <div className="atlas-panel atlas-skeleton min-h-72 rounded-3xl" />
          <div className="atlas-panel atlas-skeleton min-h-72 rounded-3xl" />
        </div>
        <span className="sr-only">Atlas is loading the selected workspace.</span>
      </div>
    </div>
  );
}
