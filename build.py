"""Barcha amaldagi kodekslar va Oliy sud Plenumi qarorlarini lex.uz'dan yuklab, bazani tuzadi.

Natija:
  data/raw/<id>.html      — lex.uz sahifasining nusxasi (kesh)
  data/docs.json          — hujjatlar ro'yxati (id, nom, rekvizit, versiya, bo'laklar soni)
  data/chunks.jsonl       — har bir modda / band alohida qator
Qayta ishga tushirilsa, keshdagi sahifalar qayta yuklanmaydi (--refresh bilan yangilanadi).
"""
import json, os, re, sys, time
import requests
from lexlist import collect
from lexparse import fetch, parse_code, parse_plenum

D = "data"
RAW = os.path.join(D, "raw")
os.makedirs(RAW, exist_ok=True)
REFRESH = "--refresh" in sys.argv

EXTRA_CODES = [  # kodekslar ro'yxatida chiqmaydigan, lekin kerakli hujjatlar
    {"id": 6445145, "title": "Ўзбекистон Республикасининг Конституцияси", "requisites": "30.04.2023", "in_force": True},
]
SKIP_IDS = {4492619}  # Saylov kodeksining qoraqalpoqcha matni (o'zbekchasi bor)
AMEND_RE = re.compile(r"ўзгартириш|қўшимчалар? киритиш|ўз кучини йўқотган деб топиш|ўзгартиш киритиш", re.I)


def doc_lists():
    codes = collect("https://lex.uz/uz/search/all?act_type=21&lang=3")
    codes = [c for c in codes if c["in_force"] and c["id"] not in SKIP_IDS] + EXTRA_CODES
    court = collect("https://lex.uz/uz/search/nat?body_id=2328&lang=3")
    def is_plenum(p):
        r = p["requisites"].lower()
        # lex.uz'da ba'zi Plenum qarorlari rekvizitida "Пленум" so'zi yo'q ("Олий судининг қарори")
        return "пленум" in r or ("олий судининг қарори" in r and "амалиёт" in p["title"].lower())
    plen = [p for p in court if p["in_force"] and is_plenum(p) and not AMEND_RE.search(p["title"])]
    return codes, plen


def get_html(doc_id, s):
    path = os.path.join(RAW, f"{doc_id}.html")
    if os.path.exists(path) and not REFRESH:
        return open(path, encoding="utf-8").read()
    html = fetch(doc_id, s)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    time.sleep(2)  # lex.uz'ni ortiqcha yuklamaslik uchun
    return html


def main():
    codes, plen = doc_lists()
    print(f"Kodekslar: {len(codes)}, Plenum qarorlari: {len(plen)}", flush=True)
    s = requests.Session()
    docs, n = [], 0
    with open(os.path.join(D, "chunks.jsonl"), "w", encoding="utf-8") as out:
        for kind, items in (("kodeks", codes), ("plenum", plen)):
            for i, it in enumerate(items, 1):
                try:
                    html = get_html(it["id"], s)
                    if kind == "kodeks":
                        d = parse_code(it["id"], html, it["title"])
                    else:
                        d = parse_plenum(it["id"], html, it["title"], it["requisites"])
                except Exception as e:
                    print(f"  XATO {it['id']} {it['title'][:60]}: {e}", flush=True)
                    docs.append({**it, "kind": kind, "error": str(e)})
                    continue
                for c in d["chunks"]:
                    out.write(json.dumps(c, ensure_ascii=False) + "\n")
                n += len(d["chunks"])
                docs.append({"id": it["id"], "kind": kind, "title": it["title"], "requisites": it["requisites"],
                             "version": d["version"], "chunks": len(d["chunks"]),
                             "url": f"https://lex.uz/docs/{it['id']}"})
                print(f"[{kind} {i}/{len(items)}] {it['title'][:70]} — {len(d['chunks'])} bo'lak", flush=True)
    with open(os.path.join(D, "docs.json"), "w", encoding="utf-8") as f:
        json.dump({"built": time.strftime("%Y-%m-%d %H:%M"), "docs": docs}, f, ensure_ascii=False, indent=1)
    print(f"TAYYOR: {len(docs)} hujjat, {n} bo'lak", flush=True)


if __name__ == "__main__":
    main()
