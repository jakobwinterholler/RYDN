"""Orchestrate the analysis pipeline and return API-friendly results."""

import logging
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

from climb_config import ClimbDetectionConfig, DEFAULT_CLIMB_DETECTION_CONFIG
from climb_detector import Climb, ClimbCandidate, detect_climbs_with_debug
from climb_namer import resolve_climb_name
from gradient_analysis import ClimbGradientStats, analyze_all_climbs
from gas_station_shop import assess_fuel_shop
from gpx_parser import TrackPoint, load_gpx
from osm_prefetch import prefetch_osm_data
from performance_targets import build_performance_summary, classify_cache_mode
from poi_contact import extract_phone, extract_website
from poi_detour import classify_detour
from poi_detector import PoiDataset, detect_pois
from poi_pipeline_debug import PoiDebugEntry, build_poi_debug_entries, detection_discard_to_debug
from poi_night_usability import classify_night_usability, night_usability_label, water_fountain_type_label
from poi_profile import PoiPlanningProfile, DEFAULT_ULTRA_POI_PROFILE
from poi_reviews import PoiReviews, empty_reviews
from poi_scoring import build_score_cache, score_poi
from poi_types import PointOfInterest
from pipeline_profiler import PipelineProfiler
from progress import ProgressReporter
from resupply_quality import ResupplyQualitySegment, build_resupply_quality_segments
from resupply_zones import ResupplyZone, ResupplyZonePlan, ZoneCategoryGroup, ZonePoiOption, build_resupply_zones
from suggested_stops import build_suggested_stops
from significant_climbs import significant_climbs
from route_segment_index import RouteSegmentIndex
from route_visualization import RouteVisualization, build_route_visualization, build_track_route_visualization
from surface_detector import SurfaceDataset, detect_surfaces
from surface_insights import build_surface_insights

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OSM_CACHE_DIR = PROJECT_ROOT / "cache" / "osm"
EXPORT_DIR = PROJECT_ROOT / "output"


@dataclass
class RouteSummary:
    """High-level route statistics for the web UI."""

    route_name: str
    distance_km: float
    elevation_gain_m: int
    climb_count: int
    road_pct: int
    gravel_pct: int
    trail_pct: int
    unknown_pct: int
    asphalt_pct: int


@dataclass
class ClimbRow:
    """One climb row for the roadbook table."""

    id: str
    nickname: str | None
    suggested_name: str | None
    name_source: str | None
    start_km: float
    end_km: float
    length_km: float
    elevation_gain_m: int
    avg_gradient_pct: float
    max_50_m_pct: float | None
    max_100_m_pct: float | None
    max_250_m_pct: float | None
    max_500_m_pct: float | None
    max_1000_m_pct: float | None


@dataclass
class ClimbCandidateRow:
    candidate_id: str
    climb_id: str | None
    start_km: float
    end_km: float
    length_km: float
    elevation_gain_m: float
    net_elevation_gain_m: float
    avg_gradient_pct: float
    max_gradient_pct: float | None
    status: str
    rejection_reason: str | None
    rejection_label: str | None


@dataclass
class PoiReviewsRow:
    source: str | None
    rating: float | None
    review_count: int | None


@dataclass
class PoiRow:
    """One POI row for the debug POI table."""

    osm_id: int
    osm_type: str
    name: str | None
    category: str
    priority: int
    lat: float
    lon: float
    distance_along_km: float
    distance_off_route_m: float
    detour_band_id: str
    detour_label: str
    detour_emoji: str
    detour_tone: str
    score: float
    zone_id: int | None
    night_usability: str
    night_usability_label: str
    water_fountain_type: str | None
    water_fountain_type_label: str | None
    tags: dict[str, str]
    opening_hours: str | None
    brand: str | None
    phone: str | None
    website: str | None
    reviews: PoiReviewsRow
    fuel_shop_confidence: str | None = None
    fuel_shop_label: str | None = None


@dataclass
class ZonePoiOptionRow:
    """One ranked POI option inside a zone category."""

    osm_id: int
    osm_type: str
    name: str | None
    poi_category: str
    distance_along_km: float
    distance_off_route_m: float
    accessibility_label: str
    accessibility_emoji: str
    accessibility_tone: str
    score: float
    brand: str | None
    lat: float
    lon: float
    night_usability: str
    night_usability_label: str
    water_fountain_type: str | None
    water_fountain_type_label: str | None
    opening_hours: str | None
    phone: str | None
    website: str | None
    tags: dict[str, str]
    reviews: PoiReviewsRow
    fuel_shop_confidence: str | None = None
    fuel_shop_label: str | None = None


