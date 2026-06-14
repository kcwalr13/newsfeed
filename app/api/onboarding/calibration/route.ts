/**
 * GET /api/onboarding/calibration
 *
 * Returns ~16 contrasting calibration pieces for the first-run taste-calibration
 * flow (P3-E1). Preferred source: the latest assembled batch (real articles that
 * carry aesthetic scores, so feedback on them seeds the aesthetic EMA — P3-E3);
 * falls back to the committed seed set when no batch exists yet.
 */

import { NextResponse } from 'next/server';
import { readLatestBatch } from '@/lib/pipeline/storage';
import { getArticleAestheticScores } from '@/lib/db/aesthetics';
import { selectCalibrationSet } from '@/lib/onboarding/calibration';
import { SEED_CALIBRATION_PIECES } from '@/lib/onboarding/seedSet';

export const dynamic = 'force-dynamic';

const CALIBRATION_SET_SIZE = 16;

export async function GET() {
  try {
    const batch = await readLatestBatch();
    if (batch && batch.articles.length > 0) {
      const scores = await getArticleAestheticScores(batch.articles.map((a) => a.id));
      const pieces = selectCalibrationSet(batch.articles, scores, CALIBRATION_SET_SIZE);
      if (pieces.length > 0) {
        return NextResponse.json(
          { pieces, source: 'batch' },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }
    // Fallback: committed seed set (rare — a batch almost always exists).
    return NextResponse.json(
      { pieces: SEED_CALIBRATION_PIECES, source: 'seed' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[GET /api/onboarding/calibration]', err);
    return NextResponse.json(
      { pieces: SEED_CALIBRATION_PIECES, source: 'seed' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
