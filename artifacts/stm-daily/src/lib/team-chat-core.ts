// STM Team Chat — data helpers shared by STM Daily and the CEO portal.
// Kept identical in artifacts/stm-daily/src/lib and artifacts/stm-financial/src/lib
// (a test checks this), so fix both or neither.

export type ChatRole = "ceo" | "staff";
export type ChatKind = "message" | "leave" | "emergency";
export type RequestStatus = "pending" | "approved" | "declined" | "open" | "handled";

/**
 * Emergency types. The type (not the details) is visible to the server, so the
 * CEO's Telegram alert can say what's happening; details stay encrypted.
 * Must match the check constraint in the team chat migration.
 */
export const EMERGENCY_TYPES = {
  fire:      { icon: "🔥", en: "Fire",                   my: "မီးလောင်မှု" },
  fuel_leak: { icon: "⛽", en: "Fuel leak / spill",      my: "ဆီယိုစိမ့်မှု" },
  accident:  { icon: "🚑", en: "Accident / injury",      my: "မတော်တဆမှု / ဒဏ်ရာ" },
  robbery:   { icon: "🚨", en: "Robbery / theft",        my: "လုယက်မှု / ခိုးမှု" },
  equipment: { icon: "⚡", en: "Power / pump failure",   my: "မီးပျက် / စက်ချို့ယွင်း" },
  other:     { icon: "❗", en: "Other emergency",        my: "အခြား အရေးပေါ်" },
} as const;
export type EmergencyType = keyof typeof EMERGENCY_TYPES;
export const MAX_LEAVE_DAYS = 31;

export type ChatMessage = {
  id: string;
  created_at: string;
  sender_id: string | null;
  /** Stamped by the database from the sender's login; also sealed into the encryption. */
  sender_email: string;
  sender_name: string;
  sender_role: ChatRole;
  /** Readable text — only on test messages from before encryption. */
  body: string | null;
  /** Encrypted text, the IV it was sealed with, and which chat key version. */
  ciphertext: string | null;
  iv: string | null;
  key_version: number | null;
  photo_path: string | null;
  photo_iv: string | null;
  client_id: string | null;
  /** A chat message, a day-off request, or an emergency alert. */
  kind: ChatKind;
  leave_from: string | null;   // YYYY-MM-DD
  leave_to: string | null;
  emergency_type: EmergencyType | null;
  /** leave: pending → approved / declined; emergency: open → handled. Set by a CEO. */
  status: RequestStatus | null;
  decided_by_name: string | null;
  decided_at: string | null;
  /** Local only: the decrypted text ("" for a photo with no caption); null if it couldn't be opened. */
  text?: string | null;
  /** Local only: still on its way, or failed to send. */
  pending?: "sending" | "failed";
  /** Local only: the photo as picked on this device, shown until the server copy loads. */
  localPhoto?: string;
};

export const MESSAGE_COLUMNS =
  "id, created_at, sender_id, sender_email, sender_name, sender_role, body, ciphertext, iv, key_version, photo_path, photo_iv, client_id, " +
  "kind, leave_from, leave_to, emergency_type, status, decided_by_name, decided_at";
