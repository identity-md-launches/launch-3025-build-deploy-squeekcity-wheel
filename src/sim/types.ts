export type DistrictId = "residential" | "corp" | "downtown";
export type Weather = "sunny" | "cloudy" | "rain";
export type Rank = "Intern" | "Employee" | "Senior" | "Team Leader" | "Manager" | "Director" | "CEO";
export type Personality = "Energetic" | "Lazy" | "Social" | "Shy" | "Ambitious" | "Foodie";

export type BuildingKind =
  | "house" | "lot" | "kitchen" | "garden"
  | "hq" | "wheelhall" | "battery"
  | "cafe" | "bistro" | "market" | "park" | "arcade" | "studio";

export interface Building {
  id: string;
  name: string;
  kind: BuildingKind;
  district: DistrictId;
  x: number; y: number; w: number; h: number;
  door: { x: number; y: number };
  level: number;
  maxLevel: number;
  /** Outdoor spaces show their visitors walking around inside the footprint. */
  outdoor: boolean;
}

export type Activity =
  | "sleeping" | "home" | "eating" | "walking" | "working" | "shopping" | "park"
  | "socializing" | "sheltering" | "festival" | "arcade" | "studio" | "garden" | "visiting";

export interface WorkDay { day: number; we: number; minutes: number }

export interface Job {
  employer: "Wheel Corporation" | null;
  rank: Rank;
  xp: number;
  endurance: number; // skill 1..10
  speed: number;     // skill 1..10
  dailyWE: number;
  lifetimeWE: number;
  minutesToday: number;
  history: WorkDay[];
  promotions: { day: number; rank: Rank }[];
  hall: string;      // wheel hall building id
  wheelSlot: number;
  hiredDay: number;
}

export interface Hamster {
  id: string;
  name: string;
  age: number;
  personality: Personality;
  fur: string;
  homeId: string;
  family: string[];
  relationships: Record<string, number>; // -100..100 affinity
  job: Job | null;
  hunger: number;  // 0 full .. 100 starving
  stamina: number; // 0..100
  mood: number;    // 0..100
  social: number;  // 0 lonely .. 100 fulfilled
  hasUmbrella: boolean;
  wakeHour: number;
  sleepHour: number;
  workStart: number;
  workEnd: number;
  // live state
  activity: Activity;
  intent: Activity;          // what they're walking toward
  at: string | null;         // building id currently inside / at
  target: string | null;
  path: { x: number; y: number }[];
  x: number; y: number;      // tile coords (float)
  until: number;             // game minute when current activity ends
  thought: string;
  wander: { x: number; y: number } | null;
}

export interface ChronicleEntry {
  t: number;         // game minute
  real?: string;     // ISO timestamp for real-world (API) entries
  kind: "career" | "economy" | "city" | "social" | "weather" | "api" | "god";
  text: string;
}

export interface CityState {
  version: 1;
  createdAt: string;      // real ISO time this city was founded
  time: number;           // game minutes since founding (starts day 1 06:30)
  speed: 0 | 1 | 2;
  weather: Weather;
  weatherUntil: number;
  weatherForced: boolean;
  festivalUntil: number;
  surgeUntil: number;
  energy: number;         // stored WE
  generatedToday: number;
  consumedToday: number;
  lifetimeGenerated: number;
  apiBonusTotal: number;
  apiBonusHour: { hourKey: string; amount: number };
  rateGen: number;        // WE per game minute (smoothed)
  rateUse: number;
  brownout: boolean;
  buildings: Building[];
  trees: { x: number; y: number; kind: number }[];
  hamsters: Hamster[];
  reserve: Hamster[];     // hamsters who may move in when the city grows
  chronicle: ChronicleEntry[];
  rewardedEventIds: string[];
  seenEventIds: string[];
  creditedReadings: string[];
  rngSeed: number;
  lastReviewDay: number;
  lastGrowthDay: number;
}

export const RANKS: Rank[] = ["Intern", "Employee", "Senior", "Team Leader", "Manager", "Director", "CEO"];
