import {
  GameMode,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  FocusID,
  LAW_CATEGORIES,
  LawID,
  MODIFIER_KEYS,
  ModifierKey,
  Modifiers,
  RESOURCE_TYPES,
  StrategyView,
  TECH_CATEGORIES,
  TechID,
} from "@openfront/engine-api/game/Strategy";
import { renderNumber } from "@openfront/engine-lib/Format";
import { focusBlocker, FOCUSES } from "@openfront/engine-lib/strategy/Focuses";
import {
  lawAllowed,
  lawDef,
  lawsIn,
} from "@openfront/engine-lib/strategy/Laws";
import {
  cityResearchBonus,
  justifyCost,
  justifyTicks,
  STRATEGY,
} from "@openfront/engine-lib/strategy/StrategyRules";
import { techBlocker, TECHS } from "@openfront/engine-lib/strategy/Techs";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { CloseViewEvent, ToggleNationalPanelEvent } from "../../InputHandler";
import { SendStrategyIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";

type Tab = "overview" | "research" | "focus" | "diplomacy";

/** Modifiers where a negative number is the good direction. */
const LOWER_IS_BETTER = new Set<ModifierKey>([
  "justifyTime",
  "justifyCost",
  "structureCost",
  "attrition",
]);

const UNIT_KEYS: Partial<Record<UnitType, string>> = {
  [UnitType.SAMLauncher]: "unit_type.sam_launcher",
  [UnitType.MissileSilo]: "unit_type.missile_silo",
  [UnitType.AtomBomb]: "unit_type.atom_bomb",
  [UnitType.HydrogenBomb]: "unit_type.hydrogen_bomb",
  [UnitType.MIRV]: "unit_type.mirv",
};

const RESOURCE_ICON: Record<string, string> = {
  oil: "🛢️",
  steel: "⛓️",
  aluminium: "✈️",
};

function seconds(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / 10));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function percent(permille: number): string {
  return `${Math.floor(permille / 10)}%`;
}

function modifierLines(mods: Partial<Modifiers>): TemplateResult[] {
  const out: TemplateResult[] = [];
  for (const key of MODIFIER_KEYS) {
    const v = mods[key];
    if (v === undefined || v === 0) continue;
    const good = LOWER_IS_BETTER.has(key) ? v < 0 : v > 0;
    out.push(
      html`<span class=${good ? "text-emerald-400" : "text-red-400"}
        >${v > 0 ? "+" : ""}${v}%
        ${translateText(`strategy.modifier.${key}`)}</span
      >`,
    );
  }
  return out;
}

function progressBar(permille: number, color = "bg-sky-500"): TemplateResult {
  return html`<div class="w-full h-1.5 bg-slate-700 rounded-sm overflow-hidden">
    <div
      class="h-full ${color}"
      style="width: ${Math.min(100, permille / 10)}%"
    ></div>
  </div>`;
}

/**
 * The national management screen: politics and industry, research, the
 * national focus tree and diplomacy (war goals, wars, peace).
 */
