"""Lex.uz qidiruv natijalarini (barcha sahifalarini) yig'ib, hujjatlar ro'yxatini qaytaradi.

Foydalanish:
    python3 lexlist.py "<qidiruv URL>" chiqish.json
"""
import json, re, sys, time
import requests
from bs4 import BeautifulSoup

BASE = "https://lex.uz"
UA = {"User-Agent": "Mozilla/5.0 (lexbaza; shaxsiy yuridik qidiruv tizimi)"}


def parse_items(soup):
    out = []
    for tr in soup.select("tr.dd-table__main-item"):
        a = tr.select_one("a.lx_link")
        if not a:
            continue
        badge = tr.select_one(".badge-nine")
        state = tr.select_one(".lx_act_state i")
        out.append({
            "url": a["href"],
            "id": int(re.search(r"/docs/(-?\d+)", a["href"]).group(1)),
            "title": " ".join(a.get_text().split()),
            "requisites": " ".join(badge.get_text().split()) if badge else "",
            "in_force": bool(state and "status_code_y" in state.get("class", [])),
        })
    return out


def form_fields(soup):
    return {i["name"]: i.get("value", "") for i in soup.select("input[type=hidden][name]")}


def collect(url, delay=1.0, max_pages=500):
    s = requests.Session()
    s.headers.update(UA)
    r = s.get(url, timeout=60)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    items = parse_items(soup)
    seen = {i["id"] for i in items}
    page = 1
    while page < max_pages:
        nxt = soup.select_one("#ucFoundActsControl_LinkButton1")
        if not nxt:
            break
        data = form_fields(soup)
        data["__EVENTTARGET"] = "ucFoundActsControl$LinkButton1"
        data["__EVENTARGUMENT"] = ""
        time.sleep(delay)
        r = s.post(r.url, data=data, timeout=60)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        new = [i for i in parse_items(soup) if i["id"] not in seen]
        if not new:
            break
        items += new
        seen.update(i["id"] for i in new)
        page += 1
        print(f"  sahifa {page}: jami {len(items)}", file=sys.stderr)
    return items


if __name__ == "__main__":
    items = collect(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    print(len(items), "ta hujjat")
