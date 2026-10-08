import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  FocusID,
  LawID,
  MODIFIER_KEYS,
  ModifierKey,
  Modifiers,
  ResourceType,
  TechID,
} from "@openfront/engine-api/game/Strategy";
import { focusDef } from "./Focuses";
import { lawDef } from "./Laws";
import { techDef } from "./Techs";

/*
 * Grand strategy tunables and the pure formulas built on them. Shared by the
 * engine (which applies them) and the client (which explains them), so every
 * number here is the one the simulation uses.
 *
 * Stockpiles the engine accumulates in fractions (political power, resources)
 * are kept internally in hundredths; everything here is in whole units unless
 * a name says otherwise.
 */

/** Industry, resources, supply upkeep and the client view refresh this often. */
export const STRATEGY_INTERVAL_TICKS = 10;

export const STRATEGY = {
  // Political power: earned over time, spent on laws and war goals.
  startingPoliticalPower: 50,
  politicalPowerPerSecond: 1,
  politicalPowerCap: 1000,
  lawChangeCost: 150,
  lawChangeCooldownSeconds: 60,

  // Research
  baseResearchSlots: 2,
  maxResearchSlots: 4,
  researchSpeedPerCityLevel: 3,
  maxCityResearchBonus: 30,

  // Diplomacy
  justifyBaseSeconds: 90,
  justifyMinSeconds: 15,
  justifyBaseCost: 50,
  /** A justified war goal must be used within this long. */
  warGoalSeconds: 180,
  /** After peace, neither side can justify on the other for this long. */
  truceSeconds: 300,
  peaceOfferSeconds: 60,
  minWarSecondsBeforePeace: 60,

  // World tension, 0..1000.
  tensionPerDeclaration: 50,
  tensionPerCallToArms: 20,
  tensionPerConquest: 20,
  tensionPerAtomBomb: 30,
  tensionPerHydrogenBomb: 80,
  tensionPerMIRV: 150,
  tensionDecayPerMinute: 20,

  // Industry, per minute.
  startingEquipmentPerTroop: 2,
  baseEquipmentPerMinute: 30_000,
  equipmentPerFactoryLevelPerMinute: 30_000,
  steelPerFactoryLevelPerMinute: 60,
  baseResourcePerMinute: 60,
  depositYieldPerTilePerMinute: 3,
  startingResources: 500,
  /** Each land attack against a player burns this much oil per minute... */
  fuelPerAttackPerMinute: 30,
  /** ...plus one oil per minute per this many troops in the attack. */
  troopsPerFuelPerMinute: 5_000,

  // Supply
  capitalSupplyRange: 100,
  hubSupplyRange: 60,
  /** Hubs on the rail network reach this much farther. */
  railHubRangeBonusPercent: 50,
  /** Fronts within this multiple of a hub's range are stretched, not cut off. */
  stretchedRangeMultiplier: 2,
  /** Troops an attack loses per second out of supply, in permille. */
  unsuppliedAttritionPermille: 10,
  stretchedAttritionPermille: 3,
} as const;

export enum SupplyLevel {
  Supplied = 0,
  Stretched = 1,
  Unsupplied = 2,
}

const SUPPLY_EFFECTIVENESS: Record<SupplyLevel, number> = {
  [SupplyLevel.Supplied]: 1,
  [SupplyLevel.Stretched]: 0.8,
  [SupplyLevel.Unsupplied]: 0.6,
};

/** Combat effectiveness of an attack with no oil left. */
export const FUEL_SHORTAGE_EFFECTIVENESS = 0.75;

/** Structures that project supply. */
export const SUPPLY_HUB_TYPES: readonly UnitType[] = [
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
];

/** Raw materials some units need on top of their gold cost. */
export const UNIT_RESOURCE_COSTS: Partial<
  Record<UnitType, Partial<Record<ResourceType, number>>>
> = {
  [UnitType.Warship]: { [ResourceType.Steel]: 50, [ResourceType.Oil]: 30 },
  [UnitType.DefensePost]: { [ResourceType.Steel]: 15 },
  [UnitType.SAMLauncher]: {
    [ResourceType.Aluminium]: 60,
    [ResourceType.Steel]: 30,
  },
  [UnitType.MissileSilo]: {
    [ResourceType.Steel]: 80,
    [ResourceType.Aluminium]: 40,
  },
  [UnitType.AtomBomb]: { [ResourceType.Aluminium]: 40 },
  [UnitType.HydrogenBomb]: {
    [ResourceType.Aluminium]: 150,
    [ResourceType.Oil]: 50,
  },
  [UnitType.MIRV]: {
    [ResourceType.Aluminium]: 400,
    [ResourceType.Oil]: 150,
    [ResourceType.Steel]: 100,
  },
};

