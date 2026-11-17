# Review round 1: report_v1.md

Reviewer: agent R (research reviewer). Date: 2026-11-17. Inputs: `research/report_v1.md`, `research/sources.json`, the six agent files, the agent prompts and `shared_context.md`.

## 1. Summary

This is a strong report. The central technical claims behind the recommended system check out against primary sources: COLMAP's perspective, fisheye and EUCM models cannot project rays with θ ≥ 90°; COLMAP's own changelog prefers rendered perspective views; and gsplat's FTheta + unscented-transform path is the one route that renders beyond 180°. The RIGOR, PPISP, 3DGUT, WildGaussians, SpotLessSplats, Doppelgangers, LoMa, VGGT and gravity-rotation-averaging numbers were also confirmed. None of the "Known errors" has come back. The selection protocol was applied in Ch. 3–6, with score tables and justified picks, and the cross-chapter contracts in Ch. 6 are unusually careful.

Four things need fixing before approval:

1. **The splat-quality anchor misreads Gunes 2026.** The report quotes only the two best of five indoor scenes and misstates the 160° result. It also ignores a newer paper (GOFish, Oct 2026), already cited in Ch. 3, whose evidence bears directly on the Ch. 5/Ch. 6 primary path.
2. **The 360° accuracy anchors are partly misread** in Ch. 6's sanity check, which is the argument behind the adopted accuracy plan.
3. **Indoor flight safety leaves out signal-loss / failsafe-RTH behaviour.** The DJI manual says a GNSS-denied aircraft may drop into ATTI mode and auto-land during failsafe RTH. In a concrete garage, a lost radio link is a likely event.
4. **The primary dense method has no indoor accuracy evidence at all.**

There are also several editorial defects, the most visible being a find-and-replace artefact that garbles the Ch. 3 ablation ladder and the marker-size text.

## 2. Fact-check log

Tags: **correct**; **wrong**; **partly wrong**; **unsupported**; **could not verify**. All sources were opened in this review unless a row says otherwise.

