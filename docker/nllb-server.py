"""
NLLB-200 Translation Server

FastAPI server wrapping HuggingFace's NLLB-200 model family.
The server auto-selects the best model size and precision at runtime
using canonical PyTorch APIs to query the actual hardware capabilities.

Endpoints:
  POST /translate  { text, source_lang, target_lang } → { translation, metrics }
  POST /benchmark  { sentences, source_lang, target_lang } → full matrix results
  DELETE /benchmark/cache → clear cached benchmark results
  GET  /health     → { status, model, device, precision, ... }

Security:
  - TLS with auto-generated self-signed cert (written to /tmp/tls/)
  - HMAC-SHA256 bearer token auth on all endpoints except /health
  - Token format: Authorization: Bearer HMAC-SHA256:<unix_ts>:<hex_signature>

Environment variables (all optional — auto-detected if unset):
  NLLB_PARAMS     - Model size: 600M, 1.3B, 3.3B (auto-selected if unset)
  MODEL_NAME      - HuggingFace model ID override (takes priority over NLLB_PARAMS)
  NLLB_PRECISION  - Precision: fp32, bf16, fp16, int8, int4 (auto-detected if unset)
  NLLB_DEVICE     - Force device: cpu, gpu (auto-detected if unset)
  HOST            - Bind address (default: 0.0.0.0)
  PORT            - Port (default: 8000)
  NLLB_API_KEY    - Shared secret for HMAC auth (required for /translate)
  NLLB_PRESSURE_CACHE_PATH - Path to pressure failure cache JSON (default: /data/pressure-cache.json)

Model selection (runtime, inside container):
  The server owns model + precision selection. It queries PyTorch for actual
  hardware capabilities (torch.cuda.is_bf16_supported(), VRAM, compute
  capability) rather than relying on heuristic name-matching from the host.
  The TS batch translator only decides CPU vs GPU Docker profile — the server
  makes the final authoritative decision using the real runtime.
"""

_SERVER_VERSION = "0.5.1"  # bump on meaningful server changes


