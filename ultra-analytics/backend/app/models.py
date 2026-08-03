"""Canonical data model.

Every source format (FIT, TCX, GPX today; Strava/Garmin/Coros APIs later)
is parsed into these structures. The analysis layer only ever sees canonical
``Activity`` / ``Race`` objects, so adding a new source never touches analysis.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Sample:
    """One recorded instant on the bike."""

    t: float  # epoch seconds (UTC)
    lat: Optional[float] = None
    lon: Optional[float] = None
    ele: Optional[float] = None  # metres
    dist: Optional[float] = None  # cumulative metres (device-reported if available)
    speed: Optional[float] = None  # m/s (device-reported if available)
    power: Optional[float] = None  # watts
    hr: Optional[int] = None  # bpm
    cadence: Optional[int] = None  # rpm
    temp: Optional[float] = None  # deg C


@dataclass
class Activity:
    """A single continuous recording (one file / one device session)."""

    source_file: str
    sport: str = "cycling"
    samples: List[Sample] = field(default_factory=list)

    @property
    def start_time(self) -> Optional[float]:
        return self.samples[0].t if self.samples else None

    @property
    def end_time(self) -> Optional[float]:
        return self.samples[-1].t if self.samples else None


@dataclass
class Race:
    """One logical effort. May be a single training ride or a multi-day ultra
    stitched from several activities. The rider never has to think about how
    many files it came from."""

    name: str
    kind: str  # "training" | "race"
    activities: List[Activity] = field(default_factory=list)

    @property
    def file_count(self) -> int:
        return len(self.activities)

    @property
    def start_time(self) -> Optional[float]:
        starts = [a.start_time for a in self.activities if a.start_time is not None]
        return min(starts) if starts else None

    @property
    def end_time(self) -> Optional[float]:
        ends = [a.end_time for a in self.activities if a.end_time is not None]
        return max(ends) if ends else None
