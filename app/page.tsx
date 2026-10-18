"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, LockKeyhole, MessageCircle, MoreHorizontal, Paperclip, Sparkles, Users, X } from "lucide-react";

type Attachment = { name: string; type: string; data: string };
type ChatMessage = { id: string; nickname: string; body: string; createdAt: string; attachment?: { name: string; type: string } | null };

const colors = ["#f0a978", "#9f9ee8", "#72b8aa", "#db88a1"];
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase();

function formatTime(value: string) {
  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [onlineCount, setOnlineCount] = useState(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    const session = window.localStorage.getItem("duetto-session") ?? crypto.randomUUID();
    window.localStorage.setItem("duetto-session", session);
    setSessionId(session);
    const saved = window.localStorage.getItem("duetto-nickname");
    if (saved) setNickname(saved);
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!nickname || !roomId || !sessionId) return;
    try {
      const params = new URLSearchParams({ room: roomId, session: sessionId, nickname });
      const response = await fetch(`/api/messages?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Connessione al server non riuscita.");
      const data = await response.json() as { messages: ChatMessage[]; onlineCount?: number };
      setMessages(data.messages);
      setOnlineCount(data.onlineCount ?? 1);
      setError("");
    } catch {
      setError("Non riesco a raggiungere la chat. Riprovo tra poco.");
    } finally {
      setLoading(false);
    }
  }, [nickname, roomId, sessionId]);

  useEffect(() => {
    if (!nickname || !roomId || !sessionId) return;
    setLoading(true);
    void fetchMessages();
    const timer = window.setInterval(() => void fetchMessages(), 2200);
    return () => window.clearInterval(timer);
  }, [nickname, roomId, sessionId, fetchMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    setSending(true);
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: roomId, nickname, body, attachment }),
      });
      if (!response.ok) throw new Error("Messaggio non inviato.");
      await fetchMessages();
      setAttachment(null);
    } catch {
      setDraft(body);
      setError("Messaggio non inviato. Controlla la connessione e riprova.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function pickFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setError("Puoi allegare immagini o video.");
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setError("Il file è troppo grande. Il limite è 2,5 MB.");
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

  const mediaUrl = (messageId: string) => `/api/messages?room=${encodeURIComponent(roomId)}&session=${encodeURIComponent(sessionId)}&nickname=${encodeURIComponent(nickname)}&attachmentId=${encodeURIComponent(messageId)}`;

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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
      <nav className="entry-nav"><a className="brand" href="#"><span className="brand-mark"><MessageCircle size={17} strokeWidth={2.4} /></span>duetto<span className="brand-period">.</span></a><span className="nav-note"><LockKeyhole size={13} /> senza account, senza complicazioni</span></nav>
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
      <aside className="rail"><a className="rail-brand" href="#" aria-label="Duetto"><span className="brand-mark"><MessageCircle size={17} strokeWidth={2.4} /></span></a><div className="rail-center"><div className="rail-room active"><span>♡</span><i /></div><button className="rail-add" onClick={copyLink} aria-label="Copia invito"><span>+</span></button></div><button className="rail-profile" onClick={leave} title="Esci dalla chat"><span style={{ background: colors[nickname.charCodeAt(0) % colors.length] }}>{initials(nickname)}</span></button></aside>
      <section className="chat-shell">
        <header className="chat-header"><div className="chat-title-group"><button className="mobile-back" onClick={leave} aria-label="Esci"><ArrowLeft size={18} /></button><div className="room-symbol">♡</div><div><h1>Il salotto</h1><p><span className="live-dot" /> {onlineCount > 1 ? "Ci siete in due" : "Il tuo piccolo spazio"}</p></div></div><div className="header-actions"><button className={`invite-button ${copied ? "copied" : ""}`} onClick={copyLink}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Link copiato" : "Invita qualcuno"}</button><button className="more-button" onClick={leave} aria-label="Esci dalla chat"><MoreHorizontal size={19} /></button></div></header>
        <div className="conversation">
          <div className="conversation-inner">
            <div className="welcome-card"><div className="welcome-icon"><MessageCircle size={19} /></div><p className="welcome-kicker">BENVENUTI NEL VOSTRO SPAZIO</p><h2>Le conversazioni<br />cominciano da qui.</h2><p>Solo voi due. Nessuna fretta.</p><div className="welcome-rule"><span /></div></div>
            {messages.length > 0 && <div className="history-divider"><span>LA VOSTRA CONVERSAZIONE</span></div>}
            {loading && messages.length === 0 && <div className="loading-note"><span className="loader" /> Sto preparando il salotto...</div>}
            {messages.map((message, index) => {
              const mine = message.nickname === nickname;
              const previous = messages[index - 1];
              const newSender = !previous || previous.nickname !== message.nickname;
              return <div key={message.id} className={`message-row ${mine ? "mine" : "theirs"} ${newSender ? "new-sender" : ""}`}>
                {!mine && newSender && <span className="message-avatar" style={{ background: colors[message.nickname.charCodeAt(0) % colors.length] }}>{initials(message.nickname)}</span>}
                <div className="message-content">{newSender && <div className="message-meta"><strong>{mine ? "Tu" : message.nickname}</strong><span>{formatTime(message.createdAt)}</span></div>}{message.body && <div className="message-bubble">{message.body}</div>}{message.attachment && (message.attachment.type.startsWith("video/") ? <video className="message-media" src={mediaUrl(message.id)} controls preload="metadata" /> : <a href={mediaUrl(message.id)} target="_blank" rel="noreferrer"><img className="message-media" src={mediaUrl(message.id)} alt={message.attachment.name} loading="lazy" /></a>)}</div>
                {mine && newSender && <span className="message-avatar" style={{ background: colors[nickname.charCodeAt(0) % colors.length] }}>{initials(nickname)}</span>}
              </div>;
            })}
            {error && <div className="error-note">{error}</div>}
            <div ref={endRef} />
          </div>
        </div>
        <footer className="composer-area"><form className="composer" onSubmit={send}><input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /><button type="button" className="attach-button" aria-label="Allega una foto o un video" title="Allega foto o video" onClick={() => fileRef.current?.click()}><Paperclip size={17} /></button><textarea ref={inputRef} rows={1} value={draft} maxLength={2000} onChange={(e) => { setDraft(e.target.value); e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 144)}px`; }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Scrivi qualcosa di bello..." aria-label="Scrivi un messaggio" /><span className="composer-separator" /><button type="submit" className="send-button" disabled={(!draft.trim() && !attachment) || sending} aria-label="Invia messaggio"><ArrowUp size={18} /></button></form>{attachment && <div className="attachment-preview"><span>{attachment.type.startsWith("video/") ? "Video" : "Immagine"}: {attachment.name}</span><button type="button" aria-label="Rimuovi allegato" onClick={() => setAttachment(null)}><X size={14} /></button></div>}<div className="composer-caption"><span><LockKeyhole size={11} /> Questo spazio è vostro.</span><span><kbd>↵</kbd> invia&nbsp; · &nbsp;<kbd>⇧ ↵</kbd> nuova riga · file max 2,5 MB</span></div></footer>
      </section>
      <aside className="info-panel"><div className="info-top"><span>IL VOSTRO POSTO</span><MoreHorizontal size={18} /></div><div className="room-art"><div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-heart">♡</div><span className="art-star star-a">✳</span><span className="art-star star-b">·</span><span className="art-star star-c">✳</span></div><div className="room-info"><span className="room-label">QUESTA CHAT</span><h2>Il salotto</h2><p>Un posto tranquillo per dirsi le cose con calma.</p><button className="info-invite" onClick={copyLink}><Users size={15} /> {copied ? "Invito copiato" : "Invita una persona"}<ArrowDown size={13} /></button></div><div className="info-divider" /><div className="people-heading"><span>QUI DENTRO</span><span className="people-count">{onlineCount}/2</span></div><div className="people-list"><div className="person"><span className="person-avatar" style={{ background: colors[nickname.charCodeAt(0) % colors.length] }}>{initials(nickname)}</span><span>{nickname}<small>sei tu</small></span><i className="person-online" /></div>{onlineCount > 1 && <div className="person"><span className="person-avatar person-guest">+</span><span>Qualcuno di caro<small>qui con te</small></span><i className="person-online" /></div>}</div><button className="leave-link" onClick={leave}>Esci da questo spazio <ArrowLeft size={13} /></button><div className="info-footer"><span>DUETTO<span className="brand-period">.</span></span><span>POCO, MA BENE.</span></div></aside>
    </main>
  );
}