export const PAGE_SIZE = 50;
export const MAX_BODY = 2000;
export const PHOTO_BUCKET = "chat-photos";
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** A row from the database or a realtime event, checked field by field. */
export function normalizeMessage(row: unknown): ChatMessage | null {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r.id !== "string" || typeof r.created_at !== "string") return null;
  return {
    id: r.id,
    created_at: r.created_at,
    sender_id: typeof r.sender_id === "string" ? r.sender_id : null,
    sender_email: typeof r.sender_email === "string" ? r.sender_email : "",
    sender_name: typeof r.sender_name === "string" && r.sender_name ? r.sender_name : "Someone",
    sender_role: r.sender_role === "ceo" ? "ceo" : "staff",
    body: typeof r.body === "string" && r.body ? r.body : null,
    ciphertext: typeof r.ciphertext === "string" && r.ciphertext ? r.ciphertext : null,
    iv: typeof r.iv === "string" && r.iv ? r.iv : null,
    key_version: typeof r.key_version === "number" ? r.key_version : null,
    photo_path: typeof r.photo_path === "string" && r.photo_path ? r.photo_path : null,
    photo_iv: typeof r.photo_iv === "string" && r.photo_iv ? r.photo_iv : null,
    client_id: typeof r.client_id === "string" ? r.client_id : null,
    kind: r.kind === "leave" || r.kind === "emergency" ? r.kind : "message",
    leave_from: typeof r.leave_from === "string" ? r.leave_from.slice(0, 10) : null,
    leave_to: typeof r.leave_to === "string" ? r.leave_to.slice(0, 10) : null,
    emergency_type: typeof r.emergency_type === "string" && r.emergency_type in EMERGENCY_TYPES ? (r.emergency_type as EmergencyType) : null,
    status: ["pending", "approved", "declined", "open", "handled"].includes(r.status as string) ? (r.status as RequestStatus) : null,
    decided_by_name: typeof r.decided_by_name === "string" ? r.decided_by_name : null,
    decided_at: typeof r.decided_at === "string" ? r.decided_at : null,
  };
}

/** What to show as the message text: decrypted, or the old readable text. undefined = still locked. */
export function shownText(m: ChatMessage): string | null | undefined {
  if (m.text !== undefined) return m.text;
  if (m.ciphertext) return undefined;
  return m.kind === "message" ? m.body : "";   // a request sent without details
}

// ── Day-off dates (plain calendar dates, no time zone) ──────────────────────
const parseDay = (d: string) => new Date(`${d}T00:00:00Z`);

export function leaveDays(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000) + 1;
}

