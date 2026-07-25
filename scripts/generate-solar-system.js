// generate-solar-system.js
// A second, optional view alongside sky.svg: instead of "what's overhead
// from one spot on Earth right now," this renders the whole solar system
// from above — the Sun at the center, all eight planets at their real
// current heliocentric ecliptic longitude, Saturn's rings, and each
// planet's major moons as small satellites.
//
// Distances are log-scaled (not linear) so the outer planets don't crush
// Mercury and Venus into an unreadable cluster near the Sun — see the
// README note this script adds to the caption.
//
// Moon POSITIONS are illustrative, not computed: getting real orbital
// phase for two dozen individual moons is a lot of orbital-elements work
// for very little visual payoff at this scale. Moon NAMES and which
// planet they belong to are real.

import * as Astronomy from "astronomy-engine";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SVG_PATH = path.join(ROOT, "solar-system.svg");
const README_PATH = path.join(ROOT, "README.md");

const CX = 340;
const CY = 330;
const RMIN = 50;
const RMAX = 260;

const BODIES = [
  { name: "Mercury", size: 3, color: "#9C9C9C", moons: [] },
  { name: "Venus", size: 5, color: "#E8C39E", moons: [] },
  { name: "Earth", size: 5, color: "#4F83CC", moons: ["Moon"] },
  { name: "Mars", size: 4, color: "#C1440E", moons: ["Phobos", "Deimos"] },
  { name: "Jupiter", size: 11, color: "#D8AE82", moons: ["Io", "Europa", "Ganymede", "Callisto"] },
  { name: "Saturn", size: 10, color: "#E0C16C", moons: ["Titan", "Rhea", "Iapetus", "Dione"], rings: true },
  { name: "Uranus", size: 7, color: "#9FD8D8", moons: ["Titania", "Oberon"] },
  { name: "Neptune", size: 7, color: "#4166F5", moons: ["Triton"] },
];

const now = new Date();
const time = Astronomy.MakeTime(now);

// ---- 1. real heliocentric positions ----
// HelioVector gives equatorial J2000 coordinates; Ecliptic() converts that
// to ecliptic longitude/latitude/distance, which is the natural frame for
// a "top down" solar system view since planetary orbits are all close to
// the ecliptic plane.
for (const b of BODIES) {
  const body = Astronomy.Body[b.name];
  const hv = Astronomy.HelioVector(body, time);
  const ecl = Astronomy.Ecliptic(hv);
  b.elongitude = ecl.elon; // degrees, 0-360
  b.distanceAu = Math.hypot(hv.x, hv.y, hv.z);
}

const logs = BODIES.map((b) => Math.log10(b.distanceAu));
const lo = Math.min(...logs);
const hi = Math.max(...logs);
function radiusFor(distanceAu) {
  const t = (Math.log10(distanceAu) - lo) / (hi - lo);
  return RMIN + t * (RMAX - RMIN);
}