| # | Claim (location) | Cited source | Verdict | Correction / note |
|---|---|---|---|---|
| 1 | Every COLMAP perspective/fisheye model, EUCM included, rejects w < ε in `ImgFromCam`; the fisheye base maps through θ = atan(r); the default bearing unprojection is documented as valid only "for … fisheye-with-FOV<=180°" (Exec. summary, §4.1, Editorial note 2) | COLMAP `base.h`, `eucm.h`, `fisheye.h` (main) | correct | `HasProjectableDepth` is called in `eucm.h` and `fisheye.h`, and `FisheyeFromNormal` uses `atan(r)`. Even with cheirality off, atan(r) < 90°. |
| 2 | 4.1.0 spherical models are "generally faster but less accurate than rendering perspective views" (§2.5.3, §4.1.1) | COLMAP CHANGELOG 4.1.0 | correct | — |
| 3 | 4.0.0 integrated GLOMAP; 4.1.0 added Caspar ("often 1-2 orders of magnitude faster"), EUCM and advancing-front meshing | CHANGELOG | correct | — |
| 4 | 4.2.0 added multi-component global mapping, LoMa, tangent Sampson, rig sequential pairing and `loop_detection_min_index_distance`; 4.2.1 restored legacy global BA and fixed a LoMa leak (§4.2.1) | CHANGELOG 4.2.0/4.2.1 (dated 08/31 and 09/29/2026) | correct | — |
| 5 | gsplat `main` is `version.py` 1.6.0. The `fisheye` model rejects `cam_ray.z <= 0`. FTheta has no z guard and models FOV beyond 180°. Wide FTheta needs `global_z_order=False`. `ftheta_coeffs` are "shared for all cameras" (§5.2.2, §6.1.2) | gsplat `version.py`, `Cameras.cuh` (l. 1610–1612), `rendering.py` | correct | — |
| 6 | `simple_trainer` defaults: `normalize_world_space=True`, `test_every=8`, `post_processing ∈ {bilateral_grid, ppisp}`; `rolling_shutter`/`viewmats_rs` exist in `rasterization` (§5.5, §5.6.1) | gsplat `simple_trainer.py`, `rendering.py` | correct | — |
| 7 | Latest tagged gsplat release v1.5.3 (§5.2.2) | gsplat releases page | could not verify | GitHub releases/API were blocked here. Low impact. |
| 8 | nerfstudio pins `gsplat==1.4.0`; the splatfacto FAQ answers fisheye/equirect rendering with "Currently, no" (§5.2.2) | nerfstudio `pyproject.toml`, `docs/nerfology/methods/splat.md` | correct | — |
| 9 | PPISP: authors, controller for novel views, per-camera vignetting/CRF, Apache-2.0, in gsplat since Jan 2026 (§5.3.1) | arXiv 2601.18336, ppisp README/LICENSE, gsplat README | correct | The CVPR 2026 venue is not stated on arXiv or in the README: tag it [UNVERIFIED] or cite the source for it. |
| 10 | RIGOR: 30 HTO sequences, median ATE 2.312 m (DA3-Legacy 2.704), ROI CD 0.132 m, F@25 cm 0.873; evaluation "does not assess recovery of metric scale" (§4.2.2) | arXiv 2609.13504 (HTML) | correct | — |
| 11 | Gunes 2026: 3DGUT "22.16/20.91 dB on two indoor scenes at 200°", "stable when cropped to 160° while Fisheye-GS improved"; SfM init "often fails" (§6.4, Exec. summary "~21–22 dB") | arXiv 2508.06968 (HTML, Table 1) | **partly wrong** | FIORD has **five** indoor scenes. 3DGUT at 200°: Kitchen 22.16, Hall 20.91, Meeting 20.93, **Building 17.54, Upstairs 16.64**. The two "larger indoor areas" are the most garage-like and score lowest. **Both** methods are best at 160°: 3DGUT at 160° gets 23.29 / 22.67 / 22.32 / 19.46 / 20.61. Gunes also uses a standard 90/10 frame-skip split on stills from an Insta360 One RS, so its numbers are an upper bound for block hold-out on compressed video. "often fails" is not verbatim: the abstract says "the common failure of SfM initialization". See Issue 1. |
| 12 | Barazzetti 2018: Xiaomi Mi Sphere, 10.9×6×3.7 m room, poor light/texture, 6 GCPs, 11 CPs, Leica TS30, RMSE 4.6–7.2 mm per axis, dense cloud vs laser ±2.5 mm (§4.5.2) | ISPRS Archives XLII-2 PDF | correct | — |
| 13 | Ch. 6 §6.3: Barazzetti's camera has "~3× more px/deg" than ours | same PDF | **wrong** | The images are 6912×3456, i.e. **19.2 px/deg**, about the same as the Avata's native 18.3 px/deg. See Issue 3. |
| 14 | Perfetti 2024: 1 cm with appropriate control; 5–10 cm drift when partially unconstrained; rig constraint + IO/RO in BA best; pre-calibrate IO in less stable environments (§4.1.4, §4.5.2) | Remote Sensing 16(23) abstract (Semantic Scholar) | correct | — |
| 15 | Janiszewski 2022: 10 m tunnel, 27 stations, 4.6 mm vs laser (§4.5.2) | Remote Sensing 14(21) abstract | correct | — |
| 16 | Gómez-López 2025: Kandao Obsidian Go, 6 fisheyes, 1728², 30 fps; 4 GCPs at the start and CPs at the end; > 10 cm max CP residual; M2M mean 2.4 cm / SD 7.7 cm; "~2 cm in lit nave" (§4.5.2, §6.3) | ISPRS Archives XLVIII-M-9 PDF | partly wrong (framing) | Numbers are right, but the "~2 cm" is a **mesh-to-TLS difference in the lit central nave**, not checkpoint RMSE. Ch. 6 uses it as "the only video anchor gives 2 cm" checkpoint accuracy. The camera also samples ~1728 px over 220°, roughly **7.9 px/deg**, i.e. 2.3× coarser than the Avata. See Issue 3. |
| 17 | GLOMAP on ETH3D SLAM: ~8% higher recall, +9/+8 AUC@0.1/0.5 m vs COLMAP, ~10× faster; rotation averaging collapses on symmetric *exhibition_hall* (§4.2.1, §4.6.3-B) | arXiv 2407.20219 (HTML) | correct as quoted from the text; caveat | The paper's own Table 1 averages show a much smaller margin: recall 80.8 vs 79.2, AUC@0.1 m 88.5 vs 86.5, time 16.5 vs 27.5 s. Quote the table, or note the discrepancy. Minor. |
| 18 | Gravity-aligned RA: +13 AUC@1°, ~8× faster (§4.2.5) | arXiv 2410.12763 | correct | — |
| 19 | Doppelgangers: 95.2% AP, 93.8% ROC AUC; MIT licence (§3.4) | arXiv 2309.02420 (Table), repo LICENSE | correct | — |
| 20 | Doppelgangers++ licence CC BY-NC-SA 4.0 (Ch. 3, §6.2) vs "[UNVERIFIED licence]" (§4.2.4) | doppelgangers-plusplus LICENSE | correct (Ch. 3); Ch. 4 inconsistent | Remove the [UNVERIFIED] tag in §4.2.4. |
| 21 | LoMa: authors; +18.6 mAA HardMatch, +21.4 InLoc over ALIKED+LightGlue (§4.2.3) | arXiv 2604.04931 | correct | — |
| 22 | VGGT peak memory 11.4 GB @ 50 frames, 21.2 GB @ 100; custom "VGGT License v1" (§4.2.3) | arXiv 2503.11651 Table 9; repo LICENSE.txt | correct | — |
| 23 | 3DGUT on ScanNet++ fisheye: 29.11 / 0.252 / 0.38 M vs Fisheye-GS 28.15 / 0.261 / 1.07 M; 3DGS on undistorted crops 22.76 (§5.2.1) | arXiv 2412.12507 Table 3 | correct | — |
| 24 | WildGaussians On-the-go avg 22.15 vs 3DGS 19.30; RTX 4090 (§3.5, §3.8.2) | arXiv 2407.08447 Tables 1, 3 | correct | — |
| 25 | SpotLessSplats: 22.60 → 26.08 (agg) / 26.11 (mlp) (§3.5) | arXiv 2406.20055 | correct | — |
| 26 | ORBIT: author list; arXiv title ORBIT++; revision accepted at CVPR 2026; COLMAP and others "struggle" (§2.5.3, §4.2.2) | arXiv 2608.22039 | correct | The "≥ 36% of clips fail completely" figure was not re-checked. |
| 27 | IM360: authors; +3.5 PSNR for textured mesh; SOTA localisation on Matterport3D/Stanford2D3D (§5.1) | arXiv 2502.12545 | correct | ICCV venue taken from shared context. |
| 28 | Seam360GS (ICCV 2025, Shin/Cho/Kim); DirectFisheye-GS (CVPR 2026 Highlight); GOFish (arXiv 2610.37818) | arXiv metadata | correct | Seam360GS numbers not re-checked. |
| 29 | DJI manual: no photo/video before takeoff; ATTI when vision and GNSS both fail, no hover/brake, land ASAP in confined spaces; vision fails over repeating patterns, asphalt and textureless surfaces; extra caution < 300 lux; SmartPhoto default at 120 MP; FocusTrack FOV 104°; MTOM 455 g; battery ≈ 149.5 g (Ch. 1) | DJI Avata 360 User Manual (dl.djicdn.com) | correct | The same manual also covers **failsafe RTH → ATTI → auto-land** when positioning is abnormal, which the report omits (Issue 4). |
| 30 | DJI spec-page items: 1/1.1″, f = 2.5 mm, f/1.9, FF 1.5 m–∞, ISO ceilings 12 800/25 600, 180 Mbps, speeds (Ch. 1) | dji.com/uk/avata-360/specs | could not verify | Every dji.com regional spec/FAQ URL returned a **404 "DJI United States"** page from this sandbox. Search snippets confirm 1/1.1″, 200°, 180 Mbps and 455 g only. Not a defect in the report. |
| 31 | Licences: OpenMVS AGPL-3.0, PPISP Apache-2.0, LightGlue Apache-2.0, ALIKED BSD-3, 3DGRUT Apache-2.0 (v2.0.0 June 2026, ScanNet++ avg 29.22), PGSR custom ZJU non-commercial (§6.2) | LICENSE files, 3dgrut README | correct | The pyceres licence file could not be fetched (could not verify). |
| 32 | Known-errors list: Kerbl et al. SIGGRAPH 2023; DUSt3R CVPR 2024 without SuperGlue; "360" in Mip-NeRF 360 = unbounded orbit; vanilla 3DGS does not handle exposure; reprojection error ≠ accuracy (§2.3–2.4, §2.1.7) | sources.json + text | correct | No regression. |
| 33 | GOFish: built on the 3DGUT codebase; on full-200° FIORD, 3DGUT+PPISP "stops at 160°" (Hall_In 18.93 dB full-FoV vs GOFish 25.10); +2.28 dB over the best prior on FIORD; best mesh F-score on FIORD and ScanNet++; trained on a 24 GB A10G | arXiv 2610.37818 (HTML) | — (not used by the report) | Relevant missing evidence for Ch. 5/6: see Issue 2. |

