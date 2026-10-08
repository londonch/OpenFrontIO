import { PlayerID } from "@openfront/engine-api/game/GameTypes";
import {
  STRATEGY_ACTIONS,
  STRATEGY_KEYS,
  StrategyAction,
  StrategyKey,
} from "@openfront/engine-api/game/Strategy";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { isFocusID } from "@openfront/engine-lib/strategy/Focuses";
import { isLawID } from "@openfront/engine-lib/strategy/Laws";
import { isTechID } from "@openfront/engine-lib/strategy/Techs";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * One grand strategy action: start or cancel research or a focus, change a
 * law, justify a war goal, declare war, or offer, accept or reject peace.
 * The StrategyManager validates; an action that isn't allowed does nothing.
 */
export class StrategyExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private action: StrategyAction,
    private key: StrategyKey | null = null,
    private targetID: PlayerID | null = null,
  ) {}

  init(mg: Game, _: number): void {
    this.mg = mg;
  }

  tick(_: number): void {
    this.active = false;
    if (!this.player.isAlive()) return;
    const strategy = this.mg.strategy();
    const key = this.key;
    const target = this.target();
    switch (this.action) {
      case "research":
        if (key !== null && isTechID(key)) {
          strategy.startResearch(this.player, key);
        }
        return;
      case "cancel_research":
        if (key !== null && isTechID(key)) {
          strategy.cancelResearch(this.player, key);
        }
        return;
      case "focus":
        if (key !== null && isFocusID(key)) {
          strategy.startFocus(this.player, key);
        }
        return;
      case "cancel_focus":
        strategy.cancelFocus(this.player);
        return;
      case "law":
        if (key !== null && isLawID(key)) strategy.setLaw(this.player, key);
        return;
      case "justify":
        if (target !== null) strategy.startJustification(this.player, target);
        return;
      case "cancel_justify":
        strategy.cancelJustification(this.player);
        return;
      case "declare_war":
        if (target !== null) strategy.declareWar(this.player, target);
        return;
      case "offer_peace":
        if (target !== null) strategy.offerPeace(this.player, target);
        return;
      case "accept_peace":
        if (target !== null) strategy.acceptPeace(this.player, target);
        return;
      case "reject_peace":
        if (target !== null) strategy.rejectPeace(this.player, target);
        return;
    }
  }

  private target(): Player | null {
    if (this.targetID === null || !this.mg.hasPlayer(this.targetID)) {
      return null;
    }
    return this.mg.player(this.targetID);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return StrategyExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      action: this.action,
      key: this.key,
      targetID: this.targetID,
    });
  }

  restoreSnapshot(s: StrategyExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.action = s.action;
    this.key = s.key;
    this.targetID = s.targetID;
  }
}

const StrategyExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  action: z.enum(STRATEGY_ACTIONS),
  key: z.enum(STRATEGY_KEYS).nullable(),
  targetID: z.string().nullable(),
});
type StrategyExecutionState = z.infer<typeof StrategyExecutionStateSchema>;

export const StrategyExecutionSnapshot = execSnapshotType({
  name: "Strategy",
  version: 1,
  schema: StrategyExecutionStateSchema,
  cls: () => StrategyExecution,
});
