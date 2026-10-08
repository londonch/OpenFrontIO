import {
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  FOCUS_IDS,
  LAW_IDS,
  ResourceType,
  TECH_IDS,
} from "@openfront/engine-api/game/Strategy";
import { generateDeposits } from "@openfront/engine-lib/strategy/Deposits";
import { focusBlocker, FOCUSES } from "@openfront/engine-lib/strategy/Focuses";
import { LAWS } from "@openfront/engine-lib/strategy/Laws";
import {
  emptyModifiers,
  focusCostTicks,
  justifyTicks,
  STRATEGY,
  SupplyLevel,
  techCostTicks,
} from "@openfront/engine-lib/strategy/StrategyRules";
import {
  requiredTechFor,
  techBlocker,
  TECHS,
} from "@openfront/engine-lib/strategy/Techs";
import {
  AttackLogicInput,
  EngineConfig,
} from "@openfront/engine/configuration/EngineConfig";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { StrategyExecution } from "@openfront/engine/execution/StrategyExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { PlayerImpl } from "@openfront/engine/game/PlayerImpl";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { GrandStrategyTestConfig, TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

function conquerBox(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) p.conquer(game.ref(x, y));
  }
}

function addPlayer(
  game: Game,
  name: string,
  type: PlayerType = PlayerType.Human,
): Player {
  return game.addPlayer(new PlayerInfo(name, type, null, name));
}

/** Alice holds the west half of the map, Bob the east. */
async function twoNations(
  map = "plains",
  ConfigClass: typeof EngineConfig = GrandStrategyTestConfig,
) {
  const game = await setup(
    map,
    { instantBuild: true },
    [],
    undefined,
    ConfigClass,
  );
  const size = game.width();
  const alice = addPlayer(game, "alice");
  const bob = addPlayer(game, "bob");
  conquerBox(game, alice, 0, 0, size / 2, size);
  conquerBox(game, bob, size / 2, 0, size, size);
  alice.setSpawnTile(game.ref(5, size / 2));
  bob.setSpawnTile(game.ref(size - 5, size / 2));
  return { game, alice, bob, strategy: game.strategy() };
}

function act(
  game: Game,
  player: Player,
  action: ConstructorParameters<typeof StrategyExecution>[1],
  key: ConstructorParameters<typeof StrategyExecution>[2] = null,
  target: Player | null = null,
) {
  game.addExecution(
    new StrategyExecution(player, action, key, target?.id() ?? null),
  );
  // Init at the end of this tick, applied on the next.
  executeTicks(game, 2);
}

/** Justifies and declares war on `target`. */
function goToWar(game: Game, player: Player, target: Player) {
  const strategy = game.strategy();
  act(game, player, "justify", null, target);
  executeTicks(game, strategy.justifyDurationTicks(player) + 1);
  act(game, player, "declare_war", null, target);
}