Spot-checked [CALC]s that were correct: seam table (b/d), 8K px/deg, bpp, the EV/ISO estimate, Gaussian memory (59 floats, 0.94 KB), PLY 248 B, 7/m × 1.25 km frame count, ALIKED DB size, the 9 M → 3 M pair estimate, ±δ mask area = sin δ, and the 1-frame offset of 0.4° at 25 fps and 10°/s.

## 3. Issues

### Issue 1: The splat-quality anchor cherry-picks Gunes 2026 and misstates its FOV finding
- **Severity:** Major
- **Location:** Exec. summary ("Expected outcome"); Ch. 6 takeaway 6; §6.4 (Gunes bullet); §6.5.4; §6.9 Phase 0a/1 gates; §6.8.2 switch criteria.
- **Problem:**
  - The report says the "one published evaluation" of 200° indoor splatting gives ~21–22 dB. It quotes only the two best of five indoor scenes. The larger indoor scenes, closest to a garage, give 17.5 and 16.6 dB for 3DGUT at 200°; the indoor mean is ≈ 19.6 dB.
  - It says 3DGUT was "stable when cropped to 160°". In fact Gunes's abstract and table show **both** methods are best at 160°, with 3DGUT gaining about 1–4 dB per scene.
  - Gunes uses a 90/10 frame-skip split on uncompressed stills, so its numbers are optimistic relative to the report's own block hold-out protocol on 0.1 bpp video.
  - Consequences: the Phase 1 gate "PSNR ≥ 21 dB" and the Phase 0a gate "≥ 20 dB on FIORD" are set from a best case. The decision to train to θ_max ≈ 103° (≈ 206° FOV) is presented without the evidence that pushing past ~160–170° costs quality.
