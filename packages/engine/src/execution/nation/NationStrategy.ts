import {
  FOCUS_IDS,
  StrategyAction,
  StrategyKey,
  TechID,
} from "@openfront/engine-api/game/Strategy";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { STRATEGY } from "@openfront/engine-lib/strategy/StrategyRules";
import { Game, Player } from "../../game/Game";
import { StrategyExecution } from "../StrategyExecution";

/*
 * How nations play the grand strategy layer. Stateless: everything lives in
 * the StrategyManager, and nations act through StrategyExecutions just as a
 * player's intents do, so nothing here needs a snapshot.
 */

/**
 * The order nations look at techs in. A nation picks among the first few it
 * can research, so nations differ but all reach rocketry and industry early.
 */
const RESEARCH_PRIORITY: readonly TechID[] = [
  "basic_machine_tools",
  "infantry_weapons_1",
  "rocketry",
  "radar",
  "construction_1",
  "logistics_companies",
  "excavation_1",
  "improved_machine_tools",
  "support_weapons",
  "infantry_weapons_2",
  "nuclear_fission",
  "central_banking",
  "mass_mobilization",
  "field_hospitals",
  "motorized",
  "artillery",
  "merchant_marine",
  "excavation_2",
  "construction_2",
  "advanced_machine_tools",
  "superior_firepower",
  "mobile_warfare",
  "grand_battleplan",
  "infantry_weapons_3",
  "armor",
  "thermonuclear",
  "railway_logistics",
  "synthetic_refineries",
  "naval_engineering",
  "mirv_systems",
];

/** How many of the top available techs a nation chooses between. */
const RESEARCH_CHOICES = 3;

function act(
  game: Game,
  player: Player,
  action: StrategyAction,
  key: StrategyKey | null = null,
  target: Player | null = null,
): void {
  game.addExecution(
    new StrategyExecution(player, action, key, target?.id() ?? null),
  );
}

/**
 * Whether the nation may attack `target` right now. When it may not, it
 * works toward it: justifies a war goal first, then declares war once the
 * goal is ready. Tribes and team rivals need neither.
 */
export function nationReadyForWar(
  game: Game,
  player: Player,
  target: Player,
): boolean {
  const strategy = game.strategy();
  if (strategy.warAllowsAttack(player, target)) return true;
  if (strategy.declareWarBlocker(player, target) === null) {
    act(game, player, "declare_war", null, target);
  } else if (strategy.justifyBlocker(player, target) === null) {
    act(game, player, "justify", null, target);
  }
  return false;
}

/**
 * Research, focus, laws and peace. Called on the nation's decision cadence.
 */
export function manageNationStrategy(
  game: Game,
  player: Player,
  random: PseudoRandom,
): void {
  const strategy = game.strategy();
  if (!strategy.rulesEnabled()) return;

  // Fill free research slots. One pick per call keeps two picks in one
  // cadence from landing on the same tech.
  const view = strategy.view(player);
  if (view.research.length < view.researchSlots) {
    const options = RESEARCH_PRIORITY.filter(
      (t) => strategy.researchBlocker(player, t) === null,
    ).slice(0, RESEARCH_CHOICES);
    if (options.length > 0) {
      act(game, player, "research", random.randElement(options));
    }
  }

  if (view.focus === null) {
    const options = FOCUS_IDS.filter(
      (f) => strategy.focusBlocker(player, f) === null,
    );
    if (options.length > 0) {
      act(game, player, "focus", random.randElement(options));
    }
  }

  const atWar = view.wars.length > 0;
  // Keep enough political power in hand to justify the next war.
  const lawBudget = STRATEGY.lawChangeCost + STRATEGY.justifyBaseCost;
  if (atWar && view.politicalPower >= lawBudget) {
    if (strategy.lawBlocker(player, "war_economy") === null) {
      act(game, player, "law", "war_economy");
    } else if (strategy.lawBlocker(player, "extensive_conscription") === null) {
      act(game, player, "law", "extensive_conscription");
    }
  }

  const ticks = game.ticks();
  for (const from of strategy.enemies(player)) {
    const losing = player.troops() < from.troops() * 0.8;
    const started = strategy.warStartTick(player, from) ?? ticks;
    const long = ticks - started > STRATEGY.truceSeconds * 10;

    if (strategy.hasPeaceOffer(from, player)) {
      if (losing || long) act(game, player, "accept_peace", null, from);
      continue;
    }
    // Sue for peace when clearly losing a war that has dragged on.
    if (
      player.troops() < from.troops() * 0.6 &&
      strategy.peaceBlocker(player, from) === null &&
      random.nextInt(0, 4) === 0
    ) {
      act(game, player, "offer_peace", null, from);
    }
  }
}
