import type { Review } from "../../engine/review-collector";

export interface ReviewStats {
  total: number;
  average: number | null;
  distribution: Record<number, number>;
  recent30: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function reviewStats(items: Review[], now = new Date()): ReviewStats {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const cutoff = now.getTime() - 30 * DAY_MS;
  let total = 0;
  let sum = 0;
  let recent30 = 0;
  for (const item of items) {
    const rating = Math.round(item.rating);
    if (rating < 1 || rating > 5) continue;
    total += 1;
    sum += rating;
    distribution[rating] += 1;
    const ts = new Date(item.updatedAt).getTime();
    if (!Number.isNaN(ts) && ts >= cutoff) recent30 += 1;
  }
  return {
    total,
    average: total > 0 ? Math.round((sum / total) * 10) / 10 : null,
    distribution,
    recent30,
  };
}
