// Qidiruv qatlami: lotin->kirill, aniq havola (ЖК 104), FTS5 qidiruv.

const LAT = [
  ["o‘", "ў"], ["o'", "ў"], ["oʻ", "ў"], ["o`", "ў"], ["g‘", "ғ"], ["g'", "ғ"], ["gʻ", "ғ"], ["g`", "ғ"],
  ["sh", "ш"], ["ch", "ч"], ["yo", "ё"], ["yu", "ю"], ["ya", "я"], ["ye", "е"], ["ts", "ц"],
  ["a", "а"], ["b", "б"], ["d", "д"], ["e", "е"], ["f", "ф"], ["g", "г"], ["h", "ҳ"], ["i", "и"],
  ["j", "ж"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["q", "қ"],
  ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["v", "в"], ["x", "х"], ["y", "й"], ["z", "з"],
  ["c", "с"], ["w", "в"], ["ʼ", "ъ"], ["’", "ъ"], ["'", "ъ"], ["`", "ъ"],
];

export function toCyr(text) {
  const t = text.toLowerCase();
  if (!/[a-z]/.test(t)) return t;
  let out = "", i = 0;
  while (i < t.length) {
    let hit = false;
    for (const [lat, cyr] of LAT) {
      if (t.startsWith(lat, i)) {
        out += lat === "e" && (i === 0 || !/\p{L}/u.test(t[i - 1])) ? "э" : cyr;
        i += lat.length; hit = true; break;
      }
    }
    if (!hit) { out += t[i]; i++; }
  }
  return out;
}

export const CODE_ABBR = {
  "жк": "Жиноят кодекси", "жпк": "Жиноят-процессуал кодекси", "жик": "Жиноят-ижроия кодекси",
  "мжтк": "Маъмурий жавобгарлик тўғрисидаги кодекси", "мжк": "Маъмурий жавобгарлик тўғрисидаги кодекси",
  "фк": "Фуқаролик кодекси", "фпк": "Фуқаролик процессуал кодекси", "ипк": "Иқтисодий процессуал кодекси",
  "мсиютк": "Маъмурий суд ишларини юритиш тўғрисидаги кодекси", "мк": "Меҳнат кодекси",
  "ок": "Оила кодекси", "ск": "Солиқ кодекси", "ужк": "Уй-жой кодекси", "ек": "Ер кодекси",
  "бк": "Божхона кодекси", "конституция": "Конституцияси", "кон": "Конституцияси",
};
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

export function normNum(n) {
  const m = n.replace(/\s/g, "").match(/^(\d+)(?:[-^](\d+)|([⁰¹²³⁴⁵⁶⁷⁸⁹]+))?$/);
  if (!m) return n;
  return m[1] + (m[2] ? [...m[2]].map((d) => SUP[d]).join("") : m[3] || "");
}

/** "жк 104", "JPK 497-modda", "ЖК 18-1", "104-модда ЖК" -> [{abbr, num}] (bir nechta bo'lishi mumkin) */
export function parseRefs(query) {
  const q = toCyr(query).replace(/ё/g, "е");
  const refs = [];
  const re1 = /(?:^|[^а-яўқғҳ])([а-яўқғҳ]{1,12})\.?\s*(\d+(?:\s*[-^]\s*\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)(?:\s*[-‑–]?\s*мод+а\S*)?/g;
  for (const m of q.matchAll(re1)) if (CODE_ABBR[m[1]]) refs.push({ abbr: m[1], num: normNum(m[2]) });
  const re2 = /(\d+(?:[-^]\d+)?)\s*[-‑–]?\s*мод+а\S*\s+([а-яўқғҳ]{1,12})(?![а-яўқғҳ])/g;
  for (const m of q.matchAll(re2)) if (CODE_ABBR[m[2]]) refs.push({ abbr: m[2], num: normNum(m[1]) });
  return refs;
}

/** So'rov faqat havoladan iboratmi? ("жк 104" — ha; "жк 104 бўйича жазо қанча" — yo'q) */
export function isPureRef(query) {
  const rest = toCyr(query)
    .replace(/[а-яўқғҳ]{1,12}\.?\s*\d+(?:\s*[-^]\s*\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?(?:\s*[-‑–]?\s*мод+а\S*)?/g, "")
    .replace(/[\s,;.]+|ва/g, "");
  return rest.length === 0;
}

// Kodekslar ro'yxati (21 ta) — Worker ishlab turgan vaqtda xotirada saqlanadi.
// D1'da LIKE qolipi 50 baytdan oshmasligi kerak, kirill nomlar esa uzun — shuning uchun nom JS'da solishtiriladi.
let codesCache = null, codesAt = 0;
async function codeIds(db, name) {
  if (!codesCache || Date.now() - codesAt > 10 * 60 * 1000) {
    const { results } = await db.prepare("SELECT id, title FROM docs WHERE kind='kodeks'").all();
    codesCache = results; codesAt = Date.now();
  }
  const n = name.toLowerCase();
  return codesCache.filter((d) => d.title.toLowerCase().includes(n)).map((d) => d.id);
}

export async function lookupRef(db, { abbr, num }) {
  const name = CODE_ABBR[abbr] || abbr;
  if (!name || !num) return [];
  const ids = await codeIds(db, name);
  if (!ids.length) return [];
  const { results } = await db
    .prepare(`SELECT c.*, d.title AS doc_title, d.requisites, d.version FROM chunks c JOIN docs d ON d.id=c.doc_id
              WHERE c.doc_id IN (${ids.map(() => "?").join(",")}) AND c.number=? ORDER BY c.id`)
    .bind(...ids, num).all();
  return results;
}

const STOP = new Set(("ва ёки билан учун бўйича ҳам бу шу у нима қандай қайси керак бўлса агар деб эса лекин " +
  "мумкин ни нинг га да дан ку ми қилиш бўлган этган").split(" "));

export function ftsQuery(words) {
  const terms = [];
  for (const raw of words) {
    for (const w of toCyr(raw).match(/[а-яўқғҳъё]+/g) || []) {
      if (w.length < 3 || STOP.has(w)) continue;
      const stem = w.length <= 5 ? w : w.slice(0, Math.max(5, w.length - 3));
      terms.push(`"${stem}"*`);
    }
  }
  return [...new Set(terms)].join(" OR ");
}

export async function textSearch(db, words, kind, k) {
  const q = ftsQuery(words);
  if (!q) return [];
  const { results } = await db
    .prepare(`SELECT c.*, d.title AS doc_title, d.requisites, d.version, bm25(fts, 2.0, 3.0, 1.0, 1.0) AS score
              FROM fts JOIN chunks c ON c.id=fts.rowid JOIN docs d ON d.id=c.doc_id
              WHERE fts MATCH ? AND c.kind=? ORDER BY score LIMIT ?`)
    .bind(q, kind, k).all();
  return results;
}