def _derive_version_at() -> tuple[str, str]:
    """Derive version date and its provenance from the best available source.

    Returns (iso_date, source) where source is one of:
      "build_arg"   — NLLB_GIT_COMMIT_DATE env var baked at docker build time
      "git_commit"  — live git query, worktree clean for this file
      "file_mtime"  — dirty worktree, no git, or Docker without build arg
      "unknown"     — all methods failed

    Priority:
      1. NLLB_GIT_COMMIT_DATE env var (Docker CI builds)
      2. git log (dev machine, clean worktree)
      3. File mtime (dev dirty / Docker fallback)
    """
    import os as _os
    import subprocess
    from datetime import datetime, timezone

    # 1. Build-time baked env var (Docker)
    baked = _os.environ.get("NLLB_GIT_COMMIT_DATE", "").strip()
    if baked:
        try:
            dt = datetime.fromisoformat(baked).astimezone(timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "build_arg"
        except ValueError:
            return baked, "build_arg"  # pass through if not parseable

    # 2. Live git query (dev machine)
    try:
        this_file = _os.path.abspath(__file__)
        this_dir = _os.path.dirname(this_file)
        status = subprocess.run(
            ["git", "status", "--porcelain", "--", this_file],
            capture_output=True, text=True, timeout=5, cwd=this_dir,
        )
        if status.returncode == 0 and status.stdout.strip() == "":
            log = subprocess.run(
                ["git", "log", "-1", "--format=%aI", "--", this_file],
                capture_output=True, text=True, timeout=5, cwd=this_dir,
            )
            if log.returncode == 0 and log.stdout.strip():
                # Normalize to UTC — git %aI uses author's local tz
                dt = datetime.fromisoformat(log.stdout.strip()).astimezone(timezone.utc)
                return dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "git_commit"
    except (OSError, subprocess.TimeoutExpired):
        pass

    # 3. File mtime fallback
    try:
        mtime = _os.path.getmtime(__file__)
        ts = datetime.fromtimestamp(mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return ts, "file_mtime"
    except OSError:
        return "unknown", "unknown"


_SERVER_VERSION_AT, _SERVER_VERSION_SOURCE = _derive_version_at()

import collections
import gc
import hashlib
import hmac
import json
import os
import logging
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Optional

import torch
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel
import uvicorn

class _UsecFormatter(logging.Formatter):
    """ISO 8601 timestamps with microsecond precision."""
    def formatTime(self, record, datefmt=None):
        from datetime import datetime, timezone
        dt = datetime.fromtimestamp(record.created, tz=timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")

logging.basicConfig(
    level=logging.INFO,
    handlers=[logging.StreamHandler()],
)
logging.root.handlers[0].setFormatter(
    _UsecFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
)
logger = logging.getLogger(__name__)


# ── Resource Monitor ─────────────────────────────────────────────────
#
# Background daemon thread that polls VRAM, RAM, and swap usage.
# Two-stage pressure detection: soft limit arms corrective action,
# hard limit fires it.  Swap > 0 is always a hard abort.
#
# Integration:
#   - Benchmark loop checks pressure_event between combos/sentences
#   - /translate does model stepdown on pressure after inference
#   - /health exposes current resource snapshot
#   - Periodic logging at configurable interval


class PressureLevel(Enum):
    OK = "ok"
    WARN = "warn"
    VRAM_FULL = "vram_full"  # VRAM exhausted — noisy but tolerated (spills to RAM)
    CRITICAL = "critical"    # RAM or swap breach — absolute kill line


@dataclass
class LoadContext:
    """Describes an in-progress model load so the monitor can predict survival.

    Set via monitor.set_load_context() before from_pretrained(), cleared after.
    The monitor uses estimated_total_mb to compute:
      - progress_pct: consumed_so_far / estimated_total * 100
      - remaining_mb: estimated_total - consumed_so_far
      - will_ram_survive: whether RAM will hold until the load completes
    """
    model_id: str
    precision: str
    device: str
    estimated_total_mb: int     # from _mem_mb()
    vram_baseline_mb: int = 0   # VRAM allocated before load started
    ram_baseline_mb: int = 0    # RAM used (total - available) before load started
    started_at: float = 0.0     # time.time() when load began


@dataclass
class SubsystemVelocity:
    """Tracks fill rate for one memory subsystem via EWMA."""
    name: str
    alpha: float = 0.3
    _prev_free_mb: Optional[int] = field(default=None, repr=False)
    _prev_time: Optional[float] = field(default=None, repr=False)
    _ewma_delta_per_s: float = field(default=0.0, repr=False)

    def update(self, free_mb: int, now: float) -> None:
        if self._prev_free_mb is not None and self._prev_time is not None:
            dt = now - self._prev_time
            if dt > 0:
                delta_per_s = (free_mb - self._prev_free_mb) / dt
                self._ewma_delta_per_s = (
                    self.alpha * delta_per_s + (1 - self.alpha) * self._ewma_delta_per_s
                )
        self._prev_free_mb = free_mb
        self._prev_time = now

    @property
    def fill_rate_mb_s(self) -> float:
        """MB/s being consumed (positive = filling)."""
        return -self._ewma_delta_per_s

    def time_to_full_s(self, current_free_mb: int) -> Optional[float]:
        """Seconds until 0 free at current velocity. None if stable/freeing.

        Returns None when drain rate is negligible (< 0.1 MB/s) to avoid
        displaying absurd TTF values at steady state where EWMA asymptotically
        approaches zero but never reaches it.
        """
        if self._ewma_delta_per_s >= -0.1:
            return None  # stable, freeing, or negligible drain
        return current_free_mb / (-self._ewma_delta_per_s)


@dataclass(frozen=True)
class ResourceSnapshot:
    timestamp: float
    vram_allocated_mb: int
    vram_reserved_mb: int
    vram_total_mb: int
    vram_free_mb: int
    vram_fill_rate_mb_s: float
    vram_ttf_s: Optional[float]
    ram_rss_mb: int
    ram_available_mb: int
    ram_total_mb: int
    ram_fill_rate_mb_s: float
    ram_ttf_s: Optional[float]
    swap_used_mb: int
    swap_total_mb: int
    swap_fill_rate_mb_s: float
    swap_ttf_s: Optional[float]
    process_swap_mb: int

    @property
    def vram_pct(self) -> float:
        if self.vram_total_mb == 0:
            return 0.0
        return self.vram_allocated_mb / self.vram_total_mb * 100

    @property
    def ram_pct(self) -> float:
        if self.ram_total_mb == 0:
            return 0.0
        return (self.ram_total_mb - self.ram_available_mb) / self.ram_total_mb * 100

    def to_log_str(self) -> str:
        parts = []
        if self.vram_total_mb > 0:
            ttf = f", TTF={self.vram_ttf_s:.1f}s" if self.vram_ttf_s is not None else ""
            parts.append(
                f"VRAM {self.vram_allocated_mb}/{self.vram_total_mb} MB "
                f"({self.vram_free_mb} free, {self.vram_fill_rate_mb_s:+.0f} MB/s{ttf})"
            )
        ttf = f", TTF={self.ram_ttf_s:.1f}s" if self.ram_ttf_s is not None else ""
        parts.append(
            f"RAM avail {self.ram_available_mb}/{self.ram_total_mb} MB "
            f"({self.ram_fill_rate_mb_s:+.0f} MB/s{ttf})"
        )
        parts.append(f"Swap {self.swap_used_mb} MB")
        if self.process_swap_mb > 0:
            parts.append(f"VmSwap {self.process_swap_mb} MB")
        return " | ".join(parts)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class TimelineEvent:
    t_epoch: float
    event: str  # "ARMED" | "CRITICAL" | "DISARMED" | "stepdown"
    trigger: str
    snapshot: ResourceSnapshot
    extra: Optional[dict] = None

    def to_dict(self) -> dict:
        d: dict = {
            "t_epoch": self.t_epoch,
            "event": self.event,
            "trigger": self.trigger,
            "snapshot": self.snapshot.to_dict(),
        }
        if self.extra:
            d["extra"] = self.extra
        return d

    def to_relative_dict(self, ref_epoch: float) -> dict:
        """Dict with t_ms relative to a reference epoch (the critical event)."""
        d: dict = {
            "t_ms": round((self.t_epoch - ref_epoch) * 1000),
            "event": self.event,
            "trigger": self.trigger,
        }
        if self.extra:
            d.update(self.extra)
        return d


def _parse_proc_meminfo() -> dict[str, int]:
    """Parse /proc/meminfo, return values in MB."""
    result: dict[str, int] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    key = parts[0].rstrip(":")
                    val_kb = int(parts[1])
                    result[key] = val_kb // 1024  # kB → MB
    except OSError:
        pass
    return result


def _parse_proc_self_status() -> dict[str, int]:
    """Parse /proc/self/status for VmRSS and VmSwap in MB."""
    result: dict[str, int] = {"VmRSS": 0, "VmSwap": 0}
    try:
        with open("/proc/self/status") as f:
            for line in f:
                for key in ("VmRSS", "VmSwap"):
                    if line.startswith(key + ":"):
                        result[key] = int(line.split()[1]) // 1024  # kB → MB
    except OSError:
        pass
    return result


# Stepdown chain: current model → next smaller model on same device
STEPDOWN_CHAIN: dict[str, Optional[str]] = {
    "facebook/nllb-200-3.3B": "facebook/nllb-200-distilled-1.3B",
    "facebook/nllb-200-distilled-1.3B": "facebook/nllb-200-distilled-600M",
    "facebook/nllb-200-distilled-600M": None,
}


class ResourceMonitor:
    """Daemon thread that polls system resources and detects memory pressure.

    State machine:
      NORMAL (5s poll) → free < soft → ARMED (250ms poll)
      ARMED → free < hard or swap_delta > threshold → CRITICAL (fire corrective action)
      ARMED → free > soft → NORMAL (disarm)
      CRITICAL → after corrective action → NORMAL
    """

    def __init__(
        self,
        vram_soft_mb: int = 2000,
        vram_hard_mb: int = 500,
        ram_soft_mb: int = 4000,
        ram_hard_mb: int = 1000,
        swap_hard_mb: int = 0,
        normal_interval_s: float = 5.0,
        fast_interval_s: float = 0.25,
        log_interval_s: float = 30.0,
    ):
        self.vram_soft_mb = vram_soft_mb
        self.vram_hard_mb = vram_hard_mb
        self.ram_soft_mb = ram_soft_mb
        self.ram_hard_mb = ram_hard_mb
        self.swap_hard_mb = swap_hard_mb
        self.normal_interval_s = normal_interval_s
        self.fast_interval_s = fast_interval_s
        self.log_interval_s = log_interval_s

        self.pressure_event = threading.Event()
        self.pressure_reason: str = ""
        self.pressure_snapshot: Optional[ResourceSnapshot] = None
        self.state = PressureLevel.OK
        self.stepdown_active = False
        self.stepped_down_from: Optional[str] = None
        self.stepped_down_to: Optional[str] = None

        # Load-awareness: set during model loads for predictive abort
        self._load_context: Optional[LoadContext] = None
        self._load_context_lock = threading.Lock()

        self._vram_velocity = SubsystemVelocity(name="vram")
        self._ram_velocity = SubsystemVelocity(name="ram")
        self._swap_velocity = SubsystemVelocity(name="swap")

        self._timeline: collections.deque[TimelineEvent] = collections.deque(maxlen=32)
        self._last_snapshot: Optional[ResourceSnapshot] = None
        self._stop_event = threading.Event()
        self._last_log_time: float = 0.0
        self._has_cuda = torch.cuda.is_available()
        self._vram_total_mb = (
            torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)
            if self._has_cuda else 0
        )
        # Capture ambient swap at startup so threshold compares delta, not absolute.
        # WSL2/some kernels always have a few MB of background swap that isn't pressure.
        meminfo = _parse_proc_meminfo()
        self._swap_baseline_mb = meminfo.get("SwapTotal", 0) - meminfo.get("SwapFree", 0)
        self._thread: Optional[threading.Thread] = None
        self._logger = logging.getLogger("nllb.monitor")

    def start(self) -> None:
        self._thread = threading.Thread(target=self._poll_loop, daemon=True, name="resource-monitor")
        self._thread.start()
        self._logger.info(
            f"Resource monitor started: VRAM soft={self.vram_soft_mb} hard={self.vram_hard_mb} MB, "
            f"RAM soft={self.ram_soft_mb} hard={self.ram_hard_mb} MB, "
            f"swap hard={self.swap_hard_mb} MB (baseline={self._swap_baseline_mb} MB), "
            f"normal={self.normal_interval_s}s fast={self.fast_interval_s}s"
        )

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2.0)

    def snapshot(self) -> ResourceSnapshot:
        """Take a resource snapshot right now (callable from any thread)."""
        now = time.time()

        if self._has_cuda:
            vram_alloc = torch.cuda.memory_allocated() // (1024 * 1024)
            vram_reserved = torch.cuda.memory_reserved() // (1024 * 1024)
        else:
            vram_alloc = 0
            vram_reserved = 0
        vram_free = self._vram_total_mb - vram_alloc

        meminfo = _parse_proc_meminfo()
        ram_total = meminfo.get("MemTotal", 0)
        ram_available = meminfo.get("MemAvailable", 0)
        swap_total = meminfo.get("SwapTotal", 0)
        swap_free = meminfo.get("SwapFree", 0)
        swap_used = swap_total - swap_free

        proc = _parse_proc_self_status()
        rss = proc["VmRSS"]
        process_swap = proc["VmSwap"]

        # Update velocity trackers
        self._vram_velocity.update(vram_free, now)
        self._ram_velocity.update(ram_available, now)
        swap_free_for_velocity = swap_total - swap_used
        self._swap_velocity.update(swap_free_for_velocity, now)

        snap = ResourceSnapshot(
            timestamp=now,
            vram_allocated_mb=vram_alloc,
            vram_reserved_mb=vram_reserved,
            vram_total_mb=self._vram_total_mb,
            vram_free_mb=vram_free,
            vram_fill_rate_mb_s=round(self._vram_velocity.fill_rate_mb_s, 1),
            vram_ttf_s=(
                round(self._vram_velocity.time_to_full_s(vram_free), 1)
                if self._vram_velocity.time_to_full_s(vram_free) is not None else None
            ),
            ram_rss_mb=rss,
            ram_available_mb=ram_available,
            ram_total_mb=ram_total,
            ram_fill_rate_mb_s=round(self._ram_velocity.fill_rate_mb_s, 1),
            ram_ttf_s=(
                round(self._ram_velocity.time_to_full_s(ram_available), 1)
                if self._ram_velocity.time_to_full_s(ram_available) is not None else None
            ),
            swap_used_mb=swap_used,
            swap_total_mb=swap_total,
            swap_fill_rate_mb_s=round(self._swap_velocity.fill_rate_mb_s, 1),
            swap_ttf_s=(
                round(self._swap_velocity.time_to_full_s(swap_free_for_velocity), 1)
                if self._swap_velocity.time_to_full_s(swap_free_for_velocity) is not None else None
            ),
            process_swap_mb=process_swap,
        )
        self._last_snapshot = snap
        return snap

    def get_timeline_relative(self, ref_epoch: Optional[float] = None) -> list[dict]:
        """Return timeline events with timestamps relative to ref_epoch (or last critical)."""
        if ref_epoch is None and self.pressure_snapshot:
            ref_epoch = self.pressure_snapshot.timestamp
        if ref_epoch is None:
            ref_epoch = time.time()
        return [evt.to_relative_dict(ref_epoch) for evt in self._timeline]

    @property
    def last_snapshot(self) -> Optional[ResourceSnapshot]:
        return self._last_snapshot

    def clear_pressure(self) -> None:
        """Reset pressure state after corrective action has been taken."""
        self.pressure_event.clear()
        self.pressure_reason = ""
        self.pressure_snapshot = None
        self.state = PressureLevel.OK

    def set_load_context(self, model_id: str, precision: str, device: str,
                         estimated_total_mb: int) -> None:
        """Inform the monitor that a model load is starting.

        Call this before from_pretrained(). The monitor will use it to:
        - Estimate load progress (consumed / estimated_total)
        - Predict whether RAM will survive the load completing
        """
        snap = self.snapshot()
        with self._load_context_lock:
            self._load_context = LoadContext(
                model_id=model_id,
                precision=precision,
                device=device,
                estimated_total_mb=estimated_total_mb,
                vram_baseline_mb=snap.vram_allocated_mb,
                ram_baseline_mb=snap.ram_total_mb - snap.ram_available_mb,
                started_at=time.time(),
            )
        self._logger.info(
            f"Load context set: {model_id} {precision} {device}, "
            f"est. {estimated_total_mb} MB, "
            f"baselines: VRAM={snap.vram_allocated_mb} MB, "
            f"RAM used={snap.ram_total_mb - snap.ram_available_mb} MB"
        )

    def clear_load_context(self) -> None:
        """Clear the load context after from_pretrained() completes or fails."""
        with self._load_context_lock:
            self._load_context = None

    def get_load_progress(self, snap: ResourceSnapshot) -> Optional[dict]:
        """Compute load progress and survival prediction from current snapshot.

        Returns None if no load is in progress. Otherwise:
        {
            "model_id": str,
            "estimated_total_mb": int,
            "consumed_mb": int,        # VRAM + RAM delta since baseline
            "progress_pct": float,     # 0-100 (can exceed 100 if estimate was low)
            "remaining_mb": int,       # estimated remaining to load
            "ram_available_mb": int,   # current RAM headroom
            "ram_after_load_mb": int,  # predicted RAM available after load completes
            "will_ram_survive": bool,  # ram_after_load > ram_hard_mb
            "load_elapsed_s": float,
        }
        """
        with self._load_context_lock:
            ctx = self._load_context
        if ctx is None:
            return None

        # How much memory has been consumed since load started?
        vram_delta = max(0, snap.vram_allocated_mb - ctx.vram_baseline_mb)
        ram_used_now = snap.ram_total_mb - snap.ram_available_mb
        ram_delta = max(0, ram_used_now - ctx.ram_baseline_mb)
        consumed = vram_delta + ram_delta

        progress_pct = min(consumed / ctx.estimated_total_mb * 100, 100.0) if ctx.estimated_total_mb > 0 else 0.0
        remaining = max(0, ctx.estimated_total_mb - consumed)

        # Key question: if the remaining load spills entirely to RAM
        # (worst case — VRAM is already full), will RAM survive?
        # "Remaining to load" that can't fit in VRAM goes to RAM.
        vram_free = snap.vram_free_mb
        remaining_to_ram = max(0, remaining - vram_free)
        ram_after_load = snap.ram_available_mb - remaining_to_ram

        return {
            "model_id": ctx.model_id,
            "estimated_total_mb": ctx.estimated_total_mb,
            "consumed_mb": consumed,
            "progress_pct": round(progress_pct, 1),
            "remaining_mb": remaining,
            "ram_available_mb": snap.ram_available_mb,
            "ram_after_load_mb": ram_after_load,
            "will_ram_survive": ram_after_load > self.ram_hard_mb,
            "load_elapsed_s": round(snap.timestamp - ctx.started_at, 1),
        }

    def _add_timeline(self, event: str, trigger: str, snap: ResourceSnapshot,
                      extra: Optional[dict] = None) -> None:
        self._timeline.append(TimelineEvent(
            t_epoch=snap.timestamp, event=event, trigger=trigger,
            snapshot=snap, extra=extra,
        ))

    def _check_arm_conditions(self, snap: ResourceSnapshot) -> Optional[str]:
        """Return arm reason if any soft limit or predictive trigger is breached."""
        reasons = []
        if self._vram_total_mb > 0 and snap.vram_free_mb < self.vram_soft_mb:
            reasons.append(f"vram_free={snap.vram_free_mb} < soft={self.vram_soft_mb}")
        if snap.ram_available_mb < self.ram_soft_mb:
            reasons.append(f"ram_available={snap.ram_available_mb} < soft={self.ram_soft_mb}")
        # Predictive: TTF triggers
        if snap.vram_ttf_s is not None and snap.vram_ttf_s < 10.0:
            reasons.append(f"vram_ttf={snap.vram_ttf_s:.1f}s < 10s")
        if snap.ram_ttf_s is not None and snap.ram_ttf_s < 30.0:
            reasons.append(f"ram_ttf={snap.ram_ttf_s:.1f}s < 30s")
        # Load-aware prediction: if an active load will exhaust RAM, arm now
        load_progress = self.get_load_progress(snap)
        if load_progress and not load_progress["will_ram_survive"]:
            reasons.append(
                f"load_predict: {load_progress['model_id'].split('/')[-1]} "
                f"{load_progress['progress_pct']:.0f}% loaded, "
                f"remaining={load_progress['remaining_mb']} MB, "
                f"ram_after_load={load_progress['ram_after_load_mb']} MB < "
                f"hard={self.ram_hard_mb}"
            )
        return ", ".join(reasons) if reasons else None

    def _check_vram_hard(self, snap: ResourceSnapshot) -> Optional[str]:
        """Return reason if VRAM hard limit is breached.

        VRAM exhaustion is tolerated (spills to RAM via unified memory).
        We complain loudly but do NOT fire corrective action — only RAM/swap
        breaches are kill-worthy.
        """
        if self._vram_total_mb > 0 and snap.vram_free_mb < self.vram_hard_mb:
            return f"vram_free={snap.vram_free_mb} < hard={self.vram_hard_mb}"
        return None

    def _check_hard_conditions(self, snap: ResourceSnapshot) -> Optional[str]:
        """Return critical reason if RAM or swap hard limit is breached.

        VRAM is intentionally excluded — VRAM overflow is noisy but survivable
        because it spills to system RAM. The real kill line is RAM exhaustion
        (which cascades to swap → page thrashing → unrecoverable).
        """
        reasons = []
        if snap.ram_available_mb < self.ram_hard_mb:
            reasons.append(f"ram_available={snap.ram_available_mb} < hard={self.ram_hard_mb}")
        swap_delta = max(0, snap.swap_used_mb - self._swap_baseline_mb)
        if swap_delta > self.swap_hard_mb:
            reasons.append(f"swap_delta={swap_delta} (used={snap.swap_used_mb}, baseline={self._swap_baseline_mb}) > hard={self.swap_hard_mb}")
        if snap.process_swap_mb > 0:
            reasons.append(f"process_vmswap={snap.process_swap_mb} > 0")
        # Load-aware kill: if we're mid-load and RAM WILL die before load finishes
        load_progress = self.get_load_progress(snap)
        if load_progress and not load_progress["will_ram_survive"]:
            # Only escalate to hard if we're already armed AND the prediction
            # shows RAM after load below hard limit
            if snap.ram_available_mb < self.ram_soft_mb:
                reasons.append(
                    f"load_will_exhaust_ram: "
                    f"{load_progress['progress_pct']:.0f}% loaded, "
                    f"ram_after_load={load_progress['ram_after_load_mb']} MB"
                )
        return ", ".join(reasons) if reasons else None

    def _poll_loop(self) -> None:
        """Main polling loop running in daemon thread.

        State machine:
          OK (5s)     → soft breach / predictive → ARMED (250ms)
          ARMED       → VRAM hard only          → VRAM_FULL (250ms, noisy but no kill)
          ARMED       → RAM/swap hard            → CRITICAL (kill line)
          ARMED       → all clear                → OK
          VRAM_FULL   → RAM/swap hard            → CRITICAL
          VRAM_FULL   → VRAM recovers            → ARMED or OK
          CRITICAL    → cleared by caller        → OK
        """
        while not self._stop_event.is_set():
            snap = self.snapshot()
            now = snap.timestamp

            # Periodic logging (always, regardless of state)
            if now - self._last_log_time >= self.log_interval_s:
                self._last_log_time = now
                state_label = self.state.value.upper()
                load_info = ""
                load_progress = self.get_load_progress(snap)
                if load_progress:
                    load_info = (
                        f" | Load: {load_progress['model_id'].split('/')[-1]} "
                        f"{load_progress['progress_pct']:.0f}% "
                        f"({load_progress['consumed_mb']}/{load_progress['estimated_total_mb']} MB, "
                        f"{load_progress['load_elapsed_s']}s) "
                        f"RAM-after-load={load_progress['ram_after_load_mb']} MB "
                        f"{'OK' if load_progress['will_ram_survive'] else 'WILL EXHAUST RAM'}"
                    )
                self._logger.info(f"Resources: {snap.to_log_str()} | State: {state_label}{load_info}")

            # ── Check VRAM hard (noisy but tolerated) in all armed+ states ──
            vram_hard_reason = self._check_vram_hard(snap)

            if self.state == PressureLevel.OK:
                arm_reason = self._check_arm_conditions(snap)
                if arm_reason:
                    self.state = PressureLevel.WARN
                    self._add_timeline("ARMED", arm_reason, snap)
                    self._logger.warning(
                        f"\u26a0 ARMED: {snap.to_log_str()} | Trigger: {arm_reason} | Polling {self.fast_interval_s}s"
                    )
                interval = self.normal_interval_s

            elif self.state == PressureLevel.WARN:
                # RAM/swap hard check first — this is the kill line
                hard_reason = self._check_hard_conditions(snap)
                if hard_reason:
                    self.state = PressureLevel.CRITICAL
                    self.pressure_event.set()
                    self.pressure_reason = hard_reason
                    self.pressure_snapshot = snap
                    self._add_timeline("CRITICAL", hard_reason, snap)
                    self._logger.critical(
                        f"\u26d4 CRITICAL (RAM/swap kill line): {snap.to_log_str()} | Trigger: {hard_reason}"
                    )
                    interval = self.fast_interval_s
                elif vram_hard_reason:
                    # VRAM exhausted — complain loudly but don't kill
                    if self.state != PressureLevel.VRAM_FULL:
                        self.state = PressureLevel.VRAM_FULL
                        self._add_timeline("VRAM_FULL", vram_hard_reason, snap)
                    self._logger.warning(
                        f"\u26a0\u26a0 VRAM FULL (tolerated — watching RAM): {snap.to_log_str()} | "
                        f"{vram_hard_reason} | RAM avail={snap.ram_available_mb} MB (hard={self.ram_hard_mb})"
                    )
                    interval = self.fast_interval_s
                else:
                    # Check if we can disarm
                    arm_reason = self._check_arm_conditions(snap)
                    if not arm_reason:
                        self.state = PressureLevel.OK
                        self._add_timeline("DISARMED", "all metrics above soft limits", snap)
                        self._logger.info(
                            f"\u2713 Disarmed: {snap.to_log_str()} | State: NORMAL"
                        )
                    interval = self.fast_interval_s

            elif self.state == PressureLevel.VRAM_FULL:
                # VRAM is full — tolerated. But if RAM/swap breaches, kill.
                hard_reason = self._check_hard_conditions(snap)
                if hard_reason:
                    self.state = PressureLevel.CRITICAL
                    self.pressure_event.set()
                    self.pressure_reason = hard_reason
                    self.pressure_snapshot = snap
                    self._add_timeline("CRITICAL", f"RAM/swap breached while VRAM full: {hard_reason}", snap)
                    self._logger.critical(
                        f"\u26d4 CRITICAL (VRAM was full, now RAM dying): {snap.to_log_str()} | {hard_reason}"
                    )
                elif not vram_hard_reason:
                    # VRAM recovered (model unloaded / GC freed memory)
                    arm_reason = self._check_arm_conditions(snap)
                    if arm_reason:
                        self.state = PressureLevel.WARN
                        self._add_timeline("VRAM_RECOVERED", "VRAM freed, still armed", snap)
                        self._logger.info(f"VRAM recovered, still armed: {snap.to_log_str()}")
                    else:
                        self.state = PressureLevel.OK
                        self._add_timeline("DISARMED", "VRAM recovered, all clear", snap)
                        self._logger.info(f"\u2713 Disarmed (VRAM recovered): {snap.to_log_str()}")
                interval = self.fast_interval_s

            else:
                # CRITICAL — keep fast-polling until corrective action clears it
                hard_reason = self._check_hard_conditions(snap)
                if hard_reason:
                    self.pressure_reason = hard_reason
                    self.pressure_snapshot = snap
                interval = self.fast_interval_s

            self._stop_event.wait(interval)


def _create_resource_monitor() -> ResourceMonitor:
    """Create ResourceMonitor from environment variables."""
    return ResourceMonitor(
        vram_soft_mb=int(os.environ.get("NLLB_VRAM_SOFT_MB", "2000")),
        vram_hard_mb=int(os.environ.get("NLLB_VRAM_HARD_MB", "500")),
        ram_soft_mb=int(os.environ.get("NLLB_RAM_SOFT_MB", "4000")),
        ram_hard_mb=int(os.environ.get("NLLB_RAM_HARD_MB", "1000")),
        swap_hard_mb=int(os.environ.get("NLLB_SWAP_HARD_MB", "0")),
        normal_interval_s=float(os.environ.get("NLLB_MONITOR_INTERVAL_S", "5.0")),
        fast_interval_s=float(os.environ.get("NLLB_MONITOR_FAST_INTERVAL_S", "0.25")),
        log_interval_s=float(os.environ.get("NLLB_MONITOR_LOG_INTERVAL_S", "30.0")),
    )


# Global monitor instance (started in lifespan)
resource_monitor: Optional[ResourceMonitor] = None


# ── Pressure Failure Cache ───────────────────────────────────────────
#
# Persists (model, precision, device, hw_fingerprint) combos that
# triggered memory pressure. On subsequent attempts:
#   - Auto-selected combos: silently skipped
#   - Force-requested (NLLB_PARAMS / MODEL_NAME): loaded anyway with
#     a STRONG WARNING in logs and response
#
# Written to a mounted volume so it survives container restarts.
# Hardware fingerprint (GPU name, VRAM, RAM) ensures the cache
# auto-invalidates when moved to different hardware.


class PressureFailureCache:
    """Persistent cache of model combos that caused memory pressure.

    Cache file format (JSON):
    {
        "version": 1,
        "hw_fingerprint": "<gpu_name>:<vram_total_mb>:<ram_total_mb>",
        "failures": [
            {
                "model_id": "facebook/nllb-200-3.3B",
                "precision": "bf16",
                "device": "cuda",
                "recorded_at": "2026-01-30T12:00:00Z",
                "reason": "vram_free=487 < hard=500",
                "snapshot": { ... }
            }
        ]
    }
    """

    def __init__(self, cache_path: str, hw_fingerprint: str):
        self._path = Path(cache_path)
        self._hw_fingerprint = hw_fingerprint
        self._failures: list[dict] = []
        self._lock = threading.Lock()
        self._logger = logging.getLogger("nllb.pressure_cache")
        self._load()

    @staticmethod
    def build_hw_fingerprint() -> str:
        """Build a hardware identity string from current GPU + RAM."""
        parts = []
        if torch.cuda.is_available():
            parts.append(torch.cuda.get_device_name(0))
            parts.append(str(torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)))
        else:
            parts.append("no-gpu")
            parts.append("0")
        # System RAM
        try:
            ram_mb = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") // (1024 * 1024)
        except (ValueError, OSError):
            ram_mb = 0
        parts.append(str(ram_mb))
        return ":".join(parts)

    def _load(self) -> None:
        """Load cache from disk. Discard if hw_fingerprint doesn't match."""
        if not self._path.exists():
            self._logger.info(f"Pressure cache: no file at {self._path}")
            return
        try:
            data = json.loads(self._path.read_text())
            if data.get("version") != 1:
                self._logger.warning("Pressure cache: unknown version, ignoring")
                return
            if data.get("hw_fingerprint") != self._hw_fingerprint:
                self._logger.info(
                    f"Pressure cache: hw fingerprint mismatch "
                    f"(cached={data.get('hw_fingerprint')}, "
                    f"current={self._hw_fingerprint}) — discarding stale cache"
                )
                return
            self._failures = data.get("failures", [])
            self._logger.info(
                f"Pressure cache: loaded {len(self._failures)} failure(s) from {self._path}"
            )
        except (json.JSONDecodeError, OSError) as e:
            self._logger.warning(f"Pressure cache: failed to load ({e}), starting fresh")

    def _save(self) -> None:
        """Persist cache to disk. Silently skips if path isn't writable."""
        data = {
            "version": 1,
            "hw_fingerprint": self._hw_fingerprint,
            "failures": self._failures,
        }
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(data, indent=2))
        except OSError as e:
            self._logger.warning(f"Pressure cache: failed to write ({e})")

    def record_failure(
        self,
        model_id: str,
        precision: str,
        device: str,
        reason: str,
        snapshot: Optional[dict] = None,
    ) -> None:
        """Record a pressure failure for a combo."""
        from datetime import datetime, timezone
        with self._lock:
            # Deduplicate: don't re-record same combo
            for f in self._failures:
                if (f["model_id"] == model_id
                        and f["precision"] == precision
                        and f["device"] == device):
                    # Update timestamp and reason
                    f["recorded_at"] = datetime.now(timezone.utc).isoformat()
                    f["reason"] = reason
                    f["snapshot"] = snapshot
                    self._save()
                    return
            self._failures.append({
                "model_id": model_id,
                "precision": precision,
                "device": device,
                "recorded_at": datetime.now(timezone.utc).isoformat(),
                "reason": reason,
                "snapshot": snapshot,
            })
            self._logger.warning(
                f"Pressure cache: recorded failure for {model_id} {precision} {device} — {reason}"
            )
            self._save()

    def is_known_failure(self, model_id: str, precision: str, device: str) -> Optional[dict]:
        """Check if a combo is a known failure. Returns the failure record or None."""
        with self._lock:
            for f in self._failures:
                if (f["model_id"] == model_id
                        and f["precision"] == precision
                        and f["device"] == device):
                    return f
            return None

    def known_failure_count(self) -> int:
        with self._lock:
            return len(self._failures)


