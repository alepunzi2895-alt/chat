import { createClient } from "@libsql/client/web";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const globalForDb = globalThis as typeof globalThis & { duettoDb?: ReturnType<typeof createClient>; duettoReady?: Promise<void> };

function database() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("Turso non configurato. Aggiungi TURSO_DATABASE_URL e TURSO_AUTH_TOKEN.");
  globalForDb.duettoDb ??= createClient({ url, authToken });
  globalForDb.duettoReady ??= globalForDb.duettoDb.execute(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room TEXT NOT NULL,
    nickname TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).then(async () => {
    await globalForDb.duettoDb!.execute("CREATE INDEX IF NOT EXISTS messages_room_created ON messages(room, created_at)");
    await globalForDb.duettoDb!.execute(`CREATE TABLE IF NOT EXISTS participants (
      room TEXT NOT NULL,
      session_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      PRIMARY KEY (room, session_id)
    )`);
    await globalForDb.duettoDb!.execute("CREATE INDEX IF NOT EXISTS participants_room_seen ON participants(room, last_seen)");
    await globalForDb.duettoDb!.execute(`CREATE TABLE IF NOT EXISTS attachments (
      message_id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    )`);
    await globalForDb.duettoDb!.execute("CREATE INDEX IF NOT EXISTS attachments_room ON attachments(room)");
    await globalForDb.duettoDb!.execute(`CREATE TABLE IF NOT EXISTS room_settings (
      room TEXT PRIMARY KEY,
      ttl_seconds INTEGER NOT NULL DEFAULT 0
    )`);
    await globalForDb.duettoDb!.execute(`CREATE TABLE IF NOT EXISTS message_expiry (
      message_id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`);
    await globalForDb.duettoDb!.execute("CREATE INDEX IF NOT EXISTS message_expiry_room_date ON message_expiry(room, expires_at)");
  });
  return { db: globalForDb.duettoDb, ready: globalForDb.duettoReady };
}

function validRoom(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value);
}

