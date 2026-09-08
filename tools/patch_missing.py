# -*- coding: utf-8 -*-
"""Re-process only the math questions that failed, and merge them into math.js."""
import json, os, sys, re, pymupdf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as E
sys.stdout.reconfigure(encoding="utf-8")

PATH = os.path.join(E.DATA, "math.js")
raw = open(PATH, encoding="utf-8").read()
qs = json.loads(raw[raw.index("=") + 1:-1])
have = {q["id"] for q in qs}
print("already in math.js:", len(qs))

banks = E.discover(sys.argv[1:])
if "math" not in banks:
    sys.exit("No Math question-bank PDF found in question-banks/.")
doc = pymupdf.open(banks["math"])
starts = []
for i in range(doc.page_count):
    m = re.search(r"Question ID:\s*([0-9a-fA-F]{6,10})", doc[i].get_text())
    if m:
        starts.append((m.group(1), i))
missing = [(q, i, k) for k, (q, i) in enumerate(starts) if q not in have]
print("missing:", len(missing), [m[0] for m in missing])

added, still = [], []
for qid, sp, k in missing:
    ep = starts[k + 1][1] - 1 if k + 1 < len(starts) else doc.page_count - 1
    stream = []
    for pi in range(sp, ep + 1):
        for row in E.page_lines(doc[pi]):
            stream.append((pi,) + row)
    meta = E.parse_meta(doc[sp])
    marks = E.locate(stream)
    if not meta or "Question" not in marks or "Rationale" not in marks:
        still.append((qid, "no labels")); continue
    rat = marks["Rationale"]
    has_ans = "Answer" in marks and marks["Answer"][0] < rat[0]
    answer = E.recover_answer(E.join_lines(stream, rat[0] + 1, len(stream)), mcq=has_ans)
    if not answer:
        still.append((qid, "answer not recoverable")); continue

    q_i, q_pi, q_y0, q_y1 = marks["Question"]
    c_i, c_pi, c_y0, c_y1 = rat
    a_i, a_pi, a_y0, a_y1 = (marks["Answer"] if has_ans else (c_i, c_pi, c_y0, c_y1))
    choices = E.find_choices(stream, a_i + 1, c_i) if has_ans else []
    if has_ans and len(choices) < 2:
        still.append((qid, "choices not found")); continue

    rec = {"id": qid, "test": meta.get("Test", ""), "domain": meta.get("Domain", ""),
           "skill": meta.get("Skill", ""), "difficulty": meta.get("Difficulty", ""),
           "answer": answer, "type": "mcq" if has_ans else "spr"}
    rec["stemImgs"] = E.render_region(doc, qid, "q", (q_pi, q_y1 + 1), (a_pi, a_y0 - 1))
    rec["stemText"] = E.clean(E.join_lines(stream, q_i + 1, a_i))
    ci = {}
    for n, (idx, letter) in enumerate(choices):
        pi, y0, x0, y1, x1, t = stream[idx]
        nxt = choices[n + 1][0] if n + 1 < len(choices) else c_i
        ci[letter] = E.render_region(doc, qid, letter, (pi, y0 - 2.0),
                                     (stream[nxt][0], stream[nxt][1] - 2.0),
                                     left=x0 + 10.4)
    rec["choiceImgs"] = ci
    rec["ratImgs"] = E.render_region(doc, qid, "r", (rat[1], rat[3] + 1),
                                     (ep, E.content_bottom(doc[ep])), zoom=1.9)
    rec["_k"] = k
    added.append(rec)

print("recovered:", len(added), "| still unrecoverable:", len(still))
for s in still:
    print("   ", s)

if added:
    order = {q: k for k, (q, i) in enumerate(starts)}
    for q in qs:
        q["_k"] = order.get(q["id"], 10 ** 9)
    qs.extend(added)
    qs.sort(key=lambda q: q["_k"])
    for q in qs:
        q.pop("_k", None)
    with open(PATH, "w", encoding="utf-8") as f:
        f.write("window.SAT_MATH=")
        json.dump(qs, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")
    print("math.js now has", len(qs), "questions")
