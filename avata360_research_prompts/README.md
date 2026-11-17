# Avata 360 → metric 3D reconstruction: multi-agent research kit

## How to run
1. Open a new Claude session that can launch subagents and search the web (e.g. Claude Code, or a Claude session with agents enabled).
2. Put this whole folder in the session's working directory (upload it, or clone/copy it there).
3. Paste the contents of `00_ORCHESTRATOR.md` as your first message. Nothing else is needed.

## Files
| File | Role | Runs in |
|---|---|---|
| `00_ORCHESTRATOR.md` | Top-level controller: dispatches agents, assembles the report, runs the review loop, triggers the HTML build | the main session |
| `shared_context.md` | Project facts every agent reads first | read by all |
| `agents/A1_device.md` | DJI Avata 360 drone + camera primer and constraints | Wave 1 |
| `agents/A2_foundations.md` | Learning material: photogrammetry, SfM/MVS, 3DGS basics | Wave 1 |
| `agents/A3a_filtering.md` | Data filtering and quality-aware selection | Wave 2 |
| `agents/A3b_geometry.md` | Geometric accuracy | Wave 2 |
| `agents/A3c_visualization.md` | Photoreal visualization | Wave 2 |
| `agents/A4_system_design.md` | Combines A1+A3 into 2–3 full-system options | Wave 3 |
| `agents/R_reviewer.md` | Reviews the assembled report and returns fixes (loop of up to 3 rounds) | Review |
| `agents/H_html_builder.md` | Builds the final interactive HTML artifact | Final |

## Outputs (written by the session)
```
research/
  A1_device.md  A2_foundations.md  A3a_filtering.md  A3b_geometry.md
  A3c_visualization.md  A4_system_design.md
  sources.json            # merged, de-duplicated bibliography
  report.md               # assembled report (versioned: report_v1.md, report_v2.md …)
  review_round_1.md …     # reviewer verdicts
  final/index.html        # the artifact
```
