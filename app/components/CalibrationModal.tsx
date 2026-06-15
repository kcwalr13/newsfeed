'use client';

/**
 * CalibrationModal (P3-E2)
 *
 * First-run taste-calibration flow. Fetches ~16 contrasting pieces
 * (GET /api/onboarding/calibration) and lets the user Like / Pass each, plus an
 * optional tone preference. Captures the responses and, on completion, hands
 * them to `onComplete` (P3-E3 routes them through the feedback path to seed the
 * taste model) and marks calibration done.
 *
 * Sequenced AFTER the editor's letter: shown only once the existing
 * `tangent_onboarding_dismissed` flag is set and the user has no prior feedback,
 * gated by its own `tangent_calibration_done` flag so it never repeats. A
 * separate flag (not the shared onboarding one) keeps the editor's letter intact.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useModalA11y } from '@/app/hooks/useModalA11y';
import { FEEDBACK_STORE_KEY } from '@/lib/feedback/store';

export const CALIBRATION_DONE_KEY = 'tangent_calibration_done';
/** Partial in-progress responses, so a mid-calibration page refresh can resume
 *  instead of discarding everything held in React state (R4-10). */
const CALIBRATION_PROGRESS_KEY = 'tangent_calibration_progress';
const ONBOARDING_KEY = 'tangent_onboarding_dismissed';
const ONBOARDING_DISMISSED_EVENT = 'tangent:onboarding-dismissed';

/** A tone the user can optionally flag as appealing. */
const TONES = ['Contemplative', 'Propulsive', 'Playful', 'Serious', 'Specialist', 'Generalist'] as const;

export interface CalibrationPiece {
  id: string;
  title: string;
  dek: string;
  source: string;
  category: string;
}

export interface CalibrationResult {
  /** articleId → response. */
  responses: Record<string, 'like' | 'dislike'>;
  tones: string[];
  /**
   * Where the calibration pieces came from. 'batch' = real DB-scored articles
   * (feedback routes normally); 'seed' = committed fallback fixtures whose ids
   * aren't real articles, so they must seed the centroid directly without
   * writing feedback rows (R4-08).
   */
  source: 'batch' | 'seed';
}

function hasPriorFeedback(): boolean {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORE_KEY);
    return !!raw && Object.keys(JSON.parse(raw)).length > 0;
  } catch {
    return false;
  }
}

interface Props {
  /** Receives the captured responses + tones when the user finishes (P3-E3). */
  onComplete?: (result: CalibrationResult) => void;
}

