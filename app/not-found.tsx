import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-5"
      style={{ background: 'var(--bg)' }}
    >
      <div className="max-w-md w-full text-center py-16">
        <p
          className="ql-mono mb-6"
          style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.2em' }}
        >
          TANGENT · NOT ON FILE
        </p>

        <hr className="ql-rule mb-8" />

        <h1
          className="ql-serif"
          style={{
            fontSize: '28px',
            fontStyle: 'italic',
            fontWeight: 500,
            lineHeight: 1.3,
            color: 'var(--fg)',
            marginBottom: '16px',
          }}
        >
          This page has wandered off the shelf.
        </h1>

        <p
          className="ql-serif"
          style={{
            fontSize: '16px',
            fontStyle: 'italic',
            color: 'var(--muted)',
            lineHeight: 1.6,
            marginBottom: '32px',
          }}
        >
          Whatever was here isn&rsquo;t in any issue we have on file. It may
          have been removed, or the address may be mistyped.
        </p>

        <hr className="ql-rule mb-8" />

        <div className="flex items-center justify-center gap-8">
          <Link
            href="/"
            className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm py-2"
            style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.16em', textDecoration: 'none' }}
          >
            ← TODAY&rsquo;S ISSUE
          </Link>
          <Link
            href="/archive"
            className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm py-2"
            style={{ fontSize: '9px', color: 'var(--accent)', letterSpacing: '0.16em', textDecoration: 'none' }}
          >
            THE ARCHIVE →
          </Link>
        </div>
      </div>
    </div>
  );
}
