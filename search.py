"""Qidiruv qatlami: aniq havola (JK 104) va matn bo'yicha qidiruv (SQLite FTS5).

  python3 search.py build              — data/chunks.jsonl dan data/lex.db yaratadi
  python3 search.py "жк 104"           — aniq modda
  python3 search.py "zararni ixtiyoriy qoplash jazo"   — matn bo'yicha qidiruv
"""
import json, re, sqlite3, sys

DB = "data/lex.db"

# ---------- lotin -> kirill ----------
_LAT = [("o‘", "ў"), ("o'", "ў"), ("oʻ", "ў"), ("o`", "ў"), ("g‘", "ғ"), ("g'", "ғ"), ("gʻ", "ғ"), ("g`", "ғ"),
        ("sh", "ш"), ("ch", "ч"), ("yo", "ё"), ("yu", "ю"), ("ya", "я"), ("ye", "е"), ("ts", "ц"),
        ("a", "а"), ("b", "б"), ("d", "д"), ("e", "е"), ("f", "ф"), ("g", "г"), ("h", "ҳ"), ("i", "и"),
        ("j", "ж"), ("k", "к"), ("l", "л"), ("m", "м"), ("n", "н"), ("o", "о"), ("p", "п"), ("q", "қ"),
        ("r", "р"), ("s", "с"), ("t", "т"), ("u", "у"), ("v", "в"), ("x", "х"), ("y", "й"), ("z", "з"),
        ("c", "с"), ("w", "в"), ("ʼ", "ъ"), ("’", "ъ"), ("'", "ъ"), ("`", "ъ")]


def to_cyr(text):
    t = text.lower()
    if not re.search(r"[a-z]", t):
        return t
    out, i = [], 0
    while i < len(t):
        for lat, cyr in _LAT:
            if t.startswith(lat, i):
                # so'z boshidagi "e" -> "э"
                if lat == "e" and (i == 0 or not t[i - 1].isalpha()):
                    cyr = "э"
                out.append(cyr); i += len(lat); break
        else:
            out.append(t[i]); i += 1
    return "".join(out)


# ---------- kodeks qisqartmalari ----------
CODE_ABBR = {
    "жк": "Жиноят кодекси", "жпк": "Жиноят-процессуал кодекси", "жик": "Жиноят-ижроия кодекси",
    "мжтк": "Маъмурий жавобгарлик тўғрисидаги кодекси", "мжк": "Маъмурий жавобгарлик тўғрисидаги кодекси",
    "фк": "Фуқаролик кодекси", "фпк": "Фуқаролик процессуал кодекси", "ипк": "Иқтисодий процессуал кодекси",
    "мсиютк": "Маъмурий суд ишларини юритиш тўғрисидаги кодекси", "мк": "Меҳнат кодекси",
    "ок": "Оила кодекси", "ск": "Солиқ кодекси", "ужк": "Уй-жой кодекси", "ек": "Ер кодекси",
    "бк": "Божхона кодекси", "конституция": "Конституцияси", "кон": "Конституцияси",
}
SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def build():
    con = sqlite3.connect(DB)
    con.executescript("""
      DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS fts;
      CREATE TABLE chunks(rowid INTEGER PRIMARY KEY, doc_id INT, doc_title TEXT, doc_kind TEXT, number TEXT,
        heading TEXT, path TEXT, text TEXT, changes TEXT, requisites TEXT, url TEXT);
      CREATE VIRTUAL TABLE fts USING fts5(doc_title, heading, path, text, content='chunks', content_rowid='rowid',
        tokenize="unicode61 remove_diacritics 0 tokenchars '-ʼъ'");
    """)
    with open("data/chunks.jsonl", encoding="utf-8") as f:
        rows = [json.loads(l) for l in f]
    con.executemany("INSERT INTO chunks(doc_id,doc_title,doc_kind,number,heading,path,text,changes,requisites,url)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?)",
                    [(r["doc_id"], r["doc_title"], r["doc_kind"], r["number"], r["heading"], r["path"],
                      r["text"], r["changes"], r.get("requisites", ""), r["url"]) for r in rows])
    con.execute("INSERT INTO fts(fts) VALUES('rebuild')")
    con.commit()
    print(len(rows), "ta bo'lak indekslandi")


def _num(n):
    """'18-1' / '18^1' / '18¹' -> '18¹'"""
    m = re.match(r"(\d+)(?:\s*[-^]\s*(\d+)|([⁰¹²³⁴⁵⁶⁷⁸⁹]+))?$", n.strip())
    if not m:
        return n
    return m.group(1) + ((m.group(2) or "").translate(SUP) if m.group(2) else (m.group(3) or ""))


def find_reference(con, query):
    """'жк 104', 'JPK 497-modda', 'ЖК 18-1' kabi so'rovlarga aniq moddani qaytaradi."""
    q = to_cyr(query).replace("ё", "е")
    m = re.search(r"\b([а-яўқғҳ]{1,12})\.?\s*(\d+(?:\s*[-^]\s*\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)\s*(?:[-‑–]?\s*мод+а\S*)?", q)
    if not m:
        m2 = re.search(r"(\d+(?:[-^]\d+)?)\s*[-‑–]?\s*мод+а\S*\s+([а-яўқғҳ]{1,12})\b", q)
        if not m2:
            return []
        abbr, num = m2.group(2), m2.group(1)
    else:
        abbr, num = m.group(1), m.group(2)
    name = CODE_ABBR.get(abbr)
    if not name:
        return []
    num = _num(num.replace(" ", ""))
    return [dict(r) for r in con.execute(
        "SELECT * FROM chunks WHERE doc_kind='kodeks' AND number=? AND doc_title LIKE ?",
        (num, f"%{name}%"))]


STOP = set("ва ёки билан учун бўйича ҳам бу шу у нима қандай қайси керак бўлса агар деб эса лекин"
           " мумкин ни нинг га да дан ку ми".split())


def fts_query(text):
    words = [w for w in re.findall(r"[а-яўқғҳъё]+", to_cyr(text)) if len(w) > 2 and w not in STOP]
    # o'zak: so'z oxiridagi qo'shimchalarni qisqartirib, prefiks qidiruv
    terms = []
    for w in words:
        stem = w if len(w) <= 5 else w[: max(5, len(w) - 3)]
        terms.append(f'"{stem}"*')
    return " OR ".join(terms)


def text_search(con, query, k=20, kind=None):
    q = fts_query(query)
    if not q:
        return []
    sql = ("SELECT c.*, bm25(fts, 2.0, 3.0, 1.0, 1.0) AS score FROM fts JOIN chunks c ON c.rowid=fts.rowid "
           "WHERE fts MATCH ? " + ("AND c.doc_kind=? " if kind else "") + "ORDER BY score LIMIT ?")
    args = (q, kind, k) if kind else (q, k)
    return [dict(r) for r in con.execute(sql, args)]


def connect():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build(); sys.exit()
    con = connect()
    q = " ".join(sys.argv[1:])
    ref = find_reference(con, q)
    res = ref or text_search(con, q, 10)
    print("ANIQ HAVOLA" if ref else f"QIDIRUV: {fts_query(q)}")
    for r in res:
        print("—", r["doc_title"][:50], "|", r["heading"][:80], "|", r["url"])
        print("   ", r["text"][:200].replace("\n", " "))
