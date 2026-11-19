// STM Team Chat — end-to-end encryption. Uses only the browser's built-in
// WebCrypto. Kept identical in artifacts/stm-daily/src/lib and
// artifacts/stm-financial/src/lib (a test checks this).
//
// How it works
// - Each browser ("device") makes its own ECDH P-256 key pair. The private key
//   is created non-extractable and kept only in this browser's IndexedDB; the
//   public key is published in chat_devices.
// - Messages and photos are encrypted with a shared AES-256-GCM "chat key".
//   Each chat key version is handed to every member device wrapped just for
//   that device (ephemeral ECDH → HKDF-SHA-256 → AES-GCM), in chat_key_shares.
// - Whenever a member's app is open, it hands the chat key to member devices
//   that don't have it yet. When someone leaves (taken off the list, or their
//   login reset), the next member app to notice makes a new chat key version,
//   and the database only accepts messages under the newest version.
// - The sender's login email (stamped by the database) is bound into every
//   message and photo as AES-GCM additional data, so one can't be passed off
//   as someone else's.
// The server only ever sees public keys, wrapped keys and ciphertext.

import type { SupabaseClient } from "@supabase/supabase-js";
import { newId } from "./team-chat-core";

const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("e2e-unsupported");
  return s;
}

/** WebCrypto needs a secure (https) page; IndexedDB keeps this device's private key. */
export function e2eSupported(): boolean {
  return !!globalThis.crypto?.subtle && typeof indexedDB !== "undefined";
}

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const publicOnly = (j: JsonWebKey): JsonWebKey => ({ kty: j.kty, crv: j.crv, x: j.x, y: j.y });

// ── Keys ────────────────────────────────────────────────────────────────────
export async function generateDeviceKeyPair(): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  const kp = (await subtle().generateKey(ECDH, false, ["deriveBits"])) as CryptoKeyPair;
  return { privateKey: kp.privateKey, publicJwk: publicOnly(await subtle().exportKey("jwk", kp.publicKey)) };
}

export function newChatKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]) as Promise<CryptoKey>;
}

async function shareKek(privateKey: CryptoKey, publicKey: CryptoKey, usage: KeyUsage): Promise<CryptoKey> {
  const bits = await subtle().deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hk = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode("stm-team-chat/share/v1") },
    hk, { name: "AES-GCM", length: 256 }, false, [usage],
  );
}

export type WrappedShare = { wrapped_key: string; iv: string; ephemeral_public_key: JsonWebKey };
const shareAad = (version: number, deviceId: string) => enc.encode(`stm-chat-share:${version}:${deviceId}`);

/** The chat key, encrypted so only the device holding `devicePublicJwk`'s private key can open it. */
export async function wrapChatKey(chatKey: CryptoKey, version: number, deviceId: string, devicePublicJwk: JsonWebKey): Promise<WrappedShare> {
  const devicePub = await subtle().importKey("jwk", publicOnly(devicePublicJwk), ECDH, false, []);
  const eph = (await subtle().generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const kek = await shareKek(eph.privateKey, devicePub, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: shareAad(version, deviceId) }, kek, await subtle().exportKey("raw", chatKey));
  return { wrapped_key: b64(ct), iv: b64(iv), ephemeral_public_key: publicOnly(await subtle().exportKey("jwk", eph.publicKey)) };
}

export async function unwrapChatKey(share: WrappedShare, version: number, deviceId: string, devicePrivate: CryptoKey): Promise<CryptoKey> {
  const epk = await subtle().importKey("jwk", publicOnly(share.ephemeral_public_key), ECDH, false, []);
  const kek = await shareKek(devicePrivate, epk, "decrypt");
  const raw = await subtle().decrypt({ name: "AES-GCM", iv: unb64(share.iv), additionalData: shareAad(version, deviceId) }, kek, unb64(share.wrapped_key));
  return subtle().importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

const checkText = (version: number) => `stm-chat-key-check:${version}`;

/** Stored with each key version so a device can tell a genuine key from a planted one. */
export async function makeKeyCheck(key: CryptoKey, version: number): Promise<{ check_iv: string; check_ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(checkText(version)));
  return { check_iv: b64(iv), check_ct: b64(ct) };
}

export async function verifyKeyCheck(key: CryptoKey, version: number, check_iv: string, check_ct: string): Promise<boolean> {
  try {
    const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(check_iv) }, key, unb64(check_ct));
    return dec.decode(pt) === checkText(version);
  } catch {
    return false;
  }
}

// ── Messages and photos ─────────────────────────────────────────────────────
const msgAad = (sender: string) => enc.encode(`stm-chat-msg:${sender.toLowerCase()}`);
const photoAad = (sender: string) => enc.encode(`stm-chat-photo:${sender.toLowerCase()}`);

export async function encryptMessage(key: CryptoKey, text: string, sender: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: msgAad(sender) }, key, enc.encode(JSON.stringify({ v: 1, t: text })));
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function decryptMessage(key: CryptoKey, ciphertext: string, iv: string, sender: string): Promise<string> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: msgAad(sender) }, key, unb64(ciphertext));
  const parsed = JSON.parse(dec.decode(pt));
  return typeof parsed?.t === "string" ? parsed.t : "";
}

export async function encryptPhoto(key: CryptoKey, photo: Blob, sender: string): Promise<{ data: Blob; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: photoAad(sender) }, key, await photo.arrayBuffer());
  return { data: new Blob([ct], { type: "application/octet-stream" }), iv: b64(iv) };
}

export async function decryptPhoto(key: CryptoKey, data: Blob, iv: string, sender: string): Promise<Blob> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: photoAad(sender) }, key, await data.arrayBuffer());
  return new Blob([pt], { type: "image/jpeg" });
}

