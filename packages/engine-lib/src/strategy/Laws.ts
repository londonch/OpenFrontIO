import {
  LAW_CATEGORIES,
  LAW_IDS,
  LawCategory,
  LawID,
  Modifiers,
} from "@openfront/engine-api/game/Strategy";

export interface LawDef {
  id: LawID;
  category: LawCategory;
  modifiers: Partial<Modifiers>;
  /** Only while at war with someone; reverts to the default at peace. */
  requiresWar?: boolean;
  /** Also allowed in peacetime once world tension reaches this (0..1000). */
  tensionOverride?: number;
}

const LAW_LIST: readonly LawDef[] = [
  {
    id: "volunteer_only",
    category: "conscription",
    modifiers: { maxTroops: -15, troopGrowth: -10, goldIncome: 5 },
  },
  { id: "limited_conscription", category: "conscription", modifiers: {} },
  {
    id: "extensive_conscription",
    category: "conscription",
    modifiers: { maxTroops: 10, troopGrowth: 10, goldIncome: -5 },
  },
  {
    id: "service_by_requirement",
    category: "conscription",
    modifiers: { maxTroops: 20, troopGrowth: 20, goldIncome: -15 },
    requiresWar: true,
  },
  {
    id: "civilian_economy",
    category: "economy",
    modifiers: { goldIncome: 10, equipmentProduction: -30 },
  },
  { id: "partial_mobilization", category: "economy", modifiers: {} },
  {
    id: "war_economy",
    category: "economy",
    modifiers: { goldIncome: -10, equipmentProduction: 25 },
    requiresWar: true,
    tensionOverride: 500,
  },
  {
    id: "total_mobilization",
    category: "economy",
    modifiers: { goldIncome: -25, equipmentProduction: 50, maxTroops: 5 },
    requiresWar: true,
  },
  {
    id: "free_trade",
    category: "trade",
    modifiers: { tradeIncome: 15, resourceExtraction: -10 },
  },
  { id: "export_focus", category: "trade", modifiers: {} },
  {
    id: "closed_economy",
    category: "trade",
    modifiers: {
      tradeIncome: -25,
      resourceExtraction: 15,
      equipmentProduction: 5,
    },
  },
];

export const LAWS: ReadonlyMap<LawID, LawDef> = new Map(
  LAW_LIST.map((l) => [l.id, l]),
);

if (LAWS.size !== LAW_IDS.length || LAW_LIST.length !== LAW_IDS.length) {
  throw new Error("law table does not match LAW_IDS");
}

export const DEFAULT_LAWS: Readonly<Record<LawCategory, LawID>> = {
  conscription: "limited_conscription",
  economy: "partial_mobilization",
  trade: "export_focus",
};

export function lawDef(id: LawID): LawDef {
  const def = LAWS.get(id);
  if (def === undefined) throw new Error(`unknown law ${id}`);
  return def;
}

export function isLawID(id: string): id is LawID {
  return LAWS.has(id as LawID);
}

export function lawsIn(category: LawCategory): LawDef[] {
  return LAW_LIST.filter((l) => l.category === category);
}

/** Whether a law's war requirement is met. */
export function lawAllowed(
  law: LawDef,
  atWar: boolean,
  worldTension: number,
): boolean {
  if (!law.requiresWar || atWar) return true;
  return (
    law.tensionOverride !== undefined && worldTension >= law.tensionOverride
  );
}

// Keeps LAW_CATEGORIES and DEFAULT_LAWS in step.
for (const c of LAW_CATEGORIES) {
  if (lawDef(DEFAULT_LAWS[c]).category !== c) {
    throw new Error(`default law for ${c} is in the wrong category`);
  }
}
