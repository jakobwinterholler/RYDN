"""Formatting + shared numeric helpers used across analyzers and narrative."""

from __future__ import annotations

from typing import List, Optional


def elevation_gain_loss(
    ele: List[Optional[float]],
    noise_m: float = 0.7,
    skip_from: Optional[set] = None,
) -> tuple[float, float]:
    """Total ascent / descent from a smoothed elevation series.

    ``noise_m`` ignores tiny wiggles so a flat road doesn't accumulate metres.
    ``skip_from`` is a set of sample indices ``i`` where the step ``i → i+1``
    should be ignored (e.g. overnight gaps between Ultra days).
    """
    gain = 0.0
    loss = 0.0
    last = None
    last_i = None
    for i, e in enumerate(ele):
        if e is None:
            continue
        if last is None or last_i is None:
            last = e
            last_i = i
            continue
        if skip_from and last_i in skip_from:
            last = e
            last_i = i
            continue
        delta = e - last
        if delta >= noise_m:
            gain += delta
            last = e
            last_i = i
        elif delta <= -noise_m:
            loss += -delta
            last = e
            last_i = i
    return gain, loss


def fmt_duration(seconds: Optional[float]) -> str:
    if seconds is None:
        return "—"
    seconds = int(round(seconds))
    h = seconds // 3600
    m = (seconds % 3600) // 60
    if h >= 1:
        return f"{h}h {m:02d}m"
    s = seconds % 60
    return f"{m}m {s:02d}s"


def fmt_clock(seconds: Optional[float]) -> str:
    if seconds is None:
        return "—"
    seconds = int(round(seconds))
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h}h{m:02d}"


def safe_mean(values: List[Optional[float]]) -> Optional[float]:
    nums = [v for v in values if v is not None]
    return sum(nums) / len(nums) if nums else None


def safe_max(values: List[Optional[float]]) -> Optional[float]:
    nums = [v for v in values if v is not None]
    return max(nums) if nums else None


def safe_min(values: List[Optional[float]]) -> Optional[float]:
    nums = [v for v in values if v is not None]
    return min(nums) if nums else None