@dataclass
class ZoneCategoryRow:
    """Primary and alternatives for one rider-facing category."""

    key: str
    label: str
    primary: ZonePoiOptionRow | None
    alternatives: list[ZonePoiOptionRow]


@dataclass
class ResupplyZoneRow:
    """One resupply zone for the web UI."""

    zone_id: int
    name: str
    lat: float
    lon: float
    distance_along_km: float
    poi_count: int
    accessibility_label: str
    accessibility_emoji: str
    accessibility_tone: str
    categories: list[ZoneCategoryRow]


@dataclass
class SuggestedStopRow:
    """One hand-picked suggested stop for the planning workflow."""

    zone_id: int
    osm_id: int
    osm_type: str
    name: str | None
    poi_category: str
    category_key: str
    category_label: str
    distance_along_km: float
    distance_off_route_m: float
    lat: float
    lon: float
    score: float
    reason: str | None


@dataclass
class TrackPointRow:
    lat: float
    lon: float
    km: float
    ele_m: float | None
    cumulative_gain_m: float


@dataclass
class RouteBoundsRow:
    south: float
    west: float
    north: float
    east: float


@dataclass
class SurfaceSegmentRow:
    start_km: float
    end_km: float
    surface: str
    color: str
    osm_surface: str | None
    rider_category: str
    rider_subcategory: str
    surface_source: str
    surface_confidence: float


@dataclass
class ResupplyQualitySegmentRow:
    start_km: float
    end_km: float
    quality: str
    label: str
    emoji: str
    color: str
    distance_to_next_zone_km: float | None


@dataclass
class RouteVisualizationRow:
    track_points: list[TrackPointRow]
    bounds: RouteBoundsRow
    surface_segments: list[SurfaceSegmentRow]
    resupply_segments: list[ResupplyQualitySegmentRow]


@dataclass
class PerformanceStageRow:
    stage_id: str
    label: str
    duration_s: float
    percent: float


@dataclass
class SurfaceInsightRow:
    id: str
    label: str
    length_km: float
    start_km: float
    end_km: float
    category: str
    subcategory: str | None


@dataclass
class PerformanceSummaryRow:
    cache_mode: str
    total_s: float
    memory_peak_mb: float
    target_cold_s: float
    target_warm_s: float
    meets_cold_target: bool
    meets_warm_target: bool
    surface_cache_hit: bool
    poi_cache_hit: bool
    processed_geometry_hit: bool


@dataclass
class PoiDebugRow:
    osm_id: int
    osm_type: str
    name: str | None
    brand: str | None
    category: str | None
    lat: float | None
    lon: float | None
    status: str
    discard_stage: str | None
    discard_reason: str | None
    distance_along_km: float | None
    distance_off_route_m: float | None
    score: float | None
    zone_id: int | None
    cluster_id: int | None
    zone_role: str | None
    primary_score: float | None = None
    fuel_score: float | None = None
    food_score: float | None = None
    water_score: float | None = None
    cluster_winner: bool | None = None
    bundle_exported: bool | None = None


@dataclass
class RoadbookResult:
    """Complete analysis result returned to the frontend."""

    summary: RouteSummary
    climbs: list[ClimbRow]
    climb_candidates: list[ClimbCandidateRow]
    pois: list[PoiRow]
    resupply_zones: list[ResupplyZoneRow]
    suggested_stops: list[SuggestedStopRow]
    route: RouteVisualizationRow
    performance_report: list[PerformanceStageRow]
    performance_summary: PerformanceSummaryRow | None
    surface_insights: list[SurfaceInsightRow]
    surface_diagnostics: dict | None
    poi_debug: list[PoiDebugRow] | None = None


@dataclass
class AnalysisArtifacts:
    """Cached analysis outputs used for API exports."""

    roadbook: RoadbookResult
    track: list[TrackPoint]
    surface_dataset: SurfaceDataset
    poi_dataset: PoiDataset
    resupply_plan: ResupplyZonePlan
    climbs_with_gradients: list[tuple[Climb, ClimbGradientStats]]
    climb_candidates: list[ClimbCandidate]
    climb_nicknames: dict[str, str]
    gpx_path: Path
    temp_dir: Path
    race_id: str | None = None


_race_caches: dict[str, AnalysisArtifacts] = {}


def get_race_cache(race_id: str) -> AnalysisArtifacts | None:
    """Return cached analysis artifacts for a race."""
    return _race_caches.get(race_id)


def set_race_cache(race_id: str, artifacts: AnalysisArtifacts) -> AnalysisArtifacts:
    """Store analysis artifacts for a race."""
    artifacts.race_id = race_id
    _race_caches[race_id] = artifacts
    return artifacts


