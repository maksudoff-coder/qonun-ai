"""Lex.uz hujjat sahifasini yuklab, modda (kodeks) yoki band (Plenum) bo'yicha bo'laklarga ajratadi.

Har bir bo'lak:
  doc_id, doc_title, doc_kind ("kodeks" | "plenum"), number ("104" | "18¹" | "12"),
  heading, path (bo'lim > bob), text, changes (o'zgartirish izohlari), url (lex.uz anchor)
"""
import re
import requests
from bs4 import BeautifulSoup

UA = {"User-Agent": "Mozilla/5.0 (lexbaza; shaxsiy yuridik qidiruv tizimi)"}
SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")

ART_RE = re.compile(r"^(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]*)\s*[-‑–]\s*модда\.?\s*(.*)$", re.S)
BAND_RE = re.compile(r"^(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]*)\.\s+(.*)$", re.S)


def fetch(doc_id, session=None, tries=4):
    import time
    s = session or requests
    for i in range(tries):
        try:
            r = s.get(f"https://lex.uz/docs/{doc_id}", headers=UA, timeout=180)
            r.raise_for_status()
            return r.text
        except requests.RequestException:
            if i == tries - 1:
                raise
            time.sleep(5 * (i + 1))


def _clean(t):
    return re.sub(r"[ \t ]+", " ", t).strip()


def _blocks(html):
    """Hujjat matnidagi elementlarni ketma-ket (class, anchor_id, matn) ko'rinishida qaytaradi."""
    soup = BeautifulSoup(html, "html.parser")
    for sup in soup.find_all("sup"):  # 18<sup>1</sup> -> 18¹
        sup.replace_with(sup.get_text().strip().translate(SUP))
    for junk in soup.select(".lx_elem2, .COMMENT, .COMMENTLEXUZ, .INDEXES_ON_REF"):
        junk.decompose()
    meta = {}
    title = soup.select_one("div.ACT_TITLE")
    meta["title"] = _clean(title.get_text(" ")) if title else ""
    ver = soup.select_one(".lx_date_selected")
    meta["version"] = _clean(ver.get_text()) if ver else ""
    out = []
    for dv in soup.select("div.ACT_TEXT, div.CLAUSE_DEFAULT, div.TEXT_HEADER_DEFAULT, "
                          "div.CHANGES_ORIGINS, div.TABLE_STD, div.ACT_ESSENTIAL_ELEMENTS, div.SIGNATURE"):
        cls = dv["class"][0]
        inner = dv.find("div", id=True, recursive=False) or dv.find("div", attrs={"name": True})
        if cls == "TABLE_STD":
            rows = ["  |  ".join(_clean(c.get_text(" ")) for c in tr.find_all(["td", "th"]))
                    for tr in dv.find_all("tr")]
            text, anchor = "\n".join(r for r in rows if r.strip()), None
        else:
            node = inner or dv
            text = _clean(node.get_text(" "))
            text = re.sub(r"(\d) ([⁰¹²³⁴⁵⁶⁷⁸⁹]+)\s?", r"\1\2", text)
            anchor = inner.get("id") if inner else None
        if text:
            out.append((cls, anchor, text))
    return meta, out


def parse_code(doc_id, html, doc_title=None):
    meta, blocks = _blocks(html)
    title = doc_title or meta["title"]
    chunks, path, cur = [], [], None

    def flush():
        if cur and (cur["text"] or cur["heading"]):
            cur["text"] = "\n".join(cur["text"])
            cur["changes"] = "\n".join(cur["changes"])
            chunks.append(cur)

    for cls, anchor, text in blocks:
        if cls == "TEXT_HEADER_DEFAULT":
            flush(); cur = None
            low = text.lower()
            if re.search(r"\bқисм\b", low) and "боб" not in low:
                path = [text]
            elif "бўлим" in low:
                path = path[:1] + [text] if path and "қисм" in path[0].lower() else [text]
            else:  # bob
                path = [p for p in path if "боб" not in p.lower()] + [text]
            continue
        if cls == "CLAUSE_DEFAULT":
            m = ART_RE.match(text)
            flush()
            num = (m.group(1) + m.group(2)) if m else text.split()[0]
            cur = {"doc_id": doc_id, "doc_title": title, "doc_kind": "kodeks", "number": num,
                   "heading": text, "path": " > ".join(path), "text": [], "changes": [],
                   "url": f"https://lex.uz/docs/{doc_id}#{anchor}" if anchor else f"https://lex.uz/docs/{doc_id}"}
            continue
        if cur is None:
            continue  # kodeks muqaddimasi / sarlavhalar
        if cls == "CHANGES_ORIGINS":
            cur["changes"].append(text)
        else:
            cur["text"].append(text)
    flush()
    return {"doc_id": doc_id, "title": title, "kind": "kodeks", "version": meta["version"], "chunks": chunks}


def parse_plenum(doc_id, html, doc_title=None, requisites=""):
    meta, blocks = _blocks(html)
    title = doc_title or meta["title"]
    chunks, cur, preamble, section = [], None, [], ""

    def new(num, anchor, first):
        return {"doc_id": doc_id, "doc_title": title, "doc_kind": "plenum", "number": num,
                "heading": f"{num}-банд", "path": section, "text": [first], "changes": [],
                "requisites": requisites,
                "url": f"https://lex.uz/docs/{doc_id}#{anchor}" if anchor else f"https://lex.uz/docs/{doc_id}"}

    def flush():
        if cur:
            cur["text"] = "\n".join(cur["text"])
            cur["changes"] = "\n".join(cur["changes"])
            chunks.append(cur)

    for cls, anchor, text in blocks:
        if cls in ("SIGNATURE", "ACT_ESSENTIAL_ELEMENTS"):
            continue
        if cls in ("TEXT_HEADER_DEFAULT", "CLAUSE_DEFAULT"):
            section = text
            continue
        m = BAND_RE.match(text) if cls == "ACT_TEXT" else None
        if m:
            flush()
            num = m.group(1) + m.group(2)
            cur = new(num, anchor, text)
        elif cur is None:
            if cls == "ACT_TEXT":
                preamble.append(text)
        elif cls == "CHANGES_ORIGINS":
            cur["changes"].append(text)
        else:
            cur["text"].append(text)
    flush()
    if preamble:
        chunks.insert(0, {"doc_id": doc_id, "doc_title": title, "doc_kind": "plenum", "number": "0",
                          "heading": "Муқаддима", "path": "", "text": "\n".join(preamble), "changes": "",
                          "requisites": requisites, "url": f"https://lex.uz/docs/{doc_id}"})
    return {"doc_id": doc_id, "title": title, "kind": "plenum", "requisites": requisites,
            "version": meta["version"], "chunks": chunks}
