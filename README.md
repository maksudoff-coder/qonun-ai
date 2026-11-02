# Қонун ёрдамчиси — qonun.maksudoff.uz

Kodekslar va Oliy sud Plenumi qarorlari bo'yicha AI chat. Lex.uz'dagi amaldagi tahrir, har bir javobda modda/band va lex.uz havolasi.
Texnologiya: Cloudflare Worker + D1 + Gemini API. Hammasi GitHub Actions orqali avtomatik joylanadi va yangilanadi.

```
build.py, lexlist.py, lexparse.py  — lex.uz'dan bazani yig'ish (Python)
export_d1.py                       — bazani D1 uchun SQL'ga aylantirish
d1/schema.sql                      — foydalanuvchilar jadvallari
worker/                            — sayt: Worker (src/) va chat sahifasi (public/)
.github/workflows/deploy.yml       — main'ga push → saytni joylash
.github/workflows/update-db.yml    — har dushanba tunda bazani lex.uz'dan yangilash
```

## Bir martalik sozlash (GitHub → Settings → Secrets and variables → Actions)

| Secret | Qayerdan olinadi |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" shabloni. Qo'shimcha ruxsatlar: **Account · D1 · Edit**, **Zone · DNS · Edit** (zona: maksudoff.uz) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages sahifasining o'ng tomonida "Account ID" |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key |
| `ADMIN_SETUP_CODE` | O'zingiz o'ylab topgan kod (12+ belgi). Faqat birinchi admin yaratishda kerak |

Secret'lar qo'shilgach: **Actions → "Saytni joylash" → Run workflow**. U tugagach "Bazani lex.uz'dan yangilash" avtomatik ishga tushadi (~10–15 daqiqa).

Keyin **qonun.maksudoff.uz** → "Birinchi sozlash" → sozlash kodi, ism, login, parol → kirasiz → **Foydalanuvchilar** bo'limida hamkasblarga login yaratasiz.

## Kundalik ish

- **Kod o'zgarsa** (`worker/` papkasi) — main'ga push qilinsa sayt o'zi yangilanadi.
- **Baza** — har dushanba tunda o'zi yangilanadi. Muhim qonun o'zgarganda darhol yangilash: Actions → "Bazani lex.uz'dan yangilash" → Run workflow.
- Yangilashda 20 tadan kam kodeks yoki 100 tadan kam Plenum qarori yuklansa (masalan lex.uz ishlamay qolsa), eski baza saqlanib qoladi.

## Sozlamalar (`worker/wrangler.toml`)

- `GEMINI_MODEL` — javob yozuvchi model (`gemini-3.8-flash`)
- `GEMINI_FAST_MODEL` — savolni tahlil qiluvchi tez model (`gemini-3.5-flash-lite`)
- `DAILY_LIMIT` — bir foydalanuvchiga kunlik AI so'rovlar (aniq modda so'rovlari hisoblanmaydi)

## Qanday ishlaydi

1. **"JK 104", "jpk 497-modda", "ЖК 18-1"** — AI ishlatilmaydi, modda bazadan to'g'ridan-to'g'ri chiqadi.
2. **Holat bo'yicha savol** — tez model savolni yuridik atamalarga (kirillda) aylantiradi → bazadan mos modda va Plenum bandlari qidiriladi → asosiy model **faqat topilgan matnlar asosida** javob yozadi, har fikrga [1], [2] manba qo'yadi.
3. Javobda manbalarda yo'q modda raqami tilga olinsa — sariq ogohlantirish chiqadi.
4. Gemini limiti tugasa yoki ishlamasa — AI javobisiz, topilgan normalar ro'yxati qaytariladi.

## Kompyuterda sinash (ixtiyoriy)

```
python build.py && python export_d1.py
cd worker && npm install
npx wrangler d1 execute qonun-baza --local --file=../d1/schema.sql
npx wrangler d1 execute qonun-baza --local --file=../d1/data.sql
# .dev.vars fayliga: GEMINI_API_KEY=... va ADMIN_SETUP_CODE=...
npx wrangler dev
```
