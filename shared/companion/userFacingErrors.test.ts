import assert from "node:assert/strict";
import { toUserFacingError } from "./userFacingErrors";

assert.match(
  toUserFacingError(new Error("Route analysis server is not configured. Set VITE_API_BASE_URL"), "fallback"),
  /isn't available right now/i,
);

assert.equal(toUserFacingError(new Error("Sign in required."), "fallback"), "Sign in with Google to import a route.");

console.log("userFacingErrors.test.ts OK");
