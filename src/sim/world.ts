import type { Building, DistrictId, Hamster, Personality, Job } from "./types";

export const MAP_W = 26;
export const MAP_H = 26;

export const DISTRICTS: Record<DistrictId, { name: string; x0: number; y0: number; x1: number; y1: number; blurb: string }> = {
  residential: { name: "Residential", x0: 0, y0: 0, x1: 11, y1: 11, blurb: "Homes, family dinners and neighbours" },
  corp: { name: "Wheel Corporation", x0: 13, y0: 0, x1: 25, y1: 11, blurb: "Wheel halls, energy and careers" },
  downtown: { name: "Downtown", x0: 0, y0: 13, x1: 25, y1: 25, blurb: "Cafes, market, park and the Live Studio" },
};

export function districtAt(x: number, y: number): DistrictId | null {
  for (const id of Object.keys(DISTRICTS) as DistrictId[]) {
    const d = DISTRICTS[id];
    if (x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1) return id;
  }
  return null;
}

/** Road tiles: the walkable network every hamster navigates on. */
export function buildRoads(): boolean[][] {
  const r: boolean[][] = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
  const h = (y: number, x0: number, x1: number) => { for (let x = x0; x <= x1; x++) r[y][x] = true; };
  const v = (x: number, y0: number, y1: number) => { for (let y = y0; y <= y1; y++) r[y][x] = true; };
  h(12, 0, 25);   // main avenue
  v(12, 0, 25);   // main street
  h(5, 1, 24);    // residential + corporation lane
  h(18, 1, 24);   // downtown boulevard
  v(23, 13, 18);  // east connector
  return r;
}

const b = (id: string, name: string, kind: Building["kind"], district: DistrictId, x: number, y: number, w: number, h: number,
  door: [number, number], maxLevel = 3, outdoor = false): Building =>
  ({ id, name, kind, district, x, y, w, h, door: { x: door[0], y: door[1] }, level: kind === "lot" ? 0 : 1, maxLevel, outdoor });

export function initialBuildings(): Building[] {
  return [
    // Residential
    b("h1", "Seedpod Cottage", "house", "residential", 1, 3, 2, 2, [2, 5]),
    b("h2", "Clover Burrow", "house", "residential", 4, 3, 2, 2, [5, 5]),
    b("h3", "Sunflower Row", "house", "residential", 7, 3, 2, 2, [8, 5]),
    b("h4", "Bedding Villa", "house", "residential", 1, 6, 2, 2, [2, 5]),
    b("h5", "Tunnel House", "house", "residential", 4, 6, 2, 2, [5, 5]),
    b("h6", "Whisker Flat", "house", "residential", 7, 6, 2, 2, [8, 5]),
    b("kitchen", "Acorn Commons Kitchen", "kitchen", "residential", 9, 3, 2, 2, [10, 5]),
    b("lot1", "Burrow Lot", "lot", "residential", 9, 6, 2, 2, [10, 5], 3),
    b("garden", "Neighbour Garden", "garden", "residential", 1, 9, 4, 3, [3, 12], 3, true),
    b("lot2", "Hillside Lot", "lot", "residential", 7, 9, 2, 2, [8, 12], 3),
    // Wheel Corporation
    b("hq", "Wheel Works HQ", "hq", "corp", 14, 1, 3, 3, [15, 5], 3),
    b("hallA", "Wheel Hall A", "wheelhall", "corp", 19, 1, 4, 3, [20, 5], 4),
    b("hallB", "Wheel Hall B", "wheelhall", "corp", 19, 7, 4, 3, [20, 5], 4),
    b("battery", "Battery Depot", "battery", "corp", 14, 7, 3, 3, [15, 5], 4),
    // Downtown
    b("cafe", "Sunflower Cafe", "cafe", "downtown", 2, 14, 3, 3, [3, 18]),
    b("market", "Pip's Market", "market", "downtown", 6, 14, 3, 3, [7, 18]),
    b("studio", "Squeek Live Studio", "studio", "downtown", 14, 14, 3, 3, [15, 18]),
    b("bistro", "Cheese Bistro", "bistro", "downtown", 18, 14, 3, 3, [19, 18]),
    b("park", "Clover Park", "park", "downtown", 2, 20, 7, 4, [5, 18], 3, true),
    b("arcade", "Tunnel Arcade", "arcade", "downtown", 14, 20, 3, 3, [15, 18]),
  ];
}

export function initialTrees(): { x: number; y: number; kind: number }[] {
  const t: [number, number][] = [
    [0, 1], [3, 1], [6, 1], [9, 1], [10, 9], [10, 10], [5, 10], [6, 10], [0, 7], [0, 10],
    [24, 1], [24, 3], [24, 7], [24, 9], [13, 9], [17, 9], [17, 2],
    [0, 15], [10, 14], [10, 16], [1, 24], [10, 21], [11, 23], [17, 16], [21, 21], [24, 15], [19, 24], [24, 23], [13, 24],
  ];
  return t.map(([x, y], i) => ({ x, y, kind: i % 3 }));
}

