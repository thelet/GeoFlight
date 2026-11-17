# Review round 2: report_v2.md

Reviewer: agent R (research reviewer). Date: 2026-11-17. Inputs: `research/report_v2.md` (including its v1 → v2 changelog), `research/review_round_1.md`, `research/sources.json`, the six agent files, the agent prompts and `shared_context.md`.

## 1. Summary

v2 resolves all five Major items from round 1 in the body of the report, not just in the changelog.

- **Splat anchor:** Gunes 2026 is now reported in full: all five indoor scenes, both FOV findings and the protocol caveats.
- **GOFish:** added, deep-dived, scored and given a promotion rule.
- **Accuracy anchors:** both corrected, with comparability columns.
- **Failsafe:** link loss and failsafe behaviour have their own subsection with manual page citations.
- **Dense evidence:** the dense stage now has ETH3D indoor and ScanNet++/FIORD evidence.

Every new number I checked against its primary source was correct: GOFish, Gunes, ETH3D (via MP-MVS and ACMM), DN-Splatter, DJI manual p. 52/54/63, Gómez-López, GLOMAP, Seam360GS and FIORD. Licences and venues are also right: GOFish CC BY-NC 4.0, Doppelgangers++ CVPR 2025 / CC BY-NC-SA 4.0, and PPISP CVPR 2026.

The new planning numbers are consistent everywhere they appear: the exec summary, Ch. 4, Ch. 5, Ch. 6 and Ch. 7. That covers 17–21 dB PSNR, the 80° default `max_angle`, 1–2 cm / 0.05–0.3% accuracy, 2.5–4 days of compute, and every score total, which I recomputed.

What remains is minor:
- One attribution error that I missed in round 1: Barazzetti's "±2.5 mm" is not a comparison against laser scanning.
- A slightly simplified RTH description.
- A few cross-chapter leftovers.
- Two round-1 Minor items that are only partly fixed.

No Critical items remain.

## 2. Round-1 items: resolved / partially / not resolved

| # | Round-1 item (severity) | Status | Evidence in v2 body |
|---|---|---|---|
| 1 | Gunes anchor cherry-picked; 160° finding misstated (Major) | **Resolved** | §5.2.1(c), §5.6.1, §6.4 and Ch. 6 takeaway 6 give all five scenes (16.6–22.2 dB, mean 19.6), the 160° numbers for both methods (+1.1 to +4.0 dB for 3DGUT) and the protocol caveats. The anchor is lowered to 17–21 dB and the gates are re-derived (Phase 0a ≥ 21 / ≥ 19.5 / GOFish ≥ 23; Phase 1 ≥ 17 / ≥ 19). The default is 80° and the sweep is a Phase-0a experiment (§5.7.5, §6.8.2, §6.9). The "often fails" misquote is corrected (§5.2.1, §6.4). |
| 2 | GOFish missing (Major) | **Resolved** | S9 deep dive (§5.7.3), score 44 and experimental pick with a promotion rule (§5.7.4–5.7.5); B-fish variant (§6.6.1); §6.4 precedent; Ch. 4 dense table; exec summary. |
| 3 | Accuracy anchors misread (Major) | **Resolved** | §4.5.2 comparability column; §6.3 table with px/deg, stills/video, control layout and metric type; reasoning restated; Editorial note 1. See new Issue 1 for one remaining Barazzetti attribution error, which I did not flag in round 1. |
| 4 | Link loss / failsafe missing (Major) | **Resolved** | §1.5.8.1 with manual pages; §1.6 pre-flight steps 4–5; §1.7 #13; §7.1 #11; takeaway 6. One description is simplified (new Issue 2). |
| 5 | No indoor evidence for dense (Major) | **Resolved** | §4.4.2 indoor column (ETH3D indoor F1 for COLMAP, ACMM and ACMMP; ScanNet++, MuSHRoom and FIORD F for the Gaussian-surface methods); caveats; ACMMP added as an A/B densifier; Evidence scores re-justified. The OpenMVS-specific number stays honestly [UNVERIFIED]. |
| 6 | Agent-ID find/replace artefacts (Minor) | **Resolved** | F0–F7 ablation arms (§3.7, §6.9); "A3-paper (~30 cm) / A4-paper (~20 cm)" (§1.6). No garbled patterns found by grep. |
| 7 | Score arithmetic (Minor) | **Resolved** | Recomputed every table in Ch. 3, 4, 5 and 6 (including B-fish 35 and A 48); all totals are correct. |
| 8 | Overridden selection rules in §4.7/§5.8 (Minor) | **Resolved** | Editorial note 7, plus notes at the head of §4.7 and §5.8. |
| 9 | Stale Ch. 2 statements (Minor) | **Partially** | Baseline, IMU and raw-fisheye statements now match Ch. 1. But §2.1.2 now says "§2.2.5 returns to this", and §2.2.5 is *Evaluation metrics*. It should be §2.5. |
| 10 | Numeric slips (Minor) | **Resolved** | 1.9 mm/px; 2.5–4 days; Doppelgangers++ venue and licence; PPISP venue (CVF page exists). **GLOMAP:** the authors are right. ETH3D SLAM Table 1 averages are recall 66.4 vs 57.9 and AUC@0.1 m 57.0 vs 47.6. My round-1 figures came from a different block of the table. I withdraw that comment. |
| 11 | Repeated COLMAP-changelog quotes (Minor) | **Partially** | §4.1.2 (l. 1270) still quotes the changelog twice ("pixel-consistent tangent Sampson error" and "particularly improves wide-field-of-view and…"), on top of the kept quote in §2.5.3. |

