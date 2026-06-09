// RSF renders times as `m:ss.mmm` (stage time) and diffs as `+s.mmm` /
// `+m:ss.mmm` (to previous / to leader). Leader diff cells may be empty or
// `0.000`. Parse to integer milliseconds; return null on empty/unparseable so
// callers can store NULL rather than a bogus 0.
const WITH_MIN = /^(\d+):([0-5]?\d)\.(\d{1,3})$/;
const SEC_ONLY = /^(\d+)\.(\d{1,3})$/;

export function parseTimeMs(raw: string): number | null {
  const t = raw.trim().replace(/^\+/, "");
  if (!t) return null;

  const min = WITH_MIN.exec(t);
  if (min) {
    const [, m, s, frac] = min;
    return (Number(m) * 60 + Number(s)) * 1000 + fracToMs(frac);
  }

  const sec = SEC_ONLY.exec(t);
  if (sec) {
    const [, s, frac] = sec;
    return Number(s) * 1000 + fracToMs(frac);
  }

  return null;
}

// "4" -> 400ms, "45" -> 450ms, "456" -> 456ms (left-aligned fractional digits).
function fracToMs(frac: string): number {
  return Number(frac.padEnd(3, "0"));
}