- **Required fix:**
  - Report all five indoor 200° scenes (range 16.6–22.2 dB) and the 160° results correctly.
  - State the protocol differences (stills, frame-skip split) and lower the planning anchor to roughly 17–22 dB, or justify the higher number.
  - Re-derive the Phase 0a/1 PSNR gates.
  - In §5.7.5 / §6.8.2, make "max_angle ∈ {80°, 90°, 97°, 103°}" a Phase 0a experiment on FIORD before committing to a full-rim splat. Say explicitly that the rim band may be better left to the virtual-view fallback. Correct the "often fails" quote.
- **Responsible agent:** A4 (with A3c for §5.7.5); orchestrator for the exec summary.

### Issue 2: GOFish is omitted as a Ch. 5 candidate even though it targets exactly this case
- **Severity:** Major
- **Location:** §5.2.1, §5.7.1–5.7.5 (long list, screening, scores), §6.4 precedents, Option B (§6.6), Exec. summary ("the one published evaluation"). Ch. 3 §3.2.2 already cites [Tu2026GOFish].
- **Problem:** GOFish (arXiv 2610.37818, Oct 2026) is a 3DGS surface method that trains directly on >180° fisheyes, rasterises the full field of view and extracts a mesh. It is built on the 3DGUT codebase.
  - On 200° FIORD it reports +2.28 dB over the best prior method. Its Hall_In figure shows 3DGUT+PPISP at 18.93 dB full-FoV, because 3DGUT "stops at 160°", against 25.10 dB for GOFish.
  - It also reports the best mesh F-score on FIORD and ScanNet++, against PGSR and others.
  - This contradicts the "one published evaluation" framing. It is direct evidence on the feasibility of the Ch. 5 primary (3DGUT/FTheta to 103°), and it is a plausible fisheye-native **Option B** candidate (geometry + visual from raw fisheyes) that would avoid B's main weakness, the loss of the rim band.
