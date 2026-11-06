import { describe, expect, it } from "vitest";
import {
  newCity, step, DAY, capacity, applyUpgrade, godRain, godFestival, godTrees, godSun, building,
  creditWheelReading, creditMilestone, BONUS_PER_HOUR_CAP, MAX_POP, hourOf, findPath,
} from "./engine";

describe("SqueekCity simulation", () => {
  it("citizens follow daily routines: sleep, commute, work, eat", () => {
    const s = newCity(42);
    const seen = new Map<string, Set<string>>();
    for (let i = 0; i < DAY; i += 5) {
      step(s, 5);
      for (const h of s.hamsters) {
        const set = seen.get(h.id) ?? new Set(); set.add(h.activity); seen.set(h.id, set);
      }
    }
    const pip = seen.get("pip")!;
    expect(pip.has("working")).toBe(true);
    expect(pip.has("walking")).toBe(true);
    expect(pip.has("sleeping")).toBe(true);
    expect(pip.has("eating")).toBe(true);
    // the pup never works
    expect(seen.get("nibbles")!.has("working")).toBe(false);
  });

  it("produces Wheel Energy and keeps storage within bounds", () => {
    const s = newCity(7);
    for (let d = 0; d < 3; d++) {
      for (let i = 0; i < DAY; i += 10) { step(s, 10); expect(s.energy).toBeGreaterThanOrEqual(0); expect(s.energy).toBeLessThanOrEqual(capacity(s) + 1e-6); }
    }
    expect(s.lifetimeGenerated).toBeGreaterThan(1000);
    const pip = s.hamsters.find((h) => h.id === "pip")!;
    expect(pip.job!.history.length).toBeGreaterThanOrEqual(2);
    expect(pip.job!.history[0].we).toBeGreaterThan(0);
  });

  it("promotes on performance and respects leadership seats", () => {
    const s = newCity(3);
    step(s, DAY * 8);
    const promos = s.hamsters.flatMap((h) => h.job?.promotions ?? []);
    expect(promos.length).toBeGreaterThan(0);
    const tl = s.hamsters.filter((h) => h.job?.rank === "Team Leader").length;
    const mgr = s.hamsters.filter((h) => h.job?.rank === "Manager").length;
    expect(tl).toBeLessThanOrEqual(2 + (building(s, "hq")!.level - 1));
    expect(mgr).toBeLessThanOrEqual(2);
    expect(s.chronicle.some((c) => c.kind === "career")).toBe(true);
  });

  it("rain sends umbrella-less walkers to shelter", () => {
    const s = newCity(11);
    // move to midday so many hamsters are out
    while (hourOf(s.time) < 12.5) step(s, 1);
    for (const h of s.hamsters) { h.hasUmbrella = false; }
    s.hamsters[0].activity = "walking"; s.hamsters[0].target = "park"; s.hamsters[0].path = findPath(s.hamsters[0].x, s.hamsters[0].y, 5, 18);
    godRain(s);
    expect(s.weather).toBe("rain");
    expect(s.hamsters.some((h) => h.intent === "sheltering")).toBe(true);
    godSun(s);
    expect(s.weather).toBe("sunny");
  });

  it("upgrades cost WE, refuse when unaffordable and never go negative", () => {
    const s = newCity(5);
    s.energy = 100;
    expect(applyUpgrade(s, "hallA").ok).toBe(false);
    s.energy = 5000;
    expect(applyUpgrade(s, "hallA").ok).toBe(true);
    expect(building(s, "hallA")!.level).toBe(2);
    expect(s.energy).toBe(5000 - 900);
    s.energy = 4000;
    expect(applyUpgrade(s, "lot1").ok).toBe(true);
    expect(building(s, "lot1")!.kind).toBe("house");
  });

  it("festival and trees spend WE and change behaviour", () => {
    const s = newCity(9);
    while (hourOf(s.time) < 18.5) step(s, 1);
    s.energy = 2000;
    expect(godFestival(s).ok).toBe(true);
    step(s, 60);
    expect(s.hamsters.filter((h) => h.intent === "festival" || h.activity === "festival").length).toBeGreaterThan(0);
    const t = s.trees.length;
    expect(godTrees(s).ok).toBe(true);
    expect(s.trees.length).toBe(t + 3);
  });

  it("population growth is capped", () => {
    const s = newCity(13);
    s.energy = 8000;
    for (const b of s.buildings) if (b.kind === "lot") applyUpgrade(s, b.id);
    for (const h of s.hamsters) h.mood = 90;
    step(s, DAY * 6);
    expect(s.hamsters.length).toBeLessThanOrEqual(MAX_POP);
  });

  it("wheel bonus is capped and deduplicated", () => {
    const s = newCity(1);
    s.energy = 0;
    const now = new Date("2026-11-06T10:00:00Z");
    const a = creditWheelReading(s, "epoch:t1", 80, now);
    expect(a).toBe(24);
    expect(creditWheelReading(s, "epoch:t1", 80, now)).toBe(0);
    let total = a;
    for (let i = 2; i < 40; i++) total += creditWheelReading(s, `epoch:t${i}`, 200, now);
    expect(total).toBe(BONUS_PER_HOUR_CAP);
    // milestones before founding are recorded but not rewarded
    expect(creditMilestone(s, "old", "Old milestone", "2020-01-01T00:00:00Z")).toBe(0);
    const fut = new Date(Date.now() + 60000).toISOString();
    expect(creditMilestone(s, "new", "New milestone", fut)).toBeGreaterThan(0);
    expect(creditMilestone(s, "new", "New milestone", fut)).toBe(0);
  });
});
