vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  renderDuration: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("@openfront/engine-lib/Format", () => ({
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
}));

vi.mock("../../../../src/client/components/ui/ActionButton", () => ({
  actionButton: vi.fn((props: unknown) => props),
}));

vi.mock("../../../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(),
  showInGameAlert: vi.fn(),
}));

import {
  AllPlayers,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { StrategyView } from "@openfront/engine-api/game/Strategy";
import { flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { emptyModifiers } from "@openfront/engine-lib/strategy/StrategyRules";
import { EventBus } from "@openfront/shared/EventBus";
import { actionButton } from "../../../../src/client/components/ui/ActionButton";
import { PlayerPanel } from "../../../../src/client/hud/layers/PlayerPanel";
import {
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendStrategyIntentEvent,
} from "../../../../src/client/Transport";
import { PlayerView } from "../../../../src/client/view";

const mockActionButton = actionButton as unknown as ReturnType<typeof vi.fn>;

// Labels of the buttons the last render produced, in order.
const renderedLabels = () =>
  mockActionButton.mock.calls.map((c) => (c[0] as { label: string }).label);

const my = {
  id: () => 1,
  displayName: () => "Me",
  type: () => PlayerType.Human,
  clientID: () => "client-1",
  isLobbyCreator: () => false,
  strategy: () => null,
} as unknown as PlayerView;

const other = {
  id: () => 2,
  name: () => "Other",
  displayName: () => "[TAG] Other",
  type: () => PlayerType.Human,
  clientID: () => "client-2",
  isLobbyCreator: () => false,
} as unknown as PlayerView;

function makeGame() {
  return {
    myPlayer: () => my,
    config: () => ({
      gameConfig: () => ({ gameType: GameType.Public }),
      isReplay: () => false,
    }),
    gameOver: () => false,
  };
}

describe("PlayerPanel - embargo intents", () => {
  let panel: PlayerPanel;
  let eventBus: EventBus;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).g = makeGame();
    eventBus = new EventBus();
    panel.eventBus = eventBus;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("start-embargo button emits a start SendEmbargoIntentEvent and closes the panel", () => {
    const events: SendEmbargoIntentEvent[] = [];
    eventBus.on(SendEmbargoIntentEvent, (e) => events.push(e));

    (panel as any).handleEmbargoClick({ stopPropagation: vi.fn() }, my, other);

    expect(events).toHaveLength(1);
    expect(events[0].target).toBe(other);
    expect(events[0].action).toBe("start");
    expect(panel.isVisible).toBe(false);
  });

  test("stop-embargo button emits a stop SendEmbargoIntentEvent and closes the panel", () => {
    const events: SendEmbargoIntentEvent[] = [];
    eventBus.on(SendEmbargoIntentEvent, (e) => events.push(e));

    (panel as any).handleStopEmbargoClick(
      { stopPropagation: vi.fn() },
      my,
      other,
    );

    expect(events).toHaveLength(1);
    expect(events[0].target).toBe(other);
    expect(events[0].action).toBe("stop");
    expect(panel.isVisible).toBe(false);
  });
});

describe("PlayerPanel - emoji intents", () => {
  let panel: PlayerPanel;
  let eventBus: EventBus;
  let events: SendEmojiIntentEvent[];
  // The panel hands EmojiTable a callback; capture it to simulate a pick.
  let pickEmoji: (emoji: string) => void;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).g = makeGame();
    eventBus = new EventBus();
    panel.eventBus = eventBus;
    events = [];
    eventBus.on(SendEmojiIntentEvent, (e) => events.push(e));
    panel.emojiTable = {
      showTable: vi.fn((cb: (emoji: string) => void) => {
        pickEmoji = cb;
      }),
      hideTable: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("emoji on your own panel is broadcast to all players", () => {
    (panel as any).handleEmojiClick({ stopPropagation: vi.fn() }, my, my);
    pickEmoji(flattenedEmojiTable[4]);

    expect(events).toHaveLength(1);
    expect(events[0].recipient).toBe(AllPlayers);
    expect(events[0].emoji).toBe(4);
    expect(panel.emojiTable.hideTable).toHaveBeenCalled();
    expect(panel.isVisible).toBe(false);
  });

  test("emoji on another player's panel is sent to that player", () => {
    (panel as any).handleEmojiClick({ stopPropagation: vi.fn() }, my, other);
    pickEmoji(flattenedEmojiTable[0]);

    expect(events).toHaveLength(1);
    expect(events[0].recipient).toBe(other);
    expect(events[0].emoji).toBe(0);
    expect(panel.isVisible).toBe(false);
  });
});

describe("PlayerPanel - action buttons follow PlayerActions capability flags", () => {
  let panel: PlayerPanel;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).g = makeGame();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("all capability flags enabled renders every action for another player", () => {
    (panel as any).actions = {
      canSendEmojiAllPlayers: false,
      canEmbargoAll: true,
      interaction: {
        canSendEmoji: true,
        canTarget: true,
        canEmbargo: true,
        canBreakAlliance: true,
        canSendAllianceRequest: true,
        canDonateGold: true,
        canDonateTroops: true,
      },
    };

    (panel as any).renderActions(my, other);

    const labels = renderedLabels();
    expect(labels).toContain("player_panel.emotes");
    expect(labels).toContain("player_panel.target");
    expect(labels).toContain("player_panel.troops");
    expect(labels).toContain("player_panel.gold");
    // canEmbargo picks the stop-trade button (start-trade otherwise).
    expect(labels).toContain("player_panel.stop_trade");
    expect(labels).not.toContain("player_panel.start_trade");
    expect(labels).toContain("player_panel.break_alliance");
    expect(labels).toContain("player_panel.send_alliance");
  });

  test("no capability flags renders only chat and the start-trade toggle", () => {
    (panel as any).actions = { interaction: {} };

    (panel as any).renderActions(my, other);

    const labels = renderedLabels();
    expect(labels).toContain("player_panel.chat");
    expect(labels).toContain("player_panel.start_trade");
    expect(labels).not.toContain("player_panel.emotes");
    expect(labels).not.toContain("player_panel.target");
    expect(labels).not.toContain("player_panel.break_alliance");
    expect(labels).not.toContain("player_panel.send_alliance");
  });

  test("own panel uses canSendEmojiAllPlayers instead of the interaction flag", () => {
    (panel as any).actions = {
      canSendEmojiAllPlayers: true,
      canEmbargoAll: true,
      interaction: { canSendEmoji: false },
    };

    (panel as any).renderActions(my, my);

    expect(renderedLabels()).toContain("player_panel.emotes");

    mockActionButton.mockClear();
    (panel as any).actions = {
      canSendEmojiAllPlayers: false,
      canEmbargoAll: true,
      interaction: { canSendEmoji: true },
    };

    (panel as any).renderActions(my, my);

    expect(renderedLabels()).not.toContain("player_panel.emotes");
  });
});

