import {
  FOCUS_IDS,
  FocusID,
  Modifiers,
  ResourceType,
} from "@openfront/engine-api/game/Strategy";

export interface FocusGrant {
  gold?: number;
  equipment?: number;
  politicalPower?: number;
  resources?: Partial<Record<ResourceType, number>>;
}

export interface FocusDef {
  id: FocusID;
  /** Time to complete. Focuses are never sped up. */
  seconds: number;
  /** Every listed focus must be completed first. */
  requires: readonly FocusID[];
  /** Taking one of these locks the others for the rest of the game. */
  exclusive?: readonly FocusID[];
  modifiers: Partial<Modifiers>;
  /** One-time reward on completion. */
  grant?: FocusGrant;
  /** Extra research slots on completion. */
  researchSlots?: number;
  /** Synthetic oil produced per minute once completed. */
  syntheticOilPerMinute?: number;
  /** Where the focus sits in the tree view: column and row. */
  col: number;
  row: number;
}

const IDEOLOGIES: readonly FocusID[] = [
  "embrace_democracy",
  "embrace_autocracy",
  "embrace_communism",
];

const FOCUS_LIST: readonly FocusDef[] = [
  // Army branch
  {
    id: "army_effort",
    seconds: 90,
    requires: [],
    modifiers: { attack: 5 },
    col: 1,
    row: 0,
  },
  {
    id: "equipment_effort",
    seconds: 90,
    requires: ["army_effort"],
    modifiers: { equipmentProduction: 10 },
    grant: { equipment: 20_000 },
    col: 0,
    row: 1,
  },
  {
    id: "doctrine_effort",
    seconds: 90,
    requires: ["army_effort"],
    modifiers: { researchSpeed: 5, attackSpeed: 5 },
    col: 1,
    row: 1,
  },
  {
    id: "fortification_effort",
    seconds: 90,
    requires: ["army_effort"],
    modifiers: { defense: 10 },
    col: 2,
    row: 1,
  },
  {
    id: "strategic_reserves",
    seconds: 120,
    requires: ["equipment_effort"],
    modifiers: {},
    grant: {
      equipment: 50_000,
      resources: {
        [ResourceType.Oil]: 300,
        [ResourceType.Steel]: 300,
        [ResourceType.Aluminium]: 200,
      },
    },
    col: 0,
    row: 2,
  },
  // Industry branch
  {
    id: "industrial_effort",
    seconds: 90,
    requires: [],
    modifiers: { goldIncome: 10 },
    col: 4,
    row: 0,
  },
  {
    id: "construction_effort",
    seconds: 90,
    requires: ["industrial_effort"],
    modifiers: { structureCost: -10 },
    col: 3,
    row: 1,
  },
  {
    id: "resource_exploitation",
    seconds: 120,
    requires: ["industrial_effort"],
    modifiers: { resourceExtraction: 25 },
    col: 5,
    row: 1,
  },
  {
    id: "research_institutes",
    seconds: 150,
    requires: ["construction_effort"],
    modifiers: {},
    researchSlots: 1,
    col: 3,
    row: 2,
  },
  {
    id: "synthetic_effort",
    seconds: 120,
    requires: ["resource_exploitation"],
    modifiers: {},
    syntheticOilPerMinute: 60,
    col: 5,
    row: 2,
  },
  // Political branch: one ideology per game.
  {
    id: "political_effort",
    seconds: 60,
    requires: [],
    modifiers: { ppGain: 20 },
    grant: { politicalPower: 50 },
    col: 7,
    row: 0,
  },
  {
    id: "embrace_democracy",
    seconds: 120,
    requires: ["political_effort"],
    exclusive: IDEOLOGIES,
    modifiers: { goldIncome: 10, defense: 10, ppGain: 10, justifyTime: 50 },
    col: 6,
    row: 1,
  },
  {
    id: "arsenal_of_democracy",
    seconds: 120,
    requires: ["embrace_democracy"],
    modifiers: { equipmentProduction: 20, tradeIncome: 10 },
    col: 6,
    row: 2,
  },
  {
    id: "collective_security",
    seconds: 120,
    requires: ["embrace_democracy"],
    modifiers: { defense: 10, maxTroops: 5 },
    col: 6,
    row: 3,
  },
  {
    id: "embrace_autocracy",
    seconds: 120,
    requires: ["political_effort"],
    exclusive: IDEOLOGIES,
    modifiers: { attack: 10, maxTroops: 10, goldIncome: -5, justifyTime: -50 },
    col: 7,
    row: 1,
  },
  {
    id: "total_war_doctrine",
    seconds: 120,
    requires: ["embrace_autocracy"],
    modifiers: { attackSpeed: 15, troopGrowth: 10 },
    col: 7,
    row: 2,
  },
  {
    id: "expansionism",
    seconds: 120,
    requires: ["embrace_autocracy"],
    modifiers: { justifyCost: -50, justifyTime: -25 },
    col: 7,
    row: 3,
  },
  {
    id: "embrace_communism",
    seconds: 120,
    requires: ["political_effort"],
    exclusive: IDEOLOGIES,
    modifiers: {
      troopGrowth: 20,
      equipmentProduction: 10,
      goldIncome: -10,
      justifyTime: -25,
    },
    col: 8,
    row: 1,
  },
  {
    id: "five_year_plan",
    seconds: 120,
    requires: ["embrace_communism"],
    modifiers: { equipmentProduction: 20, researchSpeed: 10 },
    col: 8,
    row: 2,
  },
  {
    id: "peoples_army",
    seconds: 120,
    requires: ["embrace_communism"],
    modifiers: { maxTroops: 15, defense: 5 },
    col: 8,
    row: 3,
  },
];

export const FOCUSES: ReadonlyMap<FocusID, FocusDef> = new Map(
  FOCUS_LIST.map((f) => [f.id, f]),
);

if (
  FOCUSES.size !== FOCUS_IDS.length ||
  FOCUS_LIST.length !== FOCUS_IDS.length
) {
  throw new Error("focus table does not match FOCUS_IDS");
}

export function focusDef(id: FocusID): FocusDef {
  const def = FOCUSES.get(id);
  if (def === undefined) throw new Error(`unknown focus ${id}`);
  return def;
}

export function isFocusID(id: string): id is FocusID {
  return FOCUSES.has(id as FocusID);
}

/** Why `id` can't be started now, or null if it can. */
export function focusBlocker(
  id: FocusID,
  completed: ReadonlySet<FocusID>,
  current: FocusID | null,
): "done" | "active" | "busy" | "prerequisites" | "exclusive" | null {
  const def = focusDef(id);
  if (completed.has(id)) return "done";
  if (current === id) return "active";
  if (current !== null) return "busy";
  if (!def.requires.every((r) => completed.has(r))) return "prerequisites";
  if (def.exclusive?.some((other) => other !== id && completed.has(other))) {
    return "exclusive";
  }
  return null;
}