// ── This device's key pair, kept in IndexedDB ───────────────────────────────
type DeviceRecord = { deviceId: string; privateKey: CryptoKey; publicJwk: JsonWebKey };
const DB_NAME = "stm-team-chat";
const STORE = "devices";
const memoryDevices = new Map<string, DeviceRecord>();   // if IndexedDB is blocked (some private windows)

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function loadLocalDevice(userId: string): Promise<DeviceRecord | undefined> {
  try { return (await idb<DeviceRecord | undefined>("readonly", s => s.get(userId))) ?? memoryDevices.get(userId); }
  catch { return memoryDevices.get(userId); }
}

async function saveLocalDevice(userId: string, rec: DeviceRecord) {
  try { await idb("readwrite", s => s.put(rec, userId)); }
  catch { memoryDevices.set(userId, rec); }
}

/** This browser's chat device: created on first use, and re-published if the server lost it. */
export async function ensureDevice(client: SupabaseClient, userId: string): Promise<DeviceRecord> {
  let rec = await loadLocalDevice(userId);
  if (!rec) {
    const kp = await generateDeviceKeyPair();
    rec = { deviceId: newId(), privateKey: kp.privateKey, publicJwk: kp.publicJwk };
    await saveLocalDevice(userId, rec);
  }
  const { data, error } = await client.from("chat_devices").select("id").eq("id", rec.deviceId).maybeSingle();
  if (error) throw error;
  if (!data) {
    const { error: insErr } = await client.from("chat_devices").insert({ id: rec.deviceId, public_key: rec.publicJwk });
    if (insErr && insErr.code !== "23505") throw insErr;
  }
  return rec;
}

// ── Keyring: which chat key versions this device can use ─────────────────────
export type Keyring = {
  deviceId: string;
  keys: Map<number, CryptoKey>;
  /** Newest chat key version, or null if the chat has none yet. */
  current: number | null;
};

export const canSend = (k: Keyring | null): k is Keyring & { current: number } =>
  !!k && k.current !== null && k.keys.has(k.current);

type ShareRow = WrappedShare & { key_version: number };
type VersionRow = { version: number; check_iv: string; check_ct: string };

const running = new Map<string, Promise<Keyring>>();

/**
 * Bring this device up to date: register it, open every chat key shared with
 * it, start or rotate the chat key if needed, and hand the keys it holds to
 * member devices that don't have them yet. Calls for the same user share one run.
 */
export function syncKeyring(client: SupabaseClient, userId: string): Promise<Keyring> {
  const existing = running.get(userId);
  if (existing) return existing;
  const p = doSync(client, userId).finally(() => running.delete(userId));
  running.set(userId, p);
  return p;
}

async function doSync(client: SupabaseClient, userId: string): Promise<Keyring> {
  const device = await ensureDevice(client, userId);
  const keys = new Map<number, CryptoKey>();

  const load = async (): Promise<number | null> => {
    const [vers, mine] = await Promise.all([
      client.from("chat_key_versions").select("version, check_iv, check_ct").order("version"),
      client.from("chat_key_shares").select("key_version, wrapped_key, iv, ephemeral_public_key").eq("device_id", device.deviceId),
    ]);
    if (vers.error) throw vers.error;
    if (mine.error) throw mine.error;
    const versions = (vers.data ?? []) as VersionRow[];
    const byVersion = new Map(versions.map(v => [v.version, v]));
    for (const s of (mine.data ?? []) as ShareRow[]) {
      const v = byVersion.get(s.key_version);
      if (!v || keys.has(s.key_version)) continue;
      try {
        const k = await unwrapChatKey(s, s.key_version, device.deviceId, device.privateKey);
        if (await verifyKeyCheck(k, s.key_version, v.check_iv, v.check_ct)) keys.set(s.key_version, k);
      } catch { /* not openable by this device, or tampered with: ignore it */ }
    }
    return versions.length ? versions[versions.length - 1].version : null;
  };

  let current = await load();

  // No chat key yet, or someone holding the current one has left: make a new version.
  let rotate = current === null;
  if (!rotate) {
    const { data } = await client.rpc("chat_key_rotation_needed");
    rotate = data === true;
  }
  if (rotate) {
    const next = (current ?? 0) + 1;
    const key = await newChatKey();
    const { error } = await client.from("chat_key_versions").insert({ version: next, ...(await makeKeyCheck(key, next)) });
    if (!error) { keys.set(next, key); current = next; }
    else if (error.code === "23505") current = await load();   // another app just did it
    else throw error;
  }

  await shareWithMemberDevices(client, keys);
  return { deviceId: device.deviceId, keys, current };
}

async function shareWithMemberDevices(client: SupabaseClient, keys: Map<number, CryptoKey>) {
  if (!keys.size) return;
  const [devs, shares] = await Promise.all([
    client.from("chat_devices").select("id, public_key"),   // current members' devices only (RLS)
    client.from("chat_key_shares").select("key_version, device_id"),
  ]);
  if (devs.error || shares.error) return;
  const have = new Set((shares.data ?? []).map(s => `${s.key_version}:${s.device_id}`));
  const rows: Record<string, unknown>[] = [];
  for (const d of (devs.data ?? []) as { id: string; public_key: JsonWebKey }[]) {
    for (const [version, key] of keys) {
      if (have.has(`${version}:${d.id}`)) continue;
      try { rows.push({ key_version: version, device_id: d.id, ...(await wrapChatKey(key, version, d.id, d.public_key)) }); }
      catch { /* unusable public key: skip that device */ }
    }
  }
  if (!rows.length) return;
  const { error } = await client.from("chat_key_shares").insert(rows);
  // Another app may have shared some of these at the same moment; add the rest one by one.
  if (error) for (const r of rows) await client.from("chat_key_shares").insert(r);
}
