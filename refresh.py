#!/usr/bin/env python3
"""
Build the Therapy+ Financial Performance Tool (merged service line + state tool)
from data/merged_data.csv.

    python3 refresh.py                  writes build/index.html
    python3 refresh.py --in other.csv   use a different input
    python3 refresh.py --out path.html

CSV columns (header row required; order does not matter):
    month                       "Jul 2026", "2026-07" or "7/2026"
    aba_rev, aba_gp, aba_hours
    therapy_rev, therapy_gp, therapy_visits
    sbs_rev, sbs_gp, sbs_hours
    other_rev, other_gp
    ebitda, net_income          Therapy+ consolidated (blank EBITDA renders as a dash)
    CO_rev, CO_gp, CO_ebitda, CO_ni, CO_visits     and the same for TX, AZ, NV_ID
                                (state columns blank for months without state detail)

Where the numbers come from (monthly close):
    Revenue / GP by line:  department P&Ls. Therapy = TX + CO + AZ + ID/NV (Total column).
    Consolidated NI:       sum of Net Income across the six department P&Ls (Total column,
                           which already includes the allocation columns).
    Consolidated EBITDA:   NI + depreciation and amortization + interest (no addbacks).
    State rev / GP / NI:   the state column of each Therapy P&L (allocation columns excluded);
                           state EBITDA = state NI (no D&A sits in the state columns).
    Therapy visits:        Platform KPI Master. State visits: KPI Master by state.
    ABA / SBS hours:       Budget to Actuals, account 90000.1003 TH+ Hours.
"""
import argparse, csv, json, sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATES = ["CO", "TX", "AZ", "NV_ID"]
MONTH_FMT = "%b %Y"


def parse_month(text):
    t = text.strip()
    for fmt in ("%b %Y", "%B %Y", "%Y-%m", "%m/%Y", "%b-%y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(t, fmt).strftime(MONTH_FMT)
        except ValueError:
            pass
    sys.exit(f"Could not parse month '{text}'")


def num(text):
    t = (text or "").strip().replace("$", "").replace(",", "")
    if t in ("", "-", "–", "null", "None", "n/a", "NA"):
        return None
    if t.startswith("(") and t.endswith(")"):
        t = "-" + t[1:-1]
    return float(t)


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    out = {}
    for r in rows:
        if not (r.get("month") or "").strip():
            continue
        m = parse_month(r["month"])
        if m in out:
            sys.exit(f"Duplicate month {m}")
        out[m] = {k: num(v) for k, v in r.items() if k != "month"}
    months = sorted(out, key=lambda m: datetime.strptime(m, MONTH_FMT))
    return months, out


def record(r):
    g = lambda k: r.get(k)
    lines = {
        "aba":     {"rev": g("aba_rev") or 0,     "gp": g("aba_gp") or 0,     "vol": g("aba_hours")},
        "therapy": {"rev": g("therapy_rev") or 0, "gp": g("therapy_gp") or 0, "vol": g("therapy_visits")},
        "sbs":     {"rev": g("sbs_rev") or 0,     "gp": g("sbs_gp") or 0,     "vol": g("sbs_hours")},
        "other":   {"rev": g("other_rev") or 0,   "gp": g("other_gp") or 0,   "vol": None},
    }
    states = None
    if any(g(f"{s}_rev") is not None for s in STATES):
        states = {}
        for s in STATES:
            if g(f"{s}_rev") is None and g(f"{s}_ni") is None:
                continue
            states[s] = {"rev": g(f"{s}_rev") or 0, "gp": g(f"{s}_gp") or 0,
                         "ebitda": g(f"{s}_ebitda"), "ni": g(f"{s}_ni"), "vol": g(f"{s}_visits")}
    return {"lines": lines, "ebitda": g("ebitda"), "ni": g("net_income"), "states": states}


def warn(months, raw):
    w = []
    for m in months:
        r = raw[m]
        if r.get("ebitda") is None: w.append(f"{m}: consolidated EBITDA blank")
        for k in ("aba_rev", "therapy_rev"):
            if not r.get(k): w.append(f"{m}: {k} zero or blank")
    if w:
        print("Warnings:"); [print("  -", x) for x in w]


def read_weekly(path):
    """data/weekly_data.csv: week_ending, scope, rev, gp, vol. scope is a service line key
    (aba, therapy, sbs, other) or a state key (CO, TX, AZ, NV_ID). Optional file."""
    if not path.exists():
        return {}, []
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            wk = (r.get("week_ending") or "").strip()
            if not wk:
                continue
            for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
                try:
                    wk = datetime.strptime(wk, fmt).strftime("%Y-%m-%d"); break
                except ValueError:
                    pass
            else:
                sys.exit(f"Could not parse week_ending '{r['week_ending']}'")
            scope = (r.get("scope") or "").strip()
            bucket = "states" if scope in STATES else "lines"
            rec = out.setdefault(wk, {"lines": {}, "states": {}})
            rec[bucket][scope] = {"rev": num(r.get("rev")) or 0, "gp": num(r.get("gp")), "vol": num(r.get("vol"))}
    weeks = sorted(out)
    return out, weeks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default=str(HERE / "data" / "merged_data.csv"))
    ap.add_argument("--out", default=str(HERE / "build" / "index.html"))
    a = ap.parse_args()

    months, raw = read_csv(a.inp)
    warn(months, raw)
    data = {m: record(raw[m]) for m in months}
    weekly, weeks = read_weekly(HERE / "data" / "weekly_data.csv")
    if weeks:
        print(f"Weekly feed: {len(weeks)} weeks, {weeks[0]} to {weeks[-1]}")

    css = (HERE / "assets" / "base.css").read_text() + (HERE / "extra.css").read_text()
    logo = (HERE / "assets" / "logo.html").read_text()
    xlsx = (HERE / "assets" / "xlsx.full.min.js").read_text()   # SheetJS, bundled so the page stays self-contained
    body = (HERE / "page_body.html").read_text().replace("__LOGO__", logo).replace("__DATA_TAG__", f"{months[0]} – {months[-1]}")
    script = (HERE / "page_script.js").read_text().replace("/* ===== Init ===== */", (HERE / "loader.js").read_text() + "\n/* ===== Init ===== */").replace("__DATA__", json.dumps(data)).replace("__MONTHS__", json.dumps(months)).replace("__WEEKLY__", json.dumps(weekly)).replace("__WEEKS__", json.dumps(weeks))

    html = ("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            "<title>Therapy+ Financial Performance Tool, Care Options for Kids</title>\n"
            f"<style>{css}</style>\n</head>\n<body>\n{body}\n<script>\n{xlsx}\n</script>\n<script>\n{script}\n</script>\n</body>\n</html>\n")
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(html)
    print(f"Wrote {out}: {len(months)} months, {months[0]} to {months[-1]}")


if __name__ == "__main__":
    main()
