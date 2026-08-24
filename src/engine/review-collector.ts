export interface Review {
  id: string;
  trackId: string;
  country: string;
  rating: number;
  title: string;
  body: string;
  version: string;
  author: string;
  updatedAt: string;
}

export function parseReviewEntries(trackId: string, country: string, feed: any): Review[] {
  const entries = Array.isArray(feed?.feed?.entry) ? feed.feed.entry : [];
  return entries
    .filter((entry: any) => entry?.["im:rating"]?.label)
    .map((entry: any) => ({
      id: String(entry.id?.label || ""),
      trackId,
      country,
      rating: Number(entry["im:rating"].label),
      title: String(entry.title?.label || ""),
      body: String(entry.content?.label || ""),
      version: String(entry["im:version"]?.label || ""),
      author: String(entry.author?.name?.label || ""),
      updatedAt: String(entry.updated?.label || ""),
    }))
    .filter((review: Review) => review.id && review.rating > 0);
}

export async function fetchCountryReviews(trackId: string, country: string): Promise<Review[]> {
  const url = `https://itunes.apple.com/${encodeURIComponent(country)}/rss/customerreviews/id=${encodeURIComponent(trackId)}/json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 429) throw new Error(`评论 RSS 频率受限（${country}）`);
    if (!res.ok) throw new Error(`评论 RSS ${res.status}`);
    return parseReviewEntries(trackId, country, JSON.parse(await res.text()));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAllStorefrontReviews(
  trackId: string,
  countries: string[],
  existingIds: string[],
): Promise<{ reviews: Review[]; fetchedAt: string }> {
  const existing = new Set(existingIds);
  const all: Review[] = [];
  for (const country of countries) {
    try {
      const reviews = (await fetchCountryReviews(trackId, country)).filter(
        (review) => !existing.has(review.id),
      );
      all.push(...reviews);
    } catch {
      // Country-level failure is non-fatal: keep other countries' reviews.
    }
  }
  return { reviews: all, fetchedAt: new Date().toISOString() };
}