export async function GET(request: NextRequest) {
  const room = request.nextUrl.searchParams.get("room");
  const session = request.nextUrl.searchParams.get("session");
  const nickname = request.nextUrl.searchParams.get("nickname")?.trim();
  if (!validRoom(room) || !session || !/^[\da-f-]{36}$/i.test(session) || !nickname || nickname.length > 24) return NextResponse.json({ error: "Stanza o nickname non validi." }, { status: 400 });
  try {
    const { db, ready } = database();
    await ready;
    const now = new Date().toISOString();
    await db.execute({ sql: "DELETE FROM attachments WHERE room = ? AND message_id IN (SELECT message_id FROM message_expiry WHERE room = ? AND expires_at <= ?)", args: [room, room, now] });
    await db.execute({ sql: "DELETE FROM messages WHERE room = ? AND id IN (SELECT message_id FROM message_expiry WHERE room = ? AND expires_at <= ?)", args: [room, room, now] });
    await db.execute({ sql: "DELETE FROM message_expiry WHERE room = ? AND expires_at <= ?", args: [room, now] });
    const attachmentId = request.nextUrl.searchParams.get("attachmentId");
    if (attachmentId) {
      const file = await db.execute({ sql: "SELECT name, type, data FROM attachments WHERE message_id = ? AND room = ?", args: [attachmentId, room] });
      const row = file.rows[0];
      if (!row) return NextResponse.json({ error: "File non trovato." }, { status: 404 });
      const binary = atob(String(row.data));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new NextResponse(bytes, { headers: { "content-type": String(row.type), "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(row.name))}`, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
    }
    const lastSeen = new Date().toISOString();
    await db.execute({
      sql: "INSERT INTO participants (room, session_id, nickname, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(room, session_id) DO UPDATE SET nickname = excluded.nickname, last_seen = excluded.last_seen",
      args: [room, session, nickname, lastSeen],
    });
    await db.execute({ sql: "DELETE FROM participants WHERE room = ? AND last_seen < ?", args: [room, new Date(Date.now() - 60_000).toISOString()] });
    const result = await db.execute({ sql: "SELECT m.id, m.nickname, m.body, m.created_at, a.name AS attachment_name, a.type AS attachment_type, e.expires_at FROM messages m LEFT JOIN attachments a ON a.message_id = m.id AND a.room = m.room LEFT JOIN message_expiry e ON e.message_id = m.id AND e.room = m.room WHERE m.room = ? ORDER BY m.created_at DESC LIMIT 200", args: [room] });
    const messages = result.rows.map((row) => ({ id: String(row.id), nickname: String(row.nickname), body: String(row.body), createdAt: String(row.created_at), attachment: row.attachment_type ? { name: String(row.attachment_name), type: String(row.attachment_type) } : null, expiresAt: row.expires_at ? String(row.expires_at) : null })).reverse();
    const people = await db.execute({ sql: "SELECT COUNT(*) AS count FROM participants WHERE room = ? AND last_seen >= ?", args: [room, new Date(Date.now() - 45_000).toISOString()] });
    const setting = await db.execute({ sql: "SELECT ttl_seconds FROM room_settings WHERE room = ?", args: [room] });
    return NextResponse.json({ messages, onlineCount: Number(people.rows[0]?.count ?? 1), ttlSeconds: Number(setting.rows[0]?.ttl_seconds ?? 0) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Turso read error:", error);
    return NextResponse.json({ error: "Impossibile caricare i messaggi." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 }); }
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 });
  const { room, nickname, body, attachment, clientMessageId } = payload as Record<string, unknown>;
  const hasAttachment = attachment !== undefined && attachment !== null;
  const file = hasAttachment && typeof attachment === "object" ? attachment as Record<string, unknown> : null;
  const data = typeof file?.data === "string" ? file.data : "";
  const encoded = data.split(",", 2)[1] ?? "";
  const validAttachment = !hasAttachment || (!!file && typeof file.name === "string" && file.name.length <= 180 && typeof file.type === "string" && (/^image\/(jpeg|png|gif|webp|avif)$/.test(file.type) || /^video\/(mp4|webm|quicktime)$/.test(file.type)) && data.startsWith(`data:${file.type};base64,`) && encoded.length <= 3_500_000 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded));
  const validClientMessageId = clientMessageId === undefined || (typeof clientMessageId === "string" && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(clientMessageId));
  const validBody = typeof body === "string" && body.length <= 4_200_000 && /^e2ee:v1:[A-Za-z0-9+/]{16}={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(body);
  if (!validRoom(room) || typeof nickname !== "string" || !nickname.trim() || nickname.length > 24 || typeof body !== "string" || !validBody || hasAttachment || !validAttachment || !validClientMessageId) {
    return NextResponse.json({ error: "Nickname o messaggio non valido." }, { status: 400 });
  }
  const id = typeof clientMessageId === "string" ? clientMessageId : crypto.randomUUID();
  try {
    const { db, ready } = database();
    await ready;
    const existing = await db.execute({ sql: "SELECT m.id, m.room, m.nickname, m.body, m.created_at, a.name AS attachment_name, a.type AS attachment_type, e.expires_at FROM messages m LEFT JOIN attachments a ON a.message_id = m.id AND a.room = m.room LEFT JOIN message_expiry e ON e.message_id = m.id AND e.room = m.room WHERE m.id = ?", args: [id] });
    const existingRow = existing.rows[0];
    if (existingRow) {
      if (String(existingRow.room) !== room || String(existingRow.nickname) !== nickname.trim() || String(existingRow.body) !== body.trim()) {
        return NextResponse.json({ error: "ID del messaggio già utilizzato." }, { status: 409 });
      }
      return NextResponse.json({ message: { id: String(existingRow.id), nickname: String(existingRow.nickname), body: String(existingRow.body), createdAt: String(existingRow.created_at), attachment: existingRow.attachment_type ? { name: String(existingRow.attachment_name), type: String(existingRow.attachment_type) } : null, expiresAt: existingRow.expires_at ? String(existingRow.expires_at) : null } }, { status: 201 });
    }
    const setting = await db.execute({ sql: "SELECT ttl_seconds FROM room_settings WHERE room = ?", args: [room] });
    const ttlSeconds = Number(setting.rows[0]?.ttl_seconds ?? 0);
    const createdAt = new Date().toISOString();
    const expiresAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    const statements: Array<{ sql: string; args: (string | number | null)[] }> = [
      { sql: "INSERT OR IGNORE INTO messages (id, room, nickname, body, created_at) VALUES (?, ?, ?, ?, ?)", args: [id, room, nickname.trim(), body.trim(), createdAt] },
    ];
    if (file) statements.push({ sql: "INSERT OR IGNORE INTO attachments (message_id, room, name, type, data) VALUES (?, ?, ?, ?, ?)", args: [id, room, file.name as string, file.type as string, encoded] });
    if (expiresAt) statements.push({ sql: "INSERT OR IGNORE INTO message_expiry (message_id, room, expires_at) VALUES (?, ?, ?)", args: [id, room, expiresAt] });
    await db.batch(statements, "write");
    const saved = await db.execute({ sql: "SELECT m.id, m.room, m.nickname, m.body, m.created_at, a.name AS attachment_name, a.type AS attachment_type, e.expires_at FROM messages m LEFT JOIN attachments a ON a.message_id = m.id AND a.room = m.room LEFT JOIN message_expiry e ON e.message_id = m.id AND e.room = m.room WHERE m.id = ?", args: [id] });
    const row = saved.rows[0];
    if (!row || String(row.room) !== room || String(row.nickname) !== nickname.trim() || String(row.body) !== body.trim()) {
      return NextResponse.json({ error: "ID del messaggio già utilizzato." }, { status: 409 });
    }
    return NextResponse.json({ message: { id: String(row.id), nickname: String(row.nickname), body: String(row.body), createdAt: String(row.created_at), attachment: row.attachment_type ? { name: String(row.attachment_name), type: String(row.attachment_type) } : null, expiresAt: row.expires_at ? String(row.expires_at) : null } }, { status: 201 });
  } catch (error) {
    console.error("Turso write error:", error);
    return NextResponse.json({ error: "Impossibile salvare il messaggio." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 }); }
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 });
  const { room, nickname, ttlSeconds } = payload as Record<string, unknown>;
  if (!validRoom(room) || typeof nickname !== "string" || !nickname.trim() || nickname.length > 24 || ![0, 300, 900, 1800, 3600, 86400, 604800].includes(Number(ttlSeconds))) {
    return NextResponse.json({ error: "Impostazioni non valide." }, { status: 400 });
  }
  try {
    const { db, ready } = database();
    await ready;
    await db.execute({ sql: "INSERT INTO room_settings (room, ttl_seconds) VALUES (?, ?) ON CONFLICT(room) DO UPDATE SET ttl_seconds = excluded.ttl_seconds", args: [room, Number(ttlSeconds)] });
    return NextResponse.json({ ttlSeconds: Number(ttlSeconds) });
  } catch (error) {
    console.error("Turso settings error:", error);
    return NextResponse.json({ error: "Impossibile aggiornare le impostazioni." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 }); }
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 });
  const { room, nickname } = payload as Record<string, unknown>;
  if (!validRoom(room) || typeof nickname !== "string" || !nickname.trim() || nickname.length > 24) return NextResponse.json({ error: "Stanza o nickname non validi." }, { status: 400 });
  try {
    const { db, ready } = database();
    await ready;
    await db.execute({ sql: "DELETE FROM attachments WHERE room = ?", args: [room] });
    await db.execute({ sql: "DELETE FROM message_expiry WHERE room = ?", args: [room] });
    const result = await db.execute({ sql: "DELETE FROM messages WHERE room = ?", args: [room] });
    return NextResponse.json({ deleted: result.rowsAffected });
  } catch (error) {
    console.error("Turso clear chat error:", error);
    return NextResponse.json({ error: "Impossibile svuotare la chat." }, { status: 503 });
  }
}
