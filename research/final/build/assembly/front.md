# From Avata 360 flight video to a metric 3D model of an underground car park

*A research report on camera, filtering, geometry, visualization and full-system design. Version 3 (final), assembled 2026-11-17 from six research chapters (agents A1–A4), revised after review round 1, and approved in review round 2; v3 applies the round-2 Minor fixes.*

## Changelog (v1 → v2, review round 1)

| Review item | Severity | Resolution |
|---|---|---|
| 1. The splat-quality anchor cherry-picked Gunes 2026 and misstated its FOV finding | Major | Re-researched by A3c and A4. All five indoor 200° scenes are now reported (16.6–22.2 dB, mean ≈ 19.6), both methods are shown best at 160°, and the protocol differences are stated. The planning anchor is lowered to **17–21 dB**, and the Phase 0a/1 PSNR gates are re-derived. The splat default is now `max_angle` 80°, with the rim band from virtual views, and the {80°, 90°, 97°, 103°} sweep is a Phase-0a experiment (§5.7, §5.8, §6.5.4, §6.9). |
| 2. GOFish was missing from Ch. 5/6 | Major | A3c added a deep dive and scored it (44/55, highest). It is the **experimental pick**, not the primary, because of its CC BY-NC licence, its 24 GB reference GPU and no rolling-shutter support. A4 added a fisheye-native Option B variant ("B-fish", 35/55) and a GOFish experimental splat arm inside Option A (§5.7, §6.4, §6.6). |
| 3. Ch. 6 misread two accuracy anchors | Major | Corrected in Ch. 4 and Ch. 6. Barazzetti 2018 is ~19.2 px/deg, about the same as ours. Gómez-López 2025's "~2 cm" is mesh-to-TLS, and its checkpoint maxima are 4.8/6.9/>10 cm. Comparability columns were added (§4.5.2, §6.3). The planning band (1–2 cm, 0.05–0.3%) is kept, with the reasoning restated, and is now the same in Ch. 4 and Ch. 6. Editorial note 1 is updated. |
| 4. Link loss and failsafe RTH underground were missing | Major | A1 added §1.5.8.1 with manual page citations: Signal Lost Action can be RTH, Hover or Land; RTH without GNSS may enter ATTI and auto-land; the garage's 50–150 lux is below the 300 lux APAS caution. It sets out a procedure (Landing/Hover, spotter, segment-by-segment flight) and adds a link-range test to §1.6 and §7.1. |
| 5. No indoor accuracy evidence for the dense method | Major | A3b added ETH3D indoor F1 at 2/5 cm (COLMAP 70.4/82.0, ACMM 79.8/88.5, ACMMP 85.4/92.9), ScanNet++ F-scores for PGSR, GOF, 2DGS and DN-Splatter, and FIORD large-room results. The OpenMVS-specific value is [UNVERIFIED] (snippet only). ACMMP (MIT) is added as an A/B densifier (§4.4). |
| 6. Agent-ID find-and-replace artefacts | Minor | Ch. 3's ablation arms are renamed **F0–F7**, paper sizes now read "A4 paper"/"A3 paper", and the remaining agent IDs are replaced by chapter references. The assembly script now skips paper-size tokens. |
| 7. Score-table arithmetic | Minor | Every score table was recomputed by script. Ch. 4 pose table: C 34, H 31, F 26, G 25, re-sorted. Ch. 3: S7 is 35. |
| 8. Ch. 4/5 pipeline tables carried overridden selection rules | Minor | Added Editorial note 7, plus cross-reference notes in §4.7 and §5.8 pointing to the selection contract in §6.1.6. |
| 9. Stale statements in Ch. 2 | Minor | The baseline is now marked unpublished (~2–4 cm, [UNVERIFIED]). The IMU and raw-fisheye statements now match Ch. 1, and the internal references point to §2.5. |
| 10. Numeric and consistency slips | Minor | 1.9 mm/px at 2 m is used throughout Ch. 1. Full-lot compute is given as 2.5–4 days everywhere. Doppelgangers++ is CVPR 2025, CC BY-NC-SA 4.0. GLOMAP: A3b re-checked Table 1, and the reviewer's smaller margins come from the ETH3D MVS (DSLR) table, not the SLAM table, so no change was needed. PPISP's venue (CVPR 2026) is confirmed via CVF Open Access. |
| 11. Repeated quotes from the COLMAP changelog | Minor | The one key quote is kept once (§2.5); the other quotes are paraphrased. |

## Changelog (v2 → v3, review round 2: APPROVE, Minor items only)

