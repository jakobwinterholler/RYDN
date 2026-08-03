import { afterEach, describe, expect, it } from "vitest";
import {
  _paintGateDebug,
  _resetPaintGateForTests,
  acquirePaintSlot,
} from "./paintGate";

afterEach(() => {
  _resetPaintGateForTests();
});

describe("paintGate", () => {
  it("caps concurrent slots and drains waiters on release", async () => {
    const releases: Array<() => void> = [];
    const firstWave = await Promise.all(
      Array.from({ length: 6 }, () => acquirePaintSlot()),
    );
    firstWave.forEach((rel) => releases.push(rel));
    expect(_paintGateDebug().active).toBe(6);
    expect(_paintGateDebug().waiting).toBe(0);

    let seventhReady = false;
    const seventh = acquirePaintSlot().then((rel) => {
      seventhReady = true;
      releases.push(rel);
    });
    // Still at capacity — seventh must wait.
    expect(seventhReady).toBe(false);
    expect(_paintGateDebug().waiting).toBe(1);

    releases[0]!();
    await seventh;
    expect(seventhReady).toBe(true);
    expect(_paintGateDebug().active).toBe(6);

    for (const rel of releases.slice(1)) rel();
    expect(_paintGateDebug().active).toBe(0);
  });

  it("release is idempotent", async () => {
    const rel = await acquirePaintSlot();
    rel();
    rel();
    expect(_paintGateDebug().active).toBe(0);
  });
});