- **Required fix:**
  - Add GOFish to the Ch. 5 long list. Deep-dive it: method, FIORD results, memory (it uses a 24 GB A10G, so the 16 GB budget is a question), code and licence status from https://3dgofish.github.io.
  - Score it, and either adopt it as the experimental pick or screen it out with reasons.
  - Reflect it in Ch. 6 §6.4 and in Option B/C, and fix the exec-summary wording.
- **Responsible agent:** A3c (re-research), then A4.

### Issue 3: Ch. 6's re-reading of the accuracy anchors contains factual errors
- **Severity:** Major
- **Location:** §6.3 anchor table and "Why 0.5–1.5 cm is optimistic"; Editorial note 1; §4.5.2 "Reading the table".
- **Problem:**
  - (a) Barazzetti's camera is 6912×3456 (19.2 px/deg), not "~3× more px/deg" than ours; angular resolution is essentially equal. Its distance from our case is about stills, total station, a single room and no codec, not resolution.
  - (b) Gómez-López's "~2 cm where lit" is a mesh-to-TLS difference in the lit nave, not checkpoint RMSE. The checkpoint figures there are 4.8 / 6.9 / >10 cm maxima with control at one end. That camera also has ~7.9 px/deg, 2.3× coarser than the Avata.
  - The adopted plan (1–2 cm local, 0.05–0.3% global) may still be right, but the argument for it currently rests on two misread anchors. Correcting them pulls in opposite directions: (a) makes the stills anchor more relevant, while (b) shows the video anchor's 2 cm is not a checkpoint number.
- **Required fix:**
  - Correct both rows: give the resolution of each anchor in px/deg, and the metric type (CP RMSE vs M2M).
  - Restate the reasoning for the planning numbers, and update Editorial note 1 and the exec summary if the numbers change.
  - Add a short "anchor comparability" column (px/deg, stills vs video, control layout, metric type) to the §4.5.2 table.
- **Responsible agent:** A4 (with A3b for §4.5.2).

### Issue 4: Indoor flight safety omits link loss and failsafe RTH in a GNSS-denied space
- **Severity:** Major
- **Location:** §1.5.8, §1.6 (Flight), Exec. summary risk 4, §7.1 #8.
- **Problem:**
  - The manual states that during failsafe RTH the aircraft may enter ATTI mode and land automatically if positioning is abnormal. It also says that without GNSS the aircraft cannot return home normally.
  - In an underground lot, loss of the video/control link behind concrete pillars, ramps and walls is likely. The default failsafe behaviour (RTH) is unsafe there.
  - The report covers ATTI from vision loss, but never mentions link range, failsafe action settings, or the < 300 lux APAS caution in the context of a garage that Ch. 1 estimates at 50–150 lux.