| Review item | Resolution |
|---|---|
| 1. Barazzetti dense-cloud figure misattributed | Now stated as ~5 mm against a laser scan in a cellar, and ±2.5 mm only against a DSLR cloud on a brick wall at ~1.5 m (§4.4, §4.5.2, §4.6, §6.3). |
| 2. RTH in poor vision simplified | §1.5.8.1 now gives the manual's Original Route RTH sequence, including the straight-line return at current altitude between 5 and 50 m. |
| 3. Leftovers in §6.3; compute mismatch | Heading renamed; stretch value harmonised to 0.5–1 cm; reference accuracy "~1 cm over 50 m"; the GOFish arm costs ~6–12 h per zone throughout. Rim-band ranges are defined in Editorial note 3. |
| 4. GOFish licence and Doppelgangers++ training data | §4.4 now gives CC BY-NC 4.0; §4.2.4 says Doppelgangers++ was trained on "landmark and everyday scenes". |
| 5. Leftover Ch. 2 cross-reference and quotes | §2.1.2 now points to §2.5; the tangent-Sampson quotes in §4.1.2 are paraphrased; editorial residue removed from §5.2.1. |
| 6. Phase-0a gate not like-for-like | A caveat on the re-rendered 160° set and a ~0.5 dB slack added to the gate (§5.6.1, §6.8.3). |

## Executive summary

**What the camera implies.** The DJI Avata 360 is not a "panorama camera" in the usual sense. In 360° mode its two fisheye lenses (2 × 1/1.1″ sensors, f = 2.5 mm, f/1.9, 200° each, fixed focus rated 1.5 m–∞) point **up and down**, so the stitch seam runs along the **horizon**: in a garage that is where walls, pillars, cars and signs sit (Ch. 1 key takeaways, §1.2). The `.OSV` file holds the **two unstitched 3840×3840 10-bit fisheye streams**, a **per-unit factory lens calibration** and **high-rate fused attitude quaternions**, so DJI's stitch can be skipped entirely (§1.4). The costs:
- low angular resolution (~18 px/deg, about 3× coarser than a Mavic-class camera);
- heavy H.265 compression (~0.10 bit/pixel at 8K60);
- noise at the ISO 800–3200 a dim garage needs;
- 100 Hz flicker;
- an unknown rolling-shutter readout and an unpublished inter-lens baseline (§1.5, §1.7).

DJI's manual warns that vision positioning can fail over repeating patterns and asphalt. Without GNSS, a failsafe RTH may become ATTI drift and an automatic landing, so flight safety needs its own procedure (§1.5.8).

**Recommended system (Option A, §6.5).** Decode the raw fisheyes and resample each into five pinhole *virtual views*. COLMAP 4.2 cannot represent rays more than 90° off-axis in any perspective or fisheye model, and this lens's horizon band lies at 90°–105° (§4.1). Reconstruct the ten views per frame as a **COLMAP rig with two optical centres**, which has no stitch seam by construction, using sequential matching, conservative loop acceptance and gravity priors. Add AprilTag markers and laser/tape scale bars in a final control bundle adjustment, holding out whole markers as checkpoints. Mesh with OpenMVS, with ACMMP as an A/B option (§4.4, §4.7). Convert the **same metric poses** to per-lens fisheye poses and train a **gsplat** splat on the raw fisheyes (FTheta + unscented transform, MCMC, PPISP, mesh-depth loss) out to 80° off-axis. The rim band comes from virtual views until a Phase-0a sweep shows wider angles are safe. GOFish runs as an experimental arm (§5.8, §6.1, §6.5). Before SfM, select frames **per lens and per angular sector** from IMU angular rate, parallax spacing and sharpness, instead of dropping whole frames (§3.9, §6.1.6).

**Expected outcome.**
- **Geometry:** with a marker cluster every 10–15 m, plan on **1–2 cm RMSE on held-out marker distances under 10 m and 0.05–0.3% of distance globally**, which meets the ≤1% target with margin. Sub-centimetre is a stretch: the closest stills anchor matches our px/deg but used a total station in one room, and the only 360°-video anchor gives checkpoint maxima of 5–10 cm with control at one end (§6.3).
- **Splat:** plan on **17–21 dB PSNR** on held-out blocks. On real 200° indoor fisheye, 3DGUT scores 16.6–22.2 dB, and both tested methods do best cropped to 160° [Gunes2026]. GOFish reports higher scores at full FOV [GOFish] (§5.7, §6.3).
- **Effort:** ~35–45 engineer-days.
- **Compute:** ~2.5–4 days on one 16 GB GPU, with **1–2 TB of NVMe** as the bottleneck (§6.5.3).

**Top risks.**
1. **False loop closures** between identical pillars fold the map while reprojection error stays low. Defences: temporal priors, marker-ID and rig-consensus gates, incremental-vs-global comparison, checkpoints (§4.2, §3.4).
2. **Unmeasured sensor timing and geometry**: rolling-shutter readout, inter-lens baseline and factory-calibration accuracy. Errors here are systematic and do not average out (§1.7, §6.3).
3. **Dim, flickering light and compression** erase concrete texture. They threaten registration and dense completeness on bare floors (Gaussian surface methods score ≤ 0.18 F at 10 cm in large FIORD rooms) and cap splat quality (§1.6, §4.4).
4. **Indoor flight safety**: ATTI drift, failsafe behaviour without GNSS, link loss behind concrete (§1.5.8).
5. **Licences**: OpenMVS is AGPL. PGSR, INRIA 3DGS, GOFish and MASt3R are non-commercial (§6.2).

