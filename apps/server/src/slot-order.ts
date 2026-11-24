// Slot reports from a program page are separate HTTP requests; during a live drag they go out every
// 33 ms and two can swap on the way. Each page numbers its reports, and one older than the newest
// already applied from that page is ignored, so OBS always ends on the page's final picture.

/** Returns whether to apply a report numbered `seq` from `page`, and records it if so. */
export function createSlotOrder() {
  const newest = new Map<string, number>();
  return (page: unknown, seq: unknown): boolean => {
    const n = Number(seq);
    // Reports without numbering (older pages) are applied as they come, as before.
    if (typeof page !== "string" || !page || !Number.isFinite(n)) return true;
    if (n <= (newest.get(page) ?? -Infinity)) return false;
    newest.set(page, n);
    return true;
  };
}
