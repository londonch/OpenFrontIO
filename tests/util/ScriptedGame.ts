import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { MapManifest } from "@openfront/engine-api/game/MapFiles";
import {
  FOCUS_IDS,
  FocusID,
  TECH_IDS,
  TechID,
} from "@openfront/engine-api/game/Strategy";
import {
  flattenedEmojiTable,
  GameConfig,
  GameStartInfo,
  Intent,
  StampedIntent,
  Turn,
} from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Game, Player } from "@openfront/engine/game/Game";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "@openfront/engine/GameRunner";
import { readSnapshotHeader } from "@openfront/engine/snapshot/GameSnapshot";
import {
  GameMapLoader,
  loadMapFiles,
  MapData,
} from "@openfront/shared/GameMapLoader";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serves one directory of tests/testdata/maps for whatever map type the game
 * config names, so the real createGameRunner pipeline can run on test maps.
 */
export class TestDataMapLoader implements GameMapLoader {
  constructor(private mapName: string) {}

  getMapData(): MapData {
    const dir = path.join(__dirname, `../testdata/maps/${this.mapName}`);
    const read = (name: string) => async () =>
      new Uint8Array(fs.readFileSync(path.join(dir, name)));
    return {
      mapBin: read("map.bin"),
      map4xBin: read("map4x.bin"),
      map16xBin: read("map16x.bin"),
      manifest: async () =>
        JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        ) as MapManifest,
      webpPath: path.join(dir, "thumbnail.webp"),
      layerPng: async () => {
        throw new Error("no layers in test maps");
      },
    };
  }
}

export const SCRIPTED_HUMANS = ["HUMAN001", "HUMAN002", "HUMAN003"] as const;

export function scriptedGameStart(
  overrides: Partial<GameConfig> = {},
): GameStartInfo {
  return {
    gameID: "SNAPTEST1",
    lobbyCreatedAt: 0,
    config: {
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Compact,
      gameMode: GameMode.FFA,
      gameType: GameType.Private,
      difficulty: Difficulty.Hard,
      nations: 12,
      bots: 40,
      donateGold: true,
      donateTroops: true,
      infiniteGold: true,
      infiniteTroops: false,
      instantBuild: false,
      // Research at its real pace would keep silos, SAMs and nukes out of
      // the short scripted game; this keeps every execution type in play.
      instantResearch: true,
      randomSpawn: false,
      doomsdayClock: { enabled: true, speed: "veryfast" },
      ...overrides,
    },
    players: SCRIPTED_HUMANS.map((clientID, i) => ({
      clientID,
      username: `scripted${i}`,
      clanTag: null,
      isLobbyCreator: i === 0,
    })),
  };
}

export async function createScriptedRunner(
  mapName: string,
  gameStart: GameStartInfo,
): Promise<GameRunner> {
  const { gameMap, gameMapSize } = gameStart.config;
  return createGameRunner(
    gameStart,
    undefined,
    await loadMapFiles(new TestDataMapLoader(mapName), gameMap, gameMapSize),
    recordErrors,
  );
}

export async function restoreScriptedRunner(
  mapName: string,
  gameStart: GameStartInfo,
  snapshot: Uint8Array,
): Promise<GameRunner> {
  const { gameMap, gameMapSize } = readSnapshotHeader(snapshot).gameConfig;
  return createGameRunnerFromSnapshot(
    gameStart,
    snapshot,
    undefined,
    await loadMapFiles(new TestDataMapLoader(mapName), gameMap, gameMapSize),
    recordErrors,
  );
}

let lastError: ErrorUpdate | null = null;
function recordErrors(gu: GameUpdateViewData | ErrorUpdate): void {
  if ("errMsg" in gu) lastError = gu;
}

/** Runs one tick with the scripted humans' intents for it. */
export function stepScripted(runner: GameRunner): void {
  runner.addTurn(scriptedTurn(runner.game));
  lastError = null;
  if (!runner.executeNextTick()) {
    const err = lastError as ErrorUpdate | null;
    throw new Error(
      `tick ${runner.game.ticks()} failed: ${err?.errMsg}\n${err?.stack}`,
    );
  }
}