def clear_race_cache(race_id: str) -> None:
    """Remove cached analysis for one race."""
    cache = _race_caches.pop(race_id, None)
    if cache is not None and cache.temp_dir != cache.gpx_path.parent:
        shutil.rmtree(cache.temp_dir, ignore_errors=True)


def get_session_cache() -> AnalysisArtifacts | None:
    """Return the most recently analyzed route artifacts (legacy — first cached race)."""
    if not _race_caches:
        return None
    return next(iter(_race_caches.values()))


def clear_session_cache() -> None:
    """Remove all cached analysis data."""
    for race_id in list(_race_caches.keys()):
        clear_race_cache(race_id)


def _require_race_cache(race_id: str | None) -> AnalysisArtifacts:
    if race_id is None:
        cache = get_session_cache()
    else:
        cache = get_race_cache(race_id)
    if cache is None:
        raise ValueError("Analyze this race first.")
    return cache


def _poi_row(
    poi: PointOfInterest,
    zone_id: int | None,
    score_cache: dict[tuple[int, str], float] | None = None,
) -> PoiRow:
    band = classify_detour(poi.distance_off_route_m)
    night_usability, water_type = classify_night_usability(poi)
    resolved_score = (
        score_cache.get((poi.osm_id, poi.osm_type), score_poi(poi))
        if score_cache is not None
        else score_poi(poi)
    )
    shop_assessment = assess_fuel_shop(
        category=poi.category,
        tags=poi.tags,
        name=poi.name,
        brand=poi.brand,
    )
    return PoiRow(
        osm_id=poi.osm_id,
        osm_type=poi.osm_type,
        name=poi.name,
        category=poi.category,
        priority=poi.priority,
        lat=poi.lat,
        lon=poi.lon,
        distance_along_km=poi.distance_along_km,
        distance_off_route_m=poi.distance_off_route_m,
        detour_band_id=band.id,
        detour_label=band.label,
        detour_emoji=band.emoji,
        detour_tone=band.tone,
        score=resolved_score,
        zone_id=zone_id,
        night_usability=night_usability,
        night_usability_label=night_usability_label(night_usability),
        water_fountain_type=water_type,
        water_fountain_type_label=water_fountain_type_label(water_type),
        tags=poi.tags,
        opening_hours=poi.opening_hours,
        brand=poi.brand,
        phone=extract_phone(poi.tags),
        website=extract_website(poi.tags),
        reviews=_reviews_row(empty_reviews()),
        fuel_shop_confidence=shop_assessment.confidence if shop_assessment else None,
        fuel_shop_label=shop_assessment.label if shop_assessment else None,
    )


def _reviews_row(reviews: PoiReviews) -> PoiReviewsRow:
    return PoiReviewsRow(
        source=reviews.source,
        rating=reviews.rating,
        review_count=reviews.review_count,
    )


def _zone_poi_option_row(option: ZonePoiOption) -> ZonePoiOptionRow:
    return ZonePoiOptionRow(
        osm_id=option.osm_id,
        osm_type=option.osm_type,
        name=option.name,
        poi_category=option.poi_category,
        distance_along_km=option.distance_along_km,
        distance_off_route_m=option.distance_off_route_m,
        accessibility_label=option.accessibility_label,
        accessibility_emoji=option.accessibility_emoji,
        accessibility_tone=option.accessibility_tone,
        score=option.score,
        brand=option.brand,
        lat=option.lat,
        lon=option.lon,
        night_usability=option.night_usability,
        night_usability_label=option.night_usability_label,
        water_fountain_type=option.water_fountain_type,
        water_fountain_type_label=option.water_fountain_type_label,
        opening_hours=option.opening_hours,
        phone=option.phone,
        website=option.website,
        tags=option.tags,
        reviews=_reviews_row(option.reviews),
        fuel_shop_confidence=option.fuel_shop_confidence,
        fuel_shop_label=option.fuel_shop_label,
    )


def _zone_category_row(group: ZoneCategoryGroup) -> ZoneCategoryRow:
    return ZoneCategoryRow(
        key=group.key,
        label=group.label,
        primary=_zone_poi_option_row(group.primary) if group.primary else None,
        alternatives=[_zone_poi_option_row(option) for option in group.alternatives],
    )


def _resupply_zone_row(zone: ResupplyZone) -> ResupplyZoneRow:
    return ResupplyZoneRow(
        zone_id=zone.zone_id,
        name=zone.name,
        lat=zone.lat,
        lon=zone.lon,
        distance_along_km=zone.distance_along_km,
        poi_count=zone.poi_count,
        accessibility_label=zone.accessibility_label,
        accessibility_emoji=zone.accessibility_emoji,
        accessibility_tone=zone.accessibility_tone,
        categories=[_zone_category_row(group) for group in zone.categories],
    )


