# -*- coding: utf-8 -*-
"""Convert College Board question-bank PDF exports into JSON + PNG assets."""
import pymupdf, re, os, sys, json

sys.stdout.reconfigure(encoding="utf-8")

#   py -3 tools/extract.py [both|eng|math] [PDF ...]
#
# With no PDF arguments, every PDF in question-banks/ is inspected and sorted
# into the Math bank or the Reading and Writing bank by what the export itself
# says, so the College Board filenames do not matter.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
IMG = os.path.join(DATA, "img")
BANKS = os.path.join(ROOT, "question-banks")

PAGE_LEFT, PAGE_RIGHT = 16.0, 596.0
ZOOM = 2.2
FAKE_SPACE_MAX = 1.0          # pt; real word-spaces are >= 2.2pt


# ---------------------------------------------------------------- text layer
def span_text(span):
    """Span text with the sub-point kerning spaces removed."""
    out = []
    for ch in span["chars"]:
        if ch["c"] == " " and (ch["bbox"][2] - ch["bbox"][0]) < FAKE_SPACE_MAX:
            continue
        out.append(ch["c"])
    return "".join(out)


def page_lines(page):
    """Group spans into visual rows by vertical overlap, ordered left to right.

    The export renders small caps, smart quotes and similar glyphs as separate
    PDF lines whose y0 differs by ~1pt from the run they belong to, so sorting
    raw lines by (y0, x0) interleaves them wrongly ("FABRY" -> "ABRY ... F").
    """
    spans = []
    for b in page.get_text("rawdict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            for s in l["spans"]:
                t = span_text(s)
                if t.strip() == "":
                    continue
                spans.append((s["bbox"], t))
    spans.sort(key=lambda s: (s[0][1], s[0][0]))

    rows = []
    for bbox, t in spans:
        x0, y0, x1, y1 = bbox
        cy = (y0 + y1) / 2.0
        placed = False
        for r in rows:
            # same visual row if this span's centre sits inside the row's band
            if r["y0"] - 1.0 <= cy <= r["y1"] + 1.0:
                r["items"].append((x0, x1, t))
                r["y0"] = min(r["y0"], y0)
                r["y1"] = max(r["y1"], y1)
                placed = True
                break
        if not placed:
            rows.append({"y0": y0, "y1": y1, "items": [(x0, x1, t)]})

    res = []
    for r in rows:
        r["items"].sort()
        parts = []
        prev_x1 = None
        for x0, x1, t in r["items"]:
            if prev_x1 is not None and (x0 - prev_x1) > 1.5:
                parts.append(" ")
            parts.append(t)
            prev_x1 = x1
        txt = "".join(parts)
        if txt.strip() == "":
            continue
        res.append((round(r["y0"], 1), r["items"][0][0], r["y1"],
                    max(i[1] for i in r["items"]), txt))
    res.sort(key=lambda r: (r[0], r[1]))
    return res


# get_drawings() is expensive on these pages (hundreds of vector paths for the
# typeset maths) and every region we crop asks for it again, so memoise both
# heavy per-page calls across the few pages a question spans.
_CACHE = {}


def _page_data(page):
    key = (id(page.parent), page.number)
    hit = _CACHE.get(key)
    if hit is None:
        if len(_CACHE) > 6:
            _CACHE.clear()
        hit = _CACHE[key] = (page.get_drawings(), page.get_text("dict"))
    return hit


def pg_drawings(page):
    return _page_data(page)[0]


def pg_text(page):
    return _page_data(page)[1]


def content_bottom(page):
    b = 0.0
    for l in pg_text(page)["blocks"]:
        b = max(b, l["bbox"][3])
    for d in pg_drawings(page):
        b = max(b, d["rect"][3])
    return min(b + 3, page.rect.y1)


def is_figure(page, y0, y1):
    """True only for a real graphic (bar/line chart), not for the ruled boxes
    and bullet glyphs used by 'Rhetorical Synthesis' note lists, whose text
    extracts perfectly well and should stay reflowable text."""
    # rotated text means axis labels
    for b in pg_text(page)["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            if (l["bbox"][1] > y0 - 1 and l["bbox"][3] < y1 + 1
                    and abs(l.get("dir", (1, 0))[1]) > 1e-6):
                return True
    # a solid shape with real width AND height is a bar or a plot area;
    # box rules are hairlines and bullet dots are tiny
    for d in pg_drawings(page):
        r = d["rect"]
        if r[3] <= y0 + 1 or r[1] >= y1 - 1:
            continue
        if d.get("fill") and min(r[2] - r[0], r[3] - r[1]) > 6:
            return True
    return False


def figure_bottom(page, y0, y1):
    """Lowest edge of the graphic itself, so the prose underneath a chart can
    stay selectable text instead of being baked into the picture."""
    bot = None
    for d in pg_drawings(page):
        r = d["rect"]
        if r[3] > y0 + 1 and r[1] < y1 - 1:
            bot = r[3] if bot is None else max(bot, r[3])
    for b in pg_text(page)["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            r = l["bbox"]
            if (r[1] > y0 - 1 and r[3] < y1 + 1
                    and abs(l.get("dir", (1, 0))[1]) > 1e-6):
                bot = r[3] if bot is None else max(bot, r[3])
    return bot


# ---------------------------------------------------------------- metadata
def parse_meta(page):
    words = page.get_text("words")
    hdr = {}
    for w in words:
        if w[4] in ("Assessment", "Test", "Domain", "Skill", "Difficulty") and w[1] < 130:
            hdr.setdefault(w[4], w[0])
    if len(hdr) < 5:
        return None
    cols = sorted(hdr.items(), key=lambda kv: kv[1])
    names = [c[0] for c in cols]
    xs = [c[1] for c in cols]
    hdr_y = min(w[3] for w in words if w[4] in hdr and w[1] < 130)
    qtop = 250.0
    for y0, x0, y1, x1, t in page_lines(page):
        if t.strip() == "Question":
            qtop = y0
            break
    buckets = {n: [] for n in names}
    for w in words:
        if w[1] <= hdr_y or w[3] >= qtop:
            continue
        idx = 0
        for i, x in enumerate(xs):
            if w[0] >= x - 3:
                idx = i
        buckets[names[idx]].append((round(w[1], 1), w[0], w[4]))
    out = {}
    for n, ws in buckets.items():
        ws.sort()
        out[n] = " ".join(w[2] for w in ws).strip()
    return out


# ---------------------------------------------------------------- rendering
def _is_colour(c):
    return (c and len(c) == 3
            and not (abs(c[0] - c[1]) < .02 and abs(c[1] - c[2]) < .02))


def region_has_colour(page, clip):
    """These exports are almost entirely black-on-white, so regions without
    any coloured ink can be rendered as 8-bit grey at less than half the size."""
    for d in pg_drawings(page):
        if (pymupdf.Rect(d["rect"]) & clip).is_empty:
            continue
        if _is_colour(d.get("fill")) or _is_colour(d.get("color")):
            return True
    for b in pg_text(page)["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            if (pymupdf.Rect(l["bbox"]) & clip).is_empty:
                continue
            for s in l["spans"]:
                v = s.get("color", 0)
                r, g, bl = (v >> 16) & 255, (v >> 8) & 255, v & 255
                if abs(r - g) > 6 or abs(g - bl) > 6:
                    return True
    return False


def ink_bounds(page, y0, y1, x0, x1):
    """Vertical extent of actual content inside a box, so a crop taken between
    two layout anchors does not carry the blank gap that follows it."""
    lo = hi = None
    def add(a, b):
        nonlocal lo, hi
        lo = a if lo is None else min(lo, a)
        hi = b if hi is None else max(hi, b)
    for blk in pg_text(page)["blocks"]:
        if blk["type"] != 0:
            continue
        for l in blk["lines"]:
            r = l["bbox"]
            if r[3] > y0 and r[1] < y1 and r[2] > x0 and r[0] < x1:
                add(r[1], r[3])
    for d in pg_drawings(page):
        r = d["rect"]
        if r[3] > y0 and r[1] < y1 and r[2] > x0 and r[0] < x1:
            add(r[1], r[3])
    return lo, hi


def render_region(doc, qid, tag, start, end, left=PAGE_LEFT, zoom=ZOOM):
    """start/end = (page_index, y). Returns list of relative image paths."""
    sp, sy = start
    ep, ey = end
    paths = []
    for pi in range(sp, ep + 1):
        page = doc[pi]
        y0 = sy if pi == sp else 16.0
        y1 = ey if pi == ep else content_bottom(page)
        if y1 - y0 < 4:
            continue
        lo, hi = ink_bounds(page, y0, y1, left, PAGE_RIGHT)
        if lo is None:
            continue
        y0, y1 = max(y0, lo - 2.0), min(y1, hi + 2.0)
        if y1 - y0 < 3:
            continue
        clip = pymupdf.Rect(left, max(0, y0), PAGE_RIGHT, min(y1, page.rect.y1))
        kw = {"matrix": pymupdf.Matrix(zoom, zoom), "clip": clip, "alpha": False}
        if not region_has_colour(page, clip):
            kw["colorspace"] = pymupdf.csGRAY
        pix = page.get_pixmap(**kw)
        name = "%s_%s%d.png" % (qid, tag, len(paths))
        pix.save(os.path.join(IMG, name))
        paths.append("data/img/" + name)
    return paths


ANS_NOTE_RE = re.compile(
    r"Note that (.+?) (?:are|is) examples? of ways to enter (?:a|the) correct answer")
ANS_IS_RE = re.compile(r"The correct answer is\s+(-?\d+(?:\.\d+)?(?:/\d+)?)\s*[.,]")
ANS_CHOICE_RE = re.compile(r"\bChoice ([A-D]) is (?:correct|the best answer)")


def recover_answer(text, mcq=False):
    """Older questions carry no 'Correct Answer:' line, so the answer has to be
    read out of the rationale prose."""
    if mcq:
        m = ANS_CHOICE_RE.search(text)
        if m:
            return m.group(1)
    m = ANS_NOTE_RE.search(text)
    if m:
        parts = [p.strip() for p in re.split(r",\s*|\s+and\s+", m.group(1))]
        parts = [p for p in parts if re.fullmatch(r"-?[\d]+(?:\.\d+)?(?:/\d+)?", p)]
        if parts:
            return ", ".join(dict.fromkeys(parts))
    m = ANS_IS_RE.search(text)
    if m:
        return m.group(1)
    return None


# ---------------------------------------------------------------- structure
def locate(stream):
    """stream = [(page, y0, x0, y1, x1, text)]. Find the 4 section labels."""
    marks = {}
    for i, item in enumerate(stream):
        s = item[5].strip()
        if s == "Question" and "Question" not in marks:
            marks["Question"] = (i, item[0], item[1], item[3])
        elif s == "Answer" and "Question" in marks and "Answer" not in marks:
            marks["Answer"] = (i, item[0], item[1], item[3])
        elif s.startswith("Correct Answer:") and "Correct" not in marks:
            marks["Correct"] = (i, item[0], item[1], item[3], s)
        elif s == "Rationale" and "Rationale" not in marks:
            # recorded independently of "Correct Answer:", which the older
            # grid-in questions omit entirely
            marks["Rationale"] = (i, item[0], item[1], item[3])
    return marks


def bullet_keys(page, rows):
    """(page, y0) of rows introduced by a bullet glyph, which the export draws
    as a small filled square rather than a character."""
    dots = []
    for d in pg_drawings(page):
        r = d["rect"]
        w, h = r[2] - r[0], r[3] - r[1]
        if d.get("fill") and 1.0 <= w <= 6.0 and 1.0 <= h <= 6.0 and abs(w - h) < 2:
            dots.append(r)
    out = set()
    for (y0, x0, y1, x1, t) in rows:
        for r in dots:
            cy = (r[1] + r[3]) / 2.0
            if y0 - 1 <= cy <= y1 + 1 and r[2] <= x0 + 1 and (x0 - r[2]) < 25:
                out.add(round(y0, 1))
                break
    return out


CHOICE_RE = re.compile(r"^([A-D])\.(?:\s|$)")


def find_choices(stream, i_start, i_end):
    """Indices of lines that begin an answer choice."""
    out = []
    want = "A"
    for i in range(i_start, i_end):
        pi, y0, x0, y1, x1, t = stream[i]
        m = CHOICE_RE.match(t.strip())
        if m and m.group(1) == want and x0 < 34:
            out.append((i, m.group(1)))
            want = chr(ord(want) + 1)
    return out


def clean(txt):
    txt = txt.replace("\u00a0", " ")
    txt = re.sub(r"[ \t]+", " ", txt)
    return txt.strip()


def last_para_start(stream, i0, i1):
    """Index of the first row of the final paragraph in [i0, i1)."""
    start = i0
    for i in range(i0 + 1, i1):
        pi, y0 = stream[i][0], stream[i][1]
        ppi, py0 = stream[i - 1][0], stream[i - 1][1]
        if pi == ppi and (y0 - py0) > 18.0:
            start = i
    return start


def join_lines(stream, i0, i1, bullets=None):
    parts = []
    prev_y = None
    prev_page = None
    for i in range(i0, i1):
        pi, y0, x0, y1, x1, t = stream[i]
        t = clean(t)
        if not t:
            continue
        is_bullet = bullets is not None and (pi, round(y0, 1)) in bullets
        if is_bullet:
            if parts:
                parts.append("\n\n")
            parts.append("• " + t)
            prev_y, prev_page = y0, pi
            continue
        # a page break almost always resumes mid-paragraph, so only a genuine
        # vertical gap on the same page starts a new paragraph
        if prev_y is not None and pi == prev_page and (y0 - prev_y) > 18.0:
            parts.append("\n\n")
        elif parts:
            parts.append(" ")
        parts.append(t)
        prev_y, prev_page = y0, pi
    s = "".join(parts)
    s = re.sub(r" *\n\n *", "\n\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


# ---------------------------------------------------------------- main
def build(pdf_path, subject, render_math):
    doc = pymupdf.open(pdf_path)
    starts = []
    for i in range(doc.page_count):
        m = re.search(r"Question ID:\s*([0-9a-fA-F]{6,10})", doc[i].get_text())
        if m:
            starts.append((m.group(1), i))
    questions = []
    problems = []
    for k, (qid, sp) in enumerate(starts):
        ep = starts[k + 1][1] - 1 if k + 1 < len(starts) else doc.page_count - 1
        stream = []
        bullets = set()
        for pi in range(sp, ep + 1):
            rows = page_lines(doc[pi])
            for (y0, x0, y1, x1, t) in rows:
                stream.append((pi, y0, x0, y1, x1, t))
            for y in bullet_keys(doc[pi], rows):
                bullets.add((pi, y))
        meta = parse_meta(doc[sp])
        marks = locate(stream)
        if not meta or "Question" not in marks:
            problems.append((qid, "missing labels/meta", sorted(marks)))
            continue
        rat = marks.get("Rationale")

        if "Correct" in marks:
            c_i, c_pi, c_y0, c_y1, c_txt = marks["Correct"]
            answer = c_txt.split("Correct Answer:", 1)[1].strip()
        elif rat is not None:
            # older grid-in format: the stem runs up to Rationale and the
            # answer has to be read out of the rationale prose
            c_i, c_pi, c_y0, c_y1 = rat
            answer = recover_answer(
                join_lines(stream, rat[0] + 1, len(stream)),
                mcq="Answer" in marks and marks["Answer"][0] < rat[0])
            if not answer:
                problems.append((qid, "answer not recoverable", None))
                continue
        else:
            problems.append((qid, "missing labels/meta", sorted(marks)))
            continue

        q_i, q_pi, q_y0, q_y1 = marks["Question"]
        has_ans = "Answer" in marks and marks["Answer"][0] < c_i
        a_i, a_pi, a_y0, a_y1 = (marks["Answer"] if has_ans
                                 else (c_i, c_pi, c_y0, c_y1))

        rec = {
            "id": qid,
            "test": meta.get("Test", ""),
            "domain": meta.get("Domain", ""),
            "skill": meta.get("Skill", ""),
            "difficulty": meta.get("Difficulty", ""),
            "answer": answer,
            "type": "mcq" if has_ans else "spr",
        }

        choices = find_choices(stream, a_i + 1, c_i) if has_ans else []
        if has_ans and len(choices) < 2:
            problems.append((qid, "choices not found", len(choices)))
            continue

        if render_math:
            rec["stemImgs"] = render_region(doc, qid, "q",
                                            (q_pi, q_y1 + 1), (a_pi, a_y0 - 1))
            rec["stemText"] = clean(join_lines(stream, q_i + 1, a_i))
            ci = {}
            for n, (idx, letter) in enumerate(choices):
                pi, y0, x0, y1, x1, t = stream[idx]
                nxt = choices[n + 1][0] if n + 1 < len(choices) else c_i
                npi, ny0 = stream[nxt][0], stream[nxt][1]
                ci[letter] = render_region(doc, qid, letter,
                                           (pi, y0 - 2.0), (npi, ny0 - 2.0),
                                           left=x0 + 10.4)
            rec["choiceImgs"] = ci
            if rat is not None:
                # worked solutions are reference reading, so a slightly lower
                # resolution keeps the asset folder to a sane size
                rec["ratImgs"] = render_region(doc, qid, "r",
                                               (rat[1], rat[3] + 1),
                                               (ep, content_bottom(doc[ep])),
                                               zoom=1.9)
        else:
            rec["stem"] = join_lines(stream, q_i + 1, a_i, bullets)
            # the prompt is always the final paragraph; everything above it is
            # the passage, which is what the left-hand pane shows
            p_i = last_para_start(stream, q_i + 1, a_i)
            rec["prompt"] = join_lines(stream, p_i, a_i)
            rec["passage"] = join_lines(stream, q_i + 1, p_i, bullets)
            stem_bot = a_y0 if q_pi == a_pi else 10000
            if is_figure(doc[q_pi], q_y1, stem_bot):
                # a chart's tick and axis labels extract as jumbled fragments,
                # so the graphic itself is rendered; the prose beneath it
                # extracts fine and stays reflowable text
                fb = figure_bottom(doc[q_pi], q_y1, stem_bot)
                if fb is None:
                    fb = stream[p_i][1] - 4 if q_pi == stream[p_i][0] else stem_bot
                rec["passageImgs"] = render_region(
                    doc, qid, "q", (q_pi, q_y1 + 1), (q_pi, fb + 3))
                rest = next((i for i in range(q_i + 1, p_i)
                             if stream[i][0] > q_pi or stream[i][1] > fb + 1), p_i)
                rec["passage"] = join_lines(stream, rest, p_i, bullets)
            ch = {}
            for n, (idx, letter) in enumerate(choices):
                nxt = choices[n + 1][0] if n + 1 < len(choices) else c_i
                txt = join_lines(stream, idx, nxt)
                txt = CHOICE_RE.sub("", txt.strip(), count=1).strip()
                ch[letter] = txt
            rec["choices"] = ch
            if rat is not None:
                rec["rationale"] = join_lines(stream, rat[0] + 1, len(stream))

        questions.append(rec)
        if (k + 1) % 250 == 0:
            print("  %s: %d/%d" % (subject, k + 1, len(starts)), flush=True)

    doc.close()
    return questions, problems


# ---------------------------------------------------------------- discovery
def identify(path):
    """'math', 'eng' or None, read from the export's own Test column."""
    try:
        doc = pymupdf.open(path)
    except Exception as exc:
        print("  ! cannot open %s (%s)" % (os.path.basename(path), exc))
        return None
    seen = set()
    try:
        for i in range(min(6, doc.page_count)):
            t = doc[i].get_text()
            if "Reading and Writing" in t:
                seen.add("eng")
            elif re.search(r"^SAT$", t, re.M) and "\nMath\n" in t:
                seen.add("math")
    finally:
        doc.close()
    return seen.pop() if len(seen) == 1 else None


def discover(args):
    """{'math': path, 'eng': path} from explicit arguments or question-banks/."""
    paths = [a for a in args if a.lower().endswith(".pdf")]
    if not paths:
        if not os.path.isdir(BANKS):
            return {}
        paths = [os.path.join(BANKS, f) for f in sorted(os.listdir(BANKS))
                 if f.lower().endswith(".pdf")]
    found = {}
    for p in paths:
        kind = identify(p)
        name = os.path.basename(p)
        if kind is None:
            print("  ? skipping %s - not a recognisable question-bank export" % name)
        elif kind in found:
            print("  ? skipping %s - already have a %s bank" % (name, kind))
        else:
            found[kind] = p
            print("  + %-9s %s" % (kind, name))
    return found


def prune_images():
    """Delete images in data/img that no generated bank refers to.

    Re-running over a different export leaves the old renders behind, and a
    cloud-synced folder can add conflict copies of its own, so sweep both.
    """
    if not os.path.isdir(IMG):
        return
    referenced = set()
    for name, var in (("english.js", "SAT_ENGLISH"), ("math.js", "SAT_MATH")):
        path = os.path.join(DATA, name)
        if not os.path.exists(path):
            continue
        try:
            raw = open(path, encoding="utf-8").read()
            for q in json.loads(raw[raw.index("=") + 1:-1]):
                for key in ("stemImgs", "ratImgs", "passageImgs"):
                    referenced.update(os.path.basename(p) for p in q.get(key, []))
                for lst in q.get("choiceImgs", {}).values():
                    referenced.update(os.path.basename(p) for p in lst)
        except Exception as exc:
            print("  ! could not read %s (%s) - skipping cleanup" % (name, exc))
            return
    if not referenced:
        return
    freed = removed = 0
    for f in os.listdir(IMG):
        if f in referenced:
            continue
        p = os.path.join(IMG, f)
        try:
            freed += os.path.getsize(p)
            os.remove(p)
            removed += 1
        except OSError:
            pass
    if removed:
        print("Cleaned up %d unused image(s), freeing %.1f MB"
              % (removed, freed / 1e6))


HELP = """
No question-bank PDFs found.

  1. Go to  https://satsuitequestionbank.collegeboard.org
  2. Choose SAT, tick a section, select the questions and export to PDF
     (do this twice: once for Reading and Writing, once for Math)
  3. Put both PDFs in:  question-banks/
  4. Run this again:    py -3 tools/extract.py

The filenames do not matter - each export says which section it is.
"""

if __name__ == "__main__":
    args = sys.argv[1:]
    which = args[0] if args and not args[0].lower().endswith(".pdf") else "both"

    print("Looking for question-bank exports...")
    banks = discover(args)
    wanted = {"both": ["eng", "math"], "eng": ["eng"], "math": ["math"]}.get(which)
    if wanted is None:
        sys.exit("usage: py -3 tools/extract.py [both|eng|math] [PDF ...]")
    if not banks:
        sys.exit(HELP)
    missing = [k for k in wanted if k not in banks]
    if missing:
        print("  ! no %s bank found - skipping it" % " or ".join(missing))
        wanted = [k for k in wanted if k in banks]
    if not wanted:
        sys.exit(HELP)

    os.makedirs(IMG, exist_ok=True)
    for kind in wanted:
        is_math = kind == "math"
        label, var, out = (("MATH", "SAT_MATH", "math.js") if is_math
                           else ("ENGLISH", "SAT_ENGLISH", "english.js"))
        print("\nExtracting %s (this takes a few minutes)..." % label)
        qs, probs = build(banks[kind], kind, render_math=is_math)
        with open(os.path.join(DATA, out), "w", encoding="utf-8") as f:
            f.write("window.%s=" % var)
            json.dump(qs, f, ensure_ascii=False, separators=(",", ":"))
            f.write(";")
        print("%s: %d questions written to data/%s (%d skipped)"
              % (label, len(qs), out, len(probs)))
        for p in probs[:10]:
            print("   ", p)

    prune_images()

    if "math" in wanted:
        # a few older Math questions state their answer only in the rationale
        print("\nRecovering older-format Math questions...")
        try:
            import patch_missing  # noqa: F401  (runs on import)
        except SystemExit:
            pass
        except Exception as exc:
            print("  (skipped: %s)" % exc)

    print("\nDone. Open index.html in your browser.")
