# A3b: Geometric accuracy, from camera model to verified metric mesh

*Agent A3b (geometry). Written 2026-11-17. Input constraint: A1 Handoff (raw dual fisheye as a 2-camera rig; seam on the horizon; θ > 90° per lens; IMU attitude priors; scale only from markers; fixed focus 1.5 m–∞; vision positioning can drop to ATTI over repetitive floors).*

> **Evidence conventions.** **[SRC]** = I read the COLMAP 4.2.1 source or docs in a fresh clone (commit `137f216`, 2026-11-10). **[OPENED]** = I fetched and read the paper (arXiv HTML/abstract, ISPRS PDF) or repository. **[ABS]** = only the abstract was reachable (MDPI pages returned HTTP 403 to this sandbox; abstracts came from the Semantic Scholar API). **[CALC]** = my own derivation, formula shown. **[UNVERIFIED]** = not checked against a primary source. Everything not tagged as a reported result is my assessment.

---

## 0. TL;DR

1. **No COLMAP perspective or fisheye model can represent a ray with θ ≥ 90°.** In COLMAP 4.2.1 every model, `OPENCV_FISHEYE`, `RAD_TAN_THIN_PRISM_FISHEYE` and `EUCM` included, rejects points with camera-frame depth w ≤ ε in projection. The default bearing unprojection is documented as correct only "for perspective and fisheye-with-FOV<=180°" and always returns rz > 0 [SRC: `sensor/models/base.h`, `eucm.h`, `thin_prism.h`]. Only `EQUIRECTANGULAR` covers the full sphere. On this drone, θ ∈ [90°, ~105°] of each lens is the horizon, i.e. the walls and pillars.
2. **So use neither raw fisheye-in-COLMAP nor stitched equirect. Decode the two raw fisheyes and resample each into ~5 pinhole virtual views.** That gives 10 views per frame, ~2100×2100 px at 90° FOV. Model them as one **COLMAP rig with two optical centres**: the 5 views of a lens share a centre, and the two lens groups are separated by the calibrated baseline b. Every view is then an exact central projection, there is no stitch parallax by construction, and the θ > 90° band is kept because a pinhole view *aimed* obliquely has no 90° limit. This is the generalisation of what COLMAP's own `panorama_sfm` does for equirect [SRC], what ORBIT does for 360° ground truth [ORBIT], and the rig constraint that the best-performing indoor 360° survey used [Perfetti2024].
3. **Poses:** use the COLMAP 4.2 incremental mapper with rig constraints, sequential matching with loop detection, gravity priors from the DJI quaternions, ALIKED+LightGlue (SIFT as baseline) and the Caspar GPU BA. The global mapper (ex-GLOMAP) with gravity-aligned rotation averaging is a fast cross-check; its known failure mode is symmetric structures, which is exactly a parking lot [GLOMAP]. Learned feed-forward pipelines are still at the **decimetre-to-metre** level on comparable 360° indoor data: RIGOR reports a 2.31 m median ATE and a 0.13 m Chamfer distance on the Hilti-Trimble-Oxford sequences [RIGOR]. They are useful for diagnosis, not for measurement.
4. **Scale and control:** use AprilTag-36h11 markers detected **in the virtual pinhole views**, triangulated as BA tracks, plus tape/laser **scale bars as soft distance residuals in a final pycolmap/pyceres BA**. Hold out ≥30% of distances as checks. Sim(3) alignment alone fixes scale, but it cannot remove the bending that drift causes. Published 360° surveys show 5–10 cm drift once control is only at one end [Perfetti2024][GomezLopez2025].
5. **Dense:** run COLMAP undistortion to pinhole, then OpenMVS (densify → mesh → refine) as the metric baseline, and **PGSR** (planar Gaussian surfaces with multi-view geometric consistency and exposure compensation) as the textureless-surface variant. Fuse them or choose per region against checkpoints. Monocular depth/normal priors (DN-Splatter style) fill holes, but they bias the geometry, so they are never used where the checkpoints are evaluated.
6. **Realistic expectations:** consumer 360° cameras reach **~5–10 mm** checkpoint RMSE in rooms of ~10 m with good control [Barazzetti2018][Janiszewski2022], **~1 cm** in narrow spaces with control throughout [Perfetti2024], and **2 cm in lit areas but 10 cm drift** in dark 360° *video* with control at one end only [GomezLopez2025]. Our case (drone, H.265, dim, ~18 px/deg, 50–100 m) should plan on **1–2 cm checkpoint RMSE locally and 0.05–0.2% of distance globally** *with* distributed markers. Without them, expect 0.2–1%.

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
- **Global mapper (GLOMAP inside COLMAP since 4.0).** [GLOMAP] (Pan, Baráth, Pollefeys, Schönberger, ECCV 2024) reports, on ETH3D SLAM (sequential, sparse features, illumination changes), ~8% higher recall and +9/+8 AUC points at 0.1 m/0.5 m versus COLMAP, at an order of magnitude less time [OPENED]. Its own limitation section names **rotation-averaging failure on symmetric structures** (ETH3D *exhibition_hall*) [OPENED]. A grid of identical pillars is such a structure.
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
- [DoppelgangersPP] (Xiangli et al., 2024; venue [UNVERIFIED]) uses MASt3R 3D-aware features and plugs into COLMAP and MASt3R-SfM pipelines [OPENED].
- RIGOR's **cyclic four-view consensus**: a loop is accepted only if *all* rig views agree on one cyclic assignment, and it is then jointly verified before entering the graph [OPENED].
- GLOMAP's rotation averaging **filters outlier relative rotations**. COLMAP 4.2 can then return the resulting disconnected components separately rather than glue them wrongly [COLMAPChangelog].