def _resupply_quality_segment_row(segment: ResupplyQualitySegment) -> ResupplyQualitySegmentRow:
    return ResupplyQualitySegmentRow(
        start_km=segment.start_km,
        end_km=segment.end_km,
        quality=segment.quality,
        label=segment.label,
        emoji=segment.emoji,
        color=segment.color,
        distance_to_next_zone_km=segment.distance_to_next_zone_km,
    )


def _route_visualization_row(visualization: RouteVisualization) -> RouteVisualizationRow:
    return RouteVisualizationRow(
        track_points=[
            TrackPointRow(
                lat=point.lat,
                lon=point.lon,
                km=point.km,
                ele_m=point.ele_m,
                cumulative_gain_m=point.cumulative_gain_m,
            )
            for point in visualization.track_points
        ],
        bounds=RouteBoundsRow(
            south=visualization.bounds.south,
            west=visualization.bounds.west,
            north=visualization.bounds.north,
            east=visualization.bounds.east,
        ),
        surface_segments=[
            SurfaceSegmentRow(
                start_km=segment.start_km,
                end_km=segment.end_km,
                surface=segment.surface,
                color=segment.color,
                osm_surface=segment.osm_surface,
                rider_category=segment.rider_category,
                rider_subcategory=segment.rider_subcategory,
                surface_source=segment.surface_source,
                surface_confidence=segment.surface_confidence,
            )
            for segment in visualization.surface_segments
        ],
        resupply_segments=[
            _resupply_quality_segment_row(segment)
            for segment in visualization.resupply_segments
        ],
    )


def _climb_row(
    climb: Climb,
    gradients: ClimbGradientStats,
    nicknames: dict[str, str],
    surface_dataset: SurfaceDataset | None = None,
) -> ClimbRow:
    name_result = resolve_climb_name(climb, surface_dataset)
    return ClimbRow(
        id=climb.climb_id,
        nickname=nicknames.get(climb.climb_id),
        suggested_name=name_result.suggested_name,
        name_source=name_result.name_source,
        start_km=round(climb.start_km, 2),
        end_km=round(climb.end_km, 2),
        length_km=round(climb.length_km, 2),
        elevation_gain_m=round(climb.elevation_gain_m),
        avg_gradient_pct=round(climb.avg_gradient_pct, 1),
        max_50_m_pct=gradients.max_50_m_pct,
        max_100_m_pct=gradients.max_100_m_pct,
        max_250_m_pct=gradients.max_250_m_pct,
        max_500_m_pct=gradients.max_500_m_pct,
        max_1000_m_pct=gradients.max_1000_m_pct,
    )


def _climb_candidate_row(candidate: ClimbCandidate) -> ClimbCandidateRow:
    return ClimbCandidateRow(
        candidate_id=candidate.candidate_id,
        climb_id=candidate.climb_id,
        start_km=round(candidate.start_km, 2),
        end_km=round(candidate.end_km, 2),
        length_km=round(candidate.length_km, 2),
        elevation_gain_m=round(candidate.elevation_gain_m),
        net_elevation_gain_m=round(candidate.net_elevation_gain_m),
        avg_gradient_pct=round(candidate.avg_gradient_pct, 1),
        max_gradient_pct=(
            round(candidate.max_gradient_pct, 1)
            if candidate.max_gradient_pct is not None
            else None
        ),
        status=candidate.status,
        rejection_reason=candidate.rejection_reason,
        rejection_label=candidate.rejection_label,
    )


def _performance_rows(profiler: PipelineProfiler) -> list[PerformanceStageRow]:
    return [
        PerformanceStageRow(
            stage_id=str(row["stage_id"]),
            label=str(row["label"]),
            duration_s=float(row["duration_s"]),
            percent=float(row["percent"]),
        )
        for row in profiler.report()
        if row["stage_id"] != "total"
    ]


def _zone_has_food(zone: ResupplyZone) -> bool:
    return any(
        group.key == "food"
        and group.primary is not None
        for group in zone.categories
    )


def _longest_food_gap_km(zones: list[ResupplyZone], total_km: float) -> float | None:
    food_zones = sorted(
        [zone for zone in zones if _zone_has_food(zone)],
        key=lambda zone: zone.distance_along_km,
    )
    if not food_zones:
        return total_km if total_km > 0 else None

    gaps = [food_zones[0].distance_along_km]
    for index in range(len(food_zones) - 1):
        gaps.append(food_zones[index + 1].distance_along_km - food_zones[index].distance_along_km)
    gaps.append(total_km - food_zones[-1].distance_along_km)
    return max(gaps)


