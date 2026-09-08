# Put your question-bank PDFs here

This folder starts empty. Drop your two College Board exports in it:

1. Go to **<https://satsuitequestionbank.collegeboard.org>** (free, no account needed).
2. Choose **SAT**, tick **Reading and Writing**, select the questions you want,
   and use **Export → PDF**. Tick **"Include correct answer and rationale"**.
3. Do the same again for **Math**.
4. Drop both PDFs in this folder.
5. From the project root, run:

   ```bash
   py -3 tools/extract.py
   ```

**Filenames don't matter.** The extractor opens each PDF and reads which section
it is from the export's own metadata, so `questionbank-export-2026-9-8 (1).pdf`
works exactly as well as `reading.pdf`.

You can also select a subset — one domain, or only Hard questions — and the app
will adapt to whatever you give it. More questions simply means less repetition.

---

These PDFs are College Board copyrighted material for your personal study.
They are listed in `.gitignore` and are never committed or uploaded.
