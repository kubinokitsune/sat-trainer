# Contributing

Thanks for taking a look. Bug reports and pull requests are welcome.

## The one hard rule

**Never commit SAT question content.** That means no PDFs in `question-banks/`
and nothing from `data/` — not the `.js` files, not the images, not a single
question pasted into an issue as an example. Both folders are gitignored; please
don't work around it.

If you need to report a problem with a specific question, quote its **Question ID**
(the 8-character hex code shown in the export, e.g. `a15b3219`) and describe the
symptom. That's enough for anyone with the bank to reproduce it.

## Getting set up

```bash
git clone https://github.com/kubinokitsune/sat-trainer.git
cd sat-trainer
py -3 -m pip install -r requirements.txt
# add your own PDF exports to question-banks/, then:
py -3 tools/extract.py
```

Open `index.html`. For a smaller, faster loop, export a subset from the College
Board site — a couple of hundred questions is plenty to develop against.

## Working on the app

`assets/` is plain HTML, CSS and JavaScript. There is no build step, no bundler
and no dependencies — reload the page and you're testing the real thing.

- `app.js` — screens, session engine, question rendering
- `store.js` — progress, XP, badges, analytics; the only thing that touches `localStorage`
- `charts.js` — hand-rolled SVG charts, deliberately dependency-free so the app works offline
- `reference.js` — the SAT reference sheet and Desmos loading

Please keep it dependency-free. Being able to double-click `index.html` on any
machine with no install is the point of the project.

## Working on the extractor

`tools/extract.py` is where the difficult logic lives. The
[under the hood](README.md#how-it-works-under-the-hood) section of the README
explains the PDF quirks it works around — read that first, because several of
them look like bugs until you know why the code is shaped that way.

If you change extraction, re-run it over a **full** export and check the skip
count at the end. It should be a handful out of thousands; a jump means something
regressed.

## Pull requests

- One change per PR, with a short note on what you tested.
- Match the surrounding style — the code is deliberately plain.
- Say which browser you tested in.

## Reporting bugs

Include your browser and OS, what you expected, what happened, and anything in
the browser console (F12 → Console). A Question ID helps for question-specific
problems.
