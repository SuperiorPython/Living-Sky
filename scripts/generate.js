// generate.js
// Computes what's overhead right now for the current rotating location,
// renders a polar "sky dome" SVG (zenith at center, horizon at the edge),
// and writes it + an updated rotation index back into the repo.

import * as Astronomy from "astronomy-engine";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOCATIONS_PATH = path.join(ROOT, "config/locations.json");
const ROTATION_PATH = path.join(ROOT, "state/rotation.json");
const SVG_PATH = path.join(ROOT, "sky.svg");
const README_PATH = path.join(ROOT, "README.md");

const CENTER = 300;
const R = 260; // horizon radius
const MOON_R = 16;
const PLANET_R = 5;
const SUN_R = 12;

// ---- 1. pick the current location and advance the rotation ----

const locations = JSON.parse(fs.readFileSync(LOCATIONS_PATH, "utf8"));
const rotation = JSON.parse(fs.readFileSync(ROTATION_PATH, "utf8"));
const location = locations[rotation.index % locations.length];
rotation.index = (rotation.index + 1) % locations.length;
fs.writeFileSync(ROTATION_PATH, JSON.stringify(rotation, null, 2) + "\n");

// ---- 2. compute positions ----

const now = new Date();
const time = Astronomy.MakeTime(now);
const observer = new Astronomy.Observer(location.lat, location.lon, 0);

const PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"];

function horizonPosition(bodyName) {
  const body = Astronomy.Body[bodyName];
  // ofdate=true, aberration=true — standard choice for apparent sky position
  const eq = Astronomy.Equator(body, time, observer, true, true);
  const hor = Astronomy.Horizon(time, observer, eq.ra, eq.dec, "normal");
  return { name: bodyName, altitude: hor.altitude, azimuth: hor.azimuth };
}

const sun = horizonPosition("Sun");
const moon = horizonPosition("Moon");
const planets = PLANETS.map(horizonPosition);

// Moon illumination + phase angle
// NOTE: verify locally — Illumination().phase_fraction should be 0 (new) to 1 (full).
const moonIllum = Astronomy.Illumination(Astronomy.Body.Moon, time);
const moonK = moonIllum.phase_fraction; // 0..1 illuminated
// MoonPhase(): 0 = new, 90 = first quarter, 180 = full, 270 = last quarter
const moonPhaseDeg = Astronomy.MoonPhase(time);
const waxing = moonPhaseDeg < 180;

// ---- 3. polar sky-dome projection ----
// altitude 90 (zenith) -> radius 0 (center)
// altitude 0 (horizon)  -> radius R (edge)
// altitude < 0 (below horizon) -> clamp to edge, drawn dimmed
function project(altitude, azimuth) {
  const clampedAlt = Math.max(altitude, 0);
  const r = R * (1 - clampedAlt / 90);
  const az = (azimuth * Math.PI) / 180; // 0 = N, clockwise
  const x = CENTER + r * Math.sin(az);
  const y = CENTER - r * Math.cos(az);
  return { x, y, belowHorizon: altitude < 0 };
}

// ---- 4. shaded moon phase path ----
// Standard two-arc technique: outer limb + terminator ellipse.
// NOTE: verify visually once rendered — waxing/waning sweep direction can
// need flipping depending on hemisphere convention; nudge outerSweep/innerSweep if the
// crescent bulges the wrong way at a known date (e.g. a first-quarter moon).
function moonPhasePath(cx, cy, r, k, isWaxing) {
  const rx = r * Math.abs(1 - 2 * k);
  const outerSweep = isWaxing ? 1 : 0;
  const innerSweep = k < 0.5 ? (isWaxing ? 0 : 1) : isWaxing ? 1 : 0;
  const top = `${cx},${cy - r}`;
  const bottom = `${cx},${cy + r}`;
  return `M${top} A${r},${r} 0 0,${outerSweep} ${bottom} A${rx},${r} 0 0,${innerSweep} ${top} Z`;
}

// ---- 5. label layout (collision-aware) ----
//
// Every body gets a label placed at a default offset above its dot. When
// two or more bodies are close together in the sky (conjunctions happen a
// lot — that's the whole point of tracking planets), those default
// positions collide. Instead of placing labels one-by-one, we:
//   1. compute every dot position first,
//   2. lay out label bounding boxes at their default offsets,
//   3. iteratively push apart any boxes that overlap,
//   4. draw a thin leader line back to the dot for any label that ended up
//      moved noticeably from its default spot.

