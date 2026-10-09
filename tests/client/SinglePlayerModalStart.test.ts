import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn(() => ({
      manifest: async () => ({ nations: [{}, {}, {}] }),
    })),
  },
}));

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";
import { DEFAULT_SOLO_NAME } from "../../src/client/SoloName";
import { UserSettings } from "../../src/client/UserSettings";

function createModal(): any {
  return document.createElement("single-player-modal") as any;
}

function collectJoins(modal: any): any[] {
  const events: any[] = [];
  modal.addEventListener("join-lobby", (e: Event) =>
    events.push((e as CustomEvent).detail),
  );
  return events;
}

describe("SinglePlayerModal start", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the selected team count and validated disabled units into the join-lobby config", async () => {
    const modal = createModal();
    const events = collectJoins(modal);

    // Selection arrives via the game-config-settings child event.
    modal.handleConfigTeamCountSelected(
      new CustomEvent("team-count-selected", { detail: { count: 4 } }),
    );
    // One real unit and one junk entry: the start path must keep only
    // values that are actual UnitTypes.
    modal.disabledUnits = [UnitType.Warship, "Bogus"];

    await modal.startGame();

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("singleplayer");
    const config = events[0].gameStartInfo.config;
    expect(config.playerTeams).toBe(4);
    expect(config.disabledUnits).toEqual([UnitType.Warship]);
  });

  it("starts offline, under the name the player typed, with no cosmetics or clan", async () => {
    const modal = createModal();
    const events = collectJoins(modal);
    modal.handleNameInput({ target: { value: "Bismarck" } });

    await modal.startGame();

    expect(events).toHaveLength(1);
    const player = events[0].gameStartInfo.players[0];
    expect(player.username).toBe("Bismarck");
    expect(player.clanTag).toBeNull();
    expect(player.cosmetics).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the default name when the typed one is invalid", async () => {
    const modal = createModal();
    const events = collectJoins(modal);
    modal.handleNameInput({ target: { value: "x" } });
    expect(modal.nameError).not.toBeNull();

    await modal.startGame();

    expect(events[0].gameStartInfo.players[0].username).toBe(DEFAULT_SOLO_NAME);
  });

  it("keeps the player's choices when another page is opened over it", () => {
    const modal = createModal();
    modal.handleConfigTeamCountSelected(
      new CustomEvent("team-count-selected", { detail: { count: 4 } }),
    );

    modal.onClose();

    expect(modal.teamCount).toBe(4);
  });

  it("starts the tutorial on default settings with the tutorial switched on", async () => {
    new UserSettings().setTutorialDismissed(true);
    const modal = createModal();
    const events = collectJoins(modal);
    modal.handleConfigTeamCountSelected(
      new CustomEvent("team-count-selected", { detail: { count: 4 } }),
    );

    await modal.startTutorial();

    expect(events).toHaveLength(1);
    expect(events[0].gameStartInfo.config.playerTeams).toBe(2);
    expect(events[0].gameStartInfo.config.nations).toBe("default");
    expect(new UserSettings().tutorialDismissed()).toBe(false);
  });
});
