import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOnboardingSeen,
  hasSeenOnboarding,
  markOnboardingSeen,
  normalizeRedeemCode,
  ONBOARD_CODE,
} from "./persistence";

function installMemoryStorage() {
  const store = new Map<string, string>();
  const memory: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: memory,
    configurable: true,
    writable: true,
  });
}

describe("onboarding persistence", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    clearOnboardingSeen();
  });

  it("starts unseen", () => {
    expect(hasSeenOnboarding()).toBe(false);
  });

  it("marks and clears seen for a login session", () => {
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
    clearOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(false);
  });

  it("normalizes the QA onboard code", () => {
    expect(normalizeRedeemCode("  rydn-onboard ")).toBe(ONBOARD_CODE);
  });
});