def _emit_partial(progress: ProgressReporter | None, slice_id: str, data: dict) -> None:
    if progress is not None:
        progress.partial(slice_id, data)


def analyze_gpx_file(
    gpx_path: Path,
    *,
    refresh_osm: bool = False,
    progress: ProgressReporter | None = None,
    poi_profile: PoiPlanningProfile = DEFAULT_ULTRA_POI_PROFILE,
) -> AnalysisArtifacts:
    """Run the full roadbook analysis pipeline on one GPX file."""
    profiler = PipelineProfiler()

    with profiler.stage("reading_gpx", "Read GPX"):
        if progress is not None:
            progress.start("reading_gpx")
        stats, track = load_gpx(gpx_path)
        if progress is not None:
            progress.complete("reading_gpx")
            progress.milestone("GPX file read")

    with profiler.stage("calculating_distance", "Calculate distance"):
        if progress is not None:
            progress.start("calculating_distance")
            progress.complete("calculating_distance", detail=f"{stats.distance_km:.1f} km")
            progress.readiness("distance", "ready")
            progress.readiness("elevation", "ready")
            progress.update_stats(
                distance_km=round(stats.distance_km, 1),
                elevation_gain_m=round(stats.elevation_gain_m),
                gpx_points=stats.track_point_count,
            )
            progress.milestone(
                f"Route parsed · {stats.distance_km:.0f} km · +{round(stats.elevation_gain_m)} m",
            )

    route_index = RouteSegmentIndex.build(track)
    bootstrap_viz = build_track_route_visualization(track)
    bootstrap_summary = RouteSummary(
        route_name=gpx_path.name,
        distance_km=round(stats.distance_km, 2),
        elevation_gain_m=round(stats.elevation_gain_m),
        climb_count=0,
        road_pct=0,
        gravel_pct=0,
        trail_pct=0,
        unknown_pct=0,
        asphalt_pct=0,
    )
    _emit_partial(
        progress,
        "bootstrap",
        {
            "summary": asdict(bootstrap_summary),
            "route": asdict(_route_visualization_row(bootstrap_viz)),
        },
    )
    if progress is not None:
        progress.complete_stage("generate_map", label="Generate map")
        progress.readiness("map", "ready")
        progress.milestone("Interactive route map ready")

    with profiler.stage("detecting_climbs", "Climb Detection"):
        if progress is not None:
            progress.start("detecting_climbs")
            progress.readiness("climbs", "running")
        climbs, climb_candidates = detect_climbs_with_debug(track)
        if progress is not None:
            progress.complete("detecting_climbs", detail=f"{len(climbs)} climbs")

    with profiler.stage("calculating_gradients", "Gradient Analysis"):
        if progress is not None:
            progress.start("calculating_gradients")
        climbs_with_gradients = analyze_all_climbs(track, climbs)
        climb_rows = [
            _climb_row(climb, gradients, {}, None)
            for climb, gradients in climbs_with_gradients
        ]
        candidate_rows = [_climb_candidate_row(candidate) for candidate in climb_candidates]
        if progress is not None:
            progress.complete("calculating_gradients")

    _emit_partial(
        progress,
        "climbs",
        {
            "climbs": [asdict(row) for row in climb_rows],
            "climb_candidates": [asdict(row) for row in candidate_rows],
            "summary": {
                **asdict(bootstrap_summary),
                "climb_count": len(significant_climbs(climb_rows)),
            },
        },
    )
    if progress is not None:
        progress.readiness("climbs", "ready")
        progress.update_stats(climb_count=len(significant_climbs(climb_rows)))
        progress.milestone(f"Detected {len(significant_climbs(climb_rows))} climbs")

    with profiler.stage("osm_prefetch", "OSM Prefetch"):
        osm_prefetch = prefetch_osm_data(
            track,
            gpx_path,
            OSM_CACHE_DIR,
            poi_profile,
            refresh_osm=refresh_osm,
        )
        if osm_prefetch.parallel_download_s > 0:
            profiler.record(
                "parallel_osm_download",
                "Parallel OSM download",
                osm_prefetch.parallel_download_s,
            )

    with profiler.stage("osm_surface_data", "Surface Detection"):
        if progress is not None:
            progress.readiness("surface", "running")
            progress.transition("Surface detection starting")
        try:
            surface_dataset = detect_surfaces(
                track,
                gpx_path,
                OSM_CACHE_DIR,
                refresh_osm=refresh_osm,
                progress=progress,
                prefetched_elements=osm_prefetch.surface_elements,
            )
        except Exception as exc:
            if progress is not None:
                progress.error("detecting_surfaces", str(exc))
            raise
        if progress is not None:
            progress.readiness("surface", "ready")
            progress.transition("Surface detection finished")

    with profiler.stage("osm_poi_data", "POI Detection"):
        if progress is not None:
            progress.readiness("pois", "running")
            progress.transition("POI detection starting")
        try:
            poi_dataset = detect_pois(
                track,
                gpx_path,
                OSM_CACHE_DIR,
                refresh_osm=refresh_osm,
                progress=progress,
                profile=poi_profile,
                route_index=route_index,
                prefetched_elements=osm_prefetch.poi_elements,
            )
        except Exception as exc:
            if progress is not None:
                progress.error("finding_pois", str(exc))
            raise
        if progress is not None:
            progress.readiness("pois", "ready")
            progress.transition("POI detection finished")

    profiler.record("poi_download", "POI Download", poi_dataset.osm_load_s)
    profiler.record("poi_matching", "POI Matching", poi_dataset.matching_s)
    profiler.record("surface_analysis", "Surface Analysis", surface_dataset.runtime.matching_s)

    with profiler.stage("creating_resupply_zones", "Resupply Zones"):
        if progress is not None:
            progress.start("creating_resupply_zones")
        score_cache = build_score_cache(poi_dataset.pois)
        resupply_plan = build_resupply_zones(poi_dataset.pois, score_cache=score_cache)
        if progress is not None:
            progress.complete(
                "creating_resupply_zones",
                detail=f"{len(resupply_plan.zones)} zones",
            )
            progress.readiness("resupply", "ready")
            progress.update_stats(zone_count=len(resupply_plan.zones))
            progress.milestone(f"Created {len(resupply_plan.zones)} resupply zones")
            food_gap_km = _longest_food_gap_km(resupply_plan.zones, stats.distance_km)
            if food_gap_km is not None and food_gap_km >= 20:
                progress.milestone(f"Longest food gap · {food_gap_km:.0f} km")

    climb_rows = [
        _climb_row(climb, gradients, {}, surface_dataset)
        for climb, gradients in climbs_with_gradients
    ]

    total_km = stats.distance_km
    surface_summary = surface_dataset.summary
    matched_km = (
        surface_summary.road_km
        + surface_summary.gravel_km
        + surface_summary.trail_km
        + surface_summary.unknown_km
    )
    unmatched_km = max(0.0, total_km - matched_km)
    unknown_km = surface_summary.unknown_km + unmatched_km
    road_pct = round(surface_summary.road_pct(total_km))

    surface_summary_row = RouteSummary(
        route_name=gpx_path.name,
        distance_km=round(total_km, 2),
        elevation_gain_m=round(stats.elevation_gain_m),
        climb_count=len(climbs),
        road_pct=road_pct,
        gravel_pct=round(surface_summary.gravel_pct(total_km)),
        trail_pct=round(surface_summary.trail_pct(total_km)),
        unknown_pct=round((unknown_km / total_km * 100) if total_km > 0 else 0),
        asphalt_pct=road_pct,
    )
    surface_route_viz = build_route_visualization(track, surface_dataset, resupply_plan.zones)
    _emit_partial(
        progress,
        "surface",
        {
            "summary": asdict(surface_summary_row),
            "route": asdict(_route_visualization_row(surface_route_viz)),
        },
    )
    if progress is not None:
        progress.update_stats(
            asphalt_pct=surface_summary_row.asphalt_pct,
            gravel_pct=surface_summary_row.gravel_pct,
            surface_pct=100,
        )
        progress.milestone(
            f"Surface analysed · {surface_summary_row.asphalt_pct}% asphalt",
        )

    poi_rows = [
        _poi_row(
            poi,
            resupply_plan.poi_zone_ids.get((poi.osm_id, poi.osm_type)),
            score_cache,
        )
        for poi in poi_dataset.pois
    ]
    _emit_partial(
        progress,
        "pois",
        {"pois": [asdict(poi) for poi in poi_rows]},
    )

    zone_rows = [_resupply_zone_row(zone) for zone in resupply_plan.zones]
    climb_dicts = [
        {
            "id": row.id,
            "start_km": row.start_km,
            "end_km": row.end_km,
        }
        for row in climb_rows
    ]
    suggested_stop_dicts = build_suggested_stops(
        [asdict(zone) for zone in zone_rows],
        climbs=climb_dicts,
        total_km=total_km,
    )
    suggested_stop_rows = [SuggestedStopRow(**stop) for stop in suggested_stop_dicts]
    poi_debug_entries = build_poi_debug_entries(
        poi_dataset.pois,
        resupply_plan,
        [detection_discard_to_debug(discard) for discard in poi_dataset.discarded],
        score_cache=score_cache,
    )
    poi_debug_rows = [
        PoiDebugRow(
            osm_id=entry.osm_id,
            osm_type=entry.osm_type,
            name=entry.name,
            brand=entry.brand,
            category=entry.category,
            lat=entry.lat,
            lon=entry.lon,
            status=entry.status,
            discard_stage=entry.discard_stage,
            discard_reason=entry.discard_reason,
            distance_along_km=entry.distance_along_km,
            distance_off_route_m=entry.distance_off_route_m,
            score=entry.score,
            zone_id=entry.zone_id,
            cluster_id=entry.cluster_id,
            zone_role=entry.zone_role,
            primary_score=entry.primary_score,
            fuel_score=entry.fuel_score,
            food_score=entry.food_score,
            water_score=entry.water_score,
            cluster_winner=entry.cluster_winner,
            bundle_exported=entry.bundle_exported,
        )
        for entry in poi_debug_entries
    ]
    _emit_partial(
        progress,
        "zones",
        {"resupply_zones": [asdict(zone) for zone in zone_rows]},
    )

    with profiler.stage("calculating_resupply_quality", "Resupply Quality"):
        if progress is not None:
            progress.start("calculating_resupply_quality")
        resupply_segments = build_resupply_quality_segments(track, resupply_plan.zones)
        if progress is not None:
            progress.complete("calculating_resupply_quality")

    with profiler.stage("generating_route_visualization", "Timeline Generation"):
        if progress is not None:
            progress.start("generating_route_visualization")
        route_viz = build_route_visualization(
            track,
            surface_dataset,
            resupply_plan.zones,
            resupply_segments=resupply_segments,
        )
        if progress is not None:
            progress.complete("generating_route_visualization")

    _emit_partial(
        progress,
        "timeline",
        {"route": asdict(_route_visualization_row(route_viz))},
    )
    if progress is not None:
        progress.readiness("timeline", "ready")
        progress.milestone("Route timeline generated")

    summary = surface_summary_row
    summary.climb_count = len(significant_climbs(climb_rows))
    performance_report = _performance_rows(profiler)
    cache_mode = classify_cache_mode(
        surface_downloaded=surface_dataset.osm_downloaded,
        poi_downloaded=poi_dataset.osm_downloaded,
        processed_geometry_hit=surface_dataset.processed_geometry_hit,
    )
    performance_summary = PerformanceSummaryRow(
        **asdict(
            build_performance_summary(
                cache_mode=cache_mode,
                total_s=profiler.total_s,
                memory_peak_mb=profiler.memory_peak_mb,
                surface_cache_hit=not surface_dataset.osm_downloaded,
                poi_cache_hit=not poi_dataset.osm_downloaded,
                processed_geometry_hit=surface_dataset.processed_geometry_hit,
            )
        )
    )

    if progress is not None:
        progress.start("preparing_dashboard")
        progress.complete("preparing_dashboard")
        progress.complete_stage("preparing_dashboard", label="Prepare dashboard")
        progress.complete("complete", label="Complete")
        progress.set_stage_fraction("preparing_dashboard", 1.0)
        progress.performance(
            [asdict(row) for row in performance_report],
            summary=asdict(performance_summary),
        )
        progress.milestone("Analysis complete")

    roadbook = RoadbookResult(
        summary=summary,
        climbs=climb_rows,
        climb_candidates=candidate_rows,
        pois=poi_rows,
        resupply_zones=zone_rows,
        suggested_stops=suggested_stop_rows,
        route=_route_visualization_row(route_viz),
        performance_report=performance_report,
        performance_summary=performance_summary,
        surface_insights=[
            SurfaceInsightRow(
                id=insight.id,
                label=insight.label,
                length_km=insight.length_km,
                start_km=insight.start_km,
                end_km=insight.end_km,
                category=insight.category,
                subcategory=insight.subcategory,
            )
            for insight in build_surface_insights(route_viz)
        ],
        surface_diagnostics=surface_dataset.diagnostics,
        poi_debug=poi_debug_rows,
    )

    return AnalysisArtifacts(
        roadbook=roadbook,
        track=track,
        surface_dataset=surface_dataset,
        poi_dataset=poi_dataset,
        resupply_plan=resupply_plan,
        climbs_with_gradients=climbs_with_gradients,
        climb_candidates=climb_candidates,
        climb_nicknames={},
        gpx_path=gpx_path,
        temp_dir=gpx_path.parent,
    )


