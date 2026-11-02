// Gemini API bilan ishlash: savolni tahlil qilish va manbalar asosida javob yozish.

const API = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function call(env, model, system, user, temperature = 0.2) {
  let r;
  try {
    r = await fetch(`${env.GEMINI_API_BASE || API}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature, responseMimeType: "application/json" },
      }),
    });
  } catch (e) {
    throw new GeminiError(503, "Gemini'ga ulanib bo'lmadi: " + e.message);
  }
  if (!r.ok) throw new GeminiError(r.status, (await r.text()).slice(0, 500));
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  try { return JSON.parse(text); } catch { throw new GeminiError(502, "Modeldan noto'g'ri javob: " + text.slice(0, 200)); }
}

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
  return call(env, env.GEMINI_FAST_MODEL, ANALYZE_SYSTEM, question, 0);
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
Фақат JSON қайтар: {"answer": "markdown матн", "used": [манба рақамлари]}`;

export function answer(env, question, sources) {
  const block = sources.map((s, i) => {
    const where = s.kind === "plenum" ? `Пленум: «${s.doc_title}» (${s.requisites}), ${s.heading}` : `${s.doc_title}, ${s.heading}`;
    const text = s.text.length > 5000 ? s.text.slice(0, 5000) + " …" : s.text;
    return `[${i + 1}] ${where}\n${text}`;
  }).join("\n\n---\n\n");
  return call(env, env.GEMINI_MODEL, ANSWER_SYSTEM, `САВОЛ:\n${question}\n\nМАНБАЛАР:\n\n${block}`, 0.2);
}
