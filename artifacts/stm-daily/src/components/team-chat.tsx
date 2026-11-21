// STM Team Chat — one group chat for all staff and the CEOs, with photos,
// end-to-end encrypted (see lib/team-chat-crypto.ts).
// Kept identical in artifacts/stm-daily/src/components and
// artifacts/stm-financial/src/components (a test checks this); each app passes
// its own Supabase client and picks the "dark" (STM Daily) or "light" (portal) theme.
//
// Who can read, post and delete is enforced by the database (RLS on
// chat_messages and the chat-photos bucket), not by this screen.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHAT_STRINGS, MAX_BODY, MAX_PHOTO_BYTES, MESSAGE_COLUMNS, PAGE_SIZE, PHOTO_BUCKET,
  chatErrorKey, compressImage, dayKey, dayLabel, loadSeen, mergeMessages, newId, normalizeMessage,
  replaceLatest, saveSeen, shownText, startsGroup, timeLabel,
  type ChatKind, type ChatLang, type ChatMessage, type ChatRole, type ChatStringKey, type EmergencyType,
} from "../lib/team-chat-core";
import { EmergencyDialog, LeaveDialog, RequestCard } from "./team-chat-requests";
import { confirmDialog } from "./confirm-dialog";
import {
  canSend, decryptMessage, decryptPhoto, e2eSupported, encryptMessage, encryptPhoto, syncKeyring,
  type Keyring,
} from "../lib/team-chat-crypto";

type Me = { id: string; email: string; role: ChatRole };
type RingState = "loading" | "ready" | "waiting" | "unsupported" | "error";

const THEMES = {
  dark: {
    root: "bg-[#0f111a] text-white",
    header: "bg-[#0f111a]/95 backdrop-blur border-b border-[#30363d]",
    title: "text-white",
    muted: "text-gray-500",
    name: "text-gray-400",
    mine: "bg-blue-600 text-white",
    other: "bg-[#161b22] border border-[#30363d] text-gray-100",
    day: "bg-[#161b22] border border-[#30363d] text-gray-400",
    composer: "bg-[#0f111a] border-t border-[#30363d]",
    input: "bg-[#161b22] border border-[#30363d] text-white placeholder:text-gray-600 focus:border-blue-500",
    iconBtn: "bg-[#161b22] border border-[#30363d] text-gray-400 hover:text-white",
    ceo: "bg-amber-500/15 text-amber-400",
    error: "bg-red-500/10 border border-red-500/30 text-red-300",
    info: "bg-blue-500/10 border border-blue-500/30 text-blue-200",
    pill: "bg-blue-600 text-white",
    action: "bg-[#21262d] border border-[#30363d] text-red-400",
    trash: "text-gray-500 hover:text-red-400",
    photoBg: "bg-[#161b22]",
  },
  light: {
    root: "bg-slate-50 text-slate-900",
    header: "bg-white border-b border-slate-100",
    title: "text-slate-900",
    muted: "text-slate-400",
    name: "text-slate-500",
    mine: "bg-blue-600 text-white",
    other: "bg-white border border-slate-200 text-slate-900",
    day: "bg-white border border-slate-200 text-slate-500",
    composer: "bg-white border-t border-slate-100",
    input: "bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-300",
    iconBtn: "bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-900",
    ceo: "bg-amber-100 text-amber-700",
    error: "bg-red-50 border border-red-100 text-red-700",
    info: "bg-blue-50 border border-blue-100 text-blue-800",
    pill: "bg-blue-600 text-white",
    action: "bg-white border border-slate-200 text-red-600",
    trash: "text-slate-400 hover:text-red-600",
    photoBg: "bg-slate-100",
  },
} as const;

