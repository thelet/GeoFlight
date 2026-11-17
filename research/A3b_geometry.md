# A3b: Geometric accuracy, from camera model to verified metric mesh

*Agent A3b (geometry). Written 2026-11-17. Input constraint: A1 Handoff (raw dual fisheye as a 2-camera rig; seam on the horizon; θ > 90° per lens; IMU attitude priors; scale only from markers; fixed focus 1.5 m–∞; vision positioning can drop to ATTI over repetitive floors).*

> **Evidence conventions.** **[SRC]** = I read the COLMAP 4.2.1 source or docs in a fresh clone (commit `137f216`, 2026-11-10). **[OPENED]** = I fetched and read the paper (arXiv HTML/abstract, ISPRS PDF) or repository. **[ABS]** = only the abstract was reachable (MDPI pages returned HTTP 403 to this sandbox; abstracts came from the Semantic Scholar API). **[CALC]** = my own derivation, formula shown. **[UNVERIFIED]** = not checked against a primary source. Everything not tagged as a reported result is my assessment.

---

## 0. TL;DR

1. **No COLMAP perspective or fisheye model can represent a ray with θ ≥ 90°.** In COLMAP 4.2.1 every model, `OPENCV_FISHEYE`, `RAD_TAN_THIN_PRISM_FISHEYE` and `EUCM` included, rejects points with camera-frame depth w ≤ ε in projection. The default bearing unprojection is documented as correct only "for perspective and fisheye-with-FOV<=180°" and always returns rz > 0 [SRC: `sensor/models/base.h`, `eucm.h`, `thin_prism.h`]. Only `EQUIRECTANGULAR` covers the full sphere. On this drone, θ ∈ [90°, ~105°] of each lens is the horizon, i.e. the walls and pillars.
2. **So use neither raw fisheye-in-COLMAP nor stitched equirect. Decode the two raw fisheyes and resample each into ~5 pinhole virtual views.** That gives 10 views per frame, ~2100×2100 px at 90° FOV. Model them as one **COLMAP rig with two optical centres**: the 5 views of a lens share a centre, and the two lens groups are separated by the calibrated baseline b. Every view is then an exact central projection, there is no stitch parallax by construction, and the θ > 90° band is kept because a pinhole view *aimed* obliquely has no 90° limit. This is the generalisation of what COLMAP's own `panorama_sfm` does for equirect [SRC], what ORBIT does for 360° ground truth [ORBIT], and the rig constraint that the best-performing indoor 360° survey used [Perfetti2024].
3. **Poses:** use the COLMAP 4.2 incremental mapper with rig constraints, sequential matching with loop detection, gravity priors from the DJI quaternions, ALIKED+LightGlue (SIFT as baseline) and the Caspar GPU BA. The global mapper (ex-GLOMAP) with gravity-aligned rotation averaging is a fast cross-check; its known failure mode is symmetric structures, which is exactly a parking lot [GLOMAP]. Learned feed-forward pipelines are still at the **decimetre-to-metre** level on comparable 360° indoor data: RIGOR reports a 2.31 m median ATE and a 0.13 m Chamfer distance on the Hilti-Trimble-Oxford sequences [RIGOR]. They are useful for diagnosis, not for measurement.
4. **Scale and control:** use AprilTag-36h11 markers detected **in the virtual pinhole views**, triangulated as BA tracks, plus tape/laser **scale bars as soft distance residuals in a final pycolmap/pyceres BA**. Hold out ≥30% of distances as checks. Sim(3) alignment alone fixes scale, but it cannot remove the bending that drift causes. Published 360° surveys show 5–10 cm drift once control is only at one end [Perfetti2024][GomezLopez2025].
5. **Dense:** run COLMAP undistortion to pinhole, then OpenMVS (densify → mesh → refine) as the metric baseline, and **PGSR** (planar Gaussian surfaces with multi-view geometric consistency and exposure compensation) as the textureless-surface variant. Fuse them or choose per region against checkpoints. Monocular depth/normal priors (DN-Splatter style) fill holes, but they bias the geometry, so they are never used where the checkpoints are evaluated. *Indoor evidence:* on the ETH3D high-res **indoor** test scenes, PatchMatch-class MVS scores F1 70.4/82.0 (COLMAP) to 79.8/88.5 (ACMM) and 85.4/92.9 (ACMMP) at 2/5 cm [MPMVS][ACMM]. On ScanNet++ at 5 cm (scale-aligned), PGSR has the best mesh F-score among the Gaussian surface baselines, 0.687 [GOFish]. On FIORD's large fisheye indoor rooms, every Gaussian surface method stays below F = 0.18 at 10 cm [GOFish].
6. **Realistic expectations:** consumer 360° cameras reach **4.6–7.2 mm per-axis checkpoint RMSE** in a ~10 m room. That figure comes from stills at ~19 px/deg (the same angular resolution as ours), with distributed control and a total station [Barazzetti2018]. Other stills studies report **~5 mm** against a reference scan [Janiszewski2022] and **~1 cm** in narrow spaces with control throughout [Perfetti2024]. The only *video* anchor is a dark tomb filmed at ~7.9 px/deg with control at one end [GomezLopez2025]. There, the mesh is **within ~2 cm of the TLS mesh in the lit nave**, but **checkpoint maxima reach 4.8, 6.9 and > 10 cm** at the far end. Our case (drone, H.265, dim, ~18 px/deg, 50–100 m) should **plan on 1–2 cm checkpoint RMSE locally and 0.05–0.3% of distance globally** *with* distributed markers. 0.5–1 cm and 0.03% are stretch goals only. Without distributed markers, expect 0.2–1%.

---

## 1. Camera model and calibration

### 1.1 What the tools can and cannot represent (verified in source)

| Path | Tool support (verified) | θ > 90° (horizon band) | Seam parallax | Dense MVS possible? |
|---|---|---|---|---|
| Raw fisheye as `OPENCV_FISHEYE` (KB-4) or `RAD_TAN_THIN_PRISM_FISHEYE` (Aria "Fisheye624": 6 radial θ terms + 2 tangential + 4 thin prism) | Yes; both in COLMAP 4.2.1 [SRC `fisheye_radial.h`, `thin_prism.h`] | **No.** `ImgFromCam` requires w ≥ ε, and the base fisheye maps through θ = atan(r) on the normalized plane [SRC `base.h`]. The image must be cropped to θ ≲ 85° to stay numerically sane | None (central per lens) | After undistortion to pinhole only |
| Raw fisheye as `EUCM` (new in 4.1) | Yes [SRC `eucm.h`; changelog 4.1] | **No** in COLMAP's implementation: the same depth check, and `CamFromImg` returns normalized (u,v) [SRC] | None | Same |
| Stitched equirect as native `EQUIRECTANGULAR` (4.1+) | Yes; full-sphere `CamRayFromImg` [SRC `spherical.h`]. Release notes call it "generally faster but less accurate than rendering perspective views" [COLMAPChangelog] | Yes | **Yes, baked in** (A1: 7–40 px at 1–5 m) | **No.** The PatchMatch model reads a pinhole K [SRC `mvs/model.cc`], and the undistorter only resizes spherical cameras [SRC `undistortion.cc`] |
| Stitched equirect → rig of perspective views (`pycolmap.panorama`) | Yes. Default: 4 yaws × pitches (−35°, 0°, +35°), 90°×90° [SRC `panorama.py`] | Yes | **Yes, baked in** | Yes |
| **Raw fisheye → rig of pinhole virtual views (recommended)** | Rig support is generic [SRC `doc/rigs.rst`]. The renderer must be written (DJI model + `cv2.remap`) | **Yes**: an oblique pinhole view is not limited by the lens's 90° | **None** (two true centres, offset b) | Yes |

**A useful equivalence [SRC + A1].** DJI's lens model is θ_d = θ(1 + k₁θ² + … + k₅θ¹⁰) followed by Brown tangential terms on the distorted coordinates (A1 §2.1). COLMAP's `RAD_TAN_THIN_PRISM_FISHEYE` computes exactly that form with six radial terms, then applies tangential terms on the distorted coordinates. DJI's calibration therefore maps into it with k₅ = 0 and s₀..s₃ = 0. The sign and order convention of p₁/p₂ must be checked numerically. **Use it for θ < 85° verification only.** The full lens needs a bearing-vector implementation (§1.4).

### 1.2 Options compared, with example works

- **Perspective-rig decomposition of a panorama.** [ORBIT] (Sabour et al., CVPR 2026) builds its 360° ground truth by projecting each equirect frame to four cube faces and running rig-constrained SfM. The authors give two reasons [OPENED]: equirect is highly anisotropic, so reprojection error needs care, and it wraps at the borders. COLMAP's `panorama_sfm` example does the same, with 12 overlapping 90° views [SRC]. [RIGOR] (2026) projects gravity-aligned panoramas into 4 views and exploits the rig for consistency checks [OPENED].
- **Native spherical SfM.** [SphereSfM] (Jiang et al., 2024, a COLMAP fork with a `SPHERE` model and spherical BA; README read [OPENED], journal details [UNVERIFIED]). [IM360] (Jung et al., ICCV 2025) performs matching, two-view geometry, triangulation and BA "on a spherical manifold" on top of SphereSfM [OPENED]. COLMAP ≥ 4.1 now ships the model natively, and 4.2 replaced bearing-Sampson with a "pixel-consistent tangent Sampson error", which "particularly improves wide-field-of-view and spherical cameras" [COLMAPChangelog].
- **Raw fisheye / multi-camera rig.** [Perfetti2024] (Perfetti, Bruno, Roncella, *Remote Sensing* 2024) compared Insta360 Pro2, MG1 and the ANT3D fisheye rig in a spiral staircase. **Imposing a multi-camera constraint and estimating interior and relative orientation in the BA gave the best results**, and all systems reached 1 cm with adequate control [ABS]. [GomezLopez2025] (ISPRS Archives 2025) processed the raw fisheye frames of a 6-lens Kandao Obsidian Go 360° *video* camera in Metashape, using pre-calibrated intrinsics and inter-sensor distances as scale bars, **not** stitched panoramas [OPENED].

**Recommendation.** Raw fisheye → pinhole virtual views → rig. **Stitched equirect → perspective rig** is the runner-up, with the horizon band masked. **Native `EQUIRECTANGULAR`** is used only for fast pose previews.

**Why masking the seam is costly here [CALC].** A ±δ band around the horizon is sin δ of the sphere: ±5° is 8.7% and ±10° is 17.4%. For a flight height of 1.5 m it removes wall content within ±d·tan δ of 1.5 m at horizontal range d. With δ = 8°, that is ±0.70 m at 5 m and ±1.4 m at 10 m. **Beyond ~10 m the entire wall (0.1–2.9 m) is masked.** Long-range wall observations are the ones that tie distant parts of the lot together, so masking them weakens the network exactly where drift accumulates.

### 1.3 Virtual-view design (FOV/overlap)

