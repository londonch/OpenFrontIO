/*
 * Grand strategy layer: the vocabulary the engine, the intents and the client
 * share. What each tech, focus and law actually does lives in
 * engine-lib/strategy; this file only names things and describes the view the
 * engine sends to the client.
 */

export enum ResourceType {
  Oil = "oil",
  Steel = "steel",
  Aluminium = "aluminium",
}

export const RESOURCE_TYPES = [
  ResourceType.Oil,
  ResourceType.Steel,
  ResourceType.Aluminium,
] as const;

/**
 * Every bonus a tech, focus or law can grant, as an integer percent (+10 means
 * +10%). Negative values are maluses, except where the key is a cost or a
 * duration, where negative means cheaper or faster.
 */
export const MODIFIER_KEYS = [
  "attack",
  "defense",
  "attackSpeed",
  "maxTroops",
  "troopGrowth",
  "goldIncome",
  "tradeIncome",
  "equipmentProduction",
  "resourceExtraction",
  "researchSpeed",
  "ppGain",
  "justifyTime",
  "justifyCost",
  "structureCost",
  "supplyRange",
  "attrition",
] as const;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];
export type Modifiers = Record<ModifierKey, number>;

export const TECH_CATEGORIES = [
  "infantry",
  "doctrine",
  "industry",
  "logistics",
  "naval",
  "rocketry",
] as const;
export type TechCategory = (typeof TECH_CATEGORIES)[number];

export const TECH_IDS = [
  "infantry_weapons_1",
  "infantry_weapons_2",
  "infantry_weapons_3",
  "support_weapons",
  "artillery",
  "motorized",
  "armor",
  "mobile_warfare",
  "superior_firepower",
  "grand_battleplan",
  "basic_machine_tools",
  "improved_machine_tools",
  "advanced_machine_tools",
  "construction_1",
  "construction_2",
  "excavation_1",
  "excavation_2",
  "synthetic_refineries",
  "central_banking",
  "logistics_companies",
  "railway_logistics",
  "field_hospitals",
  "mass_mobilization",
  "merchant_marine",
  "naval_engineering",
  "radar",
  "rocketry",
  "nuclear_fission",
  "thermonuclear",
  "mirv_systems",
] as const;
export type TechID = (typeof TECH_IDS)[number];

export const FOCUS_IDS = [
  "army_effort",
  "equipment_effort",
  "doctrine_effort",
  "fortification_effort",
  "industrial_effort",
  "construction_effort",
  "resource_exploitation",
  "synthetic_effort",
  "research_institutes",
  "political_effort",
  "embrace_democracy",
  "arsenal_of_democracy",
  "collective_security",
  "embrace_autocracy",
  "total_war_doctrine",
  "expansionism",
  "embrace_communism",
  "five_year_plan",
  "peoples_army",
  "strategic_reserves",
] as const;
export type FocusID = (typeof FOCUS_IDS)[number];

export const LAW_CATEGORIES = ["conscription", "economy", "trade"] as const;
export type LawCategory = (typeof LAW_CATEGORIES)[number];

export const LAW_IDS = [
  "volunteer_only",
  "limited_conscription",
  "extensive_conscription",
  "service_by_requirement",
  "civilian_economy",
  "partial_mobilization",
  "war_economy",
  "total_mobilization",
  "free_trade",
  "export_focus",
  "closed_economy",
] as const;
export type LawID = (typeof LAW_IDS)[number];

/** Anything an action can name: a tech, a focus or a law. */
export const STRATEGY_KEYS = [...TECH_IDS, ...FOCUS_IDS, ...LAW_IDS] as const;
export type StrategyKey = (typeof STRATEGY_KEYS)[number];

/** Player actions on the strategy layer, carried by the "strategy" intent. */
export const STRATEGY_ACTIONS = [
  "research",
  "cancel_research",
  "focus",
  "cancel_focus",
  "law",
  "justify",
  "cancel_justify",
  "declare_war",
  "offer_peace",
  "accept_peace",
  "reject_peace",
] as const;
export type StrategyAction = (typeof STRATEGY_ACTIONS)[number];

export interface ResearchProgressView {
  tech: TechID;
  /** 0..1000. */
  permille: number;
}

/**
 * One player's strategy state, as the client sees it. Sent on the Strategy
 * update channel whenever it changes (progress refreshes once a second), so
 * values are whole units, not the engine's fixed-point internals.
 */
export interface StrategyView {
  politicalPower: number;
  researchSlots: number;
  research: ResearchProgressView[];
  completedTechs: TechID[];
  focus: { id: FocusID; permille: number } | null;
  completedFocuses: FocusID[];
  laws: Record<LawCategory, LawID>;
  /** Tick before which no law can change again. */
  lawCooldownUntil: number;
  resources: Record<ResourceType, number>;
  /** Net income per minute (production minus consumption). */
  resourceIncome: Record<ResourceType, number>;
  depositTilesOwned: Record<ResourceType, number>;
  equipment: number;
  /** Equipment the army needs to be fully equipped (troops in the field). */
  equipmentNeeded: number;
  /** Equipment produced per minute. */
  equipmentProduction: number;
  /** War goal being justified, by target small id. */
  justification: { target: number; permille: number } | null;
  warGoals: { target: number; expiresAt: number }[];
  /** Small ids of players this player is at war with (declared wars only). */
  wars: number[];
  truces: { target: number; until: number }[];
  incomingPeaceOffers: number[];
  outgoingPeaceOffers: number[];
  /** Attacks currently fighting out of supply. */
  unsuppliedAttacks: number;
  modifiers: Modifiers;
  /** World tension, 0..1000. Global: the same for every player. */
  worldTension: number;
}