export function emptyModifiers(): Modifiers {
  const m = {} as Modifiers;
  for (const k of MODIFIER_KEYS) m[k] = 0;
  return m;
}

export function addModifiers(
  target: Modifiers,
  add: Partial<Modifiers>,
): Modifiers {
  for (const k of MODIFIER_KEYS) {
    const v = add[k];
    if (v !== undefined) target[k] += v;
  }
  return target;
}

/** Everything researched, completed and enacted, summed. */
export function computeModifiers(
  techs: Iterable<TechID>,
  focuses: Iterable<FocusID>,
  laws: Iterable<LawID>,
): Modifiers {
  const m = emptyModifiers();
  for (const t of techs) addModifiers(m, techDef(t).modifiers);
  for (const f of focuses) addModifiers(m, focusDef(f).modifiers);
  for (const l of laws) addModifiers(m, lawDef(l).modifiers);
  return m;
}

/** Applies a percent modifier to a value: +10 → ×1.1. Never below zero. */
export function applyPct(value: number, pct: number): number {
  return Math.max(0, (value * (100 + pct)) / 100);
}

/** The bonus a modifier gives as a multiplier, floored at 10%. */
export function modifierMultiplier(mods: Modifiers, key: ModifierKey): number {
  return Math.max(0.1, (100 + mods[key]) / 100);
}

export function syntheticOilPerMinute(
  techs: Iterable<TechID>,
  focuses: Iterable<FocusID>,
): number {
  let total = 0;
  for (const t of techs) total += techDef(t).syntheticOilPerMinute ?? 0;
  for (const f of focuses) total += focusDef(f).syntheticOilPerMinute ?? 0;
  return total;
}

/** Research cost of a tech, in ticks of progress at base speed. */
export function techCostTicks(tech: TechID): number {
  return techDef(tech).seconds * 10;
}

export function focusCostTicks(focus: FocusID): number {
  return focusDef(focus).seconds * 10;
}

/** Research speed bonus from cities (universities): integer percent. */
export function cityResearchBonus(cityLevels: number): number {
  return Math.min(
    STRATEGY.maxCityResearchBonus,
    cityLevels * STRATEGY.researchSpeedPerCityLevel,
  );
}

/**
 * Ticks to justify a war goal. Rising world tension makes the world accept
 * wars more readily, down to half the time at maximum tension.
 */
export function justifyTicks(mods: Modifiers, worldTension: number): number {
  const base = STRATEGY.justifyBaseSeconds * 10;
  const tension = Math.max(0, Math.min(1000, worldTension));
  const ticks = Math.floor(
    (base * Math.max(10, 100 + mods.justifyTime) * (2000 - tension)) /
      (100 * 2000),
  );
  return Math.max(STRATEGY.justifyMinSeconds * 10, ticks);
}

export function justifyCost(mods: Modifiers): number {
  return Math.max(
    0,
    Math.floor((STRATEGY.justifyBaseCost * (100 + mods.justifyCost)) / 100),
  );
}

/**
 * Fighting strength from equipment: an army with every soldier equipped
 * fights at full strength, an army with no equipment at half.
 */
export function equipmentEffectiveness(
  equipment: number,
  needed: number,
): number {
  if (needed <= 0) return 1;
  const ratio = Math.min(1, Math.max(0, equipment / needed));
  return 0.5 + 0.5 * ratio;
}

export function supplyEffectiveness(level: SupplyLevel): number {
  return SUPPLY_EFFECTIVENESS[level];
}

/** Permille of an attack's troops lost per second at this supply level. */
export function attritionPermille(level: SupplyLevel, mods: Modifiers): number {
  const base =
    level === SupplyLevel.Unsupplied
      ? STRATEGY.unsuppliedAttritionPermille
      : level === SupplyLevel.Stretched
        ? STRATEGY.stretchedAttritionPermille
        : 0;
  return applyPct(base, mods.attrition);
}

/** Oil an attack of this size burns per second, in hundredths. */
export function attackFuelCentiPerSecond(attackTroops: number): number {
  const perMinute =
    STRATEGY.fuelPerAttackPerMinute +
    attackTroops / STRATEGY.troopsPerFuelPerMinute;
  return Math.ceil((perMinute * 100) / 60);
}

/** Supply range of a hub, before the owner's supplyRange modifier. */
export function hubSupplyRange(onRail: boolean): number {
  return onRail
    ? (STRATEGY.hubSupplyRange * (100 + STRATEGY.railHubRangeBonusPercent)) /
        100
    : STRATEGY.hubSupplyRange;
}