describe("grand strategy data", () => {
  test("every tech's prerequisites and exclusives exist and are acyclic", () => {
    for (const tech of TECHS.values()) {
      for (const r of [...tech.requires, ...(tech.exclusive ?? [])]) {
        expect(TECHS.has(r)).toBe(true);
      }
    }
    // Research everything in some order: proves there is no cycle.
    const done = new Set<string>();
    for (let pass = 0; pass < TECH_IDS.length; pass++) {
      for (const t of TECHS.values()) {
        if (t.requires.every((r) => done.has(r))) done.add(t.id);
      }
    }
    expect(done.size).toBe(TECH_IDS.length);
  });

  test("every focus is reachable", () => {
    const done = new Set<string>();
    for (let pass = 0; pass < FOCUS_IDS.length; pass++) {
      for (const f of FOCUSES.values()) {
        if (f.requires.every((r) => done.has(r))) done.add(f.id);
      }
    }
    expect(done.size).toBe(FOCUS_IDS.length);
  });

  test("every law has a definition and nukes are gated by research", () => {
    expect(LAWS.size).toBe(LAW_IDS.length);
    expect(requiredTechFor(UnitType.MissileSilo)).toBe("rocketry");
    expect(requiredTechFor(UnitType.AtomBomb)).toBe("nuclear_fission");
    expect(requiredTechFor(UnitType.HydrogenBomb)).toBe("thermonuclear");
    expect(requiredTechFor(UnitType.MIRV)).toBe("mirv_systems");
    expect(requiredTechFor(UnitType.City)).toBeNull();
  });

  test("doctrines exclude each other", () => {
    const done = new Set(TECH_IDS);
    done.delete("mobile_warfare");
    done.delete("superior_firepower");
    done.delete("grand_battleplan");
    const completed = new Set([...done, "mobile_warfare" as const]);
    expect(techBlocker("superior_firepower", completed, [])).toBe("exclusive");
    expect(techBlocker("superior_firepower", done, ["grand_battleplan"])).toBe(
      "exclusive",
    );
    expect(techBlocker("superior_firepower", done, [])).toBeNull();
  });

  test("one ideology per game", () => {
    const completed = new Set([
      "political_effort",
      "embrace_democracy",
    ] as const);
    expect(focusBlocker("embrace_autocracy", completed, null)).toBe(
      "exclusive",
    );
    expect(focusBlocker("arsenal_of_democracy", completed, null)).toBeNull();
    expect(focusBlocker("arsenal_of_democracy", completed, "army_effort")).toBe(
      "busy",
    );
  });

  test("world tension shortens justification, to half at most", () => {
    const mods = emptyModifiers();
    const calm = justifyTicks(mods, 0);
    expect(calm).toBe(STRATEGY.justifyBaseSeconds * 10);
    expect(justifyTicks(mods, 1000)).toBe(calm / 2);
    expect(justifyTicks({ ...mods, justifyTime: -50 }, 0)).toBe(calm / 2);
    expect(justifyTicks({ ...mods, justifyTime: -95 }, 1000)).toBe(
      STRATEGY.justifyMinSeconds * 10,
    );
  });
});

