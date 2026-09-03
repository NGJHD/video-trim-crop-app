/**
 * The ⓘ next to "About".
 *
 * Drawn rather than typed. The character U+24D8 is not in the UI font stack, so
 * Windows falls back to Segoe UI Symbol — a font with its own vertical metrics,
 * which flex `items-center` then centres by *box* while the visible circle sits
 * low against the cap height. An SVG has no fallback lottery: its ink is
 * centred in its own box, at a weight we choose, identically on every machine.
 *
 * `currentColor` throughout, so it follows the button's text colour and hover.
 */
export default function InfoIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.25" strokeWidth="1.4" />
      <path d="M8 7.4v3.4" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="5.05" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
