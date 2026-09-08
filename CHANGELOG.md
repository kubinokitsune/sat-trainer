# Changelog

All notable changes to this project are documented here.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
