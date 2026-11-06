import type { Building, CityState, DistrictId, Hamster } from "../sim/types";
import { MAP_H, MAP_W, districtAt } from "../sim/world";
import { ROADS, hourOf, capacity, building } from "../sim/engine";

/** Squeekchain Genesis palette (from squeekchain.com --sqk-* tokens) plus a few terrain tones. */
export const PAL = {
  bg: "#0b0b0d", blue: "#5b7cfa", blueDeep: "#2f4499", green: "#35d07f", greenDeep: "#1b7a4a", gold: "#f2c230",
  cream: "#fdfbc8", active: "#7fd4ff", fur: "#c99762", face: "#d4a775", ear: "#c07e72", gray: "#6e6e7a",
  grassA: "#3f9a55", grassB: "#47a65d", road: "#3a3a46", roadLine: "#b6b6c2", dirt: "#9a7350",
};

export interface Camera { x: number; y: number; zoom: number }
export interface Hit { kind: "building" | "hamster"; id: string; x0: number; y0: number; x1: number; y1: number; depth: number }
export interface RenderOut { hits: Hit[] }

const TW = 16, TH = 8; // half tile size in low-res pixels at zoom 1

export function iso(x: number, y: number) { return { x: (x - y) * TW, y: (x + y) * TH }; }

export function project(cam: Camera, W: number, H: number, x: number, y: number, z = 0) {
  const p = iso(x, y);
  return { x: Math.round(W / 2 + (p.x - cam.x) * cam.zoom), y: Math.round(H / 2 + (p.y - cam.y - z) * cam.zoom) };
}

