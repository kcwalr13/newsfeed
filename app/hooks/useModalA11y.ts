'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Module-level body-scroll-lock ref count (R2-14). Each modal used to snapshot
// and restore `body.style.overflow` independently, so two overlapping modals
// clobbered each other's snapshot — the page could end up permanently
// scroll-locked after both closed (the later modal restored the earlier one's
// 'hidden'), or unlocked while one was still open. We instead snapshot the
// original overflow once on the 0→1 transition and restore it once on 1→0.
let scrollLockCount = 0;
let savedBodyOverflow = '';

function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
  }
}

/**
 * Accessibility plumbing shared by all modal/overlay dialogs:
 *  - moves focus into the dialog on open (first focusable element, else the container)
 *  - traps Tab / Shift+Tab within the dialog
 *  - closes on Escape
 *  - restores focus to the previously-focused element on close
 *  - locks body scroll while open
 *
 * Pass a ref to the dialog container and an `active` flag. `onClose` is invoked
 * on Escape; the caller owns the actual close/visibility state.
 */
export function useModalA11y(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog.
    const focusables = container
      ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];
    (focusables[0] ?? container)?.focus();

    // Lock body scroll via the shared ref count (safe under overlapping modals).
    lockBodyScroll();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !container) return;

      const items = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === container);
      if (items.length === 0) {
        // Nothing focusable but the container — keep focus pinned to it.
        e.preventDefault();
        container.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unlockBodyScroll();
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef, onClose]);
}
