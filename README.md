# living-sky

A repo that renders tonight's sky and commits it to itself, once an hour, forever.

A GitHub Actions workflow rotates through a list of saved locations, computes the
current positions of the sun, moon (shaded to its real phase), and visible planets
using [`astronomy-engine`](https://github.com/cosinekitty/astronomy), renders a
polar sky-dome SVG, and pushes it straight back into this README. The commit
history is a timelapse of the sky over the year — no server, no database, no
external hosting.

<!--SKY:START-->
![sky](./sky.svg)

_Currently showing: **Tokyo, Japan** — 2026-07-25 12:30 UTC_
<!--SKY:END-->

## How it works

1. `state/rotation.json` tracks which of the `config/locations.json` entries is "current."
2. `scripts/generate.js` computes sky positions for that location and time, renders `sky.svg`, and updates the caption above.
3. `.github/workflows/sky.yml` runs the script every hour and commits the result.

## Running locally

```bash
npm install
node scripts/generate.js
```