Pixel stretch in a pinhole view grows as 1/cos²α off-axis (×2 at 45°, ×3 at a 90° view's corner, 54.7°). Narrower views stretch less but multiply the image count. A 90° view at the native 1047 px/rad is 2·1047·tan 45° ≈ **2094 px** square, matching A1's ~2100 px [CALC].

**Proposed per-lens layout (assessment; tune on data):**
- **1 axial view** (FOV 90°, covers θ ≤ 45° on its edges and 54.7° at its corners): ceiling or floor, at best MTF.
- **4 oblique views** at θc = 62°, yaws 0/90/180/270°, FOV 90°×90°: they span θ ≈ 17°–107° along their centre column, so they reach the rim (~105°) and the overlap band.
- Down lens: same layout, yaw-offset 45° so its view boundaries do not line up with the up lens's.
- Fill pixels outside the image circle and the **airframe mask** with zero and give them a COLMAP mask, so no features are extracted there.
- **Result:** 10 images per frame, each ~4.4 MP. That is ~1.9× redundant pixels versus the ~23 MP inside the two image circles, a deliberate trade for overlap between neighbouring views.

**Rig configuration** (`rig_config.json` [SRC `doc/rigs.rst`]): the reference sensor is up-axial. The other up views carry pure rotations and zero translation. The down views carry the lens-to-lens rotation (factory Euler angles, A1) and **translation b** (calibrated, §1.4). Keep `Mapper.ba_refine_sensor_from_rig 0` (the rig is known by construction) and run one experiment that frees only the down-group translation.

### 1.4 Self-calibration vs. pre-calibration

**Evidence.** [Perfetti2024] finds that estimating interior and relative orientation in the BA works best in stable conditions, but that "in less stable environments" pre-calibrating and fixing interior orientation may be preferable [ABS]. The same paper's preprint reports that *pre-calibrated* relative orientation produced orientation errors up to 7.8 cm RMSE on the Insta360 Pro 2 (search snippet of the preprint, [UNVERIFIED]). [GomezLopez2025] used pre-calibrated intrinsics and inter-sensor distances [OPENED]. [Rezaei2024] calibrated a consumer spherical camera's fisheyes on a chessboard in Metashape before an underpass survey [ABS].

**Constraint specific to this drone.** Once the views are rendered to pinhole, COLMAP can no longer refine the fisheye distortion, because it is baked into the remap. The A1 update also says recording is impossible before takeoff, so calibration data must come from a **hover clip** in front of boards (A1 §6).

**Recommended scheme:**
1. **Start from DJI's per-unit factory calibration** (in every `.OSV`). A community re-implementation of the model matched DJI's own reference to 2.1/3.9 px RMS [A1]. That residual measures *re-implementation* error, not calibration accuracy, so it must be driven below 0.5 px against DJI Studio output before trusting anything.
2. **Verify, and estimate b, on the hover board clip.** Use an AprilGrid seen through both lenses and through the overlap band. Fit a bearing-vector model per lens: DJI's KB-5 + tangential written in pyceres, or Double Sphere [DoubleSphere], whose closed-form inverse covers > 180°. Estimate b and the inter-lens rotation from board observations in the overlap band.
3. **Optional refinement stage (experimental, high value):** after COLMAP converges, **map every keypoint from virtual-view pixels back to raw fisheye pixels**. The mapping is exact and known. Then run a custom pyceres BA in raw fisheye coordinates with the DJI model, refining the intrinsics shared over the whole flight. This restores self-calibration *without* COLMAP needing a θ > 90° model.

**b is not a usable scale source [CALC].** Depth from the lens pair is σ_Z ≈ Z²·σ_θ/b. With σ_θ = 0.5 px / 1047 px·rad⁻¹ = 0.48 mrad, b = 3 cm and Z = 2 m, σ_Z ≈ 6.4 cm per point. Scale must come from markers. b still matters for geometry: setting b = 0 reintroduces the seam error.

### 1.5 Rolling shutter

- **COLMAP:** no rolling-shutter model anywhere in 4.2.1. A source grep for "rolling" returns nothing [SRC].
- **Academic RS-BA:** [RSBA] (Liao et al., CVPR 2023) provides a fast, accurate RS bundle adjustment, but for perspective cameras. I found no open-source SfM with RS modelling **for 360°/fisheye**, and none for a two-sensor rig [assessment; Metashape's RS compensation exists for frame cameras, spherical support UNVERIFIED].
- **Magnitude [CALC]**, with readout t_r unknown (A1; ≤ 16.7 ms at 60 fps):
  - Yaw at 10°/s with t_r = 12 ms → 0.12° ≈ 2.2 px of skew.
  - Translation at 0.4 m/s → the camera moves 5 mm during readout, a systematic ≤ 5 mm pose smear, about 2.5 px for points at 2 m.
  - Both are tolerable for a cm target if the flight follows A1's protocol.
- **Mitigation:** fly slowly. Reject frames with IMU |ω| > 10°/s. Measure t_r (A1 unknown #2). Optionally add a constant-velocity RS term in the custom fisheye BA of §1.4, using the 1–4 kHz quaternions for the rotational part (experimental).

---

## 2. Pose estimation in repetitive, low-texture indoor space

### 2.1 Incremental vs. global, rigs, sequential matching

- **COLMAP incremental mapper** remains the accuracy reference. It is now accelerated by the Caspar GPU BA backend, which supports rigs and is "often 1-2 orders of magnitude faster than the Ceres CUDA backend" (4.1) [COLMAPChangelog].
- **Global mapper (GLOMAP inside COLMAP since 4.0).** [GLOMAP] (Pan, Baráth, Pollefeys, Schönberger, ECCV 2024) evaluates on ETH3D SLAM (sequential, sparse features, illumination changes). Its Table 1 averages give GLOMAP vs. COLMAP: recall@0.1 m **66.4 vs 57.9**, AUC@0.1 m **57.0 vs 47.6**, AUC@0.5 m **65.7 vs 57.9**, and mean time **133.5 s vs 1115.4 s**. This matches the text's "~8% higher recall, +9/+8 AUC, an order of magnitude faster" [OPENED, Table 1]. The much smaller margins (80.8 vs 79.2, 16.5 vs 27.5 s) are the paper's **ETH3D MVS (DSLR)** table, not the SLAM table. On ETH3D SLAM's *repetitive* sequences, both methods do poorly: recall 32.7 (GLOMAP) vs 28.5 (COLMAP) [OPENED]. Its own limitation section names **rotation-averaging failure on symmetric structures** (ETH3D *exhibition_hall*) [OPENED]. A grid of identical pillars is such a structure.
- **COLMAP 4.2** adds:
  - multi-component global mapping: disconnected components come back as separate models instead of being forced together;
  - "improved sequential pairing for camera rigs";
  - `SequentialMatching.loop_detection_min_index_distance`, which keeps temporally nearby frames out of loop retrieval;
  - 4.2.1 restores legacy BA behaviour in the global mapper after a 4.2.0 regression.

  All from [COLMAPChangelog], option names verified in `option_manager.cc` [SRC].

**Recommendation.** Use incremental + rig as the primary path, and global + gravity as a fast second opinion. *Disagreement between the two models is itself a false-loop alarm.*

### 2.2 360°-specific pipelines

- [IM360] (ICCV 2025). Spherical SfM with EDM dense spherical matching. On Matterport3D it registers 37/37 images versus 16–22/37 for cubemap SuperPoint+SuperGlue and DKM COLMAP rigs, at AUC@3°/5°/10° = 49.2/69.1/84.5 on scene 2t7WUuJeko7 [OPENED].
  - **Assumptions violated here:** sparse *still* panoramas from tripod scanners (not video), **matching pairs chosen by human annotation** (their stated limitation), and stitched ERP input.
  - Geometry is evaluated through rendering, not metric checkpoints.
- [RIGOR] (Huang et al., arXiv 2609.13504, 2026; Apache-2.0). Frozen Depth Anything 3 on a 4-view virtual rig, rig-based repair, **cyclic four-view loop retrieval with joint verification**, and a Sim(3) pose graph. On 30 Hilti-Trimble-Oxford construction sequences: median ATE 2.312 m (DA3-Legacy 2.704 m), ROI Chamfer 0.132 m, F@25 cm 0.873 [OPENED]. Its evaluation uses *scale-adjusting* ICP, so it "does not assess recovery of metric scale" [OPENED].
- **stella_vslam** (fork of OpenVSLAM [OpenVSLAM]; BSD-2; perspective, fisheye and equirectangular camera classes in `src/stella_vslam/camera/` [OPENED repo]). Real-time BoW loop closure on equirect. Useful as a quick trajectory/prior or for in-field QA. The input is stitched, and BoW place recognition is exactly what perceptual aliasing fools.
- [ORBIT] (CVPR 2026): COLMAP and recent optimization-based and feed-forward SfM methods "struggle", and every method fails completely on ≥ 36% of the benchmark clips [OPENED]. The benchmark builds its ground truth from 360° video with a rig, which supports §1.

### 2.3 Learned reconstruction and matchers: help on concrete, and do they scale?

- **Feed-forward models:**
  - [VGGT] (CVPR 2025) states it "does not support fisheye or panoramic images". Peak memory is 11.4 GB at 50 frames and 21.2 GB at 100 frames (H100) [OPENED], so about 60–70 frames fit on 16 GB. Licence: custom "VGGT License v1" [OPENED repo].
  - [Pi3] (2025; BSD-style licence [OPENED repo]) and [MapAnything] (3DV 2026; Apache-2.0) share the chunking problem.
  - Long-sequence wrappers ([VGGTLong], ICRA 2026; [MASt3R-SLAM], CVPR 2025) add loops on top.
  - Even so, the best 360° feed-forward system I found (RIGOR) is at decimetres. **Verdict:** use them for initialisation, loop *candidate* proposals and diagnosis, never as the metric solution.
- **[MASt3R-SfM]** (2024): uses MASt3R encoder features for ASMK retrieval, reaching quasi-linear scaling [OPENED]. Licence **CC BY-NC-SA 4.0** [OPENED repo], which is a problem if the project becomes commercial.
- **Sparse learned features.** ALIKED [ALIKED] and LightGlue [LightGlue] (Apache-2.0) are native in COLMAP 4.0+ via ONNX. [LoMa] (2026, MIT) beats ALIKED+LightGlue by +18.6 mAA on HardMatch and +21.4 on InLoc (1 m, 10°) [OPENED], and it ships in COLMAP 4.2 (4.2.1 fixed a LoMa GPU memory leak) [COLMAPChangelog].
- **Dense matchers.** [RoMa] (CVPR 2024, MIT) finds matches on weak texture. It costs roughly a forward pass per pair, which is affordable for a few thousand problem pairs but not for 300k sequential pairs [assessment].
- **Assessment for bare concrete:** learned matchers raise the inlier count on low-contrast, noisy texture. **They cannot create texture that H.265 at ~0.1 bpp has erased** (A1). The 360° geometry is the real rescue, because some view of every frame always sees edges: pillar corners, pipes, signage, markers.

**Plan:**
- SIFT baseline, then ALIKED+LightGlue, then LoMa: an A/B/C test on one sortie, measured by registered frames, track length and checkpoint error.
- RoMa only on segments where registration breaks.

### 2.4 False loop closures / perceptual aliasing (SfM-side defences)

**Example works:**
- [Doppelgangers] (Cai et al., ICCV 2023) trains a pairwise classifier that removes look-alike edges before SfM.
- [DoppelgangersPP] (Xiangli, Cai, Chen, Byrne, Snavely; CVPR 2025, per the CVF open-access page and DBLP; code licence **CC BY-NC-SA 4.0**, non-commercial [OPENED repo LICENSE]) uses MASt3R 3D-aware features and plugs into COLMAP and MASt3R-SfM pipelines [OPENED].
- RIGOR's **cyclic four-view consensus**: a loop is accepted only if *all* rig views agree on one cyclic assignment, and it is then jointly verified before entering the graph [OPENED].
- GLOMAP's rotation averaging **filters outlier relative rotations**. COLMAP 4.2 can then return the resulting disconnected components separately rather than glue them wrongly [COLMAPChangelog].

**Defences in priority order (assessment):**
1. **Temporal prior first.** Sequential matching with `overlap` ≈ 10–15 frames and `expand_rig_images` builds a trajectory that holds without loops. Loop retrieval is restricted by `loop_detection_min_index_distance` [SRC].
2. **Marker-ID gate.** Every bay carries unique AprilTag IDs (A1). If a loop candidate's frames see *different* marker IDs at overlapping 3D positions, reject it. If they see the *same* IDs, that is the strongest true-loop evidence available.
3. **Rig-consensus gate** (RIGOR-style, cheap to implement): a revisit must produce geometric inliers in **≥ 3 of the 10 virtual views**, with mutually consistent relative pose. A false pillar match typically lives in one view.
4. **Gravity gate.** Gravity-consistent relative rotation (pitch/roll agree with the IMU to ≲ 1°) is necessary but not sufficient, because yaw errors pass it.
5. **Cross-model disagreement:** incremental vs. global, and the marker-distance residuals after BA (§3). A folded map shows up as checkpoint distances that are wrong by whole bay widths, *while the reprojection error looks fine* (shared-context warning).
6. **Doppelgangers++ as a filter** for retrieved loop pairs. Its licence is CC BY-NC-SA 4.0, which is fine for research but blocks commercial use. It was trained on landmarks, not garages, so its precision must be measured on our data.

### 2.5 Priors

- **Gravity.**
  - COLMAP stores gravity in `PosePrior` (direction in the sensor frame) [SRC `geometry/pose_prior.h`]. The global mapper exposes `GlobalMapper.ra_use_gravity` [SRC], implementing [GravityRA] (Pan, Pollefeys, Baráth, ECCV 2024). With gravity known, rotation averaging reduces to one degree of freedom per camera, and the authors report a 13-point AUC@1° gain and ~8× speed over the SfM baseline [OPENED].
  - Caveat from the paper: gravity noise that drifts (non-independent) hurts more [OPENED]. The DJI fused quaternion is reported good to 0.1–0.3° (A1), but the raw accelerometer can be off by up to 52° during manoeuvres (A1), so use the fused attitude only.
  - `PosePrior` also has a Cartesian position, which we do not have indoors.
- **Planar/Manhattan priors in BA:** not native to COLMAP. COLMAP does have a vanishing-point coordinate-frame estimator for *aligning* a model [SRC `estimators/coordinate_frame.h`]. Recommendation: **do not** put floor-plane or Manhattan constraints in the pose BA. Real garage floors have drainage falls, and these constraints would hide exactly the errors the evaluation must find. Use them in dense regularisation (§4) and as evaluation checks (§5).
- **Known marker positions in BA:** see §3.

---

## 3. Metric scale and control

### 3.1 Markers seen by a 360° camera

**Family.** AprilTag 36h11 [AprilTag] (BSD-2; 587 unique IDs) or ArUco from OpenCV. Both detect quads with straight edges, so **detect on the pinhole virtual views, not on the fisheye or the equirect.** Fisheye and equirect curve the edges. The equirect also stretches horizontally by 1/cos φ, which breaks the decoder's square-grid assumption away from the equator [assessment].

**Corner pipeline:**
1. Sub-pixel corner refinement on the pinhole view.
2. Map each refined corner to a bearing in its lens frame (exact, through the known remap).
3. Add the corner as a 2D observation of a 3D "marker-corner point" with a fixed ID-based track.
4. Detect each tag in every view that contains it. Overlapping views give redundant detections, which form a consistency check.

**Size vs. distance (consistent with the device chapter) [CALC].** About 40–60 px across for robust decoding, at 18.3 px/deg, means ≥ 2.2–3.3°:
- Tag printed on A3 paper (≈ 0.27 m black square): ≤ 5–6 m.
- Tag printed on A4 paper (≈ 0.19 m black square): ≤ 3–4 m.
- The **1.5 m near-focus limit** (A1 update) sets a minimum range: use detections at 1.5–5 m slant range.

**Corner precision [CALC].** 0.1–0.2 px corner noise ≈ 0.1–0.2 mrad. At 3 m that is 0.3–0.6 mm per observation, before multi-view averaging. Markers are therefore not the accuracy bottleneck. Network geometry and drift are.

**Placement:**
- Floor: at the down-lens centre, best MTF; plan the flight height so the floor is ≥ 1.5 m away, or accept softer detections.
- Pillars at 0.3 m and 2.3 m, off the flight-height horizon band.
- One cluster per bay or junction, i.e. a marker cluster every **≤ 10–15 m** along each aisle. With control only at the start, [GomezLopez2025] saw checkpoint residuals grow to > 10 cm at the far end of a ~30 m tomb, and mesh-to-TLS differences of ~10 cm along the corridor [OPENED].
- Several 3D (non-coplanar) clusters per area so that the Sim(3)/BA is well conditioned.

### 3.2 Scale-only vs. full control

| Strategy | What it fixes | What it cannot fix | Tool |
|---|---|---|---|
| **Sim(3) to measured coordinates** (Umeyama on marker centres) | Global scale, rotation, translation | Bending, scale drift, folds | numpy / COLMAP `model_aligner` (camera centres, not points [SRC]) |
| **Scale bars as soft BA residuals** ‖X_i − X_j‖ − d_ij, σ = instrument σ | Scale *everywhere a bar exists*, local scale drift | Needs bars spread through the lot | Custom pyceres residual on pycolmap reconstruction |
| **GCP-constrained BA** (marker 3D points fixed or priors) | Everything, if coordinates are true | Needs a coordinate survey (total station or adjusted distance network) | pycolmap `BundleAdjustmentConfig.AddConstantPoint` [SRC] or soft priors |

**Recommendation:**
1. Collect tape/laser **distances** between marker centres. A laser distance meter is ~±1–2 mm over tens of metres [UNVERIFIED typical spec]. Collect them redundantly as triangles and quadrilaterals.
2. Adjust these distances as a **trilateration network** to get marker coordinates with covariances.
3. Use ~70% of distances as BA scale bars or soft GCPs and **hold out ~30% as checkpoints**, chosen to include long (> 20 m) lines for the ≤ 1% global test.
4. A total station, if one can be borrowed, removes the trilateration weakness and is the gold standard [Barazzetti2018 used a Leica TS30].

**Scale-error propagation [CALC] (for the calculator in §8).** One bar of length L with endpoint errors σ_p gives σ_s = √2·σ_p/L. With N independent bars, σ_s/√N. For L = 10 m, σ_p = 3 mm, N = 10: σ_s ≈ 0.013%, i.e. 1.3 cm per 100 m. **Scale error is negligible next to drift and bending, provided the bars are distributed.**

### 3.3 Alternative scale sources (ranked)

1. **Laser distance meter between markers:** primary.
2. **Known parking-bay dimensions:** use only as a sanity check. Painted lines are wide (~10–12 cm), worn, and as-built tolerances are cm-level [assessment].
3. **Pillar-grid spacing from structural drawings:** a good *check*, if drawings exist.
4. **Phone LiDAR scan:** useful as a *local completeness/shape* reference in a few bays, not for scale over 50 m, because its tracking drifts [assessment; UNVERIFIED for specific devices].
5. **Inter-lens baseline b:** useless for scale (§1.4).

---

## 4. Dense geometry

### 4.1 The problem surfaces

- **Textureless planes** (floors, ceilings, painted walls): photo-consistency is flat. PatchMatch leaves holes or noise, and neural methods hallucinate smoothly.
- **Thin structures** (sprinkler pipes, cable trays, railings): they need high resolution and many views; surface-Gaussian and SDF methods tend to erase them.
- **Reflective cars and wet floors:** view-dependent appearance creates false depth. Mask the cars (A3a covers segmentation) and treat car surfaces as out of scope for accuracy.

### 4.2 Methods and example works

| Method | Idea | Context accuracy (DTU / TnT) | **Indoor accuracy (dataset, metric, number, source)** | Memory/compute | Code / licence |
|---|---|---|---|---|---|
| **COLMAP PatchMatch → fusion** | Per-view depth/normal PatchMatch with geometric consistency; needs pinhole K [SRC] | — | **ETH3D high-res, indoor test scenes**, point-cloud F1 (%) at 2 cm / 5 cm: **70.41 / 82.04** (acc. 91.95 / 96.62, compl. 59.65 / 73.00). Indoor *training* scenes: 66.76 / 78.49 [MPMVS Table II; the 2 cm test value also appears in ACMM Table 3] [OPENED] | GPU; scales by view count, controllable via `max_image_size` | BSD [SRC] |
| **OpenMVS** (DensifyPointCloud → ReconstructMesh → RefineMesh → TextureMesh) | PatchMatch-style densification, Delaunay/graph-cut mesh, photometric mesh refinement | — | ETH3D leaderboard "OpenMVS" entry, indoor F1 at 2 cm ≈ **78.3**. This comes only from a search snippet of a third-party leaderboard mirror. eth3d.net was unreachable from this sandbox, so the value is **[UNVERIFIED]**, and no OpenMVS paper exists. I treat OpenMVS as an "ACMM-class" PatchMatch densifier (next two rows) | CPU+GPU; resolution levels control memory | **AGPL-3.0**, active (2026-11-06) [OPENED repo] |
| **ACMM** [ACMM] (Xu & Tao, CVPR 2019) | Multi-scale geometric-consistency PatchMatch: coarse scales fill weak texture, fine scales restore detail | — | **ETH3D indoor test**, F1 at 2 cm / 5 cm: **79.84 / 88.48**. At 10 cm: 92.50, vs COLMAP 89.28. The gain over COLMAP comes mostly from completeness on low-texture indoor scenes (72.7 vs 59.7 % at 2 cm) [ACMM Table 3; MPMVS Table II] [OPENED] | Single GPU; ~3× faster than COLMAP PatchMatch per the paper | MIT [OPENED repo] |
| **ACMMP** [ACMMP] (Xu, Kong, Tao, Pollefeys, TPAMI 2022) | ACMM + **planar priors** from triangulated confident points, aimed at textureless planes | — | **ETH3D indoor test**, F1 at 2 cm / 5 cm: **85.39 / 92.88**. Indoor training scenes: 85.27 / 92.16 [MPMVS Table II] [OPENED]. MP-MVS itself reaches 87.64 / 94.07 on the indoor test scenes [MPMVS] | Single GPU (tested on a GTX 1080 Ti) | MIT; takes COLMAP input via `colmap2mvsnet_acm.py`; last commit 2022-11 [OPENED repo] |
| **2DGS** [2DGS] (Huang et al., SIGGRAPH 2024) | Gaussian surfels with ray-splat intersection, depth distortion and normal consistency | DTU mean CD 0.80 mm; TnT F1 0.32 (as tabulated in PGSR) [OPENED] | **ScanNet++** (2 iPhone scenes, mesh, 5 cm): F 0.420, Chamfer-L1 0.104 m. **MuSHRoom** (6 scenes): F 0.604, CD 0.069 m [DNSplatter Tables 1–2] [OPENED] | ~0.3–0.6 h per scene; single GPU | Gaussian-Splatting licence (**non-commercial**) [OPENED repo] |
| **GOF** [GOF] (Yu, Sattler, Geiger, SIGGRAPH Asia 2024) | Opacity field from Gaussians, marching tetrahedra; decoupled appearance | DTU 0.74 mm; TnT F1 0.46 [OPENED via PGSR table] | **ScanNet++** (6 DSLR fisheye scenes, rectified, scaled-ICP alignment, 5 cm): F **0.601**. **FIORD** fisheye (LiDAR GT, 10 cm), indoor rooms: Kitchen 0.554, Building 0.139, Meeting 0.367, Hall 0.063 [GOFish Tables 2, 10] [OPENED] | ~2 h; tetrahedra heavy on large scenes | Non-commercial; last commit 2024-11 [OPENED repo] |
| **PGSR** [PGSR] (Chen et al., TVCG 2024) | Flattened Gaussians → plane distance + normal; **unbiased depth**; single- and multi-view geometric consistency; **exposure compensation** | DTU **0.52 mm**; TnT F1 **0.52** (Neuralangelo 0.50 at > 128 h, PGSR ~0.75 h); Meetingroom 0.33 [OPENED] | **ScanNet++** (same protocol as GOF): F **0.687** (P 0.698, R 0.677), the best surface baseline; 0.710 on CoMe's six-scene set. **FIORD** indoor at 10 cm: Kitchen 0.644, Building 0.169, Meeting 0.403, **Hall 0.068**; six-scene mean 0.239 [GOFish Tables 2, 4, 10] [OPENED] | ~0.5–0.75 h per scene | Research/non-profit only; last commit 2024-12 [OPENED repo] |
| **GOFish** [GOFish] (Tu et al., arXiv 2610.37818, Oct 2026) | Surface Gaussians trained **directly on fisheye > 180°** (3DGUT base); opacity-field mesh | TnT F below PGSR (per-scene mean ≈ 0.40 vs ≈ 0.51, my average of Table 10 [CALC]) | ScanNet++ F **0.706**; FIORD six-scene mean 0.245 (PGSR 0.239); FIORD Hall 0.067 [OPENED] | Trained on a 24 GB A10G; FIORD ~153 min per scene | Code via project page; licence [UNVERIFIED] |
| **RaDe-GS** [RaDeGS] (Zhang et al., 2024) | Rasterised depth/normal for Gaussians | Not re-checked [UNVERIFIED] | Not found | Similar to 3DGS | Non-commercial [OPENED repo] |
| **DN-Splatter** [DNSplatter] (Turkulainen et al., WACV 2025) | 3DGS + monocular/sensor **depth and normal priors**, mesh extraction | — | **ScanNet++** (2 scenes, 5 cm): F **0.766**, CD 0.067 m. **MuSHRoom** (6 scenes): F **0.924**, CD 0.022 m. Both use **iPhone sensor depth** supervision, which we do not have; the monocular-prior variants are ablated on one scene only [DNSplatter Tables 1, 2, 8] [OPENED] | Trained on a 4090 (24 GB); nerfstudio | **Apache-2.0** [OPENED repo] |
| **Neural SDF + mono cues** (MonoSDF [MonoSDF], NeurIPS 2022; DebSDF in IM360; Neuralangelo [Neuralangelo], CVPR 2023) | SDF volume rendering with Omnidata depth/normal cues | Neuralangelo > 128 GPU-h per TnT scene [OPENED via 2DGS/PGSR] | MonoSDF with sensor-depth loss: ScanNet++ F 0.858, MuSHRoom F 0.921 [DNSplatter Tables 1–2]. IM360 trains DebSDF on **cubemap faces**, because OmniSDF on ERP "failed to converge" on large indoor scenes [OPENED] | ~47 min per ScanNet++ scene (MonoSDF, 4090) | Varied |
| **Planar primitives** ([PlanarSplatting], 2024; venue [UNVERIFIED]) | Optimise 3D planes directly | Not verified | Not verified | Fast (title claims 3 min) | Not checked |

**Indoor caveats (reading the indoor column):**
- **ETH3D** [ETH3D] is real indoor and outdoor scenes with laser-scan ground truth, scored in metric units. The images are **24 MP DSLR stills**, well exposed and uncompressed. The numbers are therefore an upper bound for H.265 video at ~0.1 bpp. Their *ranking* is still informative: on the indoor scenes, the gap between methods comes from **completeness on weakly textured surfaces** (COLMAP compl. 59.7% vs ACMMP 80.7% at 2 cm), while accuracy is ~91–92% for all of them. That is exactly the failure mode of bare concrete. I found no published ETH3D or ScanNet++ comparison that puts PatchMatch MVS and surface Gaussians side by side on one protocol.
- **ScanNet++** mesh scores (GOFish, CoMe protocol) use **scaled ICP per mesh** before the 5 cm test, so they measure *shape*, not metric scale. Metric scale comes from our control BA (§3), not from the dense method.
- **FIORD** is the closest public analogue to our data: real fisheye 360°, LiDAR ground truth, 10 cm threshold. On its large indoor rooms (Hall, Building), *every* Gaussian surface method scores F ≤ 0.18 at 10 cm, whether trained on rectified views or on the full FOV [GOFish]. That is a warning for garage-scale surface Gaussians. Part of it may come from SfM-to-LiDAR registration, which GOFish's diagnostics figure shows imperfect on some scenes. It is not proof that PatchMatch would do better there, because PatchMatch was not evaluated on FIORD.
- [Barazzetti2018] reports a ±2.5 mm mean discrepancy between a dense cloud from a consumer 360° camera and laser scanning on a wall, in a ~10 m room [OPENED]. That shows what MVS from 360° imagery at ~19 px/deg can deliver when the poses are good.

### 4.3 Recommendation for dense

1. **Metric baseline:** COLMAP `image_undistorter` (virtual views are already pinhole), then OpenMVS DensifyPointCloud (resolution-level 1 at ~2100 px). Feed the marker 3D points and BA tie points as anchors. Then ReconstructMesh and RefineMesh. **A/B densifier: ACMMP** (MIT, reads COLMAP output), fused and then meshed with OpenMVS. Its planar prior gives the best verified ETH3D *indoor* completeness among the open classical methods. Keep it if it raises floor and ceiling coverage without worsening checkpoint residuals.
2. **Surface variant:** PGSR on the same poses (fixed; no pose refinement), images at 1000–1400 px to fit 16 GB, exposure compensation on. Process in **spatial chunks** (bays or aisles) with overlap, at a few hundred views per chunk [assessment].
3. **Hole-filling only:** monocular depth/normal priors (Depth Anything V2 [DAv2], MoGe [MoGe]), scale-aligned per view to MVS depth, and DN-Splatter-style normal supervision on **floor/ceiling** masks.
4. **Planar regularisation** in the dense stage only, with a per-plane fit tolerance. Never across the whole floor, which has drainage falls.
5. **Choose per region** by checkpoint and planarity residuals (§5). Report where each surface came from.
6. Thin structures: keep the OpenMVS dense cloud for them (meshes from 2DGS/PGSR erode thin pipes [assessment]). Cars: masked out of the accuracy evaluation.

---

## 5. Accuracy evaluation and realistic expectations

### 5.1 Protocol (what "proven" means here)

1. **Checkpoint distances (primary):** use the held-out marker-to-marker distances (≥ 30% of all, including ≥ 3 lines > 20 m and ideally one > 50 m). Report:
   - mean signed error (bias, i.e. scale);
   - RMSE;
   - max;
   - **error as % of distance**, plotted against distance (drift shows as growth);
   - per-area breakdown.
   Pass criteria (project targets): RMSE ≤ 2–3 cm for lines < 10 m, and |error| ≤ 1% for every line > 20 m.
2. **Checkpoint coordinates** if a total station is available: 3D RMSE per axis.
3. **Leave-one-sortie-out / split-half:** reconstruct two flights independently, align with Sim(3) on half the markers, and compare the other half. This measures repeatability, as the repeatability test in [Perfetti2024] did [ABS].
4. **Floor planarity:** RANSAC-fit planes per bay. Report the RMS residual and max deviation. Compare against a hand level or laser line if available. Expect real falls of ~1–2% [UNVERIFIED typical].
5. **Pillar-grid regularity:** fit pillar axes (cylinders or boxes). Report spacing residuals against drawings, or against the median spacing. Report verticality using the gravity vector.
6. **Loop-closure gap:** before closing loops (sequential-only model), measure the 3D gap at the revisit, in metres and as % of loop length. After closing, re-measure the marker residuals around the loop.
7. **Completeness:** % of floor area and of pillar faces with surface within 5 cm of the reference, if a reference scan exists (phone LiDAR in sample bays, or a TLS scan of one zone). Use cloud-to-cloud/M3C2 distances, as [Janiszewski2022] and [GomezLopez2025] did.
8. **Self-consistency (diagnostic only):** reprojection error, track length, registered fraction. These are **not** accuracy, because a folded map can have low reprojection error (shared context).

### 5.2 Published 360°-camera accuracy (reported results)

| Study | Camera / data | Scene | Control | Reported accuracy | **Anchor comparability** (px/deg vs our 18.3 · stills/video · control layout · metric type) |
|---|---|---|---|---|---|
| [Barazzetti2018] ISPRS Archives XLII-2 | Xiaomi Mi Sphere 360, stitched equirect **6912×3456** stills, Metashape/Pix4D spherical model | Room 10.9×6×3.7 m, **poor light, poor texture** | 6 GCP, 11 checkpoints, Leica TS30 | Checkpoint RMSE **4.6–7.2 mm** per axis (≈1:2000); dense vs. laser ±2.5–5 mm [OPENED] | **19.2 px/deg** (6912 px / 360° [CALC]), i.e. ≈ ours · **stills**, no codec · control **distributed** through one small room, total station · **CP RMSE** per axis (+ cloud-to-laser for dense). It differs from us in stills, TS control and room size, *not* in resolution |
| [Janiszewski2022] Remote Sensing 14(21) | 360° stills, 27 stations | 10 m rock tunnel | Laser scan reference | **4.6 mm** distance error vs. reference scan [ABS] | px/deg [UNVERIFIED] (abstract only) · stills · scan-referenced, short (10 m) · **distance error vs. reference scan** |
| [Rezaei2024] Sensors 24(11) | Low-cost spherical camera, fisheye images, Metashape | Underpass | GCPs | GCP ≈ 1 mm; mean cloud distance to laser **0.05 m** [ABS] | px/deg [UNVERIFIED] · stills · GCPs (layout not in abstract) · **GCP residual** (fit, not independent) + **cloud-to-laser mean** |
| [Perfetti2024] Remote Sensing 16(23) | Insta360 Pro2, MG1, ANT3D fisheye rig | Narrow spiral staircase | Full vs. partial control | **1 cm** with appropriate control; **5–10 cm drift** partially unconstrained [ABS] | px/deg [UNVERIFIED] · stills (rig) · **full vs. partial** control, compared directly · **checkpoint error** (as stated in abstract) |
| [GomezLopez2025] ISPRS Archives XLVIII-M-9 | Kandao Obsidian Go **video** (6 fisheyes, 220° each, 1728², 30 fps), raw fisheye frames, Metashape | Tomb interior, dark, 142 m², ~30 m long (plus two other scenes) | 4 GCPs at the **start**; CPs at the **end** | Mesh-to-TLS differences **within ~2 cm in the lit central nave**; checkpoint **maxima 4.8 cm and 6.9 cm** (two scenes) and **> 10 cm** (QH31, far end); M2M mean 2.4 cm, SD 7.7 cm (QH31) [OPENED] | **~7.9 px/deg** (1728 px / 220° [CALC]), 2.3× coarser than ours · **video**, compressed · control at **one end only**, so it measures drift · "~2 cm" is **M2M vs. TLS**, *not* CP RMSE; the CP numbers are **maxima** |
| [RIGOR] arXiv 2026 | 360° video, feed-forward (DA3) | Construction sites | None (scale-adjusted ICP) | Chamfer **0.132 m**, ATE 2.31 m [OPENED] | perspective-rig from panoramas · video · **no control**, scale fitted by ICP · **Chamfer / ATE**, no metric-scale test |

**Reading the table:**
- **Stills + distributed total-station control + one small room → mm** (Barazzetti). Its angular resolution equals ours, so resolution is *not* why we should expect worse. Stills vs. compressed video, dim light, and a 50–100 m extent with a weaker control network are.
- **Video + darkness + control at one end only → checkpoint maxima of 5–10+ cm at the far end**, at 2.3× coarser px/deg (Gómez-López). Its "~2 cm" is a surface-to-TLS difference in the best-lit area, not a checkpoint RMSE, so it must not be used as a video checkpoint anchor.
- **Full vs. partial control on the same data: 1 cm vs. 5–10 cm** (Perfetti). Control layout matters more than the camera.
- Feed-forward gives **dm**.

**Why 1–2 cm and 0.05–0.3% (planning) rather than 0.5–1 cm and 0.03% (stretch).** Our angular resolution matches the mm-level stills anchor, and distributed markers plus a scale-bar BA remove the one-end-control drift that dominates Gómez-López. That argues for better than their 5–10 cm. Against that, three things argue for worse than Barazzetti's 5–7 mm: H.265 at ~0.1 bpp, dim-light noise and motion blur, and a lot 5–10× longer than his room, controlled by a tape/laser trilateration network rather than a total station. The two corrected anchors bracket our case from both sides. **1–2 cm local RMSE and 0.05–0.3% global** is the defensible planning band. 0.5–1 cm and 0.03% would need stills-like image quality and a total-station network, so they are stretch goals only.

### 5.3 Expected accuracy for this project (my assessment, assumes §7 pipeline and A1 capture protocol)

| Quantity | With distributed markers (cluster every ≤ 10–15 m, scale bars in BA) | Scale-only Sim(3), control at ends | Stitched-equirect variant | Basis |
|---|---|---|---|---|
| Local distance error, < 10 m | **1–2 cm RMSE** (stretch: 0.5–1 cm) | 1–3 cm | 2–5 cm near walls | Triangulation σ ≈ Z²σ_θ/B ≈ 4 mm at Z = 5 m, B = 3 m [CALC], a lower bound; Barazzetti (same px/deg, stills, TS: 5–7 mm) and Perfetti (1 cm with control) bracket it from below; video/H.265/dim pushes up |
| Global distance error, 20–100 m | **0.05–0.3%** (stretch: 0.03%) | 0.2–1% | 0.3–1.5% | Perfetti 5–10 cm drift when partially unconstrained; Gómez-López > 10 cm CP max at ~30 m with one-end control (≳ 0.3%) [CALC] |
| Floor planarity RMS (dense) | 0.5–1.5 cm (PGSR/planar), 1–3 cm (raw MVS) | same | +seam artefacts | Concrete + H.265; assessment |
| Pillar faces / walls | 1–2 cm | 1–3 cm | **seam-band errors of cm** (A1: 7–40 px at 1–5 m) | A1 seam model |
| Thin pipes | detected if ≥ ~3 px wide: ≥ ~1 cm at 2 m | — | — | ~1.9 mm/px at 2 m (A1) |
| Failure risk | Folded map unless the §2.4 gates hold | Higher | Higher | ORBIT, GLOMAP limitations |

---

## 6. Method selection (protocol)

### 6.1 Long list (25)

| # | Candidate | Family |
|---|---|---|
| 1 | COLMAP 4.2 incremental + **raw-fisheye virtual-view rig** | Classic SfM, rig |
| 2 | COLMAP 4.2 global mapper (GLOMAP) + gravity RA on the same rig | Global SfM |
| 3 | COLMAP native `EQUIRECTANGULAR` on stitched equirect | Spherical SfM |
| 4 | Per-lens "half-equirect" (each fisheye resampled to its own ERP) as a 2-camera spherical rig | Spherical SfM, rig |
| 5 | `pycolmap.panorama` rig on stitched equirect (seam masked) | Perspective rig |
| 6 | Raw fisheye in COLMAP `RAD_TAN_THIN_PRISM_FISHEYE`, cropped to θ < 85° | Fisheye SfM |
| 7 | SphereSfM | Spherical SfM |
| 8 | OpenMVG spherical | Spherical SfM |
| 9 | IM360 | Spherical SfM + SDF |
| 10 | stella_vslam (equirect) | SLAM |
| 11 | RIGOR | Feed-forward + rig + Sim(3) graph |
| 12 | MASt3R-SfM | Learned SfM |
| 13 | VGGT / VGGT-Long / π³ / MapAnything / DA3 | Feed-forward |
| 14 | MASt3R-SLAM | Learned SLAM |
| 15 | Doppelgangers++ | Disambiguation |
| 16 | LoMa / ALIKED+LightGlue / RoMa | Matchers (component) |
| 17 | Metashape (spherical + fisheye + scale bars) | Commercial reference |
| 18 | COLMAP PatchMatch + OpenMVS | Classic MVS |
| 19 | PGSR | Surface Gaussians |
| 20 | 2DGS / GOF / RaDe-GS | Surface Gaussians |
| 21 | DN-Splatter (priors) | Prior-fused GS |
| 22 | Neural SDF (MonoSDF/DebSDF/Neuralangelo) | Implicit |
| 23 | PlanarSplatting / planar primitives | Planar |
| 24 | ACMM / ACMMP (planar-prior PatchMatch) | Classic MVS (added in revision) |
| 25 | GOFish (full-FOV fisheye surface Gaussians) | Surface Gaussians (added in revision) |

### 6.2 Screening (dropped, one line each)

- **#6 cropped fisheye in COLMAP:** discards the θ > 85° band, which is the horizon and walls, and the same views are better served by #1.
- **#8 OpenMVG spherical:** IM360 shows it registering 2–25 of 20–59 images on Matterport scenes [OPENED]. It is the weakest spherical baseline and adds nothing over COLMAP 4.1+.
- **#7 SphereSfM:** superseded by native spherical support in COLMAP ≥ 4.1 (the same idea, maintained upstream); kept only as historical reference.
- **#14 MASt3R-SLAM:** perspective input, NC licence (MASt3R weights), and a SLAM-grade target, not survey-grade.
- **#13 feed-forward models as the metric solution:** no fisheye or pano support (VGGT), ~60–70 frames per 16 GB, and the best 360° derivative is at dm level. Kept only as a component in the experimental track.
- **#17 Metashape:** commercial. It is the reference point surveyors use (Barazzetti, Rezaei, Gómez-López), worth a one-off comparison if a licence exists, but not core.
- **#23 PlanarSplatting:** promising for floors, but it gives no geometry for thin or non-planar objects; kept as an idea inside the dense stage.
- **#16 matchers** are components inside #1/#2, evaluated by A/B test (§2.3), not as stand-alone methods.
- **#15 Doppelgangers++** is a component (loop filter), covered in §2.4.
- **#20 GOF/RaDe-GS** are folded into one "2DGS-class" entry (similar licence and behaviour).
- **#25 GOFish:** its geometry is level with PGSR (FIORD mean F 0.245 vs 0.239, ScanNet++ 0.706 vs 0.687), and it is just as weak on large indoor rooms. Its advantage is full-FOV *rendering*, which belongs to the splatting chapter. The licence is unverified and the release is one month old, so it is not scored here. It is worth re-testing as a fisheye-native surface variant once the code is checked.

### 6.3 Short-list deep dives

**A. Raw-fisheye virtual-view rig + COLMAP 4.2 incremental (#1)**
- **Core idea:** exact per-lens central projection, 10 pinhole views per frame, rig BA. Gravity priors, sequential + loop matching, learned features.
- **Assumptions:**
  - The two sensors expose simultaneously. Violated slightly by rolling shutter; sync is [UNVERIFIED].
  - The DJI calibration is accurate. To be verified.
  - b is known.
- **Evidence:**
  - Rig-constrained, IO+RO-estimated processing gave the best results in [Perfetti2024].
  - ORBIT trusts rig-of-cube-faces SfM to make its 360° ground truth.
  - COLMAP's own notes rank perspective rendering above native spherical for accuracy.
  - Raw fisheye frames plus calibrated rig scale bars were used successfully for 360° video by [GomezLopez2025].
- **Compute:** 10 views × ~1500 frames ≈ 15k images per 10-minute sortie at 2.5 fps keyframes. SIFT/ALIKED extraction on GPU; Caspar BA on GPU. Fits 16 GB.
- **Code:** COLMAP BSD, very active (2026-11-10). We write the OSV decoder (OpenOSV Apache-2.0 as a start, per A1), the DJI-model remapper and the rig JSON.
- **Failure modes:** a wrong b or rotation (seam errors return, at a smaller scale); textureless aisles; aliasing loops; rolling shutter during yaw.

**B. COLMAP global mapper with gravity (#2)**
- **Core idea:** rotation averaging (1-DoF with gravity), then global positioning, then BA.
- **Reported results:** ETH3D SLAM averages (Table 1): AUC@0.1 m 57.0 vs 47.6 (COLMAP), recall@0.1 m 66.4 vs 57.9, 133.5 s vs 1115.4 s (~8× faster). On the *repetitive* sequences, recall is only 32.7 vs 28.5 [OPENED].
- **Assumptions violated:** rotation averaging needs a correct view graph; **symmetric structures break it**, as the authors note.
- **Compute:** light.
- **Code:** inside COLMAP.
- **Use:** fast cross-check and initialisation, plus a 4.2 multi-component fallback.

**C. Stitched equirect → perspective rig, seam masked (#5)**
- **Core idea:** COLMAP `panorama_sfm` (12 views at 90°, pitches −35/0/+35) with horizon-row masks.
- **Assumptions violated:** central projection near the seam. That is the reason for the mask, and the mask costs wall content (§1.2).
- **Evidence:** the official example; ORBIT.
- **Code:** in pycolmap; trivial to run.
- **Use:** quickest baseline, and the fallback if the OSV decode slips.

**D. Per-lens half-equirect spherical rig (#4)**
- **Core idea:** resample each fisheye to its own ERP (horizon at the equator, its own centre) and treat the two ERPs as a 2-camera spherical rig.
- **Strength:** keeps θ > 90° in native spherical math; only 2 images per frame.
- **Weakness:** COLMAP's own accuracy caveat about native spherical; dense needs perspective anyway. Spherical rig BA is supported in 4.1+, but I found no published use [assessment].
- **Use:** experimental speed path.

**E. IM360 (#9)**
- **Core idea:** spherical SfM with dense spherical matching (EDM), then cubemap DebSDF, then texture optimisation.
- **Reported results:** 37/37 registered with AUC@10° 84.5 on a Matterport scene where cubemap baselines registered 16–22/37 [OPENED].
- **Assumptions violated:** sparse stills, human-chosen pairs, stitched ERP. There is no metric accuracy evaluation.
- **Code:** project page found; repository and licence not verified [UNVERIFIED].
- **Use:** shows that dense matching rescues textureless indoor registration, which supports a RoMa fallback in our pipeline.

**F. RIGOR (#11)**
- **Core idea:** frozen DA3 on a 4-view virtual rig; rig repair; cyclic loop retrieval; Sim(3) graph.
- **Reported results:** ATE 2.31 m, CD 0.132 m, F@25 cm 0.873 on HTO [OPENED].
- **Assumptions:** gravity-aligned panoramas; it does not recover metric scale.
- **Code:** Apache-2.0, active (2026-10-07). DA3 weights licence [UNVERIFIED].
- **Use:** loop *verification* ideas (cyclic consensus) and a second-opinion trajectory.

**G. MASt3R-SfM / VGGT family (#12–13)**
- **Core idea:** learned pairwise or global pointmaps; retrieval from encoder tokens.
- **Assumptions violated:** no fisheye/pano input; memory (VGGT 21 GB at 100 frames) [OPENED].
- **Licences:** MASt3R CC BY-NC-SA 4.0; VGGT custom; π³ BSD-style; MapAnything Apache-2.0 [OPENED repos].
- **Use:** diagnostics on failure segments only.

**H. stella_vslam (#10)**
- **Core idea:** ORB-feature SLAM on equirect with BoW loops.
- **Assumptions violated:** stitched (seam) input; BoW loop detection is vulnerable to aliasing.
- **Code:** BSD-2, active (2026-08-26).
- **Use:** in-field QA and a pose prior; not survey-grade.

**Dense short list:**
- **OpenMVS:** AGPL-3.0, active. A PatchMatch-class densifier. The class is verified on ETH3D indoor (COLMAP 70.4/82.0, ACMM 79.8/88.5 F1 at 2/5 cm); OpenMVS's own leaderboard value (~78 at 2 cm) is unverified. Accuracy is ~91–92% at 2 cm on indoor scenes; the losses are completeness on weak texture, i.e. holes on bare concrete.
- **ACMMP:** MIT; planar priors lift ETH3D indoor completeness from 59.7% (COLMAP) to 80.7% at 2 cm (F1 85.4/92.9 at 2/5 cm). Research code with no commits since 2022-11; DSLR-stills evidence only.
- **PGSR:** best published DTU/TnT geometry among the 3DGS-class methods tabulated, and best surface baseline on ScanNet++ (F 0.687 at 5 cm, scale-aligned). On FIORD's large fisheye indoor rooms it drops to F 0.07–0.17 at 10 cm, as do all Gaussian surface methods. Has multi-view consistency and exposure compensation. Research-only licence; last commit 2024-12.
- **2DGS:** DTU 0.80 mm, TnT 0.32; ScanNet++ F 0.420 and MuSHRoom F 0.604 at 5 cm (DN-Splatter's tables); GOF 0.601 on ScanNet++ (GOFish's table); non-commercial; active.
- **DN-Splatter:** Apache-2.0; indoor priors; ScanNet++ F 0.766, MuSHRoom F 0.924 at 5 cm, but **with iPhone sensor depth**, which we lack; priors can bias.
- **Neural SDF:** smooth, complete surfaces. Neuralangelo-class compute (> 128 GPU-h) is impractical; MonoSDF-class is feasible but slow and erodes thin pipes.

### 6.4 Score table

Weights: Fit ×3, Evidence ×2, Implementability ×2, Accuracy impact ×3, Maturity ×1. Maximum 55.

**Poses and camera model**

| Option | Fit | Evid. | Impl. | Acc. | Mat. | **Total** | One-line justification (Fit / Evid / Impl / Acc / Mat) |
|---|---|---|---|---|---|---|---|
| A. Raw-fisheye rig + COLMAP incr. | 5 | 4 | 4 | 5 | 4 | **50** | Keeps the horizon without seam error / rig processing best in Perfetti, used by ORBIT / needs our own OSV+remap code / removes the dominant systematic error / COLMAP mature, renderer new |
| B. Global mapper + gravity (same rig) | 4 | 4 | 5 | 4 | 4 | **46** | Gravity priors fit, symmetric pillars risky / ECCV; ETH3D SLAM Table 1 AUC@0.1 m 57.0 vs 47.6 / built in / slightly below incremental in BA quality / integrated since 4.0, regression fixed in 4.2.1 |
| D. Per-lens half-equirect spherical rig | 4 | 2 | 4 | 4 | 2 | **38** | Seam-free and full-band / no published use / supported model, simple / spherical "less accurate" per COLMAP / untested combination |
| C. Stitched equirect → persp. rig, masked | 2 | 4 | 5 | 2 | 4 | **34** | Seam on horizon forces masking / official example, ORBIT / zero new code / loses long-range walls / mature |
| H. stella_vslam | 3 | 2 | 4 | 2 | 4 | **31** | Equirect, real time, but seam and BoW aliasing / no survey-grade evaluation found / BSD-2, active / SLAM-grade / mature |
| E. IM360 | 3 | 3 | 2 | 3 | 2 | **30** | Indoor textureless 360° but stills + ERP / ICCV, registration only / code status unverified / no metric eval / research code |
| F. RIGOR | 3 | 3 | 3 | 1 | 2 | **26** | Designed for repetitive 360° video / HTO evaluation / Apache, DA3 dependency / dm-level CD, no metric scale / brand new |
| G. MASt3R-SfM / VGGT family | 2 | 3 | 2 | 2 | 3 | **25** | No pano/fisheye, memory / strong perspective benchmarks / NC or custom licences, 16 GB limits / cm not demonstrated indoors / fast-moving field |

*Totals recomputed in revision with the stated weights (C 35→34, H 30→31, F 28→26, G 24→25); H now ranks above E. The pick is unchanged.*

**Dense**

| Option | Fit | Evid. | Impl. | Acc. | Mat. | **Total** | One-line justification |
|---|---|---|---|---|---|---|---|
| COLMAP PatchMatch + OpenMVS | 3 | 4 | 4 | 4 | 5 | **42** | Holes on concrete / PatchMatch class verified on ETH3D **indoor** (COLMAP F1 70.4/82.0, ACMM 79.8/88.5 at 2/5 cm) plus Barazzetti ±2.5 mm; OpenMVS's own number unverified, DSLR stills not video / AGPL OK internally / metric where textured, ~92% accuracy at 2 cm indoors / mature |
| PGSR | 4 | 4 | 3 | 4 | 3 | **41** | Planar + multi-view consistency + exposure compensation suit concrete / DTU 0.52, TnT 0.52, **ScanNet++ F 0.687** (best surface baseline, scale-aligned); FIORD large rooms ≤ 0.17 lowers confidence but applies to all GS methods / research-only licence, chunking needed / best GS geometry / stale since 2024-12 |
| ACMMP densify → OpenMVS mesh | 4 | 4 | 3 | 4 | 2 | **40** | Planar prior targets textureless indoor planes / **ETH3D indoor F1 85.4/92.9** (TPAMI), stills only / MIT, COLMAP converter, but unmaintained CUDA code / best verified indoor completeness / no commits since 2022-11 |
| DN-Splatter (priors) | 4 | 3 | 4 | 3 | 3 | **38** | Indoor priors fill textureless areas / ScanNet++ F 0.766, MuSHRoom 0.924, but with **sensor depth** we lack; mono variant on one scene / Apache, nerfstudio / priors bias metric surfaces / maintained to 2025 |
| 2DGS-class (2DGS/GOF/RaDe-GS) | 3 | 4 | 3 | 3 | 4 | **36** | Weaker on textureless planes than PGSR / DTU 0.74–0.80; ScanNet++ F 0.42 (2DGS) and 0.60 (GOF) / non-commercial / mid / widely used |
| Neural SDF + mono cues | 3 | 3 | 2 | 3 | 2 | **30** | Complete, smooth but erodes thin parts / IM360; MonoSDF ScanNet++ F 0.858 only with sensor depth / slow on 16 GB / mid / research |

*Evidence scores re-justified in revision with indoor benchmarks (Issue 5). No dense score changed; ACMMP was added. All dense totals were rechecked with the weights.*

### 6.5 Pick

- **Primary:** **A + B** (raw-fisheye virtual-view rig; incremental COLMAP with global as cross-check). Dense: **OpenMVS baseline + PGSR variant**, chosen per region by checkpoints, with **ACMMP as an A/B densifier** in front of OpenMVS meshing (40 vs 42: it has stronger indoor evidence but is less mature).
- **Runner-up:** **C** (DJI Studio 6K unstabilized equirect → `pycolmap.panorama` rig with a ±8° horizon mask). Same control and dense stages.
- **Experimental (high upside):** **D + fisheye-coordinate refinement BA**. Native per-lens spherical rig for speed, then map all tracks to raw fisheye pixels and run a custom pyceres BA with the DJI KB-5 model (θ up to 105°), b, intrinsics, marker scale bars and a rolling-shutter term. Add RIGOR-style cyclic rig consensus for loop verification.
- **What would change my mind:**
  - (i) If the hover-board calibration shows the factory calibration plus remap residual above ~0.5 px and it cannot be fixed, intrinsics must be refined in BA, and the experimental track becomes primary.
  - (ii) If C's checkpoint errors on a pilot equal A's within noise (e.g. markers and walls all > 5 m away), C wins on simplicity.
  - (iii) If a feed-forward 360° model demonstrates < 2 cm checkpoint error on an indoor benchmark with metric GT, revisit G/F.
  - (iv) Dense: if PGSR shows FIORD-like collapse on our pilot (surface F at 5 cm far below OpenMVS against the sample reference scan), demote it to hole-filling only. If ACMMP beats OpenMVS densify on floor/ceiling completeness at equal checkpoint error, promote it to the baseline.

---

## 7. Recommended geometry pipeline (ordered)

| Stage | Tool | Key settings / notes |
|---|---|---|
| 0. Calibration (once per unit/firmware) | Hover clip at boards (A1 §6); pyceres DJI-model or Double-Sphere fit; Kalibr-style rig fit | Verify factory intrinsics (< 0.5 px), estimate **b** and inter-lens R, build **airframe masks**, measure RS readout |
| 1. Decode | OpenOSV-derived decoder (Apache-2.0) + ffmpeg | Two 3840² 10-bit streams + per-frame quaternions + exposure metadata; keep the 10-bit data through remap |
| 2. Keyframe selection | Python | 2–3 fps (~0.15–0.2 m spacing at 0.4 m/s); reject IMU \|ω\| > 10°/s and Laplacian-variance outliers |
| 3. Virtual views | `cv2.remap` with DJI KB-5+tangential | Per lens: axial + 4 oblique (θc ≈ 62°), 90° FOV, f ≈ 1047 px, 2094 px²; COLMAP masks for outside-circle and airframe; mild denoise optional (A/B test) |
| 4. Database + rig | `feature_extractor --ImageReader.single_camera_per_folder 1`, `rig_configurator` | `PINHOLE` fixed intrinsics; rig JSON with known R and t = b for the down group; gravity `PosePrior` per frame from the fused quaternion |
| 5. Features/matching | ALIKED+LightGlue (A/B vs SIFT and LoMa) | `SequentialMatching.overlap` 10–15, `expand_rig_images 1`, `loop_detection 1`, `loop_detection_min_index_distance` ≈ 1 min of frames |
| 6. Loop gates | Custom (pycolmap) | Marker-ID gate, rig-consensus (≥ 3/10 views), gravity gate; drop rejected pairs from the DB |
| 7. Mapping | `mapper` (Caspar BA) and `global_mapper` (`ra_use_gravity 1`, `multiple_models 1`) | `Mapper.ba_refine_sensor_from_rig 0`, `ba_refine_focal_length 0`; compare both; components merged only through shared marker IDs |
| 8. Markers | AprilTag 36h11 on virtual views → corner tracks | Detections at 1.5–5 m slant range; triangulate; robust filtering by multi-view consistency |
| 9. Control BA | pyceres on pycolmap reconstruction | Scale-bar residuals (70% of distances), Cauchy loss on reprojection; hold out 30%; Sim(3) to trilaterated marker frame |
| 10. (Exp.) fisheye refinement | pyceres, DJI model on raw pixels | Refine intrinsics, b, RS term; accept only if checkpoint RMSE improves |
| 11. Dense | `image_undistorter` → OpenMVS (A/B: ACMMP densify → OpenMVS mesh); PGSR on fixed poses | OpenMVS resolution-level 1; PGSR 1000–1400 px, chunked by aisle; car/person masks |
| 12. Fusion + QA | Open3D/CloudCompare scripts | Per-region selection by checkpoint/planarity; §5 report auto-generated |

---

## 8. Interactive component suggestions (for the HTML)

1. **Seam-parallax vs. distance plot.** Sliders for b (1–5 cm) and stitch distance d₀. Plot δ(d) = b·|1/d − 1/d₀| in degrees and in px at 6K/8K. Overlay the "±δ mask removes wall heights" curve (±d·tan δ around flight height) to show why masking fails beyond ~10 m.
2. **Scale-error propagation calculator.** Inputs: number of scale bars, bar length, endpoint σ, and query distance D. Output: σ_s = √2σ_p/(L√N) and the error at D, side by side with typical drift (0.1–1%), to show that **drift, not scale**, dominates.
3. **Loop-closure drift demo.** A 2D garage grid with identical pillars and a random-walk trajectory. Toggle between "sequential only", "loop closure", "false loop (aliased bay)" and "marker-ID gate on". Show the map folding and the checkpoint error bars.
4. **Virtual-view layout explorer.** A 3D sphere showing the up/down lens image circles (θ ≤ 105°), the overlap band and the 10 pinhole frusta. A slider for FOV and θc shows coverage gaps and stretch (1/cos²α).
5. **Triangulation precision widget.** σ_Z ≈ Z²σ_θ/B, with presets for "inter-lens b = 3 cm" vs "motion baseline 3 m", explaining why b cannot provide scale.
6. **Accuracy-expectation table with toggles** (control density, stills vs. video, stitched vs. raw), linked to the published studies in §5.2.

---

## Handoff

- **COLMAP (4.2.1, verified in source) has no perspective or fisheye model for θ ≥ 90°.** `OPENCV_FISHEYE`, `RAD_TAN_THIN_PRISM_FISHEYE` and `EUCM` all enforce w > 0. Only `EQUIRECTANGULAR` covers the full sphere, and PatchMatch MVS needs pinhole K. Raw 200° fisheyes therefore cannot go into COLMAP directly without losing the horizon band (the walls).
- **Primary input representation:** raw fisheye → per lens 1 axial + 4 oblique (θc ≈ 62°) pinhole views (90°, f ≈ 1047 px, ~2094 px²). Use a **10-view COLMAP rig with two optical centres** (down group offset by the calibrated b). This is seam-free by construction and also feeds dense MVS and 3DGS directly. Fallback: DJI Studio 6K unstabilized equirect → `pycolmap.panorama` rig with a ±8° horizon mask.
- DJI's KB-5 + tangential model equals COLMAP's `RAD_TAN_THIN_PRISM_FISHEYE` form (k₅ = s = 0) for θ < 90°. Use that for verification. The full lens needs our own bearing-vector code (pyceres) or Double Sphere.
- **Poses:** COLMAP incremental + rig (Caspar BA), with the global mapper + `ra_use_gravity` as cross-check. Use sequential matching with loop detection and `loop_detection_min_index_distance`, and gravity `PosePrior` from the fused DJI quaternion (never the raw accelerometer). Use ALIKED+LightGlue, A/B tested against SIFT and LoMa.
- **False-loop defences** (SfM side): temporal prior first; marker-ID gate; rig-consensus gate (inliers in ≥ 3 of 10 views); gravity gate; incremental-vs-global disagreement; checkpoint residuals. Reprojection error is not evidence. Doppelgangers++ (CVPR 2025) is an optional loop-pair filter; its code is **CC BY-NC-SA 4.0** (non-commercial). On ETH3D SLAM, GLOMAP beats COLMAP on average (AUC@0.1 m 57.0 vs 47.6, Table 1), but both are weak on the *repetitive* sequences (recall 32.7 vs 28.5).
- **Control:** AprilTag 36h11, detected on pinhole views at 1.5–5 m. Laser/tape distances are adjusted as a trilateration network; 70% become **scale-bar residuals in a pyceres BA** and 30% are held out. A marker cluster every ≤ 10–15 m. Sim(3)-only alignment is insufficient (published 360° drift is 5–10 cm without distributed control).
- **Dense:** OpenMVS (AGPL) as the metric baseline, with ACMMP (MIT) as A/B densifier, plus PGSR (research-only licence) for textureless planes, on fixed poses, chunked for 16 GB. Indoor evidence: on ETH3D indoor (DSLR stills), PatchMatch-class F1 at 2/5 cm is 70.4/82.0 (COLMAP), 79.8/88.5 (ACMM) and 85.4/92.9 (ACMMP). On ScanNet++, PGSR's F at 5 cm is 0.687, best among surface Gaussians. On FIORD's large fisheye indoor rooms, all surface Gaussians score ≤ 0.18 at 10 cm, a garage-scale warning. Mono depth/normal priors are for hole filling only, never in evaluated regions. Mask cars and people.
- **Expected accuracy (assessment; planning numbers):** **1–2 cm RMSE locally and 0.05–0.3% globally** with distributed markers. 0.5–1 cm and 0.03% are stretch goals only. With control at the ends only, expect 0.2–1%. Anchor comparability: Barazzetti 2018 has 4.6–7.2 mm per-axis CP RMSE at **19.2 px/deg (≈ ours)**, but on stills with total-station control in one room. Gómez-López 2025 is **video at ~7.9 px/deg** with control at one end: CP **maxima** 4.8/6.9/> 10 cm, and its "~2 cm" is mesh-to-TLS in the lit nave, *not* CP RMSE. Other anchors: 1 cm with full control vs. 5–10 cm with partial control (Perfetti 2024, stills), 13 cm CD (RIGOR, feed-forward, no metric scale).
- **Evaluation protocol:** held-out distance RMSE, max and % of distance vs. distance; split-sortie repeatability; floor planarity (expect real drainage falls); pillar-grid spacing; loop gap before and after closure; completeness against a sample reference scan.
- **For the splatting/3DGS chapter:** reuse the same pinhole virtual views and fixed metric poses; do not re-run SfM on stitched equirect. **For A3a:** filtering owns masks (airframe, cars, people) and frame selection; geometry consumes them.

```json
[
  {"key": "COLMAPsrc", "title": "COLMAP source code (sensor/models/base.h, eucm.h, fisheye_radial.h, thin_prism.h, spherical.h; mvs/model.cc; image/undistortion.cc; geometry/pose_prior.h; controllers/option_manager.cc), commit 137f216", "authors": "COLMAP contributors (Schönberger et al.)", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/colmap/colmap", "code": "https://github.com/colmap/colmap", "license": "BSD-3-Clause", "type": "repo", "verified": true},
  {"key": "COLMAPChangelog", "title": "COLMAP Changelog (4.0.0 to 4.2.1)", "authors": "COLMAP contributors", "venue": "COLMAP docs / CHANGELOG", "year": 2026, "url": "https://github.com/colmap/colmap/blob/main/CHANGELOG.rst", "code": "https://github.com/colmap/colmap", "license": "BSD-3-Clause", "type": "docs", "verified": true},
  {"key": "COLMAPRigs", "title": "COLMAP documentation: Rig Support (doc/rigs.rst) and Camera Models (doc/cameras.rst)", "authors": "COLMAP contributors", "venue": "COLMAP docs", "year": 2026, "url": "https://colmap.github.io/rigs.html", "code": "https://github.com/colmap/colmap", "license": "BSD-3-Clause", "type": "docs", "verified": true},
  {"key": "COLMAPPanorama", "title": "pycolmap.panorama / panorama_sfm example (perspective virtual-view rig, EQUIRECTANGULAR conversion)", "authors": "COLMAP contributors", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/colmap/colmap/blob/main/python/pycolmap/panorama.py", "code": "https://github.com/colmap/colmap", "license": "BSD-3-Clause", "type": "repo", "verified": true},
  {"key": "IM360", "title": "IM360: Large-scale Indoor Mapping with 360 Cameras", "authors": "Dongki Jung, Jaehoon Choi, Yonghan Lee, Dinesh Manocha", "venue": "ICCV 2025", "year": 2025, "url": "https://arxiv.org/abs/2502.12545", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "RIGOR", "title": "RIGOR: Rig-Informed Geometry for Omnidirectional Reconstruction", "authors": "Tingjun Huang, Dmitry Rudshin, Mathieu Meyer, Pietro Bonazzi, Marc Pollefeys, Emilia Szymanska", "venue": "arXiv 2609.13504", "year": 2026, "url": "https://arxiv.org/abs/2609.13504", "code": "https://github.com/TangentH/RIGOR", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "ORBIT", "title": "ORBIT++: Benchmarking SfM in the Wild with 360° Video", "authors": "Sara Sabour, Linyi Jin, Richard Tucker, Amir Hertz, Marcus Brubaker, Saurabh Saxena, Junhwa Hur, Andrea Tagliasacchi, Deqing Sun, David J. Fleet, Richard Szeliski, Noah Snavely", "venue": "CVPR 2026 (arXiv 2608.22039)", "year": 2026, "url": "https://arxiv.org/abs/2608.22039", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "SphereSfM", "title": "SphereSfM (README; paper: 3D reconstruction of spherical images based on incremental structure from motion, Jiang et al., Taylor & Francis 2024)", "authors": "San Jiang et al.", "venue": "GitHub repository; journal [UNVERIFIED]", "year": 2024, "url": "https://github.com/json87/SphereSfM", "code": "https://github.com/json87/SphereSfM", "license": "BSD (COLMAP-derived)", "type": "repo", "verified": true},
  {"key": "OpenVSLAM", "title": "OpenVSLAM: A Versatile Visual SLAM Framework (stella_vslam fork)", "authors": "Shinya Sumikura, Mikiya Shibuya, Ken Sakurada", "venue": "arXiv 1910.01122 (ACM MM 2019 [UNVERIFIED])", "year": 2019, "url": "https://arxiv.org/abs/1910.01122", "code": "https://github.com/stella-cv/stella_vslam", "license": "BSD-2-Clause (fork)", "type": "paper", "verified": true},
  {"key": "OpenMVG", "title": "OpenMVG repository", "authors": "Pierre Moulon et al.", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/openMVG/openMVG", "code": "https://github.com/openMVG/openMVG", "license": "MPL-2.0", "type": "repo", "verified": true},
  {"key": "GLOMAP", "title": "Global Structure-from-Motion Revisited", "authors": "Linfei Pan, Dániel Baráth, Marc Pollefeys, Johannes L. Schönberger", "venue": "ECCV 2024", "year": 2024, "url": "https://arxiv.org/abs/2407.20219", "code": "https://github.com/colmap/colmap", "license": "BSD-3-Clause", "type": "paper", "verified": true},
  {"key": "GravityRA", "title": "Gravity-aligned Rotation Averaging with Circular Regression", "authors": "Linfei Pan, Marc Pollefeys, Dániel Baráth", "venue": "ECCV 2024", "year": 2024, "url": "https://arxiv.org/abs/2410.12763", "code": "https://github.com/colmap/glomap", "license": null, "type": "paper", "verified": true},
  {"key": "MASt3R-SfM", "title": "MASt3R-SfM: a Fully-Integrated Solution for Unconstrained Structure-from-Motion", "authors": "Bardienus Duisterhof, Lojze Zust, Philippe Weinzaepfel, Vincent Leroy, Yohann Cabon, Jerome Revaud", "venue": "arXiv 2409.19152 (3DV 2025 [UNVERIFIED])", "year": 2024, "url": "https://arxiv.org/abs/2409.19152", "code": "https://github.com/naver/mast3r", "license": "CC BY-NC-SA 4.0", "type": "paper", "verified": true},
  {"key": "VGGT", "title": "VGGT: Visual Geometry Grounded Transformer", "authors": "Jianyuan Wang, Minghao Chen, Nikita Karaev, Andrea Vedaldi, Christian Rupprecht, David Novotny", "venue": "CVPR 2025", "year": 2025, "url": "https://arxiv.org/abs/2503.11651", "code": "https://github.com/facebookresearch/vggt", "license": "VGGT License v1 (custom)", "type": "paper", "verified": true},
  {"key": "Pi3", "title": "π³: Permutation-Equivariant Visual Geometry Learning", "authors": "Yifan Wang, Jianjun Zhou, Haoyi Zhu, Wenzheng Chang, Yang Zhou, Zizun Li, Junyi Chen, Jiangmiao Pang, Chunhua Shen, Tong He", "venue": "arXiv 2507.13347", "year": 2025, "url": "https://arxiv.org/abs/2507.13347", "code": "https://github.com/yyfz/Pi3", "license": "BSD-2-Clause-style", "type": "paper", "verified": true},
  {"key": "MapAnything", "title": "MapAnything: Universal Feed-Forward Metric 3D Reconstruction", "authors": "Nikhil Keetha et al. (17 authors)", "venue": "3DV 2026", "year": 2025, "url": "https://arxiv.org/abs/2509.13414", "code": "https://github.com/facebookresearch/map-anything", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "DA3", "title": "Depth Anything 3: Recovering the Visual Space from Any Views", "authors": "Haotong Lin, Sili Chen, Junhao Liew, Donny Y. Chen, Zhenyu Li, Guang Shi, Jiashi Feng, Bingyi Kang", "venue": "arXiv 2511.10647", "year": 2025, "url": "https://arxiv.org/abs/2511.10647", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "VGGTLong", "title": "VGGT-Long: Chunk it, Loop it, Align it -- Pushing VGGT's Limits on Kilometer-scale Long RGB Sequences", "authors": "Kai Deng, Zexin Ti, Jiawei Xu, Jian Yang, Jin Xie", "venue": "ICRA 2026", "year": 2025, "url": "https://arxiv.org/abs/2507.16443", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "MASt3R-SLAM", "title": "MASt3R-SLAM: Real-Time Dense SLAM with 3D Reconstruction Priors", "authors": "Riku Murai, Eric Dexheimer, Andrew J. Davison", "venue": "CVPR 2025", "year": 2025, "url": "https://arxiv.org/abs/2412.12392", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Doppelgangers", "title": "Doppelgangers: Learning to Disambiguate Images of Similar Structures", "authors": "Ruojin Cai, Joseph Tung, Qianqian Wang, Hadar Averbuch-Elor, Bharath Hariharan, Noah Snavely", "venue": "ICCV 2023", "year": 2023, "url": "https://arxiv.org/abs/2309.02420", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "DoppelgangersPP", "title": "Doppelgangers++: Improved Visual Disambiguation with Geometric 3D Features", "authors": "Yuanbo Xiangli, Ruojin Cai, Hanyu Chen, Jeffrey Byrne, Noah Snavely", "venue": "CVPR 2025 (arXiv 2412.05826)", "year": 2025, "url": "https://openaccess.thecvf.com/content/CVPR2025/html/Xiangli_Doppelgangers_Improved_Visual_Disambiguation_with_Geometric_3D_Features_CVPR_2025_paper.html", "code": "https://github.com/doppelgangers25/doppelgangers-plusplus", "license": "CC BY-NC-SA 4.0", "type": "paper", "verified": true},
  {"key": "LightGlue", "title": "LightGlue: Local Feature Matching at Light Speed", "authors": "Philipp Lindenberger, Paul-Edouard Sarlin, Marc Pollefeys", "venue": "ICCV 2023", "year": 2023, "url": "https://arxiv.org/abs/2306.13643", "code": "https://github.com/cvg/LightGlue", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "ALIKED", "title": "ALIKED: A Lighter Keypoint and Descriptor Extraction Network via Deformable Transformation", "authors": "Xiaoming Zhao, Xingming Wu, Weihai Chen, Peter C. Y. Chen, Qingsong Xu, Zhengguo Li", "venue": "IEEE Transactions on Instrumentation & Measurement", "year": 2023, "url": "https://arxiv.org/abs/2304.03608", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "RoMa", "title": "RoMa: Robust Dense Feature Matching", "authors": "Johan Edstedt, Qiyu Sun, Georg Bökman, Mårten Wadenbäck, Michael Felsberg", "venue": "CVPR 2024", "year": 2024, "url": "https://arxiv.org/abs/2305.15404", "code": "https://github.com/Parskatt/RoMa", "license": "MIT", "type": "paper", "verified": true},
  {"key": "LoMa", "title": "LoMa: Local Feature Matching Revisited", "authors": "David Nordström, Johan Edstedt, Georg Bökman, Jonathan Astermark, Anders Heyden, Viktor Larsson, Mårten Wadenbäck, Michael Felsberg, Fredrik Kahl", "venue": "arXiv 2604.04931", "year": 2026, "url": "https://arxiv.org/abs/2604.04931", "code": "https://github.com/davnords/LoMa", "license": "MIT", "type": "paper", "verified": true},
  {"key": "RSBA", "title": "Revisiting Rolling Shutter Bundle Adjustment: Toward Accurate and Fast Solution", "authors": "Bangyan Liao, Delin Qu, Yifei Xue, Huiqing Zhang, Yizhen Lao", "venue": "CVPR 2023", "year": 2023, "url": "https://arxiv.org/abs/2209.08503", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "DoubleSphere", "title": "The Double Sphere Camera Model", "authors": "Vladyslav Usenko, Nikolaus Demmel, Daniel Cremers", "venue": "3DV 2018", "year": 2018, "url": "https://arxiv.org/abs/1807.08957", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "2DGS", "title": "2D Gaussian Splatting for Geometrically Accurate Radiance Fields", "authors": "Binbin Huang, Zehao Yu, Anpei Chen, Andreas Geiger, Shenghua Gao", "venue": "SIGGRAPH 2024", "year": 2024, "url": "https://arxiv.org/abs/2403.17888", "code": "https://github.com/hbb1/2d-gaussian-splatting", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "GOF", "title": "Gaussian Opacity Fields: Efficient Adaptive Surface Reconstruction in Unbounded Scenes", "authors": "Zehao Yu, Torsten Sattler, Andreas Geiger", "venue": "SIGGRAPH Asia 2024 (ACM TOG)", "year": 2024, "url": "https://arxiv.org/abs/2404.10772", "code": "https://github.com/autonomousvision/gaussian-opacity-fields", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "PGSR", "title": "PGSR: Planar-based Gaussian Splatting for Efficient and High-Fidelity Surface Reconstruction", "authors": "Danpeng Chen, Hai Li, Weicai Ye, Yifan Wang, Weijian Xie, Shangjin Zhai, Nan Wang, Haomin Liu, Hujun Bao, Guofeng Zhang", "venue": "IEEE TVCG 2024", "year": 2024, "url": "https://arxiv.org/abs/2406.06521", "code": "https://github.com/zju3dv/PGSR", "license": "Research/non-profit only", "type": "paper", "verified": true},
  {"key": "RaDeGS", "title": "RaDe-GS: Rasterizing Depth in Gaussian Splatting", "authors": "Baowen Zhang, Chuan Fang, Rakesh Shrestha, Yixun Liang, Xiaoxiao Long, Ping Tan", "venue": "arXiv 2406.01467", "year": 2024, "url": "https://arxiv.org/abs/2406.01467", "code": "https://github.com/BaowenZ/RaDe-GS", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "DNSplatter", "title": "DN-Splatter: Depth and Normal Priors for Gaussian Splatting and Meshing", "authors": "Matias Turkulainen, Xuqian Ren, Iaroslav Melekhov, Otto Seiskari, Esa Rahtu, Juho Kannala", "venue": "WACV 2025", "year": 2025, "url": "https://arxiv.org/abs/2403.17822", "code": "https://github.com/maturk/dn-splatter", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "MonoSDF", "title": "MonoSDF: Exploring Monocular Geometric Cues for Neural Implicit Surface Reconstruction", "authors": "Zehao Yu, Songyou Peng, Michael Niemeyer, Torsten Sattler, Andreas Geiger", "venue": "NeurIPS 2022", "year": 2022, "url": "https://arxiv.org/abs/2206.00665", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Neuralangelo", "title": "Neuralangelo: High-Fidelity Neural Surface Reconstruction", "authors": "Zhaoshuo Li, Thomas Müller, Alex Evans, Russell H. Taylor, Mathias Unberath, Ming-Yu Liu, Chen-Hsuan Lin", "venue": "CVPR 2023", "year": 2023, "url": "https://arxiv.org/abs/2306.03092", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "PlanarSplatting", "title": "PlanarSplatting: Accurate Planar Surface Reconstruction in 3 Minutes", "authors": "Bin Tan, Rui Yu, Yujun Shen, Nan Xue", "venue": "arXiv 2412.03451 (venue [UNVERIFIED])", "year": 2024, "url": "https://arxiv.org/abs/2412.03451", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "OpenMVS", "title": "OpenMVS: open Multi-View Stereo reconstruction library", "authors": "cdcseacave (Dan Cernea) et al.", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/cdcseacave/openMVS", "code": "https://github.com/cdcseacave/openMVS", "license": "AGPL-3.0", "type": "repo", "verified": true},
  {"key": "DAv2", "title": "Depth Anything V2", "authors": "Lihe Yang, Bingyi Kang, Zilong Huang, Zhen Zhao, Xiaogang Xu, Jiashi Feng, Hengshuang Zhao", "venue": "NeurIPS 2024", "year": 2024, "url": "https://arxiv.org/abs/2406.09414", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "MoGe", "title": "MoGe: Unlocking Accurate Monocular Geometry Estimation for Open-Domain Images with Optimal Training Supervision", "authors": "Ruicheng Wang, Sicheng Xu, Cassie Dai, Jianfeng Xiang, Yu Deng, Xin Tong, Jiaolong Yang", "venue": "arXiv 2410.19115", "year": 2024, "url": "https://arxiv.org/abs/2410.19115", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "AprilTag", "title": "AprilTag 3 visual fiducial library", "authors": "AprilRobotics (Univ. of Michigan)", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/AprilRobotics/apriltag", "code": "https://github.com/AprilRobotics/apriltag", "license": "BSD-2-Clause", "type": "repo", "verified": true},
  {"key": "Barazzetti2018", "title": "Can we use low-cost 360 degree cameras to create accurate 3D models?", "authors": "L. Barazzetti, M. Previtali, F. Roncoroni", "venue": "Int. Arch. Photogramm. Remote Sens. Spatial Inf. Sci., XLII-2, 69-75", "year": 2018, "url": "https://doi.org/10.5194/isprs-archives-XLII-2-69-2018", "code": null, "license": "CC BY 4.0", "type": "paper", "verified": true},
  {"key": "Janiszewski2022", "title": "Rapid Photogrammetry with a 360-Degree Camera for Tunnel Mapping", "authors": "M. Janiszewski, M. Torkan, L. Uotinen, M. Rinne", "venue": "Remote Sensing 14(21), 5494", "year": 2022, "url": "https://doi.org/10.3390/rs14215494", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Rezaei2024", "title": "Quality Analysis of 3D Point Cloud Using Low-Cost Spherical Camera for Underpass Mapping", "authors": "Sina Rezaei, Angelina Maier, Hossein Arefi", "venue": "Sensors 24(11), 3534", "year": 2024, "url": "https://doi.org/10.3390/s24113534", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Perfetti2024", "title": "Multi-Camera Rig and Spherical Camera Assessment for Indoor Surveys in Complex Spaces", "authors": "Luca Perfetti, Nazarena Bruno, Riccardo Roncella", "venue": "Remote Sensing 16(23), 4505", "year": 2024, "url": "https://doi.org/10.3390/rs16234505", "code": null, "license": "CC BY 4.0", "type": "paper", "verified": true},
  {"key": "GomezLopez2025", "title": "Analysis of the Photogrammetry Use of Videos from 360-Degree Multicameras in Heritage-Related Scenes: Case of the Necropolis of Qubbet El-Hawa (Aswan, Egypt)", "authors": "José Miguel Gómez-López, José Luis Pérez-García, Antonio Tomás Mozas-Calvache, Diego Vico-García", "venue": "Int. Arch. Photogramm. Remote Sens. Spatial Inf. Sci., XLVIII-M-9-2025, 533", "year": 2025, "url": "https://doi.org/10.5194/isprs-archives-XLVIII-M-9-2025-533-2025", "code": null, "license": "CC BY 4.0", "type": "paper", "verified": true},
  {"key": "Pamart2024", "title": "Optimization of 360-based photogrammetric pipeline for narrow and dark indoor surveys", "authors": "Anthony Pamart, Nicolas Maillard, Florent Comte, Laurent Bergerot", "venue": "Int. Arch. Photogramm. Remote Sens. Spatial Inf. Sci., XLVIII-2/W8-2024, 349", "year": 2024, "url": "https://isprs-archives.copernicus.org/articles/XLVIII-2-W8-2024/349/2024/", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "A1", "title": "A1: The DJI Avata 360 as a measurement instrument (project research file)", "authors": "GeoFlight agent A1", "venue": "internal", "year": 2026, "url": "research/A1_device.md", "code": null, "license": null, "type": "secondary", "verified": true},
  {"key": "ETH3D", "title": "A Multi-View Stereo Benchmark with High-Resolution Images and Multi-Camera Videos", "authors": "Thomas Schöps, Johannes L. Schönberger, Silvano Galliani, Torsten Sattler, Konrad Schindler, Marc Pollefeys, Andreas Geiger", "venue": "CVPR 2017", "year": 2017, "url": "https://openaccess.thecvf.com/content_cvpr_2017/papers/Schops_A_Multi-View_Stereo_CVPR_2017_paper.pdf", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "ETH3DLeaderboard", "title": "ETH3D high-res multi-view benchmark leaderboard (OpenMVS entry, indoor F1 at 2 cm ~78.3, seen only via a search snippet of a third-party mirror)", "authors": "ETH3D benchmark", "venue": "eth3d.net (unreachable from sandbox)", "year": 2026, "url": "https://www.eth3d.net/high_res_multi_view", "code": null, "license": null, "type": "secondary", "verified": false},
  {"key": "ACMM", "title": "Multi-Scale Geometric Consistency Guided Multi-View Stereo", "authors": "Qingshan Xu, Wenbing Tao", "venue": "CVPR 2019", "year": 2019, "url": "https://openaccess.thecvf.com/content_CVPR_2019/papers/Xu_Multi-Scale_Geometric_Consistency_Guided_Multi-View_Stereo_CVPR_2019_paper.pdf", "code": "https://github.com/GhiXu/ACMM", "license": "MIT", "type": "paper", "verified": true},
  {"key": "ACMMP", "title": "Multi-Scale Geometric Consistency Guided and Planar Prior Assisted Multi-View Stereo", "authors": "Qingshan Xu, Weihang Kong, Wenbing Tao, Marc Pollefeys", "venue": "IEEE TPAMI 2022 (DOI 10.1109/TPAMI.2022.3200074)", "year": 2022, "url": "https://doi.org/10.1109/TPAMI.2022.3200074", "code": "https://github.com/GhiXu/ACMMP", "license": "MIT", "type": "paper", "verified": true},
  {"key": "MPMVS", "title": "MP-MVS: Multi-Scale Windows PatchMatch and Planar Prior Multi-View Stereo (Table II: ETH3D indoor/outdoor F1 at 2 cm and 5 cm for COLMAP, ACMM, ACMMP)", "authors": "Rongxuan Tan, Qing Wang, Xueyan Wang, Chao Yan, Yang Sun, Youyang Feng", "venue": "arXiv 2309.13294", "year": 2023, "url": "https://arxiv.org/abs/2309.13294", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "GOFish", "title": "GOFish: Full Field-of-View Gaussian Splatting and Mesh Extraction", "authors": "Allen Tu, Meher Gitika Karumuri, Shifan Zhu, Hailing Wang, Yen-Liang Lin, David Held, Matthias Zwicker, Tom Goldstein", "venue": "arXiv 2610.37818", "year": 2026, "url": "https://arxiv.org/abs/2610.37818", "code": "https://3dgofish.github.io", "license": null, "type": "paper", "verified": true}
]
```
