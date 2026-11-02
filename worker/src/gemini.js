// Gemini API bilan ishlash: savolni tahlil qilish va manbalar asosida javob yozish.

const API = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function call(env, model, system, user, temperature = 0.2, timeoutMs = 35000) {
  let r;
  try {
    r = await fetch(`${env.GEMINI_API_BASE || API}/${model}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature, responseMimeType: "application/json" },
      }),
    });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError")
      throw new GeminiError(408, `${Math.round(timeoutMs / 1000)} soniyada javob kelmadi`);
    throw new GeminiError(503, "Gemini'ga ulanib bo'lmadi: " + e.message);
  }
  if (!r.ok) throw new GeminiError(r.status, (await r.text()).slice(0, 500));
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  try { return JSON.parse(text); } catch { throw new GeminiError(502, "Modeldan noto'g'ri javob: " + text.slice(0, 200)); }
}

// Vaqtinchalik xatolar (band, limit, server xatosi) — boshqa modelga o'tish mumkin
const retryable = (status) => status === 408 || status === 429 || status >= 500;

/** Modellar ro'yxatini navbat bilan sinaydi: asosiy model band bo'lsa — bir marta qayta urinish, keyin zaxira model. */
async function callWithFallback(env, models, system, user, temperature, timeoutMs) {
  const errors = [];
  for (const [i, model] of models.entries()) {
    // Asosiy model tez xato qaytarsa (band/limit) — bir marta qayta urinamiz; vaqt tugasa — darhol keyingi modelga
    for (let attempt = 0; attempt < (i === 0 ? 2 : 1); attempt++) {
      try {
        const out = await call(env, model, system, user, temperature, timeoutMs);
        return { ...out, _model: model, _errors: errors };
      } catch (e) {
        if (!(e instanceof GeminiError)) throw e;
        errors.push(`${model}: ${e.status} ${String(e.message).slice(0, 160)}`);
        if (!retryable(e.status)) throw Object.assign(e, { all: errors });
        if (e.status === 408) break;
        if (attempt === 0 && i === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw Object.assign(new GeminiError(503, errors.join("\n")), { all: errors });
}

const modelList = (...names) => [...new Set(names.flatMap((n) => String(n || "").split(",")).map((s) => s.trim()).filter(Boolean))];

const ANALYZE_SYSTEM = `Сен Ўзбекистон қонунчилиги бўйича қидирув ёрдамчисисан. Фойдаланувчи савол ёки ҳолатни (лотин ёки кирилл ёзувида) ёзади.
Вазифанг — уни қонунчилик базасидан қидириш учун тайёрлаш. Фақат JSON қайтар:
{
 "refs": [{"code": "ЖК", "article": "169"}],
 "code_keywords": ["..."],
 "plenum_keywords": ["..."]
}
Қоидалар:
- refs: савол аниқ тегишли бўлган кодекс моддалари (сен ишонч ҳосил қилган бўлсанг). Қисқартмалар: ЖК, ЖПК, ЖИК, МЖтК, ФК, ФПК, ИПК, МСИЮтК, МК (Меҳнат), ОК (Оила), СК (Солиқ), УЖК, ЕК, БК (Божхона), Конституция. Ишонмасанг — бўш қолдир. Кўпи билан 6 та.
- code_keywords: қонун матнида учрайдиган расмий юридик атамалар, ўзбек КИРИЛЛ ёзувида (масалан "ўғирлик" эмас "ўғрилик", "суд қарори" эмас "ҳукм" ва ҳ.к.). 3–8 та.
- plenum_keywords: Олий суд Пленуми қарорларида учрайдиган атамалар, кирилл ёзувида. 3–8 та.
- Ҳеч қачон изоҳ ёзма, фақат JSON.`;

export function analyze(env, question) {
  return callWithFallback(env, modelList(env.GEMINI_FAST_MODEL, env.GEMINI_FALLBACK_MODELS), ANALYZE_SYSTEM, question, 0, 20000);
}

const ANSWER_SYSTEM = `Сен судья ёрдамчилари ва юристлар учун қонунчилик бўйича ёрдамчисан.
Сенга савол ва рақамланган МАНБАЛАР (кодекс моддалари ва Олий суд Пленуми қарорларининг бандлари, lex.uz'даги амалдаги таҳрирда) берилади.
Қатъий қоидалар:
1. Фақат берилган манбаларга таян. Ўз хотирангдан модда рақами, банд рақами ёки норма матнини ЁЗМА.
2. Ҳар бир фикрдан кейин манба рақамини квадрат қавсда кўрсат: [1], [3].
3. Норма матнини келтирганда сўзма-сўз кўчир, ўзгартирма.
4. Агар манбаларда жавоб бўлмаса ёки етарли бўлмаса — шуни очиқ айт ("Берилган манбаларда бу масала бўйича аниқ норма топилмади") ва нима излаш кераклигини тавсия қил.
5. Жавоб қисқа ва аниқ бўлсин: аввал асосий жавоб (1–3 гап), кейин тегишли нормалар қисқача изоҳ билан.
6. Жавобни савол қайси ёзувда (лотин/кирилл) берилган бўлса, ўша ёзувда ёз.
7. Бу юридик маслаҳат эмас, маълумот — лекин буни ҳар сафар такрорлама.
Жавобни оддий markdown матн сифатида ёз (JSON эмас). Сарлавҳа (#) ишлатма.`;

function sourcesBlock(sources) {
  return sources.map((s, i) => {
    const where = s.kind === "plenum" ? `Пленум: «${s.doc_title}» (${s.requisites}), ${s.heading}` : `${s.doc_title}, ${s.heading}`;
    const text = s.text.length > 5000 ? s.text.slice(0, 5000) + " …" : s.text;
    return `[${i + 1}] ${where}\n${text}`;
  }).join("\n\n---\n\n");
}

/**
 * Bitta model bilan streaming: matn bo'laklarini (delta) qaytaruvchi async generator.
 * firstTokenMs ichida birinchi bo'lak kelmasa — 408 xato (keyingi modelga o'tish uchun).
 */
async function* streamModel(env, model, system, user, temperature, firstTokenMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), firstTokenMs);
  let r;
  try {
    r = await fetch(`${env.GEMINI_API_BASE || API}/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature },
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError" || e.name === "TimeoutError")
      throw new GeminiError(408, `${Math.round(firstTokenMs / 1000)} soniyada javob boshlanmadi`);
    throw new GeminiError(503, "Gemini'ga ulanib bo'lmadi: " + e.message);
  }
  if (!r.ok) { clearTimeout(timer); throw new GeminiError(r.status, (await r.text()).slice(0, 500)); }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", started = false;
  try {
    while (true) {
      let chunk;
      try { chunk = await reader.read(); }
      catch (e) {
        if (!started && (e.name === "AbortError" || e.name === "TimeoutError"))
          throw new GeminiError(408, `${Math.round(firstTokenMs / 1000)} soniyada javob boshlanmadi`);
        throw new GeminiError(started ? 599 : 503, "Oqim uzildi: " + e.message);
      }
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      const events = buf.split(/\r?\n\r?\n/);
      buf = events.pop();
      for (const ev of events) {
        const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (!data) continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw new GeminiError(j.error.code || 500, j.error.message || "Gemini xatosi");
        const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (text) {
          if (!started) { started = true; clearTimeout(timer); }
          yield text;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (!started) throw new GeminiError(502, "Model bo'sh javob qaytardi");
}

/**
 * Manbalar asosida javobni streaming bilan yozadi. onDelta(matn) har bir bo'lakda chaqiriladi.
 * Model birinchi bo'lakni bermasa — zaxira modelga o'tadi. Natija: { model, errors }.
 */
export async function answerStream(env, question, sources, onDelta) {
  const models = modelList(env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODELS, env.GEMINI_FAST_MODEL);
  const user = `САВОЛ:\n${question}\n\nМАНБАЛАР:\n\n${sourcesBlock(sources)}`;
  const errors = [];
  for (const [i, model] of models.entries()) {
    for (let attempt = 0; attempt < (i === 0 ? 2 : 1); attempt++) {
      const gen = streamModel(env, model, ANSWER_SYSTEM, user, 0.2, 20000);
      let first;
      try {
        first = await gen.next(); // birinchi bo'lak kelguncha — xato bo'lsa keyingi modelga o'tamiz
      } catch (e) {
        if (!(e instanceof GeminiError)) throw e;
        errors.push(`${model}: ${e.status} ${String(e.message).slice(0, 160)}`);
        if (!retryable(e.status)) throw Object.assign(e, { all: errors });
        if (e.status === 408) break;
        if (attempt === 0 && i === 0) await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      // Javob boshlandi — shu model bilan oxirigacha davom etamiz
      if (!first.done) await onDelta(first.value);
      for await (const d of gen) await onDelta(d);
      return { model, errors };
    }
  }
  throw Object.assign(new GeminiError(503, errors.join("\n")), { all: errors });
}
