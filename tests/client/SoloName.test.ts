import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SOLO_NAME,
  saveSoloName,
  soloPlayerName,
  storedSoloName,
} from "../../src/client/SoloName";

describe("SoloName", () => {
  beforeEach(() => {
    localStorage.clear();
    saveSoloName("");
  });

  it("plays under the default name until one is typed", () => {
    expect(storedSoloName()).toBe("");
    expect(soloPlayerName()).toBe(DEFAULT_SOLO_NAME);
  });

  it("stores a valid name and plays under it", () => {
    expect(saveSoloName("  Rommel ")).toBeNull();
    expect(localStorage.getItem("username")).toBe("Rommel");
    expect(soloPlayerName()).toBe("Rommel");
  });

  it("reports an invalid name and plays under the default", () => {
    expect(saveSoloName("ab")).not.toBeNull();
    expect(storedSoloName()).toBe("ab");
    expect(soloPlayerName()).toBe(DEFAULT_SOLO_NAME);
  });

  it("clears back to the default", () => {
    saveSoloName("Patton");
    expect(saveSoloName("")).toBeNull();
    expect(localStorage.getItem("username")).toBeNull();
    expect(soloPlayerName()).toBe(DEFAULT_SOLO_NAME);
  });
});
