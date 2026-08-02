import { describe, expect, it } from "vitest";
import { ApiError, networkErrorMessage, userMessageFromDetail } from "./errors";

describe("userMessageFromDetail", () => {
  it("prefers calm human detail", () => {
    expect(userMessageFromDetail("Sync failed. Try again.", 502, "fallback")).toBe(
      "Sync failed. Try again.",
    );
  });

  it("rejects technical dumps", () => {
    expect(userMessageFromDetail("TypeError: NoneType", 500, "fallback")).toMatch(/our side/i);
  });

  it("maps offline status", () => {
    expect(userMessageFromDetail(null, 0, "fallback")).toMatch(/offline/i);
  });

  it("maps conflict", () => {
    expect(userMessageFromDetail(null, 409, "fallback")).toMatch(/another trip/i);
  });
});

describe("networkErrorMessage", () => {
  it("reads ApiError", () => {
    expect(networkErrorMessage(new ApiError("Nope", 400))).toBe("Nope");
  });

  it("maps fetch failures", () => {
    expect(networkErrorMessage(new TypeError("Failed to fetch"))).toMatch(/offline/i);
  });
});