/**
 * Deterministic "human" players that exercise every intent. The choices are
 * a pure function of the game state and tick, so a restored game gets the
 * same intents as the original at the same tick.
 */
export function scriptedTurn(game: Game): Turn {
  const tick = game.ticks();
  const rand = new PseudoRandom(tick * 7919 + 17);
  const intents: StampedIntent[] = [];
  for (const clientID of SCRIPTED_HUMANS) {
    const p = game.playerByClientID(clientID);
    if (p === null) continue;
    const intent = game.inSpawnPhase()
      ? (spawnIntent(game, p, tick) ?? queuedIntent(game, p, tick))
      : playIntent(game, p, rand);
    if (intent !== null) intents.push({ ...intent, clientID } as StampedIntent);
  }
  if (tick === 21) {
    // From a client that is not in the game: becomes a NoOpExecution.
    intents.push({
      type: "emoji",
      recipient: AllPlayers,
      emoji: 0,
      clientID: "UNKNOWN1",
    });
  }
  return { turnNumber: tick, intents };
}

// Rough land coordinates on the world test map (compact size, 1000x500).
const SPAWNS = [
  [250, 330], // South America
  [520, 170], // Europe
  [760, 230], // Asia
];

function spawnIntent(game: Game, p: Player, tick: number): Intent | null {
  if (p.hasSpawned() || tick < 5) return null;
  const i = SCRIPTED_HUMANS.indexOf(p.clientID() as never);
  const [x, y] = SPAWNS[i];
  const tile = nearestSpawnable(game, x, y);
  return tile === null ? null : { type: "spawn", tile };
}

/**
 * One of each intent while the spawn phase holds them back: they sit in the
 * pending list until the game starts, which is the only time a snapshot can
 * catch executions that finish within the tick they start.
 */
function queuedIntent(game: Game, p: Player, tick: number): Intent | null {
  if (p.clientID() !== SCRIPTED_HUMANS[0] || tick < 20 || tick % 2 !== 0) {
    return null;
  }
  const other = game.playerByClientID(SCRIPTED_HUMANS[1]);
  if (other === null) return null;
  const queued: Intent[] = [
    { type: "attack", targetID: other.id(), troops: 10 },
    { type: "cancel_attack", attackID: "nonexistent" },
    { type: "boat", troops: 10, dst: other.spawnTile() ?? 0 },
    { type: "cancel_boat", unitID: 1 },
    { type: "allianceRequest", recipient: other.id() },
    { type: "allianceReject", requestor: other.id() },
    { type: "breakAlliance", recipient: other.id() },
    { type: "allianceExtension", recipient: other.id() },
    { type: "targetPlayer", target: other.id() },
    { type: "emoji", recipient: AllPlayers, emoji: 0 },
    { type: "donate_gold", recipient: other.id(), gold: 1 },
    { type: "donate_troops", recipient: other.id(), troops: 1 },
    { type: "embargo", targetID: other.id(), action: "start" },
    { type: "embargo_all", action: "stop" },
    {
      type: "build_unit",
      unit: UnitType.City,
      tile: p.spawnTile() ?? 0,
    },
    { type: "upgrade_structure", unit: UnitType.City, unitId: 1 },
    { type: "move_warship", unitIds: [1], tile: 0 },
    { type: "delete_unit", unitId: 1 },
    {
      type: "quick_chat",
      recipient: other.id(),
      quickChatKey: "greet.hello",
    },
    { type: "mark_disconnected", isDisconnected: false },
    { type: "strategy", action: "research", key: "rocketry" },
    { type: "strategy", action: "focus", key: "political_effort" },
    { type: "strategy", action: "justify", target: other.id() },
    { type: "toggle_pause", paused: false },
  ];
  return queued[(tick - 20) / 2] ?? null;
}

