# Changelog

All notable changes to this project are documented here.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.3] - 2026-09-09

### Fixed

- **GitHub showed the licence as "Other" instead of MIT.** GitHub detects
  licences with `licensee`, which strips the copyright line, normalises
  whitespace, and needs a 98% match against the canonical text. LICENSE carried
  the MIT text verbatim but with a ~630-character note appended about SAT content
  and trademarks, which put it at 76% - under the threshold, so it fell back to
  "Other".

  LICENSE is now canonical MIT and nothing else (100% match). The note it used to
  carry moved to NOTICE.md, which also covers the Desmos embed, and the README
  links to it.


## [1.4.2] - 2026-09-09

### Fixed

- **The default profile name was a real person's.** Anyone who cloned the repo
  started as "Felipe", both on the dashboard and on the test footer. The default
  is now "Student", editable in Settings as before.

### Changed

- Screenshots redone across the whole app, from a generated demo profile rather
  than anyone's real progress: dashboard, the Bluebook-style test interface, a
  scored practice test, the custom drill picker, analytics, the ability/pacing/
  mistake-bank screens, and badges.

  The question view is still deliberately absent — a screenshot of it would
  reproduce College Board question content. The test-interface shot uses the
  end-of-module review screen, which is the real chrome with no question on it.

  Re-encoded as palette PNGs at 1860px: seven images for 1.07 MB, less than the
  three they replaced.


## [1.4.1] - 2026-09-09

### Fixed

- **The dashboard now notices when a review falls due.** The review banner was
  only redrawn by `refreshHome()`, which runs when you answer or navigate — so
  sitting on the dashboard, nothing ever noticed a question's due time passing
  and you had to reload before "Review now" appeared. The Progress page looked
  right because it rebuilds whenever you open it.

  The dashboard now wakes itself at the exact moment the next review is due, and
  re-checks at least every 30 seconds. Because browsers throttle timers in a
  background tab, it also refreshes immediately on `visibilitychange` and window
  focus, so a tab left open is correct the instant you look at it.

### Changed

- The review banner reads sensibly when nothing is due yet — "N questions
  waiting to come back · next in 12 min" instead of "0 questions ready for
  review" — and is only amber when there is actually something to do.
- Corrected the README: generated data is ~110 MB, not ~100 MB, and the
  difficulty target's range (50-88%) is now stated where the setting is
  described.


## [1.4.0] - 2026-09-09

### Fixed

- **A linked save file no longer un-links when you reload.** The file handle is
  now remembered in IndexedDB and picked back up on the next load, so the app
  reconnects on its own and keeps writing without asking.

  1.1.0 shipped this as session-only on the belief that a page served from
  `file://` cannot use IndexedDB in Chrome. That was wrong. The probe behind it
  ran in headless Chrome, where IndexedDB never completes an open on *any*
  origin; in a real browser it works on `file://` exactly as it does over http.

  A full browser restart can still drop the write *permission* — that part is
  the browser's call, not ours. Instead of silently going quiet, the dashboard
  and Settings now offer a one-click **allow writing again** on the file already
  remembered, so you never have to hunt for it a second time.
- **The last answer before you close the tab now reaches the file.** Writes are
  debounced by ~1.2s and browsers throttle timers in a hidden tab, so a quick
  close could drop the most recent answer. Pending writes are flushed on
  `visibilitychange` and `pagehide`.


## [1.3.0] - 2026-09-09

Scoring and question selection now both run on item response theory, which is
what the digital SAT itself uses.

### Added

- **Ability estimate replaces the stepped difficulty counter.** Every question
  carries a difficulty and a discrimination; your ability sits on the same scale
  and moves after each answer - further for a hard question than an easy one,
  and further early on than once it has settled. Tracked per section *and* per
  skill, with thin skills shrunk toward the section average so one bad run does
  not swing everything.

  The picker then aims a little below your ability, so you get roughly the share
  right that you asked for and are still stretched. That target is a new
  **Settings** slider (50-88%, default 70%).

  The old behaviour is still available as **Settings > Stepped**, thresholds and
  all. The ability estimate keeps updating underneath either engine, so
  switching never throws it away.
- **Where you are working**, on the Progress page: your current ability per
  section, the band it falls in, and what that pace would be worth across a full
  section.

### Changed

- **The full test is scored the way the real one is.** It was raw-correct over
  total against a fixed curve. It is now the ability your responses imply:

  - *Which* questions you cleared matters, not only how many - two people on the
    same raw score usually land 10-20 points apart.
  - Multiple-choice questions carry a 1-in-4 guessing floor, so answering a
    section at random now scores near 200 instead of in the middle. On a
    98-question run of pure guesses the old model returned 770; it now returns
    400.
  - Module 2 routing is decided by the ability module 1 implies rather than raw
    accuracy, and the easier route caps the section at 650.

  The results screen explains all of this, and says plainly that the conversion
  is a model rather than the College Board's own unpublished table.


## [1.2.0] — 2026-09-08