The main **research opportunities** are direction-aware per-sector frame selection with partial rig frames, a metric study of the seam band, and a garage "doppelganger" benchmark labelled for free by marker IDs (Ch. 7).

## How to read this report

- **Ch. 2** is the learning chapter: read it first if photogrammetry or 3DGS is new. Ch. 1 and Chs. 3–5 each open with **key takeaways** and follow the method-selection protocol (long list → screening → deep dives → weighted scores → primary, runner-up and experimental picks). **Ch. 6** turns the picks into buildable systems, and **Ch. 7** collects the open questions.
- **Citations** are keys in square brackets (e.g. [Kerbl2023]) that resolve in the References. Chapters also carry **evidence tags**:
  - **[DJI-SPEC] / [DJI-FAQ] / [DJI-MANUAL]**: checked on that official DJI page.
  - **[OPENED]**: the cited page was fetched and read.
  - **[SRC]**: verified in source code (COLMAP 4.2.1, gsplat main, nerfstudio, 3dgrut).
  - **[ABS]**: abstract only.
  - **[SNIPPET]**: search-result text only; treat as unverified.
  - **[CALC]**: the authors' own calculation.
  - **[UNVERIFIED]**: could not be verified.
  - *Assessment*: opinion rather than a reported result.
- **Terminology** (one name per concept):
  - *Virtual view*: a pinhole image resampled from a raw fisheye.
  - *Rig frame*: the set of virtual views from one video frame.
  - *Horizon band* or *rim band*: the part of each fisheye beyond ~80–90° off-axis.
  - *Survey frame* `S`: the metric frame defined by the markers.
  - *Checkpoint*: a held-out marker or distance that is never used in the adjustment.
  - *F0–F7*: the filtering ablation arms of §3.7.

## Editorial notes: cross-chapter consistency

1. **Accuracy expectation.** v1 had Ch. 4 at 0.5–1.5 cm and 0.03–0.2%. After the anchor corrections (§4.5.2, §6.3), Ch. 4 and Ch. 6 now agree: **plan 1–2 cm local and 0.05–0.3% global, with 0.5–1 cm and 0.03% as stretch values.** The comparable-resolution stills anchor [Barazzetti2018] supports sub-cm only with a total station in a single room. The only 360°-video anchor [GomezLopez2025] reports mesh-to-TLS ~2 cm where lit, and checkpoint maxima of 4.8–>10 cm with control at one end.
2. **EUCM and angles beyond 90°.** Ch. 1 says downstream models must handle θ > 90° ("EUCM/Double-Sphere/bearing vectors"); Ch. 4 says COLMAP's EUCM cannot. Both are right. The EUCM and Double Sphere *models* represent rays beyond 90° [Khomenko2016][Usenko2018], but **COLMAP's implementation** rejects points without positive camera-frame depth. The orchestrator confirmed this in `src/colmap/sensor/models/eucm.h` (`ImgFromCam` calls `HasProjectableDepth(w)`). Hence the virtual-view rig.
3. **What the splat trains on.** Ch. 4 says to reuse the pinhole virtual views for 3DGS, and Ch. 5 recommends raw-fisheye FTheta training. Resolution (§6.1.2, §6.1.3, §6.5): train on the **raw fisheyes out to 80° off-axis by default**, take the rim band from virtual views (the oblique views cover 78–102° off-axis; the rim band is *evaluated* over 80–105°), and widen only if the Phase-0a `max_angle` sweep supports it. The all-virtual-view splat ("A-pinhole") remains the fallback (§6.8.2).
4. **Frame density.** Ch. 3 recommends 4–7 rig frames/m for SfM and 8–12/m for splatting. Ch. 6 uses **one 7/m set for all consumers in Phase 1**, and the 12/m splat set is a Phase 2 ablation (§6.1.6).
5. **Licences.** PGSR (Ch. 4's textureless variant) and GOFish (Ch. 5's experimental pick) are non-commercial and stay in **research branches**. Option B uses gsplat's own Apache-licensed 2DGS rasterizer (§6.2).
6. **Chapter length.** The research chapters exceed their word targets, mainly because of their tables. They are kept nearly whole so that every claim stays next to its citation.
7. **Frame-selection rules.** Ch. 4's pipeline table (§4.7) and Ch. 5's (§5.8) list simpler whole-frame rules (|ω| > 10°/s reject, Laplacian outliers, fixed spacing). **The binding rules are the selection contract in §6.1.6**: whole-frame reject above 16°/s, rim-sector masking at 10–16°/s, and 7 rig frames/m in Phase 1. The other tables are illustrative.