function nearestSpawnable(game: Game, cx: number, cy: number): TileRef | null {
  for (let r = 0; r < 60; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!game.isValidCoord(x, y)) continue;
        const t = game.ref(x, y);
        if (game.isLand(t) && !game.isImpassable(t) && !game.hasOwner(t)) {
          return t;
        }
      }
    }
  }
  return null;
}

function pick<T>(rand: PseudoRandom, arr: readonly T[]): T | null {
  return arr.length === 0 ? null : arr[rand.nextInt(0, arr.length)];
}

function randomOwnedTile(rand: PseudoRandom, p: Player): TileRef | null {
  const n = p.numTilesOwned();
  if (n === 0) return null;
  const k = rand.nextInt(0, n);
  let i = 0;
  for (const t of p.tiles()) {
    if (i++ === k) return t;
  }
  return null;
}

const SCRIPTED_RESEARCH: readonly TechID[] = [
  "rocketry",
  "radar",
  "nuclear_fission",
  "thermonuclear",
  "mirv_systems",
  ...TECH_IDS,
];

/** How much of SCRIPTED_FOCUS and SCRIPTED_RESEARCH the opening plays. */
const OPENING_FOCUSES = 3;
const OPENING_TECHS = 5;

const SCRIPTED_FOCUS: readonly FocusID[] = [
  "political_effort",
  "embrace_autocracy",
  "expansionism",
  ...FOCUS_IDS,
];

const STRUCTURES = [
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
] as const;

/**
 * The grand strategy opening every scripted human plays before acting at
 * random: rush the autocratic focuses (wars justify four times faster) and
 * the nuclear techs, build a port and a SAM, justify a war on the next
 * scripted human, and declare as soon as the goal is ready. Without it, wars, and with them shells, SAM
 * interceptions and nukes on players, come too late for the short game.
 */
function strategyOpening(game: Game, p: Player): Intent | null {
  const strategy = game.strategy();
  const goal = strategy.view(p).warGoals[0];
  if (goal !== undefined) {
    const target = game.playerBySmallID(goal.target);
    if (target.isPlayer()) {
      return { type: "strategy", action: "declare_war", target: target.id() };
    }
  }
  const focus = SCRIPTED_FOCUS.slice(0, OPENING_FOCUSES).find(
    (f) => strategy.focusBlocker(p, f) === null,
  );
  if (focus !== undefined)
    return { type: "strategy", action: "focus", key: focus };
  const tech = SCRIPTED_RESEARCH.slice(0, OPENING_TECHS).find(
    (t) => strategy.researchBlocker(p, t) === null,
  );
  if (tech !== undefined) {
    return { type: "strategy", action: "research", key: tech };
  }
  // A port early, so trade ships sail before the short game ends.
  if (p.units(UnitType.Port).length === 0) {
    for (const t of p.borderTiles()) {
      if (game.isShore(t) && p.canBuild(UnitType.Port, t) !== false) {
        return { type: "build_unit", unit: UnitType.Port, tile: t };
      }
    }
  }
  // And a SAM, for the enemy's nukes to fly into (see case 8).
  if (p.units(UnitType.SAMLauncher).length === 0) {
    let tried = 0;
    for (const t of p.tiles()) {
      if (++tried > 200) break;
      if (p.canBuild(UnitType.SAMLauncher, t) !== false) {
        return { type: "build_unit", unit: UnitType.SAMLauncher, tile: t };
      }
    }
  }
  // A MIRV at the enemy shortly before each 100-tick checkpoint, so one is
  // in flight when FullGameSnapshot records which executions exist.
  const enemy = strategy.enemies(p)[0];
  const enemyTile = enemy?.spawnTile();
  if (
    p.clientID() === SCRIPTED_HUMANS[0] &&
    game.ticks() % 100 === 80 &&
    enemyTile !== undefined &&
    p.units(UnitType.MIRV).length === 0 &&
    p.canBuild(UnitType.MIRV, enemyTile) !== false
  ) {
    return { type: "build_unit", unit: UnitType.MIRV, tile: enemyTile };
  }
  // Each scripted human picks a fight with the next one.
  const i = SCRIPTED_HUMANS.indexOf(p.clientID() as never);
  const rival = game.playerByClientID(
    SCRIPTED_HUMANS[(i + 1) % SCRIPTED_HUMANS.length],
  );
  if (
    rival !== null &&
    strategy.enemies(p).length === 0 &&
    strategy.justifyBlocker(p, rival) === null
  ) {
    return { type: "strategy", action: "justify", target: rival.id() };
  }
  return null;
}