def analyze_gpx_upload(
    file_name: str,
    file_bytes: bytes,
    *,
    refresh_osm: bool = False,
    progress: ProgressReporter | None = None,
    poi_profile: PoiPlanningProfile = DEFAULT_ULTRA_POI_PROFILE,
    race_id: str | None = None,
) -> AnalysisArtifacts:
    """Save an uploaded GPX to a temp file, run analysis, and cache artifacts."""
    temp_dir = Path(tempfile.mkdtemp())
    gpx_path = temp_dir / Path(file_name).name
    gpx_path.write_bytes(file_bytes)

    artifacts = analyze_gpx_file(
        gpx_path,
        refresh_osm=refresh_osm,
        progress=progress,
        poi_profile=poi_profile,
    )
    artifacts.temp_dir = temp_dir
    if race_id is not None:
        set_race_cache(race_id, artifacts)
    else:
        legacy_id = "__legacy__"
        set_race_cache(legacy_id, artifacts)
    return artifacts


def analyze_race_gpx(
    race_id: str,
    gpx_path: Path,
    *,
    refresh_osm: bool = False,
    progress: ProgressReporter | None = None,
    poi_profile: PoiPlanningProfile = DEFAULT_ULTRA_POI_PROFILE,
    climb_nicknames: dict[str, str] | None = None,
) -> AnalysisArtifacts:
    """Run analysis on a race GPX stored in the race folder."""
    artifacts = analyze_gpx_file(
        gpx_path,
        refresh_osm=refresh_osm,
        progress=progress,
        poi_profile=poi_profile,
    )
    artifacts.gpx_path = gpx_path
    artifacts.temp_dir = gpx_path.parent
    nicknames = climb_nicknames or {}
    if nicknames:
        artifacts.climb_nicknames = nicknames
        artifacts.roadbook.climbs = [
            _climb_row(climb, gradients, nicknames, artifacts.surface_dataset)
            for climb, gradients in artifacts.climbs_with_gradients
        ]
    return set_race_cache(race_id, artifacts)


