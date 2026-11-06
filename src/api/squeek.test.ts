import { describe, expect, it } from "vitest";
import { parseEvents, parseStatus } from "./squeek";

// Shape recorded from https://api.squeekchain.com/v1/status on 2026-11-06 (trimmed to the fields read).
const status = (m: Record<string, unknown> | null) => ({
  schemaVersion: 1, installationId: "sepolia-core-sepolia-20261103", revision: "x", generatedAt: "2026-11-06T03:34:01.641Z",
  measurement: m,
  modules: [{ instanceId: "wheel", moduleType: "wheel.counter", state: "ready", provenance: "hardware" }],
});
const m = (over: Record<string, unknown> = {}) => ({
  freshness: "online", observedAt: "2026-11-06T03:34:00.944Z", receivedAt: "2026-11-06T03:34:01.096Z", staleAfterSeconds: 120,
  counterEpoch: "c53e3951", cumulativeWorkUnits: "3817", provenance: "hardware", coreStatus: "ACTIVE",
  rpmMilli: 77005, speedMmPerSecond: 1127, distanceMm: 3455808, ...over,
});
const now = new Date("2026-11-06T03:34:10.000Z");

describe("parseStatus", () => {
  it("reads rpmMilli / 1000 and marks fresh hardware ACTIVE readings as bonus-eligible", () => {
    const r = parseStatus(status(m()), now);
    expect(r.label).toBe("live");
    expect(r.rpm).toBeCloseTo(77.005);
    expect(r.bonusEligible).toBe(true);
    expect(r.key).toBe("c53e3951:2026-11-06T03:34:00.944Z");
    expect(r.moduleState).toBe("ready");
  });
  it("labels idle, stale, simulated and replayed readings and never rewards them", () => {
    expect(parseStatus(status(m({ coreStatus: "IDLE", rpmMilli: 0 })), now)).toMatchObject({ label: "idle", bonusEligible: false });
    expect(parseStatus(status(m({ freshness: "stale" })), now)).toMatchObject({ label: "stale", bonusEligible: false });
    expect(parseStatus(status(m()), new Date("2026-11-06T03:40:00Z"))).toMatchObject({ label: "stale", bonusEligible: false });
    expect(parseStatus(status(m({ provenance: "simulated" })), now)).toMatchObject({ label: "simulated", bonusEligible: false });
    expect(parseStatus(status(m({ provenance: "replay" })), now)).toMatchObject({ label: "replay", bonusEligible: false });
    expect(parseStatus(status(m({ coreStatus: "COUNTER_FAULT" })), now)).toMatchObject({ label: "unavailable", bonusEligible: false });
  });
  it("treats missing measurement or unknown schema as unavailable, not zero", () => {
    expect(parseStatus(status(null), now)).toMatchObject({ label: "unavailable", rpm: null });
    expect(parseStatus({ schemaVersion: 2 }, now)).toMatchObject({ label: "unavailable", rpm: null });
  });
});

describe("parseEvents", () => {
  it("keeps accepted measurement milestones and drops chain events", () => {
    const r = parseEvents({
      schemaVersion: 4, status: "available", events: [
        { id: "measurement:a", type: "measurement.distance_milestone", occurredAt: "2026-11-05T05:54:49.178Z",
          source: { kind: "measurement", disposition: "accepted" }, payload: { thresholdDistanceMm: "3000000", observedLifetimeDistanceMm: "3000126" } },
        { id: "measurement:b", type: "measurement.speed_record", occurredAt: "2026-11-05T05:12:05.884Z",
          source: { kind: "measurement", disposition: "accepted" }, payload: { recordMmPerSecond: "1161" } },
        { id: "chain:c", type: "nft.merged", occurredAt: "2026-11-06T03:32:00.000Z", source: { kind: "chain" }, payload: {} },
      ],
    }, now);
    expect(r.label).toBe("available");
    expect(r.milestones.map((x) => x.id)).toEqual(["measurement:a", "measurement:b"]);
    expect(r.milestones[0].text).toBe("Real wheel passed 3 km lifetime distance");
    expect(r.milestones[1].text).toBe("Real wheel set a top speed record of 4.2 km/h");
  });
  it("reports unavailable feeds with their reason", () => {
    expect(parseEvents({ schemaVersion: 4, status: "unavailable", reason: "indexer_unavailable" }, now)).toMatchObject({ label: "unavailable", reason: "indexer_unavailable" });
  });
});
