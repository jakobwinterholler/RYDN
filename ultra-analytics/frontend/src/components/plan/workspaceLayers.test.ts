import { describe, expect, it } from "vitest";
import {
  promoteToVerified,
  removeFromSearchResults,
  replaceSearchResults,
  verifiedIdSet,
} from "./workspaceLayers";

describe("temp vs verified workspace layers", () => {
  it("new search replaces temp results and never includes verified ids", () => {
    const verified = verifiedIdSet([{ id: "v1", reviewStatus: "verified" }]);
    const batch = [
      { id: "a", reviewStatus: "unreviewed" },
      { id: "v1", reviewStatus: "unreviewed" },
      { id: "b", reviewStatus: "unreviewed" },
      { id: "a", reviewStatus: "unreviewed" },
    ];
    const next = replaceSearchResults(batch, verified);
    expect(next.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("verify moves stop from temp to verified; temp cleared of that id", () => {
    const temp = [
      { id: "a", reviewStatus: "unreviewed" },
      { id: "b", reviewStatus: "unreviewed" },
    ];
    const verified = [{ id: "v1", reviewStatus: "verified" }];
    const stop = temp[0];
    const nextVerified = promoteToVerified(stop, verified);
    const nextTemp = removeFromSearchResults(temp, stop.id);
    expect(nextTemp.map((s) => s.id)).toEqual(["b"]);
    expect(nextVerified.map((s) => s.id)).toEqual(["v1", "a"]);
    expect(nextVerified.find((s) => s.id === "a")?.reviewStatus).toBe("verified");
  });

  it("second search wipes previous temp; verified untouched", () => {
    const verified = [{ id: "v1", reviewStatus: "verified" }];
    const first = replaceSearchResults(
      [
        { id: "a", reviewStatus: "unreviewed" },
        { id: "b", reviewStatus: "unreviewed" },
      ],
      verifiedIdSet(verified),
    );
    expect(first).toHaveLength(2);
    const second = replaceSearchResults(
      [{ id: "c", reviewStatus: "unreviewed" }],
      verifiedIdSet(verified),
    );
    expect(second.map((s) => s.id)).toEqual(["c"]);
    expect(verified.map((s) => s.id)).toEqual(["v1"]);
  });
});