// Rough average glyph width for the sans-serif label font, in units of
// font-size. Good enough for layout purposes — we don't need pixel-perfect
// text metrics, just enough to detect and resolve overlap.
const AVG_CHAR_WIDTH = 0.6;

function estimateLabelWidth(text, fontSize) {
  return text.length * fontSize * AVG_CHAR_WIDTH;
}

function makeLabel({ name, x, y, dotR, baseOffset, fontSize, color, opacity }) {
  const w = estimateLabelWidth(name, fontSize);
  const h = fontSize * 1.15;
  // y - baseOffset is the text baseline in the *unmoved* layout; convert to
  // a box center so overlap math is symmetric in x and y.
  const baselineY = y - baseOffset;
  return {
    name,
    color,
    fontSize,
    opacity,
    dotX: x,
    dotY: y,
    dotR,
    w,
    h,
    cx: x,
    cy: baselineY - h * 0.35,
    origCx: x,
    origCy: baselineY - h * 0.35,
  };
}

function resolveLabelOverlaps(labels, iterations = 40) {
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const overlapX = (a.w + b.w) / 2 - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          // Resolve along whichever axis has less overlap, so labels slide
          // past each other rather than leapfrogging.
          if (overlapX < overlapY) {
            const shift = overlapX / 2 + 0.5;
            const dir = dx === 0 ? (i < j ? -1 : 1) : Math.sign(dx);
            a.cx -= dir * shift;
            b.cx += dir * shift;
          } else {
            const shift = overlapY / 2 + 0.5;
            // Bias vertical pushes upward (negative y) so labels tend to
            // stack above the cluster rather than drift down into dots.
            const dir = dy === 0 ? -1 : Math.sign(dy);
            a.cy -= dir * shift;
            b.cy += dir * shift;
          }
        }
      }
    }
    if (!moved) break;
  }
}

function finalizeLabel(label) {
  const x = label.cx;
  const baselineY = label.cy + label.h * 0.35;
  const dx = label.cx - label.origCx;
  const dy = label.cy - label.origCy;
  const displaced = Math.hypot(dx, dy) > 3;
  return { x, baselineY, displaced };
}

// ---- 6. render SVG ----

