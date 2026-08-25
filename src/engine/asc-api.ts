import crypto from "crypto";

export interface AscCredentials {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
}

export interface AscVersion {
  id: string;
  versionString: string;
  appStoreState: string;
  createdDate: string | null;
  /** build relationship id, resolved via `?include=build` (null when not attached). */
  buildId: string | null;
}

export interface AscLocalization {
  id: string;
  locale: string;
  name: string;
  subtitle: string;
  promotionalText: string;
  description: string;
  whatsNew: string;
  keywords: string;
}

export interface AscBuild {
  id: string;
  version: string;
  processingState: string;
  uploadedDate: string | null;
  /** Filled in a later milestone after verifying the beta review endpoint. */
  betaReviewState: string | null;
}

export interface AscReviewDetail {
  rejectionReason: string | null;
}

const API_BASE = "https://api.appstoreconnect.apple.com/v1";

/** Convert a DER-encoded ECDSA signature to the raw r||s form JWT ES256 needs. */
export function derToRawJwtSignature(der: Buffer): string {
  if (der[0] !== 0x30) throw new Error("invalid ECDSA signature");
  let offset = 2;
  if (der[offset] !== 0x02) throw new Error("invalid R marker");
  const rLen = der[offset + 1];
  const r = der.subarray(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;
  if (der[offset] !== 0x02) throw new Error("invalid S marker");
  const sLen = der[offset + 1];
  const s = der.subarray(offset + 2, offset + 2 + sLen);
  const padded = (buf: Buffer): Buffer => {
    const slice = buf.length > 32 ? buf.subarray(buf.length - 32) : buf;
    const out = Buffer.alloc(32);
    slice.copy(out, 32 - slice.length);
    return out;
  };
  return Buffer.concat([padded(r), padded(s)]).toString("base64url");
}

export function ascJwt(issuerId: string, keyId: string, privateKeyPem: string): string {
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: issuerId, exp: now + 1200, aud: "appstoreconnect-v1" };
  const b64 = (value: any) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const signer = crypto.createSign("sha256");
  signer.update(unsigned);
  return `${unsigned}.${derToRawJwtSignature(signer.sign(privateKeyPem))}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createAscClient(credentials: AscCredentials) {
  const get = async (path: string): Promise<any> => {
    const res = await fetchWithTimeout(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${ascJwt(credentials.issuerId, credentials.keyId, credentials.privateKeyPem)}`,
        Accept: "application/json",
      },
    });
    if (res.status === 404) return null;
    if (res.status === 401) throw new Error("App Store Connect 凭据无效（401）");
    if (res.status === 403) throw new Error("App Store Connect 密钥角色权限不足（403）");
    if (res.status === 429) throw new Error("App Store Connect API 频率受限（429）");
    if (!res.ok) throw new Error(`App Store Connect API ${res.status}`);
    return res.json();
  };

  return {
    async getAppIdByBundleId(bundleId: string): Promise<string | null> {
      const data = await get(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
      const app = Array.isArray(data?.data) ? data.data[0] : null;
      return app?.id || null;
    },
    async listAppStoreVersions(appId: string): Promise<AscVersion[]> {
      const data = await get(`/apps/${encodeURIComponent(appId)}/appStoreVersions?include=build&limit=50`);
      return (Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        id: item.id,
        versionString: item.attributes?.versionString || "",
        appStoreState: item.attributes?.appStoreState || "",
        createdDate: item.attributes?.createdDate || null,
        buildId: item.relationships?.build?.data?.id || null,
      }));
    },
    async listVersionLocalizations(versionId: string): Promise<AscLocalization[]> {
      const data = await get(`/appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations?limit=50`);
      return (Array.isArray(data?.data) ? data.data : []).map((item: any) => {
        const a = item.attributes || {};
        return {
          id: item.id,
          locale: a.locale || "",
          name: a.name || "",
          subtitle: a.subtitle || "",
          promotionalText: a.promotionalText || "",
          description: a.description || "",
          whatsNew: a.whatsNew || "",
          keywords: a.keywords || "",
        };
      });
    },
    /**
     * App-level localizations (App Info): the store's displayed name/subtitle.
     * Version-level localizations often leave name/subtitle empty (they fall
     * back to these), so this is the authoritative source for those fields.
     */
    async listAppInfoLocalizations(appId: string): Promise<AscLocalization[]> {
      const infos = await get(`/apps/${encodeURIComponent(appId)}/appInfos?limit=10`);
      const infoId = Array.isArray(infos?.data) ? infos.data[0]?.id : null;
      if (!infoId) return [];
      const data = await get(`/appInfos/${encodeURIComponent(infoId)}/appInfoLocalizations?limit=50`);
      return (Array.isArray(data?.data) ? data.data : []).map((item: any) => {
        const a = item.attributes || {};
        return {
          id: item.id,
          locale: a.locale || "",
          name: a.name || "",
          subtitle: a.subtitle || "",
          promotionalText: "",
          description: "",
          whatsNew: "",
          keywords: "",
        };
      });
    },
    async listBuilds(appId: string): Promise<AscBuild[]> {
      const data = await get(`/apps/${encodeURIComponent(appId)}/builds?limit=50`);
      return (Array.isArray(data?.data) ? data.data : []).map((item: any) => ({
        id: item.id,
        version: item.attributes?.version || "",
        processingState: item.attributes?.processingState || "",
        uploadedDate: item.attributes?.uploadedDate || null,
        betaReviewState: null,
      }));
    },
    async getReviewDetail(versionId: string): Promise<AscReviewDetail | null> {
      const data = await get(`/appStoreVersions/${encodeURIComponent(versionId)}/appStoreReviewDetail`);
      if (!data?.data?.attributes) return null;
      return { rejectionReason: data.data.attributes.rejectionReason || null };
    },
    async listCustomerReviews(appId: string): Promise<any | null> {
      return get(`/apps/${encodeURIComponent(appId)}/customerReviews?limit=50`);
    },
    async getAnalyticsReport(appId: string): Promise<any | null> {
      return get(`/apps/${encodeURIComponent(appId)}/analyticsReportRequests?limit=10`);
    },
  };
}