## 3. Fact-check log (round 2)

Every source was opened in this round (arXiv HTML/PDF, CVF, ISPRS PDFs, DJI manual PDF, GitHub raw files) unless a row says otherwise.

| # | Claim (location) | Cited source | Verdict | Correction / note |
|---|---|---|---|---|
| 1 | GOFish title, authors (Tu, Karumuri, Zhu, Wang, Lin, Held, Zwicker, Goldstein), arXiv 2610.37818 | arXiv abs | correct | — |
| 2 | FIORD full FoV: GOFish 24.36/0.827/0.210; DirectFisheye-GS 22.08 (+2.28); 3DGUT+PPISP (160°) 20.18; 3DGUT 19.86; 3DGRT+PPISP 18.42; Fisheye-GS 17.78 (§5.7.3) | GOFish Table 1/3 | correct | — |
| 3 | Hall_In 18.93 dB / LPIPS 0.285 vs 25.10 / 0.137; 3DGUT+PPISP "stops at 160°" (Fig. 1) | GOFish Fig. 1 | correct | — |
| 4 | Within the 160° cone GOFish gains 4.0 dB, of which 0.4 dB is appearance; peak 5.6 dB in the cutoff bin; ablation 21.21 → 21.19 → 24.36 (+3.17); F 0.139 → 0.240 → 0.245 | GOFish §5, Table 3 | correct | — |
| 5 | Mesh F: FIORD 0.245 (0.249 with the Geometry Objective) vs PGSR 0.239, CoMe 0.227, MiLo 0.210, GOF 0.198; ScanNet++ 0.706 vs 0.687 | GOFish Table 2 | correct | — |
| 6 | Per-scene F (FIORD, 10 cm): GOF Kit/Bld/Meet/Hall 0.554/0.139/0.367/0.063; PGSR 0.644/0.169/0.403/0.068; GOFish Hall 0.067; "≤ 0.18 on large rooms"; TnT mean ≈ 0.40 vs 0.51 [CALC] | GOFish Table 10 | correct | GOFish Building_In is exactly 0.180. |
| 7 | A10G 24 GB; 107 min training, 153 min with meshing; 0.60 M Gaussians; 79 FPS; OOM without the Mip filter (Hall_In training, Bridge_Out meshing); 8 of 14 cameras lose monotonicity, 6 have a dark rim band; Upstairs_In excluded | GOFish App. B, Table 9 | correct | — |
| 8 | GOFish licence CC BY-NC 4.0; README requires CC ≥ 7.0, Python 3.11, Slang | `tuallen/GOFish` LICENSE, README | correct | §4.4.2 still lists the licence as "[UNVERIFIED]" (Issue 4). |
| 9 | Gunes 2026: authors; VISAPP 2026 per the arXiv comment | arXiv 2508.06968 abs | correct | — |
| 10 | Gunes Table 1: 3DGUT at 200° 22.16/20.91/20.93/17.54/16.64; at 160° 23.29/22.67/22.32/19.46/20.61; Fisheye-GS at 200° 20.05/19.62/17.75/18.57/19.42; Upstairs Fisheye-GS dips at 160° (19.28); means 19.6/21.7/19.1/21.6 [CALC] | Gunes Table 1 | correct | 160°/120° are re-renders with an adjusted focal length, not masks of the 200° image (Issue 6). |
| 11 | Gunes: SfM initialisation "commonly fails" (paraphrased; abstract wording "common failure") | Gunes abstract | correct | — |
| 12 | ETH3D indoor test F1 at 2/5 cm: COLMAP 70.41/82.04 (acc 91.95/96.62, compl 59.65/73.00), training 66.76/78.49; ACMM 79.84/88.48 (compl 72.73); ACMMP 85.39/92.88 (compl 80.67), training 85.27/92.16; MP-MVS 87.64/94.07 | MP-MVS (arXiv 2309.13294) Table II | correct | — |
| 13 | ACMM at 10 cm 92.50 vs COLMAP 89.28; ~3× faster than COLMAP | ACMM CVPR 2019 Table 3 / text | correct | — |
| 14 | DN-Splatter ScanNet++ F 0.766, CD 0.067; MuSHRoom F 0.924, CD 0.022; 2DGS 0.420/0.104 and 0.604/0.069; MonoSDF 0.858/0.921, 47.5 min on a 4090 | DN-Splatter PDF Tables 1–2 | correct | — |
| 15 | DJI manual p. 54: signal lost > 6 s → Failsafe RTH if the action is RTH; can be Hover or Landing; RTH continues after signal restoration; a user-triggered RTH continues regardless of the action | DJI Avata 360 manual v1.0 | correct | — |
| 16 | p. 52 Notice: during Failsafe RTH the aircraft may enter ATTI and land automatically; p. 63: APAS caution < 300 lux; goggles ≠ VLOS; "Camera View Before Loss" | same | correct | — |
| 17 | §1.5.8.1: in unsuitable light the aircraft "brakes and hovers, then flies a Preset RTH … >5 m, lands <5 m" | same, pp. 54–55 | **partly wrong** | The manual says brake, hover, then **Original Route RTH**: fly back 50 m along the route if > 50 m away, otherwise fly **straight back horizontally at the current altitude** (5–50 m), and land if < 5 m. Preset RTH follows only after that. See Issue 2. |
| 18 | Barazzetti: 6912×3456 → 19.2 px/deg; 6 GCPs, 11 CPs, TS30; CP RMSE 4.6–7.2 mm per axis | ISPRS XLII-2 PDF | correct | — |
| 19 | Barazzetti: "dense cloud vs laser ±2.5 mm" (§4.4.2 caveat, §6.3 table; "±2.5–5 mm" in the §4.5.2 table; dense score justification) | same | **wrong attribution** | ±2.5 mm is the spherical-camera vs **Nikon D610 photogrammetric** cloud on a textured brick **wall** at ~1.5 m. The **laser** comparison (Faro Focus 3D) is **~5 mm**, in a **vaulted cellar**, not the 10.9 m room. See Issue 1. |
| 20 | Gómez-López: 6 × 220° fisheyes, 1728², 30 fps; 4 GCPs at the start, CPs at the end; maxima 4.8 / 6.9 / > 10 cm; ~2 cm in the lit central nave; QH31 M2M mean 2.4 cm, SD 7.7 cm; 7.9 px/deg [CALC] | ISPRS XLVIII-M-9 PDF | correct | Note that the 4 GCPs define a post-hoc 3D transformation, not BA control. That supports the report's "measures drift" reading. |
| 21 | GLOMAP ETH3D SLAM Table 1: recall 66.4 vs 57.9; AUC@0.1 m 57.0 vs 47.6; ~8% / +9 / +8 in text; 133.5 vs 1115.4 s | arXiv 2407.20219 | correct | My round-1 comment was wrong; withdrawn. |
| 22 | Doppelgangers++: authors, CVPR 2025 | CVF open-access page | correct | — |
| 23 | Doppelgangers++ licence CC BY-NC-SA 4.0 | repo LICENSE | correct | §4.2.4 #6 says it "was trained on landmarks, not garages", which contradicts §3.4's "broadened beyond landmarks to everyday scenes" (Issue 4). |
| 24 | PPISP: CVPR 2026; Deutsch, Moënne-Loccoz, State, Gojcic | CVF open-access page | correct | — |
| 25 | Seam360GS: ICCV 2025; 360Roam 26.10 vs 25.08 (OmniGS); Ricoh360 26.96 vs 26.06; gap MAE 0.115; raw dual-fisheye +0.34 dB | arXiv 2508.20080 | correct | — |
| 26 | DirectFisheye-GS: CVPR 2026 Highlight | arXiv 2604.00648 comment | correct | — |
| 27 | FIORD: SCIA 2025; Insta360 One RS 1-Inch, dual 200°, 3264² per lens, Faro LiDAR | arXiv 2504.01732 | correct | — |
| 28 | GOFish protocol details "every 8th image held out, 816² per lens" (§5.7.3, §5.6.1) | GOFish App. A.6 | could not verify | The values appear to be in math markup that did not extract. "Unrendered pixels count as black" is confirmed. Low impact. |
| 29 | DJI spec-page items (1/1.1″, ISO ceilings, 180 Mbps) | dji.com/uk/avata-360/specs | could not verify | The UK URL still returns a 404 "DJI United States" page from this sandbox, and the manual has no spec appendix. Not a report defect. |
| 30 | Known-errors list (Kerbl SIGGRAPH 2023; DUSt3R CVPR 2024; Mip-NeRF 360 meaning; exposure; reprojection ≠ accuracy) | text | correct | No regression. |

