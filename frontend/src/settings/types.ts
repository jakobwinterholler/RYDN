import type { ClimbDetectionConfig, PoiPlanningProfile } from "../api";
import type { ClimbSensitivity } from "../planning/climbSensitivity";
import type { TimeWindowId } from "../planning/timeWindows";
import type { ZoneDensityMode } from "../planning/types";

export interface PlanningSettings {
  poi_profile: PoiPlanningProfile;
  climb_sensitivity: ClimbSensitivity;
  climb_config: ClimbDetectionConfig;
  preferred_stage_length_km: number;
  max_gap_without_resupply_km: number;
  default_arrival_time_window: TimeWindowId | null;
  /** @deprecated v0.3 — planning modes removed; kept for migration */
  default_zone_density?: ZoneDensityMode;
  developer_mode_enabled: boolean;
}

export interface AnalysisSettings {
  refresh_osm_on_analyse: boolean;
}

export interface AppearanceSettings {
  theme: "system" | "light" | "dark";
  mapStyle: string;
  language: string;
  units: "metric" | "imperial";
}

export interface StorageSummary {
  races_root: string;
  race_count: number;
  storage_bytes: number;
}

export interface AccountSettings {
  signed_in: boolean;
  email: string | null;
  display_name: string | null;
  cloud_sync_enabled: boolean;
  storage: StorageSummary;
}

export interface SettingsSnapshot {
  scope: "app" | "race";
  use_app_defaults: boolean;
  planning: PlanningSettings;
  analysis: AnalysisSettings;
  appearance: AppearanceSettings;
  account: AccountSettings;
  race_id?: string;
  race_name?: string;
  has_analysis?: boolean;
}

export type SettingsSectionId = "account" | "planning" | "analysis" | "developer";

export const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string; description: string }[] = [
  { id: "account", label: "Account", description: "Profile, storage, and sync" },
  { id: "planning", label: "Planning", description: "Resupply and gap assumptions" },
  { id: "analysis", label: "Analysis", description: "Re-analyse and data refresh" },
  { id: "developer", label: "Developer", description: "Diagnostics and experimental tools" },
];
