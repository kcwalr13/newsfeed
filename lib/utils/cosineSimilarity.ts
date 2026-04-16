// Pure utility: cosine similarity between two equal-length numeric vectors.

/**
 * Computes the cosine similarity between two equal-length numeric vectors.
 *
 * Returns a value in the range [-1, 1], where:
 *   1.0  = vectors point in the same direction (identical taste)
 *   0.0  = vectors are orthogonal (unrelated taste)
 *  -1.0  = vectors point in opposite directions (opposite taste)
 *
 * Edge cases:
 *   - If either vector has magnitude 0 (all-zeros), returns 0.0 rather than NaN.
 *   - Vectors must be the same length; behavior with mismatched lengths is undefined.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0.0;

  return dot / denom;
}