Recomputed [CALC]s: Gunes means; the 160° gains; PGSR FIORD six-scene mean 0.239; GOFish/PGSR TnT means; all score-table totals (Ch. 3: 8 rows; Ch. 4: 14; Ch. 5: 9; Ch. 6: 4 plus B-fish); compute 40–105 h → ~2–4.5 days; Barazzetti and Gómez-López px/deg.

## 4. Issues

### Issue 1: The Barazzetti dense-cloud figure is misattributed
- **Severity:** Minor. The ETH3D numbers now carry the dense-evidence argument, so no decision changes.
- **Location:**
  - §4.4.2, "Indoor caveats" last bullet;
  - §4.5.2 table ("dense vs. laser ±2.5–5 mm");
  - §4.6.4 dense score justification ("plus Barazzetti ±2.5 mm");
  - §6.3 anchor table ("dense cloud vs laser … ±2.5 mm").
- **Problem:**
  - The ±2.5 mm figure compares the 360° dense cloud with a **DSLR (Nikon D610) photogrammetric cloud** of a textured brick wall at ~1.5 m.
  - The laser-scanner comparison (Faro Focus 3D) gives **~5 mm**, in a **vaulted cellar**, not the 10.9 m test room.
- **Required fix:** State "~5 mm vs a laser scan (cellar); ±2.5 mm vs a DSLR cloud on a textured wall at ~1.5 m" wherever it appears. Drop it from the "~10 m room" framing.
- **Responsible agent:** orchestrator (A3b/A4 text).