const Icon = {
  back: <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />,
  photo: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h2.5l1.5-2h6l1.5 2H19a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  send: <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />,
  close: <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />,
  down: <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V8a4 4 0 118 0v3" />
    </>
  ),
  trash: <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  alert: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
};
const Svg = ({ children, className = "w-5 h-5" }: { children: React.ReactNode; className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">{children}</svg>
);

export default function TeamChat({ client, me, theme, lang = "en", onBack, className = "" }: {
  client: SupabaseClient;
  me: Me;
  theme: keyof typeof THEMES;
  lang?: ChatLang;
  onBack?: () => void;
  className?: string;
}) {
  const T = THEMES[theme];
  const s = useCallback((k: ChatStringKey) => CHAT_STRINGS[k][lang], [lang]);
  const sender = me.email.toLowerCase();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ChatStringKey | string>("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [live, setLive] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<ChatStringKey | string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});   // "" = couldn't open
  const [newBelow, setNewBelow] = useState(0);
  const [ring, setRing] = useState<Keyring | null>(null);
  const [ringState, setRingState] = useState<RingState>(() => (e2eSupported() ? "loading" : "unsupported"));
  const [dialog, setDialog] = useState<"leave" | "emergency" | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const prependFrom = useRef<number | null>(null);   // scrollHeight before older messages were added
  const firstLoad = useRef(true);
  const ringRef = useRef<Keyring | null>(null);
  const decrypting = useRef(new Set<string>());
  const askedForVersion = useRef(0);
  const photoRequested = useRef(new Set<string>());
  const blobs = useRef(new Map<string, Blob>());      // photos of unsent messages, for retry
  const objectUrls = useRef<string[]>([]);

  const say = (v: ChatStringKey | string) => (Object.prototype.hasOwnProperty.call(CHAT_STRINGS, v) ? s(v as ChatStringKey) : v);
  const errorFor = (e: unknown): ChatStringKey | string =>
    chatErrorKey(e, navigator.onLine) ?? ((e as { message?: string })?.message || "genericError");

  // ── Encryption keys ───────────────────────────────────────────────────────
  const refreshRing = useCallback(async (): Promise<Keyring | null> => {
    if (!e2eSupported()) { setRingState("unsupported"); return null; }
    try {
      const k = await syncKeyring(client, me.id);
      ringRef.current = k;
      setRing(k);
      setRingState(canSend(k) ? "ready" : "waiting");
      return k;
    } catch (e) {
      const key = chatErrorKey(e, navigator.onLine);
      if (key === "notInstalled" || key === "noAccess") setLoadError(key);
      if (!ringRef.current) setRingState("error");
      return ringRef.current;
    }
  }, [client, me.id]);

  useEffect(() => { refreshRing(); }, [refreshRing]);

  // Until this device can send, keep checking for its key.
  useEffect(() => {
    if (ringState !== "waiting" && ringState !== "error") return;
    const t = setInterval(() => { if (navigator.onLine) refreshRing(); }, 15_000);
    return () => clearInterval(t);
  }, [ringState, refreshRing]);

  // ── Loading ───────────────────────────────────────────────────────────────
  const fetchLatest = useCallback(async () => {
    const { data, error } = await client
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (error) {
      setLoadError(chatErrorKey(error, navigator.onLine) ?? error.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []).map(normalizeMessage).filter((m): m is ChatMessage => !!m).reverse();
    setMessages(prev => replaceLatest(prev, rows));
    if (firstLoad.current) { setHasMore(rows.length === PAGE_SIZE); firstLoad.current = false; }
    setLoadError("");
    setLoading(false);
  }, [client]);

  async function loadEarlier() {
    const oldest = messages.find(m => !m.pending)?.created_at;
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    const { data, error } = await client
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    setLoadingMore(false);
    if (error) { setNotice(errorFor(error)); return; }
    const rows = (data ?? []).map(normalizeMessage).filter((m): m is ChatMessage => !!m);
    prependFrom.current = listRef.current?.scrollHeight ?? null;
    setMessages(prev => mergeMessages(prev, rows));
    setHasMore(rows.length === PAGE_SIZE);
  }

  useEffect(() => { fetchLatest(); }, [fetchLatest]);

  // Live updates; while the connection is down, poll instead.
  useEffect(() => {
    const ch = client
      .channel(`team-chat-${newId()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, payload => {
        const m = normalizeMessage(payload.new);
        if (!m) return;
        setMessages(prev => mergeMessages(prev, [m]));
        if (m.sender_id !== me.id && !atBottom.current) setNewBelow(n => n + 1);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, payload => {
        const m = normalizeMessage(payload.new);   // a day off approved/declined, an emergency handled
        if (m) setMessages(prev => (prev.some(x => x.id === m.id) ? mergeMessages(prev, [m]) : prev));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, payload => {
        const id = (payload.old as { id?: string } | null)?.id;
        if (id) setMessages(prev => prev.filter(m => m.id !== id));
      })
      // A key handed to this device, a new key version, or a new device to hand keys to.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_key_shares" }, payload => {
        if ((payload.new as { device_id?: string } | null)?.device_id === ringRef.current?.deviceId) refreshRing();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_key_versions" }, () => { refreshRing(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_devices" }, () => { refreshRing(); })
      .subscribe(status => {
        const ok = status === "SUBSCRIBED";
        setLive(ok);
        if (ok) fetchLatest();   // catch up on anything sent while connecting
      });
    return () => { client.removeChannel(ch); };
  }, [client, fetchLatest, refreshRing, me.id]);

  useEffect(() => {
    if (live) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") fetchLatest(); }, 8000);
    return () => clearInterval(t);
  }, [live, fetchLatest]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchLatest(); };
    const onOnline = () => { setOnline(true); fetchLatest(); refreshRing(); };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [fetchLatest, refreshRing]);

  // Everything on screen counts as read.
  useEffect(() => {
    const latest = [...messages].reverse().find(m => !m.pending);
    if (latest && document.visibilityState === "visible") saveSeen(me.id, latest.created_at);
  }, [messages, me.id]);

  useEffect(() => () => { objectUrls.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  // ── Decrypting ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ring) return;
    // A message under a newer key than we know: the key moved on. Ask once per new version.
    const newest = Math.max(0, ...messages.map(m => m.key_version ?? 0));
    if (newest > (ring.current ?? 0) && newest > askedForVersion.current) {
      askedForVersion.current = newest;
      refreshRing();
    }
    const todo = messages.filter(m =>
      m.ciphertext && m.iv && m.text === undefined && m.key_version !== null &&
      ring.keys.has(m.key_version) && !decrypting.current.has(m.id));
    if (!todo.length) return;
    todo.forEach(m => decrypting.current.add(m.id));
    Promise.all(todo.map(async m => {
      try { return [m.id, await decryptMessage(ring.keys.get(m.key_version!)!, m.ciphertext!, m.iv!, m.sender_email)] as const; }
      catch { return [m.id, null] as const; }
    })).then(results => {
      const opened = new Map<string, string | null>(results);
      setMessages(prev => prev.map(m => (opened.has(m.id) && m.text === undefined ? { ...m, text: opened.get(m.id)! } : m)));
      results.forEach(([id]) => decrypting.current.delete(id));
    });
  }, [messages, ring, refreshRing]);

  useEffect(() => {
    const todo = messages.filter(m =>
      m.photo_path && !m.pending && !photoRequested.current.has(m.photo_path) &&
      (!m.photo_iv || (ring && m.key_version !== null && ring.keys.has(m.key_version))));
    for (const m of todo) {
      const path = m.photo_path!;
      photoRequested.current.add(path);
      (async () => {
        const { data, error } = await client.storage.from(PHOTO_BUCKET).download(path);
        if (error || !data) { photoRequested.current.delete(path); return; }   // try again on the next change
        let blob: Blob = data;
        try {
          if (m.photo_iv) blob = await decryptPhoto(ring!.keys.get(m.key_version!)!, data, m.photo_iv, m.sender_email);
        } catch {
          setPhotoUrls(u => ({ ...u, [path]: "" }));
          return;
        }
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        setPhotoUrls(u => ({ ...u, [path]: url }));
      })();
    }
  }, [messages, ring, client]);

  // ── Scrolling ─────────────────────────────────────────────────────────────
  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setNewBelow(0);
  };

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prependFrom.current !== null) {
      el.scrollTop += el.scrollHeight - prependFrom.current;   // keep the view still when older messages appear above
      prependFrom.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && newBelow) setNewBelow(0);
  }

  // ── Sending ───────────────────────────────────────────────────────────────
  async function deliver(local: ChatMessage, blob: Blob | undefined) {
    const cid = local.client_id!;
    try {
      for (let attempt = 0; ; attempt++) {
        let k = ringRef.current;
        if (!canSend(k)) k = await refreshRing();
        if (!canSend(k)) throw new Error("e2e-waiting");
        const version = k.current;
        const key = k.keys.get(version)!;

        const sealed = await encryptMessage(key, local.text ?? "", sender);
        let photo_path: string | null = null;
        let photo_iv: string | null = null;
        if (blob) {
          const ep = await encryptPhoto(key, blob, sender);
          photo_path = `${me.id}/${newId()}.bin`;   // fresh name each try: the file must match this IV
          const { error: upErr } = await client.storage.from(PHOTO_BUCKET)
            .upload(photo_path, ep.data, { contentType: "application/octet-stream", upsert: false });
          if (upErr) throw upErr;
          photo_iv = ep.iv;
        }

        const { data, error } = await client
          .from("chat_messages")
          .insert({ ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: version, photo_path, photo_iv, client_id: cid })
          .select(MESSAGE_COLUMNS)
          .single();
        if (error) {
          if (error.code === "23505") { blobs.current.delete(cid); fetchLatest(); return; }   // it did arrive; the reply got lost
          if (error.code === "40001" && attempt === 0) { await refreshRing(); continue; }   // the chat key just changed
          throw error;
        }
        const saved = normalizeMessage(data);
        if (saved) setMessages(prev => mergeMessages(prev, [{ ...saved, text: local.text }]));
        blobs.current.delete(cid);
        return;
      }
    } catch (e) {
      setMessages(prev => prev.map(m => (m.client_id === cid && m.pending ? { ...m, pending: "failed" } : m)));
      setNotice((e as Error)?.message === "e2e-waiting" ? "waitingKey" : errorFor(e));
    }
  }

  function send(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const body = text.trim().slice(0, MAX_BODY);
    if ((!body && !photo) || preparing || !canSend(ring)) return;
    const cid = newId();
    const local: ChatMessage = {
      id: cid, client_id: cid, created_at: new Date().toISOString(),
      sender_id: me.id, sender_email: sender, sender_name: sender.split("@")[0], sender_role: me.role,
      body: null, ciphertext: null, iv: null, key_version: null, photo_path: null, photo_iv: null,
      kind: "message", leave_from: null, leave_to: null, emergency_type: null, status: null, decided_by_name: null, decided_at: null,
      text: body, pending: "sending", localPhoto: photo?.url,
    };
    if (photo) blobs.current.set(cid, photo.blob);
    setMessages(prev => mergeMessages(prev, [local]));
    setText("");
    setPhoto(null);
    setNotice("");
    scrollToBottom();
    textRef.current?.focus();
    deliver(local, photo?.blob);
  }

  function retry(m: ChatMessage) {
    const again = { ...m, pending: "sending" as const, created_at: new Date().toISOString() };
    setMessages(prev => mergeMessages(prev.filter(x => x.client_id !== m.client_id), [again]));
    setNotice("");
    deliver(again, m.client_id ? blobs.current.get(m.client_id) : undefined);
  }

  /**
   * Send a day-off request or an emergency. Not shown until saved, so the
   * dialog can show any error. Works without the chat key too (no details then),
   * so an emergency always gets out.
   */
  async function sendRequest(
    fields: { kind: Exclude<ChatKind, "message">; leave_from?: string; leave_to?: string; emergency_type?: EmergencyType },
    details: string,
  ): Promise<string | null> {
    const client_id = newId();
    try {
      for (let attempt = 0; ; attempt++) {
        let k = ringRef.current;
        if (!canSend(k) && details) k = await refreshRing();
        const sealed = canSend(k)
          ? { ...(await encryptMessage(k.keys.get(k.current)!, details, sender)), key_version: k.current }
          : { ciphertext: null, iv: null, key_version: null };
        const { data, error } = await client
          .from("chat_messages")
          .insert({ ...fields, ...sealed, client_id })
          .select(MESSAGE_COLUMNS)
          .single();
        if (error) {
          if (error.code === "23505") { fetchLatest(); break; }
          if (error.code === "40001" && attempt === 0) { await refreshRing(); continue; }
          throw error;
        }
        const saved = normalizeMessage(data);
        if (saved) setMessages(prev => mergeMessages(prev, [{ ...saved, text: sealed.ciphertext ? details : "" }]));
        break;
      }
      setDialog(null);
      scrollToBottom();
      return null;
    } catch (e) {
      return say(errorFor(e));
    }
  }

  async function decide(m: ChatMessage, status: "approved" | "declined" | "handled"): Promise<boolean> {
    const { error } = await client.rpc("chat_decide", { p_message: m.id, p_status: status });
    if (error) { setNotice(errorFor(error)); fetchLatest(); return false; }
    setMessages(prev => prev.map(x => (x.id === m.id
      ? { ...x, status, decided_by_name: sender.split("@")[0], decided_at: new Date().toISOString() }
      : x)));
    return true;
  }

  async function remove(m: ChatMessage) {
    setSelected(null);
    if (!(await confirmDialog(s("deleteConfirm"), { danger: true, lang, theme: theme === "dark" ? "dark" : "light" }))) return;
    if (m.pending) {
      setMessages(prev => prev.filter(x => x.client_id !== m.client_id));
      return;
    }
    const { error, count } = await client.from("chat_messages").delete({ count: "exact" }).eq("id", m.id);
    if (error || !count) { setNotice(error ? errorFor(error) : "genericError"); return; }
    setMessages(prev => prev.filter(x => x.id !== m.id));
    if (m.photo_path) client.storage.from(PHOTO_BUCKET).remove([m.photo_path]).catch(() => {});
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) { setNotice("unreadable"); return; }
    setPreparing(true);
    setNotice("");
    try {
      const blob = await compressImage(file);
      if (blob.size > MAX_PHOTO_BYTES - 1024) { setNotice("tooBig"); return; }
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);
      setPhoto({ blob, url });
      textRef.current?.focus();
    } catch {
      setNotice("unreadable");
    } finally {
      setPreparing(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on a computer; on a phone the keyboard's Enter adds a new line.
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) send(e);
  }

  // Grow the box with its text, up to about five lines.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  // ── Render ────────────────────────────────────────────────────────────────
  const ready = canSend(ring);
  const canSubmit = (text.trim().length > 0 || !!photo) && !preparing && ready;
  const status = !online ? s("offline") : live ? s("live") : s("reconnecting");
  const keyBanner: ChatStringKey | null =
    ringState === "unsupported" ? "unsupported" : ringState === "waiting" ? "waitingKey" : null;

  return (
    <div className={`flex flex-col h-full min-h-0 ${T.root} ${className}`}>
      <header className={`shrink-0 px-3 sm:px-4 py-3 flex items-center gap-3 ${T.header}`}>
        {onBack && (
          <button type="button" onClick={onBack} aria-label={s("back")}
            className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${T.iconBtn}`}>
            <Svg>{Icon.back}</Svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className={`text-base font-bold leading-tight ${T.title}`}>{s("title")}</h1>
          <p className={`text-xs ${T.muted} flex items-center gap-1.5 min-w-0`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${!online ? "bg-gray-400" : live ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="truncate">{s("subtitle")} · {status}</span>
          </p>
        </div>
        <span title={s("e2e")} className={`shrink-0 flex items-center gap-1 text-[11px] font-semibold ${ready ? "text-emerald-500" : T.muted}`}>
          <Svg className="w-3.5 h-3.5">{Icon.lock}</Svg>
          <span className="hidden sm:inline">{s("e2e")}</span>
        </span>
        <button type="button" onClick={() => { setNotice(""); setDialog("emergency"); }} disabled={!!loadError}
          className="shrink-0 h-9 flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 disabled:opacity-40">
          <Svg className="w-4 h-4">{Icon.alert}</Svg>
          {s("emergency")}
        </button>
      </header>

      <div className="relative flex-1 min-h-0">
        <div ref={listRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : loadError ? (
            <div className="h-full flex items-center justify-center px-4">
              <p role="alert" className={`text-sm text-center rounded-xl px-4 py-3 ${T.error}`}>{say(loadError)}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
              <p className={`text-sm ${T.muted}`}>{s("empty")}</p>
              <p className={`text-xs ${T.muted} flex items-center gap-1`}><Svg className="w-3.5 h-3.5">{Icon.lock}</Svg>{s("e2e")}</p>
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center pb-3">
                  <button type="button" onClick={loadEarlier} disabled={loadingMore}
                    className={`text-xs font-semibold rounded-full px-3 py-1.5 disabled:opacity-50 ${T.day}`}>
                    {loadingMore ? "…" : s("loadEarlier")}
                  </button>
                </div>
              )}
              <ol className="space-y-0.5">
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const mine = m.sender_id === me.id;
                  const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                  const head = startsGroup(prev, m);
                  const ceoCanDelete = !mine && me.role === "ceo" && !m.pending && m.kind === "message";
                  const actionable = m.pending === "failed" || ceoCanDelete;
                  const Bubble = actionable ? "button" : "div";
                  const shown = shownText(m);
                  const hasPhoto = !!(m.photo_path || m.localPhoto);
                  const photoSrc = (m.photo_path && photoUrls[m.photo_path]) || m.localPhoto;
                  const photoFailed = !!m.photo_path && photoUrls[m.photo_path] === "" && !m.localPhoto;
                  return (
                    <li key={m.client_id ?? m.id}>
                      {newDay && (
                        <div className="flex justify-center py-3">
                          <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${T.day}`}>
                            {dayLabel(m.created_at, { today: s("today"), yesterday: s("yesterday") })}
                          </span>
                        </div>
                      )}
                      <div className={`flex flex-col ${mine ? "items-end" : "items-start"} ${head ? "pt-2" : ""}`}>
                        {head && (
                          <p className={`text-[11px] font-semibold mb-0.5 px-1 flex items-center gap-1.5 ${T.name}`}>
                            <span className="capitalize">{mine ? s("you") : m.sender_name}</span>
                            {m.sender_role === "ceo" && <span className={`text-[9px] font-bold rounded px-1 py-px ${T.ceo}`}>{s("ownerBadge")}</span>}
                          </p>
                        )}
                        {m.kind !== "message" ? (
                          <RequestCard m={m} shown={shown} isCeo={me.role === "ceo"} lang={lang} theme={theme}
                            onDecide={st => decide(m, st)} />
                        ) : (
                        <Bubble
                          {...(actionable ? { type: "button" as const } : {})}
                          onClick={actionable ? () => (m.pending === "failed" ? retry(m) : setSelected(selected === m.id ? null : m.id)) : undefined}
                          className={`block max-w-[85%] sm:max-w-[70%] text-left rounded-2xl overflow-hidden ${mine ? T.mine : T.other} ${m.pending === "sending" ? "opacity-70" : ""} ${m.pending === "failed" ? "ring-2 ring-red-500/60" : ""}`}>
                          {hasPhoto && (
                            photoSrc ? (
                              <img src={photoSrc} alt={s("photo")} loading="lazy"
                                onClick={e => { if (!m.pending) { e.stopPropagation(); setViewer(photoSrc); } }}
                                onLoad={() => { if (atBottom.current) scrollToBottom(); }}
                                className={`block w-64 max-w-full max-h-80 object-cover cursor-zoom-in ${T.photoBg}`} />
                            ) : photoFailed ? (
                              <span className={`block w-64 max-w-full px-3 py-8 text-center text-xs italic ${T.photoBg}`}>{s("cantOpen")}</span>
                            ) : (
                              <span className={`block w-64 max-w-full h-40 animate-pulse ${T.photoBg}`} aria-label={s("photo")} />
                            )
                          )}
                          {shown === undefined ? (
                            <span className="block px-3 py-2 text-[13px] italic opacity-70">
                              {ring && m.key_version !== null && ring.keys.has(m.key_version) ? "…" : s("locked")}
                            </span>
                          ) : shown === null ? (
                            <span className="block px-3 py-2 text-[13px] italic opacity-70">{s("cantOpen")}</span>
                          ) : shown ? (
                            <span className="block px-3 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words">{shown}</span>
                          ) : null}
                        </Bubble>
                        )}
                        <div className={`flex items-center gap-1 mt-0.5 px-1 ${mine ? "flex-row-reverse" : ""}`}>
                          <span className={`text-[10px] ${m.pending === "failed" ? "text-red-500 font-semibold" : T.muted}`}>
                            {m.pending === "sending" ? s("sending") : m.pending === "failed" ? s("failed") : timeLabel(m.created_at)}
                          </span>
                          {mine && m.pending !== "sending" && (
                            <button type="button" onClick={() => remove(m)} aria-label={s("deleteMessage")} title={s("deleteMessage")}
                              className={`w-7 h-7 -my-1.5 flex items-center justify-center rounded-lg ${T.trash}`}>
                              <Svg className="w-3.5 h-3.5">{Icon.trash}</Svg>
                            </button>
                          )}
                        </div>
                        {selected === m.id && ceoCanDelete && (
                          <button type="button" onClick={() => remove(m)}
                            className={`mt-1 text-xs font-semibold rounded-lg px-3 py-1.5 ${T.action}`}>
                            {s("delete")}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>

        {newBelow > 0 && (
          <button type="button" onClick={scrollToBottom}
            className={`absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs font-bold rounded-full pl-3 pr-2 py-1.5 shadow-lg ${T.pill}`}>
            {s("newMessages")} ({newBelow}) <Svg className="w-4 h-4">{Icon.down}</Svg>
          </button>
        )}
      </div>

      <form onSubmit={send} className={`shrink-0 px-3 sm:px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] ${T.composer}`}>
        {keyBanner && !loadError && (
          <p role="status" className={`mb-2 text-xs rounded-lg px-3 py-2 flex items-start gap-2 ${T.info}`}>
            <Svg className="w-4 h-4 shrink-0">{Icon.lock}</Svg>
            <span>{s(keyBanner)}</span>
          </p>
        )}
        {notice && (
          <p role="alert" className={`mb-2 text-xs rounded-lg px-3 py-2 ${T.error}`}>{say(notice)}</p>
        )}
        {(photo || preparing) && (
          <div className="mb-2 flex items-center gap-2">
            {photo ? (
              <div className="relative">
                <img src={photo.url} alt={s("photo")} className="w-16 h-16 rounded-xl object-cover" />
                <button type="button" onClick={() => setPhoto(null)} aria-label={s("removePhoto")}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center">
                  <Svg className="w-3.5 h-3.5">{Icon.close}</Svg>
                </button>
              </div>
            ) : (
              <p className={`text-xs ${T.muted}`}>{s("preparing")}</p>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={preparing || !ready} aria-label={s("addPhoto")}
            className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center disabled:opacity-50 ${T.iconBtn}`}>
            <Svg>{Icon.photo}</Svg>
          </button>
          {me.role === "staff" && (
            <button type="button" onClick={() => { setNotice(""); setDialog("leave"); }} disabled={!!loadError} aria-label={s("askDayOff")} title={s("askDayOff")}
              className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center disabled:opacity-50 ${T.iconBtn}`}>
              <Svg>{Icon.calendar}</Svg>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
          <textarea ref={textRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKeyDown}
            rows={1} maxLength={MAX_BODY}
            placeholder={ringState === "loading" ? s("securing") : s("placeholder")} aria-label={s("placeholder")}
            className={`flex-1 min-w-0 resize-none rounded-xl px-3.5 py-2.5 text-base sm:text-sm leading-snug focus:outline-none ${T.input}`} />
          <button type="submit" disabled={!canSubmit} aria-label={s("send")}
            className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">
            <Svg>{Icon.send}</Svg>
          </button>
        </div>
      </form>

      {dialog === "leave" && (
        <LeaveDialog theme={theme} lang={lang} canAddReason={ready} onClose={() => setDialog(null)}
          onSend={r => sendRequest({ kind: "leave", leave_from: r.from, leave_to: r.to }, r.reason)} />
      )}
      {dialog === "emergency" && (
        <EmergencyDialog theme={theme} lang={lang} canAddDetails={ready} onClose={() => setDialog(null)}
          onSend={r => sendRequest({ kind: "emergency", emergency_type: r.type }, r.details)} />
      )}

      {viewer && (
        <div role="dialog" aria-modal="true" aria-label={s("photo")} onClick={() => setViewer(null)}
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-3">
          <img src={viewer} alt={s("photo")} className="max-w-full max-h-full object-contain" />
          <button type="button" onClick={() => setViewer(null)} aria-label={s("close")}
            className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center">
            <Svg>{Icon.close}</Svg>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Count of messages from other people since this device last had the chat
 * open. Updates live, and re-checks every minute and when the app comes back
 * to the foreground. Returns 0 if the chat isn't set up or the user can't see it.
 */
export function useChatUnread(client: SupabaseClient, userId: string | null, active: boolean): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const seen = loadSeen(userId);
    let q = client.from("chat_messages").select("id", { count: "exact", head: true }).neq("sender_id", userId);
    if (seen) q = q.gt("created_at", seen);
    const { count: c, error } = await q;
    setCount(error ? 0 : c ?? 0);
  }, [client, userId]);

  useEffect(() => {
    if (!active || !userId) return;
    refresh();
    const t = setInterval(refresh, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const ch = client
      .channel(`team-chat-unread-${newId()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, payload => {
        if ((payload.new as { sender_id?: string } | null)?.sender_id !== userId) setCount(c => c + 1);
      })
      .subscribe();
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      client.removeChannel(ch);
    };
  }, [active, userId, refresh, client]);

  return active ? count : 0;
}

/**
 * Keeps the end-to-end keys moving while the app is open, even off the chat
 * screen: hands the chat key to new member devices, and makes a new chat key
 * when someone leaves. Runs on start, when a device joins or leaves, and every 5 minutes.
 */
export function useChatKeyMaintenance(client: SupabaseClient, userId: string | null) {
  useEffect(() => {
    if (!userId || !e2eSupported()) return;
    let stopped = false;
    const run = () => { if (!stopped && navigator.onLine) syncKeyring(client, userId).catch(() => {}); };
    run();
    const t = setInterval(run, 5 * 60_000);
    const ch = client
      .channel(`team-chat-keys-${newId()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_devices" }, run)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_devices" }, run)
      .subscribe();
    return () => {
      stopped = true;
      clearInterval(t);
      client.removeChannel(ch);
    };
  }, [client, userId]);
}
