# Notice

The [MIT licence](LICENSE) covers **the source code in this repository only**.

## SAT question content is not covered, and is not distributed here

Questions, answer explanations and figures come from the College Board's
[SAT Suite Question Bank](https://satsuitequestionbank.collegeboard.org) and
remain the property of the College Board.

This project ships **no** question content. Each user exports their own copy for
personal study, and the app data is generated locally on their machine. Both the
PDF exports and everything generated from them are gitignored:

```
question-banks/*.pdf
data/english.js
data/math.js
data/img/
data/save.js
```

**Please don't commit, upload, or publish a fork containing that data.** If you
want to share the project, share the code — anyone can produce their own copy in
a couple of minutes by following [the setup steps](README.md#setup).

## Trademark

SAT® is a trademark registered by the College Board. The College Board is not
affiliated with this project, has not reviewed it, and does not endorse it.

## Third-party services

The Math section embeds the [Desmos](https://www.desmos.com) graphing calculator
from `desmos.com` at runtime, under Desmos's own terms. It is the only part of
the app that reaches the network; everything else works offline.