def ensure_race_cache(
    race_id: str,
    *,
    gpx_path: Path,
    poi_profile: PoiPlanningProfile = DEFAULT_ULTRA_POI_PROFILE,
    climb_nicknames: dict[str, str] | None = None,
) -> AnalysisArtifacts:
    """Load cached artifacts or re-analyze the race GPX."""
    cached = get_race_cache(race_id)
    if cached is not None:
        return cached
    return analyze_race_gpx(
        race_id,
        gpx_path,
        poi_profile=poi_profile,
        climb_nicknames=climb_nicknames,
    )


def recalculate_climbs(
    config: ClimbDetectionConfig | None = None,
    race_id: str | None = None,
) -> AnalysisArtifacts:
    """Re-run climb detection on the cached track without re-analyzing the route."""
    cache = _require_race_cache(race_id)

    resolved_config = config or DEFAULT_CLIMB_DETECTION_CONFIG
    climbs, climb_candidates = detect_climbs_with_debug(cache.track, resolved_config)
    climbs_with_gradients = analyze_all_climbs(cache.track, climbs)
    climb_rows = [
        _climb_row(climb, gradients, cache.climb_nicknames, cache.surface_dataset)
        for climb, gradients in climbs_with_gradients
    ]

    cache.climbs_with_gradients = climbs_with_gradients
    cache.climb_candidates = climb_candidates
    cache.roadbook.climbs = climb_rows
    cache.roadbook.climb_candidates = [
        _climb_candidate_row(candidate) for candidate in climb_candidates
    ]
    cache.roadbook.summary.climb_count = len(significant_climbs(climb_rows))
    return cache


