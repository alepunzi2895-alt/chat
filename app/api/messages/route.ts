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
    const lastSeen = new Date().toISOString();
    await db.execute({
      sql: "INSERT INTO participants (room, session_id, nickname, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(room, session_id) DO UPDATE SET nickname = excluded.nickname, last_seen = excluded.last_seen",
      args: [room, session, nickname, lastSeen],
    });
    await db.execute({ sql: "DELETE FROM participants WHERE room = ? AND last_seen < ?", args: [room, new Date(Date.now() - 60_000).toISOString()] });
    const result = await db.execute({ sql: "SELECT id, nickname, body, created_at FROM messages WHERE room = ? ORDER BY created_at ASC LIMIT 200", args: [room] });
    const messages = result.rows.map((row) => ({ id: String(row.id), nickname: String(row.nickname), body: String(row.body), createdAt: String(row.created_at) }));
    const people = await db.execute({ sql: "SELECT COUNT(*) AS count FROM participants WHERE room = ? AND last_seen >= ?", args: [room, new Date(Date.now() - 45_000).toISOString()] });
    return NextResponse.json({ messages, onlineCount: Number(people.rows[0]?.count ?? 1) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Turso read error:", error);
    return NextResponse.json({ error: "Impossibile caricare i messaggi." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 }); }
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 });
  const { room, nickname, body } = payload as Record<string, unknown>;
  if (!validRoom(room) || typeof nickname !== "string" || !nickname.trim() || nickname.length > 24 || typeof body !== "string" || !body.trim() || body.length > 2000) {
    return NextResponse.json({ error: "Nickname o messaggio non valido." }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    const { db, ready } = database();
    await ready;
    await db.execute({ sql: "INSERT INTO messages (id, room, nickname, body, created_at) VALUES (?, ?, ?, ?, ?)", args: [id, room, nickname.trim(), body.trim(), createdAt] });
    return NextResponse.json({ message: { id, nickname: nickname.trim(), body: body.trim(), createdAt } }, { status: 201 });
  } catch (error) {
    console.error("Turso write error:", error);
    return NextResponse.json({ error: "Impossibile salvare il messaggio." }, { status: 503 });
  }
}