@customElement("national-panel")
export class NationalPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private isVisible = false;
  @state() private tab: Tab = "overview";
  @state() private view: StrategyView | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(ToggleNationalPanelEvent, (e) => {
      if (e.tab !== undefined) this.tab = e.tab;
      this.isVisible = e.tab !== undefined ? true : !this.isVisible;
      this.refresh();
    });
    this.eventBus.on(CloseViewEvent, () => {
      this.isVisible = false;
    });
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    if (this.isVisible) this.refresh();
  }

  private refresh() {
    this.view = this.game?.myPlayer()?.strategy() ?? null;
    this.requestUpdate();
  }

  private send(
    action: SendStrategyIntentEvent["action"],
    key: SendStrategyIntentEvent["key"] = null,
    target: PlayerView | null = null,
  ) {
    this.eventBus.emit(new SendStrategyIntentEvent(action, key, target));
  }

  private close = () => {
    this.isVisible = false;
  };

  private onOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) this.close();
  };

  render() {
    if (!this.isVisible) return nothing;
    const me = this.game?.myPlayer();
    const view = this.view;
    const tabs: Tab[] = ["overview", "research", "focus", "diplomacy"];
    return html`
      <div
        class="fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-2 sm:p-4"
        @click=${this.onOverlayClick}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="bg-slate-800 border border-slate-600 rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col text-white"
        >
          <div
            class="flex items-center justify-between p-3 border-b border-slate-600 gap-2"
          >
            <h2 class="text-lg sm:text-xl font-semibold">
              ${translateText("national_panel.title")}
            </h2>
            <div class="flex gap-1 flex-wrap">
              ${tabs.map(
                (t) =>
                  html`<button
                    class="px-2 sm:px-3 py-1 rounded-sm text-sm ${this.tab === t
                      ? "bg-sky-600"
                      : "bg-slate-700 hover:bg-slate-600"}"
                    @click=${() => (this.tab = t)}
                  >
                    ${translateText(`national_panel.tab_${t}`)}
                  </button>`,
              )}
            </div>
            <button
              class="text-slate-400 hover:text-white text-2xl font-bold leading-none"
              @click=${this.close}
            >
              ×
            </button>
          </div>
          <div class="p-3 overflow-y-auto">
            ${me === null || me === undefined || view === null
              ? html`<div class="text-slate-400">
                  ${translateText("national_panel.not_available")}
                </div>`
              : this.renderTab(me, view)}
          </div>
        </div>
      </div>
    `;
  }

  private renderTab(me: PlayerView, view: StrategyView): TemplateResult {
    switch (this.tab) {
      case "overview":
        return this.renderOverview(me, view);
      case "research":
        return this.renderResearch(me, view);
      case "focus":
        return this.renderFocus(view);
      case "diplomacy":
        return this.renderDiplomacy(me, view);
    }
  }

  // ---------------------------------------------------------------------------
  // Overview: political power, industry, resources, laws

  private renderOverview(me: PlayerView, view: StrategyView) {
    const ratio =
      view.equipmentNeeded <= 0
        ? 100
        : Math.min(
            100,
            Math.floor((view.equipment * 100) / view.equipmentNeeded),
          );
    const ticks = this.game.ticks();
    const atWar =
      view.wars.length > 0 ||
      this.game.config().gameConfig().gameMode === GameMode.Team;
    return html`
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div class="bg-slate-900/60 rounded-sm p-3">
          <div class="text-slate-400 text-xs uppercase">
            ${translateText("national_panel.political_power")}
          </div>
          <div class="text-2xl font-bold">${view.politicalPower}</div>
          <div class="text-xs text-slate-400">
            ${translateText("national_panel.pp_hint")}
          </div>
        </div>
        <div class="bg-slate-900/60 rounded-sm p-3">
          <div class="text-slate-400 text-xs uppercase">
            ${translateText("national_panel.equipment")}
          </div>
          <div class="text-2xl font-bold">
            ${renderNumber(view.equipment)}
            <span
              class="text-base ${ratio >= 80
                ? "text-emerald-400"
                : ratio >= 50
                  ? "text-yellow-400"
                  : "text-red-400"}"
              >(${ratio}%)</span
            >
          </div>
          <div class="text-xs text-slate-400">
            ${translateText("national_panel.equipment_detail", {
              needed: renderNumber(view.equipmentNeeded),
              production: renderNumber(view.equipmentProduction),
            })}
          </div>
        </div>
        <div class="bg-slate-900/60 rounded-sm p-3">
          <div class="text-slate-400 text-xs uppercase">
            ${translateText("national_panel.world_tension")}
          </div>
          <div class="text-2xl font-bold">${percent(view.worldTension)}</div>
          ${progressBar(view.worldTension, "bg-red-500")}
        </div>
      </div>

      <h3 class="font-semibold mb-2">
        ${translateText("national_panel.resources")}
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        ${RESOURCE_TYPES.map((r) => {
          const income = view.resourceIncome[r];
          return html`<div class="bg-slate-900/60 rounded-sm p-3">
            <div class="flex justify-between">
              <span
                >${RESOURCE_ICON[r]}
                ${translateText(`strategy.resource.${r}`)}</span
              >
              <span class="font-bold">${renderNumber(view.resources[r])}</span>
            </div>
            <div class="text-xs text-slate-400">
              ${translateText("national_panel.resource_detail", {
                income: `${income >= 0 ? "+" : ""}${income}`,
                tiles: view.depositTilesOwned[r],
              })}
            </div>
          </div>`;
        })}
      </div>
      <div class="text-xs text-slate-400 mb-4">
        ${translateText("national_panel.resources_hint")}
      </div>

      <h3 class="font-semibold mb-2">
        ${translateText("national_panel.laws")}
        <span class="text-xs text-slate-400 font-normal">
          ${translateText("national_panel.law_cost", {
            cost: STRATEGY.lawChangeCost,
          })}
          ${view.lawCooldownUntil > ticks
            ? ` · ${translateText("national_panel.law_cooldown", {
                time: seconds(view.lawCooldownUntil - ticks),
              })}`
            : ""}
        </span>
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        ${LAW_CATEGORIES.map(
          (c) =>
            html`<div class="bg-slate-900/60 rounded-sm p-2">
              <div class="text-slate-400 text-xs uppercase mb-1">
                ${translateText(`strategy.law_category.${c}`)}
              </div>
              ${lawsIn(c).map((law) =>
                this.renderLaw(law.id, view, atWar, ticks),
              )}
            </div>`,
        )}
      </div>

      <h3 class="font-semibold mb-2">
        ${translateText("national_panel.national_spirit")}
      </h3>
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        ${modifierLines(view.modifiers)}
        ${cityResearchBonus(this.cityLevels(me)) > 0
          ? html`<span class="text-emerald-400"
              >+${cityResearchBonus(this.cityLevels(me))}%
              ${translateText("national_panel.university_bonus")}</span
            >`
          : ""}
      </div>
    `;
  }

  private cityLevels(me: PlayerView): number {
    return me
      .units(UnitType.City)
      .filter((u) => !u.isUnderConstruction())
      .reduce((a, u) => a + u.level(), 0);
  }

  private renderLaw(
    id: LawID,
    view: StrategyView,
    atWar: boolean,
    ticks: number,
  ) {
    const def = lawDef(id);
    const active = view.laws[def.category] === id;
    const allowed = lawAllowed(def, atWar, view.worldTension);
    const can =
      !active &&
      allowed &&
      view.lawCooldownUntil <= ticks &&
      view.politicalPower >= STRATEGY.lawChangeCost;
    return html`<button
      class="w-full text-left p-2 mb-1 rounded-sm border text-sm ${active
        ? "border-sky-500 bg-sky-900/40"
        : can
          ? "border-slate-600 hover:bg-slate-700"
          : "border-slate-700 opacity-60 cursor-not-allowed"}"
      ?disabled=${!can}
      @click=${() => this.send("law", id)}
    >
      <div class="font-medium">
        ${translateText(`strategy.law.${id}`)}
        ${def.requiresWar
          ? html`<span class="text-xs text-red-300"
              >(${translateText("national_panel.requires_war")})</span
            >`
          : ""}
      </div>
      <div class="flex flex-wrap gap-x-2 text-xs">
        ${modifierLines(def.modifiers)}
      </div>
    </button>`;
  }

  // ---------------------------------------------------------------------------
  // Research

  private renderResearch(me: PlayerView, view: StrategyView) {
    const completed = new Set(view.completedTechs);
    const active = view.research.map((r) => r.tech);
    const speed = Math.max(
      10,
      100 +
        view.modifiers.researchSpeed +
        cityResearchBonus(this.cityLevels(me)),
    );
    return html`
      <div class="mb-3">
        <div class="font-semibold mb-1">
          ${translateText("national_panel.research_slots", {
            used: view.research.length,
            total: view.researchSlots,
          })}
          <span class="text-xs text-slate-400 font-normal"
            >${translateText("national_panel.research_speed", {
              speed,
            })}</span
          >
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${view.research.map(
            (r) =>
              html`<div class="bg-slate-900/60 rounded-sm p-2">
                <div class="flex justify-between items-center mb-1">
                  <span>${translateText(`strategy.tech.${r.tech}`)}</span>
                  <button
                    class="text-xs text-slate-400 hover:text-red-300"
                    @click=${() => this.send("cancel_research", r.tech)}
                  >
                    ${translateText("national_panel.cancel")}
                  </button>
                </div>
                ${progressBar(r.permille)}
              </div>`,
          )}
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        ${TECH_CATEGORIES.map(
          (cat) =>
            html`<div>
              <div class="text-slate-400 text-xs uppercase mb-1">
                ${translateText(`strategy.tech_category.${cat}`)}
              </div>
              ${[...TECHS.values()]
                .filter((t) => t.category === cat)
                .map((t) =>
                  this.renderTech(t.id, completed, active, view, speed),
                )}
            </div>`,
        )}
      </div>
    `;
  }

  private renderTech(
    id: TechID,
    completed: Set<TechID>,
    active: TechID[],
    view: StrategyView,
    speed: number,
  ) {
    const def = TECHS.get(id)!;
    const blocker = techBlocker(id, completed, active);
    const noSlot = view.research.length >= view.researchSlots;
    const can = blocker === null && !noSlot;
    const state =
      blocker === "done"
        ? "border-emerald-600 bg-emerald-900/30"
        : blocker === "active"
          ? "border-sky-500 bg-sky-900/30"
          : can
            ? "border-slate-600 hover:bg-slate-700"
            : "border-slate-700 opacity-50";
    const time = Math.ceil((def.seconds * 100) / speed);
    return html`<button
      class="w-full text-left p-2 mb-1 rounded-sm border text-sm ${state}"
      ?disabled=${!can}
      @click=${() => this.send("research", id)}
    >
      <div class="flex justify-between">
        <span class="font-medium">${translateText(`strategy.tech.${id}`)}</span>
        <span class="text-xs text-slate-400">${seconds(time * 10)}</span>
      </div>
      <div class="flex flex-wrap gap-x-2 text-xs">
        ${modifierLines(def.modifiers)}
        ${(def.unlocks ?? []).map(
          (u) =>
            html`<span class="text-amber-300"
              >${translateText("national_panel.unlocks", {
                unit: translateText(UNIT_KEYS[u] ?? "unit_type.city"),
              })}</span
            >`,
        )}
        ${def.syntheticOilPerMinute
          ? html`<span class="text-emerald-400"
              >${translateText("national_panel.synthetic_oil", {
                amount: def.syntheticOilPerMinute,
              })}</span
            >`
          : ""}
      </div>
      ${def.requires.length > 0 && blocker === "prerequisites"
        ? html`<div class="text-xs text-slate-500">
            ${translateText("national_panel.requires", {
              list: def.requires
                .map((r) => translateText(`strategy.tech.${r}`))
                .join(", "),
            })}
          </div>`
        : ""}
      ${blocker === "exclusive"
        ? html`<div class="text-xs text-red-300">
            ${translateText("national_panel.exclusive")}
          </div>`
        : ""}
    </button>`;
  }

  // ---------------------------------------------------------------------------
  // National focus

  private renderFocus(view: StrategyView) {
    const completed = new Set(view.completedFocuses);
    const current = view.focus?.id ?? null;
    const cols = Math.max(...[...FOCUSES.values()].map((f) => f.col)) + 1;
    const rows = Math.max(...[...FOCUSES.values()].map((f) => f.row)) + 1;
    return html`
      <div class="mb-3">
        ${view.focus === null
          ? html`<div class="text-slate-400">
              ${translateText("national_panel.no_focus")}
            </div>`
          : html`<div class="bg-slate-900/60 rounded-sm p-2 max-w-md">
              <div class="flex justify-between items-center mb-1">
                <span>${translateText(`strategy.focus.${view.focus.id}`)}</span>
                <button
                  class="text-xs text-slate-400 hover:text-red-300"
                  @click=${() => this.send("cancel_focus")}
                >
                  ${translateText("national_panel.cancel")}
                </button>
              </div>
              ${progressBar(view.focus.permille, "bg-amber-500")}
            </div>`}
      </div>
      <div class="overflow-x-auto">
        <div
          class="grid gap-2 min-w-[900px]"
          style="grid-template-columns: repeat(${cols}, minmax(0, 1fr)); grid-template-rows: repeat(${rows}, auto);"
        >
          ${[...FOCUSES.values()].map((f) =>
            this.renderFocusNode(f.id, completed, current),
          )}
        </div>
      </div>
    `;
  }

  private renderFocusNode(
    id: FocusID,
    completed: Set<FocusID>,
    current: FocusID | null,
  ) {
    const def = FOCUSES.get(id)!;
    const blocker = focusBlocker(id, completed, current);
    const can = blocker === null;
    const state =
      blocker === "done"
        ? "border-emerald-600 bg-emerald-900/30"
        : blocker === "active"
          ? "border-amber-500 bg-amber-900/30"
          : can
            ? "border-slate-500 hover:bg-slate-700"
            : blocker === "exclusive"
              ? "border-red-900 opacity-40"
              : "border-slate-700 opacity-60";
    const grant = def.grant;
    return html`<button
      class="text-left p-2 rounded-sm border text-xs ${state}"
      style="grid-column: ${def.col + 1}; grid-row: ${def.row + 1};"
      ?disabled=${!can}
      @click=${() => this.send("focus", id)}
    >
      <div class="font-semibold text-sm">
        ${translateText(`strategy.focus.${id}`)}
      </div>
      <div class="text-slate-400">${seconds(def.seconds * 10)}</div>
      <div class="flex flex-wrap gap-x-2">
        ${modifierLines(def.modifiers)}
        ${def.researchSlots
          ? html`<span class="text-emerald-400"
              >${translateText("national_panel.extra_slot")}</span
            >`
          : ""}
        ${def.syntheticOilPerMinute
          ? html`<span class="text-emerald-400"
              >${translateText("national_panel.synthetic_oil", {
                amount: def.syntheticOilPerMinute,
              })}</span
            >`
          : ""}
        ${grant?.equipment
          ? html`<span class="text-emerald-400"
              >${translateText("national_panel.grant_equipment", {
                amount: renderNumber(grant.equipment),
              })}</span
            >`
          : ""}
        ${grant?.politicalPower
          ? html`<span class="text-emerald-400"
              >${translateText("national_panel.grant_pp", {
                amount: grant.politicalPower,
              })}</span
            >`
          : ""}
        ${grant?.resources
          ? html`<span class="text-emerald-400"
              >${translateText("national_panel.grant_resources")}</span
            >`
          : ""}
      </div>
    </button>`;
  }

  // ---------------------------------------------------------------------------
  // Diplomacy

  private renderDiplomacy(me: PlayerView, view: StrategyView) {
    const ticks = this.game.ticks();
    const byID = (id: number) => {
      const p = this.game.playerBySmallID(id);
      return p.isPlayer() ? (p as PlayerView) : null;
    };
    const name = (id: number) => byID(id)?.displayName() ?? "?";
    const cost = justifyCost(view.modifiers);
    const duration = justifyTicks(view.modifiers, view.worldTension);
    const others = this.game
      .playerViews()
      .filter(
        (p) =>
          p !== me &&
          p.isAlive() &&
          p.type() !== PlayerType.Bot &&
          !me.isFriendly(p) &&
          !me.isAtWarWith(p),
      )
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    const truceWith = new Set(view.truces.map((t) => t.target));
    const goals = new Set(view.warGoals.map((g) => g.target));

    return html`
      <div class="mb-3 text-sm text-slate-300">
        ${translateText("national_panel.diplomacy_hint")}
      </div>
      ${view.incomingPeaceOffers.length > 0
        ? html`<h3 class="font-semibold mb-1">
              ${translateText("national_panel.peace_offers")}
            </h3>
            ${view.incomingPeaceOffers.map((id) => {
              const p = byID(id);
              return html`<div
                class="flex items-center justify-between bg-emerald-900/30 border border-emerald-700 rounded-sm p-2 mb-1"
              >
                <span
                  >${translateText("national_panel.peace_offer_from", {
                    name: name(id),
                  })}</span
                >
                <span class="flex gap-1">
                  <button
                    class="px-2 py-1 rounded-sm bg-emerald-700 hover:bg-emerald-600 text-sm"
                    @click=${() => this.send("accept_peace", null, p)}
                  >
                    ${translateText("national_panel.accept")}
                  </button>
                  <button
                    class="px-2 py-1 rounded-sm bg-slate-700 hover:bg-slate-600 text-sm"
                    @click=${() => this.send("reject_peace", null, p)}
                  >
                    ${translateText("national_panel.reject")}
                  </button>
                </span>
              </div>`;
            })}`
        : ""}

      <h3 class="font-semibold mt-3 mb-1">
        ${translateText("national_panel.wars")}
      </h3>
      ${view.wars.length === 0
        ? html`<div class="text-slate-400 text-sm">
            ${translateText("national_panel.no_wars")}
          </div>`
        : view.wars.map((id) => {
            const p = byID(id);
            const offered = view.outgoingPeaceOffers.includes(id);
            return html`<div
              class="flex items-center justify-between bg-red-900/30 border border-red-800 rounded-sm p-2 mb-1"
            >
              <span>⚔️ ${name(id)}</span>
              <button
                class="px-2 py-1 rounded-sm text-sm ${offered
                  ? "bg-slate-700 opacity-60"
                  : "bg-emerald-800 hover:bg-emerald-700"}"
                ?disabled=${offered}
                @click=${() => this.send("offer_peace", null, p)}
              >
                ${offered
                  ? translateText("national_panel.peace_offered")
                  : translateText("national_panel.offer_peace")}
              </button>
            </div>`;
          })}
      ${view.unsuppliedAttacks > 0
        ? html`<div class="text-amber-300 text-sm mt-1">
            ${translateText("national_panel.unsupplied", {
              count: view.unsuppliedAttacks,
            })}
          </div>`
        : ""}

      <h3 class="font-semibold mt-3 mb-1">
        ${translateText("national_panel.war_goals")}
      </h3>
      ${view.justification !== null
        ? html`<div class="bg-slate-900/60 rounded-sm p-2 mb-1">
            <div class="flex justify-between items-center mb-1">
              <span
                >${translateText("national_panel.justifying", {
                  name: name(view.justification.target),
                })}</span
              >
              <button
                class="text-xs text-slate-400 hover:text-red-300"
                @click=${() => this.send("cancel_justify")}
              >
                ${translateText("national_panel.cancel")}
              </button>
            </div>
            ${progressBar(view.justification.permille, "bg-red-500")}
          </div>`
        : ""}
      ${view.warGoals.map((g) => {
        const p = byID(g.target);
        return html`<div
          class="flex items-center justify-between bg-slate-900/60 rounded-sm p-2 mb-1"
        >
          <span
            >${translateText("national_panel.war_goal_on", {
              name: name(g.target),
              time: seconds(g.expiresAt - ticks),
            })}</span
          >
          <button
            class="px-2 py-1 rounded-sm bg-red-700 hover:bg-red-600 text-sm"
            @click=${() => this.send("declare_war", null, p)}
          >
            ${translateText("national_panel.declare_war")}
          </button>
        </div>`;
      })}

      <h3 class="font-semibold mt-3 mb-1">
        ${translateText("national_panel.nations")}
        <span class="text-xs text-slate-400 font-normal"
          >${translateText("national_panel.justify_cost", {
            cost,
            time: seconds(duration),
          })}</span
        >
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">
        ${others.map((p) => {
          const truce = truceWith.has(p.smallID());
          const busy = view.justification !== null;
          const hasGoal = goals.has(p.smallID());
          const can =
            !truce && !busy && !hasGoal && view.politicalPower >= cost;
          return html`<div
            class="flex items-center justify-between bg-slate-900/60 rounded-sm p-2"
          >
            <span class="truncate">${p.displayName()}</span>
            ${truce
              ? html`<span class="text-xs text-slate-400"
                  >${translateText("national_panel.truce")}</span
                >`
              : html`<button
                  class="px-2 py-1 rounded-sm text-xs ${can
                    ? "bg-amber-700 hover:bg-amber-600"
                    : "bg-slate-700 opacity-50"}"
                  ?disabled=${!can}
                  @click=${() => this.send("justify", null, p)}
                >
                  ${translateText("national_panel.justify")}
                </button>`}
          </div>`;
        })}
      </div>
    `;
  }
}