export default function CalibrationModal({ onComplete }: Props) {
  const [visible, setVisible] = useState(false);
  const [pieces, setPieces] = useState<CalibrationPiece[]>([]);
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, 'like' | 'dislike'>>({});
  const [tones, setTones] = useState<string[]>([]);
  const [phase, setPhase] = useState<'cards' | 'tone'>('cards');
  // Where the pieces came from — drives how onComplete seeds the model (R4-08).
  const [source, setSource] = useState<'batch' | 'seed'>('batch');
  const dialogRef = useRef<HTMLDivElement>(null);
  // Guards the one-time progress restore so it can't re-run and clobber live state.
  const restoredRef = useRef(false);

  // Decide whether to show: calibration not done, editor letter already seen,
  // and no prior feedback (a returning user has effectively self-calibrated).
  const evaluate = useCallback(() => {
    if (localStorage.getItem(CALIBRATION_DONE_KEY)) return;
    if (!localStorage.getItem(ONBOARDING_KEY)) return; // wait for the editor's letter
    if (hasPriorFeedback()) {
      localStorage.setItem(CALIBRATION_DONE_KEY, '1');
      return;
    }
    setVisible(true);
  }, []);

  useEffect(() => {
    evaluate();
    const onDismissed = () => evaluate();
    window.addEventListener(ONBOARDING_DISMISSED_EVENT, onDismissed);
    return () => window.removeEventListener(ONBOARDING_DISMISSED_EVENT, onDismissed);
  }, [evaluate]);

  const finish = useCallback(
    (resp: Record<string, 'like' | 'dislike'>, tn: string[]) => {
      localStorage.setItem(CALIBRATION_DONE_KEY, '1');
      // Calibration is over — drop the resume snapshot (R4-10).
      try { localStorage.removeItem(CALIBRATION_PROGRESS_KEY); } catch { /* ignore */ }
      setVisible(false);
      onComplete?.({ responses: resp, tones: tn, source });
    },
    [onComplete, source]
  );

  const skip = useCallback(() => finish(responses, tones), [finish, responses, tones]);

  // Bow out of THIS attempt without consuming onboarding (R4-13): an empty or
  // failed calibration fetch is likely transient, so leave the done-flag unset
  // and just close — the next visit re-prompts and retries instead of
  // permanently losing first-run calibration with zero signal captured.
  const dismissWithoutConsuming = useCallback(() => setVisible(false), []);

  useModalA11y(visible, dialogRef, skip);

  // Fetch the calibration set once we become visible.
  useEffect(() => {
    if (!visible || pieces.length > 0) return;
    let cancelled = false;
    fetch('/api/onboarding/calibration')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d?.pieces) && d.pieces.length > 0) {
          setSource(d.source === 'seed' ? 'seed' : 'batch');
          setPieces(d.pieces);
        } else if (!cancelled) dismissWithoutConsuming(); // no pieces — retry next visit (R4-13)
      })
      .catch(() => {
        if (!cancelled) dismissWithoutConsuming();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Restore in-progress answers once the pieces are loaded (R4-10): a mid-flow
  // page refresh otherwise loses everything held only in React state. Runs once;
  // keeps only responses whose ids are still in the current set (the batch could
  // have changed), and resumes at the first unanswered card.
  useEffect(() => {
    if (!visible || pieces.length === 0 || restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(CALIBRATION_PROGRESS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        responses?: Record<string, 'like' | 'dislike'>;
        tones?: string[];
      };
      const validIds = new Set(pieces.map((p) => p.id));
      const restored: Record<string, 'like' | 'dislike'> = {};
      for (const [id, v] of Object.entries(saved.responses ?? {})) {
        if (validIds.has(id) && (v === 'like' || v === 'dislike')) restored[id] = v;
      }
      const savedTones = Array.isArray(saved.tones)
        ? saved.tones.filter((t): t is string => typeof t === 'string')
        : [];
      if (Object.keys(restored).length === 0 && savedTones.length === 0) return;
      setResponses(restored);
      if (savedTones.length > 0) setTones(savedTones);
      const firstUnanswered = pieces.findIndex((p) => !restored[p.id]);
      if (firstUnanswered === -1) setPhase('tone');
      else setIndex(firstUnanswered);
    } catch {
      /* corrupt progress — start fresh */
    }
  }, [visible, pieces]);

  // Persist partial progress as the user answers, so a refresh can resume (R4-10).
  // Skips the empty initial state so it can't clobber a saved snapshot before the
  // restore effect above has had a chance to run.
  useEffect(() => {
    if (!visible) return;
    if (Object.keys(responses).length === 0 && tones.length === 0) return;
    try {
      localStorage.setItem(
        CALIBRATION_PROGRESS_KEY,
        JSON.stringify({ responses, tones, phase })
      );
    } catch {
      /* storage full/disabled — non-blocking */
    }
  }, [visible, responses, tones, phase]);

  function respond(value: 'like' | 'dislike') {
    const piece = pieces[index];
    if (!piece) return;
    const next = { ...responses, [piece.id]: value };
    setResponses(next);
    if (index + 1 < pieces.length) {
      setIndex(index + 1);
    } else {
      setPhase('tone'); // all cards done → optional tone step
    }
  }

  function toggleTone(t: string) {
    setTones((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  if (!visible || pieces.length === 0) return null;

  const piece = pieces[index];
  const answered = Object.keys(responses).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calibration-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(26,24,20,0.55)', backdropFilter: 'blur(2px)' }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-sm focus:outline-none"
        style={{ background: 'var(--card)', padding: '36px 32px 28px', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', border: '1px solid var(--rule)' }}
      >
        <div className="flex items-center justify-between mb-6">
          <p className="ql-mono" style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.2em' }}>
            TANGENT · CALIBRATION
          </p>
          <button
            onClick={skip}
            className="ql-mono hover:underline focus:outline-none focus-visible:underline"
            style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.14em', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            SKIP
          </button>
        </div>

        <hr className="ql-rule mb-6" />

        {phase === 'cards' ? (
          <>
            <p id="calibration-title" className="ql-serif mb-5" style={{ fontSize: '15px', fontStyle: 'italic', color: 'var(--muted)', lineHeight: 1.5 }}>
              A few quick choices, so your editor learns your taste. Like what draws you; pass on what doesn&rsquo;t.
            </p>

            <div style={{ minHeight: '150px' }}>
              <p className="ql-mono mb-2" style={{ fontSize: '8px', color: 'var(--accent)', letterSpacing: '0.16em' }}>
                {piece.category.toUpperCase()}
              </p>
              <h2 className="ql-serif" style={{ fontSize: '23px', fontWeight: 500, color: 'var(--fg)', lineHeight: 1.25, marginBottom: '12px' }}>
                {piece.title}
              </h2>
              {piece.dek && (
                <p className="ql-serif" style={{ fontSize: '15px', color: 'var(--muted)', lineHeight: 1.55, marginBottom: '10px' }}>
                  {piece.dek}
                </p>
              )}
              <p className="ql-mono" style={{ fontSize: '9px', color: 'var(--dim)', letterSpacing: '0.12em' }}>
                {piece.source}
              </p>
            </div>

            <div className="flex items-center gap-3 mt-7">
              <button
                onClick={() => respond('dislike')}
                className="ql-mono flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
                style={{ fontSize: '10px', letterSpacing: '0.16em', color: 'var(--muted)', background: 'transparent', border: '1px solid var(--rule)', padding: '11px 0', cursor: 'pointer' }}
              >
                PASS
              </button>
              <button
                onClick={() => respond('like')}
                className="ql-mono flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
                style={{ fontSize: '10px', letterSpacing: '0.16em', color: 'var(--bg)', background: 'var(--accent)', border: 'none', padding: '11px 0', cursor: 'pointer' }}
              >
                LIKE
              </button>
            </div>

            <p className="ql-mono mt-5 text-center" style={{ fontSize: '8px', color: 'var(--dim)', letterSpacing: '0.14em' }}>
              {answered} / {pieces.length}
            </p>
          </>
        ) : (
          <>
            <h2 id="calibration-title" className="ql-serif mb-3" style={{ fontSize: '22px', fontStyle: 'italic', fontWeight: 500, color: 'var(--fg)', lineHeight: 1.25 }}>
              One last, optional thing.
            </h2>
            <p className="ql-serif mb-5" style={{ fontSize: '15px', color: 'var(--muted)', lineHeight: 1.5 }}>
              Any tones you especially enjoy? Skip if you&rsquo;d rather let the choices speak.
            </p>
            <div className="flex flex-wrap gap-2 mb-7">
              {TONES.map((t) => {
                const on = tones.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTone(t)}
                    aria-pressed={on}
                    className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
                    style={{ fontSize: '9px', letterSpacing: '0.12em', padding: '7px 12px', cursor: 'pointer', color: on ? 'var(--bg)' : 'var(--muted)', background: on ? 'var(--accent)' : 'transparent', border: `1px solid ${on ? 'var(--accent)' : 'var(--rule)'}` }}
                  >
                    {t.toUpperCase()}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => finish(responses, tones)}
                className="ql-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-sm"
                style={{ fontSize: '9px', letterSpacing: '0.18em', color: 'var(--bg)', background: 'var(--accent)', border: 'none', padding: '10px 18px', cursor: 'pointer' }}
              >
                Open today&rsquo;s issue →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