const job = (rank: Job["rank"], xp: number, hall: string, slot: number, endurance: number, speed: number): Job => ({
  employer: "Wheel Corporation", rank, xp, endurance, speed, dailyWE: 0, lifetimeWE: Math.round(xp * 0.9),
  minutesToday: 0, history: [], promotions: [], hall, wheelSlot: slot, hiredDay: 1,
});

function ham(id: string, name: string, age: number, personality: Personality, fur: string, homeId: string,
  family: string[], j: Job | null, sched: [number, number, number, number], umbrella: boolean): Hamster {
  return {
    id, name, age, personality, fur, homeId, family, relationships: {}, job: j,
    hunger: 30, stamina: 80, mood: 65, social: 60, hasUmbrella: umbrella,
    wakeHour: sched[0], sleepHour: sched[1], workStart: sched[2], workEnd: sched[3],
    activity: "sleeping", intent: "sleeping", at: homeId, target: null, path: [], x: 0, y: 0, until: 0,
    thought: "Zzz", wander: null,
  };
}

export function initialHamsters(): { citizens: Hamster[]; reserve: Hamster[] } {
  const citizens: Hamster[] = [
    ham("pip", "Pip Whiskerton", 3, "Ambitious", "#c99762", "h1", ["poppy"], job("Senior", 2600, "hallA", 0, 6, 6), [6, 22, 8, 16], true),
    ham("poppy", "Poppy Whiskerton", 3, "Social", "#e2b98a", "h1", ["pip"], job("Employee", 1100, "hallA", 1, 4, 5), [7, 23, 9, 17], false),
    ham("biscuit", "Biscuit Oatley", 2, "Energetic", "#d4a775", "h2", ["crumb", "nibbles"], job("Employee", 1500, "hallA", 2, 7, 5), [5, 21, 7, 15], false),
    ham("crumb", "Crumb Oatley", 2, "Foodie", "#b07a4f", "h2", ["biscuit", "nibbles"], job("Intern", 200, "hallB", 0, 3, 3), [7, 22, 10, 18], true),
    ham("nibbles", "Nibbles Oatley", 0.5, "Energetic", "#f0d2a8", "h2", ["biscuit", "crumb"], null, [7, 20, 0, 0], false),
    ham("hazel", "Hazel Bramble", 4, "Shy", "#8e6a4c", "h3", [], job("Senior", 2200, "hallB", 1, 8, 4), [6, 21, 8, 16], true),
    ham("mochi", "Mochi Tanaka", 2, "Lazy", "#f4e3c8", "h4", ["sesame"], job("Intern", 350, "hallB", 2, 3, 4), [8, 23, 10, 17], false),
    ham("sesame", "Sesame Tanaka", 2, "Foodie", "#3b3030", "h4", ["mochi"], job("Employee", 900, "hallA", 3, 5, 4), [7, 22, 9, 17], true),
    ham("gus", "Gus Peanutworth", 5, "Social", "#a98258", "h5", ["daisy"], null, [6, 21, 0, 0], true),
    ham("daisy", "Daisy Peanutworth", 1, "Ambitious", "#e0c59b", "h5", ["gus"], job("Intern", 450, "hallB", 3, 4, 6), [6, 22, 8, 16], false),
    ham("rolo", "Rolo Fennick", 3, "Energetic", "#7a5a3a", "h6", ["juniper"], job("Employee", 1300, "hallA", 4, 6, 7), [5, 21, 7, 15], false),
    ham("juniper", "Juniper Fennick", 3, "Shy", "#cfa57d", "h6", ["rolo"], job("Intern", 300, "hallB", 4, 5, 3), [7, 22, 9, 17], true),
  ];
  const reserve: Hamster[] = [
    ham("tofu", "Tofu Haywood", 1, "Social", "#efe6d6", "", [], job("Intern", 0, "hallA", 5, 3, 3), [7, 22, 9, 17], false),
    ham("pepper", "Pepper Quill", 2, "Ambitious", "#5a4636", "", [], job("Intern", 0, "hallB", 5, 4, 4), [6, 22, 8, 16], true),
    ham("maple", "Maple Dewberry", 2, "Foodie", "#c58b55", "", [], job("Intern", 0, "hallA", 6, 3, 5), [7, 23, 10, 18], false),
  ];
  // neighbours start with mild affinity, families with strong affinity
  for (const h of citizens) {
    for (const o of citizens) if (o.id !== h.id) h.relationships[o.id] = h.family.includes(o.id) ? 80 : 10;
  }
  return { citizens, reserve };
}