/**
 * The always-on strip under the top-right sidebar: political power,
 * equipment, raw materials and world tension. Click it for the full panel.
 */
@customElement("national-bar")
export class NationalBar extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private view: StrategyView | null = null;

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    const me = this.game?.myPlayer();
    this.view = me && me.isAlive() ? me.strategy() : null;
  }

  render() {
    const v = this.view;
    if (v === null) return nothing;
    const ratio =
      v.equipmentNeeded <= 0
        ? 100
        : Math.min(100, Math.floor((v.equipment * 100) / v.equipmentNeeded));
    return html`<button
      class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 px-3 bg-gray-800/92 backdrop-blur-sm rounded-l-lg text-white text-xs sm:text-sm hover:bg-gray-700/92"
      title=${translateText("national_panel.open_hint")}
      @click=${() => this.eventBus.emit(new ToggleNationalPanelEvent())}
      @contextmenu=${(e: Event) => e.preventDefault()}
    >
      <span title=${translateText("national_panel.political_power")}
        >🏛️ ${v.politicalPower}</span
      >
      <span
        class=${ratio >= 80
          ? "text-emerald-400"
          : ratio >= 50
            ? "text-yellow-400"
            : "text-red-400"}
        title=${translateText("national_panel.equipment")}
        >🔫 ${ratio}%</span
      >
      ${RESOURCE_TYPES.map(
        (r) =>
          html`<span title=${translateText(`strategy.resource.${r}`)}
            >${RESOURCE_ICON[r]} ${renderNumber(v.resources[r])}</span
          >`,
      )}
      ${v.wars.length > 0
        ? html`<span class="text-red-400">⚔️ ${v.wars.length}</span>`
        : ""}
      ${v.incomingPeaceOffers.length > 0
        ? html`<span class="text-emerald-400 animate-pulse">🕊️</span>`
        : ""}
      <span title=${translateText("national_panel.world_tension")}
        >🌍 ${percent(v.worldTension)}</span
      >
    </button>`;
  }
}