def _create_pressure_cache() -> PressureFailureCache:
    """Create PressureFailureCache from environment variables."""
    cache_path = os.environ.get(
        "NLLB_PRESSURE_CACHE_PATH", "/data/pressure-cache.json"
    )
    hw_fp = PressureFailureCache.build_hw_fingerprint()
    return PressureFailureCache(cache_path, hw_fp)


# Global cache instance (initialized early, before model selection)
pressure_cache: Optional[PressureFailureCache] = None


def _load_api_key() -> str:
    """Read API key from env var, falling back to mounted secrets file."""
    key = os.environ.get("NLLB_API_KEY", "").strip()
    if key:
        return key
    secrets_path = "/run/secrets/nllb-api-key"
    if os.path.isfile(secrets_path):
        with open(secrets_path) as f:
            return f.read().strip()
    return ""


NLLB_API_KEY = _load_api_key()
CLOCK_SKEW_WINDOW = 30  # seconds

# Lazy-loaded globals (set during startup)
tokenizer = None
model = None

# ── TLS cert generation ──────────────────────────────────────────────

TLS_DIR = "/tmp/tls"
TLS_CERT = os.path.join(TLS_DIR, "cert.pem")
TLS_KEY = os.path.join(TLS_DIR, "key.pem")


def generate_self_signed_cert():
    """Generate a self-signed TLS certificate using the cryptography library."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime

    os.makedirs(TLS_DIR, exist_ok=True)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "nllb-translation-server"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "HypeShelf-Dev"),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(
            datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(days=365)
        )
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(
                    __import__("ipaddress").IPv4Address("127.0.0.1")
                ),
            ]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )

    with open(TLS_KEY, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))

    with open(TLS_CERT, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    # Log cert fingerprint for verification
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    logger.info(f"TLS cert fingerprint (SHA-256): {fingerprint}")


# ── HMAC auth ────────────────────────────────────────────────────────


def verify_hmac_auth(request: Request):
    """
    FastAPI dependency that validates HMAC-SHA256 bearer tokens.
    Header format: Authorization: Bearer HMAC-SHA256:<unix_ts>:<hex_signature>
    """
    if not NLLB_API_KEY:
        # No key configured — skip auth (development convenience)
        return

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer HMAC-SHA256:"):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    try:
        # "Bearer HMAC-SHA256:<timestamp>:<signature>"
        token_part = auth_header[len("Bearer "):]
        parts = token_part.split(":")
        if len(parts) != 3:
            raise ValueError("malformed token")
        _, timestamp_str, client_sig = parts
        timestamp = int(timestamp_str)
    except (ValueError, IndexError):
        raise HTTPException(status_code=401, detail="Malformed HMAC token")

    # Check clock skew
    now = int(time.time())
    if abs(now - timestamp) > CLOCK_SKEW_WINDOW:
        raise HTTPException(status_code=401, detail="Token expired (clock skew)")

    # Recompute and compare
    expected = hmac.new(
        NLLB_API_KEY.encode(),
        timestamp_str.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, client_sig):
        raise HTTPException(status_code=401, detail="Invalid HMAC signature")


def _try_hmac_auth(request: Request) -> bool:
    """Non-raising HMAC auth check. Returns True if valid auth present, False otherwise.

    Used by /health to gate detailed vs. minimal responses. Never raises —
    missing/invalid auth silently returns False.
    """
    if not NLLB_API_KEY:
        # No key configured — treat as authenticated (dev mode)
        return True

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer HMAC-SHA256:"):
        return False

    try:
        token_part = auth_header[len("Bearer "):]
        parts = token_part.split(":")
        if len(parts) != 3:
            return False
        _, timestamp_str, client_sig = parts
        timestamp = int(timestamp_str)
    except (ValueError, IndexError):
        return False

    now = int(time.time())
    if abs(now - timestamp) > CLOCK_SKEW_WINDOW:
        return False

    expected = hmac.new(
        NLLB_API_KEY.encode(),
        timestamp_str.encode(),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, client_sig)


# ── Hardware detection ───────────────────────────────────────────────


startup_status = {"phase": "initializing", "detail": "", "started_at": time.time()}


def _detect_cpu_features() -> dict[str, bool]:
    """Parse /proc/cpuinfo for AVX2/AVX-512/AVX512BF16 (Linux only)."""
    features = {"avx2": False, "avx512": False, "avx512bf16": False}
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("flags"):
                    upper = line.upper()
                    features["avx2"] = "AVX2" in upper
                    features["avx512"] = "AVX512" in upper
                    features["avx512bf16"] = "AVX512_BF16" in upper
                    break
    except OSError:
        pass
    return features


CPU_FEATURES = _detect_cpu_features()


def _detect_device() -> str:
    """Pick the best available accelerator.

    Honors NLLB_DEVICE env var to force cpu or gpu.
    PyTorch's torch.cuda covers both NVIDIA and AMD ROCm (via HIP).
    """
    device_override = os.environ.get("NLLB_DEVICE", "").strip().lower()
    if device_override == "cpu":
        feats = [k for k, v in CPU_FEATURES.items() if v]
        logger.info(f"NLLB_DEVICE=cpu — forcing CPU mode (features: {', '.join(feats) or 'none'})")
        return "cpu"
    if device_override == "gpu":
        if torch.cuda.is_available():
            logger.info("NLLB_DEVICE=gpu — forcing CUDA")
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            logger.info("NLLB_DEVICE=gpu — forcing Apple MPS")
            return "mps"
        if hasattr(torch, "xpu") and torch.xpu.is_available():
            logger.info("NLLB_DEVICE=gpu — forcing Intel XPU")
            return "xpu"
        logger.warning("NLLB_DEVICE=gpu but no accelerator available — falling back to CPU")
        return "cpu"

    if torch.cuda.is_available():
        name = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)
        logger.info(f"CUDA GPU detected: {name} ({vram} MB VRAM)")
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        logger.info("Apple Metal (MPS) detected")
        return "mps"
    if hasattr(torch, "xpu") and torch.xpu.is_available():
        logger.info("Intel XPU detected")
        return "xpu"
    feats = [k for k, v in CPU_FEATURES.items() if v]
    logger.info(f"No GPU detected — using CPU (features: {', '.join(feats) or 'none'})")
    return "cpu"


DEVICE = _detect_device()


# ── Model + precision selection ──────────────────────────────────────
#
# The server is the authority for model + precision selection. It uses
# canonical PyTorch APIs (torch.cuda.is_bf16_supported(), VRAM queries,
# compute capability) — not heuristic GPU name matching.
#
# The TS batch translator only decides CPU vs GPU Docker profile. Once
# the container is running, this code makes the final decision.

NLLB_SPECS = [
    # Sorted largest-first (quality priority)
    {"model_id": "facebook/nllb-200-3.3B",            "params_m": 3300, "label": "NLLB 3.3B",            "cpu_practical": False},
    {"model_id": "facebook/nllb-200-distilled-1.3B",   "params_m": 1300, "label": "NLLB 1.3B distilled",  "cpu_practical": True},
    {"model_id": "facebook/nllb-200-distilled-600M",   "params_m": 600,  "label": "NLLB 600M distilled",  "cpu_practical": True},
]

PARAMS_ALIAS = {
    "600m":  "facebook/nllb-200-distilled-600M",
    "1.3b":  "facebook/nllb-200-distilled-1.3B",
    "3.3b":  "facebook/nllb-200-3.3B",
}

BYTES_PER_PARAM = {"fp32": 4, "bf16": 2, "fp16": 2, "int8": 1, "int4": 0.5}
OVERHEAD_MB = 500


def _mem_mb(params_m: int, precision: str) -> int:
    """Estimate memory needed for a model at a given precision.

    params_m is in millions (e.g. 3300 = 3.3B params).
    1M params × N bytes/param ≈ N MB (since 10^6 / 2^20 ≈ 0.954).
    """
    bpp = BYTES_PER_PARAM.get(precision, 4)
    return round(params_m * bpp * 1_000_000 / (1024 * 1024)) + OVERHEAD_MB


def _get_vram_mb() -> int:
    """Get available GPU VRAM in MB (CUDA only, 0 otherwise)."""
    if DEVICE == "cuda" and torch.cuda.is_available():
        return torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)
    return 0


def _get_system_ram_mb() -> int:
    """Get system RAM in MB."""
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") // (1024 * 1024)
    except (ValueError, OSError):
        return 0


def _resolve_precision() -> str:
    """Determine precision using canonical PyTorch APIs.

    Uses torch.cuda.is_bf16_supported() — not GPU name heuristics.
    """
    override = os.environ.get("NLLB_PRECISION", "").strip().lower()
    if override:
        logger.info(f"Precision override: {override}")
        return override

    if DEVICE == "cuda":
        cc = torch.cuda.get_device_capability(0)
        bf16_ok = torch.cuda.is_bf16_supported()
        logger.info(f"  Compute capability {cc[0]}.{cc[1]}, bf16={bf16_ok}")
        return "bf16" if bf16_ok else "fp16"

    if DEVICE == "mps":
        # Apple Silicon natively supports bf16.
        return "bf16"

    if DEVICE == "xpu":
        return "fp16"

    # CPU — use CPU feature flags
    if CPU_FEATURES.get("avx512bf16"):
        logger.info("  CPU has AVX512BF16 — auto-selecting bf16")
        return "bf16"
    return "fp32"


def _resolve_model(precision: str) -> str:
    """Select the best model that fits in available memory.

    Priority: largest model first (quality), then check if it fits.

    Override chain:
      MODEL_NAME env var → exact HuggingFace ID (advanced, skips auto)
      NLLB_PARAMS env var → friendly alias (600M, 1.3B, 3.3B)
      Auto → largest model that fits in VRAM/RAM
    """
    # Explicit model override
    model_env = os.environ.get("MODEL_NAME", "").strip()
    params_env = os.environ.get("NLLB_PARAMS", "").strip().lower()

    if model_env:
        # Validate: warn if it won't fit, but honor the override
        spec = next((s for s in NLLB_SPECS if s["model_id"] == model_env), None)
        if spec:
            needed = _mem_mb(spec["params_m"], precision)
            _warn_if_oom(model_env, precision, needed)
        _warn_if_cached_failure(model_env, precision, DEVICE, forced=True)
        logger.info(f"Model override: {model_env}")
        return model_env

    if params_env and params_env in PARAMS_ALIAS:
        model_id = PARAMS_ALIAS[params_env]
        spec = next((s for s in NLLB_SPECS if s["model_id"] == model_id), None)
        if spec:
            needed = _mem_mb(spec["params_m"], precision)
            _warn_if_oom(model_id, precision, needed)
        _warn_if_cached_failure(model_id, precision, DEVICE, forced=True)
        logger.info(f"Model from NLLB_PARAMS={params_env}: {model_id}")
        return model_id

    # Auto-select: largest model that fits
    if DEVICE == "cuda":
        vram = _get_vram_mb()
        headroom = 2000  # reserve 2 GB for PyTorch allocator + OS
        usable = vram - headroom
        logger.info(f"  VRAM: {vram} MB (usable: {usable} MB after {headroom} MB headroom)")

        for spec in NLLB_SPECS:
            needed = _mem_mb(spec["params_m"], precision)
            if needed <= usable:
                if _is_cached_failure(spec["model_id"], precision, "cuda"):
                    continue
                logger.info(f"  Auto-selected: {spec['label']} ({precision}) — {needed} MB")
                return spec["model_id"]

        # Nothing fits at this precision — try lower precisions
        fallback_chain = {"bf16": "fp16", "fp16": "int8", "int8": "int4"}
        current = precision
        while current in fallback_chain:
            lower = fallback_chain[current]
            for spec in NLLB_SPECS:
                needed = _mem_mb(spec["params_m"], lower)
                if needed <= usable:
                    if _is_cached_failure(spec["model_id"], lower, "cuda"):
                        continue
                    logger.warning(
                        f"  No model fits at {precision}. Falling back to "
                        f"{spec['label']} ({lower}) — {needed} MB"
                    )
                    return spec["model_id"]
            current = lower

    # CPU or MPS/XPU (no VRAM query): pick largest cpu_practical model
    ram_mb = _get_system_ram_mb()
    headroom = 4000
    usable = ram_mb - headroom
    cpu_specs = [s for s in NLLB_SPECS if s["cpu_practical"]]

    for spec in cpu_specs:
        needed = _mem_mb(spec["params_m"], precision)
        if needed <= usable:
            if _is_cached_failure(spec["model_id"], precision, "cpu"):
                continue
            logger.info(f"  Auto-selected (CPU): {spec['label']} ({precision}) — {needed} MB / {usable} MB usable")
            return spec["model_id"]

    # Absolute fallback
    fallback = NLLB_SPECS[-1]
    logger.info(f"  Fallback: {fallback['label']} (fp32)")
    return fallback["model_id"]


def _warn_if_oom(model_id: str, precision: str, needed_mb: int):
    """Log a warning if the requested model+precision likely won't fit."""
    if DEVICE == "cuda":
        vram = _get_vram_mb()
        if needed_mb > vram:
            logger.warning(
                f"  ⚠ {model_id} at {precision} needs ~{needed_mb} MB "
                f"but only {vram} MB VRAM available. May OOM."
            )
    elif DEVICE == "cpu":
        ram = _get_system_ram_mb()
        if ram and needed_mb > ram - 4000:
            logger.warning(
                f"  ⚠ {model_id} at {precision} needs ~{needed_mb} MB "
                f"but only ~{ram - 4000} MB usable RAM. May OOM."
            )


