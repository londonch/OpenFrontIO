import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  GameMode,
  MessageType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  FOCUS_IDS,
  FocusID,
  LAW_CATEGORIES,
  LAW_IDS,
  LawCategory,
  LawID,
  ModifierKey,
  Modifiers,
  RESOURCE_TYPES,
  ResourceType,
  StrategyView,
  TECH_IDS,
  TechID,
} from "@openfront/engine-api/game/Strategy";
import {
  snapshotType,
  zInt,
  zNum,
  zPlayerRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import {
  Deposit,
  depositFromSite,
  DepositSite,
  generateDepositSites,
} from "@openfront/engine-lib/strategy/Deposits";
import { focusBlocker, focusDef } from "@openfront/engine-lib/strategy/Focuses";
import {
  DEFAULT_LAWS,
  lawAllowed,
  lawDef,
} from "@openfront/engine-lib/strategy/Laws";
import {
  attackFuelCentiPerSecond,
  attritionPermille,
  cityResearchBonus,
  computeModifiers,
  equipmentEffectiveness,
  focusCostTicks,
  FUEL_SHORTAGE_EFFECTIVENESS,
  hubSupplyRange,
  justifyCost,
  justifyTicks,
  STRATEGY,
  STRATEGY_INTERVAL_TICKS,
  SUPPLY_HUB_TYPES,
  supplyEffectiveness,
  SupplyLevel,
  syntheticOilPerMinute,
  techCostTicks,
  UNIT_RESOURCE_COSTS,
} from "@openfront/engine-lib/strategy/StrategyRules";
import {
  requiredTechFor,
  techBlocker,
} from "@openfront/engine-lib/strategy/Techs";
import { z } from "zod";
import type { Game, Player } from "./Game";

type Resources = Record<ResourceType, number>;

/** One player's grand strategy state. Stockpiles are in hundredths. */
interface PlayerStrategyState {
  politicalPower: number;
  researchSlots: number;
  /** Progress in hundredths of a base-speed tick. */
  research: { tech: TechID; progress: number }[];
  completedTechs: TechID[];
  /** Progress in ticks. */
  focus: { id: FocusID; progress: number } | null;
  completedFocuses: FocusID[];
  laws: Record<LawCategory, LawID>;
  lawCooldownUntil: number;
  resources: Resources;
  /** Net income per minute at the last industry step, whole units. */
  resourceIncome: Resources;
  /** Oil burned by attacks since the last industry step, hundredths. */
  fuelBurned: number;
  /** Equipment in the stockpile. Fractional: combat losses are. */
  equipment: number;
  /** equipment / equipmentNeeded at the last industry step, 0..1. */
  equipmentRatio: number;
  equipmentNeeded: number;
  equipmentProduction: number;
  cityLevels: number;
  depositTiles: Resources;
  justification: { target: number; progress: number; needed: number } | null;
  warGoals: { target: number; expiresAt: number }[];
  /** Attacks that reported fighting out of supply on supplyTick. */
  unsuppliedAttacks: number;
  supplyTick: number;
}

interface War {
  a: number;
  b: number;
  aggressor: number;
  startTick: number;
}

interface Truce {
  a: number;
  b: number;
  until: number;
}

interface PeaceOffer {
  from: number;
  to: number;
  expiresAt: number;
}

export type StrategyBlocker =
  | "disabled"
  | "invalid"
  | "bot"
  | "friendly"
  | "at_war"
  | "not_at_war"
  | "truce"
  | "busy"
  | "already"
  | "political_power"
  | "no_war_goal"
  | "too_early"
  | "no_slot"
  | "cooldown"
  | "requires_war"
  | "done"
  | "active"
  | "prerequisites"
  | "exclusive";

function zeroResources(): Resources {
  return {
    [ResourceType.Oil]: 0,
    [ResourceType.Steel]: 0,
    [ResourceType.Aluminium]: 0,
  };
}

/**
 * The grand strategy layer: political power, research, national focus, laws,
 * industry, resources, war goals, wars, peace and world tension. Owned by the
 * game; players and executions reach it through `game.strategy()`.
 *
 * Players are keyed by small id and iterated in the order their state was
 * created, so every client walks them identically.
 */
export class StrategyManager {
  private players = new Map<number, PlayerStrategyState>();
  private wars: War[] = [];
  private truces: Truce[] = [];
  private peaceOffers: PeaceOffer[] = [];
  /** World tension in hundredths of a permille: 0..100_000. */
  private tensionCenti = 0;
  /**
   * Where the resource deposits are. Placed once on the fresh map and then
   * kept: water nukes change the terrain they were placed on.
   */
  private depositSites: DepositSite[] = [];

  // Caches, rebuilt on demand (DERIVED_FIELDS in tests/util/Snapshot.ts).
  private strategyDeposits: Deposit[] | undefined;
  private strategyModifierCache = new Map<number, Modifiers>();
  private strategySentViews = new Map<number, string>();
  private strategyDirty = new Set<number>();

  constructor(private game: Game) {}

  rulesEnabled(): boolean {
    return this.game.config().grandStrategy();
  }

  /** Places the deposits. Call once, on the fresh map, at game creation. */
  initDeposits(): void {
    this.depositSites = generateDepositSites(this.game.map());
    this.strategyDeposits = undefined;
  }

  deposits(): Deposit[] {
    this.strategyDeposits ??= this.depositSites.map((s, i) =>
      depositFromSite(this.game.map(), s, i),
    );
    return this.strategyDeposits;
  }

  // ---------------------------------------------------------------------------
  // Player state

  addPlayer(player: Player): void {
    if (!this.players.has(player.smallID())) {
      this.players.set(player.smallID(), this.createState(player));
    }
  }

  private createState(player: Player): PlayerStrategyState {
    const resources = zeroResources();
    for (const r of RESOURCE_TYPES) {
      resources[r] = STRATEGY.startingResources * 100;
    }
    const equipment = Math.floor(
      player.troops() * STRATEGY.startingEquipmentPerTroop,
    );
    return {
      politicalPower: STRATEGY.startingPoliticalPower * 100,
      researchSlots: STRATEGY.baseResearchSlots,
      research: [],
      completedTechs: [],
      focus: null,
      completedFocuses: [],
      laws: { ...DEFAULT_LAWS },
      lawCooldownUntil: 0,
      resources,
      resourceIncome: zeroResources(),
      fuelBurned: 0,
      equipment,
      equipmentRatio: 1,
      equipmentNeeded: equipment,
      equipmentProduction: 0,
      cityLevels: 0,
      depositTiles: zeroResources(),
      justification: null,
      warGoals: [],
      unsuppliedAttacks: 0,
      supplyTick: -1,
    };
  }

  private state(player: Player): PlayerStrategyState {
    let s = this.players.get(player.smallID());
    if (s === undefined) {
      s = this.createState(player);
      this.players.set(player.smallID(), s);
    }
    return s;
  }

  private stateBySmallID(id: number): PlayerStrategyState | undefined {
    return this.players.get(id);
  }

  private playerBySmallID(id: number): Player | null {
    const p = this.game.playerBySmallID(id);
    return p.isPlayer() ? p : null;
  }

  private markDirty(...players: Player[]): void {
    for (const p of players) this.strategyDirty.add(p.smallID());
  }

  modifiers(player: Player): Modifiers {
    const id = player.smallID();
    let m = this.strategyModifierCache.get(id);
    if (m === undefined) {
      const s = this.state(player);
      m = computeModifiers(
        s.completedTechs,
        s.completedFocuses,
        LAW_CATEGORIES.map((c) => s.laws[c]),
      );
      this.strategyModifierCache.set(id, m);
    }
    return m;
  }

  modifierPct(player: Player, key: ModifierKey): number {
    if (player.type() === PlayerType.Bot) return 0;
    return this.modifiers(player)[key];
  }

  private invalidateModifiers(player: Player): void {
    this.strategyModifierCache.delete(player.smallID());
  }

  politicalPower(player: Player): number {
    return Math.floor(this.state(player).politicalPower / 100);
  }

  completedTechs(player: Player): readonly TechID[] {
    return this.state(player).completedTechs;
  }

  completedFocuses(player: Player): readonly FocusID[] {
    return this.state(player).completedFocuses;
  }

  activeResearch(player: Player): readonly TechID[] {
    return this.state(player).research.map((r) => r.tech);
  }

  currentFocus(player: Player): FocusID | null {
    return this.state(player).focus?.id ?? null;
  }

  law(player: Player, category: LawCategory): LawID {
    return this.state(player).laws[category];
  }

  resource(player: Player, type: ResourceType): number {
    return Math.floor(this.state(player).resources[type] / 100);
  }

  equipment(player: Player): number {
    return this.state(player).equipment;
  }

  justification(player: Player): { target: number } | null {
    return this.state(player).justification;
  }

  hasWarGoal(player: Player, target: Player): boolean {
    return this.state(player).warGoals.some(
      (g) => g.target === target.smallID(),
    );
  }

  worldTension(): number {
    return Math.floor(this.tensionCenti / 100);
  }

  /** Test and scenario hook: sets a stockpile directly. */
  setResource(player: Player, type: ResourceType, amount: number): void {
    this.state(player).resources[type] = Math.max(0, Math.floor(amount * 100));
    this.markDirty(player);
  }

  /** Test and scenario hook. */
  setEquipment(player: Player, amount: number): void {
    const s = this.state(player);
    s.equipment = Math.max(0, amount);
    this.refreshEquipmentRatio(player, s);
    this.markDirty(player);
  }

  /** Test and scenario hook. */
  addPoliticalPower(player: Player, amount: number): void {
    const s = this.state(player);
    s.politicalPower = Math.min(
      STRATEGY.politicalPowerCap * 100,
      s.politicalPower + amount * 100,
    );
    this.markDirty(player);
  }

  /** Test and scenario hook: raises world tension by `permille`. */
  addTension(permille: number): void {
    this.tensionCenti = Math.max(
      0,
      Math.min(100_000, this.tensionCenti + permille * 100),
    );
  }

  // ---------------------------------------------------------------------------
  // War and peace

  private warIndex(a: number, b: number): number {
    return this.wars.findIndex(
      (w) => (w.a === a && w.b === b) || (w.a === b && w.b === a),
    );
  }

  /** A declared war between the two. Team games' rivalries don't count. */
  hasDeclaredWar(a: Player, b: Player): boolean {
    return this.warIndex(a.smallID(), b.smallID()) !== -1;
  }

  /** Team games are total wars: rival teams are always at war. */
  private teamRivals(a: Player, b: Player): boolean {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return false;
    }
    return a.team() !== null && b.team() !== null && a.team() !== b.team();
  }

  isAtWar(a: Player, b: Player): boolean {
    if (a === b) return false;
    return this.teamRivals(a, b) || this.hasDeclaredWar(a, b);
  }

  isAtWarWithAnyone(player: Player): boolean {
    const id = player.smallID();
    if (this.wars.some((w) => w.a === id || w.b === id)) return true;
    return (
      this.game.config().gameConfig().gameMode === GameMode.Team &&
      player.team() !== null
    );
  }

  /** Players this player has a declared war with. */
  enemies(player: Player): Player[] {
    const id = player.smallID();
    const out: Player[] = [];
    for (const w of this.wars) {
      const other = w.a === id ? w.b : w.b === id ? w.a : -1;
      if (other === -1) continue;
      const p = this.playerBySmallID(other);
      if (p !== null) out.push(p);
    }
    return out;
  }

  warStartTick(a: Player, b: Player): number | null {
    const i = this.warIndex(a.smallID(), b.smallID());
    return i === -1 ? null : this.wars[i].startTick;
  }

  /**
   * Whether `attacker` may attack `target` under the war rules. Tribes are
   * fair game and fight anyone; everyone else needs a war.
   */
  warAllowsAttack(attacker: Player, target: Player): boolean {
    if (!this.rulesEnabled()) return true;
    if (attacker.type() === PlayerType.Bot || target.type() === PlayerType.Bot)
      return true;
    return this.isAtWar(attacker, target);
  }

  private hasTruce(a: Player, b: Player): boolean {
    const x = a.smallID();
    const y = b.smallID();
    return this.truces.some(
      (t) => (t.a === x && t.b === y) || (t.a === y && t.b === x),
    );
  }

  /** Common checks for starting hostilities with `target`. */
  private hostilityBlocker(
    player: Player,
    target: Player,
  ): StrategyBlocker | null {
    if (!this.rulesEnabled()) return "disabled";
    if (player === target || !target.isAlive() || !player.isAlive())
      return "invalid";
    if (player.type() === PlayerType.Bot || target.type() === PlayerType.Bot)
      return "bot";
    if (player.isFriendly(target, true)) return "friendly";
    if (this.isAtWar(player, target)) return "at_war";
    if (this.hasTruce(player, target)) return "truce";
    return null;
  }

  justifyBlocker(player: Player, target: Player): StrategyBlocker | null {
    const blocker = this.hostilityBlocker(player, target);
    if (blocker !== null) return blocker;
    const s = this.state(player);
    if (s.justification !== null) return "busy";
    if (this.hasWarGoal(player, target)) return "already";
    if (s.politicalPower < justifyCost(this.modifiers(player)) * 100) {
      return "political_power";
    }
    return null;
  }

  justifyDurationTicks(player: Player): number {
    return justifyTicks(this.modifiers(player), this.worldTension());
  }

  startJustification(player: Player, target: Player): boolean {
    if (this.justifyBlocker(player, target) !== null) return false;
    const s = this.state(player);
    s.politicalPower -= justifyCost(this.modifiers(player)) * 100;
    s.justification = {
      target: target.smallID(),
      progress: 0,
      needed: this.justifyDurationTicks(player),
    };
    this.game.displayMessage(
      "events_display.war_goal_justifying_on_you",
      MessageType.WAR_DECLARED,
      target.id(),
      undefined,
      { name: player.displayName() },
      undefined,
      player.id(),
    );
    target.updateRelation(player, -50);
    this.markDirty(player);
    return true;
  }

  cancelJustification(player: Player): boolean {
    const s = this.state(player);
    if (s.justification === null) return false;
    s.justification = null;
    this.markDirty(player);
    return true;
  }

  declareWarBlocker(player: Player, target: Player): StrategyBlocker | null {
    const blocker = this.hostilityBlocker(player, target);
    if (blocker !== null) return blocker;
    if (!this.hasWarGoal(player, target)) return "no_war_goal";
    return null;
  }

  declareWar(player: Player, target: Player): boolean {
    if (this.declareWarBlocker(player, target) !== null) return false;
    const s = this.state(player);
    s.warGoals = s.warGoals.filter((g) => g.target !== target.smallID());
    this.startWar(player, target, player);
    this.addTension(STRATEGY.tensionPerDeclaration);

    this.game.displayMessage(
      "events_display.war_declared_on_you",
      MessageType.WAR_DECLARED,
      target.id(),
      undefined,
      { name: player.displayName() },
      undefined,
      player.id(),
    );
    this.game.displayMessage(
      "events_display.you_declared_war",
      MessageType.WAR_DECLARED,
      player.id(),
      undefined,
      { name: target.displayName() },
      undefined,
      target.id(),
    );

    // The target's allies are called to arms, unless they are friends of the
    // aggressor too.
    for (const ally of target.allies()) {
      if (
        ally === player ||
        ally.type() === PlayerType.Bot ||
        !ally.isAlive() ||
        ally.isFriendly(player, true) ||
        this.isAtWar(ally, player)
      ) {
        continue;
      }
      this.startWar(player, ally, player);
      this.addTension(STRATEGY.tensionPerCallToArms);
      this.game.displayMessage(
        "events_display.called_to_arms",
        MessageType.WAR_DECLARED,
        ally.id(),
        undefined,
        { ally: target.displayName(), enemy: player.displayName() },
        undefined,
        player.id(),
      );
    }
    target.updateRelation(player, -100);
    return true;
  }

  private startWar(a: Player, b: Player, aggressor: Player): void {
    this.wars.push({
      a: a.smallID(),
      b: b.smallID(),
      aggressor: aggressor.smallID(),
      startTick: this.game.ticks(),
    });
    // A war voids any justification or war goal between the two.
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const s = this.state(x);
      if (s.justification?.target === y.smallID()) s.justification = null;
      s.warGoals = s.warGoals.filter((g) => g.target !== y.smallID());
    }
    this.markDirty(a, b);
  }

  peaceBlocker(player: Player, target: Player): StrategyBlocker | null {
    if (!this.rulesEnabled()) return "disabled";
    const i = this.warIndex(player.smallID(), target.smallID());
    if (i === -1) return "not_at_war";
    if (
      this.game.ticks() - this.wars[i].startTick <
      STRATEGY.minWarSecondsBeforePeace * 10
    ) {
      return "too_early";
    }
    if (
      this.peaceOffers.some(
        (o) => o.from === player.smallID() && o.to === target.smallID(),
      )
    ) {
      return "already";
    }
    return null;
  }

  offerPeace(player: Player, target: Player): boolean {
    if (this.peaceBlocker(player, target) !== null) return false;
    // A standing offer the other way means both want peace.
    if (this.hasPeaceOffer(target, player)) {
      return this.acceptPeace(player, target);
    }
    this.peaceOffers.push({
      from: player.smallID(),
      to: target.smallID(),
      expiresAt: this.game.ticks() + STRATEGY.peaceOfferSeconds * 10,
    });
    this.game.displayMessage(
      "events_display.peace_offered",
      MessageType.PEACE,
      target.id(),
      undefined,
      { name: player.displayName() },
      undefined,
      player.id(),
    );
    this.markDirty(player, target);
    return true;
  }

  hasPeaceOffer(from: Player, to: Player): boolean {
    return this.peaceOffers.some(
      (o) => o.from === from.smallID() && o.to === to.smallID(),
    );
  }

  acceptPeace(player: Player, from: Player): boolean {
    if (!this.hasPeaceOffer(from, player)) return false;
    const i = this.warIndex(player.smallID(), from.smallID());
    if (i === -1) return false;
    this.endWar(i);
    this.truces.push({
      a: from.smallID(),
      b: player.smallID(),
      until: this.game.ticks() + STRATEGY.truceSeconds * 10,
    });
    for (const [x, y] of [
      [player, from],
      [from, player],
    ]) {
      this.game.displayMessage(
        "events_display.peace_signed",
        MessageType.PEACE,
        x.id(),
        undefined,
        { name: y.displayName() },
        undefined,
        y.id(),
      );
    }
    return true;
  }

  rejectPeace(player: Player, from: Player): boolean {
    const before = this.peaceOffers.length;
    this.peaceOffers = this.peaceOffers.filter(
      (o) => !(o.from === from.smallID() && o.to === player.smallID()),
    );
    if (this.peaceOffers.length === before) return false;
    this.game.displayMessage(
      "events_display.peace_rejected",
      MessageType.PEACE,
      from.id(),
      undefined,
      { name: player.displayName() },
      undefined,
      player.id(),
    );
    this.markDirty(player, from);
    return true;
  }

  private endWar(index: number): void {
    const w = this.wars[index];
    this.wars.splice(index, 1);
    this.peaceOffers = this.peaceOffers.filter(
      (o) =>
        !((o.from === w.a && o.to === w.b) || (o.from === w.b && o.to === w.a)),
    );
    for (const id of [w.a, w.b]) {
      this.strategyDirty.add(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Research, focus, laws

  researchBlocker(player: Player, tech: TechID): StrategyBlocker | null {
    if (player.type() === PlayerType.Bot) return "bot";
    const s = this.state(player);
    const blocker = techBlocker(
      tech,
      new Set(s.completedTechs),
      s.research.map((r) => r.tech),
    );
    if (blocker !== null) return blocker;
    if (s.research.length >= s.researchSlots) return "no_slot";
    return null;
  }

  startResearch(player: Player, tech: TechID): boolean {
    if (this.researchBlocker(player, tech) !== null) return false;
    this.state(player).research.push({ tech, progress: 0 });
    this.markDirty(player);
    return true;
  }

  cancelResearch(player: Player, tech: TechID): boolean {
    const s = this.state(player);
    const i = s.research.findIndex((r) => r.tech === tech);
    if (i === -1) return false;
    s.research.splice(i, 1);
    this.markDirty(player);
    return true;
  }

  focusBlocker(player: Player, focus: FocusID): StrategyBlocker | null {
    if (player.type() === PlayerType.Bot) return "bot";
    const s = this.state(player);
    return focusBlocker(
      focus,
      new Set(s.completedFocuses),
      s.focus?.id ?? null,
    );
  }

  startFocus(player: Player, focus: FocusID): boolean {
    if (this.focusBlocker(player, focus) !== null) return false;
    this.state(player).focus = { id: focus, progress: 0 };
    this.markDirty(player);
    return true;
  }

  cancelFocus(player: Player): boolean {
    const s = this.state(player);
    if (s.focus === null) return false;
    s.focus = null;
    this.markDirty(player);
    return true;
  }

  lawBlocker(player: Player, law: LawID): StrategyBlocker | null {
    if (player.type() === PlayerType.Bot) return "bot";
    const s = this.state(player);
    const def = lawDef(law);
    if (s.laws[def.category] === law) return "already";
    if (this.game.ticks() < s.lawCooldownUntil) return "cooldown";
    if (!lawAllowed(def, this.isAtWarWithAnyone(player), this.worldTension())) {
      return "requires_war";
    }
    if (s.politicalPower < STRATEGY.lawChangeCost * 100) {
      return "political_power";
    }
    return null;
  }

  setLaw(player: Player, law: LawID): boolean {
    if (this.lawBlocker(player, law) !== null) return false;
    const s = this.state(player);
    s.politicalPower -= STRATEGY.lawChangeCost * 100;
    s.laws[lawDef(law).category] = law;
    s.lawCooldownUntil =
      this.game.ticks() + STRATEGY.lawChangeCooldownSeconds * 10;
    this.invalidateModifiers(player);
    this.markDirty(player);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Units: tech locks and raw materials

  /** Why the player can't build this unit on the strategy layer, or null. */
  unitBlocker(player: Player, type: UnitType): "tech" | "resources" | null {
    if (!this.rulesEnabled() || player.type() === PlayerType.Bot) return null;
    const tech = requiredTechFor(type);
    const s = this.state(player);
    if (tech !== null && !s.completedTechs.includes(tech)) return "tech";
    const cost = UNIT_RESOURCE_COSTS[type];
    if (
      cost !== undefined &&
      !this.game.config().hasInfiniteResourcesFor(player)
    ) {
      for (const r of RESOURCE_TYPES) {
        if (s.resources[r] < (cost[r] ?? 0) * 100) return "resources";
      }
    }
    return null;
  }

  /** Takes the unit's raw materials. Call only after unitBlocker passed. */
  payForUnit(player: Player, type: UnitType): void {
    if (!this.rulesEnabled() || player.type() === PlayerType.Bot) return;
    const cost = UNIT_RESOURCE_COSTS[type];
    if (
      cost === undefined ||
      this.game.config().hasInfiniteResourcesFor(player)
    ) {
      return;
    }
    const s = this.state(player);
    for (const r of RESOURCE_TYPES) {
      s.resources[r] = Math.max(0, s.resources[r] - (cost[r] ?? 0) * 100);
    }
    this.markDirty(player);
  }

  // ---------------------------------------------------------------------------
  // Combat

  /** Fighting strength of `player` attacking with the given supply level. */
  attackStrength(player: Player, supply: SupplyLevel): number {
    if (!this.rulesEnabled() || player.type() === PlayerType.Bot) return 1;
    const s = this.state(player);
    const mods = this.modifiers(player);
    const fuel =
      s.resources[ResourceType.Oil] > 0 ? 1 : FUEL_SHORTAGE_EFFECTIVENESS;
    return (
      (Math.max(10, 100 + mods.attack) / 100) *
      equipmentEffectiveness(s.equipmentRatio, 1) *
      supplyEffectiveness(supply) *
      fuel
    );
  }

  defenseStrength(player: Player): number {
    if (!this.rulesEnabled() || player.type() === PlayerType.Bot) return 1;
    const s = this.state(player);
    const mods = this.modifiers(player);
    return (
      (Math.max(10, 100 + mods.defense) / 100) *
      equipmentEffectiveness(s.equipmentRatio, 1)
    );
  }

  /** Attack speed multiplier from techs, focuses and supply. */
  attackSpeed(player: Player, supply: SupplyLevel): number {
    if (!this.rulesEnabled() || player.type() === PlayerType.Bot) return 1;
    const mods = this.modifiers(player);
    const fuel =
      this.state(player).resources[ResourceType.Oil] > 0
        ? 1
        : FUEL_SHORTAGE_EFFECTIVENESS;
    return (
      (Math.max(10, 100 + mods.attackSpeed) / 100) *
      supplyEffectiveness(supply) *
      fuel
    );
  }

  /** Soldiers who die take their equipment with them. */
  onTroopsLost(player: Player, troops: number): void {
    if (troops <= 0 || player.type() === PlayerType.Bot) return;
    const s = this.players.get(player.smallID());
    if (s === undefined) return;
    s.equipment = Math.max(0, s.equipment - troops * s.equipmentRatio);
  }

  /**
   * How well an army fighting at `tile` is supplied: by the capital, or by a
   * city, port or factory (farther when it is on the rail network).
   */
  supplyLevel(player: Player, tile: TileRef): SupplyLevel {
    if (!this.rulesEnabled() || player.type() === PlayerType.Bot) {
      return SupplyLevel.Supplied;
    }
    const rangeMult = Math.max(10, 100 + this.modifiers(player).supplyRange);
    const stretch = STRATEGY.stretchedRangeMultiplier;
    const capital = player.spawnTile();
    const capRange = (STRATEGY.capitalSupplyRange * rangeMult) / 100;
    const plain = (hubSupplyRange(false) * rangeMult) / 100;
    const rail = (hubSupplyRange(true) * rangeMult) / 100;
    const d2 =
      capital === undefined
        ? Infinity
        : this.game.euclideanDistSquared(capital, tile);

    const hubWithin = (plainRange: number, railRange: number): boolean =>
      this.game.anyUnitNearby(
        tile,
        plainRange,
        SUPPLY_HUB_TYPES,
        () => true,
        player.id(),
      ) ||
      this.game.anyUnitNearby(
        tile,
        railRange,
        SUPPLY_HUB_TYPES,
        (u) => u.hasTrainStation(),
        player.id(),
      );

    if (d2 <= capRange * capRange || hubWithin(plain, rail)) {
      return SupplyLevel.Supplied;
    }
    if (
      d2 <= capRange * capRange * stretch * stretch ||
      hubWithin(plain * stretch, rail * stretch)
    ) {
      return SupplyLevel.Stretched;
    }
    return SupplyLevel.Unsupplied;
  }

  /**
   * Once a second for each land attack against a player: burns its fuel and
   * returns the troops it loses to attrition at this supply level.
   */
  attackUpkeep(
    player: Player,
    attackTroops: number,
    supply: SupplyLevel,
  ): number {
    if (!this.rulesEnabled() || player.type() === PlayerType.Bot) return 0;
    const s = this.state(player);
    const oil = attackFuelCentiPerSecond(attackTroops);
    s.resources[ResourceType.Oil] = Math.max(
      0,
      s.resources[ResourceType.Oil] - oil,
    );
    s.fuelBurned += oil;
    if (supply !== SupplyLevel.Supplied) {
      const tick = this.game.ticks();
      if (s.supplyTick !== tick) {
        s.supplyTick = tick;
        s.unsuppliedAttacks = 0;
      }
      s.unsuppliedAttacks++;
    }
    const permille = attritionPermille(supply, this.modifiers(player));
    return (attackTroops * permille) / 1000;
  }

  // ---------------------------------------------------------------------------
  // Events from the rest of the game

  onNukeLaunched(type: UnitType): void {
    if (!this.rulesEnabled()) return;
    switch (type) {
      case UnitType.AtomBomb:
        this.addTension(STRATEGY.tensionPerAtomBomb);
        break;
      case UnitType.HydrogenBomb:
        this.addTension(STRATEGY.tensionPerHydrogenBomb);
        break;
      case UnitType.MIRV:
        this.addTension(STRATEGY.tensionPerMIRV);
        break;
    }
  }

  onPlayerConquered(conquered: Player): void {
    const id = conquered.smallID();
    if (conquered.type() !== PlayerType.Bot && this.rulesEnabled()) {
      this.addTension(STRATEGY.tensionPerConquest);
    }
    this.dropPlayerRelations(id);
  }

  /** Removes every war, truce, offer and war goal involving player `id`. */
  private dropPlayerRelations(id: number): void {
    const touched = new Set<number>();
    this.wars = this.wars.filter((w) => {
      if (w.a !== id && w.b !== id) return true;
      touched.add(w.a).add(w.b);
      return false;
    });
    this.truces = this.truces.filter((t) => t.a !== id && t.b !== id);
    this.peaceOffers = this.peaceOffers.filter(
      (o) => o.from !== id && o.to !== id,
    );
    for (const [pid, s] of this.players) {
      if (s.justification?.target === id) {
        s.justification = null;
        touched.add(pid);
      }
      const before = s.warGoals.length;
      s.warGoals = s.warGoals.filter((g) => g.target !== id);
      if (s.warGoals.length !== before) touched.add(pid);
    }
    for (const t of touched) this.strategyDirty.add(t);
  }

  // ---------------------------------------------------------------------------
  // Tick

  tick(ticks: number): void {
    const second = ticks % STRATEGY_INTERVAL_TICKS === 0;
    if (second) this.countDeposits();
    for (const [id, s] of this.players) {
      const p = this.playerBySmallID(id);
      if (
        p === null ||
        p.type() === PlayerType.Bot ||
        !p.isAlive() ||
        !p.hasSpawned()
      ) {
        continue;
      }
      this.tickPlayer(p, s, ticks, second);
    }
    if (second) this.tickWorld(ticks);
  }

  private tickPlayer(
    p: Player,
    s: PlayerStrategyState,
    ticks: number,
    second: boolean,
  ): void {
    const mods = this.modifiers(p);

    s.politicalPower = Math.min(
      STRATEGY.politicalPowerCap * 100,
      s.politicalPower +
        Math.floor(
          (STRATEGY.politicalPowerPerSecond * 10 * (100 + mods.ppGain)) / 100,
        ),
    );

    const instant = this.game.config().instantResearch();
    if (s.research.length > 0) {
      const speed = Math.max(
        10,
        100 + mods.researchSpeed + cityResearchBonus(s.cityLevels),
      );
      const done: TechID[] = [];
      for (const r of s.research) {
        r.progress = instant ? techCostTicks(r.tech) * 100 : r.progress + speed;
        if (r.progress >= techCostTicks(r.tech) * 100) done.push(r.tech);
      }
      for (const tech of done) this.completeResearch(p, s, tech);
    }

    if (s.focus !== null) {
      s.focus.progress = instant
        ? focusCostTicks(s.focus.id)
        : s.focus.progress + 1;
      if (s.focus.progress >= focusCostTicks(s.focus.id)) {
        this.completeFocus(p, s, s.focus.id);
      }
    }

    if (s.justification !== null) {
      const target = this.playerBySmallID(s.justification.target);
      if (target === null || this.hostilityBlocker(p, target) !== null) {
        s.justification = null;
        this.markDirty(p);
      } else if (++s.justification.progress >= s.justification.needed) {
        s.warGoals.push({
          target: target.smallID(),
          expiresAt: ticks + STRATEGY.warGoalSeconds * 10,
        });
        s.justification = null;
        this.game.displayMessage(
          "events_display.war_goal_justified",
          MessageType.WAR_DECLARED,
          p.id(),
          undefined,
          { name: target.displayName() },
          undefined,
          target.id(),
        );
        this.markDirty(p);
      }
    }

    if (second) this.industry(p, s, mods, ticks);
  }

  private completeResearch(
    p: Player,
    s: PlayerStrategyState,
    tech: TechID,
  ): void {
    s.research = s.research.filter((r) => r.tech !== tech);
    s.completedTechs.push(tech);
    this.invalidateModifiers(p);
    this.markDirty(p);
  }

  private completeFocus(p: Player, s: PlayerStrategyState, id: FocusID): void {
    const def = focusDef(id);
    s.focus = null;
    s.completedFocuses.push(id);
    if (def.researchSlots !== undefined) {
      s.researchSlots = Math.min(
        STRATEGY.maxResearchSlots,
        s.researchSlots + def.researchSlots,
      );
    }
    const grant = def.grant;
    if (grant !== undefined) {
      if (grant.gold !== undefined) p.addGold(BigInt(grant.gold));
      if (grant.equipment !== undefined) s.equipment += grant.equipment;
      if (grant.politicalPower !== undefined) {
        s.politicalPower = Math.min(
          STRATEGY.politicalPowerCap * 100,
          s.politicalPower + grant.politicalPower * 100,
        );
      }
      for (const r of RESOURCE_TYPES) {
        s.resources[r] += (grant.resources?.[r] ?? 0) * 100;
      }
    }
    this.invalidateModifiers(p);
    this.markDirty(p);
  }

  /** Once a second: resources, factories, equipment, laws, war goals. */
  private industry(
    p: Player,
    s: PlayerStrategyState,
    mods: Modifiers,
    ticks: number,
  ): void {
    let factoryLevels = 0;
    for (const u of p.units(UnitType.Factory)) {
      if (!u.isUnderConstruction()) factoryLevels += u.level();
    }
    let cityLevels = 0;
    for (const u of p.units(UnitType.City)) {
      if (!u.isUnderConstruction()) cityLevels += u.level();
    }
    s.cityLevels = cityLevels;

    const extraction = Math.max(10, 100 + mods.resourceExtraction);
    const gross = zeroResources();
    for (const r of RESOURCE_TYPES) {
      const perMinute =
        STRATEGY.baseResourcePerMinute +
        s.depositTiles[r] * STRATEGY.depositYieldPerTilePerMinute;
      // perMinute * extraction is hundredths per minute.
      gross[r] = Math.floor((perMinute * extraction) / 60);
    }
    const synthetic = syntheticOilPerMinute(
      s.completedTechs,
      s.completedFocuses,
    );
    gross[ResourceType.Oil] += Math.floor((synthetic * 100) / 60);
    for (const r of RESOURCE_TYPES) s.resources[r] += gross[r];

    // Factories turn steel into equipment; short on steel, they slow down.
    const steelNeeded = Math.floor(
      (factoryLevels * STRATEGY.steelPerFactoryLevelPerMinute * 100) / 60,
    );
    let factoryOutput = 1;
    let steelUsed = 0;
    if (steelNeeded > 0) {
      const steel = s.resources[ResourceType.Steel];
      steelUsed = Math.min(steel, steelNeeded);
      factoryOutput = steelUsed / steelNeeded;
      s.resources[ResourceType.Steel] = steel - steelUsed;
    }
    const perMinute = Math.max(
      0,
      ((STRATEGY.baseEquipmentPerMinute +
        factoryLevels *
          STRATEGY.equipmentPerFactoryLevelPerMinute *
          factoryOutput) *
        (100 + mods.equipmentProduction)) /
        100,
    );
    s.equipment += perMinute / 60;
    s.equipmentProduction = Math.floor(perMinute);
    this.refreshEquipmentRatio(p, s);

    for (const r of RESOURCE_TYPES) {
      let net = gross[r];
      if (r === ResourceType.Steel) net -= steelUsed;
      if (r === ResourceType.Oil) net -= s.fuelBurned;
      s.resourceIncome[r] = Math.trunc((net * 60) / 100);
    }
    s.fuelBurned = 0;

    // Laws that need a war lapse at peace.
    const atWar = this.isAtWarWithAnyone(p);
    let lawsChanged = false;
    for (const c of LAW_CATEGORIES) {
      if (!lawAllowed(lawDef(s.laws[c]), atWar, this.worldTension())) {
        s.laws[c] = DEFAULT_LAWS[c];
        lawsChanged = true;
      }
    }
    if (lawsChanged) this.invalidateModifiers(p);

    s.warGoals = s.warGoals.filter((g) => g.expiresAt > ticks);
  }

  private refreshEquipmentRatio(p: Player, s: PlayerStrategyState): void {
    let needed = p.troops();
    for (const a of p.outgoingAttacks()) needed += a.troops();
    s.equipmentNeeded = Math.floor(needed);
    s.equipmentRatio = needed <= 0 ? 1 : Math.min(1, s.equipment / needed);
  }

  private countDeposits(): void {
    for (const s of this.players.values()) {
      for (const r of RESOURCE_TYPES) s.depositTiles[r] = 0;
    }
    const map = this.game.map();
    for (const d of this.deposits()) {
      for (const t of d.tiles) {
        const owner = map.ownerID(t);
        if (owner === 0) continue;
        const s = this.players.get(owner);
        if (s !== undefined) s.depositTiles[d.type]++;
      }
    }
  }

  private tickWorld(ticks: number): void {
    this.tensionCenti = Math.max(
      0,
      this.tensionCenti -
        Math.floor((STRATEGY.tensionDecayPerMinute * 100) / 60),
    );
    this.peaceOffers = this.peaceOffers.filter((o) => o.expiresAt > ticks);
    this.truces = this.truces.filter((t) => t.until > ticks);
    // Wars end when a side is gone.
    for (let i = this.wars.length - 1; i >= 0; i--) {
      const w = this.wars[i];
      const a = this.playerBySmallID(w.a);
      const b = this.playerBySmallID(w.b);
      if (a === null || b === null || !a.isAlive() || !b.isAlive()) {
        this.endWar(i);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Client views

  /**
   * Sends changed views to the client: every player's once a second (progress
   * moves), plus any player an action touched this tick.
   */
  flushUpdates(ticks: number): void {
    const all = ticks % STRATEGY_INTERVAL_TICKS === 0;
    if (!all && this.strategyDirty.size === 0) return;
    for (const [id, s] of this.players) {
      if (!all && !this.strategyDirty.has(id)) continue;
      const p = this.playerBySmallID(id);
      if (p === null || p.type() === PlayerType.Bot) continue;
      const view = this.buildView(p, s, ticks);
      const json = JSON.stringify(view);
      if (this.strategySentViews.get(id) === json) continue;
      this.strategySentViews.set(id, json);
      this.game.addUpdate({
        type: GameUpdateType.Strategy,
        playerID: id,
        view,
      });
    }
    this.strategyDirty.clear();
  }

  view(player: Player): StrategyView {
    return this.buildView(player, this.state(player), this.game.ticks());
  }

  private buildView(
    p: Player,
    s: PlayerStrategyState,
    ticks: number,
  ): StrategyView {
    const id = p.smallID();
    const resources = zeroResources();
    for (const r of RESOURCE_TYPES) {
      resources[r] = Math.floor(s.resources[r] / 100);
    }
    const wars: number[] = [];
    for (const w of this.wars) {
      if (w.a === id) wars.push(w.b);
      else if (w.b === id) wars.push(w.a);
    }
    return {
      politicalPower: Math.floor(s.politicalPower / 100),
      researchSlots: s.researchSlots,
      research: s.research.map((r) => ({
        tech: r.tech,
        permille: Math.min(
          1000,
          Math.floor((r.progress * 10) / techCostTicks(r.tech)),
        ),
      })),
      completedTechs: [...s.completedTechs],
      focus:
        s.focus === null
          ? null
          : {
              id: s.focus.id,
              permille: Math.min(
                1000,
                Math.floor(
                  (s.focus.progress * 1000) / focusCostTicks(s.focus.id),
                ),
              ),
            },
      completedFocuses: [...s.completedFocuses],
      laws: { ...s.laws },
      lawCooldownUntil: s.lawCooldownUntil,
      resources,
      resourceIncome: { ...s.resourceIncome },
      depositTilesOwned: { ...s.depositTiles },
      equipment: Math.floor(s.equipment),
      equipmentNeeded: s.equipmentNeeded,
      equipmentProduction: s.equipmentProduction,
      justification:
        s.justification === null
          ? null
          : {
              target: s.justification.target,
              permille: Math.min(
                1000,
                Math.floor(
                  (s.justification.progress * 1000) / s.justification.needed,
                ),
              ),
            },
      warGoals: s.warGoals.map((g) => ({ ...g })),
      wars,
      truces: this.truces
        .filter((t) => t.a === id || t.b === id)
        .map((t) => ({ target: t.a === id ? t.b : t.a, until: t.until })),
      incomingPeaceOffers: this.peaceOffers
        .filter((o) => o.to === id)
        .map((o) => o.from),
      outgoingPeaceOffers: this.peaceOffers
        .filter((o) => o.from === id)
        .map((o) => o.to),
      unsuppliedAttacks: s.supplyTick >= ticks - 10 ? s.unsuppliedAttacks : 0,
      modifiers: { ...this.modifiers(p) },
      worldTension: this.worldTension(),
    };
  }

  hash(): number {
    let h = this.wars.length * 31 + Math.floor(this.tensionCenti);
    for (const [id, s] of this.players) {
      h += id * (Math.floor(s.equipment) + s.politicalPower);
    }
    return h;
  }

  // ---------------------------------------------------------------------------
  // Snapshot

  snapshot(): StrategyState {
    return {
      players: [...this.players].map(([id, s]) => [
        id,
        {
          ...s,
          research: s.research.map((r) => ({ ...r })),
          completedTechs: [...s.completedTechs],
          focus: s.focus === null ? null : { ...s.focus },
          completedFocuses: [...s.completedFocuses],
          laws: { ...s.laws },
          resources: { ...s.resources },
          resourceIncome: { ...s.resourceIncome },
          depositTiles: { ...s.depositTiles },
          justification:
            s.justification === null ? null : { ...s.justification },
          warGoals: s.warGoals.map((g) => ({ ...g })),
        },
      ]),
      wars: this.wars.map((w) => ({ ...w })),
      truces: this.truces.map((t) => ({ ...t })),
      peaceOffers: this.peaceOffers.map((o) => ({ ...o })),
      tensionCenti: this.tensionCenti,
      depositSites: this.depositSites.map((d) => ({ ...d })),
    };
  }

  restore(s: StrategyState): void {
    this.players = new Map(
      s.players.map(([id, p]) => [
        id,
        {
          ...p,
          research: p.research.map((r) => ({ ...r })),
          completedTechs: [...p.completedTechs],
          focus: p.focus === null ? null : { ...p.focus },
          completedFocuses: [...p.completedFocuses],
          laws: { ...p.laws },
          resources: { ...p.resources },
          resourceIncome: { ...p.resourceIncome },
          depositTiles: { ...p.depositTiles },
          justification:
            p.justification === null ? null : { ...p.justification },
          warGoals: p.warGoals.map((g) => ({ ...g })),
        },
      ]),
    );
    this.wars = s.wars.map((w) => ({ ...w }));
    this.truces = s.truces.map((t) => ({ ...t }));
    this.peaceOffers = s.peaceOffers.map((o) => ({ ...o }));
    this.tensionCenti = s.tensionCenti;
    this.depositSites = s.depositSites.map((d) => ({ ...d }));
    this.strategyDeposits = undefined;
    this.strategyModifierCache = new Map();
    this.strategySentViews = new Map();
    this.strategyDirty = new Set();
  }

  /** For a snapshot written before strategy existed: everyone starts fresh. */
  restoreDefaults(players: Player[]): void {
    this.players = new Map();
    for (const p of players) this.addPlayer(p);
    // Best effort: the terrain may have changed since the game began.
    this.initDeposits();
  }
}

const zResources = () =>
  z.object({
    [ResourceType.Oil]: zInt(),
    [ResourceType.Steel]: zInt(),
    [ResourceType.Aluminium]: zInt(),
  });

const PlayerStrategySchema = z.object({
  politicalPower: zInt(),
  researchSlots: zInt(),
  research: z.array(z.object({ tech: z.enum(TECH_IDS), progress: zInt() })),
  completedTechs: z.array(z.enum(TECH_IDS)),
  focus: z.object({ id: z.enum(FOCUS_IDS), progress: zInt() }).nullable(),
  completedFocuses: z.array(z.enum(FOCUS_IDS)),
  laws: z.object({
    conscription: z.enum(LAW_IDS),
    economy: z.enum(LAW_IDS),
    trade: z.enum(LAW_IDS),
  }),
  lawCooldownUntil: zInt(),
  resources: zResources(),
  resourceIncome: zResources(),
  fuelBurned: zInt(),
  equipment: zNum(),
  equipmentRatio: zNum(),
  equipmentNeeded: zInt(),
  equipmentProduction: zInt(),
  cityLevels: zInt(),
  depositTiles: zResources(),
  justification: z
    .object({ target: zPlayerRef(), progress: zInt(), needed: zInt() })
    .nullable(),
  warGoals: z.array(z.object({ target: zPlayerRef(), expiresAt: zInt() })),
  unsuppliedAttacks: zInt(),
  supplyTick: zInt(),
});

export const StrategySnapshot = snapshotType({
  name: "Strategy",
  version: 1,
  schema: z.object({
    players: z.array(z.tuple([zPlayerRef(), PlayerStrategySchema])),
    wars: z.array(
      z.object({
        a: zPlayerRef(),
        b: zPlayerRef(),
        aggressor: zPlayerRef(),
        startTick: zInt(),
      }),
    ),
    truces: z.array(
      z.object({ a: zPlayerRef(), b: zPlayerRef(), until: zInt() }),
    ),
    peaceOffers: z.array(
      z.object({ from: zPlayerRef(), to: zPlayerRef(), expiresAt: zInt() }),
    ),
    tensionCenti: zInt(),
    depositSites: z.array(
      z.object({
        type: z.enum(ResourceType),
        center: zTile(),
        radius: zInt(),
      }),
    ),
  }),
});
export type StrategyState = z.infer<typeof StrategySnapshot.schema>;
