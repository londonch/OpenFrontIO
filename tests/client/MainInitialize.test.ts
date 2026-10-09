/**
 * Imports src/client/Main.ts for real. Main bootstraps at module scope, so the
 * DOM (built from the real index.html body) and every global it dereferences
 * must exist BEFORE the dynamic import in beforeAll. All tests share that one
 * boot: custom elements cannot be re-defined in the file's single jsdom.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadModal } from "../../src/client/LazyModals";
import { HOME_PAGE } from "../../src/client/Navigation";

const mocks = vi.hoisted(() => ({
  joinLobby: vi.fn(),
  fetch: vi.fn(),
}));

// Cuts the whole Pixi/WebGL/worker/audio in-game graph out of the import.
vi.mock("../../src/client/ClientGameRunner", () => ({
  joinLobby: mocks.joinLobby,
}));

function soloJoin(gameID: string) {
  return {
    gameID,
    gameStartInfo: {
      gameID,
      lobbyCreatedAt: 1000,
      config: {},
      players: [{ clientID: "c0000001", username: "Rommel", clanTag: null }],
    },
    source: "singleplayer",
  };
}

describe("solo Main boot", () => {
  beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 2,
      turnstileSiteKey: "test-site-key",
      jwtAudience: "localhost",
      gitCommit: "DEV",
    };

    // jsdom has neither FontFace nor document.fonts.
    vi.stubGlobal(
      "FontFace",
      class {
        load() {
          return Promise.resolve(this);
        }
      },
    );
    Object.defineProperty(document, "fonts", {
      value: { add: () => {} },
      configurable: true,
    });
    for (const name of ["ResizeObserver", "IntersectionObserver"]) {
      vi.stubGlobal(
        name,
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
        },
      );
    }
    // Every fetch is recorded, and answered with a failure the callers
    // already handle; the boot itself must not make any.
    mocks.fetch.mockImplementation(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Map<string, string>(),
      json: async () => ({}),
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    vi.stubGlobal("fetch", mocks.fetch);

    // Real markup. Scripts hold EJS placeholders — drop them.
    const html = fs.readFileSync(
      path.resolve(__dirname, "../../index.html"),
      "utf8",
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.querySelectorAll("script").forEach((s) => s.remove());
    document.body.innerHTML = parsed.body.innerHTML;

    await import("../../src/client/Main");
    if (document.readyState === "loading") {
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    }
    await loadModal("single-player-modal");
  }, 20_000);

  it("lands on the solo setup", async () => {
    await vi.waitFor(() => {
      expect(window.currentPageId).toBe(HOME_PAGE);
      expect(
        document.getElementById(HOME_PAGE)?.classList.contains("hidden"),
      ).toBe(false);
    });
  });

  it("calls no backend while booting", () => {
    const urls = mocks.fetch.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => /api|auth|lobbies|users/.test(u))).toEqual([]);
  });

  it("ignores a join that carries no game config", async () => {
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: { gameID: "AbCd1234" },
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.joinLobby).not.toHaveBeenCalled();
  });

  it("starts a solo game locally, as the player, with no account", async () => {
    mocks.joinLobby.mockReturnValueOnce({
      prestart: new Promise<void>(() => {}),
      join: new Promise<void>(() => {}),
      stop: () => true,
    });
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: soloJoin("EfGh5678"),
        bubbles: true,
      }),
    );

    await vi.waitFor(() => expect(mocks.joinLobby).toHaveBeenCalledTimes(1));
    const config = mocks.joinLobby.mock.calls[0][1];
    expect(config.gameID).toBe("EfGh5678");
    expect(config.playerName).toBe("Rommel");
    expect(config.cosmetics).toEqual({});
    expect(config.turnstileToken).toBeNull();
    expect(config.gameStartInfo.gameID).toBe("EfGh5678");
  });

  it("starts the menu audio once its chunk loads", async () => {
    const { audioMixer } = await import("../../src/client/sound/AudioMixer");
    await vi.waitFor(() => expect(audioMixer()).not.toBeNull());
  });
});
