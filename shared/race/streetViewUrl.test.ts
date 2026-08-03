/**
 * Street View URL regression tests.
 * Run: npx tsx shared/race/streetViewUrl.test.ts
 */

import assert from "node:assert/strict";
import {
  bearingBetween,
  buildStreetViewUrlFromPanorama,
  googleMapsUrl,
  googleStreetViewUrl,
  gpxPointAtStopKm,
  parseStreetViewMetadataStatus,
  resolveStreetView,
  STREET_VIEW_SEARCH_RADIUS_M,
} from "./streetViewUrl";

const COLLserola_ROUTE: [number, number][] = [
  [2.1, 41.4],
  [2.128, 41.43],
  [2.2, 41.5],
];

const OILPRIX = {
  lat: 41.430306,
  lon: 2.128889,
  routeKm: 6.96,
  name: "Oilprix",
  placeId: "node/287007125",
};

/** Extract the `viewpoint=lat,lon` from a Street View pano URL. */
function viewpointOf(url: string): { lat: number; lon: number } | null {
  const match = url.match(/viewpoint=(-?[\d.]+)(?:%2C|,)(-?[\d.]+)/);
  return match ? { lat: Number(match[1]), lon: Number(match[2]) } : null;
}

/** Extract the coordinate `query=lat,lon` from a Google Maps search URL. */
function mapsQueryCoordsOf(url: string): { lat: number; lon: number } | null {
  const match = url.match(/query=(-?[\d.]+)(?:%2C|,)(-?[\d.]+)/);
  return match ? { lat: Number(match[1]), lon: Number(match[2]) } : null;
}

function testViewpointIsAlwaysThePoi() {
  const url = googleStreetViewUrl(OILPRIX, {
    routeCoordinates: COLLserola_ROUTE,
    totalDistanceKm: 39,
  });

  // The Street View location MUST be the POI — never the snapped GPX route point.
  assert.match(url, /viewpoint=41\.430306%2C2\.128889/);
  // No forced heading on the fallback URL — Google auto-faces the POI.
  assert.doesNotMatch(url, /heading=/);
  assert.doesNotMatch(url, /query=/);

  const viewpoint = viewpointOf(url);
  assert.ok(viewpoint);
  assert.equal(viewpoint!.lat.toFixed(6), OILPRIX.lat.toFixed(6));
  assert.equal(viewpoint!.lon.toFixed(6), OILPRIX.lon.toFixed(6));
}

/**
 * The core regression guard: for every kind of stop, the coordinates Google Maps
 * opens and the coordinates Street View opens must be byte-identical.
 */
function testMapsAndStreetViewUseIdenticalCoordinates() {
  const stops = [
    { lat: 41.430306, lon: 2.128889, routeKm: 6.96, name: "Off-route supermarket" },
    { lat: 41.4, lon: 2.1, routeKm: 0, name: "On-route start POI" },
    { lat: 41.5, lon: 2.2, routeKm: 39, name: "On-route finish POI" },
    { lat: -33.8688, lon: 151.2093, routeKm: 12, name: "Southern hemisphere POI" },
  ];

  for (const stop of stops) {
    const sv = googleStreetViewUrl(stop, {
      routeCoordinates: COLLserola_ROUTE,
      totalDistanceKm: 39,
    });
    const maps = googleMapsUrl(stop.lat, stop.lon);

    const svPoint = viewpointOf(sv);
    const mapsPoint = mapsQueryCoordsOf(maps);
    assert.ok(svPoint, `Street View URL missing viewpoint for ${stop.name}`);
    assert.ok(mapsPoint, `Maps URL missing query coords for ${stop.name}`);

    // Street View viewpoint === POI === Google Maps query coordinates.
    assert.equal(svPoint!.lat.toFixed(6), stop.lat.toFixed(6), stop.name);
    assert.equal(svPoint!.lon.toFixed(6), stop.lon.toFixed(6), stop.name);
    assert.equal(svPoint!.lat.toFixed(6), mapsPoint!.lat.toFixed(6), stop.name);
    assert.equal(svPoint!.lon.toFixed(6), mapsPoint!.lon.toFixed(6), stop.name);
  }
}

/** With a valid Google place id Maps uses place_id, but Street View still anchors on the POI coords. */
function testPlaceIdMapsStillSharesStreetViewCoordinates() {
  const stop = { lat: 41.430306, lon: 2.128889, routeKm: 6.96, name: "Oilprix" };
  const placeId = "ChIJN1t_tDeuEmsRUsoyG83frY4";

  const maps = googleMapsUrl(stop.lat, stop.lon, placeId);
  assert.match(maps, /place_id/);

  const sv = googleStreetViewUrl({ ...stop, placeId });
  const svPoint = viewpointOf(sv);
  assert.ok(svPoint);
  assert.equal(svPoint!.lat.toFixed(6), stop.lat.toFixed(6));
  assert.equal(svPoint!.lon.toFixed(6), stop.lon.toFixed(6));
}

