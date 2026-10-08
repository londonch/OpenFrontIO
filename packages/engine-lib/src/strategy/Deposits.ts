import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { TerrainType } from "@openfront/engine-api/game/GameTypes";
import { ResourceType } from "@openfront/engine-api/game/Strategy";
import { PseudoRandom } from "../PseudoRandom";

/**
 * A strategic resource deposit: a disc of land that yields one resource to
 * whoever owns its tiles. Deposits are fixed geography: a map always gets the
 * same ones, placed on its original terrain. The engine stores the sites in
 * its snapshots, since a water nuke changes the terrain they were placed on.
 */
export interface DepositSite {
  type: ResourceType;
  center: TileRef;
  radius: number;
}

export interface Deposit extends DepositSite {
  id: number;
  /** Every tile of the disc; tiles that are (or became) water yield nothing. */
  tiles: TileRef[];
}

export function depositFromSite(
  map: GameMap,
  site: DepositSite,
  id: number,
): Deposit {
  const cx = map.x(site.center);
  const cy = map.y(site.center);
  const r = site.radius;
  const tiles: TileRef[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      if (!map.isValidCoord(cx + dx, cy + dy)) continue;
      tiles.push(map.ref(cx + dx, cy + dy));
    }
  }
  return { ...site, id, tiles };
}

/** Land tiles per deposit, before the min/max clamp. */
const LAND_TILES_PER_DEPOSIT = 30_000;
const MIN_DEPOSITS = 8;
const MAX_DEPOSITS = 60;
const MIN_RADIUS = 5;
const MAX_RADIUS = 8;
const ATTEMPTS_PER_DEPOSIT = 60;

// Odds out of 100 of [oil, steel, aluminium] by the terrain at the center.
const ODDS: Record<number, readonly [number, number, number]> = {
  [TerrainType.Plains]: [55, 20, 25],
  [TerrainType.Highland]: [25, 35, 40],
  [TerrainType.Mountain]: [15, 60, 25],
};

function pickType(random: PseudoRandom, terrain: TerrainType): ResourceType {
  const [oil, steel] = ODDS[terrain] ?? ODDS[TerrainType.Plains];
  const roll = random.nextInt(0, 100);
  if (roll < oil) return ResourceType.Oil;
  if (roll < oil + steel) return ResourceType.Steel;
  return ResourceType.Aluminium;
}

function usable(map: GameMap, tile: TileRef): boolean {
  return map.isLand(tile) && !map.isImpassable(tile);
}

export function generateDeposits(map: GameMap): Deposit[] {
  return generateDepositSites(map).map((s, i) => depositFromSite(map, s, i));
}

/** Places deposits on the map's current terrain (call on a fresh map). */
export function generateDepositSites(map: GameMap): DepositSite[] {
  const width = map.width();
  const height = map.height();
  const numLand = map.numLandTiles();
  if (numLand === 0) return [];

  const random = new PseudoRandom(
    (width * 73_856_093) ^ (height * 19_349_663) ^ (numLand * 83_492_791),
  );
  const target = Math.max(
    MIN_DEPOSITS,
    Math.min(MAX_DEPOSITS, Math.floor(numLand / LAND_TILES_PER_DEPOSIT)),
  );
  // Spread deposits out: roughly the spacing they'd have on an even grid.
  const minSpacing = Math.max(
    MAX_RADIUS * 3,
    Math.floor(Math.sqrt(numLand / target) / 2),
  );
  const minSpacingSq = minSpacing * minSpacing;

  const deposits: DepositSite[] = [];
  for (
    let attempt = 0;
    attempt < target * ATTEMPTS_PER_DEPOSIT && deposits.length < target;
    attempt++
  ) {
    const x = random.nextInt(0, width);
    const y = random.nextInt(0, height);
    const center = map.ref(x, y);
    if (!usable(map, center)) continue;
    if (
      deposits.some(
        (d) => map.euclideanDistSquared(d.center, center) < minSpacingSq,
      )
    ) {
      continue;
    }
    const radius = random.nextInt(MIN_RADIUS, MAX_RADIUS + 1);
    let land = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (map.isValidCoord(tx, ty) && usable(map, map.ref(tx, ty))) land++;
      }
    }
    // Slivers of coast or mountain passes make poor deposits.
    if (land < (radius * radius) / 2) continue;
    deposits.push({
      type: pickType(random, map.terrainType(center)),
      center,
      radius,
    });
  }
  return deposits;
}