function renderBody({ name, x, y, dotR, fill, fontSize, labelColor, opacity, extraDot }) {
  const { x: lx, baselineY, displaced } = finalizeLabel(name.__label);
  const leader = displaced
    ? `<line x1="${x.toFixed(1)}" y1="${(y - dotR - 2).toFixed(1)}" x2="${lx.toFixed(1)}" y2="${(baselineY + 3).toFixed(1)}" stroke="${labelColor}" stroke-width="0.5" opacity="${(opacity * 0.5).toFixed(2)}"/>`
    : "";
  const dot = extraDot
    ? extraDot
    : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="${fill}" opacity="${opacity}"/>`;
  return `
  ${dot}
  ${leader}
  <text x="${lx.toFixed(1)}" y="${baselineY.toFixed(1)}" font-size="${fontSize}" fill="${labelColor}" opacity="${opacity}" text-anchor="middle" font-family="sans-serif">${name.text}</text>`;
}

function cardinalLabels() {
  const pts = [
    { label: "N", x: CENTER, y: CENTER - R - 14 },
    { label: "E", x: CENTER + R + 16, y: CENTER + 4 },
    { label: "S", x: CENTER, y: CENTER + R + 22 },
    { label: "W", x: CENTER - R - 16, y: CENTER + 4 },
  ];
  return pts
    .map(
      (p) =>
        `<text x="${p.x}" y="${p.y}" font-size="14" fill="#8A8F98" text-anchor="middle" font-family="sans-serif">${p.label}</text>`
    )
    .join("\n  ");
}

// Build the full list of bodies with projected positions, then lay out
// labels for all of them together before drawing anything.
const sunPos = project(sun.altitude, sun.azimuth);
const moonPos = project(moon.altitude, moon.azimuth);
const planetPositions = planets.map((p) => ({ ...p, ...project(p.altitude, p.azimuth) }));

const bodies = [
  {
    text: "Sun",
    x: sunPos.x,
    y: sunPos.y,
    dotR: SUN_R,
    fill: "#F2B33D",
    labelColor: "#F2B33D",
    fontSize: 12,
    baseOffset: 18,
    opacity: sunPos.belowHorizon ? 0.2 : 1,
  },
  {
    text: "Moon",
    x: moonPos.x,
    y: moonPos.y,
    dotR: MOON_R,
    fill: "#2B2E33",
    labelColor: "#C9CDD3",
    fontSize: 12,
    baseOffset: 24,
    opacity: moonPos.belowHorizon ? 0.25 : 1,
    extraDot: `
  <g opacity="${moonPos.belowHorizon ? 0.25 : 1}">
    <circle cx="${moonPos.x.toFixed(1)}" cy="${moonPos.y.toFixed(1)}" r="${MOON_R}" fill="#2B2E33"/>
    <path d="${moonPhasePath(moonPos.x, moonPos.y, MOON_R, moonK, waxing)}" fill="#E8E6DE"/>
    <circle cx="${moonPos.x.toFixed(1)}" cy="${moonPos.y.toFixed(1)}" r="${MOON_R}" fill="none" stroke="#4A4D52" stroke-width="0.75"/>
  </g>`,
  },
  ...planetPositions.map((p) => ({
    text: p.name,
    x: p.x,
    y: p.y,
    dotR: PLANET_R,
    fill: "#7F9FD0",
    labelColor: "#9FB4DE",
    fontSize: 11,
    baseOffset: 10,
    opacity: p.belowHorizon ? 0.25 : 1,
  })),
];

// Attach a label layout object to each body, resolve overlaps as a group,
// then render.
for (const b of bodies) {
  b.__label = makeLabel({
    name: b.text,
    x: b.x,
    y: b.y,
    dotR: b.dotR,
    baseOffset: b.baseOffset,
    fontSize: b.fontSize,
    color: b.labelColor,
    opacity: b.opacity,
  });
}
resolveLabelOverlaps(bodies.map((b) => b.__label));

const bodiesMarkup = bodies
  .map((b) =>
    renderBody({
      name: { text: b.text, __label: b.__label },
      x: b.x,
      y: b.y,
      dotR: b.dotR,
      fill: b.fill,
      fontSize: b.fontSize,
      labelColor: b.labelColor,
      opacity: b.opacity,
      extraDot: b.extraDot,
    })
  )
  .join("\n  ");

const timestamp = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";

const svg = `<svg width="620" height="640" viewBox="0 0 620 640" xmlns="http://www.w3.org/2000/svg">
  <rect width="620" height="640" fill="#0B0D12"/>
  <circle cx="${CENTER}" cy="${CENTER}" r="${R}" fill="#12151C" stroke="#2A2E38" stroke-width="1"/>
  <circle cx="${CENTER}" cy="${CENTER}" r="${R * 0.66}" fill="none" stroke="#1D212B" stroke-width="0.5"/>
  <circle cx="${CENTER}" cy="${CENTER}" r="${R * 0.33}" fill="none" stroke="#1D212B" stroke-width="0.5"/>
  ${cardinalLabels()}
  ${bodiesMarkup}
  <text x="${CENTER}" y="600" font-size="13" fill="#6C7280" text-anchor="middle" font-family="sans-serif">${location.name} — ${timestamp}</text>
  <text x="${CENTER}" y="620" font-size="11" fill="#4A4E58" text-anchor="middle" font-family="sans-serif">zenith at center · horizon at edge · dim = below horizon</text>
</svg>
`;

fs.writeFileSync(SVG_PATH, svg);

// ---- 7. update README caption between markers ----

const captionBlock = `<!--SKY:START-->
![sky](./sky.svg)

_Currently showing: **${location.name}** — ${timestamp}_
<!--SKY:END-->`;

let readme = fs.readFileSync(README_PATH, "utf8");
readme = readme.replace(/<!--SKY:START-->[\s\S]*?<!--SKY:END-->/, captionBlock);
fs.writeFileSync(README_PATH, readme);

console.log(`Rendered sky for ${location.name} at ${timestamp}`);