def update_climb_nicknames(
    nicknames: dict[str, str],
    race_id: str | None = None,
) -> AnalysisArtifacts:
    """Update climb nicknames for the active race cache."""
    cache = _require_race_cache(race_id)

    cache.climb_nicknames = nicknames
    cache.roadbook.climbs = [
        _climb_row(climb, gradients, nicknames, cache.surface_dataset)
        for climb, gradients in cache.climbs_with_gradients
    ]
    return cache


def roadbook_to_dict(result: RoadbookResult) -> dict:
    """Convert a RoadbookResult to a JSON-serializable dictionary."""
    return {
        "summary": asdict(result.summary),
        "climbs": [asdict(climb) for climb in result.climbs],
        "climb_candidates": [asdict(candidate) for candidate in result.climb_candidates],
        "pois": [asdict(poi) for poi in result.pois],
        "resupply_zones": [asdict(zone) for zone in result.resupply_zones],
        "suggested_stops": [asdict(stop) for stop in result.suggested_stops],
        "route": asdict(result.route),
        "performance_report": [asdict(row) for row in result.performance_report],
        "performance_summary": (
            asdict(result.performance_summary) if result.performance_summary is not None else None
        ),
        "surface_insights": [asdict(insight) for insight in (result.surface_insights or [])],
        "surface_diagnostics": result.surface_diagnostics,
        "poi_debug": [asdict(entry) for entry in (result.poi_debug or [])],
    }
