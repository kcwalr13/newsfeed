'use client';

import { useState } from 'react';

/**
 * Duotone hero image for the article reader. A small client component so it can
 * hide itself when the image URL fails to load (onError), instead of leaving an
 * empty duotone box on the server-rendered page (R2-26).
 */
export default function HeroImage({ src, maxHeight = 280 }: { src: string; maxHeight?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <div
      className="ql-duotone-wrapper rounded-sm overflow-hidden mb-6"
      style={{ maxHeight }}
    >
      {/* Above the fold (likely LCP) — keep eager, but reserve the box via
          aspect-ratio and decode off the main thread. */}
      <img
        src={src}
        alt=""
        className="w-full object-cover"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ aspectRatio: '16 / 9', maxHeight }}
      />
      <div className="ql-duotone-shadow" />
      <div className="ql-duotone-highlight" />
    </div>
  );
}
