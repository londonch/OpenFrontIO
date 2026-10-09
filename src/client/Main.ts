// The solo-only client: the menu is the single-player setup (plus settings,
// help and language), and the only thing it starts is a local game against
// the AI. No accounts, ads, store, clans or multiplayer lobbies, and no
// network beyond loading the game's own files.
import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import type {
  GameInfo,
  GameRecord,
  PublicGameInfo,
  WireGameStartInfo,
} from "@openfront/shared/WireSchemas";
import type { JoinLobbyResult } from "./ClientGameRunner";
import { loadGameClient, prefetchGameClient } from "./GameClientLoader";
import { GameStartingModal } from "./GameStartingModal";
import type { HelpModal } from "./HelpModal";
import { showInGameConfirm } from "./InGameModal";
import "./LangSelector";
import { prefetchModals, whenModalLoaded } from "./LazyModals";
import { hideMenuChrome } from "./MenuChrome";
import { modalRouter } from "./ModalRouter";
import { initNavigation } from "./Navigation";
import type { SinglePlayerModal } from "./SinglePlayerModal";
import type { TurnstileApi } from "./TurnstileToken";
import { UserSettings } from "./UserSettings";
import {
  flushReloadToast,
  homeHref,
  incrementGamesPlayed,
  reloadForUpdate,
  translateText,
} from "./Utils";
import {
  installCtrlWheelZoomBlocker,
  installDoubleTapZoomBlocker,
  installSafariPinchZoomBlocker,
} from "./utilities/DisableSafariPinchZoom";

import "./components/MainLayout";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./styles.css";
import "./styles/core/typography.css";
import "./styles/core/variables.css";
import "./styles/layout/container.css";
import "./styles/layout/header.css";

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    adsEnabled: boolean;
    gtag?: (...args: any[]) => void;
    PageOS: {
      session: {
        newPageView: () => void;
      };
    };
    ramp: {
      que: Array<() => void>;
      passiveMode: boolean;
      spaAddAds: (ads: Array<{ type: string; selectorId?: string }>) => void;
      destroyUnits: (adType: string | string[]) => Promise<void>;
      settings?: {
        slots?: any;
      };
      spaNewPage: (url?: string) => void;
      spaAds: (config?: {
        ads?: Array<{ type: string; selectorId?: string }>;
        countPageview?: boolean;
        path?: string;
      }) => void;
      // Video ad methods
      onPlayerReady: (() => void) | null;
      addUnits: (units: Array<{ type: string }>) => Promise<void>;
      displayUnits: () => void;
    };
    Bolt: {
      on: (unitType: string, event: string, callback: () => void) => void;
      BOLT_AD_REQUEST_START: string;
      BOLT_AD_IMPRESSION: string;
      BOLT_AD_STARTED: string;
      BOLT_FIRST_QUARTILE: string;
      BOLT_MIDPOINT: string;
      BOLT_THIRD_QUARTILE: string;
      BOLT_AD_COMPLETE: string;
      BOLT_AD_ERROR: string;
      BOLT_AD_PAUSED: string;
      BOLT_AD_CLICKED: string;
      SHOW_HIDDEN_CONTAINER: string;
    };
    currentPageId?: string;
    showPage?: (pageId: string) => void;
  }

  // Extend the global interfaces to include your custom events
  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    "kick-player": CustomEvent;
    toggle_game_start_timer: CustomEvent;
    "join-changed": CustomEvent;
    "open-matchmaking": CustomEvent<{ mode?: "1v1" | "2v2" } | undefined>;
    "matchmaking-requeue": CustomEvent<{ mode?: "1v1" | "2v2" } | undefined>;
    userMeResponse: CustomEvent<UserMeResponse | false>;
    "session-cleared": CustomEvent;
    "leave-lobby": CustomEvent;
    "game-starting": CustomEvent;
    "menu-restored": CustomEvent;
    "update-game-config": CustomEvent;
  }
}

