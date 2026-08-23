import { app, safeStorage } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { log } from "../engine/logger";

/**
 * Phase 0: encrypt the AI API key at rest using Electron safeStorage
 * (macOS Keychain / Windows DPAPI). Falls back to plaintext if unavailable.
 */
export function decryptApiKey(stored: string): string {
  if (!stored) return "";
  if (!safeStorage.isEncryptionAvailable()) return stored;
  // Peel off encryption layers one at a time. A legacy double-encrypted value
  // decrypts first to another base64 blob, then to the real key. Plaintext
  // (legacy or keychain-unavailable) values are returned as-is.
  let current = stored;
  for (let layer = 0; layer < 3; layer++) {
    if (!looksLikeEncryptedBlob(current)) return current;
    try {
      current = safeStorage.decryptString(Buffer.from(current, "base64"));
    } catch {
      return current;
    }
  }
  return current;
}

/** True when the value looks like an encrypted blob rather than a real key
 *  (printable ASCII). Real API keys virtually always contain a hyphen (e.g.
 *  "sk-…"), which strict base64 rejects — so only genuine ciphertext blobs
 *  (pure base64 of non-printable bytes) are treated as encrypted. */
export function looksLikeEncryptedBlob(value: string): boolean {
  if (!value || !safeStorage.isEncryptionAvailable()) return false;
  if (value.length < 16) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  let buf: Buffer;
  try {
    buf = Buffer.from(value, "base64");
  } catch {
    return false;
  }
  if (buf.length < 12) return false;
  if (buf.toString("base64") !== value) return false;
  let printable = 0;
  for (const byte of buf) {
    if (byte >= 32 && byte <= 126) printable++;
  }
  return printable / buf.length < 0.8;
}

export function encryptApiKey(key: string): string {
  if (!key) return "";
  if (!safeStorage.isEncryptionAvailable()) return key;
  if (looksLikeEncryptedBlob(key)) {
    log.warn("API key appears already encrypted; storing as-is to avoid double encryption");
    return key;
  }
  return safeStorage.encryptString(key).toString("base64");
}

/**
 * Project credentials (GitHub / App Store Connect) — Phase 1 of project
 * settings. Global defaults + optional per-project overrides, encrypted via
 * safeStorage. Effective value = project override ?? global default.
 */
export function resolveEffectiveCredentials(s: any, projectId: string) {
  const global = s.get("globalCredentials") || {};
  const override = (s.get("projectCredentials") || {})[projectId] || {};
  const pick = (key: string): string => {
    const hasOverride = override[key] !== undefined && override[key] !== "";
    return hasOverride ? decryptApiKey(override[key]) : decryptApiKey(global[key]);
  };
  return {
    githubToken: pick("githubToken"),
    githubExpiresAt: pick("githubExpiresAt"),
    ascIssuerId: pick("ascIssuerId"),
    ascKeyId: pick("ascKeyId"),
    ascPrivateKeyPath: pick("ascPrivateKeyPath"),
  };
}

/** Convert a DER-encoded ECDSA signature to the raw r||s form JWT ES256 needs. */
function derToRawJwtSignature(der: Buffer): string {
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

/** Remove app-managed .p8 files that no credential references. */
export function garbageCollectKeys(s: any): void {
  try {
    const dir = path.join(app.getPath("userData"), "keys");
    if (!fs.existsSync(dir)) return;
    const referenced = new Set<string>();
    const global: any = s.get("globalCredentials") || {};
    if (global.ascPrivateKeyPath) referenced.add(path.resolve(global.ascPrivateKeyPath));
    const overrides: any = s.get("projectCredentials") || {};
    for (const entry of Object.values(overrides) as any[]) {
      const keyPath = entry?.ascPrivateKeyPath;
      if (keyPath) referenced.add(path.resolve(keyPath));
    }
    for (const file of fs.readdirSync(dir)) {
      if (!file.toLowerCase().endsWith(".p8")) continue;
      const full = path.join(dir, file);
      if (!referenced.has(path.resolve(full))) {
        try {
          fs.unlinkSync(full);
        } catch {
          // best effort
        }
      }
    }
  } catch {
    // best effort
  }
}