function testPanoramaHeadingFacesPoiFromPoiViewpoint() {
  const panorama = { lat: 41.4301, lon: 2.1285 };
  const poi = { lat: OILPRIX.lat, lon: OILPRIX.lon };
  const expectedHeading = Math.round(bearingBetween(panorama, poi));

  const url = buildStreetViewUrlFromPanorama(panorama, poi, {
    panoId: "tu510ie_z4ptBZYo2BGEJg",
  });
  // Viewpoint is the POI (identical to Maps); the resolved pano only sets heading.
  assert.match(url, /viewpoint=41\.430306%2C2\.128889/);
  assert.match(url, new RegExp(`heading=${expectedHeading}`));
  assert.match(url, /pano=tu510ie_z4ptBZYo2BGEJg/);
  assert.doesNotMatch(url, /query=/);
}

function testStreetViewNeverUsesPlaceQuery() {
  const placeId = "ChIJN1t_tDeuEmsRUsoyG83frY4";
  const url = googleStreetViewUrl({
    lat: OILPRIX.lat,
    lon: OILPRIX.lon,
    name: "Oilprix",
    placeId,
  });

  assert.match(url, /map_action=pano/);
  assert.doesNotMatch(url, /query=/);
}

function testParseStreetViewMetadata() {
  assert.equal(parseStreetViewMetadataStatus("OK").available, true);
  assert.equal(parseStreetViewMetadataStatus("ZERO_RESULTS").available, false);
  assert.equal(parseStreetViewMetadataStatus("REQUEST_DENIED").status, "UNKNOWN");
}

function testCollserolaOilprixGpxDiffersFromPoi() {
  const gpx = gpxPointAtStopKm(OILPRIX, {
    routeCoordinates: COLLserola_ROUTE,
    totalDistanceKm: 39,
  });
  assert.ok(gpx);
  const distanceM = Math.hypot(
    (gpx!.lat - OILPRIX.lat) * 111_000,
    (gpx!.lon - OILPRIX.lon) * 85_000,
  );
  assert.ok(distanceM > 5, "Oilprix should be off-route from GPX interpolation");
}

async function testResolveStreetViewLogsAndUsesPoiSearch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        status: "OK",
        location: { lat: 41.4301, lng: 2.1285 },
        pano_id: "tu510ie_z4ptBZYo2BGEJg",
      }),
    }) as Response;

  try {
    const resolved = await resolveStreetView(OILPRIX, {
      routeCoordinates: COLLserola_ROUTE,
      totalDistanceKm: 39,
    });
    assert.equal(resolved.available, true);
    assert.ok(resolved.streetViewUrl);
    // Viewpoint is the POI (identical to Maps), pano pinned to the official nearest one.
    assert.match(resolved.streetViewUrl!, /viewpoint=41\.430306%2C2\.128889/);
    assert.match(resolved.streetViewUrl!, /pano=tu510ie_z4ptBZYo2BGEJg/);
    assert.doesNotMatch(resolved.streetViewUrl!, /query=/);
    assert.equal(resolved.debug.poiLat, OILPRIX.lat);
    assert.equal(resolved.debug.panoramaLat, 41.4301);
    assert.ok(resolved.debug.heading != null);
    assert.ok(resolved.debug.panoramaDistanceFromPoiM! <= STREET_VIEW_SEARCH_RADIUS_M);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testResolveStreetViewFallbackWhenMetadataDenied() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({
        status: "REQUEST_DENIED",
        error_message: "You must use an API key",
      }),
    }) as Response;

  try {
    const resolved = await resolveStreetView(OILPRIX, {
      routeCoordinates: COLLserola_ROUTE,
      totalDistanceKm: 39,
    });
    assert.equal(resolved.available, true);
    assert.ok(resolved.streetViewUrl);
    assert.doesNotMatch(resolved.streetViewUrl!, /query=/);
    assert.equal(resolved.debug.status, "UNKNOWN");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testResolveStreetViewFallbackWhenFetchFails() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network");
  };

  try {
    const resolved = await resolveStreetView(OILPRIX);
    assert.equal(resolved.available, true);
    assert.ok(resolved.streetViewUrl);
    assert.match(resolved.streetViewUrl!, /map_action=pano/);
    assert.doesNotMatch(resolved.streetViewUrl!, /query=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testResolveStreetViewFallbackWhenNoCoverage() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS" }),
    }) as Response;

  try {
    const resolved = await resolveStreetView(OILPRIX);
    assert.equal(resolved.available, false);
    assert.equal(resolved.streetViewUrl, null);
    assert.match(resolved.mapsFallbackUrl, /google\.com\/maps/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

testViewpointIsAlwaysThePoi();
testMapsAndStreetViewUseIdenticalCoordinates();
testPlaceIdMapsStillSharesStreetViewCoordinates();
testPanoramaHeadingFacesPoiFromPoiViewpoint();
testStreetViewNeverUsesPlaceQuery();
testParseStreetViewMetadata();
testCollserolaOilprixGpxDiffersFromPoi();
await testResolveStreetViewLogsAndUsesPoiSearch();
await testResolveStreetViewFallbackWhenMetadataDenied();
await testResolveStreetViewFallbackWhenFetchFails();
await testResolveStreetViewFallbackWhenNoCoverage();

console.log("streetViewUrl.test.ts: all tests passed");
