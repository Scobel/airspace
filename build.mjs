// YYZ terminal airspace trainer: a full-screen Three.js view with a chip panel.
// Data: data/data.json from prep.py (NAV CANADA DAH airspace, OurAirports runways, Natural Earth lakes,
// ADS-B Exchange sample-day traces for 2026-10-01).
import { writeFileSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ISO_CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vendor", "iso.css"), "utf8");

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";
const DATA = JSON.parse(readFileSync(join(HERE, "data", "data.json"), "utf8"));
const stats = DATA.stats;

// Layers: id, label, one-line meaning, default on, group. The page renders one chip per layer.
const LAYERS = [
  // id, label, meaning, default, group
  ["tca", "TCA steps", "The Toronto Terminal Control Area, Class C: an upside-down wedding cake. Each floor is where controlled airspace starts at that distance from the Toronto VOR; the walls are the outer edge of each step. Use the Highlight steps chips to light one or more.", true, "airspace"],
  ["cz", "Control zones", "The Pearson control zone, 7 NM around the airport from the surface to 2,500 ft, and the Billy Bishop zone.", true, "airspace"],
  ["tcalabels", "Altitude labels", "Floor and ceiling of each step, in feet above sea level.", true, "airspace"],
  ["runways", "Airport layout", "Pearson and Billy Bishop at true size from OpenStreetMap: runways 200 ft wide with centrelines, every taxiway at its width, aprons, terminals, hangars and the tower. Runway idents at the thresholds from OurAirports. 24L and 24R centrelines are 1,000 ft apart; 33L and 33R 3,350 ft. Small hexagons are the YYZ and YTP VOR-DMEs.", true, "map"],
  ["lakes", "Lakes", "Lake Ontario, Simcoe and Erie shorelines.", true, "map"],
  ["rings", "Range rings", "Rings every 10 NM from the Toronto VOR and bearing ticks every 5° around the 50 NM edge, true north up.", true, "map"],
  ["arrivals", "Arrivals", "Flights that end on a Pearson runway: " + stats.by_cat.arrival + " on this day.", true, "traffic"],
  ["departures", "Departures", "Flights that start on a Pearson runway: " + stats.by_cat.departure + ".", true, "traffic"],
  ["overflights", "Overflights", "Flights that cross the area without landing at Pearson: " + stats.by_cat.overflight + ".", true, "traffic"],
  ["ytz", "Billy Bishop", "Arrivals and departures at Toronto City airport: " + (stats.by_cat["ytz-arrival"] + stats.by_cat["ytz-departure"]) + ".", true, "traffic"],
  ["ground", "On ground", "Taxiing aircraft, drawn small.", true, "traffic"],
  ["trails", "Trails", "Where each aircraft has just been. Gaps in receiver coverage are left blank, not bridged.", true, "overlay"],
  ["stems", "Height stems", "A line from each aircraft straight down to its shadow on the board, so height reads. Not a flight path.", true, "overlay"],
  ["alltracks", "All-day tracks", "Every flight path of 1 October 2026 at once, by category. Shows the arrival downwinds, bases and finals and the departure fans.", false, "overlay"],
  ["datablocks", "Data block", "Callsign, type, altitude in hundreds of feet, ground speed and runway. Tap an aircraft; tap it twice to follow it.", true, "overlay"],
  ["alllabels", "All callsigns", "A tag on every airborne aircraft. Busy at peak times.", false, "overlay"],
];
const STEPS = DATA.airspace.map((a, i) => ({ i, name: a.name, floor: a.floor_ft, ceiling: a.ceiling_ft }));

const APP = String.raw`
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const stage = document.querySelector("#stage");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (s) => document.querySelector(s);
const ui = { play: $("[data-play]"), speed: $("[data-speed]"), time: $("[data-time]"), clock: $("[data-clock]"), panel: $("#panel"), menu: $("[data-menu]"), info: $("#info"), infoBody: $("#info .body"), infoTitle: $("#info h3") };
// One state object drives everything. Chips carry data-chip="kind:value".
const state = { layer: {}, scale: "3.3", view: "area", hl: {} };
document.querySelectorAll('[data-chip^="layer:"]').forEach((el) => { state.layer[el.dataset.chip.slice(6)] = el.hasAttribute("data-on"); });
const on = (id) => !!state.layer[id];
function paintChips() {
  document.querySelectorAll("[data-chip]").forEach((el) => {
    const [kind, value] = el.dataset.chip.split(":");
    const active = kind === "layer" ? on(value) : kind === "hl" ? !!state.hl[value] : state[kind] === value;
    el.setAttribute("aria-pressed", active ? "true" : "false");
  });
}
const css = getComputedStyle(document.body);
const tok = (name) => new THREE.Color(css.getPropertyValue(name).trim());
const T = {
  paper: tok("--anatomy-paper"), face: tok("--anatomy-face"), top: tok("--anatomy-top"),
  s0: tok("--anatomy-shade-0"), s1: tok("--anatomy-shade-1"), s2: tok("--anatomy-shade-2"), s3: tok("--anatomy-shade-3"),
  litTop: tok("--anatomy-lit-top"), litShade: tok("--anatomy-lit-shade"),
  hi: tok("--anatomy-hi"), mid: tok("--anatomy-mid"), lo: tok("--anatomy-lo"), faint: tok("--anatomy-faint"), lit: tok("--anatomy-lit"), blue: tok("--anatomy-blue"),
};
const isLight = document.body.dataset.theme === "light";

// 1 unit = 1 NM. Heights: VEX units per 1,000 ft (true scale is 0.1646). The air group is scaled for the height switch.
const VEX = 0.55, TRUE_VEX = 0.1646;
// Altitudes in the data and the handbook are above sea level. The board surface is the airport, 569 ft above sea level
// (CYYZ elevation), so every height is measured from there. A reading below field level (pressure error) sits on the board.
const FIELD_FT = 569;
const ft = (h) => (Math.max(0, h - FIELD_FT) / 1000) * VEX;
const R_BOARD = 50;
const GAP_S = 120;   // a trace gap longer than this is receiver loss: not bridged

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = "labels";
stage.appendChild(labelRenderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2000);
const TH24R = { x: 1.49, y: 1.26 };   // 24R threshold, east and north of the Toronto VOR in NM (OurAirports)
const VIEWS = {
  area: { az: 50, el: 34, dist: 112, target: new THREE.Vector3(0, 2, 0) },
  airport: { az: 35, el: 42, dist: 5.5, target: new THREE.Vector3(0.1, 0.05, -1.15) },
  runway: { az: 315, el: 5, dist: 1.1, target: new THREE.Vector3(TH24R.x + 0.37, 0.05, -(TH24R.y + 0.34)) },   // on 24R looking up the approach
  final24: { az: 318, el: 11, dist: 7, target: new THREE.Vector3(TH24R.x + 2.2, 0.5, -(TH24R.y + 2.05)) },   // 3 NM final to 24R, seen from behind the threshold
  side: { az: 180, el: 6, dist: 110, target: new THREE.Vector3(0, 3, 0) },
  top: { az: 0, el: 89, dist: 120, target: new THREE.Vector3(0, 0, 0) },
  tower: { az: 128, el: 2.5, dist: 7, target: new THREE.Vector3(1.6, 0.35, -2.4) },
};
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 1.5; controls.maxDistance = 320;
controls.minPolarAngle = 0.02; controls.maxPolarAngle = Math.PI * 0.53;   // a little below the orbit centre, so you can look up from the ground
controls.screenSpacePanning = true;                                         // right-drag, shift-drag or two fingers move the orbit centre, up and down too
controls.autoRotateSpeed = 0.25;
function placeCamera({ az, el, dist, target }) {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  camera.position.set(target.x + dist * Math.cos(e) * Math.sin(a), target.y + dist * Math.sin(e), target.z + dist * Math.cos(e) * Math.cos(a));
  controls.target.copy(target); controls.update();
}
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h); labelRenderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
resize(); placeCamera(VIEWS.area);

// ---------------------------------------------------------------- four-tone material
const LIGHT = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();
function fourTone(tones, top) {
  return new THREE.ShaderMaterial({
    uniforms: { t0: { value: tones[0] }, t1: { value: tones[1] }, t2: { value: tones[2] }, t3: { value: tones[3] }, top: { value: top }, L: { value: LIGHT } },
    vertexShader: "varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: "uniform vec3 t0,t1,t2,t3,top,L; varying vec3 vP; void main(){ vec3 n = normalize(cross(dFdx(vP), dFdy(vP))); if(!gl_FrontFacing) n = -n; vec3 c; if(n.y > 0.75) c = top; else { float f = clamp(dot(n,L)*0.5+0.5, 0.0, 0.999); int b = int(floor(f*4.0)); c = b==0 ? t0 : b==1 ? t1 : b==2 ? t2 : t3; } gl_FragColor = vec4(c, 1.0); }",
  });
}
const MAT = { lo: fourTone([T.s0, T.s0, T.s1, T.s1], T.s2), mid: fourTone([T.s0, T.s1, T.s2, T.s3], T.top), hi: fourTone([T.s1, T.s2, T.s3, T.litShade], T.litTop) };
const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
const LINE = { hi: lineMat(T.hi), mid: lineMat(T.mid), lo: lineMat(T.lo), faint: lineMat(T.faint), lit: lineMat(T.lit) };
function edges(geo, mat, angle = 20) { return new THREE.LineSegments(new THREE.EdgesGeometry(geo, angle), mat); }
function solid(geo, tone, edgeTone = "lo", angle = 20) { const g = new THREE.Group(); g.add(new THREE.Mesh(geo, MAT[tone])); if (edgeTone) g.add(edges(geo, LINE[edgeTone], angle)); return g; }
const tag = (text, cls) => { const el = document.createElement("div"); el.className = cls; el.textContent = text; return new CSS2DObject(el); };

// ---------------------------------------------------------------- groups per layer
const bench = new THREE.Group(); scene.add(bench);
const air = new THREE.Group(); bench.add(air);                 // everything with a height: scaled for the height switch
const G = {};
for (const id of ["tca", "cz", "tcalabels", "runways", "lakes", "rings", "alltracks"]) { G[id] = new THREE.Group(); (["tca", "cz", "tcalabels", "alltracks"].includes(id) ? air : bench).add(G[id]); }

const plateG = solid(new THREE.BoxGeometry(124, 2.2, 124), "mid", "lo"); plateG.position.y = -2.4; bench.add(plateG);
for (const [x, z] of [[-52, -52], [52, -52], [-52, 52], [52, 52]]) { const f = solid(new THREE.CylinderGeometry(2.6, 2.6, 1.4, 24), "lo", "lo", 60); f.position.set(x, -4.2, z); bench.add(f); }
const board = solid(new THREE.CylinderGeometry(R_BOARD, R_BOARD, 1.3, 240), "mid", "lo", 60); board.position.y = -0.65; bench.add(board);
{
  const pts = [];
  for (let d = 0; d < 360; d += 5) {
    const major = d % 30 === 0, len = major ? 2.6 : 1.3, a = (d * Math.PI) / 180;
    pts.push(new THREE.Vector3(Math.sin(a) * (R_BOARD - 0.4), 0.02, -Math.cos(a) * (R_BOARD - 0.4)), new THREE.Vector3(Math.sin(a) * (R_BOARD - 0.4 - len), 0.02, -Math.cos(a) * (R_BOARD - 0.4 - len)));
  }
  G.rings.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), LINE.mid));
  const ring = (r, y, mat) => { const p = []; for (let i = 0; i <= 240; i++) { const a = (i / 240) * Math.PI * 2; p.push(new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * r)); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), mat); };
  G.rings.add(ring(R_BOARD - 3.4, 0.02, LINE.lo));
  for (const r of [10, 20, 30, 40]) { G.rings.add(ring(r, 0.015, LINE.faint)); const t = tag(r + " NM", "mark"); t.position.set(r * Math.sin(2.3), 0.3, -r * Math.cos(2.3)); G.rings.add(t); }
  const n = tag("N", "mark"); n.position.set(0, 0.4, -R_BOARD - 1.5); G.rings.add(n);
}

// ---------------------------------------------------------------- data
const DATA = await fetch("data.json").then((r) => r.json()).catch(() => null);
if (!DATA) { readout.textContent = "data.json missing"; throw new Error("no data"); }
const toV = (e, n, y = 0) => new THREE.Vector3(e, y, -n);

for (const lake of DATA.lakes) {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(lake.ring.map(([e, n]) => new THREE.Vector2(e, n))), 1);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: isLight ? T.s3 : T.s0, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; G.lakes.add(m);
  G.lakes.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(lake.ring.map(([e, n]) => toV(e, n, 0.05))), LINE.lo));
  const c = lake.ring.reduce((a, p) => [a[0] + p[0] / lake.ring.length, a[1] + p[1] / lake.ring.length], [0, 0]);
  const t = tag(lake.name, "mark"); t.position.set(c[0], 0.2, -c[1]); G.lakes.add(t);
}

// Airspace: each step is drawn as its floor (a translucent sheet) and its outer wall. No top sheets, so the
// stack reads as an upside-down wedding cake. The highest step also gets its ceiling outline.
const steps = [];
const invisible = new THREE.MeshBasicMaterial({ visible: false });
DATA.airspace.forEach((a, index) => {
  const isCZ = a.name.includes("CZ");
  const shape = new THREE.Shape(a.polygon.map(([e, n]) => new THREE.Vector2(e, n)));
  const depth = ft(a.ceiling_ft) - ft(a.floor_ft);
  const floorMat = new THREE.MeshBasicMaterial({ color: isCZ ? T.mid : T.hi, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const wallMat = new THREE.MeshBasicMaterial({ color: T.hi, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false });
  const edgeMat = lineMat(isCZ ? T.mid : T.lo);
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape, 1), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = ft(a.floor_ft) + 0.02; floor.renderOrder = 2;
  const prism = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  const wall = new THREE.Mesh(prism, [invisible, wallMat]); wall.rotation.x = -Math.PI / 2; wall.position.y = ft(a.floor_ft) + 0.02; wall.renderOrder = 3;
  const e = edges(prism, edgeMat, 28); e.rotation.x = -Math.PI / 2; e.position.y = ft(a.floor_ft) + 0.02;
  const group = new THREE.Group(); group.add(floor, wall, e);
  (isCZ ? G.cz : G.tca).add(group);
  let far = a.polygon[0], fd = 0;
  for (const p of a.polygon) { const d = Math.hypot(p[0], p[1]); if (d > fd) { fd = d; far = p; } }
  const lab = tag((a.floor_ft ? a.floor_ft.toLocaleString() : "surface") + " to " + a.ceiling_ft.toLocaleString() + " ft" + (isCZ ? " · " + a.name : ""), "alt");
  lab.position.set(far[0], ft(a.floor_ft) + 0.15, -far[1]); G.tcalabels.add(lab);
  steps.push({ index, isCZ, floorMat, wallMat, edgeMat, lab });
});
function highlightStep(set) {
  const any = Object.values(set).some(Boolean);
  for (const s of steps) {
    const pick = any ? !!set[s.index] : null;
    s.floorMat.opacity = pick === null ? 0.1 : pick ? 0.3 : 0.03;
    s.wallMat.opacity = pick === null ? 0.035 : pick ? 0.14 : 0.01;
    s.floorMat.color.copy(pick ? T.lit : s.isCZ ? T.mid : T.hi);
    s.wallMat.color.copy(pick ? T.lit : T.hi);
    s.edgeMat.color.copy(pick ? T.hi : pick === null ? (s.isCZ ? T.mid : T.lo) : T.faint);
    s.lab.element.classList.toggle("picked", !!pick);
    s.lab.visible = pick === null || pick;
  }
}
// ---------------------------------------------------------------- airport layout (OpenStreetMap)
// Flat ribbons for runways and taxiways at their true width, aprons as sheets, terminals and hangars as low blocks.
function ribbon(pts, widthNm, y) {
  const positions = [];
  const half = widthNm / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * half, ny = dx / L * half;
    const a1 = [ax + nx, ay + ny], a2 = [ax - nx, ay - ny], b1 = [bx + nx, by + ny], b2 = [bx - nx, by - ny];
    positions.push(a1[0], y, -a1[1], b1[0], y, -b1[1], a2[0], y, -a2[1], a2[0], y, -a2[1], b1[0], y, -b1[1], b2[0], y, -b2[1]);
    if (i > 1) { // round the joint with a small fan
      const [px, py] = pts[i - 2]; const pdx = ax - px, pdy = ay - py, pL = Math.hypot(pdx, pdy) || 1; const pnx = -pdy / pL * half, pny = pdx / pL * half;
      positions.push(ax, y, -ay, ax + pnx, y, -(ay + pny), ax + nx, y, -(ay + ny), ax, y, -ay, ax - nx, y, -(ay - ny), ax - pnx, y, -(ay - pny));
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); return g;
}
const AP = DATA.airport || { runways: [], taxiways: [], aprons: [], buildings: [], towers: [], helipads: [] };
const M_NM = 1 / 1852;
const apronMat = new THREE.MeshBasicMaterial({ color: isLight ? T.s3 : T.s1, side: THREE.DoubleSide });
const taxiMat = new THREE.MeshBasicMaterial({ color: isLight ? T.lo : T.s3, side: THREE.DoubleSide });
const rwyMat = new THREE.MeshBasicMaterial({ color: isLight ? T.mid : T.hi, side: THREE.DoubleSide });
for (const a of AP.aprons) {
  if (a.ring.length < 3) continue;
  const geo = new THREE.ShapeGeometry(new THREE.Shape(a.ring.map(([e, n]) => new THREE.Vector2(e, n))), 1);
  const m = new THREE.Mesh(geo, apronMat); m.rotation.x = -Math.PI / 2; m.position.y = 0.035; G.runways.add(m);
  G.runways.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(a.ring.map(([e, n]) => toV(e, n, 0.045))), LINE.faint));
}
for (const t of AP.taxiways) G.runways.add(new THREE.Mesh(ribbon(t.pts, t.width_m * M_NM, 0.04), taxiMat));
for (const r of AP.runways) {
  G.runways.add(new THREE.Mesh(ribbon(r.pts, r.width_m * M_NM, 0.05), rwyMat));
  G.runways.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(r.pts.map(([e, n]) => toV(e, n, 0.07))), LINE.lo));   // centreline
}
for (const b of AP.buildings) {
  if (b.ring.length < 3) continue;
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(b.ring.map(([e, n]) => new THREE.Vector2(e, n))), { depth: b.kind === "terminal" ? 0.012 : 0.008, bevelEnabled: false, curveSegments: 1 });
  const g = solid(geo, "mid", "lo", 30); g.rotation.x = -Math.PI / 2; g.position.y = 0.04; G.runways.add(g);
}
for (const h of AP.helipads) {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(h.ring.map(([e, n]) => new THREE.Vector2(e, n))), 1);
  const m = new THREE.Mesh(geo, rwyMat); m.rotation.x = -Math.PI / 2; m.position.y = 0.05; G.runways.add(m);
}
for (const t of AP.towers) { const g = solid(new THREE.CylinderGeometry(0.012, 0.016, 0.05, 12), "hi", "lo", 40); g.position.copy(toV(t.pos[0], t.pos[1], 0.065)); G.runways.add(g); }
// Runway idents at the thresholds (OurAirports), and the VOR-DMEs as small hexagonal pucks beside the field.
for (const r of DATA.runways) {
  if (!AP.runways.length) {   // fallback when the OpenStreetMap layout is missing
    const [e1, n1] = r.le.pos, [e2, n2] = r.he.pos;
    const len = Math.hypot(e2 - e1, n2 - n1), ang = Math.atan2(e2 - e1, n2 - n1);
    const g = solid(new THREE.BoxGeometry((r.width_ft || 200) / 6076, 0.05, len), "hi", "hi");
    g.position.copy(toV((e1 + e2) / 2, (n1 + n2) / 2, 0.04)); g.rotation.y = -ang; G.runways.add(g);
  }
  for (const end of [r.le, r.he]) { const t = tag(end.id, "rwy"); t.position.copy(toV(end.pos[0], end.pos[1], 0.25)); G.runways.add(t); }
}
for (const nav of DATA.navaids) {
  if (nav.type !== "VOR-DME") continue;
  const g = solid(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 6), "mid", "mid", 40); g.position.copy(toV(nav.pos[0], nav.pos[1], 0.055)); G.runways.add(g);
  const t = tag(nav.id, "rwy"); t.position.copy(toV(nav.pos[0], nav.pos[1], 0.14)); G.runways.add(t);
}
const nearTags = []; G.runways.traverse((o) => { if (o.isCSS2DObject) nearTags.push(o); });

// ---------------------------------------------------------------- flights
const F = DATA.flights;
const CAT_COLOR = { arrival: T.hi, departure: T.mid, overflight: T.lo, "ytz-arrival": T.lo, "ytz-departure": T.lo };
const CAT_LAYER = { arrival: "arrivals", departure: "departures", overflight: "overflights", "ytz-arrival": "ytz", "ytz-departure": "ytz" };
const allTracks = {};
for (const cat of Object.keys(CAT_COLOR)) {
  const pos = [], c = CAT_COLOR[cat];
  for (const f of F) {
    if (f.cat !== cat) continue;
    for (let i = 1; i < f.pts.length; i++) {
      const a = f.pts[i - 1], b = f.pts[i];
      if (a[6] || b[6] || b[0] - a[0] > GAP_S || Math.hypot(b[1] - a[1], b[2] - a[2]) > 4) continue;   // coverage gaps are not drawn
      pos.push(a[1], ft(a[3]), -a[2], b[1], ft(b[3]), -b[2]);
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: isLight ? 0.3 : 0.28, depthWrite: false }));
  allTracks[cat] = l; G.alltracks.add(l);
}
const MAXN = 220;
// Arrow glyph: nose toward +z in local space; heading h turns it with rotation.y = PI - h (north is -z, east +x).
const glyphGeo = (() => { const s = new THREE.Shape(); s.moveTo(0, -0.55); s.lineTo(0.34, 0.42); s.lineTo(0, 0.22); s.lineTo(-0.34, 0.42); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -0.05, 0); return g; })();
const glyphs = new THREE.InstancedMesh(glyphGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAXN);
glyphs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); glyphs.count = 0; air.add(glyphs);
const shadowGeo = new THREE.CircleGeometry(0.22, 16); shadowGeo.rotateX(-Math.PI / 2);
const shadows = new THREE.InstancedMesh(shadowGeo, new THREE.MeshBasicMaterial({ color: isLight ? T.lo : T.s0, transparent: true, opacity: 0.6, depthWrite: false }), MAXN);
shadows.count = 0; bench.add(shadows);
const TRAIL_S = 240, TRAIL_SEG = 32;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(MAXN * TRAIL_SEG * 6), 3).setUsage(THREE.DynamicDrawUsage));
trailGeo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(MAXN * TRAIL_SEG * 6), 3).setUsage(THREE.DynamicDrawUsage));
const trails = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })); air.add(trails);
const stemGeo = new THREE.BufferGeometry();
stemGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(MAXN * 6), 3).setUsage(THREE.DynamicDrawUsage));
const stems = new THREE.LineSegments(stemGeo, new THREE.LineBasicMaterial({ color: T.lo, transparent: true, opacity: 0.35 })); air.add(stems);
const labelEl = document.createElement("div"); labelEl.className = "datablock";
const label = new CSS2DObject(labelEl); label.visible = false; air.add(label);
const tags = [];
for (let i = 0; i < MAXN; i++) { const t = tag("", "cs"); t.visible = false; air.add(t); tags.push(t); }

function sample(f, t) {
  const p = f.pts; let lo = 0, hi = p.length - 1;
  if (t <= p[0][0] || t >= p[hi][0]) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] <= t) lo = m; else hi = m; }
  const a = p[lo], b = p[hi];
  if (b[0] - a[0] > GAP_S) return null;                       // inside a coverage gap: the aircraft is not shown
  const u = (t - a[0]) / Math.max(1, b[0] - a[0]);
  const e = a[1] + (b[1] - a[1]) * u, n = a[2] + (b[2] - a[2]) * u, alt = a[3] + (b[3] - a[3]) * u;
  const de = b[1] - a[1], dn = b[2] - a[2];
  const hdg = Math.hypot(de, dn) > 0.01 ? (Math.atan2(de, dn) * 180) / Math.PI : a[5];
  return { e, n, alt, gs: a[4], hdg: (hdg + 360) % 360, ground: a[6] && b[6] };
}

// ---------------------------------------------------------------- replay
let time = 15 * 3600, playing = !still.matches, speed = 5, selected = null, hovered = null, tracking = null;
const followOffset = new THREE.Vector3();
let touring = !still.matches, idleTimer = 0, frame = 0, last = 0;
const fmt = (s) => { s = ((s % 86400) + 86400) % 86400; return String(Math.floor(s / 3600)).padStart(2, "0") + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0") + "Z"; };
const active = [];
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), color = new THREE.Color();
function runwaysInUse(t, cat) {
  const counts = {};
  for (const f of F) { if (f.cat !== cat || !f.rwy) continue; const when = cat === "arrival" ? f.t1 : f.t0; if (Math.abs(when - t) <= 1800) counts[f.rwy] = (counts[f.rwy] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => r).join("/") || "—";
}
function applyLayers() {
  for (const id of Object.keys(G)) G[id].visible = on(id);
  for (const cat in allTracks) allTracks[cat].visible = on(CAT_LAYER[cat]);
  trails.visible = on("trails"); stems.visible = on("stems"); shadows.visible = on("stems");
  air.scale.y = (Number(state.scale) * TRUE_VEX) / VEX;
  highlightStep(state.hl);
  paintChips();
}
let glyphK = 1;   // glyphs shrink as the camera comes in, so they never dwarf the airport
function update() {
  glyphK = Math.min(1, Math.max(0.12, camera.position.distanceTo(controls.target) / 40));
  active.length = 0;
  let n = 0, tcount = 0;
  const tp = trailGeo.attributes.position.array, tc = trailGeo.attributes.color.array, sp = stemGeo.attributes.position.array;
  for (const f of F) {
    if (time < f.t0 || time > f.t1 || !on(CAT_LAYER[f.cat])) continue;
    const s = sample(f, time);
    if (!s || n >= MAXN) continue;
    if (s.ground && !on("ground")) continue;
    active.push({ f, s, idx: n });
    const y = s.ground ? 0.08 : ft(s.alt);
    v3.set(s.e, y, -s.n); q.setFromAxisAngle(up, Math.PI - (s.hdg * Math.PI) / 180);
    const size = (s.ground ? 0.3 : 0.52) * glyphK; sc.set(size, size / air.scale.y, size);
    m4.compose(v3, q, sc); glyphs.setMatrixAt(n, m4);
    const isSel = selected === f, isHov = hovered === f;
    color.copy(isSel ? T.lit : isHov ? T.hi : CAT_COLOR[f.cat] || T.lo); glyphs.setColorAt(n, color);
    m4.compose(v3.set(s.e, 0.04, -s.n), q.identity(), sc.set(glyphK, 1, glyphK)); shadows.setMatrixAt(n, m4);
    sp[n * 6] = s.e; sp[n * 6 + 1] = 0.04; sp[n * 6 + 2] = -s.n; sp[n * 6 + 3] = s.e; sp[n * 6 + 4] = y; sp[n * 6 + 5] = -s.n;
    const c = isSel ? T.lit : CAT_COLOR[f.cat] || T.lo;
    let prev = null;
    for (let k = 0; k <= TRAIL_SEG; k++) {
      const tt = time - TRAIL_S + (TRAIL_S * k) / TRAIL_SEG;
      let ss = tt <= f.t0 ? null : sample(f, tt);
      if (k === TRAIL_SEG) ss = s;
      if (ss && prev && !(ss.ground && prev.ground) && Math.hypot(ss.e - prev.e, ss.n - prev.n) < 4) {
        const o = tcount * 6;
        tp[o] = prev.e; tp[o + 1] = prev.ground ? 0.08 : ft(prev.alt); tp[o + 2] = -prev.n; tp[o + 3] = ss.e; tp[o + 4] = ss.ground ? 0.08 : ft(ss.alt); tp[o + 5] = -ss.n;
        const fade = 0.15 + 0.85 * (k / TRAIL_SEG);
        tc[o] = c.r * fade; tc[o + 1] = c.g * fade; tc[o + 2] = c.b * fade; tc[o + 3] = c.r * fade; tc[o + 4] = c.g * fade; tc[o + 5] = c.b * fade;
        tcount++;
      }
      prev = ss;
    }
    const t = tags[n];
    if (on("alllabels") && !s.ground) { t.visible = true; t.position.set(s.e, y + 0.3, -s.n); if (t.element.textContent !== f.cs) t.element.textContent = f.cs; } else t.visible = false;
    n++;
  }
  for (let i = n; i < MAXN; i++) tags[i].visible = false;
  glyphs.count = n; shadows.count = n;
  glyphs.instanceMatrix.needsUpdate = true; if (glyphs.instanceColor) glyphs.instanceColor.needsUpdate = true; shadows.instanceMatrix.needsUpdate = true;
  trailGeo.setDrawRange(0, tcount * 2); trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
  stemGeo.setDrawRange(0, n * 2); stemGeo.attributes.position.needsUpdate = true;
  const pick = selected || hovered;
  const row = pick && active.find((a) => a.f === pick);
  if (row && on("datablocks")) {
    const s = row.s;
    label.position.set(s.e, (s.ground ? 0.08 : ft(s.alt)) + 0.9, -s.n);
    const alt = s.ground ? "GND" : String(Math.round(s.alt / 100)).padStart(3, "0");
    const txt = row.f.cs + " " + (row.f.type || "") + "<br>" + alt + " " + String(Math.round(s.gs)).padStart(3, "0") + (row.f.cat === "arrival" ? " ↓" + (row.f.rwy || "") : row.f.cat === "departure" ? " ↑" + (row.f.rwy || "") : "") + "<br><span>" + row.f.cat.replace("ytz-", "Billy Bishop ") + "</span>";
    if (labelEl.innerHTML !== txt) labelEl.innerHTML = txt;
    label.visible = true;
  } else label.visible = false;
  window.__yyz = { active, glyphs, screen: (() => { const a = active.find((x) => !x.s.ground && x.f.cat === 'arrival'); if (!a) return null; const box = renderer.domElement.getBoundingClientRect(); v3.set(a.s.e, ft(a.s.alt) * air.scale.y, -a.s.n).project(camera); return { cs: a.f.cs, x: box.left + (v3.x + 1) / 2 * box.width, y: box.top + (1 - v3.y) / 2 * box.height }; })() };
  const airborne = active.filter((a) => !a.s.ground).length;
  const text = (tracking ? "following " + tracking.cs + " · " : "") + fmt(time) + " · " + airborne + " airborne · arr " + runwaysInUse(time, "arrival") + " · dep " + runwaysInUse(time, "departure");
  if (readout.textContent !== text) readout.textContent = text;
  ui.clock.textContent = fmt(time);
  if (document.activeElement !== ui.time) ui.time.value = String(Math.round(time));
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60; last = now;
  if (playing) { time += dt * speed; if (time >= 86400) time -= 86400; }
  if (tracking) {
    const row = active.find((a) => a.f === tracking);
    if (!row) tracking = null;
    else {
      const s = row.s;
      v3.set(s.e, (s.ground ? 0.08 : ft(s.alt)) * air.scale.y, -s.n);
      followOffset.copy(camera.position).sub(controls.target);
      const k = 1 - Math.exp(-dt / 0.35);                                   // the orbit centre eases onto the aircraft
      controls.target.lerp(v3, k);
      if (followOffset.length() > 14) followOffset.setLength(followOffset.length() + (14 - followOffset.length()) * (1 - Math.exp(-dt / 1.2)));   // and the camera eases in to 14 NM
      camera.position.copy(controls.target).add(followOffset);
    }
  }
  controls.autoRotate = touring && !still.matches && !tracking; controls.update();
  if (camera.position.y < 0.06) { camera.position.y = 0.06; camera.lookAt(controls.target); }   // the ground is the floor
  const close = camera.position.distanceTo(controls.target) < 48;
  for (const t of nearTags) t.visible = close;
  update(); renderer.render(scene, camera); labelRenderer.render(scene, camera);
  frame = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- input
const touch = () => { touring = false; clearTimeout(idleTimer); idleTimer = setTimeout(() => { touring = !still.matches; }, 20000); };
controls.addEventListener("start", touch);
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function pickAt(ev) {
  const box = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - box.left) / box.width) * 2 - 1, -((ev.clientY - box.top) / box.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(glyphs);
  if (hits.length) { const row = active[hits[0].instanceId]; if (row) return row.f; }
  let best = null, bd = 18;
  for (const a of active) {
    v3.set(a.s.e, (a.s.ground ? 0.08 : ft(a.s.alt)) * air.scale.y, -a.s.n).project(camera);
    const d = Math.hypot((v3.x - ndc.x) * box.width / 2, (v3.y - ndc.y) * box.height / 2);
    if (d < bd) { bd = d; best = a.f; }
  }
  return best;
}
renderer.domElement.addEventListener("pointermove", (ev) => { if (ev.buttons || ev.pointerType !== "mouse") return; hovered = pickAt(ev); renderer.domElement.style.cursor = hovered ? "pointer" : ""; });
let downAt = [0, 0];
renderer.domElement.addEventListener("pointerdown", (ev) => { downAt = [ev.clientX, ev.clientY]; });
let lastPlaneTap = { f: null, at: 0 };
renderer.domElement.addEventListener("pointerup", (ev) => {
  if (Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 6) return;
  const f = pickAt(ev), now = performance.now();
  if (f && lastPlaneTap.f === f && now - lastPlaneTap.at < 450) { tracking = f; selected = f; }      // double tap: follow it
  else if (!f) { tracking = null; selected = null; }
  else selected = f === selected ? null : f;
  if (tracking && selected !== tracking) tracking = null;
  lastPlaneTap = { f, at: now };
  touch();
});
ui.play.addEventListener("click", () => { playing = !playing; ui.play.textContent = playing ? "❚❚" : "▶"; touch(); });
ui.speed.addEventListener("change", () => { speed = Number(ui.speed.value); touch(); });
ui.time.addEventListener("input", () => { time = Number(ui.time.value); touch(); });
// Chips: tap toggles, double-tap isolates within its group, tapping a group name toggles the whole group.
const groupOf = (el) => el.closest("[data-group]").dataset.group;
let lastTap = { chip: null, at: 0 };
document.querySelectorAll("[data-chip]").forEach((el) => el.addEventListener("click", () => {
  const [kind, value] = el.dataset.chip.split(":");
  const now = performance.now(), dbl = lastTap.chip === el && now - lastTap.at < 420;
  lastTap = { chip: el, at: now };
  if (kind === "layer" || kind === "hl") {
    const map = kind === "layer" ? state.layer : state.hl, prefix = kind + ":";
    if (dbl) { for (const o of el.closest("[data-group]").querySelectorAll('[data-chip^="' + prefix + '"]')) map[o.dataset.chip.slice(prefix.length)] = o === el; }
    else map[value] = !map[value];
    if (kind === "hl" && map[value]) { state.layer.tca = true; state.layer.cz = true; }
  } else {
    state[kind] = value;
    if (kind === "view") placeCamera(VIEWS[value]);
  }
  applyLayers(); touch();
}));
document.querySelectorAll("[data-group] h2 span").forEach((h) => h.addEventListener("click", () => {
  const chips = [...h.closest("[data-group]").querySelectorAll('[data-chip^="layer:"]')];
  if (!chips.length) return;
  const any = chips.some((o) => on(o.dataset.chip.slice(6)));
  for (const o of chips) state.layer[o.dataset.chip.slice(6)] = !any;
  applyLayers(); touch();
}));
document.querySelectorAll("[data-info]").forEach((b) => b.addEventListener("click", () => {
  const src = document.querySelector("#texts [data-text=\"" + b.dataset.info + "\"]");
  const group = b.closest("[data-group]");
  ui.infoTitle.textContent = group ? group.querySelector("h2 span").textContent : "About this data";
  ui.infoBody.innerHTML = src.innerHTML; ui.info.classList.add("open");
}));
$("[data-info-close]").addEventListener("click", () => ui.info.classList.remove("open"));
ui.menu.addEventListener("click", () => { ui.panel.classList.toggle("open"); ui.menu.setAttribute("aria-expanded", ui.panel.classList.contains("open") ? "true" : "false"); });
addEventListener("keydown", (ev) => {
  if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT" || ev.target.tagName === "BUTTON") return;
  const step = ev.shiftKey ? 600 : 60;
  if (ev.key === " ") { playing = !playing; ui.play.textContent = playing ? "❚❚" : "▶"; }
  else if (ev.key === "ArrowRight") time = (time + step) % 86400;
  else if (ev.key === "ArrowLeft") time = (time - step + 86400) % 86400;
  else if (ev.key === "ArrowUp") { speed = Math.min(600, speed * 2); ui.speed.value = String(speed); }
  else if (ev.key === "ArrowDown") { speed = Math.max(1, speed / 2); ui.speed.value = String(speed); }
  else if ("1234567".includes(ev.key) && ev.key) { state.view = ["area", "airport", "runway", "final24", "side", "top", "tower"][Number(ev.key) - 1]; placeCamera(VIEWS[state.view]); applyLayers(); }
  else if (ev.key === "q" || ev.key === "Q") { controls.target.y = Math.max(0, controls.target.y - 0.4); controls.update(); }
  else if (ev.key === "e" || ev.key === "E") { controls.target.y += 0.4; controls.update(); }
  else if (ev.key === "l" || ev.key === "L") ui.panel.classList.toggle("open");
  else if (ev.key === "Escape") { selected = null; tracking = null; ui.info.classList.remove("open"); }
  else return;
  ev.preventDefault(); touch();
});
addEventListener("resize", resize);
if (!playing) ui.play.textContent = "▶";
if (matchMedia("(min-width: 701px)").matches) ui.panel.classList.add("open"); else ui.menu.setAttribute("aria-expanded", "false");
applyLayers(); update();
frame = requestAnimationFrame(tick);
`;

const airspaceText = `
<p><b>How to read the airspace.</b> The Toronto Terminal Control Area is Class C: every aircraft inside needs a clearance from the terminal controller. It is shaped like an upside-down wedding cake around the Toronto VOR. Close in, controlled airspace starts low; further out, it starts higher, so aircraft flying under it can get in and out of the small airports around the city.</p>
<p>Step A: 1,700 to 2,000 ft within 12 NM. Step B: 2,000 to 2,500 ft out to 15 NM east and 20 NM west. Step C: 2,500 to 3,500 ft within 20 NM. Step D: 3,500 to 4,500 ft within 26 NM. Step E: 4,500 to 12,500 ft within 26 NM. Under 1,700 ft near the airport the Pearson control zone takes over, 7 NM around the field from the surface to 2,500 ft. The bites out of the steps are the Brampton and Buttonville airports and the Billy Bishop zone, kept outside Class C.</p>
<p>Each sheet you see is a floor: the altitude where Class C begins at that distance. The walls are the outer edge of each step. Tap step chips to light them with the rest dimmed; tap twice for only that one; tap again to clear.</p>`;
const about = `
<p>The board is 100 NM across, centred on the Toronto VOR. The board surface is the airport elevation, 569 ft above sea level, and every height is drawn from there; the labels keep the published above-sea-level numbers. Heights are drawn at 3.3 times true scale by default so the steps read; the Heights chips go from true scale to 15 times.</p>
<p>The aircraft are real. Every one is an ADS-B broadcast received on 1 October 2026 by the ADS-B Exchange receiver network, published as a free sample day: ${stats.flights} flights within 55 NM below 20,000 ft. Position, altitude, speed, track, callsign and type come from the aircraft. Arrival or departure, and the runway, are inferred from where each track starts and ends. Altitude is pressure altitude, not corrected to the local altimeter. Where no receiver heard an aircraft for more than two minutes it is left out rather than drawn as a straight line. The airport's ADS-B test beacon (registration TWR) is removed.</p>
<p>On this day: ${stats.by_cat.arrival} Pearson arrivals (${Object.entries(stats.arrivals_by_rwy).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => r + " " + n).join(", ")}), ${stats.by_cat.departure} departures (${Object.entries(stats.departures_by_rwy).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => r + " " + n).join(", ")}), ${stats.by_cat.overflight} overflights.</p>
<p>Airspace: NAV CANADA Designated Airspace Handbook, issue effective 3 September 2026, traced point by point. Airport layout: OpenStreetMap contributors (ODbL). Runway thresholds and VORs: OurAirports. Shorelines: Natural Earth. Not drawn: STAR and SID procedures and terminal sector boundaries; the Canada Air Pilot is a paid publication and sectors are not public.</p>
<p>Tap a plane for its data block. Tap it twice to follow it: the camera stays on it until it lands or leaves, or until you tap empty board or press Esc. Camera: drag to orbit, scroll or pinch to zoom down to 1.5 NM, right-drag, shift-drag or two fingers to move the orbit centre (up and down as well), Q and E to lower or raise it. The camera can go down to the ground and look up. Keys: space play or pause, ← → one minute (shift: ten), ↑ ↓ speed, 1 to 7 views, L the menu, Esc close.</p>`;
const chip = (kind, value, label, onDefault = false, title = "") => `<button type="button" class="chip" data-chip="${kind}:${value}"${onDefault ? " data-on" : ""} aria-pressed="${onDefault}"${title ? ` title="${title.replace(/"/g, "&quot;")}"` : ""}>${label}</button>`;
const groupBlock = (id, title, chips, info) => `<section data-group="${id}"><h2><span title="Tap: all on or off">${title}</span>${info ? `<button type="button" class="info" data-info="${id}" aria-label="About ${title}">i</button>` : ""}</h2><div class="chips">${chips}</div></section>`;
const layerChips = (group) => LAYERS.filter((l) => l[4] === group).map(([id, label, note, def]) => chip("layer", id, label, def, note)).join("");
const stepChips = STEPS.map((st) => chip("hl", String(st.i), st.name.includes("CZ") ? (st.name.includes("Pearson") ? "Pearson CZ" : "Bishop CZ") : st.name.slice(-1).toUpperCase(), false, (st.floor ? st.floor.toLocaleString() : "surface") + " to " + st.ceiling.toLocaleString() + " ft")).join("");
const panelHtml = `
<nav id="panel" aria-label="Controls">
  <p class="howto">Tap a chip: on or off. Tap it twice: only that one. Tap a group name: all or none.</p>
  ${groupBlock("airspace", "Airspace", layerChips("airspace") + `<div class="sub">Highlight steps</div>` + stepChips, true)}
  ${groupBlock("heights", "Heights", ["1", "3.3", "6", "10", "15"].map((v) => chip("scale", v, v === "1" ? "True" : v + "×", v === "3.3")).join(""), true)}
  ${groupBlock("traffic", "Traffic", layerChips("traffic"), true)}
  ${groupBlock("overlay", "Overlays", layerChips("overlay"), true)}
  ${groupBlock("map", "Map", layerChips("map"), true)}
  ${groupBlock("view", "View", [["area", "Whole area"], ["airport", "Airport"], ["runway", "Runway 24R"], ["final24", "Final 24R"], ["side", "From south"], ["top", "Top down"], ["tower", "Ground level"]].map(([v, l], i) => chip("view", v, l + " " + (i + 1), v === "area")).join(""), false)}
  <button type="button" class="chip about" data-info="about">About this data</button>
</nav>`;
const LAYER_NOTES = (group) => LAYERS.filter((l) => l[4] === group).map(([id, label, note]) => `<p><b>${label}.</b> ${note}</p>`).join("");
const textsHtml = `<div id="texts" hidden>
  <div data-text="airspace">${airspaceText}${LAYER_NOTES("airspace")}</div>
  <div data-text="heights"><p>1 NM on the board is 1 NM on the ground. The board surface is the airport, 569 ft above sea level, so a 1,700 ft floor sits 1,131 ft over the runways. Heights are stretched so the airspace steps and the climbs and descents read. True is 1:1. The default is 3.3 times. Everything with a height stretches together: airspace, aircraft, trails and stems.</p></div>
  <div data-text="traffic">${LAYER_NOTES("traffic")}</div>
  <div data-text="overlay">${LAYER_NOTES("overlay")}</div>
  <div data-text="map">${LAYER_NOTES("map")}</div>
  <div data-text="about">${about}</div>
</div>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>YYZ terminal airspace</title>
<style>${ISO_CSS}
*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}
body{background:var(--anatomy-card);color:var(--anatomy-text);font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
#stage{position:fixed;inset:0;touch-action:none;cursor:grab}#stage:active{cursor:grabbing}#stage canvas{display:block}
#stage .labels{position:absolute;inset:0;pointer-events:none}
.corner{position:fixed;font-family:var(--anatomy-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--anatomy-muted);pointer-events:none;z-index:2}
.corner.title{top:14px;left:16px;color:var(--anatomy-text)}
.corner.readout{top:14px;right:92px;text-transform:none;letter-spacing:.04em;color:var(--anatomy-strong);font-variant-numeric:tabular-nums}
.bar{position:fixed;left:12px;right:12px;bottom:12px;display:flex;align-items:center;gap:10px;padding:8px 10px;background:color-mix(in srgb,var(--anatomy-card) 80%,transparent);border:1px solid var(--anatomy-lo);backdrop-filter:blur(6px);font:10.5px var(--anatomy-mono);color:var(--anatomy-text);z-index:2}
.bar button,.bar select,.toggle{font:inherit;color:var(--anatomy-strong);background:var(--anatomy-face);border:1px solid var(--anatomy-lo);border-radius:2px;padding:4px 8px;cursor:pointer;max-width:100%}
.bar input[type=range]{flex:1;min-width:60px;accent-color:var(--anatomy-hi)}
.bar .clock{min-width:46px;font-variant-numeric:tabular-nums;color:var(--anatomy-strong)}
.toggle{position:fixed;top:10px;left:12px;z-index:6;font:10.5px var(--anatomy-mono);letter-spacing:.08em;text-transform:uppercase}
.corner.title{left:84px}
#panel{position:fixed;top:44px;left:12px;bottom:70px;width:236px;overflow:auto;padding:8px 10px 14px;background:color-mix(in srgb,var(--anatomy-card) 82%,transparent);border:1px solid var(--anatomy-lo);backdrop-filter:blur(8px);z-index:5;transition:transform .28s var(--anatomy-ease),opacity .28s}
#panel:not(.open){transform:translateX(-110%);opacity:0;pointer-events:none}
#panel .howto{margin:4px 0 8px;font-size:10.5px;line-height:1.4;color:var(--anatomy-muted)}
#panel section{padding:6px 0 8px;border-top:1px solid var(--anatomy-faint)}
#panel h2{display:flex;align-items:center;justify-content:space-between;margin:0 0 6px;font:10.5px var(--anatomy-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--anatomy-text)}
#panel h2 span{cursor:pointer}
#panel .info{width:16px;height:16px;border-radius:50%;border:1px solid var(--anatomy-lo);background:none;color:var(--anatomy-muted);font:10px var(--anatomy-mono);cursor:pointer;padding:0;line-height:14px}
#panel .sub{flex-basis:100%;font:9.5px var(--anatomy-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--anatomy-muted);margin:6px 0 2px}
.chips{display:flex;flex-wrap:wrap;gap:5px}
.chip{font:11px var(--anatomy-mono);color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-lo);border-radius:999px;padding:4px 9px;cursor:pointer;line-height:1.2;user-select:none;-webkit-user-select:none}
.chip[aria-pressed="true"]{background:var(--anatomy-hi);color:var(--anatomy-card);border-color:var(--anatomy-hi)}
.chip.about{margin-top:10px;width:100%;border-radius:2px}
#info{position:fixed;top:44px;right:12px;width:min(380px,calc(100% - 24px));max-height:calc(100% - 130px);overflow:auto;padding:14px 16px 18px;background:color-mix(in srgb,var(--anatomy-card) 94%,transparent);border:1px solid var(--anatomy-lo);backdrop-filter:blur(8px);z-index:7;transform:translateY(-8px);opacity:0;pointer-events:none;transition:all .25s var(--anatomy-ease)}
#info.open{transform:none;opacity:1;pointer-events:auto}
#info .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
#info h3{margin:0;font:11px var(--anatomy-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--anatomy-strong)}
#info p{margin:0 0 10px;font-size:12px;line-height:1.5;color:var(--anatomy-text)}
#info p b{color:var(--anatomy-strong)}
.datablock{font:10.5px/1.25 var(--anatomy-mono);color:var(--anatomy-strong);background:color-mix(in srgb,var(--anatomy-card) 85%,transparent);padding:3px 5px;border:1px solid var(--anatomy-lo);white-space:nowrap;transform:translate(14px,-18px)}
.datablock span{color:var(--anatomy-muted)}
.mark{font:10px var(--anatomy-mono);color:var(--anatomy-muted);letter-spacing:.1em;white-space:nowrap}
.alt{font:10px var(--anatomy-mono);color:var(--anatomy-text);white-space:nowrap;background:color-mix(in srgb,var(--anatomy-card) 70%,transparent);padding:1px 4px}
.alt.picked{color:var(--anatomy-strong);border:1px solid var(--anatomy-hi)}
.rwy{font:9.5px var(--anatomy-mono);color:var(--anatomy-strong);white-space:nowrap}
.cs{font:9.5px var(--anatomy-mono);color:var(--anatomy-text);white-space:nowrap;transform:translate(8px,-8px)}
.corner.readout{right:14px}
@media (max-width:700px){.corner.readout{top:auto;bottom:62px;left:12px;right:12px;text-align:left}.corner.title{display:none}.bar{flex-wrap:wrap}.bar input[type=range]{flex-basis:100%;order:9}#panel{width:min(260px,calc(100% - 24px));bottom:100px}}
</style></head><body class="iso" data-theme="${theme}">
<div id="stage" role="application" aria-label="Toronto Pearson terminal airspace: drag to orbit, click an aircraft for its data block, arrow keys move time"></div>
<div class="corner title">YYZ terminal airspace · 1 Oct 2026</div>
<div class="corner readout" data-readout>loading</div>
<button type="button" class="toggle" data-menu aria-expanded="true" aria-controls="panel">Menu</button>
${panelHtml}
<aside id="info" aria-label="Explanation"><div class="head"><h3></h3><button type="button" class="toggle" style="position:static" data-info-close>Close</button></div><div class="body"></div></aside>
${textsHtml}
<div class="bar"><button type="button" data-play aria-label="Play or pause">❚❚</button><select data-speed aria-label="Replay speed"><option value="1">1×</option><option value="2">2×</option><option value="5" selected>5×</option><option value="10">10×</option><option value="30">30×</option><option value="60">60×</option><option value="120">120×</option><option value="300">300×</option></select><input type="range" data-time min="0" max="86399" step="10" value="54000" aria-label="Time of day, UTC"><span class="clock" data-clock>15:00Z</span></div>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.170.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.170.0/examples/jsm/"}}</script>
<script type="module">${APP}</script>
</body></html>`;

const out = join(HERE, "yyz");
mkdirSync(out, { recursive: true });
const file = theme === "light" ? "index-light.html" : "index.html";
writeFileSync(join(out, file), html);
copyFileSync(join(HERE, "data", "data.json"), join(out, "data.json"));
console.log("wrote yyz/" + file);
