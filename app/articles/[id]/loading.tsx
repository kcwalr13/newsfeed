/**
 * Reader-route loading skeleton (FE-M6) — mirrors the article page layout
 * (sticky header bar, meta line, hero block, title, body paragraphs) so the
 * swap to real content doesn't shift the page.
 */
export default function ArticleLoading() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <header
        className="sticky top-0 z-10"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--rule)' }}
      >
        <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="h-3 w-14 rounded" style={{ background: 'var(--dim)', opacity: 0.3 }} />
          <div className="h-3 w-16 rounded" style={{ background: 'var(--dim)', opacity: 0.3 }} />
          <div className="h-3 w-16 rounded" style={{ background: 'var(--dim)', opacity: 0.3 }} />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5">
        <div className="animate-pulse pt-8 pb-6 space-y-6">
          <div className="h-3 w-48 rounded" style={{ background: 'var(--dim)', opacity: 0.3 }} />
          <div className="h-56 rounded-sm" style={{ background: 'var(--dim)', opacity: 0.15 }} />
          <div className="space-y-3">
            <div className="h-8 w-5/6 rounded" style={{ background: 'var(--dim)', opacity: 0.2 }} />
            <div className="h-8 w-2/3 rounded" style={{ background: 'var(--dim)', opacity: 0.2 }} />
          </div>
          <div className="space-y-3 pt-4">
            <div className="h-4 w-full rounded" style={{ background: 'var(--dim)', opacity: 0.12 }} />
            <div className="h-4 w-full rounded" style={{ background: 'var(--dim)', opacity: 0.12 }} />
            <div className="h-4 w-11/12 rounded" style={{ background: 'var(--dim)', opacity: 0.12 }} />
            <div className="h-4 w-full rounded" style={{ background: 'var(--dim)', opacity: 0.12 }} />
            <div className="h-4 w-3/4 rounded" style={{ background: 'var(--dim)', opacity: 0.12 }} />
          </div>
        </div>
      </main>
    </div>
  );
}
