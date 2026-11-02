// Foydalanuvchilar va sessiyalar (D1). Parollar PBKDF2-SHA256 bilan saqlanadi.

const ITER = 100000; // Workers'da PBKDF2 uchun maksimal qiymat
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await derive(password, salt))}`;
}

export async function verifyPassword(password, stored) {
  const [, , salt, hash] = stored.split("$");
  const got = b64(await derive(password, unb64(salt)));
  if (got.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

const COOKIE = "qsid";
const DAYS = 30;

export async function createSession(db, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, "");
  await db.prepare("INSERT INTO sessions VALUES(?,?,?)").bind(token, userId, Date.now() + DAYS * 864e5).run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function currentUser(request, db) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`${COOKIE}=([A-Za-z0-9]+)`));
  if (!m) return null;
  const u = await db.prepare(
    `SELECT u.id, u.login, u.name, u.is_admin, s.token FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token=? AND s.expires>? AND u.active=1`).bind(m[1], Date.now()).first();
  return u || null;
}