describe("PlayerPanel - war and peace", () => {
  const OTHER_ID = 7;
  let panel: PlayerPanel;
  let eventBus: EventBus;

  function view(overrides: Partial<StrategyView> = {}): StrategyView {
    return {
      politicalPower: 100,
      wars: [],
      warGoals: [],
      truces: [],
      incomingPeaceOffers: [],
      outgoingPeaceOffers: [],
      justification: null,
      modifiers: emptyModifiers(),
      ...overrides,
    } as StrategyView;
  }

  function players(v: StrategyView, otherType = PlayerType.Nation) {
    const me = {
      ...my,
      strategy: () => v,
      isFriendly: () => false,
      isAtWarWith: (o: PlayerView) => v.wars.includes(o.smallID()),
    } as unknown as PlayerView;
    const them = {
      ...other,
      smallID: () => OTHER_ID,
      type: () => otherType,
    } as unknown as PlayerView;
    return { me, them };
  }

  function labelsFor(v: StrategyView, otherType?: PlayerType) {
    const { me, them } = players(v, otherType);
    mockActionButton.mockClear();
    (panel as any).renderWarActions(me, them);
    return renderedLabels();
  }

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).g = makeGame();
    eventBus = new EventBus();
    panel.eventBus = eventBus;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("at peace: justify a war goal", () => {
    expect(labelsFor(view())).toEqual(["player_panel.justify_war_goal"]);
  });

  test("a justified war goal: declare war", () => {
    const v = view({ warGoals: [{ target: OTHER_ID, expiresAt: 100 }] });
    expect(labelsFor(v)).toEqual(["player_panel.declare_war"]);
  });

  test("at war: offer peace, or accept theirs", () => {
    expect(labelsFor(view({ wars: [OTHER_ID] }))).toEqual([
      "player_panel.offer_peace",
    ]);
    expect(
      labelsFor(view({ wars: [OTHER_ID], incomingPeaceOffers: [OTHER_ID] })),
    ).toEqual(["player_panel.accept_peace"]);
  });

  test("a truce blocks new war goals", () => {
    expect(
      labelsFor(view({ truces: [{ target: OTHER_ID, until: 100 }] })),
    ).toEqual(["player_panel.truce"]);
  });

  test("tribes need no war, so they get no war actions", () => {
    expect(labelsFor(view(), PlayerType.Bot)).toEqual([]);
  });

  test("the justify button sends a justify strategy intent", () => {
    const events: SendStrategyIntentEvent[] = [];
    eventBus.on(SendStrategyIntentEvent, (e) => events.push(e));
    const { me, them } = players(view());
    mockActionButton.mockClear();
    (panel as any).renderWarActions(me, them);
    const props = mockActionButton.mock.calls[0][0] as {
      onClick: (e: unknown) => void;
    };
    props.onClick({ stopPropagation: vi.fn() });

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("justify");
    expect(events[0].target).toBe(them);
    expect(panel.isVisible).toBe(false);
  });
});
