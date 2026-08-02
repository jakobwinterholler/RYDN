/**
 * Critical-journey E2E — API mocked so OAuth/Strava credentials are not required.
 * Covers: login, sync, import, create/edit/delete Ultra, insights, back, logout.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

type Ultra = {
  id: string;
  name: string;
  year?: number;
  activityIds: string[];
  distanceKm: number;
  elevationGainM: number;
  durationS: number;
  area: string;
  status: string;
  countryCodes?: string[];
  result?: string;
};

const rideA = {
  id: "ride-a",
  name: "Day 1 Alps",
  date: "2025-06-01T08:00:00Z",
  distanceKm: 120,
  elevationGainM: 2100,
  durationS: 18000,
  rideType: "Ride",
  kind: "race",
};

const rideB = {
  id: "ride-b",
  name: "Day 2 Alps",
  date: "2025-06-02T08:00:00Z",
  distanceKm: 98,
  elevationGainM: 1800,
  durationS: 16000,
  rideType: "Ride",
  kind: "race",
};

let ultras: Ultra[] = [];
let signedIn = false;
let user = {
  id: "local-dev",
  provider: "local",
  email: "you@localhost",
  name: "Local rider",
  avatar: null as string | null,
  onboardedAt: null as number | null,
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installApi(page: Page) {
  ultras = [];
  signedIn = false;
  user = {
    id: "local-dev",
    provider: "local",
    email: "you@localhost",
    name: "Local rider",
    avatar: null,
    onboardedAt: null,
  };

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === "/api/auth/config" && method === "GET") {
      return json(route, {
        googleEnabled: false,
        stravaEnabled: true,
        origin: "http://127.0.0.1:5180",
        setup: { google: false, strava: true },
      });
    }
    if (path === "/api/auth/me" && method === "GET") {
      if (!signedIn) return json(route, { detail: "Not signed in." }, 401);
      return json(route, user);
    }
    if (path === "/api/auth/dev-login" && method === "POST") {
      signedIn = true;
      user.onboardedAt = Date.now() / 1000;
      return json(route, user);
    }
    if (path === "/api/auth/logout" && method === "POST") {
      signedIn = false;
      return json(route, { ok: true });
    }
    if (path === "/api/auth/onboarded" && method === "POST") {
      user.onboardedAt = Date.now() / 1000;
      return json(route, user);
    }
    if (!signedIn) {
      return json(route, { detail: "Not signed in." }, 401);
    }
    if (path === "/api/providers" && method === "GET") {
      return json(route, [
        {
          id: "strava",
          label: "Strava",
          enabled: true,
          connected: true,
          lastSyncAt: Date.now() / 1000,
        },
      ]);
    }
    if (path === "/api/providers/strava/sync" && method === "POST") {
      return json(route, {
        added: 2,
        fetched: 2,
        names: [rideA.name, rideB.name],
      });
    }
    if (path === "/api/cabinet" && method === "GET") {
      return json(route, {
        completedUltras: ultras.filter((u) => u.area !== "planning"),
        planningUltras: ultras.filter((u) => u.area === "planning"),
        ungroupedRides: [rideA, rideB],
        plannedRoutes: [],
        suggestions: [],
      });
    }
    if (path === "/api/routes/import" && method === "POST") {
      return json(route, {
        id: "route-imported",
        name: "Imported Course",
        distanceKm: 800,
        elevationGainM: 12000,
        pointCount: 100,
        hasTimestamps: false,
        status: "planning",
        objectType: "route",
        verificationProgress: { done: 0, total: 4 },
      });
    }
    if (path === "/api/rides" && method === "GET") {
      return json(route, [rideA, rideB]);
    }
    if (path === "/api/import" && method === "POST") {
      return json(route, { ...rideA, id: "ride-imported", name: "Imported GPX" });
    }
    if (path === "/api/ultras" && method === "POST") {
      const body = req.postDataJSON() as { name: string; activityIds?: string[] };
      const u: Ultra = {
        id: `ultra-${ultras.length + 1}`,
        name: body.name,
        year: 2025,
        activityIds: body.activityIds || [],
        distanceKm: 218,
        elevationGainM: 3900,
        durationS: 34000,
        area: "completed",
        status: "reviewed",
        countryCodes: ["FR"],
      };
      ultras.push(u);
      return json(route, u);
    }
    if (path.startsWith("/api/ultras/") && path.endsWith("/analysis") && method === "GET") {
      const id = path.split("/")[3];
      return json(route, {
        status: "ok",
        ultraId: id,
        aggregation: {
          distanceKm: 218,
          elevationGainM: 3900,
          elevationLossM: 3800,
          movingTimeS: 30000,
          elapsedTimeS: 52000,
          rideElapsedTimeS: 34000,
          stoppedTimeS: 22000,
          avgSpeedKmh: 15.1,
          avgMovingSpeedKmh: 26.2,
          avgGradientPct: 1.8,
          maxElevationM: 2100,
          minElevationM: 120,
          ridingDays: 2,
          startDate: "2025-06-01",
          finishDate: "2025-06-02",
          validation: { ok: true, note: "", checks: [] },
        },
        availability: {
          stops: false,
          climbs: false,
          power: false,
          heartRate: false,
          cadence: false,
        },
        overview: { insight: "Solid pacing across the expedition." },
      });
    }
    if (path.match(/^\/api\/ultras\/[^/]+$/) && method === "GET") {
      const id = path.split("/")[3];
      const u = ultras.find((x) => x.id === id) || ultras[0];
      if (!u) return json(route, { detail: "Ultra not found." }, 404);
      return json(route, {
        ultra: u,
        days: [
          {
            id: rideA.id,
            dayIndex: 1,
            name: rideA.name,
            date: rideA.date,
            distanceKm: 120,
            elevationGainM: 2100,
            durationS: 18000,
          },
          {
            id: rideB.id,
            dayIndex: 2,
            name: rideB.name,
            date: rideB.date,
            distanceKm: 98,
            elevationGainM: 1800,
            durationS: 16000,
          },
        ],
        route: { points: [[45.1, 6.1], [45.2, 6.2]], segments: [[[45.1, 6.1], [45.2, 6.2]]] },
        library: [rideA, rideB],
      });
    }
    if (path.match(/^\/api\/ultras\/[^/]+$/) && method === "PATCH") {
      const id = path.split("/")[3];
      const body = req.postDataJSON() as Partial<Ultra>;
      const u = ultras.find((x) => x.id === id);
      if (!u) return json(route, { detail: "Ultra not found." }, 404);
      Object.assign(u, body);
      return json(route, {
        ultra: u,
        days: [],
        route: { points: [], segments: [] },
        library: [rideA, rideB],
      });
    }
    if (path.match(/^\/api\/ultras\/[^/]+$/) && method === "DELETE") {
      const id = path.split("/")[3];
      ultras = ultras.filter((x) => x.id !== id);
      return json(route, { deleted: id });
    }
    if (path.startsWith("/api/rides/") && method === "GET") {
      return json(route, {
        race: { name: rideA.name, kind: "race", startTime: rideA.date },
        overview: { distanceKm: 120, elevationGainM: 2100, npW: null },
        curves: {},
        analysis: {},
      });
    }
    if (path === "/api/telemetry/client-error" && method === "POST") {
      return json(route, { ok: true });
    }
    if (path === "/api/health") {
      return json(route, { status: "ok", product: "RYDN" });
    }

    return json(route, { detail: `Unhandled mock ${method} ${path}` }, 500);
  });
}

async function loginLocal(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Continue in local mode/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /Continue in local mode/i }).click();
  await expect(page.getByRole("navigation", { name: /Primary/i })).toBeVisible({ timeout: 15_000 });
}

async function goSpace(page: Page, name: "Planning" | "Trips" | "Library" | "Account") {
  if (name === "Account") {
    await page.getByRole("button", { name: "Account", exact: true }).first().click();
    return;
  }
  await page.locator("nav[aria-label='Primary']").first().getByRole("button", { name, exact: true }).click();
}

test.describe("Critical journeys", () => {
  test.beforeEach(async ({ page }) => {
    await installApi(page);
  });

  test("login (local) lands in Planning", async ({ page }) => {
    await loginLocal(page);
    await expect(page.getByRole("button", { name: "Planning", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Trips", exact: true }).first()).toBeVisible();
  });

  test("sync Strava from Account", async ({ page }) => {
    await loginLocal(page);
    await goSpace(page, "Account");
    await page.getByRole("button", { name: /Sync/i }).first().click();
    await expect(page.getByText(/Imported|up to date/i)).toBeVisible({ timeout: 10_000 });
  });

  test("import dialog opens and traps focus Esc", async ({ page }) => {
    await loginLocal(page);
    await goSpace(page, "Library");
    await page.getByRole("button", { name: /Import/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: /Planned Route/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Completed Ride/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("create, edit, insights, back, delete trip, logout", async ({ page }) => {
    await loginLocal(page);

    await goSpace(page, "Library");
    await page.getByRole("button", { name: /Group into trip/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[placeholder="The Capitals"]').fill("Alps Traverse");
    await dialog.locator(".group-row").nth(0).click();
    await dialog.locator(".group-row").nth(1).click();
    await dialog.locator(".sheet__header .btn--primary").click();

    await goSpace(page, "Trips");
    await page.getByRole("button", { name: /Alps Traverse/i }).click();
    await expect(page.getByRole("heading", { name: /Alps Traverse/i })).toBeVisible();

    await page.getByRole("button", { name: /^Edit$/i }).click();
    const edit = page.getByRole("dialog");
    await expect(edit).toBeVisible();
    await edit.locator(".sheet__body input").first().fill("Alps Traverse Edited");
    await edit.getByRole("button", { name: /^Save$/ }).first().click();
    await expect(page.getByRole("heading", { name: /Alps Traverse Edited/i })).toBeVisible();

    const analyticsBtn = page.getByRole("button", { name: /See trip analytics/i });
    await expect(analyticsBtn).toBeVisible();
    await analyticsBtn.click();
    await expect(page.getByRole("heading", { name: /Analytics/i })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: /Alps Traverse Edited/i })).toBeVisible();

    await page.getByRole("button", { name: /^Edit$/i }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /Delete trip/i }).click();
    await expect(page.getByRole("button", { name: "Trips", exact: true }).first()).toBeVisible();

    await goSpace(page, "Account");
    await page.getByRole("button", { name: /Log out|Sign out/i }).click();
    await expect(page.getByRole("button", { name: /Continue in local mode/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});
