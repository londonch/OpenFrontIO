import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  Modifiers,
  TECH_IDS,
  TechCategory,
  TechID,
} from "@openfront/engine-api/game/Strategy";

export interface TechDef {
  id: TechID;
  category: TechCategory;
  /** Research time at base speed, one slot. */
  seconds: number;
  /** Every listed tech must be researched first. */
  requires: readonly TechID[];
  /** Researching one of these locks the others (doctrines). */
  exclusive?: readonly TechID[];
  modifiers: Partial<Modifiers>;
  /** Units that cannot be built until this tech is researched. */
  unlocks?: readonly UnitType[];
  /** Synthetic oil produced per minute once researched. */
  syntheticOilPerMinute?: number;
}

const DOCTRINES: readonly TechID[] = [
  "mobile_warfare",
  "superior_firepower",
  "grand_battleplan",
];

const TECH_LIST: readonly TechDef[] = [
  // Infantry
  {
    id: "infantry_weapons_1",
    category: "infantry",
    seconds: 90,
    requires: [],
    modifiers: { attack: 5 },
  },
  {
    id: "infantry_weapons_2",
    category: "infantry",
    seconds: 150,
    requires: ["infantry_weapons_1"],
    modifiers: { attack: 5, defense: 5 },
  },
  {
    id: "infantry_weapons_3",
    category: "infantry",
    seconds: 240,
    requires: ["infantry_weapons_2"],
    modifiers: { attack: 10 },
  },
  {
    id: "support_weapons",
    category: "infantry",
    seconds: 120,
    requires: ["infantry_weapons_1"],
    modifiers: { defense: 10 },
  },
  {
    id: "artillery",
    category: "infantry",
    seconds: 180,
    requires: ["support_weapons"],
    modifiers: { attack: 10 },
  },
  {
    id: "motorized",
    category: "infantry",
    seconds: 180,
    requires: ["infantry_weapons_2"],
    modifiers: { attackSpeed: 15 },
  },
  {
    id: "armor",
    category: "infantry",
    seconds: 300,
    requires: ["motorized", "artillery"],
    modifiers: { attack: 10, attackSpeed: 10 },
  },
  // Doctrines: pick one.
  {
    id: "mobile_warfare",
    category: "doctrine",
    seconds: 240,
    requires: ["motorized"],
    exclusive: DOCTRINES,
    modifiers: { attackSpeed: 15, supplyRange: 10 },
  },
  {
    id: "superior_firepower",
    category: "doctrine",
    seconds: 240,
    requires: ["artillery"],
    exclusive: DOCTRINES,
    modifiers: { attack: 10, defense: 5 },
  },
  {
    id: "grand_battleplan",
    category: "doctrine",
    seconds: 240,
    requires: ["support_weapons"],
    exclusive: DOCTRINES,
    modifiers: { defense: 15, attrition: -15 },
  },
  // Industry
  {
    id: "basic_machine_tools",
    category: "industry",
    seconds: 90,
    requires: [],
    modifiers: { equipmentProduction: 10 },
  },
  {
    id: "improved_machine_tools",
    category: "industry",
    seconds: 180,
    requires: ["basic_machine_tools"],
    modifiers: { equipmentProduction: 10, goldIncome: 5 },
  },
  {
    id: "advanced_machine_tools",
    category: "industry",
    seconds: 300,
    requires: ["improved_machine_tools"],
    modifiers: { equipmentProduction: 15 },
  },
  {
    id: "construction_1",
    category: "industry",
    seconds: 90,
    requires: [],
    modifiers: { structureCost: -5 },
  },
  {
    id: "construction_2",
    category: "industry",
    seconds: 180,
    requires: ["construction_1"],
    modifiers: { structureCost: -5 },
  },
  {
    id: "excavation_1",
    category: "industry",
    seconds: 120,
    requires: [],
    modifiers: { resourceExtraction: 15 },
  },
  {
    id: "excavation_2",
    category: "industry",
    seconds: 240,
    requires: ["excavation_1"],
    modifiers: { resourceExtraction: 20 },
  },
  {
    id: "synthetic_refineries",
    category: "industry",
    seconds: 240,
    requires: ["excavation_1", "improved_machine_tools"],
    modifiers: {},
    syntheticOilPerMinute: 60,
  },
  {
    id: "central_banking",
    category: "industry",
    seconds: 120,
    requires: [],
    modifiers: { goldIncome: 10 },
  },
  // Logistics
  {
    id: "logistics_companies",
    category: "logistics",
    seconds: 120,
    requires: [],
    modifiers: { supplyRange: 20, attrition: -20 },
  },
  {
    id: "railway_logistics",
    category: "logistics",
    seconds: 240,
    requires: ["logistics_companies"],
    modifiers: { supplyRange: 30, attrition: -20 },
  },
  {
    id: "field_hospitals",
    category: "logistics",
    seconds: 150,
    requires: ["logistics_companies"],
    modifiers: { attack: 5, defense: 5 },
  },
  {
    id: "mass_mobilization",
    category: "logistics",
    seconds: 180,
    requires: [],
    modifiers: { maxTroops: 5, troopGrowth: 10 },
  },
  // Naval
  {
    id: "merchant_marine",
    category: "naval",
    seconds: 120,
    requires: [],
    modifiers: { tradeIncome: 15 },
  },
  {
    id: "naval_engineering",
    category: "naval",
    seconds: 180,
    requires: ["merchant_marine"],
    modifiers: { tradeIncome: 10, goldIncome: 5 },
  },
  // Rocketry and nuclear
  {
    id: "radar",
    category: "rocketry",
    seconds: 150,
    requires: [],
    modifiers: {},
    unlocks: [UnitType.SAMLauncher],
  },
  {
    id: "rocketry",
    category: "rocketry",
    seconds: 150,
    requires: [],
    modifiers: {},
    unlocks: [UnitType.MissileSilo],
  },
  {
    id: "nuclear_fission",
    category: "rocketry",
    seconds: 300,
    requires: ["rocketry"],
    modifiers: {},
    unlocks: [UnitType.AtomBomb],
  },
  {
    id: "thermonuclear",
    category: "rocketry",
    seconds: 420,
    requires: ["nuclear_fission"],
    modifiers: {},
    unlocks: [UnitType.HydrogenBomb],
  },
  {
    id: "mirv_systems",
    category: "rocketry",
    seconds: 480,
    requires: ["thermonuclear"],
    modifiers: {},
    unlocks: [UnitType.MIRV],
  },
];