def _is_cached_failure(model_id: str, precision: str, device: str) -> bool:
    """Check if combo is a known pressure failure. Logs and skips for auto-select."""
    if pressure_cache is None:
        return False
    record = pressure_cache.is_known_failure(model_id, precision, device)
    if record:
        logger.info(
            f"  Skipping {model_id} {precision} {device} — "
            f"known pressure failure from {record['recorded_at']}: {record['reason']}"
        )
        return True
    return False


def _warn_if_cached_failure(model_id: str, precision: str, device: str, *, forced: bool) -> None:
    """For forced model selections, emit a STRONG WARNING if combo previously failed."""
    if pressure_cache is None:
        return
    record = pressure_cache.is_known_failure(model_id, precision, device)
    if record:
        logger.warning(
            f"  ╔══════════════════════════════════════════════════════════════╗\n"
            f"  ║  ⚠⚠⚠  STRONG WARNING: KNOWN PRESSURE FAILURE  ⚠⚠⚠       ║\n"
            f"  ║                                                            ║\n"
            f"  ║  {model_id:<54} ║\n"
            f"  ║  precision={precision:<8} device={device:<8}                     ║\n"
            f"  ║                                                            ║\n"
            f"  ║  Previously caused memory pressure on this hardware:       ║\n"
            f"  ║  {record['reason'][:54]:<54} ║\n"
            f"  ║  Recorded: {record['recorded_at'][:42]:<42} ║\n"
            f"  ║                                                            ║\n"
            f"  ║  Loading anyway because {'MODEL_NAME' if forced else 'NLLB_PARAMS'} was explicitly set.    ║\n"
            f"  ║  Monitor will stepdown if pressure recurs.                 ║\n"
            f"  ╚══════════════════════════════════════════════════════════════╝"
        )


