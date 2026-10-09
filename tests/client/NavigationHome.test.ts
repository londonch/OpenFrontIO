import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_PAGE, initNavigation } from "../../src/client/Navigation";

// Plain pages: showPage only toggles their visibility.
function page(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  el.className = "page-content hidden";
  document.body.appendChild(el);
  return el;
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("Navigation home page", () => {
  let home: HTMLElement;
  let help: HTMLElement;

  beforeEach(() => {
    const play = document.createElement("div");
    play.id = "page-play";
    document.body.appendChild(play);
    home = page(HOME_PAGE);
    help = page("page-help");
    initNavigation();
  });

  afterEach(() => document.body.replaceChildren());

  it("opens the solo setup on load", async () => {
    await flush();
    expect(home.classList.contains("hidden")).toBe(false);
    expect(window.currentPageId).toBe(HOME_PAGE);
  });

  it("returns to the solo setup when a page closes", async () => {
    window.showPage!("page-help");
    await flush();
    expect(home.classList.contains("hidden")).toBe(true);

    window.showPage!("page-play");
    await flush();

    expect(home.classList.contains("hidden")).toBe(false);
    expect(help.classList.contains("hidden")).toBe(true);
  });

  it("leaves a page alone that opened while the last one was closing", async () => {
    window.showPage!("page-play");
    // Same turn, as when closing one page leads straight to another.
    help.classList.remove("hidden");
    await flush();

    expect(home.classList.contains("hidden")).toBe(true);
    expect(help.classList.contains("hidden")).toBe(false);
  });
});
