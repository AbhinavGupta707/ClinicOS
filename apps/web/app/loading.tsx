export default function Loading() {
  return (
    <main className="boot-screen" aria-busy="true" aria-live="polite">
      <div className="boot-shell">
        <div className="skeleton-line skeleton-line--short" />
        <div className="skeleton-line" />
        <div className="skeleton-grid">
          <div />
          <div />
          <div />
        </div>
      </div>
    </main>
  );
}
