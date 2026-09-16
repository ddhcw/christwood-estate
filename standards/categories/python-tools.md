# Best Practices — Python Tools

Distilled from: School Timetable Solver (Google OR-Tools CP-SAT). One project today, but the patterns generalise to any standalone Python that does heavy computation the GAS estate can't.

## When to reach for standalone Python
- The problem is **combinatorial / optimisation** (timetabling, allocation, scheduling) — CP-SAT / OR-Tools, not heuristics in Apps Script.
- The work is **data-heavy profiling/normalisation** — pandas/numpy on an export (cf. the Student DB `_analysis/` toolkit in Hybrid Systems).
- You need **real tests, real libraries, and no 6-minute execution limit.**

## Structure: a clean pipeline
Separate the stages so each is independently testable:
`data_loader → data_models → model_builder → constraint_engine → solver → output_formatter`, behind a thin CLI entry point. (Timetable Solver.)
- **Typed data models** (`@dataclass`-style entities) instead of passing raw dicts/rows around.
- **Separate the model from the constraints** — core always-on constraints in the builder, optional/tunable ones in a constraint engine driven by a `ConstraintConfig`.

## Solver discipline (for CP-SAT specifically)
- Express decisions as explicit binary variables (`assign[a,d,p] ∈ {0,1}`) with hard constraints; keep "always-on" constraints non-configurable and documented.
- Expose **`--time-limit`, `--workers`, `--dry-run`** on the CLI so runs are tunable.
- **Always surface solver status** (optimal / feasible / infeasible / timeout) — a time-limited solve can return nothing or a partial result; don't pretend success.

## Testing
- Test the **happy path and the infeasible path** (`test_infeasible.py`) — verify the model *correctly fails* on over-constrained input, not just that it solves easy cases. This is the maturity marker.
- Keep solver logic pure where possible so tests don't need the full data files.

## CLI & ops ergonomics *(added 2026-07 — see Estate-Wide Addendum)*
- **Exit non-zero on failure** so schedulers (Task Scheduler/cron) can detect it; log to a timestamped file, not just stdout.
- End every run with a **human-readable summary** (rows in/out, conflicts, solver status, elapsed time) — the thing you paste into Chat when someone asks "did it run?".
- Profile before optimising; in data-pipeline code the cost is usually I/O and per-row loops, same as in GAS.

## Integration with the rest of the estate
- These tools read/write **CSVs** that overlap with GAS tools (the solver consumes the same allotment CSVs the GAS timetable tool uses). **Keep the CSV schema in sync** and decide which tool is the system of record — don't let an automated and a manual solution to the same problem silently diverge.
- Use Google API client libs + a service account if the tool needs to read from / write back to Sheets directly.
- Pin dependencies (`requirements.txt`) and keep `__pycache__`/venv out of the shared folder.