describe("resource deposits", () => {
  test("the same map always gets the same deposits, all on land", async () => {
    const { game } = await twoNations("big_plains");
    const a = generateDeposits(game.map());
    const b = generateDeposits(game.map());
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    const seen = new Set<number>();
    for (const d of a) {
      expect(d.tiles.length).toBeGreaterThan(0);
      for (const t of d.tiles) {
        expect(game.isLand(t)).toBe(true);
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
  });

  test("owning deposit tiles raises income", async () => {
    const { game, alice, bob, strategy } = await twoNations("big_plains");
    executeTicks(game, 11);
    const view = (p: Player) => strategy.view(p);
    const deposits = game.strategy().deposits();
    const aliceTiles = deposits
      .flatMap((d) => d.tiles)
      .filter((t) => game.owner(t) === alice).length;
    const counted =
      view(alice).depositTilesOwned.oil +
      view(alice).depositTilesOwned.steel +
      view(alice).depositTilesOwned.aluminium;
    expect(counted).toBe(aliceTiles);
    expect(view(bob).depositTilesOwned).toBeDefined();
  });
});

describe("war rules", () => {
  test("no attacks without a war", async () => {
    const { game, alice, bob } = await twoNations();
    const bobTiles = bob.numTilesOwned();
    expect(alice.canAttackPlayer(bob)).toBe(false);
    game.addExecution(new AttackExecution(1000, alice, bob.id()));
    executeTicks(game, 5);
    expect(alice.outgoingAttacks()).toHaveLength(0);
    expect(bob.numTilesOwned()).toBe(bobTiles);
  });

  test("without the rules (TestConfig) anyone can attack anyone", async () => {
    const { alice, bob } = await twoNations("plains", TestConfig);
    expect(alice.canAttackPlayer(bob)).toBe(true);
  });

  test("tribes need no war either way", async () => {
    const { game, alice } = await twoNations();
    const tribe = addPlayer(game, "tribe", PlayerType.Bot);
    tribe.conquer(game.ref(0, 0));
    expect(alice.canAttackPlayer(tribe)).toBe(true);
    expect(tribe.canAttackPlayer(alice)).toBe(true);
    expect(game.strategy().justifyBlocker(alice, tribe)).toBe("bot");
  });

  test("justify a war goal, declare war, then attack", async () => {
    const { game, alice, bob, strategy } = await twoNations();
    const ppBefore = strategy.politicalPower(alice);
    act(game, alice, "justify", null, bob);
    expect(strategy.justification(alice)?.target).toBe(bob.smallID());
    expect(strategy.politicalPower(alice)).toBeLessThan(ppBefore);
    // Declaring before the goal is justified does nothing.
    act(game, alice, "declare_war", null, bob);
    expect(strategy.isAtWar(alice, bob)).toBe(false);

    executeTicks(game, strategy.justifyDurationTicks(alice));
    expect(strategy.hasWarGoal(alice, bob)).toBe(true);
    act(game, alice, "declare_war", null, bob);
    expect(strategy.isAtWar(alice, bob)).toBe(true);
    expect(strategy.isAtWar(bob, alice)).toBe(true);
    expect(strategy.hasWarGoal(alice, bob)).toBe(false);
    expect(strategy.worldTension()).toBeGreaterThan(0);

    const bobTiles = bob.numTilesOwned();
    game.addExecution(new AttackExecution(5000, alice, bob.id()));
    executeTicks(game, 10);
    expect(bob.numTilesOwned()).toBeLessThan(bobTiles);
    // The defender may strike back without a war goal of its own.
    expect(bob.canAttackPlayer(alice)).toBe(true);
  });

  test("war goals cost political power", async () => {
    const { game, alice, bob, strategy } = await twoNations();
    // Starting PP covers one justification, not two at once.
    expect(strategy.justifyBlocker(alice, bob)).toBeNull();
    act(game, alice, "justify", null, bob);
    expect(strategy.justifyBlocker(alice, bob)).toBe("busy");
  });

  test("the target's allies are called to arms", async () => {
    const { game, alice, bob, strategy } = await twoNations();
    const carol = addPlayer(game, "carol");
    carol.conquer(game.ref(60, 0));
    bob.createAllianceRequest(carol)?.accept();
    expect(bob.isAlliedWith(carol)).toBe(true);

    goToWar(game, alice, bob);
    expect(strategy.isAtWar(alice, bob)).toBe(true);
    expect(strategy.isAtWar(alice, carol)).toBe(true);
    expect(alice.canSendAllianceRequest(carol)).toBe(false);
  });

  test("allies can't be targeted", async () => {
    const { alice, bob, strategy } = await twoNations();
    alice.createAllianceRequest(bob)?.accept();
    expect(strategy.justifyBlocker(alice, bob)).toBe("friendly");
  });

  test("enemies don't trade", async () => {
    const { game, alice, bob } = await twoNations();
    expect(alice.canTrade(bob)).toBe(true);
    goToWar(game, alice, bob);
    expect(alice.canTrade(bob)).toBe(false);
  });

  test("peace: offer, accept, truce, attacks fall back", async () => {
    const { game, alice, bob, strategy } = await twoNations();
    goToWar(game, alice, bob);
    // Too soon after the declaration.
    expect(strategy.peaceBlocker(bob, alice)).toBe("too_early");
    executeTicks(game, STRATEGY.minWarSecondsBeforePeace * 10);

    game.addExecution(new AttackExecution(5000, alice, bob.id()));
    executeTicks(game, 3);
    expect(alice.outgoingAttacks()).toHaveLength(1);

    act(game, bob, "offer_peace", null, alice);
    expect(strategy.hasPeaceOffer(bob, alice)).toBe(true);
    act(game, alice, "accept_peace", null, bob);
    expect(strategy.isAtWar(alice, bob)).toBe(false);
    executeTicks(game, 2);
    expect(alice.outgoingAttacks()).toHaveLength(0);
    // A truce: no new war goal for a while.
    expect(strategy.justifyBlocker(alice, bob)).toBe("truce");
    executeTicks(game, STRATEGY.truceSeconds * 10 + 10);
    expect(strategy.justifyBlocker(alice, bob)).toBeNull();
  });

  test("rejected and expired peace offers", async () => {
    const { game, alice, bob, strategy } = await twoNations();
    goToWar(game, alice, bob);
    executeTicks(game, STRATEGY.minWarSecondsBeforePeace * 10);
    act(game, bob, "offer_peace", null, alice);
    act(game, alice, "reject_peace", null, bob);
    expect(strategy.hasPeaceOffer(bob, alice)).toBe(false);
    expect(strategy.isAtWar(alice, bob)).toBe(true);

    act(game, bob, "offer_peace", null, alice);
    executeTicks(game, STRATEGY.peaceOfferSeconds * 10 + 10);
    expect(strategy.hasPeaceOffer(bob, alice)).toBe(false);
  });

  test("nukes need a war", async () => {
    const { game, alice, bob } = await twoNations();
    const target = game.ref(90, 50);
    const impl = alice as PlayerImpl;
    alice.buildUnit(UnitType.MissileSilo, game.ref(20, 50), {});
    expect(impl.nukeSpawn(target, UnitType.AtomBomb)).toBe(false);
    goToWar(game, alice, bob);
    expect(impl.nukeSpawn(target, UnitType.AtomBomb)).not.toBe(false);
  });
});

describe("research", () => {
  test("a tech completes in its research time and grants its bonus", async () => {
    const { game, alice, strategy } = await twoNations();
    act(game, alice, "research", "basic_machine_tools");
    expect(strategy.activeResearch(alice)).toEqual(["basic_machine_tools"]);
    executeTicks(game, techCostTicks("basic_machine_tools"));
    expect(strategy.completedTechs(alice)).toEqual(["basic_machine_tools"]);
    expect(strategy.modifiers(alice).equipmentProduction).toBe(10);
    expect(alice.strategyModifier("equipmentProduction")).toBe(10);
  });

  test("research slots are limited", async () => {
    const { game, alice, strategy } = await twoNations();
    act(game, alice, "research", "basic_machine_tools");
    act(game, alice, "research", "infantry_weapons_1");
    expect(strategy.researchBlocker(alice, "construction_1")).toBe("no_slot");
    act(game, alice, "cancel_research", "infantry_weapons_1");
    expect(strategy.researchBlocker(alice, "construction_1")).toBeNull();
  });

  test("prerequisites come first", async () => {
    const { alice, strategy } = await twoNations();
    expect(strategy.researchBlocker(alice, "nuclear_fission")).toBe(
      "prerequisites",
    );
  });

  test("missile silos unlock with rocketry", async () => {
    const { game, alice, strategy } = await twoNations();
    alice.addGold(10_000_000n);
    const tile = game.ref(20, 50);
    expect(strategy.unitBlocker(alice, UnitType.MissileSilo)).toBe("tech");
    expect(alice.canBuild(UnitType.MissileSilo, tile)).toBe(false);
    act(game, alice, "research", "rocketry");
    executeTicks(game, techCostTicks("rocketry"));
    expect(strategy.unitBlocker(alice, UnitType.MissileSilo)).toBeNull();
    expect(alice.canBuild(UnitType.MissileSilo, tile)).not.toBe(false);

    // Building takes its raw materials.
    const steel = strategy.resource(alice, ResourceType.Steel);
    alice.buildUnit(UnitType.MissileSilo, tile, {});
    expect(strategy.resource(alice, ResourceType.Steel)).toBe(steel - 80);
  });

  test("raw materials gate builds", async () => {
    const { game, alice, strategy } = await twoNations();
    alice.addGold(10_000_000n);
    const tile = game.ref(20, 50);
    expect(alice.canBuild(UnitType.DefensePost, tile)).not.toBe(false);
    strategy.setResource(alice, ResourceType.Steel, 0);
    expect(strategy.unitBlocker(alice, UnitType.DefensePost)).toBe("resources");
    expect(alice.canBuild(UnitType.DefensePost, tile)).toBe(false);
  });
});

describe("national focus", () => {
  test("a focus completes, grants its reward and its bonus", async () => {
    const { game, alice, strategy } = await twoNations();
    act(game, alice, "focus", "political_effort");
    expect(strategy.currentFocus(alice)).toBe("political_effort");
    const pp = strategy.politicalPower(alice);
    executeTicks(game, focusCostTicks("political_effort"));
    expect(strategy.completedFocuses(alice)).toEqual(["political_effort"]);
    expect(strategy.currentFocus(alice)).toBeNull();
    expect(strategy.modifiers(alice).ppGain).toBe(20);
    // The +50 grant plus a minute of income.
    expect(strategy.politicalPower(alice)).toBeGreaterThan(pp + 50);
  });

  test("one focus at a time", async () => {
    const { game, alice, strategy } = await twoNations();
    act(game, alice, "focus", "army_effort");
    expect(strategy.focusBlocker(alice, "industrial_effort")).toBe("busy");
    act(game, alice, "cancel_focus");
    expect(strategy.focusBlocker(alice, "industrial_effort")).toBeNull();
  });
});

describe("laws", () => {
  test("laws cost political power and have a cooldown", async () => {
    const { game, alice, strategy } = await twoNations();
    expect(strategy.lawBlocker(alice, "extensive_conscription")).toBe(
      "political_power",
    );
    const maxBefore = game.config().maxTroops(alice);
    strategy.addPoliticalPower(alice, 400);
    act(game, alice, "law", "extensive_conscription");
    expect(strategy.law(alice, "conscription")).toBe("extensive_conscription");
    expect(game.config().maxTroops(alice)).toBeCloseTo(maxBefore * 1.1, 0);
    expect(strategy.lawBlocker(alice, "volunteer_only")).toBe("cooldown");
  });

  test("war laws need a war and lapse at peace", async () => {
    const { game, alice, bob, strategy } = await twoNations();
    strategy.addPoliticalPower(alice, 900);
    expect(strategy.lawBlocker(alice, "total_mobilization")).toBe(
      "requires_war",
    );
    goToWar(game, alice, bob);
    act(game, alice, "law", "total_mobilization");
    expect(strategy.law(alice, "economy")).toBe("total_mobilization");

    executeTicks(game, STRATEGY.minWarSecondsBeforePeace * 10);
    act(game, bob, "offer_peace", null, alice);
    act(game, alice, "accept_peace", null, bob);
    executeTicks(game, 11);
    expect(strategy.law(alice, "economy")).toBe("partial_mobilization");
  });

  test("high world tension allows a war economy in peacetime", async () => {
    const { game, alice, strategy } = await twoNations();
    strategy.addPoliticalPower(alice, 400);
    expect(strategy.lawBlocker(alice, "war_economy")).toBe("requires_war");
    strategy.addTension(600);
    act(game, alice, "law", "war_economy");
    expect(strategy.law(alice, "economy")).toBe("war_economy");
  });
});

describe("industry", () => {
  test("factories turn steel into equipment", async () => {
    const { game, alice, strategy } = await twoNations();
    executeTicks(game, 21);
    const base = strategy.view(alice).equipmentProduction;
    expect(base).toBe(STRATEGY.baseEquipmentPerMinute);

    alice.buildUnit(UnitType.Factory, game.ref(25, 25), {});
    alice.buildUnit(UnitType.Factory, game.ref(25, 70), {});
    executeTicks(game, 10);
    const withFactory = strategy.view(alice).equipmentProduction;
    expect(withFactory).toBe(
      STRATEGY.baseEquipmentPerMinute +
        2 * STRATEGY.equipmentPerFactoryLevelPerMinute,
    );

    // With no stockpile, the base steel income runs only one of the two.
    strategy.setResource(alice, ResourceType.Steel, 0);
    executeTicks(game, 10);
    expect(strategy.view(alice).equipmentProduction).toBeLessThan(withFactory);
  });

  test("the equipment stockpile grows and casualties take their gear", async () => {
    const { game, alice, strategy } = await twoNations();
    const before = strategy.equipment(alice);
    executeTicks(game, 20);
    expect(strategy.equipment(alice)).toBeGreaterThan(before);
    const stock = strategy.equipment(alice);
    strategy.onTroopsLost(alice, 1000);
    expect(strategy.equipment(alice)).toBeLessThan(stock);
  });
});

describe("combat", () => {
  const input: AttackLogicInput = {
    terrain: TerrainType.Plains,
    attackTroops: 10_000,
    attacker: { type: PlayerType.Human, numTiles: 1000 },
    defender: {
      type: PlayerType.Human,
      numTiles: 1000,
      troops: 10_000,
      isTraitor: false,
      isDisconnectedTeammate: false,
    },
    defenderHasDefensePost: false,
    falloutRatio: null,
    borderSize: 10,
  };

  async function realLogic() {
    const { game } = await twoNations();
    return (i: AttackLogicInput) =>
      EngineConfig.prototype.attackLogic.call(game.config(), i);
  }

  test("even strengths fight exactly like the base game", async () => {
    const logic = await realLogic();
    const base = logic(input);
    expect(
      logic({
        ...input,
        attackerStrength: 1,
        defenderStrength: 1,
        attackerSpeed: 1,
      }),
    ).toEqual(base);
  });

  test("the stronger side trades better, within bounds", async () => {
    const logic = await realLogic();
    const base = logic(input);
    const strong = logic({ ...input, attackerStrength: 2 });
    expect(strong.attackerTroopLoss).toBeCloseTo(base.attackerTroopLoss / 2);
    expect(strong.defenderTroopLoss).toBeCloseTo(base.defenderTroopLoss * 2);
    expect(strong.tickFraction).toBeLessThan(base.tickFraction);

    const crushing = logic({ ...input, attackerStrength: 100 });
    expect(crushing.attackerTroopLoss).toBeCloseTo(base.attackerTroopLoss / 3);
  });

  test("an unequipped army fights at half strength", async () => {
    const { game, alice, bob, strategy } = await twoNations();
    const full = strategy.attackStrength(alice, SupplyLevel.Supplied);
    strategy.setEquipment(alice, 0);
    expect(strategy.attackStrength(alice, SupplyLevel.Supplied)).toBeCloseTo(
      full / 2,
    );
    expect(strategy.defenseStrength(bob)).toBe(1);
    // Out of oil, attacks also lose their punch.
    strategy.setResource(alice, ResourceType.Oil, 0);
    expect(strategy.attackStrength(alice, SupplyLevel.Supplied)).toBeLessThan(
      full / 2,
    );
    expect(game.ticks()).toBeGreaterThanOrEqual(0);
  });
});

describe("supply", () => {
  test("fronts near the capital or a hub are supplied, far ones are not", async () => {
    const { game, alice, strategy } = await twoNations("big_plains");
    // Capital at (5, 100).
    expect(strategy.supplyLevel(alice, game.ref(20, 100))).toBe(
      SupplyLevel.Supplied,
    );
    expect(strategy.supplyLevel(alice, game.ref(99, 199))).toBe(
      SupplyLevel.Stretched,
    );
    // Far from everything: move the capital to the opposite corner.
    alice.setSpawnTile(game.ref(199, 0));
    expect(strategy.supplyLevel(alice, game.ref(0, 199))).toBe(
      SupplyLevel.Unsupplied,
    );
    // A city near the front supplies it.
    alice.buildUnit(UnitType.City, game.ref(10, 190), {});
    expect(strategy.supplyLevel(alice, game.ref(0, 199))).toBe(
      SupplyLevel.Supplied,
    );
  });

  test("cut-off attacks bleed troops", async () => {
    const { game, alice, bob, strategy } = await twoNations("big_plains");
    alice.setSpawnTile(game.ref(0, 0));
    goToWar(game, alice, bob);
    expect(strategy.attackUpkeep(alice, 10_000, SupplyLevel.Supplied)).toBe(0);
    expect(
      strategy.attackUpkeep(alice, 10_000, SupplyLevel.Unsupplied),
    ).toBeGreaterThan(
      strategy.attackUpkeep(alice, 10_000, SupplyLevel.Stretched),
    );
  });
});

describe("client view and snapshots", () => {
  test("views reach the client on the Strategy channel", async () => {
    const { game, alice } = await twoNations();
    let seen = false;
    for (let i = 0; i < 12 && !seen; i++) {
      const updates = game.executeNextTick();
      seen = updates[GameUpdateType.Strategy].some(
        (u) => u.playerID === alice.smallID(),
      );
    }
    expect(seen).toBe(true);
  });

  test("a game mid-war, mid-research survives a snapshot round trip", async () => {
    const { game, alice, bob, strategy } = await twoNations();
    act(game, alice, "research", "basic_machine_tools");
    act(game, bob, "focus", "army_effort");
    goToWar(game, alice, bob);
    game.addExecution(new AttackExecution(5000, alice, bob.id()));
    executeTicks(game, STRATEGY.minWarSecondsBeforePeace * 10);
    act(game, bob, "offer_peace", null, alice);
    strategy.addTension(100);
    await expectSnapshotRoundTrip(game, "plains", 40);
  });
});
