import { clampUsername } from "./PlayerName";
import { validateUsername } from "./validations/username";

// The name the player plays solo games under. This build has no accounts, so
// it is just a string in localStorage — under the key <username-input> used,
// so a name typed there before carries over.
const NAME_KEY = "username";

export const DEFAULT_SOLO_NAME = "Commander";

// What the player typed this page load, so a name still applies when storage
// is unavailable (private mode). undefined until the first save.
let typed: string | undefined;

function current(): string {
  if (typed !== undefined) return typed;
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** What the name field shows: the stored name, or empty for the default. */
export function storedSoloName(): string {
  return current();
}

/** The name to play under: the stored one if it is valid, else the default. */
export function soloPlayerName(): string {
  const name = clampUsername(current().trim());
  if (name === "") return DEFAULT_SOLO_NAME;
  return validateUsername(name).isValid ? name : DEFAULT_SOLO_NAME;
}

/**
 * Stores what the player typed. An empty field clears it (back to the
 * default). Returns the validation error, or null when the name is usable.
 */
export function saveSoloName(raw: string): string | null {
  const name = raw.trim();
  typed = name;
  try {
    if (name === "") localStorage.removeItem(NAME_KEY);
    else localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage unavailable: `typed` keeps it for this page load.
  }
  if (name === "") return null;
  const result = validateUsername(clampUsername(name));
  return result.isValid ? null : (result.error ?? null);
}
