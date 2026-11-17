# Shared context: read this before doing anything

## The reader
Thelet is a third-year CS student and ML engineer, comfortable with PyTorch, papers and GPU training. He builds prototypes first and diagnoses through real data. He wants **deep explanations: theory, trade-offs, alternatives and research context**, not just instructions. He is new to photogrammetry and 3D Gaussian Splatting specifically. Write for a strong engineer who is new to this subfield.

## The task the research serves
Build a pipeline that turns **360° video from a DJI Avata 360 drone** into:
1. **Primary:** an **accurate, metrically scaled 3D reconstruction** (mesh / dense point cloud) of an **underground parking lot**. Target accuracy: a few cm locally and ≤1% of distance globally, verified against held-out tape or laser measurements between printed markers.
2. **Secondary:** a **photoreal, explorable visualization** (3D Gaussian Splatting or a successor).

## Scenario constraints (these make it hard)
- **No GNSS/GPS** underground. Scale must come from measured markers or known dimensions.
- **Dim, artificial and possibly flickering light** → noise, motion blur, exposure changes.
- **Highly repetitive structure** (identical pillars, bays, signs) → risk of false loop closures and "folded" maps.
- **Textureless surfaces** (concrete floors and ceilings, painted walls).
- **Reflective and specular surfaces** (car paint, windows, wet floors); possibly moving cars and people.
- **FPV-style flight** → fast rotations, rolling-shutter effects.
- Footage is **stitched 360° (equirectangular)** from a dual-fisheye camera, which introduces stitch seams and parallax error near the seam.

## Compute and tooling
- One **16 GB NVIDIA GPU**, a normal workstation CPU and RAM.
- Open-source tools preferred. Commercial tools (Metashape, RealityScan, Postshot…) may be mentioned as reference points.
- Development happens with Claude Code as the implementing engineer.

## Already verified (do not re-litigate; build on it)
- DJI Avata 360: dual 1/1.1″ sensors, 64 MP each, ~200° lenses, 360° video up to 8K (7680×3840) at 60 fps and 6K, OSV/MP4 (H.265), up to 180 Mbps bitrate; announced March 2026. (Verify further details yourself.)
- COLMAP 4.1.0 added native spherical/equirectangular camera models. Its own release notes call native equirectangular **"generally faster but less accurate than rendering perspective views"** (the `panorama_sfm` example). COLMAP 4.0 integrated GLOMAP global mapping. 4.2.0 added multi-component global mapping and LoMa learned matching.
- IM360 (Jung, Choi, Lee, Manocha; ICCV 2025): spherical-model SfM with dense matching, plus neural surface reconstruction, for large indoor 360° mapping.
- RIGOR: arXiv 2609.13504 (2026), rig-informed geometry for omnidirectional reconstruction; gravity-aligned panoramas projected into four perspective views.
- ORBIT (CVPR 2026): a benchmark showing COLMAP and other SfM methods still struggle on challenging real-world 360° video.

## Known errors from an earlier AI-written report (do not repeat them)
- 3D Gaussian Splatting is **Kerbl, Kopanas, Leimkühler, Drettakis, SIGGRAPH 2023** (not "Liu et al.").
- DUSt3R is **CVPR 2024** (not NeurIPS), and it does not use SuperGlue.
- "360" in Mip-NeRF 360 means **unbounded scenes captured by orbiting a camera**, not panoramic input.
- Vanilla 3DGS does **not** "naturally handle varying exposure"; that requires appearance or exposure modeling.
- Reprojection error measures **self-consistency, not accuracy**. A map folded by a false loop closure can have low reprojection error.

## Research rules (apply to every agent)
1. **Primary sources:** paper (arXiv, CVF, IEEE, ACM), official repository, official docs and release notes, official DJI pages. Use secondary sources (reviews, blogs) only for hands-on experience, and label them as such.
2. **Open what you cite.** Fetch the actual page for every key claim; do not cite from search snippets alone. Copy author lists, venues and years exactly.
3. **Separate** *reported results* (numbers from the paper, with dataset and metric) from *your assessment*.
4. Tag anything you could not verify as **[UNVERIFIED]**. Never invent numbers, authors, venues, repository URLs or licences.
5. Note **code availability and licence** (flag non-commercial licences such as CC BY-NC).
6. Prefer **2023–2026** work, but include older foundational methods when they are still the best option.
7. **Copyright:** paraphrase. Keep quotes under 15 words, at most one per source.
8. Judge everything by **fit to this scenario**: underground, repetitive, dim, no GPS, 360°, accuracy-first, 16 GB GPU.

## Method selection protocol (A3a, A3b, A3c, A4)
1. **Long list:** collect 12–25 candidate methods/papers/tools across families. Classic, learned and recent work all count.
2. **Screen:** drop anything clearly off-scenario. Keep one line per dropped item explaining why.
3. **Deep-dive the short list (5–8):** for each one, actually read the method and experiments sections. Record:
   - the core idea;
   - its assumptions (and which ones the scenario violates);
   - reported results (dataset, metric, numbers);
   - compute needs vs. 16 GB;
   - code: does it exist, its licence, last commit date, whether issues show it is usable;
   - known failure modes.
4. **Score** each short-listed item from 1 to 5 on:
   - Scenario fit (underground/repetitive/dim/360°) ×3
   - Evidence strength ×2
   - Implementability (code, licence, 16 GB) ×2
   - Accuracy or quality impact ×3
   - Maturity/risk ×1

   Show the score table, and justify every score in one line.
5. **Pick:** state your **primary recommendation**, a **runner-up**, and one **high-upside experimental** option. Give the reasoning, and say what evidence would change your mind.
6. **Examples of relevant work:** for every sub-question, cite at least 2–3 concrete papers or projects as examples, with a short description of what they did and their result.

## Output conventions (every research agent)
- Write your section to `research/<AGENT_ID>.md` in Markdown.
- Use inline citation keys like `[Kerbl2023]`, and append a fenced ```json block at the end of the file holding a list of source objects:
  `{"key": "...", "title": "...", "authors": "...", "venue": "...", "year": 2025, "url": "...", "code": "url or null", "license": "... or null", "type": "paper|repo|docs|official|secondary", "verified": true}`
- Finish with a short **"Handoff"** section of 5–10 bullets: the facts and decisions downstream agents must know.