export const TECHS: ReadonlyMap<TechID, TechDef> = new Map(
  TECH_LIST.map((t) => [t.id, t]),
);

// Every id in the vocabulary has exactly one definition.
if (TECHS.size !== TECH_IDS.length || TECH_LIST.length !== TECH_IDS.length) {
  throw new Error("tech table does not match TECH_IDS");
}

export function techDef(id: TechID): TechDef {
  const def = TECHS.get(id);
  if (def === undefined) throw new Error(`unknown tech ${id}`);
  return def;
}

export function isTechID(id: string): id is TechID {
  return TECHS.has(id as TechID);
}

const UNIT_TECH = new Map<UnitType, TechID>();
for (const t of TECH_LIST) {
  for (const u of t.unlocks ?? []) UNIT_TECH.set(u, t.id);
}

/** The tech a unit type needs, or null if it is always available. */
export function requiredTechFor(type: UnitType): TechID | null {
  return UNIT_TECH.get(type) ?? null;
}

/**
 * Why `id` can't be researched now, or null if it can. `active` is what the
 * player is researching, `completed` what is done.
 */
export function techBlocker(
  id: TechID,
  completed: ReadonlySet<TechID>,
  active: readonly TechID[],
): "done" | "active" | "prerequisites" | "exclusive" | null {
  const def = techDef(id);
  if (completed.has(id)) return "done";
  if (active.includes(id)) return "active";
  if (!def.requires.every((r) => completed.has(r))) return "prerequisites";
  if (
    def.exclusive?.some(
      (other) =>
        other !== id && (completed.has(other) || active.includes(other)),
    )
  ) {
    return "exclusive";
  }
  return null;
}