function project(r, elongitudeDeg) {
  // 0 deg (vernal equinox direction) drawn pointing up, increasing
  // longitude sweeping clockwise, matching the convention used in sky.svg.
  const a = (elongitudeDeg * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
}

for (const b of BODIES) {
  b.r = radiusFor(b.distanceAu);
  const { x, y } = project(b.r, b.elongitude);
  b.x = x;
  b.y = y;
}

// ---- 2. label layout (collision-aware, same approach as sky.svg) ----

function estimateLabelWidth(text, fontSize) {
  return text.length * fontSize * 0.6;
}

function makeLabel(b, fontSize, baseOffset) {
  const w = estimateLabelWidth(b.name, fontSize);
  const h = fontSize * 1.15;
  const baselineY = b.y - b.size - baseOffset;
  return {
    w,
    h,
    cx: b.x,
    cy: baselineY - h * 0.35,
    origCx: b.x,
    origCy: baselineY - h * 0.35,
  };
}

function resolveOverlaps(items, iterations = 60) {
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const overlapX = (a.w + b.w) / 2 - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          if (overlapX < overlapY) {
            const shift = overlapX / 2 + 0.5;
            const dir = dx === 0 ? (i < j ? -1 : 1) : Math.sign(dx);
            a.cx -= dir * shift;
            b.cx += dir * shift;
          } else {
            const shift = overlapY / 2 + 0.5;
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

function finalize(l) {
  return { x: l.cx, y: l.cy + l.h * 0.35 };
}

const labels = BODIES.map((b) => makeLabel(b, 12, 8));
resolveOverlaps(labels);

// ---- 3. render SVG ----

let body = "";
for (const b of BODIES) {
  body += `<circle class="orbit" cx="${CX}" cy="${CY}" r="${b.r.toFixed(1)}"/>\n`;
}

body += `<circle cx="${CX}" cy="${CY}" r="16" fill="#F2B33D"/>\n`;
body += `<text class="lbl" x="${CX}" y="${CY + 32}" text-anchor="middle">Sun</text>\n`;

BODIES.forEach((b, i) => {
  const lab = finalize(labels[i]);

  if (b.rings) {
    body += `<ellipse cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" rx="${(b.size * 2.1).toFixed(1)}" ry="${(b.size * 0.6).toFixed(1)}" fill="none" stroke="#C9A96E" stroke-width="1.5" opacity="0.8"/>\n`;
  }

  body += `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.size}" fill="${b.color}"/>\n`;

  if (b.moons.length) {
    const moonOrbitR = b.size + 6;
    body += `<circle class="moonorbit" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${moonOrbitR}"/>\n`;
    const step = 360 / b.moons.length;
    b.moons.forEach((m, mi) => {
      const ang = (mi * step + 40) * (Math.PI / 180);
      const mx = b.x + moonOrbitR * Math.sin(ang);
      const my = b.y - moonOrbitR * Math.cos(ang);
      body += `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="1.4" fill="#C9CDD3"/>\n`;
    });
    const moonList = b.moons.join(", ");
    const moonLabelY = b.y + moonOrbitR + 12;
    body += `<text class="moonlbl" x="${b.x.toFixed(1)}" y="${moonLabelY.toFixed(1)}" text-anchor="middle">${moonList}</text>\n`;
  }

  body += `<text class="lbl" x="${lab.x.toFixed(1)}" y="${lab.y.toFixed(1)}" text-anchor="middle">${b.name}</text>\n`;
});

const timestamp = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";

const svg = `<svg width="680" height="640" viewBox="0 0 680 640" xmlns="http://www.w3.org/2000/svg" role="img">
<title>Solar system, viewed from above</title>
<desc>Sun-centered diagram with all eight planets at their current real ecliptic longitude, Saturn's rings, and major moons shown as small satellites.</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
<style>
  .orbit { fill: none; stroke: #2A2E38; stroke-width: 0.5; stroke-dasharray: 2 3; }
  .moonorbit { fill: none; stroke: #2A2E38; stroke-width: 0.4; stroke-dasharray: 1 2; }
  .lbl { font-family: sans-serif; font-size: 12px; fill: #9FB4DE; }
  .moonlbl { font-family: sans-serif; font-size: 10px; fill: #6C7280; }
</style>
<rect width="680" height="640" fill="#0B0D12"/>
${body}
<text x="340" y="608" font-size="13" fill="#6C7280" text-anchor="middle" font-family="sans-serif">Solar system — ${timestamp}</text>
<text x="340" y="626" font-size="11" fill="#4A4E58" text-anchor="middle" font-family="sans-serif">real ecliptic longitude · distance log-scaled · moon positions illustrative</text>
</svg>
`;

fs.writeFileSync(SVG_PATH, svg);

// ---- 4. update README between markers ----

const captionBlock = `<!--SOLAR:START-->
![solar system](./solar-system.svg)

_Solar system, viewed from above — **${timestamp}**. Planet angles are real (ecliptic longitude); distances are log-scaled so the outer planets stay on the page._
<!--SOLAR:END-->`;

let readme = fs.readFileSync(README_PATH, "utf8");
if (readme.includes("<!--SOLAR:START-->")) {
  readme = readme.replace(/<!--SOLAR:START-->[\s\S]*?<!--SOLAR:END-->/, captionBlock);
} else {
  // First run: append a new section after the sky caption block.
  readme = readme.replace(
    /(<!--SKY:END-->)/,
    `$1\n\n## Solar system view (optional)\n\n${captionBlock}`
  );
}
fs.writeFileSync(README_PATH, readme);

console.log(`Rendered solar system at ${timestamp}`);