- **Required fix:**
  - Add a short subsection: expected link behaviour underground (unverified, so measure it in the pilot); set the failsafe action to Hover/Land rather than RTH, if DJI Fly offers it (verify in the manual); keep line of sight with a spotter; fly segment by segment with the pilot following.
  - Add a pilot test of link range in the lot to §7.1 / Phase 0b.
- **Responsible agent:** A1.

### Issue 5: The primary dense method has no indoor accuracy evidence
- **Severity:** Major
- **Location:** §4.4.2 table (COLMAP PatchMatch and OpenMVS rows: "[UNVERIFIED numbers]" / "No paper numbers verified"), §4.6.4 dense scores (Evidence = 4 for OpenMVS), §7.2.
- **Problem:** The A3b prompt asks for accuracy on indoor benchmarks, preferring ScanNet++, ETH3D or Replica. The recommended dense baseline is scored "Evidence 4" with no reported number. The surface-Gaussian rows carry only DTU/TnT numbers, which the chapter itself calls object- or outdoor-scale. The only indoor-real number is Barazzetti's ±2.5 mm, which is a whole-pipeline result on stills, not a method comparison.
- **Required fix:**
  - Pull at least the ETH3D high-res multi-view indoor-scene F-scores at 2 cm / 5 cm for COLMAP and an OpenMVS- or ACMM-class method from the public leaderboard or papers.
  - Pull ScanNet++ / Replica mesh metrics for PGSR / 2DGS / DN-Splatter where published. GOFish's ScanNet++ table is one source.
  - Re-justify the Evidence scores or adjust them.
- **Responsible agent:** A3b.

### Issue 6: An agent-ID → chapter find-and-replace garbled several passages
- **Severity:** Minor (clarity, but it breaks the ablation design)
- **Location:**
  - §1.6 Markers: "A3 (~30 cm) markers … **Ch. 6 (~20 cm)**". This was A4 paper size.
  - §4.3.1: "Ch. 6: ≤ 3–4 m"; "(A1-consistent)".
  - §3.7 ablation ladder: "A0, **Ch. 1**, **Ch. 2**, A3, **Ch. 6**, A5: **Ch. 6** but …, A6, A7"; also §3.8.4 "the **Ch. 2–Ch. 6** ablations" and "the **Ch. 6** side test", and §3.10 #2.
  - §5.7.4 "S6 A3b-depth-regularised GS"; §6.2 "[see Ch. 4/A3a]", "[see Ch. 2/A3c]", "[see Ch. 3/A3b]"; the §6 evidence note "Ch. 1/A3a/A3b/A3c".
- **Problem:** The ablation arms read as chapter references, and the marker size reads as a chapter.
- **Required fix:** Restore the ablation arm labels A0–A7 (or rename them, e.g. F0–F7, so they cannot be confused with agent IDs). Write "A4-paper (~20 cm)" or simply "~20 cm". Replace the remaining agent IDs with chapter numbers.
- **Responsible agent:** orchestrator.

### Issue 7: Score-table arithmetic errors
- **Severity:** Minor
- **Location:** §4.6.4 (poses) and §3.8.3.
- **Problem:** With the stated weights:
  - Ch. 4: C = 2·3+4·2+5·2+2·3+4 = **34** (listed 35); H = **31** (30); F = **26** (28); G = **25** (24).
  - Ch. 3: S7 WildGaussians = **35** (37).
  - The picks do not change, but H now ranks above E, and S7 falls below S4.
- **Required fix:** Recompute the totals and re-sort the tables.
- **Responsible agent:** A3b, A3a (or orchestrator).

### Issue 8: The pipeline tables in Ch. 4 and Ch. 5 still carry selection rules that Ch. 6 overrides
- **Severity:** Minor
- **Location:**
  - §4.7 stage 2: whole-frame |ω| > 10°/s reject + Laplacian outliers, 2–3 fps.
  - §5.8 step 2: one frame per 0.2–0.3 m, ω < 10°/s, whole-frame Laplacian.
  - §5.3.3 Assessment item 1.