# Initialize pressure cache early (before model selection) so auto-select can consult it
pressure_cache = _create_pressure_cache()

PRECISION = _resolve_precision()
MODEL_NAME = _resolve_model(PRECISION)


# ── TTFT LogitsProcessor ─────────────────────────────────────────────


class TTFTCapture:
    """LogitsProcessor that records time-to-first-token.

    On the first call during model.generate(), captures the elapsed time
    since generation started (set by the caller before invoking generate).
    """

    def __init__(self):
        self.gen_start: float = 0.0
        self.ttft_s: Optional[float] = None
        self._fired = False

    def reset(self, gen_start: float):
        self.gen_start = gen_start
        self.ttft_s = None
        self._fired = False

    def __call__(self, input_ids, scores):
        if not self._fired:
            self._fired = True
            self.ttft_s = time.perf_counter() - self.gen_start
        return scores


# Singleton instance reused across requests
_ttft_capture = TTFTCapture()


# ── Model loading ────────────────────────────────────────────────────


def _start_progress_ticker(phase_name: str, interval: float = 10.0):
    """Log elapsed time every `interval` seconds while a phase is active."""
    import threading

    phase_start = time.time()

    def _tick():
        while startup_status["phase"] == phase_name:
            elapsed = time.time() - phase_start
            logger.info(f"  [{phase_name}] {elapsed:.0f}s elapsed...")
            evt.wait(interval)
        elapsed = time.time() - phase_start
        logger.info(f"  [{phase_name}] completed in {elapsed:.1f}s")

    evt = threading.Event()
    t = threading.Thread(target=_tick, daemon=True)
    t.start()
    return evt  # caller can set() to stop early


def _build_load_kwargs(precision: str, device: str) -> dict:
    """Build kwargs for AutoModelForSeq2SeqLM.from_pretrained()."""
    load_kwargs: dict = {"low_cpu_mem_usage": True}

    if precision in ("int8", "int4"):
        try:
            import accelerate  # noqa: F401
        except ImportError:
            logger.error(
                "accelerate is required for int8/int4 quantization but is not installed. "
                "Install it with: pip install accelerate"
            )
            raise SystemExit(1)

    if precision == "int8":
        from transformers import BitsAndBytesConfig
        load_kwargs["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
        load_kwargs["device_map"] = "auto"
    elif precision == "int4":
        from transformers import BitsAndBytesConfig
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_quant_type="nf4",
        )
        load_kwargs["device_map"] = "auto"
    elif precision == "bf16":
        load_kwargs["torch_dtype"] = torch.bfloat16
    elif precision == "fp16":
        load_kwargs["torch_dtype"] = torch.float16
    # else fp32 — no dtype override

    return load_kwargs


def _from_pretrained(cls, model_id, **kwargs):
    """Load from cache first (fast), fall back to network download."""
    try:
        return cls.from_pretrained(model_id, local_files_only=True, **kwargs)
    except OSError:
        logger.info("  Not cached — downloading from HuggingFace...")
        return cls.from_pretrained(model_id, **kwargs)


def load_model():
    """Load model and tokenizer (called once at startup).

    Precision modes:
      fp32  — full precision, any device
      bf16  — bfloat16 (torch.cuda.is_bf16_supported() or Apple MPS)
      fp16  — float16, any CUDA GPU or Apple MPS
      int8  — 8-bit quantization via bitsandbytes (multi-backend)
      int4  — 4-bit NF4 quantization via bitsandbytes (multi-backend)

    Uses low_cpu_mem_usage=True to avoid the double-allocation problem:
    without it, transformers materializes the full model in CPU RAM as
    random tensors, then overwrites them from the checkpoint — briefly
    requiring 2x the model size in memory.  With it, weights are loaded
    directly into an empty (meta-device) shell, using ~1x memory.
    """
    global tokenizer, model

    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

    startup_status["phase"] = "downloading_tokenizer"
    startup_status["detail"] = MODEL_NAME
    logger.info(f"Downloading/loading tokenizer: {MODEL_NAME}")
    ticker = _start_progress_ticker("downloading_tokenizer")
    tokenizer = _from_pretrained(AutoTokenizer, MODEL_NAME)
    startup_status["phase"] = "tokenizer_ready"  # stops ticker
    ticker.set()
    logger.info("Tokenizer ready")

    startup_status["phase"] = "downloading_model"
    startup_status["detail"] = MODEL_NAME
    logger.info(f"Downloading/loading model: {MODEL_NAME}")
    logger.info(f"  Device: {DEVICE} | Precision: {PRECISION}")
    ticker = _start_progress_ticker("downloading_model")

    load_kwargs = _build_load_kwargs(PRECISION, DEVICE)
    logger.info(f"  Using {PRECISION} precision")

    # Set load context so monitor can predict RAM survival during load
    spec = next((s for s in NLLB_SPECS if s["model_id"] == MODEL_NAME), None)
    estimated_mb = _mem_mb(spec["params_m"], PRECISION) if spec else 0
    if resource_monitor and estimated_mb > 0:
        resource_monitor.set_load_context(MODEL_NAME, PRECISION, DEVICE, estimated_mb)

    try:
        model = _from_pretrained(AutoModelForSeq2SeqLM, MODEL_NAME, **load_kwargs)
    finally:
        if resource_monitor:
            resource_monitor.clear_load_context()
    startup_status["phase"] = "loading_weights"  # stops ticker
    ticker.set()

    # For non-quantized models, manually place on device.
    # device_map="auto" (accelerate) is only used for int8/int4 quantization.
    if PRECISION not in ("int8", "int4") and DEVICE != "cpu":
        logger.info(f"  Moving model to {DEVICE}...")
        model = model.to(DEVICE)

    model.eval()  # disable dropout for deterministic inference

    if DEVICE == "cuda":
        vram_used = torch.cuda.memory_allocated() // (1024 * 1024)
        logger.info(f"  VRAM used: {vram_used} MB")

    startup_status["phase"] = "ready"
    startup_status["detail"] = ""
    logger.info("Model loaded successfully")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global resource_monitor
    # Start resource monitor before model load so it catches load-time pressure
    resource_monitor = _create_resource_monitor()
    resource_monitor.start()

    # Load model in a background thread so /health can respond during download
    import asyncio
    loop = asyncio.get_running_loop()
    load_task = loop.run_in_executor(None, load_model)
    yield
    # Shutdown
    if resource_monitor:
        resource_monitor.stop()
    load_task.cancel()