export interface JoinLobbyEvent {
  // Multiplayer games only have gameID, gameConfig is not known until game starts.
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: WireGameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  source?: "public" | "private" | "host" | "matchmaking" | "singleplayer";
  publicLobbyInfo?: GameInfo | PublicGameInfo;
  // Watch without playing.
  spectator?: boolean;
  // Host only: the play token the lobby was created under (see createLobby).
  creatorToken?: string;
}

/**
 * Publishes "a match is running": the `.in-game` body class, which the menu
 * markup keys off to hide itself.
 */
function setInGameSignal(inGame: boolean): void {
  document.body.classList.toggle("in-game", inGame);
}

/** The pages a URL hash (#modal=...) can open. */
const ROUTED_PAGES: Array<[name: string, tag: string, pageId: string]> = [
  ["settings", "user-setting", "page-settings"],
  ["help", "help-modal", "page-help"],
  ["language", "language-modal", "page-language"],
  ["single-player", "single-player-modal", "page-single-player"],
  ["troubleshooting", "troubleshooting-modal", "page-troubleshooting"],
];

/** Menu pages to close when a game takes over the screen. */
const MENU_PAGES = [
  "single-player-modal",
  "help-modal",
  "user-setting",
  // The in-game settings instance, addressed by id: querySelector above
  // only reaches the menu's inline one.
  "#game-settings",
  "troubleshooting-modal",
  "language-modal",
];

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  private eventBus: EventBus = new EventBus();
  private userSettings: UserSettings = new UserSettings();
  /** Time stamp of the latest join, so a superseded one stands down. */
  private mostRecentJoinEvent = 0;
  /** The URL of the running game's history entry; Back asks before leaving. */
  private gameUrl: string | null = null;

  initialize(): void {
    flushReloadToast();

    // Any path but "/" is left over from a game (or an old multiplayer
    // link): there is nothing to rejoin here, so it's the menu.
    if (window.location.pathname !== "/") {
      history.replaceState(null, "", "/" + window.location.hash);
    }

    // One mixer for the page: the menu theme here and the SoundManager a game
    // creates later both route through it, so the volume sliders reach both.
    Promise.all([
      import("./sound/AudioMixer"),
      import("./sound/MenuMusic"),
    ]).then(
      ([{ audioMixer, initAudioMixer }, { startMenuMusic }]) => {
        if (audioMixer() === null) {
          startMenuMusic(initAudioMixer(this.userSettings));
        }
      },
      (err) => console.error("Menu audio failed to load:", err),
    );

    for (const [name, tag, pageId] of ROUTED_PAGES) {
      modalRouter.register(name, { tag, pageId });
    }

    const openFrontFont = new FontFace(
      "OpenFront",
      `url(${assetUrl("fonts/OpenFront.ttf")})`,
    );
    document.fonts.add(openFrontFont);
    openFrontFont.load().catch(() => {});

    window.addEventListener("beforeunload", () => {
      if (this.lobbyHandle !== null) {
        setInGameSignal(false);
        this.lobbyHandle.stop(true);
      }
    });

    document.addEventListener("join-lobby", (event) => {
      void this.handleJoinLobby(event);
    });
    // Only multiplayer paths dispatch this; a solo game ends by going home.
    document.addEventListener("leave-lobby", () => {
      if (this.lobbyHandle !== null) this.goHome();
    });

    // Tutorial entry points (the menu header, the help page): a default solo
    // game with the guide on.
    document.addEventListener("start-tutorial", () => {
      const help = document.querySelector("help-modal") as HelpModal | null;
      if (customElements.get("help-modal") && help?.isOpen()) help.close();
      whenModalLoaded("single-player-modal", () => {
        void (
          document.querySelector("single-player-modal") as SinglePlayerModal
        )?.startTutorial();
      });
    });

    window.addEventListener("popstate", () => this.onPopState());
    window.addEventListener("hashchange", () => {
      if (modalRouter.isHashRouted()) modalRouter.routeFromHash();
    });
  }

  /** Opens the page a #modal=... hash names, once navigation is set up. */
  routeInitialHash(): void {
    if (modalRouter.isHashRouted()) modalRouter.routeFromHash();
  }

  private goHome(): void {
    window.location.href = homeHref();
  }

  private onPopState(): void {
    if (this.gameUrl === null || this.lobbyHandle === null) {
      if (modalRouter.isHashRouted()) modalRouter.routeFromHash();
      return;
    }
    // stop() refuses while the player is still alive: put the entry back
    // (navigation can't wait on a confirm) and only leave once they agree.
    if (!this.lobbyHandle.stop()) {
      history.pushState(null, "", this.gameUrl);
      void showInGameConfirm(
        translateText("help_modal.exit_confirmation"),
      ).then((confirmed) => {
        if (confirmed) this.goHome();
      });
      return;
    }
    this.goHome();
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    if (lobby.gameStartInfo === undefined) {
      // Solo games carry their whole config; nothing else starts here.
      console.warn(`Ignoring a join without a game config: ${lobby.gameID}`);
      return;
    }
    // Before anything awaits: the solo modal closes itself right after
    // dispatching, and the menu must not reopen under the starting game
    // (see HOME_PAGE in Navigation.ts).
    hideMenuChrome();
    this.mostRecentJoinEvent = event.timeStamp;

    if (this.lobbyHandle !== null) {
      this.lobbyHandle.stop(true);
      this.lobbyHandle = null;
      setInGameSignal(false);
    }

    let joinLobby: typeof import("./ClientGameRunner").joinLobby;
    try {
      ({ joinLobby } = await loadGameClient());
    } catch (err) {
      // The game's chunk didn't load; a fresh page load usually fixes it.
      console.error("game client failed to load:", err);
      if (this.mostRecentJoinEvent === event.timeStamp) reloadForUpdate();
      return;
    }
    if (this.mostRecentJoinEvent !== event.timeStamp) return;

    const me = lobby.gameStartInfo.players[0];
    const handle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: {},
      playerName: me?.username ?? "",
      playerClanTag: me?.clanTag ?? null,
      playerRole: null,
      turnstileToken: null,
      gameStartInfo: lobby.gameStartInfo,
      gameRecord: lobby.gameRecord,
      spectator: lobby.spectator,
    });
    this.lobbyHandle = handle;

    handle.prestart.then(() => {
      document.dispatchEvent(new CustomEvent("game-starting"));
      for (const selector of MENU_PAGES) {
        const page = document.querySelector(selector) as
          | (HTMLElement & { close?: () => void; isModalOpen?: boolean })
          | null;
        if (page?.close) page.close();
        else if (page && "isModalOpen" in page) page.isModalOpen = false;
      }
      hideMenuChrome();
      const startingModal = document.querySelector("game-starting-modal");
      if (startingModal instanceof GameStartingModal) startingModal.show();
    });

    handle.join.then(() => {
      incrementGamesPlayed();
      setInGameSignal(true);
      // A history entry for the game, so Back asks before abandoning it.
      history.pushState(null, "", "/game");
      this.gameUrl = window.location.href;
    });
  }
}

const bootstrap = () => {
  // Prevent Safari's page-level pinch-zoom, which ignores `user-scalable=no`
  // on iOS and can softlock the HUD. See issue #2330.
  installSafariPinchZoomBlocker();
  // Same for double-tap "smart zoom" (#4609), and trackpad pinches reported
  // as ctrl+wheel over a HUD panel (#5098).
  installDoubleTapZoomBlocker();
  installCtrlWheelZoomBlocker();

  const client = new Client();
  client.initialize();
  initNavigation();
  client.routeInitialHash();
  prefetchGameClient();
  prefetchModals();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