### Issue 2: RTH behaviour in poor vision is simplified
- **Severity:** Minor. The recommendation, never RTH underground, is correct and if anything strengthened.
- **Location:** §1.5.8.1, "RTH without GNSS" bullet.
- **Problem:** The manual (p. 54–55) says that when conditions are unsuitable for vision, the aircraft brakes, hovers, then performs **Original Route RTH**:
  - more than 50 m from home, it flies back 50 m along the route before Preset RTH;
  - 5–50 m from home, it **flies straight back horizontally at the current altitude**;
  - under 5 m, it lands immediately.

  In a pillared garage, a straight-line return at current altitude is the most dangerous case.
- **Required fix:** Correct the sequence and add one sentence noting the straight-line return.
- **Responsible agent:** orchestrator (A1 text).

### Issue 3: Leftovers in Ch. 6 §6.3 and an internal compute mismatch
- **Severity:** Minor.
- **Location and fix:**
  - **§6.3 heading.** The bold lead "**Global 0.03–0.2%:**" is the v1 band. Rename it, e.g. "Why 0.03% is only a stretch value".
  - **Stretch values.** The §6.3 planning table gives the stretch value as **0.7 cm**; Editorial note 1, Ch. 4 and the exec summary say **0.5–1 cm**. Harmonise.
  - **Reference accuracy.** Ch. 6 takeaway 4 says the reference must be better than "~1.5 cm over 50 m"; the §6.3 body says "~1 cm". Harmonise.
  - **GOFish arm cost.** §6.5.3 says the arm adds "~2–4 h per zone"; §6.6.1 and §6.8.1 say "~6–12 h per zone". Use one figure.
  - **Rim band limits.** Editorial note 3 and Ch. 6 takeaway 2 say the rim band is "78–102°"; §5.7.5, §5.8 and §6.8.2 say "80–105°". Use one definition, or say that 78–102° is the view overlap and 80–105° the evaluation band.