- **Problem:** Editorial note 4 resolves frame density, but not the IMU-gate conflict. §6.1.6 sets frames > 16°/s rejected, 10–16°/s rim sectors masked, and 7/m. A reader implementing from Ch. 4 or Ch. 5 tables gets the wrong rule.
- **Required fix:** Add an Editorial note for the IMU gate and per-sector masking, and cross-reference §6.1.6 inside §4.7 and §5.8.
- **Responsible agent:** orchestrator.

### Issue 9: Stale or unsupported statements in Ch. 2
- **Severity:** Minor
- **Location:** §2.1.2, §2.1.6, §2.2.3, §2.5.1.
- **Problem:**
  - §2.1.2 states "the two lenses' 2–3 cm baseline" as fact. It is unpublished; Ch. 1 gives 2–4 cm, [UNVERIFIED].
  - §2.1.2 says "Section 5 returns to this"; it should be §2.5.
  - §2.1.6 says "neither GNSS nor (usable) IMU logs by default". This contradicts Ch. 1 (fused attitude quaternions at 1–4 kHz).
  - §2.2.3 and §2.5.1 still defer questions "to other agents / the hardware agent" that Ch. 1 has answered (raw dual-fisheye is available in OSV; attitude is available, metric IMU acceleration is not usable).
- **Required fix:** Edit these sentences to match Ch. 1 and use chapter cross-references.
- **Responsible agent:** orchestrator (A2 content).

### Issue 10: Minor numeric and consistency slips
- **Severity:** Minor
- **Location and fix:**
  - Ch. 1 key takeaway 3 says "At 2 m … about 1 mm/px"; §1.3 and §4.5.3 give ≈ 1.9 mm/px at 2 m. Use 1.9 mm.
  - Ch. 6 takeaway 2 says full-lot compute is "about 2–3 days"; §6.5.3, §6.8.1 and the Exec. summary say 2.5–4 days. Harmonise.
  - §4.2.4 lists the Doppelgangers++ licence as [UNVERIFIED]; it is CC BY-NC-SA 4.0 (verified, and stated in Ch. 3 / §6.2). Its venue is still [UNVERIFIED]; check it (likely CVPR 2025).
  - GLOMAP's ETH3D SLAM margin: quote the paper's Table 1 averages, or flag the text-vs-table gap (fact-check #17).
  - PPISP venue: add the source or tag it [UNVERIFIED].
- **Responsible agent:** orchestrator.

### Issue 11: Quotation rule (at most one quote per source)
- **Severity:** Minor
- **Location:** §2.5.3, §4.1.1, Exec. summary / §2.4.4, §4.1.2, §4.2.1.
- **Problem:** The COLMAP changelog is quoted repeatedly:
  - "generally faster but less accurate…" (several times);
  - "often 1-2 orders of magnitude…";
  - "pixel-consistent tangent Sampson error";
  - "particularly improves…";
  - "improved sequential pairing for camera rigs".
  All quotes are short, but the rule allows one quote per source.
- **Required fix:** Keep the one key quote ("less accurate than rendering perspective views") once, and paraphrase the rest.
- **Responsible agent:** orchestrator.

### Coverage and scenario-fit notes (no action beyond the issues above)
- Every required question in A1–A4 is addressed, and each A3 sub-question cites 2–3 or more examples. The protocol (long list → screening → deep dives → scores → three picks with "what would change my mind") is applied in Ch. 3, 4, 5 and 6.
- The camera limitations are carried through well. Filtering is direction-aware (per-sector IMU blur, §3.2). Geometry avoids seam parallax by construction (two-centre rig). The overlap band is treated as rim rather than seam (§6.1.5). Defocus and RS budgets are propagated into Ch. 4 and Ch. 5.
- Reported results and assessment are kept separate throughout. The [OPENED]/[ABS]/[SNIPPET] tagging is helpful.
- The A3b gaps (indoor dense numbers) and A3c gaps (GOFish) are covered by Issues 5 and 2.

**Verdict: REVISE**
