import type { GameStartInfo } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import type { ClientMessage } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    turnIntervalMs: vi.fn(() => 100),
    gitCommit: vi.fn(() => "DEV"),
  },
}));

import { LocalServer } from "../../src/client/LocalServer";

const CLIENT_ID = "abCD1234";

function makeGameStartInfo(): GameStartInfo {
  return {
    gameID: "gameID12",
    lobbyCreatedAt: 1000,
    config: {
      gameMap: "Africa",
      difficulty: "Medium",
      donateGold: false,
      donateTroops: false,
      gameType: "Singleplayer",
      gameMode: "Free For All",
      gameMapSize: "Normal",
      nations: "default",
      bots: 400,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    },
    players: [
      {
        clientID: CLIENT_ID,
        username: "TestUser",
        clanTag: null,
      },
    ],
  } as GameStartInfo;
}

function makeServer(): {
  server: LocalServer;
  sent: { type: string }[];
} {
  const sent: { type: string }[] = [];
  const server = new LocalServer(
    {
      gameStartInfo: makeGameStartInfo(),
      playerName: "TestUser",
      playerClanTag: null,
    } as any,
    false,
    new EventBus(),
  );
  server.updateCallback(
    () => {},
    (msg) => sent.push(msg),
  );
  return { server, sent };
}

const winnerMsg: ClientMessage = {
  type: "winner",
  winner: ["player", CLIENT_ID],
  allPlayersStats: { [CLIENT_ID]: { attacks: [100n] } },
};

describe("LocalServer", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts the game for the local player", () => {
    const { server, sent } = makeServer();
    server.start();
    server.endGame();
    expect(sent[0]?.type).toBe("start");
  });

  it("plays a whole game without touching the network", async () => {
    const { server } = makeServer();
    server.start();
    server.onMessage(winnerMsg);
    server.endGame();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
