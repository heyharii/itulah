#!/usr/bin/env python3
"""Run audit witnesses on an isolated copy; does not edit application source."""
from pathlib import Path
import shutil, subprocess, tempfile
here = Path(__file__).resolve().parent
root = here.parents[1]
target = Path(tempfile.mkdtemp(prefix="itulah-marketing-audit-"))
for name in ("pricing-engine", "tax"):
    shutil.copytree(root / "backend/crates" / name, target / name)
(target / "Cargo.toml").write_text('[workspace]\nmembers=["pricing-engine","tax"]\nresolver="2"\n[workspace.lints.rust]\nunsafe_code="forbid"\n[workspace.lints.clippy]\nunwrap_used="deny"\nexpect_used="deny"\n')
with (target / "pricing-engine/src/tests.rs").open("a") as stream:
    stream.write("\n" + (here / "reproduction-tests.rs").read_text())
print("Isolated workspace:", target, flush=True)
subprocess.run(["cargo", "test", "--manifest-path", str(target / "Cargo.toml"), "-p", "pricing-engine", "audit_", "--", "--nocapture"], check=True)