The theme of this release is closing the loop: the app now brings back what
you got wrong, and tells you where your time is going.

### Added

- **Spaced repetition on your mistakes.** Miss a question and it is scheduled
  to come back: 10 minutes, then 1, 3, 7 and 21 days. Get it right and it moves
  up a step; miss it again and it drops to the front. Survive the whole ladder
  and it is marked fixed and retired.

  This closes a real hole. The picker prefers questions you have never seen,
  and with banks of 1,845 and 1,916 there are always unseen ones — so before
  this, **a question you got wrong would essentially never be shown to you
  again**. Roughly a third of an adaptive run is now spent back on things you
  missed, each marked with a "🔁 Review" tag so you know why it reappeared.
- **Mistake bank**, on the Progress & analytics tab. Every question you have
  missed and not yet fixed, filterable by section, skill, and whether it is due.
  Expand any row for the full question, the correct answer and the official
  explanation. "Practise these" turns the current filter into a session.
- **Pacing.** Median think time per question against the pace the real test
  allows (71s for Reading and Writing, 95s for Math), broken down by skill and
  labelled: *On pace*, *Rushing it*, *Slow but solid*, or *Biggest win here* for
  a skill that is both slow and inaccurate. Every attempt has recorded its
  timing since 1.0 — until now nothing read it.
- A review prompt on the dashboard when questions are due, and three badges for
  clearing them.
- The Progress tab now states what it is drawn from: how many questions you have
  answered, out of how large a bank.

### Changed

- A session follows each question's own section, so a review mixing Reading and
  Writing with Math lays out correctly and offers the calculator only on Math.
- Timings under a second or over ten minutes are excluded from pacing, and it
  reports medians, so one walked-away tab cannot skew the numbers.

## [1.1.0] — 2026-09-08

### Fixed

- **Math answer choices could come up blank.** 195 of 1,921 Math questions were
  rendering at least one empty choice — most often B or D, and worst on
  "which graph shows…" questions where every option is a picture. The export
  draws fractions, radicals and some graphs as **embedded rasters** rather than
  as text or vector art, and the crop logic only measured text and vector ink,
  so a choice made entirely of a raster looked empty and was dropped.
- **Inline maths was sliced in half.** A fraction is about three times the
  height of the text row it sits on, so cropping between consecutive rows cut
  the numerator off. Each piece of ink is now assigned to the choice whose band
  contains its centre, and the crop is the union of what that choice owns.
- **Images occasionally never appeared at all.** Question images were marked
  `loading="lazy"`; one inserted into a pane that was still being laid out
  could be judged off-screen and then never load. Question images load eagerly
  now — there are only a handful per question.
- **A timed module could be short.** If a difficulty bucket ran dry the module
  was built with fewer questions than the real thing. It now widens the
  difficulty before giving up, so Reading and Writing is always exactly 27
  questions in 32:00 and Math exactly 22 in 35:00.
- **One topic was listed twice.** The export spells a skill
  "Cross-Text Connections" 59 times and "Cross-text Connections" twice, which
  split it into two entries in the topic picker and in the per-skill analytics.
  Names are now folded onto their most common spelling.
- Five Math questions whose artwork is genuinely missing from the College Board
  export are now skipped rather than shipped with an unanswerable blank choice.

### Added

- **Save files.** Progress no longer depends on browser storage alone.
  - **Link a save file** (Chrome/Edge) and every answer is mirrored to that
    file on disk as you go.
  - **Park it at `data/save.js`** and the app restores it by itself on launch —
    which is what makes progress survive clearing site data or moving to
    another computer.
  - **Download / Load from file** works in every browser as a fallback.
  - Restoring never silently overwrites: if the file is older than what is in
    the browser you are told, with both timestamps and question counts.
  - The dashboard warns when progress has never been backed up.
- **A real custom drill.** Choose the section, pick individual **skills** (not
  just domains) from a live topic tree with counts, set the difficulty, choose
  **how many questions**, and optionally **run a clock**. The time limit is
  derived from the question count at genuine test pace, and you can move it
  between half and double that.
- **18 more badges** — 33 in total — covering volume, streaks, accuracy under
  pressure, breadth across domains and skills, score improvement, and keeping
  a backup.
- **A rebuilt explanation panel.** Your answer and the key are shown side by
  side, the explanation of the correct answer is separated from the
  per-choice notes, and the option you actually picked is called out inside
  "Why the other choices are wrong".
- **Enlarge button on maths figures**, matching the one Reading and Writing
  charts already had.
- `index.html#progress` opens the analytics page directly.

### Changed

- `tools/extract.py` skips questions whose choices are missing artwork or text
  and reports each one, instead of emitting a broken question.
- Regenerating the data prunes images no longer referenced by any bank.

## [1.0.0] — 2026-09-08

Initial release: adaptive practice, timed modules, a full section-adaptive
practice test with the 10-minute break, the Desmos calculator and SAT
reference sheet, gamification, progress analytics, and the PDF extractor that
turns a College Board question-bank export into app data.
