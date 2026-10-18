"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Camera, Check, Copy, LockKeyhole, MessageCircle, MoreHorizontal, Paperclip, Reply, Smile, Sparkles, Users, X, Trash2, Timer } from "lucide-react";
import { displayNickname, normalizeNickname } from "@/lib/nicknames";

type Attachment = { name: string; type: string; data: string };
type ChatMessage = { id: string; nickname: string; body: string; createdAt: string; attachment?: { name: string; type: string; data?: string } | null; expiresAt?: string | null; replyToId?: string | null };

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function encryptMessage(key: CryptoKey, payload: { body: string; attachment: Attachment | null; replyToId: string | null }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
  return `e2ee:v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptMessage(key: CryptoKey, message: ChatMessage): Promise<ChatMessage> {
  if (!message.body.startsWith("e2ee:v1:")) return message;
  try {
    const [, , ivText, cipherText] = message.body.split(":");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(ivText)) }, key, toArrayBuffer(base64ToBytes(cipherText)));
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as { body: string; attachment: Attachment | null; replyToId?: string | null };
    return { ...message, body: payload.body, attachment: payload.attachment, replyToId: payload.replyToId ?? null };
  } catch {
    return { ...message, body: "Messaggio cifrato: apri il link d’invito aggiornato per leggerlo.", attachment: null };
  }
}

const colors = ["#f0a978", "#9f9ee8", "#72b8aa", "#db88a1"];
const classicEmojis = ["😀", "😂", "😊", "😉", "😍", "😘", "😢", "😭", "😡", "👍", "🙏", "❤️"];
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase();
function formatTime(value: string) {
  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState("");
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null);
  const [keyReady, setKeyReady] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [onlineCount, setOnlineCount] = useState(1);
  const [ttlSeconds, setTtlSeconds] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const messageFetchId = useRef(0);
  const shouldAutoScroll = useRef(true);
  const pendingMessage = useRef<{ id: string; body: string; attachmentData: string | null; replyToId: string | null; encryptedBody: string | null } | null>(null);
  const effectiveNow = clockTick - serverTimeOffsetMs;
  const visibleMessages = messages.filter((message) => !message.expiresAt || Date.parse(message.expiresAt) > effectiveNow);
  const replyTarget = replyToId ? visibleMessages.find((message) => message.id === replyToId) ?? null : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedRoom = params.get("room");
    const savedRoom = window.localStorage.getItem("duetto-room");
    const room = linkedRoom && /^[a-zA-Z0-9_-]{1,48}$/.test(linkedRoom)
      ? linkedRoom
      : savedRoom ?? crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    window.localStorage.setItem("duetto-room", room);
    if (!linkedRoom || linkedRoom !== room) {
      params.set("room", room);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
    setRoomId(room);
    void (async () => {
      try {
        const match = window.location.hash.match(/(?:^#|&)key=([A-Za-z0-9_-]{43})/);
        let keyBytes: Uint8Array;
        if (match) {
          const raw = match[1].replace(/-/g, "+").replace(/_/g, "/");
          keyBytes = base64ToBytes(raw + "=");
        } else {
          keyBytes = crypto.getRandomValues(new Uint8Array(32));
          const encoded = bytesToBase64(keyBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
          window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#key=${encoded}`);
        }
        setRoomKey(await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["encrypt", "decrypt"]));
      } catch {
        setError("Non riesco a inizializzare la cifratura su questo browser.");
      } finally {
        setKeyReady(true);
      }
    })();
    const session = window.localStorage.getItem("duetto-session") ?? crypto.randomUUID();
    window.localStorage.setItem("duetto-session", session);
    setSessionId(session);
    const saved = window.localStorage.getItem("duetto-nickname");
    if (saved) setNickname(saved);
  }, []);

  useEffect(() => {
    const syncKeyFromInvite = () => {
      const match = window.location.hash.match(/(?:^#|&)key=([A-Za-z0-9_-]{43})/);
      if (!match) return;
      try {
        const raw = match[1].replace(/-/g, "+").replace(/_/g, "/");
        pendingMessage.current = null;
        setKeyReady(false);
        void crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(raw + "=")), "AES-GCM", false, ["encrypt", "decrypt"])
          .then((key) => { setRoomKey(key); setKeyReady(true); })
          .catch(() => { setRoomKey(null); setKeyReady(true); setError("Il link d’invito contiene una chiave non valida."); });
      } catch {
        setError("Il link d’invito contiene una chiave non valida.");
      }
    };
    window.addEventListener("hashchange", syncKeyFromInvite);
    return () => window.removeEventListener("hashchange", syncKeyFromInvite);
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!nickname || !roomId || !sessionId) return;
    const fetchId = ++messageFetchId.current;
    try {
      const params = new URLSearchParams({ room: roomId, session: sessionId, nickname });
      const requestStartedAt = Date.now();
      const response = await fetch(`/api/messages?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Connessione al server non riuscita.");
      const data = await response.json() as { messages: ChatMessage[]; onlineCount?: number; ttlSeconds?: number; serverNow?: string };
      const responseReceivedAt = Date.now();
      if (fetchId !== messageFetchId.current) return;
      if (data.serverNow) {
        const serverTime = Date.parse(data.serverNow);
        if (Number.isFinite(serverTime)) setServerTimeOffsetMs((requestStartedAt + (responseReceivedAt - requestStartedAt) / 2) - serverTime);
      }
      const decryptedMessages = await Promise.all(data.messages.map((message) => roomKey ? decryptMessage(roomKey, message) : message));
      if (fetchId !== messageFetchId.current) return;
      setMessages(decryptedMessages);
      setOnlineCount(data.onlineCount ?? 1);
      setTtlSeconds(data.ttlSeconds ?? 0);
      setError("");
    } catch {
      if (fetchId !== messageFetchId.current) return;
      setError("Non riesco a raggiungere la chat. Riprovo tra poco.");
    } finally {
      if (fetchId === messageFetchId.current) setLoading(false);
    }
  }, [nickname, roomId, sessionId, roomKey]);

  useEffect(() => {
    if (!nickname || !roomId || !sessionId) return;
    setLoading(true);
    void fetchMessages();
    const timer = window.setInterval(() => void fetchMessages(), 2200);
    return () => window.clearInterval(timer);
  }, [nickname, roomId, sessionId, fetchMessages]);

  useEffect(() => {
    const tick = () => setClockTick(Date.now());
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (shouldAutoScroll.current && conversation) {
      conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (replyToId && !visibleMessages.some((message) => message.id === replyToId)) setReplyToId(null);
  }, [clockTick, messages, replyToId, serverTimeOffsetMs]);

  function join(event: FormEvent) {
    event.preventDefault();
    const clean = draftName.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!clean) return;
    window.localStorage.setItem("duetto-nickname", clean);
    setNickname(clean);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && !attachment) || sending) return;
    const attachmentBeingSent = attachment;
    const attachmentData = attachmentBeingSent?.data ?? null;
    const replyToBeingSent = replyTarget?.id ?? null;
    if (!pendingMessage.current || pendingMessage.current.body !== body || pendingMessage.current.attachmentData !== attachmentData || pendingMessage.current.replyToId !== replyToBeingSent) {
      pendingMessage.current = { id: crypto.randomUUID(), body, attachmentData, replyToId: replyToBeingSent, encryptedBody: null };
    }
    const messageId = pendingMessage.current.id;
    setSending(true);
    setError("");
    try {
      if (!roomKey) throw new Error("La cifratura non è pronta. Riprova tra un momento.");
      pendingMessage.current.encryptedBody ??= await encryptMessage(roomKey, { body, attachment: attachmentBeingSent, replyToId: replyToBeingSent });
      const encryptedBody = pendingMessage.current.encryptedBody;
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: roomId, nickname, body: encryptedBody, clientMessageId: messageId }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(failure?.error ?? "Messaggio non inviato. Controlla la connessione e riprova.");
      }
      const data = await response.json() as { message: ChatMessage };
      if (!data.message?.id) throw new Error("Il server non ha confermato il messaggio. Riprova.");
      const clearMessage = await decryptMessage(roomKey, data.message);
      setMessages((current) => current.some((message) => message.id === clearMessage.id)
        ? current
        : [...current, clearMessage].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200));
      if (pendingMessage.current?.id === messageId) pendingMessage.current = null;
      if (draft.trim() === body) {
        setDraft("");
        if (inputRef.current) inputRef.current.style.height = "auto";
      }
      if (attachment === attachmentBeingSent) setAttachment(null);
      if (replyToId === replyToBeingSent) setReplyToId(null);
      await fetchMessages();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Messaggio non inviato. Controlla la connessione e riprova.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    setDraft(nextDraft);
    setShowEmojiPicker(false);
    requestAnimationFrame(() => {
      input.focus();
      const caret = start + emoji.length;
      input.setSelectionRange(caret, caret);
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
    });
  }

  function scrollToMessage(id: string) {
    document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function pickFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setError("Puoi allegare immagini o video.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Il file è troppo grande. Il limite è 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAttachment({ name: file.name, type: file.type, data: reader.result });
        setError("");
      }
    };
    reader.readAsDataURL(file);
  }

  const mediaUrl = (message: ChatMessage) => message.attachment?.data ?? `/api/messages?room=${encodeURIComponent(roomId)}&session=${encodeURIComponent(sessionId)}&nickname=${encodeURIComponent(nickname)}&attachmentId=${encodeURIComponent(message.id)}`;

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function changeTimer(value: string) {
    const ttl = Number(value);
    setSavingSettings(true);
    try {
      const response = await fetch("/api/messages", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: roomId, nickname, ttlSeconds: ttl }),
      });
      if (!response.ok) throw new Error("Impostazione non salvata.");
      setTtlSeconds(ttl);
      setError("");
    } catch {
      setError("Non riesco a salvare il timer. Riprova.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function clearChat() {
    if (!window.confirm("Svuotare la conversazione per entrambi? I messaggi e gli allegati verranno eliminati definitivamente.")) return;
    setSavingSettings(true);
    try {
      const response = await fetch("/api/messages", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: roomId, nickname }),
      });
      if (!response.ok) throw new Error("Chat non svuotata.");
      setMessages([]);
      setError("");
      setShowSettings(false);
    } catch {
      setError("Non riesco a svuotare la chat. Riprova.");
    } finally {
      setSavingSettings(false);
    }
  }

  function leave() {
    window.localStorage.removeItem("duetto-nickname");
    setNickname("");
    setDraftName("");
    setMessages([]);
  }

  if (!nickname) return (
    <main className="entry-page">
      <div className="entry-grain" />
      <nav className="entry-nav"><a className="brand" href="#"><span className="brand-mark"><MessageCircle size={17} strokeWidth={2.4} /></span>taccuino<span className="brand-period">.</span></a><span className="nav-note"><LockKeyhole size={13} /> senza account, senza complicazioni</span></nav>
      <section className="entry-grid">
        <div className="entry-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> UNO SPAZIO PER DUE</div>
          <h1>Le parole<br />fanno <em>casa.</em></h1>
          <p className="entry-description">Una chat piccola, tutta vostra.<br />Scegli un nome e comincia a parlare.</p>
          <form className="join-form" onSubmit={join}>
            <label htmlFor="nickname">SCEGLI IL TUO NICKNAME</label>
            <div className="join-field"><span className="at-sign">@</span><input id="nickname" value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={24} placeholder="Il tuo nickname" autoComplete="nickname" autoFocus /><button type="submit" aria-label="Entra nella chat"><ArrowUp size={18} /></button></div>
            <span className="join-hint"><LockKeyhole size={12} /> Il tuo nome resta solo su questo dispositivo.</span>
          </form>
          <div className="entry-foot"><span className="foot-avatars"><i>A</i><i>M</i></span><span>Un invito, due persone,<br /><strong>una conversazione alla volta.</strong></span></div>
        </div>
        <div className="preview-wrap" aria-hidden="true">
          <div className="preview-glow" />
          <div className="preview-card">
            <div className="preview-top"><div className="preview-dots"><i /><i /><i /></div><span>una piccola anteprima</span><MoreHorizontal size={17} /></div>
            <div className="preview-conversation">
              <div className="day-divider"><span>OGGI</span></div>
              <div className="preview-message incoming"><div className="preview-avatar avatar-peach">M</div><div><span className="preview-name">Marta <small>10:41</small></span><div className="bubble">Ci sei? Ho una cosa bella da raccontarti.</div></div></div>
              <div className="preview-message outgoing"><div><span className="preview-name">Tu <small>10:42</small></span><div className="bubble">Sempre. Raccontami tutto ✨</div></div><div className="preview-avatar avatar-lilac">T</div></div>
              <div className="typing"><span /><span /><span /><small>Marta sta scrivendo</small></div>
            </div>
            <div className="preview-compose"><span>Scrivi un messaggio...</span><span className="compose-arrow"><ArrowUp size={15} /></span></div>
          </div>
          <div className="preview-sticker"><Sparkles size={15} /> solo le cose belle</div>
        </div>
      </section>
      <footer className="entry-footer"><span>POCO RUMORE. MOLTA PRESENZA.</span><span>FATTO PER LE CONVERSAZIONI CHE CONTANO.</span></footer>
    </main>
  );

  return (
    <main className="chat-page">
      <aside className="rail"><a className="rail-brand" href="#" aria-label="Taccuino"><span className="brand-mark"><MessageCircle size={17} strokeWidth={2.4} /></span></a><div className="rail-center"><div className="rail-room active"><span>♡</span><i /></div><button className="rail-add" onClick={copyLink} aria-label="Copia invito"><span>+</span></button></div><button className="rail-profile" onClick={leave} title="Esci dalla chat"><span style={{ background: colors[nickname.charCodeAt(0) % colors.length] }}>{initials(displayNickname(nickname, nickname))}</span></button></aside>
      <section className="chat-shell">
        <header className="chat-header"><div className="chat-title-group"><button className="mobile-back" onClick={leave} aria-label="Esci"><ArrowLeft size={18} /></button><div className="room-symbol">♡</div><div><h1>Il salotto</h1><p><span className="live-dot" /> {onlineCount > 1 ? "Ci siete in due" : "Il tuo piccolo spazio"}</p></div></div><div className="header-actions"><button className={`invite-button ${copied ? "copied" : ""}`} onClick={copyLink}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Link copiato" : "Invita qualcuno"}</button><button className="more-button" onClick={() => setShowSettings((value) => !value)} aria-label="Impostazioni chat" aria-expanded={showSettings}><MoreHorizontal size={19} /></button></div></header>
        {showSettings && <div className="room-menu" role="dialog" aria-label="Impostazioni chat"><label htmlFor="message-ttl"><Timer size={14} /> Autodistruzione messaggi</label><select id="message-ttl" value={ttlSeconds} disabled={savingSettings} onChange={(event) => void changeTimer(event.target.value)}><option value={0}>Disattivata</option><option value={300}>Dopo 5 minuti</option><option value={900}>Dopo 15 minuti</option><option value={1800}>Dopo 30 minuti</option><option value={3600}>Dopo 1 ora</option><option value={86400}>Dopo 1 giorno</option><option value={604800}>Dopo 7 giorni</option></select><p>Il timer vale per i messaggi inviati da questo momento.</p><div className="menu-divider" /><button className="clear-chat-button" onClick={() => void clearChat()} disabled={savingSettings}><Trash2 size={14} /> {savingSettings ? "Attendi…" : "Svuota chat per entrambi"}</button></div>}
        <div className="conversation" ref={conversationRef} role="region" aria-label="Conversazione" tabIndex={0} onScroll={(event) => { const element = event.currentTarget; shouldAutoScroll.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
          <div className="conversation-inner">
            {visibleMessages.length > 0 && <div className="history-divider"><span>LA VOSTRA CONVERSAZIONE</span></div>}
            {loading && visibleMessages.length === 0 && <div className="loading-note"><span className="loader" /> Sto preparando il salotto...</div>}
            {visibleMessages.map((message, index) => {
              const mine = normalizeNickname(message.nickname) === normalizeNickname(nickname);
              const previous = visibleMessages[index - 1];
              const repliedMessage = message.replyToId ? visibleMessages.find((item) => item.id === message.replyToId) ?? null : null;
              const newSender = !previous || previous.nickname !== message.nickname;
              const timerLabel = message.expiresAt ? `Messaggio con timer, scade alle ${formatTime(message.expiresAt)}` : "";
              return <div key={message.id} id={`message-${message.id}`} className={`message-row ${mine ? "mine" : "theirs"} ${newSender ? "new-sender" : ""}`}>
                {!mine && newSender && <span className="message-avatar" style={{ background: colors[message.nickname.charCodeAt(0) % colors.length] }}>{initials(displayNickname(message.nickname, nickname))}</span>}
                <div className="message-content">{newSender && <div className="message-meta"><strong>{displayNickname(message.nickname, nickname)}</strong><span>{formatTime(message.createdAt)}</span></div>}{message.replyToId && <button type="button" className="reply-quote" disabled={!repliedMessage} onClick={() => repliedMessage && scrollToMessage(repliedMessage.id)}><strong>{repliedMessage ? displayNickname(repliedMessage.nickname, nickname) : "Risposta"}</strong><span>{repliedMessage ? (repliedMessage.body || (repliedMessage.attachment?.type.startsWith("video/") ? "Video" : "Immagine")).slice(0, 90) : "Messaggio non più disponibile"}</span></button>}{message.body && <div className="message-bubble">{message.body}{timerLabel && <span className="message-timer-marker" title={timerLabel} aria-label={timerLabel}><Timer size={12} aria-hidden="true" /></span>}</div>}{message.attachment && (message.attachment.type.startsWith("video/") ? <video className="message-media" src={mediaUrl(message)} controls preload="metadata" /> : <a href={mediaUrl(message)} target="_blank" rel="noreferrer"><img className="message-media" src={mediaUrl(message)} alt={message.attachment.name} loading="lazy" /></a>)}{timerLabel && !message.body && <span className="message-timer-marker attachment-timer-marker" title={timerLabel} aria-label={timerLabel}><Timer size={12} aria-hidden="true" /></span>}<div className="message-actions"><button type="button" className="message-reply-button" onClick={() => { setReplyToId(message.id); setShowEmojiPicker(false); inputRef.current?.focus(); }} aria-label={`Rispondi al messaggio di ${displayNickname(message.nickname, nickname)}`}><Reply size={13} /> Rispondi</button></div></div>
                {mine && newSender && <span className="message-avatar" style={{ background: colors[nickname.charCodeAt(0) % colors.length] }}>{initials(displayNickname(nickname, nickname))}</span>}
              </div>;
            })}
            {error && <div className="error-note">{error}</div>}
          </div>
        </div>
        <footer className="composer-area">{showEmojiPicker && <div className="emoji-picker" role="dialog" aria-label="Emoticon classiche">{classicEmojis.map((emoji) => <button key={emoji} type="button" aria-label={`Inserisci ${emoji}`} onMouseDown={(event) => event.preventDefault()} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div>}{replyTarget && <div className="reply-composer-preview"><span><strong>Rispondi a {displayNickname(replyTarget.nickname, nickname)}</strong><small>{(replyTarget.body || (replyTarget.attachment?.type.startsWith("video/") ? "Video" : "Immagine")).slice(0, 100)}</small></span><button type="button" aria-label="Annulla risposta" onClick={() => setReplyToId(null)}><X size={15} /></button></div>}<form className="composer" onSubmit={send}><input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /><input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /><button type="button" className="attach-button" aria-label="Scatta una foto" title="Scatta una foto" onClick={() => cameraRef.current?.click()}><Camera size={17} /></button><button type="button" className="attach-button" aria-label="Allega una foto o un video" title="Allega foto o video" onClick={() => fileRef.current?.click()}><Paperclip size={17} /></button><button type="button" className={`attach-button emoji-toggle ${showEmojiPicker ? "selected" : ""}`} aria-label="Apri emoticon" aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker((open) => !open)}><Smile size={17} /></button><textarea ref={inputRef} rows={1} value={draft} maxLength={2000} onChange={(e) => { setDraft(e.target.value); e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 144)}px`; }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Scrivi qualcosa di bello..." aria-label="Scrivi un messaggio" /><span className="composer-separator" /><button type="submit" className="send-button" disabled={(!draft.trim() && !attachment) || sending || !keyReady} aria-label="Invia messaggio"><ArrowUp size={18} /></button></form>{attachment && <div className="attachment-preview"><span>{attachment.type.startsWith("video/") ? "Video" : "Immagine"}: {attachment.name}</span><button type="button" aria-label="Rimuovi allegato" onClick={() => setAttachment(null)}><X size={14} /></button></div>}<div className="composer-caption"><span><LockKeyhole size={11} /> {roomKey ? "Cifratura end-to-end attiva" : "Cifratura non disponibile"}</span><span><kbd>↵</kbd> invia&nbsp; · &nbsp;<kbd>⇧ ↵</kbd> nuova riga · file max 2 MB</span></div></footer>
      </section>
      <aside className="info-panel"><div className="info-top"><span>IL VOSTRO POSTO</span><MoreHorizontal size={18} /></div><div className="room-art"><div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-heart">♡</div><span className="art-star star-a">✳</span><span className="art-star star-b">·</span><span className="art-star star-c">✳</span></div><div className="room-info"><span className="room-label">QUESTA CHAT</span><h2>Il salotto</h2><p>Un posto tranquillo per dirsi le cose con calma.</p><button className="info-invite" onClick={copyLink}><Users size={15} /> {copied ? "Invito copiato" : "Invita una persona"}<ArrowDown size={13} /></button></div><div className="info-divider" /><div className="people-heading"><span>QUI DENTRO</span><span className="people-count">{onlineCount}/2</span></div><div className="people-list"><div className="person"><span className="person-avatar" style={{ background: colors[nickname.charCodeAt(0) % colors.length] }}>{initials(displayNickname(nickname, nickname))}</span><span>{displayNickname(nickname, nickname)}<small>sei tu</small></span><i className="person-online" /></div>{onlineCount > 1 && <div className="person"><span className="person-avatar person-guest">+</span><span>amoretuo<small>qui con te</small></span><i className="person-online" /></div>}</div><button className="leave-link" onClick={leave}>Esci da questo spazio <ArrowLeft size={13} /></button><div className="info-footer"><span>TACCUINO<span className="brand-period">.</span></span><span>POCO, MA BENE.</span></div></aside>
    </main>
  );
}
