import type { Activity, Building, CityState } from "./types";
import { building, findPath, log } from "./engine";

export interface BuildingAction { label: string; cost: number; help: string; run: (s: CityState) => string }

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Free hamsters (awake, not working, eating or already walking) accept an invitation. */
function invite(s: CityState, b: Building, act: Activity, thought: string, max = 5): number {
  let n = 0;
  for (const h of s.hamsters) {
    if (n >= max) break;
    if (["sleeping", "working", "eating", "walking"].includes(h.activity) || h.at === b.id) continue;
    const from = building(s, h.at);
    if (from) { h.x = from.door.x; h.y = from.door.y; }
    h.at = null; h.target = b.id; h.intent = act; h.activity = "walking"; h.thought = thought; h.wander = null;
    h.path = findPath(h.x, h.y, b.door.x, b.door.y);
    n++;
  }
  return n;
}

function spend(s: CityState, cost: number) { s.energy -= cost; s.consumedToday += cost; }

export function actionsFor(b: Building): BuildingAction[] {
  switch (b.kind) {
    case "house": return [{
      label: "Family dinner", cost: 40, help: "Residents who are home eat together: less hunger, better mood and family bonds.",
      run: (s) => {
        const home = s.hamsters.filter((h) => h.homeId === b.id && h.at === b.id && h.activity !== "sleeping");
        if (!home.length) return "Nobody is awake at home right now.";
        spend(s, 40);
        for (const h of home) { h.hunger = clamp(h.hunger - 35); h.mood = clamp(h.mood + 6); h.social = clamp(h.social + 12); h.thought = "Family dinner!"; for (const o of home) if (o !== h) h.relationships[o.id] = Math.min(100, (h.relationships[o.id] ?? 0) + 5); }
        log(s, "social", `${home.map((h) => h.name.split(" ")[0]).join(", ")} shared a family dinner at ${b.name}.`);
        return `${home.length} hamster${home.length > 1 ? "s" : ""} enjoyed dinner.`;
      },
    }];
    case "kitchen": return [{
      label: "Ring the dinner bell", cost: 60, help: "Free hamsters come to the commons kitchen to eat.",
      run: (s) => { spend(s, 60); const n = invite(s, b, "eating", "Dinner bell!"); log(s, "social", `The dinner bell rang at ${b.name}; ${n} hamsters came to eat.`); return `${n} hamsters are on their way.`; },
    }];
    case "garden": return [{
      label: "Community planting", cost: 50, help: "Neighbours gather to garden together, raising social contact.",
      run: (s) => { spend(s, 50); const n = invite(s, b, "garden", "Planting with the neighbours"); return `${n} neighbours are coming to the garden.`; },
    }];
    case "wheelhall": return [{
      label: "Hand out sunflower snacks", cost: 80, help: "Workers on shift here regain stamina and keep running longer.",
      run: (s) => {
        const w = s.hamsters.filter((h) => h.at === b.id && h.activity === "working");
        if (!w.length) return "Nobody is running in this hall right now.";
        spend(s, 80);
        for (const h of w) { h.stamina = clamp(h.stamina + 25); h.hunger = clamp(h.hunger - 10); h.thought = "Snack power!"; }
        log(s, "economy", `${w.length} wheel runners in ${b.name} got sunflower snacks.`);
        return `${w.length} runners refreshed.`;
      },
    }];
    case "hq": return [{
      label: "Team meeting", cost: 60, help: "Every worker on shift gains 40 XP towards promotion.",
      run: (s) => {
        const w = s.hamsters.filter((h) => h.job && h.activity === "working");
        if (!w.length) return "No one is on shift right now.";
        spend(s, 60);
        for (const h of w) h.job!.xp += 40;
        log(s, "career", `A team meeting at ${b.name} gave ${w.length} workers 40 XP each.`);
        return `${w.length} workers gained 40 XP.`;
      },
    }];
    case "cafe": case "bistro": return [{
      label: "Seed tasting", cost: 50, help: "Free hamsters come to eat and chat.",
      run: (s) => { spend(s, 50); const n = invite(s, b, "eating", "Free seed tasting!"); return `${n} hamsters are heading to ${b.name}.`; },
    }];
    case "market": return [{
      label: "Umbrella sale", cost: 60, help: "Everyone in the market now gets an umbrella; free hamsters come shopping.",
      run: (s) => {
        spend(s, 60);
        for (const h of s.hamsters) if (h.at === b.id) h.hasUmbrella = true;
        const n = invite(s, b, "shopping", "Umbrella sale!");
        log(s, "economy", `Pip's Market held an umbrella sale; ${n} shoppers are coming.`);
        return `Umbrellas handed out; ${n} shoppers on the way.`;
      },
    }];
    case "park": return [{
      label: "Picnic", cost: 40, help: "Free hamsters gather in the park to socialise. Weather still matters.",
      run: (s) => { spend(s, 40); const n = invite(s, b, "park", "Picnic in Clover Park"); return `${n} hamsters are coming for a picnic.`; },
    }];
    case "arcade": return [{
      label: "Tournament night", cost: 50, help: "Free hamsters come to race tunnels together.",
      run: (s) => { spend(s, 50); const n = invite(s, b, "arcade", "Tunnel tournament!"); return `${n} players are on their way.`; },
    }];
    case "studio": return [{
      label: "Screening party", cost: 50, help: "Free hamsters come to watch the real wheel stream together.",
      run: (s) => { spend(s, 50); const n = invite(s, b, "studio", "Watching Squeek Live"); return `${n} viewers are coming.`; },
    }];
    default: return [];
  }
}

export const UPGRADE_EFFECT: Record<string, string> = {
  house: "Taller home, faster sleep recovery and +3 mood for residents. Level 3 adds a third bed.",
  lot: "Build a new home so the city can grow.",
  kitchen: "Bigger kitchen: meals fill hamsters up faster.",
  garden: "Flowers bloom: more mood for gardeners.",
  hq: "Opens one more Team Leader seat (level 3 also adds a Manager seat).",
  wheelhall: "+15% wheel efficiency for everyone running here. Level 3 gets golden wheels.",
  battery: "+3,000 WE storage and more battery cells.",
  cafe: "Terrace tables: faster meals and better mood.",
  bistro: "Terrace tables: faster meals and better mood.",
  market: "More stock: better odds of buying an umbrella, more mood while shopping.",
  park: "Level 2 adds a fountain, level 3 flower beds: more mood and social.",
  arcade: "New cabinets: more mood while playing.",
  studio: "Better screens: more mood while watching.",
};
