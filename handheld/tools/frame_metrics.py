#!/usr/bin/env python3
"""Capture a bounded on-device gfxinfo sample without driving the app.

Frame durations measure IntendedVsync -> FrameCompleted, not just CPU draw time.
Polling merges the finite framestats ring; capture loss is reported explicitly.
"""
import argparse
import csv
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


def parse_frames(raw):
    frames = {}
    for block in raw.split("---PROFILEDATA---")[1::2]:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines or not lines[0].startswith("Flags,"):
            continue
        for row in csv.DictReader(lines):
            try:
                flags = int(row["Flags"])
                start = int(row["IntendedVsync"])
                end = int(row["FrameCompleted"])
                actual = int(row["Vsync"])
            except (KeyError, ValueError, TypeError):
                continue
            # Nonzero flags designate frames Android excludes from ordinary stats.
            if (flags or start <= 0 or actual <= 0 or end < start or
                    end >= 2**63 - 1):
                continue
            frames[(start, actual)] = (end - start) / 1_000_000
    return frames


def summarize(frames):
    values = sorted(frames.values())
    if not values:
        return {"captured_frames": 0, "target_met": None}
    percentile = lambda p: values[max(0, math.ceil(len(values) * p) - 1)]
    return {
        "captured_frames": len(values),
        "target_met": percentile(.95) <= 10,
        "p50_ms": percentile(.50), "p95_ms": percentile(.95),
        "p99_ms": percentile(.99), "worst_ms": values[-1],
        "at_most_10ms_percent": 100 * sum(v <= 10 for v in values) / len(values),
        "at_most_16ms_percent": 100 * sum(v <= 16 for v in values) / len(values),
        "p95_at_most_10ms": percentile(.95) <= 10,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--serial")
    parser.add_argument("--package", default="id.itulah.pindai")
    parser.add_argument("--adb", default=os.environ.get("ADB") or shutil.which("adb")
                        or "/opt/homebrew/share/android-commandlinetools/platform-tools/adb")
    args = parser.parse_args()
    if not 1 <= args.seconds <= 3600:
        parser.error("--seconds must be between 1 and 3600")
    prefix = [args.adb] + (["-s", args.serial] if args.serial else [])

    def adb(*command):
        result = subprocess.run(prefix + list(command), text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        return result.stdout

    adb("get-state")
    package = adb("shell", "dumpsys", "package", args.package)
    if "versionName=" not in package:
        raise RuntimeError("Target app is not installed")
    if re.search(r"flags=\[[^\]]*\bDEBUGGABLE\b", package):
        raise RuntimeError("Install a non-debuggable release build before measuring")
    pid_parts = adb("shell", "pidof", args.package).strip().split()
    if not pid_parts:
        raise RuntimeError("Target app is not running; launch it before capture")
    pid = pid_parts[0]
    args.output.mkdir(parents=True, exist_ok=False)
    # Do not export preferences, credentials, or unrestricted logcat.
    metadata = {
        "label": args.label, "package": args.package,
        "device_model": adb("shell", "getprop", "ro.product.model").strip(),
        "android": adb("shell", "getprop", "ro.build.version.release").strip(),
        "pid": pid,
        "package_version": [line.strip() for line in package.splitlines()
                            if any(k in line for k in ("versionCode=", "versionName=", "lastUpdateTime="))],
        "measurement": "IntendedVsync to FrameCompleted; normal completed frames only",
    }
    for name, command in (("thermal_before", ("dumpsys", "thermalservice")),
                          ("memory_before", ("dumpsys", "meminfo", args.package)),
                          ("cpu_before", ("top", "-H", "-b", "-n", "1", "-p", pid))):
        (args.output / (name + ".txt")).write_text(adb("shell", *command))
    adb("shell", "dumpsys", "gfxinfo", args.package, "reset")
    frames = {}
    start = time.monotonic()
    print(f"Capturing {args.seconds}s: {args.label}. Perform the planned scenario now.", flush=True)
    while True:
        raw = adb("shell", "dumpsys", "gfxinfo", args.package, "framestats")
        frames.update(parse_frames(raw))
        if time.monotonic() - start >= args.seconds:
            break
        time.sleep(min(1, max(0, args.seconds - (time.monotonic() - start))))
    (args.output / "gfxinfo_framestats.txt").write_text(raw)
    gfxinfo = adb("shell", "dumpsys", "gfxinfo", args.package)
    (args.output / "gfxinfo_final.txt").write_text(gfxinfo)
    (args.output / "memory_after.txt").write_text(adb("shell", "dumpsys", "meminfo", args.package))
    (args.output / "thermal_after.txt").write_text(adb("shell", "dumpsys", "thermalservice"))
    (args.output / "cpu_after.txt").write_text(
        adb("shell", "top", "-H", "-b", "-n", "1", "-p", pid),
    )
    summary = {**metadata, **summarize(frames), "elapsed_seconds": time.monotonic() - start}
    total = re.search(r"Total frames rendered:\s*(\d+)", gfxinfo)
    summary["android_total_frames"] = int(total.group(1)) if total else None
    for key, pattern in {
        "android_janky_frames": r"Janky frames:\s*(\d+)",
        "android_missed_vsync": r"Number Missed Vsync:\s*(\d+)",
        "android_frame_deadline_missed": r"Number Frame deadline missed:\s*(\d+)",
    }.items():
        match = re.search(pattern, gfxinfo)
        summary[key] = int(match.group(1)) if match else None
    captured = summary.get("captured_frames") or 0
    total_frames = summary.get("android_total_frames")
    summary["capture_coverage_percent"] = (
        100 * captured / total_frames
        if total_frames and total_frames > 0 else None
    )
    summary["coverage_note"] = (
        "Captured framestats may omit flagged, incomplete, or overwritten frames; "
        "compare capture_coverage_percent and Android counters in gfxinfo_final.txt. "
        "A passing captured p95 alone does not establish whole-session success."
    )
    with (args.output / "frames.csv").open("w") as out:
        writer = csv.writer(out)
        writer.writerow(["intended_vsync_ns", "vsync_ns", "duration_ms"])
        for key, duration in sorted(frames.items()):
            writer.writerow([*key, duration])
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