app = FastAPI(title="NLLB Translation Server", lifespan=lifespan)


class TranslateRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str


class TranslationMetrics(BaseModel):
    input_tokens: int
    output_tokens: int
    tokenize_ms: float
    generate_ms: float
    ttft_ms: float
    decode_ms: float
    total_ms: float
    throughput_tok_s: float


class TranslateResponse(BaseModel):
    translation: str
    elapsed_ms: float
    metrics: TranslationMetrics
    warning: Optional[dict] = None


@app.get("/health")
def health(request: Request):
    """Health check endpoint with two tiers of detail.

    Unauthenticated (no auth / bad auth):
      Bare minimum for liveness probes and debugging — no hardware details,
      no resource metrics, nothing an attacker could fingerprint.

    Authenticated (valid HMAC):
      Full resource snapshot, pressure state, GPU info, load progress,
      cached failure count — everything an operator needs.
    """
    ready = startup_status["phase"] == "ready"
    authenticated = _try_hmac_auth(request)

    from datetime import datetime, timezone
    started_iso = datetime.fromtimestamp(
        startup_status["started_at"], tz=timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── Public response (always returned) ────────────────────────────
    resp: dict = {
        "status": "ok" if ready else "loading",
        "version": _SERVER_VERSION,
        "version_at": _SERVER_VERSION_AT,
        "version_source": _SERVER_VERSION_SOURCE,
        "started_at": started_iso,
        "phase": startup_status["phase"],
    }

    if not authenticated:
        return resp

    # ── Authenticated: full detail ───────────────────────────────────
    gpu_info = {}
    if DEVICE == "cuda":
        cc = torch.cuda.get_device_capability(0)
        gpu_info = {
            "name": torch.cuda.get_device_name(0),
            "compute_capability": f"{cc[0]}.{cc[1]}",
            "bf16": torch.cuda.is_bf16_supported(),
            "vram_mb": torch.cuda.get_device_properties(0).total_memory // (1024 * 1024),
        }

    elapsed = round(time.time() - startup_status["started_at"], 1) if not ready else None

    resources = {}
    if resource_monitor:
        snap = resource_monitor.last_snapshot
        if snap:
            resources = {
                "vram_allocated_mb": snap.vram_allocated_mb,
                "vram_total_mb": snap.vram_total_mb,
                "vram_pct": round(snap.vram_pct, 1),
                "ram_rss_mb": snap.ram_rss_mb,
                "ram_available_mb": snap.ram_available_mb,
                "ram_total_mb": snap.ram_total_mb,
                "swap_used_mb": snap.swap_used_mb,
                "pressure": resource_monitor.state.value,
                "stepdown_active": resource_monitor.stepdown_active,
            }
            load_progress = resource_monitor.get_load_progress(snap)
            if load_progress:
                resources["load_progress"] = load_progress

    cached_failures = 0
    if pressure_cache:
        cached_failures = pressure_cache.known_failure_count()

    resp.update({
        "model": MODEL_NAME,
        "device": DEVICE,
        "precision": PRECISION,
        "cpu_features": CPU_FEATURES,
        "gpu": gpu_info,
        "detail": startup_status["detail"],
        "elapsed_s": elapsed,
        "resources": resources,
        "cached_pressure_failures": cached_failures,
    })
    return resp


def _translate_with_metrics(
    text: str, source_lang: str, target_lang: str,
    tok, mdl, device: str
) -> TranslateResponse:
    """Core translation logic returning full metrics. Used by /translate and /benchmark."""
    t0 = time.perf_counter()
    tok.src_lang = source_lang
    inputs = tok(text, return_tensors="pt", truncation=True, max_length=512)
    input_token_count = inputs["input_ids"].shape[1]

    if device != "cpu":
        inputs = {k: v.to(device) for k, v in inputs.items()}

    t_tokenize = time.perf_counter()
    tokenize_ms = (t_tokenize - t0) * 1000

    target_lang_id = tok.convert_tokens_to_ids(target_lang)

    # Set up TTFT capture
    _ttft_capture.reset(time.perf_counter())

    with torch.no_grad():
        generated = mdl.generate(
            **inputs,
            forced_bos_token_id=target_lang_id,
            max_new_tokens=256,
            logits_processor=[_ttft_capture],
        )

    t_generate = time.perf_counter()
    generate_ms = (t_generate - t_tokenize) * 1000
    ttft_ms = (_ttft_capture.ttft_s or 0.0) * 1000

    output_token_count = generated.shape[1]
    result = tok.batch_decode(generated, skip_special_tokens=True)[0]

    t_decode = time.perf_counter()
    decode_ms = (t_decode - t_generate) * 1000

    total_ms = (t_decode - t0) * 1000
    throughput = output_token_count / (total_ms / 1000) if total_ms > 0 else 0

    metrics = TranslationMetrics(
        input_tokens=input_token_count,
        output_tokens=output_token_count,
        tokenize_ms=round(tokenize_ms, 3),
        generate_ms=round(generate_ms, 3),
        ttft_ms=round(ttft_ms, 3),
        decode_ms=round(decode_ms, 3),
        total_ms=round(total_ms, 3),
        throughput_tok_s=round(throughput, 1),
    )

    return TranslateResponse(
        translation=result,
        elapsed_ms=round(total_ms, 3),
        metrics=metrics,
    )


def _perform_stepdown(current_model: str, monitor: ResourceMonitor) -> Optional[str]:
    """Attempt to step down to a smaller model. Returns new model name or None."""
    global model, tokenizer, MODEL_NAME, PRECISION

    next_model = STEPDOWN_CHAIN.get(current_model)
    if next_model is None:
        logger.critical(
            f"No stepdown available from {current_model} — service degraded, refusing new requests"
        )
        return None

    logger.critical(
        f"Memory pressure detected. Stepping down from {current_model} → {next_model}"
    )

    # Record the failed combo so future auto-selects skip it
    if pressure_cache:
        pressure_cache.record_failure(
            current_model, PRECISION, DEVICE,
            monitor.pressure_reason,
            snapshot=monitor.pressure_snapshot.to_dict() if monitor.pressure_snapshot else None,
        )

    _unload_model()

    try:
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

        load_kwargs = _build_load_kwargs(PRECISION, DEVICE)

        # Set load context for the stepped-down model
        next_spec = next((s for s in NLLB_SPECS if s["model_id"] == next_model), None)
        est_mb = _mem_mb(next_spec["params_m"], PRECISION) if next_spec else 0
        if est_mb > 0:
            monitor.set_load_context(next_model, PRECISION, DEVICE, est_mb)

        try:
            tokenizer = _from_pretrained(AutoTokenizer, next_model)
            model = _from_pretrained(AutoModelForSeq2SeqLM, next_model, **load_kwargs)
        finally:
            monitor.clear_load_context()

        if PRECISION not in ("int8", "int4") and DEVICE != "cpu":
            model = model.to(DEVICE)
        model.eval()

        monitor.stepdown_active = True
        monitor.stepped_down_from = current_model
        monitor.stepped_down_to = next_model
        monitor.clear_pressure()

        snap = monitor.snapshot()
        monitor._add_timeline(
            "stepdown",
            f"loaded {next_model}",
            snap,
            extra={"from": current_model, "to": next_model},
        )

        MODEL_NAME = next_model
        logger.info(f"Stepdown complete: now running {next_model} — {snap.to_log_str()}")
        return next_model

    except Exception as e:
        logger.error(f"Stepdown to {next_model} failed: {e}")
        return None


@app.post("/translate", response_model=TranslateResponse, dependencies=[Depends(verify_hmac_auth)])
def translate(req: TranslateRequest):
    if tokenizer is None or model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # If monitor is in degraded state with no stepdown possible, refuse
    if (resource_monitor and resource_monitor.stepdown_active
            and resource_monitor.pressure_event.is_set()):
        raise HTTPException(
            status_code=503,
            detail="Service degraded: memory pressure with no further stepdown available"
        )

    try:
        current_model = MODEL_NAME
        resp = _translate_with_metrics(
            req.text, req.source_lang, req.target_lang,
            tokenizer, model, DEVICE,
        )
        logger.info(
            f"Translated {len(req.text)} chars → {len(resp.translation)} chars "
            f"in {resp.elapsed_ms:.1f}ms "
            f"({resp.metrics.throughput_tok_s} tok/s, ttft={resp.metrics.ttft_ms:.1f}ms) "
            f"({req.source_lang}→{req.target_lang})"
        )

        # Post-inference pressure check — stepdown if needed
        warning_dict = None
        if resource_monitor and resource_monitor.pressure_event.is_set():
            pressure_snap = resource_monitor.pressure_snapshot
            pressure_reason = resource_monitor.pressure_reason
            critical_epoch = pressure_snap.timestamp if pressure_snap else time.time()

            new_model = _perform_stepdown(current_model, resource_monitor)

            breached = []
            if pressure_snap:
                if resource_monitor._vram_total_mb > 0 and pressure_snap.vram_free_mb < resource_monitor.vram_hard_mb:
                    breached.append("vram_hard")
                if pressure_snap.ram_available_mb < resource_monitor.ram_hard_mb:
                    breached.append("ram_hard")
                if max(0, pressure_snap.swap_used_mb - resource_monitor._swap_baseline_mb) > resource_monitor.swap_hard_mb:
                    breached.append("swap_hard")

            warning_dict = {
                "type": "memory_pressure_stepdown",
                "attempted_model": current_model,
                "active_model": new_model or current_model,
                "reason": pressure_reason,
                "recommendation": f"Set NLLB_PARAMS={new_model.split('-')[-1] if new_model else 'smaller'} to avoid future pressure",
                "snapshot_at_decision": pressure_snap.to_dict() if pressure_snap else {},
                "breached_limits": breached,
                "timeline": resource_monitor.get_timeline_relative(critical_epoch),
            }

            if new_model is None:
                # Nowhere to step down — mark degraded
                logger.critical("No stepdown available — service degraded")

        if warning_dict:
            resp = TranslateResponse(
                translation=resp.translation,
                elapsed_ms=resp.elapsed_ms,
                metrics=resp.metrics,
                warning=warning_dict,
            )

        return resp
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Translation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Benchmark endpoint ───────────────────────────────────────────────

ALL_PRECISIONS = ["fp32", "bf16", "fp16", "int8", "int4"]


class BenchmarkRequest(BaseModel):
    sentences: list[str]
    source_lang: str
    target_lang: str
    filter_params: Optional[list[str]] = None      # e.g. ["600M", "1.3B"]
    filter_precisions: Optional[list[str]] = None   # e.g. ["bf16", "fp16"]
    filter_devices: Optional[list[str]] = None      # e.g. ["cuda", "cpu"]


class BenchmarkSentenceResult(BaseModel):
    text: str
    translation: str
    metrics: TranslationMetrics


class BenchmarkComboResult(BaseModel):
    device: str
    model_label: str
    params_m: int
    precision: str
    status: str  # "ok" or "X (reason)"
    load_time_s: Optional[float] = None
    sentence_results: list[BenchmarkSentenceResult] = []
    avg_metrics: Optional[dict] = None
    pressure_snapshot: Optional[dict] = None
    pressure_timeline: Optional[list[dict]] = None
    post_load_snapshot: Optional[dict] = None  # ResourceSnapshot after load+warmup


class BenchmarkResponse(BaseModel):
    hardware: dict
    combos: list[BenchmarkComboResult]
    matrices: dict[str, list[list[str]]]  # metric_name → 2D string grid
    cached: bool = False           # true if served from cache
    joined: bool = False           # true if caller waited on in-flight benchmark
    completed_at: Optional[str] = None  # ISO timestamp of when benchmark finished
    resources_at_completion: Optional[dict] = None  # resource snapshot when done


@dataclass
class BenchmarkCacheEntry:
    key: str
    response: dict  # serialized BenchmarkResponse
    completed_at: float
    hw_fingerprint: str


# ── Benchmark singleton + cache ──────────────────────────────────────
_benchmark_lock = threading.Lock()
_benchmark_future: Optional[dict] = None  # {"key": str, "result": dict|None, "event": threading.Event}
_benchmark_cache: dict[str, BenchmarkCacheEntry] = {}


def _benchmark_cache_key(hw_fingerprint: str, req: "BenchmarkRequest") -> str:
    """Deterministic cache key from hardware + request params."""
    blob = json.dumps({
        "hw": hw_fingerprint,
        "sentences": sorted(req.sentences),
        "source": req.source_lang,
        "target": req.target_lang,
        "filter_params": sorted(req.filter_params) if req.filter_params else None,
        "filter_precisions": sorted(req.filter_precisions) if req.filter_precisions else None,
        "filter_devices": sorted(req.filter_devices) if req.filter_devices else None,
    }, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def _check_feasibility(spec: dict, precision: str, device: str) -> Optional[str]:
    """Return None if feasible, or a reason string if infeasible."""
    params_m = spec["params_m"]

    if device == "cpu":
        if not spec["cpu_practical"]:
            return f"not cpu_practical — {spec['label']} too slow on CPU"
        if precision in ("int8", "int4"):
            # bitsandbytes CPU support is experimental
            try:
                import bitsandbytes  # noqa: F401
                # Check if CPU backend is actually available
                if not hasattr(bitsandbytes, "functional"):
                    return f"{precision} requires CUDA — bitsandbytes"
            except ImportError:
                return f"{precision} requires CUDA — bitsandbytes"
            return f"{precision} requires CUDA — bitsandbytes"
        if precision == "bf16" and not CPU_FEATURES.get("avx512bf16"):
            return "no AVX512BF16 for CPU bf16"
        # RAM check
        ram_mb = _get_system_ram_mb()
        if ram_mb:
            needed = _mem_mb(params_m, precision)
            usable = ram_mb - 4000
            if needed > usable:
                return f"RAM: need {needed} MB, have {usable} MB usable"
    else:
        # GPU (cuda)
        if precision in ("int8", "int4"):
            if not torch.cuda.is_available():
                return f"{precision} requires CUDA — bitsandbytes"
        if precision == "bf16" and device == "cuda":
            if not torch.cuda.is_bf16_supported():
                return "GPU does not support bf16"
        vram = _get_vram_mb()
        if vram:
            needed = _mem_mb(params_m, precision)
            headroom = 2000
            usable = vram - headroom
            if needed > usable:
                return f"VRAM: need {needed} MB, have {usable} MB usable"

    return None


def _vram_used_mb() -> int:
    """Current VRAM allocated in MB (0 if no CUDA)."""
    if torch.cuda.is_available():
        return torch.cuda.memory_allocated() // (1024 * 1024)
    return 0


def _vram_reserved_mb() -> int:
    """Current VRAM reserved by allocator in MB (0 if no CUDA)."""
    if torch.cuda.is_available():
        return torch.cuda.memory_reserved() // (1024 * 1024)
    return 0


def _system_ram_used_mb() -> int:
    """Resident set size of this process in MB (Linux only)."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024  # kB → MB
    except OSError:
        pass
    return 0


def _unload_model():
    """Unload current model from memory with aggressive GC.

    Python's GC needs multiple passes to collect cyclic references in the
    model graph.  torch.cuda.empty_cache() only releases the allocator's
    free list — the tensors must be GC'd first.  We run up to 3 gc passes
    and synchronize CUDA to ensure device-side frees complete before we
    measure.
    """
    global model, tokenizer

    vram_before = _vram_used_mb()
    reserved_before = _vram_reserved_mb()
    ram_before = _system_ram_used_mb()

    model = None
    tokenizer = None

    # Multiple GC passes — cyclic refs in the transformer graph often
    # need 2-3 passes: model → layers → attention → parameter refs
    for _ in range(3):
        gc.collect()

    if torch.cuda.is_available():
        torch.cuda.synchronize()  # wait for any async GPU frees
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()  # free cross-process CUDA tensors if any

    vram_after = _vram_used_mb()
    reserved_after = _vram_reserved_mb()
    ram_after = _system_ram_used_mb()

    logger.info(
        f"  Unload: VRAM {vram_before}→{vram_after} MB (reserved {reserved_before}→{reserved_after} MB), "
        f"RAM RSS {ram_before}→{ram_after} MB"
    )
    if vram_after > 100:
        logger.warning(f"  ⚠ VRAM not fully freed: {vram_after} MB still allocated")


def _load_model_for_benchmark(
    model_id: str, precision: str, device: str
) -> tuple:
    """Load a specific model+precision+device combo. Returns (tokenizer, model, load_time_s).

    Sets load context on the resource monitor so it can predict whether RAM
    will survive the load, and logs progress during periodic snapshots.
    """
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

    # Find spec for estimated memory
    spec = next((s for s in NLLB_SPECS if s["model_id"] == model_id), None)
    estimated_mb = _mem_mb(spec["params_m"], precision) if spec else 0

    if resource_monitor and estimated_mb > 0:
        resource_monitor.set_load_context(model_id, precision, device, estimated_mb)

    try:
        t0 = time.perf_counter()

        tok = AutoTokenizer.from_pretrained(model_id, local_files_only=True)
        load_kwargs = _build_load_kwargs(precision, device)
        mdl = AutoModelForSeq2SeqLM.from_pretrained(model_id, local_files_only=True, **load_kwargs)

        if precision not in ("int8", "int4") and device != "cpu":
            mdl = mdl.to(device)
        mdl.eval()

        load_time = time.perf_counter() - t0
        return tok, mdl, load_time
    finally:
        if resource_monitor:
            resource_monitor.clear_load_context()


@app.post("/benchmark", dependencies=[Depends(verify_hmac_auth)])
def benchmark(req: BenchmarkRequest):
    from datetime import datetime, timezone
    global _benchmark_future

    hw_fp = PressureFailureCache.build_hw_fingerprint()
    cache_key = _benchmark_cache_key(hw_fp, req)

    # ── Check result cache ──
    if cache_key in _benchmark_cache:
        entry = _benchmark_cache[cache_key]
        logger.info(f"Benchmark cache hit (key={cache_key[:12]}…)")
        resp = entry.response.copy()
        resp["cached"] = True
        return resp

    # ── Singleton: only one benchmark at a time ──
    acquired = _benchmark_lock.acquire(blocking=False)
    if not acquired:
        # Another benchmark is running — can we join it?
        future = _benchmark_future
        if future and future["key"] == cache_key:
            logger.info("Benchmark already in progress with same params — joining wait")
            future["event"].wait()
            if future["result"] is None:
                raise HTTPException(
                    status_code=500,
                    detail="Benchmark that this request joined failed",
                )
            resp = future["result"].copy()
            resp["joined"] = True
            return resp
        raise HTTPException(
            status_code=409,
            detail="Benchmark already in progress with different parameters",
        )

    # We hold _benchmark_lock — set up future for joiners
    evt = threading.Event()
    _benchmark_future = {"key": cache_key, "result": None, "event": evt}

    try:
        result = _run_benchmark(req, hw_fp)

        # Cache and publish
        result_dict = result.model_dump()
        _benchmark_cache[cache_key] = BenchmarkCacheEntry(
            key=cache_key,
            response=result_dict,
            completed_at=time.time(),
            hw_fingerprint=hw_fp,
        )
        _benchmark_future["result"] = result_dict
        _benchmark_future["event"].set()
        return result
    except Exception:
        # Signal joiners with None (they'll get an error)
        _benchmark_future["event"].set()
        raise
    finally:
        _benchmark_lock.release()


def _run_benchmark(req: BenchmarkRequest, hw_fingerprint: str) -> BenchmarkResponse:
    """Core benchmark logic, called under _benchmark_lock."""
    from datetime import datetime, timezone
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

    devices = ["cuda", "cpu"] if torch.cuda.is_available() else ["cpu"]

    # Apply server-side filters
    if req.filter_devices:
        device_map = {"gpu": "cuda", "cuda": "cuda", "cpu": "cpu"}
        allowed_devices = {device_map.get(d.lower(), d.lower()) for d in req.filter_devices}
        devices = [d for d in devices if d in allowed_devices]

    specs_to_test = NLLB_SPECS
    if req.filter_params:
        aliases = {p.lower() for p in req.filter_params}
        specs_to_test = [s for s in NLLB_SPECS
                         if any(a in s["label"].lower() or a in s["model_id"].lower()
                                for a in aliases)]

    precisions_to_test = ALL_PRECISIONS
    if req.filter_precisions:
        precisions_to_test = [p for p in ALL_PRECISIONS if p in req.filter_precisions]

    hw_info = {
        "device": DEVICE,
        "cpu_features": CPU_FEATURES,
        "system_ram_mb": _get_system_ram_mb(),
    }
    if torch.cuda.is_available():
        hw_info["gpu_name"] = torch.cuda.get_device_name(0)
        hw_info["vram_mb"] = _get_vram_mb()

    # ── Pre-download all model files ──
    logger.info("Benchmark: pre-downloading model files...")
    feasible_model_ids = set()
    for spec in specs_to_test:
        for prec in precisions_to_test:
            for dev in devices:
                reason = _check_feasibility(spec, prec, dev)
                if reason is None:
                    feasible_model_ids.add(spec["model_id"])

    download_failed: set[str] = set()
    for mid in feasible_model_ids:
        try:
            AutoTokenizer.from_pretrained(mid, local_files_only=True)
            AutoModelForSeq2SeqLM.from_pretrained(mid, local_files_only=True, low_cpu_mem_usage=True)
            logger.info(f"  {mid}: cached")
        except OSError:
            try:
                logger.info(f"  {mid}: downloading...")
                AutoTokenizer.from_pretrained(mid)
                AutoModelForSeq2SeqLM.from_pretrained(mid, low_cpu_mem_usage=True)
                logger.info(f"  {mid}: downloaded")
            except Exception as e:
                logger.warning(f"  {mid}: download failed ({e}) — will skip in benchmark")
                download_failed.add(mid)

    # ── Run benchmark matrix ──
    combos: list[BenchmarkComboResult] = []

    for dev in devices:
        for spec in specs_to_test:
            for prec in precisions_to_test:
                reason = _check_feasibility(spec, prec, dev)
                dev_label = "GPU" if dev == "cuda" else "CPU"

                if spec["model_id"] in download_failed:
                    reason = "model download failed"

                if reason is not None:
                    logger.info(f"  {dev_label} {spec['label']} {prec}: X ({reason})")
                    combos.append(BenchmarkComboResult(
                        device=dev_label,
                        model_label=spec["label"],
                        params_m=spec["params_m"],
                        precision=prec,
                        status=f"X ({reason})",
                    ))
                    continue

                # Check pressure failure cache before attempting load
                if pressure_cache:
                    cached = pressure_cache.is_known_failure(spec["model_id"], prec, dev)
                    if cached:
                        cache_reason = f"cached pressure failure ({cached['reason']})"
                        logger.info(f"  {dev_label} {spec['label']} {prec}: X ({cache_reason})")
                        combos.append(BenchmarkComboResult(
                            device=dev_label,
                            model_label=spec["label"],
                            params_m=spec["params_m"],
                            precision=prec,
                            status=f"X ({cache_reason})",
                        ))
                        continue

                logger.info(f"  {dev_label} {spec['label']} {prec}: loading...")
                _unload_model()

                # Clear any lingering pressure from previous combo
                if resource_monitor:
                    resource_monitor.clear_pressure()

                # Pre-load snapshot
                if resource_monitor:
                    pre_snap = resource_monitor.snapshot()
                    logger.info(f"  Pre-load: {pre_snap.to_log_str()}, model needs ~{_mem_mb(spec['params_m'], prec)} MB")
                else:
                    vram_now = _vram_used_mb()
                    ram_now = _system_ram_used_mb()
                    needed = _mem_mb(spec["params_m"], prec)
                    logger.info(
                        f"  Pre-load: VRAM={vram_now} MB, RAM RSS={ram_now} MB, "
                        f"model needs ~{needed} MB"
                    )

                try:
                    tok, mdl, load_time = _load_model_for_benchmark(
                        spec["model_id"], prec, dev
                    )

                    # Post-load snapshot + pressure check
                    if resource_monitor:
                        post_snap = resource_monitor.snapshot()
                        logger.info(f"  Post-load ({load_time:.1f}s): {post_snap.to_log_str()}")
                        if resource_monitor.pressure_event.is_set():
                            reason = resource_monitor.pressure_reason
                            logger.critical(f"  \u26d4 Memory pressure after load: {reason}")
                            p_snap = resource_monitor.pressure_snapshot
                            p_timeline = resource_monitor.get_timeline_relative()
                            _unload_model()
                            if pressure_cache:
                                pressure_cache.record_failure(
                                    spec["model_id"], prec, dev, reason,
                                    snapshot=p_snap.to_dict() if p_snap else None,
                                )
                            combos.append(BenchmarkComboResult(
                                device=dev_label,
                                model_label=spec["label"],
                                params_m=spec["params_m"],
                                precision=prec,
                                status=f"X (memory pressure: {reason})",
                                load_time_s=round(load_time, 2),
                                pressure_snapshot=p_snap.to_dict() if p_snap else None,
                                pressure_timeline=p_timeline,
                            ))
                            resource_monitor.clear_pressure()
                            continue
                    else:
                        vram_post = _vram_used_mb()
                        ram_post = _system_ram_used_mb()
                        logger.info(
                            f"  Loaded in {load_time:.1f}s — "
                            f"VRAM={vram_post} MB, RAM RSS={ram_post} MB — running warmup..."
                        )

                    # Warmup
                    _translate_with_metrics(
                        "Hello", req.source_lang, req.target_lang,
                        tok, mdl, dev,
                    )

                    # Post-load+warmup resource snapshot for matrix reporting
                    combo_snap = resource_monitor.snapshot().to_dict() if resource_monitor else None

                    # Run sentences
                    sentence_results = []
                    combo_aborted = False
                    for sent in req.sentences:
                        # Check pressure before each sentence
                        if resource_monitor and resource_monitor.pressure_event.is_set():
                            reason = resource_monitor.pressure_reason
                            logger.critical(f"  \u26d4 Memory pressure during inference, aborting combo")
                            p_snap = resource_monitor.pressure_snapshot
                            p_timeline = resource_monitor.get_timeline_relative()
                            _unload_model()
                            if pressure_cache:
                                pressure_cache.record_failure(
                                    spec["model_id"], prec, dev, reason,
                                    snapshot=p_snap.to_dict() if p_snap else None,
                                )
                            combos.append(BenchmarkComboResult(
                                device=dev_label,
                                model_label=spec["label"],
                                params_m=spec["params_m"],
                                precision=prec,
                                status=f"X (memory pressure: {reason})",
                                load_time_s=round(load_time, 2),
                                sentence_results=sentence_results,
                                pressure_snapshot=p_snap.to_dict() if p_snap else None,
                                pressure_timeline=p_timeline,
                            ))
                            resource_monitor.clear_pressure()
                            combo_aborted = True
                            break

                        resp = _translate_with_metrics(
                            sent, req.source_lang, req.target_lang,
                            tok, mdl, dev,
                        )
                        sentence_results.append(BenchmarkSentenceResult(
                            text=sent,
                            translation=resp.translation,
                            metrics=resp.metrics,
                        ))
                        logger.info(
                            f"    {sent[:40]}... → {resp.metrics.throughput_tok_s} tok/s "
                            f"ttft={resp.metrics.ttft_ms:.1f}ms total={resp.metrics.total_ms:.1f}ms"
                        )

                    if combo_aborted:
                        del tok, mdl
                        continue

                    # Compute averages
                    n = len(sentence_results)
                    avg = {}
                    if n > 0:
                        for fld in ["input_tokens", "output_tokens", "tokenize_ms",
                                      "generate_ms", "ttft_ms", "decode_ms",
                                      "total_ms", "throughput_tok_s"]:
                            vals = [getattr(sr.metrics, fld) for sr in sentence_results]
                            avg[fld] = round(sum(vals) / n, 2)

                    combos.append(BenchmarkComboResult(
                        device=dev_label,
                        model_label=spec["label"],
                        params_m=spec["params_m"],
                        precision=prec,
                        status="ok",
                        load_time_s=round(load_time, 2),
                        sentence_results=sentence_results,
                        avg_metrics=avg,
                        post_load_snapshot=combo_snap,
                    ))
                    logger.info(f"  {dev_label} {spec['label']} {prec}: done (avg {avg.get('throughput_tok_s', 0)} tok/s)")

                    # Drop local refs so next _unload_model() can actually free
                    del tok, mdl

                except Exception as e:
                    logger.error(f"  {dev_label} {spec['label']} {prec}: FAILED — {e}")
                    # Ensure locals don't hold stale model refs
                    tok = mdl = None  # noqa: F841
                    combos.append(BenchmarkComboResult(
                        device=dev_label,
                        model_label=spec["label"],
                        params_m=spec["params_m"],
                        precision=prec,
                        status=f"X (runtime error: {e})",
                    ))

    # ── Build PARAM×PRECISION display matrices ──
    matrices = _build_matrices(combos)

    # ── Log matrices ──
    for metric_name, grid in matrices.items():
        logger.info(f"\n═══ {metric_name} ═══")
        for row in grid:
            logger.info("  ".join(cell.ljust(12) for cell in row))

    # ── Reload original model ──
    logger.info("Benchmark complete — reloading original model...")
    if resource_monitor:
        resource_monitor.clear_pressure()
    _unload_model()
    load_model()
    # Clear any pressure from the reload itself (e.g. transient swap from WSL2)
    if resource_monitor:
        resource_monitor.clear_pressure()

    from datetime import datetime, timezone
    completed_at = datetime.now(timezone.utc).isoformat()
    resources_snap = resource_monitor.snapshot().to_dict() if resource_monitor else None

    return BenchmarkResponse(
        hardware=hw_info,
        combos=combos,
        matrices=matrices,
        completed_at=completed_at,
        resources_at_completion=resources_snap,
    )


def _build_matrices(combos: list[BenchmarkComboResult]) -> dict[str, list[list[str]]]:
    """Build PARAM×PRECISION matrices for each metric."""
    metrics_to_show = {
        "Throughput (tok/s)": "throughput_tok_s",
        "TTFT (ms)": "ttft_ms",
        "Total (ms)": "total_ms",
        "Generate (ms)": "generate_ms",
        "Model Load (s)": None,  # special: from load_time_s
        "VRAM Free (MB)": "__vram_free",   # special: from post_load_snapshot
        "RAM Available (MB)": "__ram_avail",  # special: from post_load_snapshot
    }

    # Row labels: "GPU 600M", "GPU 1.3B", etc.
    devices_seen = []
    for c in combos:
        key = (c.device, c.model_label)
        if key not in devices_seen:
            devices_seen.append(key)

    result = {}
    for metric_name, field in metrics_to_show.items():
        header = [""] + ALL_PRECISIONS
        grid = [header]

        for dev, label in devices_seen:
            row = [f"{dev} {label}"]
            for prec in ALL_PRECISIONS:
                # Find matching combo
                match = next(
                    (c for c in combos
                     if c.device == dev and c.model_label == label and c.precision == prec),
                    None,
                )
                if match is None:
                    row.append("—")
                elif match.status != "ok":
                    # Truncate reason for display
                    reason = match.status
                    if len(reason) > 20:
                        reason = reason[:17] + "..."
                    row.append(reason)
                elif field is None:
                    # load_time_s
                    row.append(str(match.load_time_s) if match.load_time_s else "—")
                elif field == "__vram_free":
                    snap = match.post_load_snapshot
                    row.append(str(snap["vram_free_mb"]) if snap and "vram_free_mb" in snap else "—")
                elif field == "__ram_avail":
                    snap = match.post_load_snapshot
                    row.append(str(snap["ram_available_mb"]) if snap and "ram_available_mb" in snap else "—")
                elif match.avg_metrics and field in match.avg_metrics:
                    row.append(str(match.avg_metrics[field]))
                else:
                    row.append("—")
            grid.append(row)

        result[metric_name] = grid

    return result


@app.delete("/benchmark/cache", dependencies=[Depends(verify_hmac_auth)])
def clear_benchmark_cache():
    """Clear the in-memory benchmark result cache."""
    count = len(_benchmark_cache)
    _benchmark_cache.clear()
    logger.info(f"Benchmark cache cleared ({count} entries)")
    return {"cleared": True, "entries_removed": count}


def _clear_stale_locks():
    """Remove stale HuggingFace hub lock files from previous container runs.

    When a container is killed mid-download, HF hub leaves .lock files that
    block subsequent from_pretrained() calls indefinitely. Since the server
    is single-process and single-container, any lock files at startup are
    guaranteed stale.
    """
    import glob as glob_mod
    cache_dir = os.environ.get("HF_HOME", os.path.expanduser("~/.cache/huggingface"))
    lock_pattern = os.path.join(cache_dir, "hub", ".locks", "**", "*.lock")
    locks = glob_mod.glob(lock_pattern, recursive=True)
    if locks:
        removed = 0
        for lock_file in locks:
            try:
                os.remove(lock_file)
                removed += 1
            except OSError:
                pass
        logger.info(f"Cleared {removed}/{len(locks)} stale HF hub lock files")


if __name__ == "__main__":
    _clear_stale_locks()
    # Generate TLS cert before uvicorn.run() — uvicorn validates cert paths at config time
    generate_self_signed_cert()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(
        app,
        host=host,
        port=port,
        ssl_keyfile=TLS_KEY,
        ssl_certfile=TLS_CERT,
    )
