/**
 * DepositLabelsController — names the strategic resource deposits (oil,
 * steel, aluminium) on the map through the WorldTextPass. Deposits are fixed
 * geography, so the labels are pushed once; the alternate (terrain) view
 * hides them.
 */
import { ResourceType } from "@openfront/engine-api/game/Strategy";
import { EventBus } from "@openfront/shared/EventBus";
import { Controller } from "../Controller";
import { AlternateViewEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";
import type { AttackTroopLabel } from "../render/gl/passes/WorldTextPass";
import { translateText } from "../Utils";
import { GameView } from "../view";

const COLORS: Record<ResourceType, [number, number, number]> = {
  [ResourceType.Oil]: [0.95, 0.65, 0.15],
  [ResourceType.Steel]: [0.6, 0.8, 1],
  [ResourceType.Aluminium]: [0.85, 0.85, 0.95],
};

export class DepositLabelsController implements Controller {
  private labels: AttackTroopLabel[] | null = null;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly view: MapRenderer,
  ) {}

  init() {
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.view.setDepositLabels(e.alternateView ? [] : (this.labels ?? []));
    });
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    // Once the map is live: the deposits never move.
    if (this.labels !== null) return;
    this.labels = this.game.deposits().map((d) => {
      const [r, g, b] = COLORS[d.type];
      return {
        x: this.game.x(d.center),
        y: this.game.y(d.center),
        text: translateText(`strategy.resource.${d.type}`).toUpperCase(),
        colorR: r,
        colorG: g,
        colorB: b,
      };
    });
    this.view.setDepositLabels(this.labels);
  }
}