export function fmtLeaveDay(d: string): string {
  return parseDay(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtLeaveRange(from: string, to: string): string {
  return from === to ? fmtLeaveDay(from) : `${fmtLeaveDay(from)} – ${fmtLeaveDay(to)}`;
}

/** Today in this device's time zone, YYYY-MM-DD. */
export function todayKey(now = new Date()): string {
  return dayKey(now.toISOString());
}

export function addDays(d: string, n: number): string {
  const t = parseDay(d);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Why a day-off range can't be sent, or null if it's fine. */
export function leaveProblem(from: string, to: string, today = todayKey()): ChatStringKey | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return "leavePickDates";
  if (from < today) return "leavePast";
  if (to < from) return "leaveOrder";
  if (leaveDays(from, to) > MAX_LEAVE_DAYS) return "leaveTooLong";
  return null;
}

const keyOf = (m: ChatMessage) => (m.client_id ? `c:${m.client_id}` : `i:${m.id}`);
const byTime = (a: ChatMessage, b: ChatMessage) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Merge incoming messages into the list, oldest first, one entry per message.
 * The saved copy of a message replaces its local "sending"/"failed" copy
 * (matched by client_id), keeping the text already decrypted (or typed here)
 * and the local photo preview, so nothing flickers.
 */
export function mergeMessages(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of list) map.set(keyOf(m), m);
  for (const m of incoming) {
    const key = keyOf(m);
    const prev = map.get(key);
    if (prev && !prev.pending && m.pending) continue; // never downgrade a saved message
    const keepText = prev && prev.text !== undefined && m.text === undefined;
    const keepPhoto = prev?.localPhoto && !m.localPhoto;
    map.set(key, keepText || keepPhoto
      ? { ...m, ...(keepText ? { text: prev.text } : {}), ...(keepPhoto ? { localPhoto: prev.localPhoto } : {}) }
      : m);
  }
  return [...map.values()].sort(byTime);
}

/**
 * Replace the newest page with a fresh copy from the server: drops messages
 * deleted meanwhile, keeps older pages already loaded and anything unsent.
 */
export function replaceLatest(list: ChatMessage[], latest: ChatMessage[], pageSize = PAGE_SIZE): ChatMessage[] {
  const windowStart = latest.length >= pageSize ? latest[0].created_at : null;
  // Anything newer than the fetched page arrived live after the fetch started; keep it too.
  const windowEnd = latest.length ? latest[latest.length - 1].created_at : null;
  const keep = list.filter(m =>
    m.pending ||
    (windowStart !== null && m.created_at < windowStart) ||
    (windowEnd !== null && m.created_at > windowEnd));
  return mergeMessages(keep, latest);
}

/** Show the sender's name above a message only when the sender, the day, or a 5-minute gap changes. */
export function startsGroup(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  if (!prev) return true;
  if (prev.sender_id !== m.sender_id || prev.sender_name !== m.sender_name) return true;
  if (dayKey(prev.created_at) !== dayKey(m.created_at)) return true;
  return new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000;
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(iso: string, words: { today: string; yesterday: string }, now = new Date()): string {
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return words.today;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dayKey(y.toISOString())) return words.yesterday;
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Random v4 UUID (crypto.randomUUID needs a secure context, so fall back to getRandomValues). */
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── "Seen" marker for the unread badge (per account, per device) ─────────────
const seenKey = (userId: string) => `stm_chat_seen_${userId}`;

export function loadSeen(userId: string): string | null {
  try { return localStorage.getItem(seenKey(userId)); } catch { return null; }
}

export function saveSeen(userId: string, iso: string) {
  try {
    const cur = localStorage.getItem(seenKey(userId));
    if (!cur || iso > cur) localStorage.setItem(seenKey(userId), iso);
  } catch { /* storage blocked: the badge just over-counts */ }
}

// ── Photos ──────────────────────────────────────────────────────────────────
/**
 * Shrink a picked photo to at most `maxSide` px on its long side and re-encode
 * it as JPEG, so a 4–12 MB phone photo uploads as a few hundred KB.
 * Honours the camera's rotation, and flattens transparency onto white.
 */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.82): Promise<Blob> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  let cleanup = () => {};
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    source = bmp; w = bmp.width; h = bmp.height;
    cleanup = () => bmp.close();
  } catch {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable"));
      i.src = url;
    }).catch(e => { URL.revokeObjectURL(url); throw e; });
    source = img; w = img.naturalWidth; h = img.naturalHeight;
    cleanup = () => URL.revokeObjectURL(url);
  }
  try {
    if (!w || !h) throw new Error("unreadable");
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("unreadable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("unreadable");
    return blob;
  } finally {
    cleanup();
  }
}

// ── Words ───────────────────────────────────────────────────────────────────
export type ChatLang = "en" | "my";

