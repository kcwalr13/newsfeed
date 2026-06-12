/**
 * YYYY-MM-DD in the user's LOCAL timezone (FE-M5).
 *
 * `new Date().toISOString().slice(0, 10)` gives the UTC date, which during
 * evening hours west of UTC is already tomorrow — mislabeling "TODAY",
 * once-per-day keys, and relative-day math.
 */
export function localTodayString(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
