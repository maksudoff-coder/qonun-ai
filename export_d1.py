"""data/chunks.jsonl + data/docs.json -> Cloudflare D1 uchun SQL fayllar (d1/ papkasida).

  d1/schema.sql   — jadvallar (bir marta)
  d1/data.sql     — hujjatlar va moddalar (har yangilanishda qayta yuklanadi)
"""
import json, os

OUT = "d1"
os.makedirs(OUT, exist_ok=True)
MAX = 60_000  # D1'da bitta SQL buyruq 100 KB dan oshmasligi kerak


def q(s):
    return "'" + (s or "").replace("'", "''") + "'"


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT, pass_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER);
CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY, user_id INTEGER, question TEXT, mode TEXT,
  sources TEXT, ok INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
"""

DATA_HEAD = """
DROP TABLE IF EXISTS fts;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS docs;
CREATE TABLE docs(id INTEGER PRIMARY KEY, kind TEXT, title TEXT, requisites TEXT, version TEXT, url TEXT);
CREATE TABLE chunks(id INTEGER PRIMARY KEY, doc_id INTEGER, kind TEXT, number TEXT, heading TEXT, path TEXT,
  text TEXT, changes TEXT, url TEXT);
CREATE INDEX idx_chunks_ref ON chunks(doc_id, number);
CREATE VIRTUAL TABLE fts USING fts5(title, heading, path, text, tokenize="unicode61 remove_diacritics 0");
"""


def split(text, n):
    parts, cur = [], ""
    for line in text.split("\n"):
        if len((cur + line).encode()) > n and cur:
            parts.append(cur); cur = ""
        cur += line + "\n"
    parts.append(cur)
    return [p.strip() for p in parts]


def main():
    docs = json.load(open("data/docs.json", encoding="utf-8"))
    rows = [json.loads(l) for l in open("data/chunks.jsonl", encoding="utf-8")]
    titles = {d["id"]: d["title"] for d in docs["docs"]}
    with open(f"{OUT}/schema.sql", "w", encoding="utf-8") as f:
        f.write(SCHEMA)
    with open(f"{OUT}/data.sql", "w", encoding="utf-8") as f:
        f.write(DATA_HEAD)
        for d in docs["docs"]:
            if d.get("error"):
                continue
            f.write(f"INSERT INTO docs VALUES({d['id']},{q(d['kind'])},{q(d['title'])},{q(d['requisites'])},"
                    f"{q(d['version'])},{q(d['url'])});\n")
        cid = 0
        for r in rows:
            parts = split(r["text"], MAX) if len(r["text"].encode()) > MAX else [r["text"]]
            for i, part in enumerate(parts):
                cid += 1
                head = r["heading"] + (f" ({i + 1}-қисм)" if len(parts) > 1 else "")
                ch = r["changes"][:MAX // 3]
                f.write(f"INSERT INTO chunks VALUES({cid},{r['doc_id']},{q(r['doc_kind'])},{q(r['number'])},"
                        f"{q(head)},{q(r['path'])},{q(part)},{q(ch)},{q(r['url'])});\n")
                f.write(f"INSERT INTO fts(rowid,title,heading,path,text) VALUES({cid},{q(titles.get(r['doc_id'], r['doc_title']))},"
                        f"{q(head)},{q(r['path'])},{q(part)});\n")
        f.write(f"INSERT OR REPLACE INTO meta VALUES('built',{q(docs['built'])});\n")
    print(cid, "ta bo'lak;", os.path.getsize(f"{OUT}/data.sql") // 1_000_000, "MB")


if __name__ == "__main__":
    main()
