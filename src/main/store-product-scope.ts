import { scopedAscSnapshotForProduct } from "@appilot-labs/appilot-core/asc-api";

/** Legacy ASC snapshots lacked a platform and could contain another platform's versions. */
export function scopedAscSnapshot(project: any, product: any, snapshot: any): any | null {
  return scopedAscSnapshotForProduct(project?.storeProducts || [], product, snapshot);
}

export function latestScopedAscSnapshot(project: any, product: any, ...snapshots: any[]): any | null {
  return snapshots
    .map((snapshot) => scopedAscSnapshot(project, product, snapshot))
    .filter(Boolean)
    .sort((a, b) => String(b.fetchedAt || "").localeCompare(String(a.fetchedAt || "")))[0] || null;
}

/** A shared Apple ID cannot establish which platform a public Lookup version describes. */
export function canUsePublicStoreVersion(project: any, product: any): boolean {
  if (!product?.trackId) return false;
  return !(project?.storeProducts || []).some(
    (other: any) => other.id !== product.id && String(other.trackId || "") === String(product.trackId),
  );
}
