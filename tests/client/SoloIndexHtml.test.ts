import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// This build is solo only: the menu is the single-player setup and the pages
// it links to, with no ads, accounts, clans, store or multiplayer lobbies.
const source = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");

describe("solo index.html", () => {
  it("makes the single-player setup the only way into a game", () => {
    expect(source).toContain('id="page-single-player"');
    for (const tag of [
      "play-page",
      "host-lobby-modal",
      "join-lobby-modal",
      "matchmaking-modal",
      "ranked-modal",
    ]) {
      expect(source).not.toContain(`<${tag}`);
    }
  });

  it("has no ads, accounts, clans or store", () => {
    for (const tag of [
      "account-modal",
      "clan-modal",
      "store-modal",
      "inventory-modal",
      "subscription-modal",
      "homepage-promos",
      "in-game-promo",
      "featured-stream",
      "leaderboard-modal",
      "news-modal",
    ]) {
      expect(source).not.toContain(`<${tag}`);
    }
    for (const script of [
      "googletag",
      "gtag",
      "ramp",
      "challenges.cloudflare.com",
      "crazygames",
      "cloudflareinsights",
    ]) {
      expect(source.toLowerCase()).not.toContain(script);
    }
  });
});
