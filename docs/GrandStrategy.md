# Grand Strategy

OpenFront's grand strategy layer adds long-term planning on top of the
real-time territory war: political power, research, a national focus tree,
laws, strategic resources and equipment, supply lines, and war rules. It is
always on in real games. Matches are meant to run 45–90 minutes.

Every tunable lives in one place,
[`packages/engine-lib/src/strategy/StrategyRules.ts`](../packages/engine-lib/src/strategy/StrategyRules.ts)
(`STRATEGY`), next to the data tables for techs (`Techs.ts`), focuses
(`Focuses.ts`) and laws (`Laws.ts`). The engine applies them in
[`packages/engine/src/game/StrategyManager.ts`](../packages/engine/src/game/StrategyManager.ts);
the client explains them with the same code.

## Playing it

Run `npm start` and the game opens at http://localhost:9000 on the solo
setup. Every difficulty's nations justify and declare wars, on each other and
on you; on Easy and Medium they pick you as a target less often (Easy skips
you three times in four, Medium one in four), while Hard and Impossible treat
you like anyone else.

In a game, press **O** (or click the strip under the top-right menu) to open
the National panel.

| Tab                | What you do there                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| **Overview**       | Political power, equipment, world tension, oil/steel/aluminium stockpiles and income, and the laws. |
| **Research**       | Two research slots (three with Research Institutes). 30 techs in six categories.                    |
| **National Focus** | One focus at a time, 20 in total. The political branch commits you to one ideology for the game.    |
| **Diplomacy**      | Justify war goals, declare war, answer peace offers.                                                |

The player panel (click another nation) has the same war and peace actions.

## Systems

### Political power

Earned at 1 per second (more with focuses), capped at 1000. Spent on laws (150)
and war goals (50).

### War rules

- You can only attack, land boats on, or nuke a nation you are **at war**
  with. Warships only fire on enemies' ships, and enemies don't trade.
- To start a war, **justify a war goal** (90 s, faster at high world tension
  or with autocratic focuses), then **declare war** within 3 minutes.
- The target's allies are **called to arms**, unless they are allied with you
  too.
- Either side can **offer peace** after a minute. Accepting ends the war,
  sends attacks home, and starts a 5-minute **truce**.
- Tribes (bots) are always fair game and fight anyone. Rival teams in team
  games are always at war.

### World tension

Rises with declarations, calls to arms, eliminations and nukes; decays slowly.
It shortens justification (down to half at 100%) and allows a War Economy in
peacetime from 50%.

### Research and focus

Techs give percent bonuses (attack, defense, attack speed, troop growth and
cap, gold and trade income, equipment production, resource extraction,
building cost, supply range, attrition, research speed) and unlock units:
Radar → SAM, Rocketry → Missile Silo, Nuclear Fission → Atom Bomb,
Thermonuclear → Hydrogen Bomb, MIRV Systems → MIRV. The three land doctrines
exclude each other. Cities speed research (+3% per level, up to +30%).

Focuses take 1–2.5 minutes and give bonuses, one-time grants (equipment,
political power, raw materials) or an extra research slot.

### Laws

Three categories, each with a default: conscription (troop cap and growth vs
gold), economy (gold vs equipment) and trade (trade income vs resource
extraction). War-only laws lapse at peace.

### Resources and equipment

- Deposits of **oil**, **steel** and **aluminium** are fixed per map (labelled
  on it). Owning their tiles raises income; everyone gets a small base income.
- **Factories** turn steel into **equipment**. An army fights at 50–100%
  strength depending on how much of it is equipped, and soldiers who die
  take their equipment with them.
- **Attacks** against players burn **oil**. Out of oil, they fight and move
  at 75%.
- Warships, defense posts, SAMs, silos and nukes cost raw materials on top of
  gold.

### Supply

An attack is supplied within range of your capital or of a city, port or
factory (farther for ones on the rail network). Beyond that it is
**stretched** (80%), and beyond twice the range **cut off** (60%). Stretched
and cut-off attacks also lose troops to attrition every second.

### Combat

Attack and defense strength combine doctrine, equipment, supply and fuel. The
ratio between the two sides (bounded to 1/3–3×) scales the attacker's losses,
the defender's losses and the attack's speed. When both sides are even, combat
is exactly the base game's.

## Sandbox options

- **Instant Research** (lobby and single player) completes techs and focuses at
  once.
- **Infinite Gold** also waives raw material costs.

## For developers

- State lives in `StrategyManager`, owned by `GameImpl` and stored in game
  snapshots (`Game` snapshot v2, `Strategy` record v1). Executions and players
  reach it through `game.strategy()`.
- Player actions travel as one `strategy` intent (`StrategyIntentSchema`) and
  run as `StrategyExecution`. Nations use the same execution
  (`execution/nation/NationStrategy.ts`).
- The client gets each player's `StrategyView` on the `GameUpdateType.Strategy`
  channel, at most once a second for progress alone.
- `TestConfig` turns the war rules, unit locks and raw material costs off so
  tests of other mechanics don't have to declare wars;
  `GrandStrategyTestConfig` turns them back on. See
  `tests/core/strategy/GrandStrategy.test.ts`.
