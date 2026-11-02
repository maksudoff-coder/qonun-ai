import { parseRefs, isPureRef, lookupRef, textSearch, toCyr } from "./lex.js";
import { analyze, answer, GeminiError } from "./gemini.js";
import { hashPassword, verifyPassword, createSession, clearCookie, currentUser } from "./auth.js";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const err = (msg, status = 400) => json({ error: msg }, status);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (!p.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, p);
    } catch (e) {
      console.error(e);
      return err("Serverda xatolik: " + (e.message || e), 500);
    }
  },
};

async function route(request, env, p) {
  const db = env.DB;
  const method = request.method;
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};

  // --- ochiq yo'llar ---
  if (p === "/api/setup" && method === "GET") {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM users").first("n");
    return json({ needed: n === 0 });
  }
  if (p === "/api/setup" && method === "POST") {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM users").first("n");
    if (n > 0) return err("Admin allaqachon yaratilgan", 403);
    if (!env.ADMIN_SETUP_CODE || body.code !== env.ADMIN_SETUP_CODE) return err("Sozlash kodi noto'g'ri", 403);
    if (!body.login || !body.password || body.password.length < 8) return err("Login va kamida 8 belgili parol kiriting");
    await db.prepare("INSERT INTO users(login,name,pass_hash,is_admin) VALUES(?,?,?,1)")
      .bind(body.login.trim().toLowerCase(), body.name || body.login, await hashPassword(body.password)).run();
    return json({ ok: true });
  }
  if (p === "/api/login" && method === "POST") {
    const u = await db.prepare("SELECT * FROM users WHERE login=? AND active=1")
      .bind((body.login || "").trim().toLowerCase()).first();
    if (!u || !(await verifyPassword(body.password || "", u.pass_hash))) return err("Login yoki parol noto'g'ri", 401);
    const cookie = await createSession(db, u.id);
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  // --- kirish talab qilinadi ---
  const user = await currentUser(request, db);
  if (!user) return err("Tizimga kiring", 401);

  if (p === "/api/logout") {
    await db.prepare("DELETE FROM sessions WHERE token=?").bind(user.token).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }
  if (p === "/api/me") {
    const info = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM docs WHERE kind='kodeks') AS codes, (SELECT COUNT(*) FROM docs WHERE kind='plenum') AS plenums,
       (SELECT COUNT(*) FROM chunks) AS chunks, (SELECT value FROM meta WHERE key='built') AS built`).first();
    const today = await db.prepare(
      "SELECT COUNT(*) AS n FROM log WHERE user_id=? AND mode='ai' AND created >= date('now')").bind(user.id).first("n");
    return json({ login: user.login, name: user.name, is_admin: !!user.is_admin, base: info,
      today_ai: today, daily_limit: +(env.DAILY_LIMIT || 150) });
  }
  if (p === "/api/ask" && method === "POST") return ask(env, user, (body.q || "").trim());

  // --- admin ---
  if (p.startsWith("/api/admin/")) {
    if (!user.is_admin) return err("Ruxsat yo'q", 403);
    if (p === "/api/admin/users" && method === "GET") {
      const { results } = await db.prepare(
        `SELECT u.id, u.login, u.name, u.is_admin, u.active, u.created,
         (SELECT COUNT(*) FROM log l WHERE l.user_id=u.id) AS questions FROM users u ORDER BY u.id`).all();
      return json(results);
    }
    if (p === "/api/admin/users" && method === "POST") {
      if (!body.login || !body.password || body.password.length < 8) return err("Login va kamida 8 belgili parol kiriting");
      try {
        await db.prepare("INSERT INTO users(login,name,pass_hash,is_admin) VALUES(?,?,?,?)")
          .bind(body.login.trim().toLowerCase(), body.name || body.login, await hashPassword(body.password), body.is_admin ? 1 : 0).run();
      } catch { return err("Bunday login mavjud"); }
      return json({ ok: true });
    }
    const m = p.match(/^\/api\/admin\/users\/(\d+)$/);
    if (m && method === "POST") {
      const id = +m[1];
      if (body.password) {
        if (body.password.length < 8) return err("Parol kamida 8 belgi");
        await db.prepare("UPDATE users SET pass_hash=? WHERE id=?").bind(await hashPassword(body.password), id).run();
        await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
      }
      if (typeof body.active === "boolean") {
        if (id === user.id) return err("O'zingizni o'chira olmaysiz");
        await db.prepare("UPDATE users SET active=? WHERE id=?").bind(body.active ? 1 : 0, id).run();
        if (!body.active) await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
      }
      return json({ ok: true });
    }
  }
  return err("Topilmadi", 404);
}

// ---------------- savolga javob ----------------

function pub(s) {
  return {
    id: s.id, kind: s.kind, doc_title: s.doc_title, requisites: s.requisites, version: s.version,
    number: s.number, heading: s.heading, path: s.path, text: s.text, changes: s.changes, url: s.url,
  };
}

async function log(db, user, q, mode, sources, ok) {
  await db.prepare("INSERT INTO log(user_id,question,mode,sources,ok) VALUES(?,?,?,?,?)")
    .bind(user.id, q.slice(0, 2000), mode, sources.map((s) => s.id).join(","), ok ? 1 : 0).run();
}

async function ask(env, user, q) {
  const db = env.DB;
  if (!q) return err("Savol bo'sh");
  if (q.length > 3000) return err("Savol juda uzun (3000 belgigacha)");

  // 1) Aniq havola: AI ishlatilmaydi
  const refs = parseRefs(q);
  if (refs.length && isPureRef(q)) {
    const found = [];
    for (const r of refs.slice(0, 10)) found.push(...(await lookupRef(db, r)));
    await log(db, user, q, "ref", found, found.length > 0);
    if (!found.length) return json({ mode: "ref", answer: "Bunday modda bazada topilmadi. Kodeks qisqartmasi va modda raqamini tekshiring.", sources: [] });
    return json({ mode: "ref", sources: found.map(pub) });
  }

  // 2) Kunlik limit
  const used = await db.prepare(
    "SELECT COUNT(*) AS n FROM log WHERE user_id=? AND mode='ai' AND created >= date('now')").bind(user.id).first("n");
  if (used >= +(env.DAILY_LIMIT || 150)) return err("Bugungi AI so'rovlar limiti tugadi. Ertaga davom eting yoki aniq modda bo'yicha qidiring (masalan: JK 104).", 429);

  // 3) Savolni tahlil qilish (tez model). Xato bo'lsa — oddiy so'z qidiruviga o'tamiz.
  let plan = { refs: [], code_keywords: [q], plenum_keywords: [q] };
  let aiAvailable = true;
  try {
    const a = await analyze(env, q);
    plan = {
      refs: Array.isArray(a.refs) ? a.refs.slice(0, 6) : [],
      code_keywords: [...(a.code_keywords || []), q],
      plenum_keywords: [...(a.plenum_keywords || []), q],
    };
  } catch (e) {
    if (e instanceof GeminiError && e.status === 429) aiAvailable = false;
  }

  // 4) Manbalarni yig'ish
  const seen = new Set(), sources = [];
  const add = (rows, max) => {
    let n = 0;
    for (const r of rows) {
      if (seen.has(r.id) || n >= max) continue;
      seen.add(r.id); sources.push(r); n++;
    }
  };
  for (const r of refs) add(await lookupRef(db, r), 3);
  for (const r of plan.refs) {
    const abbr = toCyr(String(r.code || "")).replace(/\s/g, "");
    if (r.article) add(await lookupRef(db, { abbr, num: String(r.article).replace(/[^\d⁰¹²³⁴⁵⁶⁷⁸⁹^-]/g, "") }), 2);
  }
  add(await textSearch(db, plan.plenum_keywords, "plenum", 6), 6);
  add(await textSearch(db, plan.code_keywords, "kodeks", 6), 6);
  const top = sources.slice(0, 16);

  if (!top.length) {
    await log(db, user, q, "ai", [], false);
    return json({ mode: "ai", answer: "Bazadan mos norma topilmadi. Savolni boshqacha yoki yuridik atamalar bilan yozib ko'ring.", sources: [] });
  }

  // 5) Javob yozish
  if (aiAvailable) {
    try {
      const a = await answer(env, q, top);
      const usedIdx = [...new Set((a.used || []).map(Number))].filter((i) => i >= 1 && i <= top.length);
      const text = String(a.answer || "");
      // Javobdagi [n] havolalarini ham hisobga olamiz
      for (const m of text.matchAll(/\[(\d+)\]/g)) if (+m[1] >= 1 && +m[1] <= top.length && !usedIdx.includes(+m[1])) usedIdx.push(+m[1]);
      const warn = checkArticles(text, top);
      await log(db, user, q, "ai", top, true);
      return json({
        mode: "ai", answer: text, warning: warn,
        sources: top.map((s, i) => ({ ...pub(s), n: i + 1, used: usedIdx.includes(i + 1) })),
      });
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      aiAvailable = false;
    }
  }
  await log(db, user, q, "search", top, true);
  return json({
    mode: "search",
    answer: "AI hozir javob bera olmadi (limit yoki ulanish muammosi). Quyida bazadan topilgan eng mos normalar.",
    sources: top.map((s, i) => ({ ...pub(s), n: i + 1, used: true })),
  });
}

/** Javobda manbalarda yo'q modda raqami tilga olinganmi — tekshiradi */
function checkArticles(text, sources) {
  // Manbalarning o'zida (sarlavha yoki matnda) uchragan modda raqamlari "tasdiqlangan" hisoblanadi
  const have = new Set(sources.filter((s) => s.kind === "kodeks").map((s) => s.number));
  for (const s of sources)
    for (const m of s.text.matchAll(/(\d+[⁰¹²³⁴⁵⁶⁷⁸⁹]*)\s*[-‑–]?\s*модда/g)) have.add(m[1]);
  const cyr = toCyr(text);
  const missing = new Set();
  for (const m of cyr.matchAll(/(\d+[⁰¹²³⁴⁵⁶⁷⁸⁹]*)\s*[-‑–]\s*модда/g)) if (!have.has(m[1])) missing.add(m[1]);
  return missing.size
    ? `Javobda manbalar ro'yxatida yo'q modda(lar) tilga olingan: ${[...missing].join(", ")}. Ularni lex.uz'da alohida tekshiring.`
    : null;
}