- **Responsible agent:** orchestrator.

### Issue 4: Cross-chapter inconsistencies on GOFish's licence and Doppelgangers++ training data
- **Severity:** Minor.
- **Location:**
  - §4.4.2 GOFish row: "licence [UNVERIFIED]". It is CC BY-NC 4.0, verified here and stated in §5.7.3 and §6.2.
  - §4.2.4 item 6: Doppelgangers++ "was trained on landmarks, not garages". §3.4 says its training data were broadened to everyday scenes.
- **Required fix:**
  - Set the GOFish licence in §4.4.2 to CC BY-NC 4.0, with Gaussian-Splatting-licensed files.
  - Reword §4.2.4 #6 to say it was "trained on landmark and everyday scenes, not garages".
- **Responsible agent:** orchestrator.

### Issue 5: Round-1 Minor items 9 and 11 are only partly fixed
- **Severity:** Minor.
- **Location and fix:**
  - §2.1.2: "§2.2.5 returns to this" → "§2.5 returns to this".
  - §4.1.2 (the line on COLMAP 4.2's tangent Sampson error): paraphrase both quoted fragments. The single permitted changelog quote is the one in §2.5.3.
  - §5.2.1(c), Gunes bullet: the sentence "a quotation to that effect elsewhere in the project misstates it" is an editorial residue. Delete it; the preceding sentence is enough.
- **Responsible agent:** orchestrator.

### Issue 6: The Phase-0a "θ ≤ 80°" gate is not strictly like-for-like with Gunes's 160° numbers
- **Severity:** Minor. Note only; the gate itself is reasonable.
- **Location:** §5.6.1 gate 1, §6.9 Phase 0a, §6.8.3 node P0.
- **Problem:** Gunes's 160° (and 120°) sets are new images, re-rendered with an adjusted focal length. A 160° image therefore spends its full pixel width on 160°, i.e. more px/deg than the θ ≤ 80° region of a 200° image. A gsplat run at `max_angle` 80° on the native circles has fewer pixels per degree and may land somewhat below 21.7 dB for that reason alone.
- **Required fix:** Add one clause to the gate saying it compares against a re-rendered 160° set, and either evaluate S1 the same way (reproject to 160°) or allow ~0.5 dB slack.
- **Responsible agent:** orchestrator (A3c text).

### Coverage, scenario fit and consistency (no further action)
- **Consistency checks.** These figures agree across the exec summary, Ch. 4, Ch. 5, Ch. 6 and Ch. 7:
  - PSNR anchor 17–21 dB (central 19), with θ ≤ 80° expected 1–3 dB higher;
  - Phase gates: Phase 0a ≥ 21 / ≥ 19.5 / ≥ 23; Phase 1 ≥ 17 / ≥ 19;
  - `max_angle` 80° default with the {80, 90, 97, 103}° sweep;
  - accuracy 1–2 cm and 0.05–0.3% (stretch 0.5–1 cm / 0.03%);
  - compute 2.5–4 days;
  - effort 35–45 days.
- **Scores.** All score totals match their weights.
- **Coverage.** The new evidence fills the A3b gap (indoor dense) and the A3c gap (GOFish). Each comes with at least 2–3 examples and an applied selection protocol.
- **Scenario fit.**
  - The GOFish verdict is well argued: experimental arm, not primary, because of licence, 24 GB reference hardware, no rolling shutter and code three weeks old.
  - The FIORD caveats (extrapolated intrinsics, excluded scenes) are carried into the Phase-0a design.
- **Reported results vs assessment.** These stay separated, and claims are proportional to the evidence. The repeated warnings that the published 200° numbers come from stills and frame-skip splits are exactly the right framing for this reader.

**Verdict: APPROVE**