export const CHAT_STRINGS = {
  title:         { en: "Team Chat", my: "အဖွဲ့ Chat" },
  subtitle:      { en: "Staff and owner", my: "ဝန်ထမ်းများနှင့် ပိုင်ရှင်" },
  ownerBadge:    { en: "Owner", my: "ပိုင်ရှင်" },
  placeholder:   { en: "Message", my: "စာရိုက်ပါ" },
  send:          { en: "Send", my: "ပို့မည်" },
  addPhoto:      { en: "Add photo", my: "ဓာတ်ပုံထည့်ရန်" },
  removePhoto:   { en: "Remove photo", my: "ဓာတ်ပုံဖယ်ရန်" },
  photo:         { en: "Photo", my: "ဓာတ်ပုံ" },
  loadEarlier:   { en: "Load earlier messages", my: "အရင်စာများ ကြည့်ရန်" },
  today:         { en: "Today", my: "ယနေ့" },
  yesterday:     { en: "Yesterday", my: "မနေ့က" },
  empty:         { en: "No messages yet. Say hello 👋", my: "စာမရှိသေးပါ 👋" },
  sending:       { en: "Sending…", my: "ပို့နေသည်…" },
  failed:        { en: "Not sent · Tap to retry", my: "မပို့ရသေးပါ · ထပ်ပို့ရန် နှိပ်ပါ" },
  delete:        { en: "Delete", my: "ဖျက်မည်" },
  deleteConfirm: { en: "Delete this message for everyone?", my: "ဒီစာကို အားလုံးအတွက် ဖျက်မလား?" },
  live:          { en: "Live", my: "Live" },
  reconnecting:  { en: "Reconnecting…", my: "ပြန်ချိတ်နေသည်…" },
  offline:       { en: "You're offline. Messages will load when you're back online.", my: "အင်တာနက် မရှိပါ" },
  newMessages:   { en: "New messages", my: "စာအသစ်" },
  you:           { en: "You", my: "သင်" },
  back:          { en: "Back", my: "နောက်သို့" },
  close:         { en: "Close", my: "ပိတ်မည်" },
  preparing:     { en: "Preparing photo…", my: "ဓာတ်ပုံ ပြင်ဆင်နေသည်…" },
  e2e:           { en: "End-to-end encrypted", my: "အစမှအဆုံး လျှို့ဝှက်ထားသည်" },
  securing:      { en: "Setting up encryption…", my: "လုံခြုံရေး ပြင်ဆင်နေသည်…" },
  waitingKey:    { en: "This phone hasn't received the chat key yet. It unlocks by itself as soon as a teammate or the owner has the app open.", my: "ဒီဖုန်းအတွက် chat key မရသေးပါ။ အဖွဲ့ဝင်တစ်ယောက် app ဖွင့်ထားတာနဲ့ အလိုအလျောက် ဖွင့်ပေးပါမည်။" },
  locked:        { en: "🔒 Waiting for the key to read this", my: "🔒 ဖတ်ရန် key စောင့်နေသည်" },
  cantOpen:      { en: "🔒 Couldn't unlock this message", my: "🔒 ဒီစာကို ဖွင့်မရပါ" },
  unsupported:   { en: "This browser can't do encrypted chat. Update it, or open the app in Chrome.", my: "ဒီ browser မှာ အသုံးပြု၍မရပါ။ Chrome ဖြင့်ဖွင့်ပါ။" },
  deleteMessage: { en: "Delete message", my: "စာဖျက်ရန်" },
  dayOff:        { en: "Day off", my: "ခွင့်" },
  askDayOff:     { en: "Ask for a day off", my: "ခွင့်တောင်းရန်" },
  dayOffRequest: { en: "Day-off request", my: "ခွင့်တောင်းခံချက်" },
  from:          { en: "From", my: "မှ" },
  to:            { en: "To", my: "အထိ" },
  reasonOpt:     { en: "Reason (optional)", my: "အကြောင်းပြချက် (မဖြစ်မနေမဟုတ်)" },
  sendRequest:   { en: "Send request", my: "တောင်းခံမည်" },
  requestNote:   { en: "The owner gets a Telegram alert and can approve or decline it here.", my: "ပိုင်ရှင်ထံ Telegram ဖြင့် အသိပေးပြီး ဒီမှာ ခွင့်ပြု/ငြင်းနိုင်ပါသည်။" },
  day:           { en: "day", my: "ရက်" },
  days:          { en: "days", my: "ရက်" },
  pending:       { en: "Waiting for the owner", my: "ပိုင်ရှင် အဖြေ စောင့်နေသည်" },
  approved:      { en: "Approved", my: "ခွင့်ပြုပြီး" },
  declined:      { en: "Declined", my: "ငြင်းပယ်ပြီး" },
  approve:       { en: "Approve", my: "ခွင့်ပြုမည်" },
  decline:       { en: "Decline", my: "ငြင်းမည်" },
  leavePickDates:{ en: "Pick the dates.", my: "ရက်စွဲ ရွေးပါ။" },
  leavePast:     { en: "The day off can't start in the past.", my: "ပြီးခဲ့သောရက်ကို ရွေး၍မရပါ။" },
  leaveOrder:    { en: "The last day can't be before the first day.", my: "နောက်ဆုံးရက်သည် ပထမရက်မတိုင်မီ မဖြစ်ရပါ။" },
  leaveTooLong:  { en: "Ask for at most 31 days at a time.", my: "တစ်ကြိမ်လျှင် ရက် ၃၁ ရက်အထိသာ။" },
  emergency:     { en: "Emergency", my: "အရေးပေါ်" },
  emergencyAlert:{ en: "Emergency alert", my: "အရေးပေါ် အချက်ပေး" },
  whatHappened:  { en: "What's happening?", my: "ဘာဖြစ်နေသလဲ?" },
  detailsOpt:    { en: "Details (optional)", my: "အသေးစိတ် (မဖြစ်မနေမဟုတ်)" },
  sendEmergency: { en: "Send emergency alert", my: "အရေးပေါ် အချက်ပေးမည်" },
  emergencyNote: { en: "Everyone in the chat sees it, and the owner gets a Telegram alert straight away. If someone is in danger, call them too.", my: "အားလုံး မြင်ရပြီး ပိုင်ရှင်ထံ Telegram ဖြင့် ချက်ချင်း အသိပေးပါမည်။ အန္တရာယ်ရှိပါက ဖုန်းလည်း ဆက်ပါ။" },
  noKeyDetails:  { en: "This phone doesn't have the chat key yet, so details can't be added. The alert still goes out.", my: "chat key မရသေး၍ အသေးစိတ် မထည့်နိုင်ပါ။ အချက်ပေးချက်ကိုတော့ ပို့ပါမည်။" },
  open:          { en: "Open", my: "ဖြေရှင်းဆဲ" },
  handled:       { en: "Handled", my: "ဖြေရှင်းပြီး" },
  markHandled:   { en: "Mark handled", my: "ဖြေရှင်းပြီးဟု မှတ်မည်" },
  by:            { en: "by", my: "—" },
  offlineCall:   { en: "You're offline, so the alert can't be sent. Call the owner now.", my: "အင်တာနက် မရှိပါ။ ပိုင်ရှင်ကို ဖုန်းဆက်ပါ။" },
  cancel:        { en: "Cancel", my: "မလုပ်တော့ပါ" },
  notInstalled:  { en: "Team chat isn't set up yet. The owner needs to run the chat setup in Supabase.", my: "Team chat ကို မပြင်ဆင်ရသေးပါ" },
  noAccess:      { en: "You don't have access to the team chat. Ask the owner.", my: "Team chat သုံးခွင့် မရှိပါ" },
  unreadable:    { en: "Couldn't read that photo. Try another one.", my: "ဓာတ်ပုံကို ဖတ်မရပါ" },
  tooBig:        { en: "That photo is too large, even after shrinking it.", my: "ဓာတ်ပုံ အရမ်းကြီးနေသည်" },
  genericError:  { en: "Something went wrong. Try again.", my: "အမှားဖြစ်သွားသည်။ ထပ်ကြိုးစားပါ" },
} as const;

export type ChatStringKey = keyof typeof CHAT_STRINGS;

/** Turn a Supabase / network error into something staff can act on. */
export function chatErrorKey(e: unknown, online = true): ChatStringKey | null {
  const err = e as { code?: string; message?: string; statusCode?: string | number } | null;
  const msg = err?.message ?? "";
  if (msg === "e2e-unsupported") return "unsupported";
  if (!online || /Failed to fetch|NetworkError|Load failed/i.test(msg)) return "offline";
  if (err?.code === "PGRST205" || err?.code === "42P01" || /schema cache|does not exist|Bucket not found/i.test(msg)) return "notInstalled";
  if (err?.code === "42501" || /row-level security|permission denied|Only STM staff/i.test(msg)) return "noAccess";
  return null;
}
