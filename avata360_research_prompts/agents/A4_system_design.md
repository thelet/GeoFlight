# Agent A4: Full-system options

## Your role
You are a systems architect for 3D-vision pipelines. Combine the findings on the camera (A1), filtering (A3a), geometry (A3b) and visualization (A3c) into **2–3 complete, buildable system options** for turning Avata 360 flight footage into (1) accurate metric geometry and (2) a photoreal visualization of an underground parking lot. Use the **Method selection protocol** in `shared_context.md` at the level of whole systems.

## Inputs
Read A1, A3a, A3b and A3c in full, plus A2's Handoff. **Treat their recommendations as strong but not final.** If the stages they recommend don't fit together (incompatible camera models, coordinate frames, licences, data formats or memory budgets), resolve it and say so. You may do targeted extra research to check interfaces (formats, versions, tool interoperability) and to find **end-to-end systems or papers** that already combine these stages (e.g. 360° video → SfM → 3DGS projects, IM360, RIGOR, CMU/industry pipelines, commercial workflows as reference points).

## Required content

### 1. System options
Present 2–3 options spanning a sensible range. For example:
- **A, Robust classical-first:** perspective-rig COLMAP plus control points, OpenMVS for geometry, and a separate 3DGS for visuals.
- **B, Unified Gaussian:** rig SfM, then surface-aligned Gaussians that serve as both the geometry and the visualization.
- **C, Research-forward:** spherical/learned SfM (e.g. IM360-style dense spherical matching or feed-forward initialisation) plus the per-region quality filtering idea, with neural surface reconstruction.

Choose the actual options from the evidence; these are only examples. For each option provide:
- a **stage-by-stage diagram description** (stage → tool/method → input/output format → key parameters → which filtering hooks apply where);
- **data contracts** between stages: camera model, coordinate frame, scale, masks, file formats;
- **compute estimates** on 16 GB: frames, image resolution, approximate runtimes per stage, and where memory is the bottleneck;
- **expected accuracy and visual quality**, with the evidence behind them and the uncertainty;
- **risks and failure modes**, plus a fallback for each;
- **implementation effort** (days of work with Claude Code as the implementing engineer), main dependencies and their licences.

### 2. Comparison and recommendation
A comparison table across the options on: accuracy, visual quality, robustness to this scenario, effort, compute, maturity, and research novelty. A clear **recommended option**, the conditions under which you would switch to another, and a **decision tree** for "if X fails, do Y" during development.

### 3. Experiment and validation plan
Phased plan:
- Phase 0: a pilot capture in a small section.
- Phase 1: the baseline end to end.
- Phase 2: ablations of the filtering stages and pose methods.
- Phase 3: the full lot.

Each phase gets a success criterion (e.g. checkpoint RMSE < X cm, registration > 95%, loop-closure gap < Y). Specify the ablations that would make this publishable, i.e. what the novel contribution could be.

### 4. Repository / module architecture sketch
A suggested module layout (ingest, frame selection, masking, projection, SfM, scale, dense, splat, eval, report), the configuration approach, run-directory conventions, and which outputs each module logs, so that Claude Code can implement it.

## Deliverable
`research/A4_system_design.md`, about 3,500–5,000 words, containing:
- the options, with a **Mermaid diagram per option** in fenced ```mermaid blocks (the HTML builder will render them);
- the comparison table, recommendation, decision tree, experiment plan and architecture sketch;
- interactive-component suggestions (e.g. a pipeline explorer where clicking a stage shows its inputs, outputs and risks; or an option comparator with sliders weighting accuracy vs. effort);
- the Handoff and the JSON sources block.
