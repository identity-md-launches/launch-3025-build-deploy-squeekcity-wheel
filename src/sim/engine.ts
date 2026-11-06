import type { Activity, Building, CityState, Hamster, Rank, Weather } from "./types";
import { RANKS } from "./types";
import { MAP_H, MAP_W, buildRoads, initialBuildings, initialHamsters, initialTrees } from "./world";

export const DAY = 1440;
export const START_TIME = 6 * 60 + 30;
export const MAX_POP = 15;
export const GAME_MIN_PER_SEC = 2; // at 1x, one real second is two city minutes

export const ROADS = buildRoads();

/* ---------- deterministic random ---------- */
export function rand(s: CityState): number {
  let t = (s.rngSeed = (s.rngSeed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));

/* ---------- time helpers ---------- */
export const dayOf = (t: number) => Math.floor(t / DAY) + 1;
export const hourOf = (t: number) => (t % DAY) / 60;
export function clock(t: number): string {
  const m = Math.floor(t % DAY);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export const isNight = (t: number) => { const h = hourOf(t); return h < 6 || h >= 20; };

/* ---------- creation ---------- */
export function newCity(seed = Date.now() & 0xffffff): CityState {
  const { citizens, reserve } = initialHamsters();
  const s: CityState = {
    version: 1, createdAt: new Date().toISOString(), time: START_TIME, speed: 1,
    weather: "sunny", weatherUntil: START_TIME + 300, weatherForced: false, festivalUntil: 0, surgeUntil: 0,
    energy: 2500, generatedToday: 0, consumedToday: 0, lifetimeGenerated: 0, apiBonusTotal: 0,
    apiBonusHour: { hourKey: "", amount: 0 }, rateGen: 0, rateUse: 0, brownout: false,
    buildings: initialBuildings(), trees: initialTrees(), hamsters: citizens, reserve,
    chronicle: [], rewardedEventIds: [], seenEventIds: [], creditedReadings: [], rngSeed: seed,
    lastReviewDay: 0, lastGrowthDay: 0,
  };
  for (const h of s.hamsters) placeAtHome(s, h);
  log(s, "city", "SqueekCity was founded. Twelve hamsters moved into the Residential district.");
  return s;
}

export function building(s: CityState, id: string | null): Building | undefined {
  return id ? s.buildings.find((b) => b.id === id) : undefined;
}

function placeAtHome(s: CityState, h: Hamster) {
  const home = building(s, h.homeId)!;
  h.x = home.door.x; h.y = home.door.y; h.at = home.id; h.activity = "sleeping"; h.intent = "sleeping";
  h.until = s.time + (h.wakeHour * 60 > hourOf(s.time) * 60 ? h.wakeHour * 60 - (s.time % DAY) : 0);
}

export function log(s: CityState, kind: CityState["chronicle"][number]["kind"], text: string, real?: string) {
  s.chronicle.unshift({ t: s.time, kind, text, real });
  if (s.chronicle.length > 160) s.chronicle.length = 160;
}

/* ---------- pathfinding on the road network ---------- */
export function findPath(fx: number, fy: number, tx: number, ty: number): { x: number; y: number }[] {
  const sx = Math.round(fx), sy = Math.round(fy);
  if (sx === tx && sy === ty) return [];
  const key = (x: number, y: number) => y * MAP_W + x;
  const prev = new Map<number, number>();
  const q: number[] = [key(sx, sy)];
  prev.set(q[0], -1);
  const goal = key(tx, ty);
  while (q.length) {
    const k = q.shift()!;
    if (k === goal) break;
    const x = k % MAP_W, y = Math.floor(k / MAP_W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || !ROADS[ny][nx]) continue;
      const nk = key(nx, ny);
      if (!prev.has(nk)) { prev.set(nk, k); q.push(nk); }
    }
  }
  if (!prev.has(goal)) return [{ x: tx, y: ty }];
  const out: { x: number; y: number }[] = [];
  for (let k = goal; k !== -1 && k !== key(sx, sy); k = prev.get(k)!) out.unshift({ x: k % MAP_W, y: Math.floor(k / MAP_W) });
  return out;
}

/* ---------- economy ---------- */
export function capacity(s: CityState): number {
  return 5000 + 3000 * ((building(s, "battery")?.level ?? 1) - 1);
}
export function housingCapacity(s: CityState): number {
  return s.buildings.filter((b) => b.kind === "house").reduce((a, b) => a + 2 + (b.level >= 3 ? 1 : 0), 0);
}
export function upgradeCost(b: Building): number {
  if (b.kind === "lot") return 1500;
  const base: Record<string, number> = { house: 500, wheelhall: 900, battery: 700, hq: 1200, cafe: 600, bistro: 600, market: 500, park: 700, arcade: 500, studio: 600, kitchen: 500, garden: 400 };
  return (base[b.kind] ?? 600) * b.level;
}
export function wheelEfficiency(s: CityState, hallId: string): number {
  return 1 + 0.15 * ((building(s, hallId)?.level ?? 1) - 1);
}
export function leadershipSeats(s: CityState): Record<Rank, number> {
  const hq = building(s, "hq")?.level ?? 1;
  return { Intern: 99, Employee: 99, Senior: 99, "Team Leader": 2 + hq - 1, Manager: 1 + (hq >= 3 ? 1 : 0), Director: 1, CEO: 1 };
}
/** Leaders on shift lift the whole workforce. */
export function teamBonus(s: CityState): number {
  let bonus = 1;
  for (const h of s.hamsters) {
    if (!h.job || h.activity !== "working") continue;
    bonus += ({ "Team Leader": 0.03, Manager: 0.05, Director: 0.06, CEO: 0.08 } as Record<string, number>)[h.job.rank] ?? 0;
  }
  return Math.min(bonus, 1.35);
}
export function greenery(s: CityState): number { return Math.min(10, s.trees.length / 6); }

export function applyUpgrade(s: CityState, id: string, auto = false): { ok: boolean; reason?: string } {
  const b = building(s, id);
  if (!b) return { ok: false, reason: "Unknown building" };
  if (b.level >= b.maxLevel) return { ok: false, reason: "Already at the top level" };
  const cost = upgradeCost(b);
  if (s.energy < cost) return { ok: false, reason: `Needs ${cost} WE, the city has ${Math.floor(s.energy)} WE` };
  s.energy -= cost;
  s.consumedToday += cost;
  if (b.kind === "lot") {
    b.kind = "house"; b.level = 1; b.maxLevel = 3;
    b.name = b.id === "lot1" ? "Hayloft Home" : "Hillside Burrow";
    log(s, "city", `${auto ? "The council" : "You"} built ${b.name} for ${cost} WE. Housing capacity is now ${housingCapacity(s)}.`);
  } else {
    b.level += 1;
    log(s, "economy", `${auto ? "The council" : "You"} upgraded ${b.name} to level ${b.level} for ${cost} WE.`);
  }
  return { ok: true };
}

/* ---------- careers ---------- */
export interface PromotionReq { next: Rank | null; xp: number; perf: number; seatsLeft: number }
export function nextReq(s: CityState, h: Hamster): PromotionReq {
  const j = h.job!;
  const idx = RANKS.indexOf(j.rank);
  const next = RANKS[idx + 1] ?? null;
  const table: Record<string, [number, number]> = {
    Employee: [600, 0], Senior: [2500, 300], "Team Leader": [4500, 400], Manager: [7000, 450], Director: [10000, 480], CEO: [14000, 500],
  };
  if (!next) return { next: null, xp: 0, perf: 0, seatsLeft: 0 };
  const seats = leadershipSeats(s)[next];
  const used = s.hamsters.filter((o) => o.job?.rank === next).length;
  return { next, xp: table[next][0], perf: table[next][1], seatsLeft: Math.max(0, seats - used) };
}
export function performance(h: Hamster): number {
  const hist = h.job?.history.slice(-3) ?? [];
  if (!hist.length) return h.job?.dailyWE ?? 0;
  return hist.reduce((a, d) => a + d.we, 0) / hist.length;
}

function careerReview(s: CityState) {
  const workers = s.hamsters.filter((h) => h.job).sort((a, b) => b.job!.xp - a.job!.xp);
  for (const h of workers) {
    const r = nextReq(s, h);
    if (!r.next) continue;
    if (h.job!.xp >= r.xp && performance(h) >= r.perf && r.seatsLeft > 0) {
      h.job!.rank = r.next;
      h.job!.promotions.push({ day: dayOf(s.time), rank: r.next });
      h.mood = clamp(h.mood + 15);
      h.thought = `Promoted to ${r.next}!`;
      log(s, "career", `${h.name} was promoted to ${r.next} (${Math.floor(h.job!.xp)} XP, ${Math.round(performance(h))} WE/day average).`);
    }
  }
}

/* ---------- daily cycle ---------- */
function endOfDay(s: CityState) {
  const day = dayOf(s.time) - 1;
  for (const h of s.hamsters) {
    if (!h.job) continue;
    h.job.history.push({ day, we: Math.round(h.job.dailyWE), minutes: Math.round(h.job.minutesToday) });
    if (h.job.history.length > 14) h.job.history.shift();
    h.job.dailyWE = 0; h.job.minutesToday = 0;
  }
  log(s, "economy", `Day ${day} closed: generated ${Math.round(s.generatedToday)} WE, used ${Math.round(s.consumedToday)} WE.`);
  s.generatedToday = 0; s.consumedToday = 0;
}

function cityGrowth(s: CityState) {
  const pop = s.hamsters.length;
  const avgMood = s.hamsters.reduce((a, h) => a + h.mood, 0) / pop;
  // The council builds a home on a free lot when the city is rich and content.
  const lot = s.buildings.find((b) => b.kind === "lot");
  if (lot && s.energy >= upgradeCost(lot) + 1500 && avgMood >= 60 && housingCapacity(s) <= pop) {
    applyUpgrade(s, lot.id, true);
  }
  if (pop < Math.min(MAX_POP, housingCapacity(s)) && avgMood >= 58 && s.energy >= 800 && s.reserve.length) {
    const home = s.buildings.filter((b) => b.kind === "house").find((b) => s.hamsters.filter((h) => h.homeId === b.id).length < 2 + (b.level >= 3 ? 1 : 0));
    if (!home) return;
    const h = s.reserve.shift()!;
    h.homeId = home.id;
    h.job!.hiredDay = dayOf(s.time);
    for (const o of s.hamsters) { h.relationships[o.id] = 5; o.relationships[h.id] = 5; }
    s.energy -= 300; s.consumedToday += 300;
    s.hamsters.push(h);
    h.x = 12; h.y = 0; h.at = null; h.activity = "walking"; h.intent = "home"; h.target = home.id;
    h.path = findPath(12, 0, home.door.x, home.door.y);
    log(s, "city", `${h.name} moved into ${home.name} (average mood ${Math.round(avgMood)}). Population ${s.hamsters.length}/${MAX_POP}.`);
  }
}

/* ---------- weather ---------- */
export function setWeather(s: CityState, w: Weather, hours: number, forced: boolean) {
  const changed = s.weather !== w;
  s.weather = w; s.weatherUntil = s.time + hours * 60; s.weatherForced = forced;
  if (changed && w === "rain") onRainStart(s);
  if (changed) log(s, forced ? "god" : "weather", forced
    ? (w === "rain" ? "You called the rain. Hamsters without umbrellas head for shelter." : "You brought out the sun. Parks and gardens fill up.")
    : (w === "rain" ? "Rain rolls in over SqueekCity." : w === "sunny" ? "The sun comes out." : "Clouds drift over the city."));
}

function onRainStart(s: CityState) {
  for (const h of s.hamsters) {
    const outdoorsHere = h.activity === "walking" || (h.at && building(s, h.at)?.outdoor);
    if (!outdoorsHere) continue;
    if (h.hasUmbrella && h.activity === "walking") { h.thought = "Good thing I brought my umbrella"; continue; }
    // leave the park / garden, or duck into the nearest building
    const near = nearestShelter(s, h);
    goTo(s, h, near, "sheltering", "Run for shelter!");
  }
}

function nearestShelter(s: CityState, h: Hamster): Building {
  let best: Building = building(s, h.homeId)!, bd = 1e9;
  for (const b of s.buildings) {
    if (b.outdoor || b.kind === "lot" || b.kind === "battery") continue;
    const d = Math.abs(b.door.x - h.x) + Math.abs(b.door.y - h.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/* ---------- hamster brain ---------- */
function goTo(s: CityState, h: Hamster, b: Building, intent: Activity, thought: string) {
  if (h.at) { const prev = building(s, h.at); if (prev) { h.x = prev.door.x; h.y = prev.door.y; } }
  h.at = null; h.target = b.id; h.intent = intent; h.activity = "walking"; h.thought = thought; h.wander = null;
  h.path = findPath(h.x, h.y, b.door.x, b.door.y);
}

function stay(s: CityState, h: Hamster, b: Building, activity: Activity, minutes: number, thought: string) {
  h.at = b.id; h.activity = activity; h.until = s.time + minutes; h.thought = thought; h.target = null;
  if (b.outdoor) h.wander = { x: b.x + rand(s) * b.w, y: b.y + rand(s) * b.h };
}

function weighted<T>(s: CityState, items: [T, number][]): T {
  const total = items.reduce((a, [, w]) => a + Math.max(0, w), 0);
  let r = rand(s) * total;
  for (const [v, w] of items) { r -= Math.max(0, w); if (r <= 0) return v; }
  return items[0][0];
}

function inWindow(hour: number, a: number, b: number) { return a <= b ? hour >= a && hour < b : hour >= a || hour < b; }

export function decide(s: CityState, h: Hamster) {
  const hour = hourOf(s.time);
  const home = building(s, h.homeId)!;
  const raining = s.weather === "rain";
  const festival = s.time < s.festivalUntil;
  const where = h.at;
  const at = (id: string, act: Activity, min: number, thought: string) => {
    const b = building(s, id)!;
    if (where === id) stay(s, h, b, act, min, thought); else goTo(s, h, b, act, thought);
  };

  // 1. Night: go home and sleep until wake hour
  if (!inWindow(hour, h.wakeHour, h.sleepHour) || h.stamina < 12) {
    const wakeIn = ((h.wakeHour * 60 - (s.time % DAY)) + DAY) % DAY || 60;
    return at(home.id, "sleeping", h.stamina < 12 && inWindow(hour, h.wakeHour, h.sleepHour) ? 120 : wakeIn, "Time for bed");
  }
  // 2. Hungry: eat at home in the morning/evening, otherwise a cafe or the commons kitchen
  if (h.hunger > 62) {
    if (hour < 8 || hour >= 18) return at(home.id, "eating", 35, "Family meal at home");
    const places: [string, number][] = [["cafe", raining ? 1 : 2], ["bistro", h.personality === "Foodie" ? 3 : 1], ["kitchen", 1]];
    return at(weighted(s, places), "eating", 35, "Seeds, please!");
  }
  // 3. Work shift at the Wheel Corporation
  if (h.job && inWindow(hour, h.workStart, h.workEnd - (festival ? 1 : 0)) && h.stamina > 22) {
    const lazySkip = h.personality === "Lazy" && rand(s) < 0.06;
    if (!lazySkip) return at(h.job.hall, "working", 60 + Math.floor(rand(s) * 50), "Wheel shift");
  }
  // 4. Festival draws everyone who is free
  if (festival) return at("park", "festival", 60, raining ? "Festival under umbrellas!" : "Festival!");
  // 5. Rest when tired
  if (h.stamina < 35) return at(home.id, "home", 60, "Need a nap");
  // 6. Leisure, shaped by weather, personality and loneliness
  const lonely = h.social < 40;
  const sunny = s.weather === "sunny";
  const outdoorW = raining ? (h.hasUmbrella && h.personality === "Energetic" ? 0.5 : 0.05) : sunny ? 3 : 1.5;
  const friend = Object.entries(h.relationships).sort((a, b) => b[1] - a[1]).map(([id]) => s.hamsters.find((o) => o.id === id)).find((o) => o && o.homeId !== h.homeId);
  const opts: [string, number][] = [
    ["park", outdoorW * (lonely || h.personality === "Social" ? 2 : 1) * (h.personality === "Energetic" ? 1.5 : 1)],
    ["garden", outdoorW * 0.8],
    ["market", 1 + (h.hasUmbrella ? 0 : raining ? 1.5 : 0.3)],
    ["arcade", (raining ? 2 : 0.8) * (h.personality === "Shy" ? 0.5 : 1)],
    ["studio", raining ? 1.6 : 0.8],
    ["cafe", lonely ? 1.5 : 0.6],
    ["home", h.personality === "Shy" || h.personality === "Lazy" ? 2 : 0.7],
    ["visit", lonely && friend ? 1.5 : 0.3],
  ];
  const choice = weighted(s, opts);
  const dur = 45 + Math.floor(rand(s) * 50);
  switch (choice) {
    case "park": return at("park", "park", dur, sunny ? "Sunshine in Clover Park" : "A walk in the park");
    case "garden": return at("garden", "garden", dur, "Tending the neighbour garden");
    case "market": return at("market", "shopping", 40, h.hasUmbrella ? "Browsing for seeds" : "Maybe an umbrella?");
    case "arcade": return at("arcade", "arcade", dur, "Tunnel racing at the arcade");
    case "studio": return at("studio", "studio", dur, "Watching Squeek Live");
    case "cafe": return at("cafe", "socializing", dur, "Coffee with friends");
    case "visit": if (friend) return at(friend.homeId, "visiting", dur, `Visiting ${friend.name.split(" ")[0]}`);
    // falls through
    default: return at(home.id, "home", dur, "Cozy time at home");
  }
}

/* ---------- per-minute simulation ---------- */
function arrive(s: CityState, h: Hamster) {
  const b = building(s, h.target)!;
  const act = h.intent;
  const dur = act === "sleeping" ? Math.max(30, h.until - s.time) : act === "sheltering" ? 40 : act === "working" ? 60 + Math.floor(rand(s) * 50) : act === "eating" ? 35 : 45 + Math.floor(rand(s) * 45);
  if (act === "sleeping") {
    const wakeIn = ((h.wakeHour * 60 - (s.time % DAY)) + DAY) % DAY || 60;
    stay(s, h, b, "sleeping", h.stamina < 12 && inWindow(hourOf(s.time), h.wakeHour, h.sleepHour) ? 120 : wakeIn, "Zzz");
  } else stay(s, h, b, act, dur, h.thought);
  if (act === "shopping" && !h.hasUmbrella && (building(s, "market")?.level ?? 1) >= 1 && rand(s) < 0.35 + 0.2 * ((building(s, "market")?.level ?? 1) - 1)) {
    h.hasUmbrella = true; h.thought = "Bought an umbrella at Pip's Market";
  }
}

function walk(s: CityState, h: Hamster, minutes: number) {
  let budget = minutes * (1.1 + (h.personality === "Energetic" ? 0.25 : 0) - (h.stamina < 30 ? 0.3 : 0));
  while (budget > 0 && h.path.length) {
    const n = h.path[0];
    const dx = n.x - h.x, dy = n.y - h.y, d = Math.hypot(dx, dy);
    if (d <= budget) { h.x = n.x; h.y = n.y; h.path.shift(); budget -= d; }
    else { h.x += (dx / d) * budget; h.y += (dy / d) * budget; budget = 0; }
  }
  if (!h.path.length) arrive(s, h);
}

function socialize(s: CityState) {
  const groups = new Map<string, Hamster[]>();
  for (const h of s.hamsters) if (h.at && h.activity !== "sleeping") {
    const g = groups.get(h.at) ?? []; g.push(h); groups.set(h.at, g);
  }
  for (const [bid, g] of groups) {
    if (g.length < 2) continue;
    const b = building(s, bid)!;
    const social = ["park", "socializing", "festival", "garden", "visiting", "eating", "home", "arcade", "studio", "working"];
    for (const h of g) {
      if (!social.includes(h.activity)) continue;
      const gain = b.kind === "park" ? 0.5 + 0.15 * (b.level - 1) : h.activity === "working" ? 0.08 : 0.3;
      h.social = clamp(h.social + gain);
      for (const o of g) if (o !== h) h.relationships[o.id] = clamp((h.relationships[o.id] ?? 0) + 0.02, -100, 100);
    }
    if (rand(s) < 0.004 && g.length >= 2 && b.kind !== "wheelhall") {
      const [a, c] = [g[0], g[1]];
      const family = a.family.includes(c.id);
      log(s, "social", family
        ? `${a.name.split(" ")[0]} and ${c.name.split(" ")[0]} shared a family moment at ${b.name}.`
        : `${a.name.split(" ")[0]} and ${c.name.split(" ")[0]} chatted at ${b.name}.`);
    }
  }
}

function minute(s: CityState) {
  const prevDay = dayOf(s.time);
  s.time += 1;
  const hour = hourOf(s.time);
  if (dayOf(s.time) !== prevDay) endOfDay(s);
  const day = dayOf(s.time);
  if (hour >= 20 && s.lastReviewDay < day) { s.lastReviewDay = day; careerReview(s); }
  if (hour >= 8 && s.lastGrowthDay < day) { s.lastGrowthDay = day; cityGrowth(s); }

  // weather
  if (s.time >= s.weatherUntil) {
    const next = weighted<Weather>(s, [["sunny", 4], ["cloudy", 3], ["rain", 2]]);
    setWeather(s, next, 3 + Math.floor(rand(s) * 5), false);
  }
  const raining = s.weather === "rain";
  const festival = s.time < s.festivalUntil;
  const green = greenery(s);

  let gen = 0;
  const eff = teamBonus(s);
  for (const h of s.hamsters) {
    // needs
    h.hunger = clamp(h.hunger + (h.activity === "sleeping" ? 0.025 : h.activity === "working" ? 0.08 : 0.05));
    const homeLvl = building(s, h.homeId)?.level ?? 1;
    if (h.activity === "sleeping") h.stamina = clamp(h.stamina + 0.16 + 0.04 * (homeLvl - 1));
    else if (h.activity === "home") h.stamina = clamp(h.stamina + 0.08);
    else if (h.activity === "working") h.stamina = clamp(h.stamina - 0.22 * (1 - (h.job?.endurance ?? 1) * 0.04));
    else h.stamina = clamp(h.stamina - 0.04);
    if (h.activity === "eating") {
      const b = building(s, h.at);
      h.hunger = clamp(h.hunger - 2.2 - 0.6 * ((b?.level ?? 1) - 1));
    }
    if (!["socializing", "park", "festival", "visiting", "garden"].includes(h.activity)) h.social = clamp(h.social - 0.025);

    // mood drifts toward a target shaped by needs, weather, home, trees and events
    const outdoors = h.activity === "walking" || ["park", "garden", "festival"].includes(h.activity);
    let target = 52 + green + 3 * (homeLvl - 1);
    if (s.weather === "sunny") target += outdoors ? 9 : 3;
    if (raining && outdoors && !h.hasUmbrella) target -= 14;
    if (raining && !outdoors) target -= 2;
    if (festival) target += 14;
    if (h.hunger > 70) target -= 15;
    if (h.stamina < 20) target -= 10;
    if (h.social < 30) target -= 8;
    if (h.social > 70) target += 5;
    if (s.brownout) target -= 15;
    if (["arcade", "studio", "shopping"].includes(h.activity)) target += 4 + 2 * ((building(s, h.at)?.level ?? 1) - 1);
    if (["park", "garden"].includes(h.activity)) target += 3 * ((building(s, h.at)?.level ?? 1) - 1);
    if (["eating"].includes(h.activity)) target += 2 * ((building(s, h.at)?.level ?? 1) - 1);
    h.mood = clamp(h.mood + (target - h.mood) * 0.01);

    // work produces Wheel Energy
    if (h.activity === "working" && h.job) {
      const we = 1.25 * (0.55 + 0.45 * h.stamina / 100) * (1 + h.job.speed * 0.05) * wheelEfficiency(s, h.job.hall) * eff * (0.8 + 0.4 * h.mood / 100);
      h.job.dailyWE += we; h.job.lifetimeWE += we; h.job.xp += we; h.job.minutesToday += 1;
      if (rand(s) < 0.004) h.job.speed = Math.min(10, h.job.speed + 0.1);
      if (rand(s) < 0.004) h.job.endurance = Math.min(10, h.job.endurance + 0.1);
      gen += we;
    }

    // movement and activity transitions
    if (h.activity === "walking") walk(s, h, 1);
    else if (s.time >= h.until) decide(s, h);
    else if (h.activity === "working" && h.stamina < 15) decide(s, h);
    else if (h.activity !== "sleeping" && h.activity !== "eating" && h.activity !== "working" && h.hunger > 80) decide(s, h);
    else if (h.wander && rand(s) < 0.05) {
      const b = building(s, h.at)!;
      h.wander = { x: b.x + 0.3 + rand(s) * (b.w - 0.6), y: b.y + 0.3 + rand(s) * (b.h - 0.6) };
    }
  }
  socialize(s);

  // consumption: homes and facilities draw power, more at night when lights are on
  const night = isNight(s.time) ? 1.4 : 1;
  let use = 0;
  for (const b of s.buildings) {
    if (b.kind === "lot") continue;
    const base = b.kind === "house" ? 0.12 + 0.04 * b.level : b.outdoor ? 0.04 : b.kind === "wheelhall" || b.kind === "battery" ? 0.04 : 0.09 + 0.02 * b.level;
    use += base * night;
  }
  use += s.trees.length * 0.002;
  const cap = capacity(s);
  const before = s.energy;
  s.energy = Math.min(cap, s.energy + gen);
  const drawn = Math.min(s.energy, use);
  s.energy = Math.max(0, s.energy - use);
  s.brownout = drawn < use - 1e-6;
  s.generatedToday += Math.max(0, Math.min(gen, cap - before));
  s.lifetimeGenerated += gen;
  s.consumedToday += drawn;
  s.rateGen = s.rateGen * 0.97 + gen * 0.03;
  s.rateUse = s.rateUse * 0.97 + use * 0.03;
}

export function step(s: CityState, gameMinutes: number) {
  for (let i = 0; i < gameMinutes; i++) minute(s);
}

/* ---------- god mode ---------- */
export function godSun(s: CityState) { setWeather(s, "sunny", 6, true); for (const h of s.hamsters) if (h.activity === "sheltering") h.until = s.time; }
export function godRain(s: CityState) { setWeather(s, "rain", 4, true); }
export const FESTIVAL_COST = 300;
export function godFestival(s: CityState): { ok: boolean; reason?: string } {
  if (s.time < s.festivalUntil) return { ok: false, reason: "A festival is already running" };
  if (s.energy < FESTIVAL_COST) return { ok: false, reason: `A festival needs ${FESTIVAL_COST} WE` };
  s.energy -= FESTIVAL_COST; s.consumedToday += FESTIVAL_COST;
  s.festivalUntil = s.time + 180;
  for (const h of s.hamsters) {
    if (h.activity === "sleeping" || h.activity === "working" || h.activity === "eating") continue;
    h.until = s.time; // re-decide now: the festival wins
  }
  log(s, "god", `You opened a festival in Clover Park for ${FESTIVAL_COST} WE. Free hamsters are on their way.`);
  return { ok: true };
}
export const TREE_COST = 120;
export const MAX_TREES = 70;
export function godTrees(s: CityState): { ok: boolean; reason?: string } {
  if (s.trees.length >= MAX_TREES) return { ok: false, reason: "No room left for more trees" };
  if (s.energy < TREE_COST) return { ok: false, reason: `Planting needs ${TREE_COST} WE` };
  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (ROADS[y][x]) continue;
    if (s.trees.some((t) => t.x === x && t.y === y)) continue;
    if (s.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) continue;
    free.push({ x, y });
  }
  if (!free.length) return { ok: false, reason: "No free ground" };
  s.energy -= TREE_COST; s.consumedToday += TREE_COST;
  const n = Math.min(3, free.length);
  for (let i = 0; i < n; i++) {
    const t = free.splice(Math.floor(rand(s) * free.length), 1)[0];
    s.trees.push({ ...t, kind: Math.floor(rand(s) * 3) });
  }
  log(s, "god", `You planted ${n} trees for ${TREE_COST} WE. Greenery lifts everyone's mood a little.`);
  return { ok: true };
}

/* ---------- real wheel bonus (called by the API layer) ---------- */
export const BONUS_PER_READING_CAP = 25;
export const BONUS_PER_HOUR_CAP = 300;
export const MILESTONE_BONUS = 150;
export function creditWheelReading(s: CityState, key: string, rpm: number, now: Date): number {
  if (s.creditedReadings.includes(key)) return 0;
  const hourKey = now.toISOString().slice(0, 13);
  if (s.apiBonusHour.hourKey !== hourKey) s.apiBonusHour = { hourKey, amount: 0 };
  const room = Math.max(0, BONUS_PER_HOUR_CAP - s.apiBonusHour.amount);
  const amount = Math.min(BONUS_PER_READING_CAP, Math.round(rpm * 0.3), room, capacity(s) - s.energy);
  s.creditedReadings.push(key);
  if (s.creditedReadings.length > 300) s.creditedReadings.shift();
  if (amount <= 0) return 0;
  s.energy += amount; s.apiBonusHour.amount += amount; s.apiBonusTotal += amount; s.generatedToday += amount;
  s.surgeUntil = s.time + 60;
  return amount;
}
export function creditMilestone(s: CityState, id: string, text: string, occurredAt: string): number {
  if (s.seenEventIds.includes(id)) return 0;
  s.seenEventIds.push(id);
  if (s.seenEventIds.length > 400) s.seenEventIds.shift();
  const eligible = Date.parse(occurredAt) >= Date.parse(s.createdAt);
  if (!eligible || s.rewardedEventIds.includes(id)) {
    log(s, "api", `${text} (recorded before this city was founded, no bonus)`, occurredAt);
    return 0;
  }
  s.rewardedEventIds.push(id);
  const amount = Math.min(MILESTONE_BONUS, capacity(s) - s.energy);
  s.energy += Math.max(0, amount); s.apiBonusTotal += Math.max(0, amount);
  s.surgeUntil = s.time + 120;
  log(s, "api", `${text}. The city received a ${Math.max(0, amount)} WE milestone bonus.`, occurredAt);
  return amount;
}
