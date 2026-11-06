import { afterEach, describe, expect, it, vi } from "vitest";
import { ageReading, fetchMilestones, fetchStatus, mergeReading, parseEvents, parseStatus, REQUEST_TIMEOUT_MS, type WheelReading } from "./squeek";

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

describe("reading lifetime", () => {
  const live = () => parseStatus(status(m()), now); // received 03:34:01.096, stale after 120 s

  it("expires on the clock alone, keeps the values and timestamps, and stops the bonus", () => {
    expect(ageReading(live(), new Date("2026-11-06T03:36:01.000Z")).label).toBe("live");
    const old = ageReading(live(), new Date("2026-11-06T03:36:02.000Z"));
    expect(old).toMatchObject({ label: "stale", bonusEligible: false, rpm: live().rpm, receivedAt: live().receivedAt, observedAt: live().observedAt });
    expect(old.note).toContain("stale");
  });
  it("expires idle and simulated readings too, and leaves empty ones unavailable", () => {
    const later = new Date("2026-11-06T03:40:00Z");
    expect(ageReading(parseStatus(status(m({ coreStatus: "IDLE", rpmMilli: 0 })), now), later).label).toBe("stale");
    expect(ageReading(parseStatus(status(m({ provenance: "simulated" })), now), later).label).toBe("stale");
    expect(ageReading(parseStatus(status(null), now), later).label).toBe("unavailable");
  });
  it("keeps the last reading through a failed request and clears the failure on the next success", () => {
    const failed = parseFailure("Squeekchain API is unreachable.");
    const kept = mergeReading(live(), failed);
    expect(kept).toMatchObject({ label: "live", receivedAt: live().receivedAt, fetchedAt: live().fetchedAt, checkError: "Squeekchain API is unreachable.", checkFailedAt: failed.fetchedAt });
    expect(mergeReading(kept, live()).checkError).toBeNull();
  });
  it("shows Unavailable when a request fails with no reading to keep, or the API answers with none", () => {
    const failed = parseFailure("Squeekchain API is unreachable.");
    expect(mergeReading(null, failed).label).toBe("unavailable");
    expect(mergeReading(live(), parseStatus(status(null), now)).label).toBe("unavailable");
  });
});

describe("requests", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const hang = (_: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError"))));

  it("ends a hung status request as a timeout", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(hang));
    const pending = fetchStatus();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toMatchObject({ label: "unavailable", rpm: null, checkError: expect.stringContaining("timed out") });
  });
  it("ends a hung events request as a timeout", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(hang));
    const pending = fetchMilestones();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toMatchObject({ label: "unavailable", reason: "timeout", milestones: [] });
  });
  it("reports network and HTTP failures distinctly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("failed"); }));
    expect((await fetchStatus()).checkError).toContain("unreachable");
    expect((await fetchMilestones()).reason).toBe("network");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect((await fetchStatus()).checkError).toContain("503");
    expect((await fetchMilestones()).reason).toBe("http_503");
  });
});

function parseFailure(note: string): WheelReading {
  return { ...parseStatus(status(null), now), checkError: note, checkFailedAt: now.toISOString() };
}