**Defences in priority order (assessment):**
1. **Temporal prior first.** Sequential matching with `overlap` ≈ 10–15 frames and `expand_rig_images` builds a trajectory that holds without loops. Loop retrieval is restricted by `loop_detection_min_index_distance` [SRC].
2. **Marker-ID gate.** Every bay carries unique AprilTag IDs (A1). If a loop candidate's frames see *different* marker IDs at overlapping 3D positions, reject it. If they see the *same* IDs, that is the strongest true-loop evidence available.
3. **Rig-consensus gate** (RIGOR-style, cheap to implement): a revisit must produce geometric inliers in **≥ 3 of the 10 virtual views**, with mutually consistent relative pose. A false pillar match typically lives in one view.
4. **Gravity gate.** Gravity-consistent relative rotation (pitch/roll agree with the IMU to ≲ 1°) is necessary but not sufficient, because yaw errors pass it.
5. **Cross-model disagreement:** incremental vs. global, and the marker-distance residuals after BA (§3). A folded map shows up as checkpoint distances that are wrong by whole bay widths, *while the reprojection error looks fine* (shared-context warning).
6. **Doppelgangers++ as a filter** for retrieved loop pairs, if its licence is acceptable [UNVERIFIED licence]. It was trained on landmarks, not garages, so its precision must be measured on our data.

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

**Size vs. distance (A1-consistent) [CALC].** About 40–60 px across for robust decoding, at 18.3 px/deg, means ≥ 2.2–3.3°:
- A3 tag (≈ 0.27 m black square): ≤ 5–6 m.
- A4: ≤ 3–4 m.
- The **1.5 m near-focus limit** (A1 update) sets a minimum range: use detections at 1.5–5 m slant range.

**Corner precision [CALC].** 0.1–0.2 px corner noise ≈ 0.1–0.2 mrad. At 3 m that is 0.3–0.6 mm per observation, before multi-view averaging. Markers are therefore not the accuracy bottleneck. Network geometry and drift are.

**Placement:**
- Floor: at the down-lens centre, best MTF; plan the flight height so the floor is ≥ 1.5 m away, or accept softer detections.
- Pillars at 0.3 m and 2.3 m, off the flight-height horizon band.
- One cluster per bay or junction, i.e. a marker cluster every **≤ 10–15 m** along each aisle. [GomezLopez2025] saw drift grow to ~10 cm over ~30 m when control sat only at the start [OPENED].
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