function playIntent(game: Game, p: Player, rand: PseudoRandom): Intent | null {
  if (!p.isAlive()) return null;
  const opening = strategyOpening(game, p);
  if (opening !== null) return opening;
  // Most ticks a human does nothing; keep the game moving.
  if (!rand.chance(3)) return null;
  const others = game.players().filter((o) => o !== p && o.isPlayer());
  const other = pick(rand, others);
  const own = (types: UnitType[]) => p.units(types);

  switch (rand.nextInt(0, 25)) {
    case 0:
    case 1:
    case 2: {
      const target = pick(rand, p.nearby());
      if (target === null) return null;
      return {
        type: "attack",
        targetID: target.isPlayer() ? target.id() : null,
        troops: p.troops() / 4,
      };
    }
    case 3: {
      if (other === null) return null;
      const dst = pick(
        rand,
        [...other.borderTiles()].filter((t) => game.isShore(t)),
      );
      if (dst === null) return null;
      return { type: "boat", troops: p.troops() / 5, dst };
    }
    case 4:
    case 5:
    case 6: {
      const unit = pick(rand, STRUCTURES)!;
      const tile =
        unit === UnitType.Port
          ? pick(
              rand,
              [...p.borderTiles()].filter((t) => game.isShore(t)),
            )
          : randomOwnedTile(rand, p);
      if (tile === null || p.canBuild(unit, tile) === false) return null;
      return { type: "build_unit", unit, tile };
    }
    case 7: {
      const port = pick(rand, own([UnitType.Port]));
      if (port === null) return null;
      const water = nearbyWater(game, port.tile(), rand);
      if (water === null || p.canBuild(UnitType.Warship, water) === false) {
        return null;
      }
      return { type: "build_unit", unit: UnitType.Warship, tile: water };
    }
    case 8: {
      if (own([UnitType.MissileSilo]).length === 0 || other === null) {
        return null;
      }
      const unit = pick(rand, [
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
        UnitType.MIRV,
      ])!;
      // Nukes need a war (or a tribe target). Aim at an enemy's SAM when
      // there is one, so interceptions happen too.
      const target = pick(rand, game.strategy().enemies(p)) ?? other;
      const tile =
        pick(rand, target.units(UnitType.SAMLauncher))?.tile() ??
        randomOwnedTile(rand, target);
      if (tile === null || p.canBuild(unit, tile) === false) return null;
      return {
        type: "build_unit",
        unit,
        tile,
        rocketDirectionUp: rand.chance(2),
      };
    }
    case 9: {
      const s = pick(rand, own([...STRUCTURES]));
      if (s === null) return null;
      return { type: "upgrade_structure", unit: s.type(), unitId: s.id() };
    }
    case 10: {
      if (other === null) return null;
      if (p.isAlliedWith(other)) {
        return rand.chance(4)
          ? { type: "breakAlliance", recipient: other.id() }
          : { type: "allianceExtension", recipient: other.id() };
      }
      return { type: "allianceRequest", recipient: other.id() };
    }
    case 11: {
      const req = pick(rand, p.incomingAllianceRequests());
      if (req === null) return null;
      return { type: "allianceReject", requestor: req.requestor().id() };
    }
    case 12: {
      const ally = pick(rand, p.allies());
      if (ally === null) return null;
      return rand.chance(2)
        ? { type: "donate_gold", recipient: ally.id(), gold: 1000 }
        : { type: "donate_troops", recipient: ally.id(), troops: null };
    }
    case 13:
      if (other === null) return null;
      return {
        type: "embargo",
        targetID: other.id(),
        action: rand.chance(2) ? "start" : "stop",
      };
    case 14:
      return { type: "embargo_all", action: rand.chance(2) ? "start" : "stop" };
    case 15:
      return {
        type: "emoji",
        recipient: other === null || rand.chance(3) ? AllPlayers : other.id(),
        emoji: rand.nextInt(0, flattenedEmojiTable.length),
      };
    case 16:
      if (other === null) return null;
      return rand.chance(2)
        ? { type: "targetPlayer", target: other.id() }
        : {
            type: "quick_chat",
            recipient: other.id(),
            quickChatKey: "greet.hello",
          };
    case 17: {
      const attack = pick(rand, p.outgoingAttacks());
      if (attack === null) return null;
      return { type: "cancel_attack", attackID: attack.id() };
    }
    case 18: {
      const boat = pick(rand, own([UnitType.TransportShip]));
      if (boat === null) return null;
      return { type: "cancel_boat", unitID: boat.id() };
    }
    case 19: {
      const ships = own([UnitType.Warship]);
      const ship = pick(rand, ships);
      if (ship === null) return null;
      const water = nearbyWater(game, ship.tile(), rand);
      if (water === null) return null;
      return { type: "move_warship", unitIds: [ship.id()], tile: water };
    }
    case 20: {
      const s = pick(rand, own([UnitType.DefensePost, UnitType.City]));
      if (s === null || !rand.chance(4)) return null;
      return { type: "delete_unit", unitId: s.id() };
    }
    case 21:
      return {
        type: "mark_disconnected",
        isDisconnected: !p.isDisconnected() && rand.chance(3),
      };
    case 22: {
      // Rocketry first, so silos, SAMs and nukes come into play.
      const strategy = game.strategy();
      const tech = SCRIPTED_RESEARCH.find(
        (t) => strategy.researchBlocker(p, t) === null,
      );
      return tech === undefined
        ? null
        : { type: "strategy", action: "research", key: tech };
    }
    case 23: {
      const strategy = game.strategy();
      // Down the autocratic path: it justifies wars four times faster, so
      // the short game still sees wars (and the shells and nukes they allow).
      const focus =
        SCRIPTED_FOCUS.find((f) => strategy.focusBlocker(p, f) === null) ??
        null;
      return focus === null
        ? null
        : { type: "strategy", action: "focus", key: focus };
    }
    case 24: {
      const strategy = game.strategy();
      const goal = strategy.view(p).warGoals[0];
      if (goal !== undefined) {
        const target = game.playerBySmallID(goal.target);
        if (target.isPlayer()) {
          return {
            type: "strategy",
            action: "declare_war",
            target: target.id(),
          };
        }
      }
      if (other === null) return null;
      if (strategy.hasDeclaredWar(p, other)) {
        return {
          type: "strategy",
          action: strategy.hasPeaceOffer(other, p)
            ? "accept_peace"
            : "offer_peace",
          target: other.id(),
        };
      }
      return {
        type: "strategy",
        action: strategy.hasWarGoal(p, other) ? "declare_war" : "justify",
        target: other.id(),
      };
    }
  }
  return null;
}

function nearbyWater(
  game: Game,
  tile: TileRef,
  rand: PseudoRandom,
): TileRef | null {
  const x = game.x(tile);
  const y = game.y(tile);
  for (let i = 0; i < 20; i++) {
    const nx = x + rand.nextInt(-12, 13);
    const ny = y + rand.nextInt(-12, 13);
    if (!game.isValidCoord(nx, ny)) continue;
    const t = game.ref(nx, ny);
    if (game.isOcean(t)) return t;
  }
  return null;
}