export function unproject(cam: Camera, W: number, H: number, sx: number, sy: number) {
  const ix = (sx - W / 2) / cam.zoom + cam.x;
  const iy = (sy - H / 2) / cam.zoom + cam.y;
  return { x: (ix / TW + iy / TH) / 2, y: (iy / TH - ix / TW) / 2 };
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

interface Ctx { g: CanvasRenderingContext2D; cam: Camera; W: number; H: number; t: number; anim: number; s: CityState; focus: DistrictId | null; night: number }

function P(c: Ctx, x: number, y: number, z = 0) { return project(c.cam, c.W, c.H, x, y, z); }

function poly(g: CanvasRenderingContext2D, pts: { x: number; y: number }[], fill: string) {
  g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  g.closePath(); g.fill();
}

function diamond(c: Ctx, x: number, y: number, w: number, h: number, fill: string, z = 0) {
  poly(c.g, [P(c, x, y, z), P(c, x + w, y, z), P(c, x + w, y + h, z), P(c, x, y + h, z)], fill);
}

/** An isometric box with a lit left face and a shaded right face. */
function box(c: Ctx, x: number, y: number, w: number, h: number, z0: number, z1: number, col: string, top?: string) {
  const a = P(c, x, y + h, z0), b = P(c, x + w, y + h, z0), d = P(c, x + w, y, z0);
  const a1 = P(c, x, y + h, z1), b1 = P(c, x + w, y + h, z1), d1 = P(c, x + w, y, z1);
  poly(c.g, [a, b, b1, a1], shade(col, -0.08));
  poly(c.g, [b, d, d1, b1], shade(col, -0.3));
  diamond(c, x, y, w, h, top ?? shade(col, 0.15), z1);
}

/** Windows on the two visible faces; lit at night. */
function windows(c: Ctx, b: Building, z0: number, z1: number, rows: number, lit: boolean, color = "#2a2a33") {
  const g = c.g, zoom = c.cam.zoom;
  const ws = Math.max(1, Math.round(2 * zoom)), hs = Math.max(1, Math.round(3 * zoom));
  const glow = lit ? (c.night > 0.3 ? PAL.gold : shade(PAL.cream, -0.1)) : color;
  for (let r = 0; r < rows; r++) {
    const z = z0 + ((z1 - z0) * (r + 0.55)) / (rows + 0.2);
    for (let i = 0; i < b.w * 2; i++) {
      const p = P(c, b.x + (i + 0.5) / 2, b.y + b.h, z);
      g.fillStyle = glow; g.fillRect(p.x - ws / 2, p.y - hs, ws, hs);
    }
    for (let i = 0; i < b.h * 2; i++) {
      const p = P(c, b.x + b.w, b.y + (i + 0.5) / 2, z);
      g.fillStyle = lit ? glow : shade(color, -0.2); g.fillRect(p.x - ws / 2, p.y - hs, ws, hs);
    }
  }
}

function occupants(s: CityState, id: string) { return s.hamsters.filter((h) => h.at === id && h.activity !== "walking"); }

function drawTree(c: Ctx, x: number, y: number, kind: number) {
  const g = c.g, z = c.cam.zoom;
  const p = P(c, x + 0.5, y + 0.5);
  const sway = Math.round(Math.sin(c.anim / 900 + x * 3 + y) * z * 0.6);
  g.fillStyle = "#6b4a2e"; g.fillRect(p.x - Math.round(z), p.y - Math.round(6 * z), Math.max(2, Math.round(2 * z)), Math.round(6 * z));
  const cols = [["#2f8a4a", "#3fb060"], ["#2a7a52", "#35d07f"], ["#4f8f2f", "#7fbf3f"]][kind % 3];
  const r = Math.round((kind === 1 ? 5 : 6) * z);
  g.fillStyle = cols[0]; g.beginPath(); g.arc(p.x + sway, p.y - Math.round(10 * z), r, 0, Math.PI * 2); g.fill();
  g.fillStyle = cols[1]; g.beginPath(); g.arc(p.x + sway - Math.round(z * 1.5), p.y - Math.round(11.5 * z), Math.round(r * 0.55), 0, Math.PI * 2); g.fill();
}

function drawLamp(c: Ctx, x: number, y: number) {
  const g = c.g, z = c.cam.zoom, p = P(c, x, y);
  g.fillStyle = "#26262e"; g.fillRect(p.x, p.y - Math.round(12 * z), Math.max(1, Math.round(z)), Math.round(12 * z));
  g.fillStyle = c.night > 0.3 ? PAL.cream : "#82828f"; g.fillRect(p.x - Math.round(z), p.y - Math.round(13 * z), Math.round(3 * z), Math.round(2 * z));
}

export function drawHamster(g: CanvasRenderingContext2D, x: number, y: number, z: number, h: Hamster, anim: number, opts: { moving: boolean; umbrella: boolean; selected: boolean; running?: boolean; sleeping?: boolean }) {
  const u = Math.max(1, Math.round(z));
  const bob = opts.moving || opts.running ? (Math.floor(anim / (opts.running ? 90 : 160)) % 2) * u : 0;
  const bx = x - 3 * u, by = y - 5 * u - bob;
  if (opts.selected) { g.strokeStyle = PAL.active; g.lineWidth = u; g.beginPath(); g.ellipse(x, y, 6 * u, 3 * u, 0, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(bx, y - u, 6 * u, u);
  g.fillStyle = h.fur; g.fillRect(bx, by + u, 6 * u, 4 * u); g.fillRect(bx + u, by, 4 * u, u);
  g.fillStyle = PAL.cream; g.fillRect(bx + 2 * u, by + 3 * u, 3 * u, 2 * u);
  g.fillStyle = PAL.ear; g.fillRect(bx + u, by - u, u, u); g.fillRect(bx + 4 * u, by - u, u, u);
  g.fillStyle = "#1a1a20"; g.fillRect(bx + 4 * u, by + u + (opts.sleeping ? u : 0), u, opts.sleeping ? Math.max(1, Math.round(u / 2)) : u);
  if (opts.moving) { g.fillStyle = shade(h.fur, -0.4); g.fillRect(bx + (bob ? u : 0), by + 5 * u, u, u); g.fillRect(bx + 4 * u - (bob ? u : 0), by + 5 * u, u, u); }
  if (opts.umbrella) {
    const cols = [PAL.blue, PAL.gold, PAL.green, "#e05a7a"]; const col = cols[h.name.length % cols.length];
    g.fillStyle = "#26262e"; g.fillRect(x, by - 7 * u, u, 7 * u);
    g.fillStyle = col; g.beginPath(); g.ellipse(x, by - 7 * u, 7 * u, 4 * u, 0, Math.PI, 0); g.fill();
  }
}

function drawWheel(c: Ctx, cx: number, cy: number, r: number, spin: number, gold: boolean, glow: boolean) {
  const g = c.g, z = c.cam.zoom;
  g.strokeStyle = glow ? PAL.active : gold ? PAL.gold : "#b6b6c2"; g.lineWidth = Math.max(1, Math.round(z));
  g.beginPath(); g.ellipse(cx, cy, r * 0.75, r, 0, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = "#82828f";
  for (let i = 0; i < 4; i++) {
    const a = spin + (i * Math.PI) / 4;
    g.beginPath(); g.moveTo(cx - Math.cos(a) * r * 0.7, cy - Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r); g.stroke();
  }
  g.fillStyle = "#26262e"; g.fillRect(cx - Math.round(z), cy + r, Math.round(2 * z), Math.round(3 * z));
}

export const HALL_SLOTS = 7;

function drawBuilding(c: Ctx, b: Building) {
  const g = c.g, z = c.cam.zoom, s = c.s;
  const occ = occupants(s, b.id);
  const lit = c.night > 0.3 ? !s.brownout && (occ.length > 0 || b.kind !== "house") : occ.length > 0 && b.kind !== "house";
  switch (b.kind) {
    case "house": {
      const hgt = 14 + 9 * (b.level - 1);
      const wall = b.level >= 3 ? "#e8d9b0" : b.level === 2 ? "#e6c9a8" : "#d9c19a";
      box(c, b.x + 0.15, b.y + 0.15, b.w - 0.3, b.h - 0.3, 0, hgt, wall);
      windows(c, { ...b, x: b.x + 0.15, y: b.y + 0.15, w: b.w - 0.3, h: b.h - 0.3 }, 0, hgt, b.level, lit, "#3a3a46");
      const roof = b.level >= 3 ? PAL.gold : b.level === 2 ? PAL.blue : "#c0584a";
      const ap = P(c, b.x + b.w / 2, b.y + b.h / 2, hgt + 12);
      const A = P(c, b.x, b.y + b.h, hgt), B = P(c, b.x + b.w, b.y + b.h, hgt), D = P(c, b.x + b.w, b.y, hgt), Q = P(c, b.x, b.y, hgt);
      poly(g, [Q, D, ap], shade(roof, 0.1)); poly(g, [A, B, ap], shade(roof, -0.05)); poly(g, [B, D, ap], shade(roof, -0.3));
      if (b.level >= 2) { const ch = P(c, b.x + b.w * 0.7, b.y + b.h * 0.35, hgt + 6); g.fillStyle = "#6e6e7a"; g.fillRect(ch.x, ch.y - Math.round(6 * z), Math.round(3 * z), Math.round(7 * z)); }
      if (occ.some((h) => h.activity === "eating")) { // cooking smoke
        const ch = P(c, b.x + b.w * 0.7, b.y + b.h * 0.35, hgt + 14 + ((c.anim / 60) % 10));
        g.fillStyle = "rgba(230,230,236,0.6)"; g.fillRect(ch.x, ch.y, Math.round(3 * z), Math.round(3 * z));
      }
      break;
    }
    case "lot": {
      diamond(c, b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, PAL.dirt);
      for (const [dx, dy] of [[0.2, 0.2], [b.w - 0.2, 0.2], [0.2, b.h - 0.2], [b.w - 0.2, b.h - 0.2]]) {
        const p = P(c, b.x + dx, b.y + dy); g.fillStyle = PAL.gold; g.fillRect(p.x, p.y - Math.round(6 * z), Math.max(1, Math.round(z)), Math.round(6 * z));
      }
      const sgn = P(c, b.x + b.w / 2, b.y + b.h / 2, 8); g.fillStyle = PAL.cream; g.fillRect(sgn.x - Math.round(5 * z), sgn.y - Math.round(4 * z), Math.round(10 * z), Math.round(5 * z));
      g.fillStyle = PAL.greenDeep; g.fillRect(sgn.x - Math.round(3 * z), sgn.y - Math.round(2 * z), Math.round(6 * z), Math.max(1, Math.round(z)));
      break;
    }
    case "garden": {
      diamond(c, b.x, b.y, b.w, b.h, "#6b8f3a");
      for (let i = 0; i < b.w * 2; i++) {
        const p0 = P(c, b.x + 0.25 + i * 0.5, b.y + 0.3), p1 = P(c, b.x + 0.25 + i * 0.5, b.y + b.h - 0.3);
        g.strokeStyle = i % 2 ? "#7a5a3a" : PAL.greenDeep; g.lineWidth = Math.max(1, Math.round(2 * z)); g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke();
        if (b.level >= 2 && i % 2 === 0) { g.fillStyle = b.level >= 3 ? PAL.gold : "#e05a7a"; g.fillRect(p0.x + (p1.x - p0.x) / 2, (p0.y + p1.y) / 2 - Math.round(2 * z), Math.round(2 * z), Math.round(2 * z)); }
      }
      break;
    }
    case "kitchen": {
      box(c, b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, 0, 16 + 4 * b.level, "#cfa57d", "#1b7849");
      windows(c, { ...b, x: b.x + 0.1, y: b.y + 0.1, w: b.w - 0.2, h: b.h - 0.2 }, 0, 16 + 4 * b.level, 1, lit);
      break;
    }
    case "hq": {
      const hgt = 40 + 12 * (b.level - 1);
      box(c, b.x + 0.2, b.y + 0.2, b.w - 0.4, b.h - 0.4, 0, hgt, "#4460cf", "#2f4499");
      windows(c, { ...b, x: b.x + 0.2, y: b.y + 0.2, w: b.w - 0.4, h: b.h - 0.4 }, 0, hgt, 3 + b.level, lit, "#2f4499");
      box(c, b.x + 0.9, b.y + 0.9, b.w - 1.8, b.h - 1.8, hgt, hgt + 6, PAL.gold);
      break;
    }
    case "battery": {
      const cells = 2 + b.level;
      const fill = s.energy / capacity(s);
      box(c, b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, 0, 6, "#3a3a46");
      for (let i = 0; i < cells; i++) {
        const cx = b.x + 0.5 + (i % 3) * 0.8, cy = b.y + 0.5 + Math.floor(i / 3) * 1.1;
        box(c, cx, cy, 0.55, 0.55, 6, 26, "#26262e");
        box(c, cx + 0.05, cy + 0.05, 0.45, 0.45, 6, 6 + Math.max(1, 19 * fill), s.time < s.surgeUntil ? PAL.active : fill < 0.15 ? "#e05a5a" : PAL.green);
      }
      break;
    }
    case "wheelhall": {
      box(c, b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, 0, 8, "#2a2a33", "#4a4a56");
      const surge = s.time < s.surgeUntil;
      for (let i = 0; i < HALL_SLOTS; i++) {
        const sx = b.x + 0.55 + (i % 4) * 0.95, sy = b.y + 0.7 + Math.floor(i / 4) * 1.4;
        const worker = s.hamsters.find((h) => h.job?.hall === b.id && h.job.wheelSlot === i && h.at === b.id && h.activity === "working");
        const p = P(c, sx, sy, 8);
        const r = Math.round(7 * z);
        const spin = worker ? (c.anim / (surge ? 70 : 140)) % (Math.PI * 2) : 0;
        if (worker) drawHamster(g, p.x, p.y + Math.round(2 * z), z, worker, c.anim, { moving: false, running: true, umbrella: false, selected: false });
        drawWheel(c, p.x, p.y - r, r, spin, b.level >= 3, surge && !!worker);
      }
      break;
    }
    case "cafe": case "bistro": case "market": case "studio": case "arcade": {
      const col = { cafe: "#e6c9a8", bistro: "#f2c230", market: "#cfa57d", studio: "#1a1a20", arcade: "#2f4499" }[b.kind];
      const hgt = 18 + 5 * b.level;
      box(c, b.x + 0.2, b.y + 0.2, b.w - 0.4, b.h - 0.4, 0, hgt, col);
      windows(c, { ...b, x: b.x + 0.2, y: b.y + 0.2, w: b.w - 0.4, h: b.h - 0.4 }, 0, hgt, 2, lit);
      if (b.kind === "cafe" || b.kind === "bistro" || b.kind === "market") {
        const stripe = b.kind === "cafe" ? PAL.green : b.kind === "bistro" ? "#c0584a" : PAL.blue;
        for (let i = 0; i < (b.w - 0.4) * 4; i++) {
          const x0 = b.x + 0.2 + i * 0.25;
          const p0 = P(c, x0, b.y + b.h - 0.2, hgt * 0.45), p1 = P(c, x0 + 0.25, b.y + b.h - 0.2, hgt * 0.45), p2 = P(c, x0 + 0.25, b.y + b.h + 0.15, hgt * 0.32), p3 = P(c, x0, b.y + b.h + 0.15, hgt * 0.32);
          poly(g, [p0, p1, p2, p3], i % 2 ? PAL.cream : stripe);
        }
        if (b.level >= 2) for (let i = 0; i < b.level; i++) { const p = P(c, b.x + 0.6 + i * 0.8, b.y + b.h + 0.55, 0); g.fillStyle = PAL.cream; g.fillRect(p.x - Math.round(2 * z), p.y - Math.round(4 * z), Math.round(4 * z), Math.round(2 * z)); }
      }
      if (b.kind === "studio") {
        const a = P(c, b.x + b.w / 2, b.y + b.h / 2, hgt);
        g.fillStyle = "#b6b6c2"; g.fillRect(a.x, a.y - Math.round(16 * z), Math.max(1, Math.round(z)), Math.round(16 * z));
        g.fillStyle = Math.floor(c.anim / 600) % 2 ? "#ff4d4d" : "#7a1a1a"; g.fillRect(a.x - Math.round(z), a.y - Math.round(18 * z), Math.round(3 * z), Math.round(3 * z));
        const sc = P(c, b.x + 0.6, b.y + b.h - 0.2, hgt - 4);
        g.fillStyle = PAL.active; g.fillRect(sc.x, sc.y, Math.round(10 * z), Math.round(5 * z));
      }
      if (b.kind === "arcade") {
        const sg = P(c, b.x + 0.5, b.y + b.h - 0.2, hgt - 3);
        g.fillStyle = ["#e05a7a", PAL.gold, PAL.active][Math.floor(c.anim / 400) % 3]; g.fillRect(sg.x, sg.y, Math.round(14 * z), Math.round(3 * z));
      }
      break;
    }
    case "park": {
      diamond(c, b.x, b.y, b.w, b.h, "#55b86a");
      const pth = [P(c, b.x, b.y + 0.4), P(c, b.x + b.w, b.y + 0.4), P(c, b.x + b.w, b.y + 0.9), P(c, b.x, b.y + 0.9)];
      poly(g, pth, "#d9c19a");
      diamond(c, b.x + 4.6, b.y + 1.6, 1.8, 1.6, "#3f7fd0");
      if (b.level >= 2) { const f = P(c, b.x + 5.5, b.y + 2.4, 0); g.fillStyle = PAL.cream; g.fillRect(f.x - Math.round(z), f.y - Math.round((6 + (c.anim / 120) % 3) * z), Math.round(2 * z), Math.round(6 * z)); }
      box(c, b.x + 1, b.y + 1.6, 1.4, 1.4, 0, 4, "#cfa57d", PAL.cream); // bandstand
      if (b.level >= 3) for (let i = 0; i < 8; i++) { const p = P(c, b.x + 0.3 + i * 0.8, b.y + b.h - 0.3); g.fillStyle = i % 2 ? PAL.gold : "#e05a7a"; g.fillRect(p.x, p.y - Math.round(2 * z), Math.round(2 * z), Math.round(2 * z)); }
      if (s.time < s.festivalUntil) {
        for (let i = 0; i < 9; i++) {
          const p = P(c, b.x + 0.4 + i * 0.75, b.y + 0.2, 14 + Math.sin(i) * 2);
          g.fillStyle = [PAL.gold, "#e05a7a", PAL.active, PAL.green][i % 4]; g.fillRect(p.x, p.y, Math.round(3 * z), Math.round(3 * z));
        }
        for (let i = 0; i < 24; i++) {
          const fx = b.x + ((i * 37 + c.anim / 30) % (b.w * 10)) / 10, fy = b.y + ((i * 53) % (b.h * 10)) / 10;
          const p = P(c, fx, fy, 30 - ((c.anim / 25 + i * 9) % 30));
          g.fillStyle = [PAL.gold, "#e05a7a", PAL.active][i % 3]; g.fillRect(p.x, p.y, Math.max(1, Math.round(z)), Math.max(1, Math.round(z)));
        }
      }
      break;
    }
  }
  // occupancy badges for indoor buildings in focused district view
  if (c.focus === b.district && !b.outdoor && b.kind !== "wheelhall" && b.kind !== "lot") {
    const inside = occ.length;
    if (inside > 0) {
      const p = P(c, b.x + b.w / 2, b.y + b.h / 2, b.kind === "hq" ? 60 + 12 * b.level : 40 + 8 * b.level);
      for (let i = 0; i < Math.min(inside, 5); i++) {
        g.fillStyle = occ[i].fur; g.fillRect(p.x - Math.round((inside * 3 - i * 6) * z / 1.5), p.y, Math.round(4 * z), Math.round(4 * z));
        g.fillStyle = PAL.ear; g.fillRect(p.x - Math.round((inside * 3 - i * 6) * z / 1.5), p.y - Math.round(z), Math.round(z), Math.round(z));
      }
    }
  }
}

/** Draw a whole frame into the low-resolution canvas. */
export function render(g: CanvasRenderingContext2D, W: number, H: number, s: CityState, cam: Camera, anim: number,
  focus: DistrictId | null, selected: { building: string | null; hamster: string | null }, rain: { x: number; y: number }[]): RenderOut {
  const hour = hourOf(s.time);
  // night factor: 0 day .. 1 deep night, with dusk/dawn ramps
  const night = hour < 5 ? 1 : hour < 7 ? 1 - (hour - 5) / 2 : hour < 18.5 ? 0 : hour < 20.5 ? (hour - 18.5) / 2 : 1;
  const c: Ctx = { g, cam, W, H, t: s.time, anim, s, focus, night };
  const hits: Hit[] = [];
  g.imageSmoothingEnabled = false;
  g.fillStyle = PAL.bg; g.fillRect(0, 0, W, H);

  // ground
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const dim = focus && districtAt(x, y) !== focus;
    g.globalAlpha = dim ? 0.35 : 1;
    if (ROADS[y][x]) {
      diamond(c, x, y, 1, 1, PAL.road);
      const horiz = ROADS[y][x - 1] || ROADS[y][x + 1];
      const vert = ROADS[y - 1]?.[x] || ROADS[y + 1]?.[x];
      if (horiz !== vert && cam.zoom >= 1) {
        const a = horiz ? P(c, x + 0.35, y + 0.5) : P(c, x + 0.5, y + 0.35), b = horiz ? P(c, x + 0.65, y + 0.5) : P(c, x + 0.5, y + 0.65);
        g.strokeStyle = PAL.roadLine; g.lineWidth = 1; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    } else {
      diamond(c, x, y, 1, 1, (x + y) % 2 ? PAL.grassA : PAL.grassB);
      if (s.weather === "rain") { g.fillStyle = "rgba(40,60,120,0.18)"; diamond(c, x, y, 1, 1, "rgba(40,60,120,0.18)"); }
    }
  }
  g.globalAlpha = 1;

  // drawables, depth-sorted
  type D = { depth: number; draw: () => void; dim: boolean };
  const items: D[] = [];
  for (const b of s.buildings) {
    items.push({ depth: b.x + b.w + b.y + b.h - (b.outdoor || b.kind === "lot" ? 6 : 1), dim: !!focus && b.district !== focus, draw: () => {
      drawBuilding(c, b);
      const top = P(c, b.x, b.y, 0), right = P(c, b.x + b.w, b.y, 0), bottom = P(c, b.x + b.w, b.y + b.h, 0), left = P(c, b.x, b.y + b.h, 0);
      const hgt = b.kind === "hq" ? 60 : b.outdoor || b.kind === "lot" ? 0 : 36;
      hits.push({ kind: "building", id: b.id, x0: left.x, x1: right.x, y0: top.y - hgt * cam.zoom, y1: bottom.y, depth: b.x + b.w + b.y + b.h });
      if (selected.building === b.id) {
        g.strokeStyle = PAL.active; g.lineWidth = Math.max(1, Math.round(cam.zoom));
        g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(right.x, right.y); g.lineTo(bottom.x, bottom.y); g.lineTo(left.x, left.y); g.closePath(); g.stroke();
      }
    } });
  }
  for (const t of s.trees) items.push({ depth: t.x + t.y + 1, dim: !!focus && districtAt(t.x, t.y) !== focus, draw: () => drawTree(c, t.x, t.y, t.kind) });
  for (const [x, y] of [[11, 11], [13, 11], [11, 13], [13, 13], [3, 6], [9, 4], [17, 6], [22, 6], [9, 19], [17, 19], [22, 17], [5, 17]]) {
    items.push({ depth: x + y, dim: !!focus && districtAt(x, y) !== focus, draw: () => drawLamp(c, x, y) });
  }
  for (const h of s.hamsters) {
    const b = building(s, h.at);
    const visible = h.activity === "walking" || (b && b.outdoor && h.wander);
    if (!visible) continue;
    const wx = h.activity === "walking" ? h.x + 0.5 : h.wander!.x, wy = h.activity === "walking" ? h.y + 0.5 : h.wander!.y;
    const dx = h.activity === "walking" ? 0 : 0;
    items.push({ depth: wx + wy + 0.6, dim: !!focus && districtAt(Math.floor(wx), Math.floor(wy)) !== focus, draw: () => {
      const p = P(c, wx + dx, wy);
      const umbrella = s.weather === "rain" && h.hasUmbrella;
      drawHamster(g, p.x, p.y, cam.zoom, h, anim + h.name.length * 37, { moving: h.activity === "walking", umbrella, selected: selected.hamster === h.id });
      hits.push({ kind: "hamster", id: h.id, x0: p.x - 6 * cam.zoom, x1: p.x + 6 * cam.zoom, y0: p.y - 10 * cam.zoom, y1: p.y + 2 * cam.zoom, depth: 1000 });
    } });
  }
  // working hamsters inside wheel halls are clickable too
  for (const h of s.hamsters) {
    if (h.activity !== "working" || !h.job) continue;
    const b = building(s, h.job.hall); if (!b || h.at !== b.id) continue;
    const i = h.job.wheelSlot; const sx = b.x + 0.55 + (i % 4) * 0.95, sy = b.y + 0.7 + Math.floor(i / 4) * 1.4;
    const p = P(c, sx, sy, 8);
    hits.push({ kind: "hamster", id: h.id, x0: p.x - 6 * cam.zoom, x1: p.x + 6 * cam.zoom, y0: p.y - 14 * cam.zoom, y1: p.y + 4 * cam.zoom, depth: 1000 });
    if (selected.hamster === h.id) items.push({ depth: 999, dim: false, draw: () => { g.strokeStyle = PAL.active; g.lineWidth = Math.max(1, Math.round(cam.zoom)); g.strokeRect(p.x - 7 * cam.zoom, p.y - 16 * cam.zoom, 14 * cam.zoom, 20 * cam.zoom); } });
  }
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) { g.globalAlpha = it.dim ? 0.35 : 1; it.draw(); }
  g.globalAlpha = 1;

  // lighting: night tint, then lamp and window glows on top
  const surge = s.time < s.surgeUntil;
  if (night > 0) {
    g.fillStyle = `rgba(14,18,48,${(0.55 * night).toFixed(3)})`; g.fillRect(0, 0, W, H);
    if (hour > 17 && hour < 21) { g.fillStyle = `rgba(242,130,60,${(0.12 * (1 - Math.abs(hour - 19) / 2)).toFixed(3)})`; g.fillRect(0, 0, W, H); }
    if (!s.brownout) {
      g.globalCompositeOperation = "lighter";
      for (const [x, y] of [[11, 11], [13, 11], [11, 13], [13, 13], [3, 6], [9, 4], [17, 6], [22, 6], [9, 19], [17, 19], [22, 17], [5, 17]]) {
        const p = P(c, x, y, 12);
        const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 22 * cam.zoom);
        grd.addColorStop(0, `rgba(242,194,48,${(0.35 * night).toFixed(3)})`); grd.addColorStop(1, "rgba(242,194,48,0)");
        g.fillStyle = grd; g.fillRect(p.x - 22 * cam.zoom, p.y - 22 * cam.zoom, 44 * cam.zoom, 44 * cam.zoom);
      }
      g.globalCompositeOperation = "source-over";
    }
  } else if (hour >= 5 && hour < 7.5) {
    g.fillStyle = "rgba(253,200,140,0.08)"; g.fillRect(0, 0, W, H);
  }
  if (surge) {
    g.globalCompositeOperation = "lighter";
    for (const id of ["hallA", "hallB", "battery"]) {
      const b = building(s, id)!; const p = P(c, b.x + b.w / 2, b.y + b.h / 2, 10);
      const r = (40 + 6 * Math.sin(anim / 150)) * cam.zoom;
      const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grd.addColorStop(0, "rgba(127,212,255,0.45)"); grd.addColorStop(1, "rgba(127,212,255,0)");
      g.fillStyle = grd; g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over";
  }
  if (s.weather === "rain") {
    g.fillStyle = "rgba(30,40,70,0.22)"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(182,200,240,0.55)"; g.lineWidth = 1; g.beginPath();
    for (const d of rain) { const x = (d.x * W + anim * 0.05) % W, y = (d.y * H + anim * 0.35) % H; g.moveTo(x, y); g.lineTo(x - 2, y + 6); }
    g.stroke();
  } else if (s.weather === "cloudy") {
    g.fillStyle = "rgba(60,60,80,0.10)"; g.fillRect(0, 0, W, H);
  }
  if (s.brownout) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 0, W, H); }
  return { hits };
}

export function districtCenter(d: DistrictId) {
  const c = { residential: [5.5, 6], corp: [19, 5.5], downtown: [12, 19] }[d];
  return iso(c[0], c[1]);
}
