# A3a: Data filtering and quality-aware selection

*Agent A3a (data curation for reconstruction). Written 2026-11-17. Input constraint: A1 Handoff (re-verified pass).*

> **Evidence notes.** `arxiv.org` itself was unreachable from this sandbox, so arXiv metadata and abstracts were read through the official arXiv API mirror (`export.arxiv.org`). Full PDFs were read for WildGaussians, SpotLessSplats, NeRF On-the-go, Doppelgangers, PocketGS (v3 HTML) and the drone-360 indoor 3DGS paper. COLMAP behaviour was checked in the official docs and in the source on GitHub. Classic papers marked *(metadata only)* were confirmed through Semantic Scholar (title, authors, venue, DOI), but I did not open their full text. Anything else I could not open is tagged **[UNVERIFIED]**. Reported results are labelled **Reported**; my own reasoning is labelled **Assessment** or **[CALC]**.

---

## 0. TL;DR

1. **Filtering here means selecting by *lens and angular sector*, not by whole frame.** The Avata 360 records two fisheyes that face up and down, so yaw blur, seam parallax and defocus all collect in the **horizon band at each lens rim**. The zenith and nadir centres stay sharp. Dropping whole frames because the horizon is smeared throws away good floor and ceiling observations, and those are exactly where the scale markers live (A1).
2. **Primary recommendation:** a cheap, physics-first selector, run before SfM. Gate on the IMU angular rate from the OSV quaternions. Space frames by parallax (target **~4–7 kept rig-frames per metre** for SfM). Within each window keep the sharpest frame, scored per lens and per sector by gradient energy. Apply fixed per-lens masks for the airframe, image-circle border and blend band, plus text-prompted dynamic-object masks. Feed **partial rig frames** to COLMAP: its rig model explicitly allows a frame with only a subset of sensors [COLMAPRigs].
3. **Use soft weighting in 3DGS, not hard removal.** Train on a denser set (~8–12 frames/m) with a robust loss (SpotLessSplats-style) and per-image appearance or bilateral-grid compensation. Published ablations show robust masking helps when distractors are common and is neutral or slightly harmful when they are rare [Kulhanek2024]. Over-aggressive thresholds delete rarely seen geometry [SabourSLS2024].
4. **No-reference IQA models (BRISQUE, NIQE, MUSIQ, CLIP-IQA) are not recommended as selectors.** They were built to predict *human* opinion scores. I found no study linking them to SfM or MVS success (§1.1), and the scenario's noise and compression confound them.
5. **Per-region quality on 360° frames is an open gap.** I found no paper that scores quality per cubemap face, virtual view or fisheye sector and then keeps partial frames in rig SfM. §2 and §9 sketch how to do it with an **IMU-predicted blur map**. That is a plausible small research contribution.
6. **Every filter must be judged by final metrics** under a fixed, filter-independent test set: held-out marker distances, registration rate, loop consistency, and held-out-view PSNR/LPIPS. Compare against **budget-matched uniform subsampling** (§7).

---

## 1. Frame-level selection

### 1.1 Blur and sharpness metrics: which ones track SfM/MVS success?

**Families.**
- **Hand-crafted focus measures.** These include variance of the Laplacian, Tenengrad (Sobel gradient energy), sums of absolute differences, and FFT high-frequency energy ratios. The standard survey compares dozens of these operators for shape-from-focus [Pertuz2013] *(metadata only)*. They are fast and monotonic in blur *for a fixed scene*. Their weakness is that they are **content-dependent**: a textureless concrete ceiling scores low even when it is perfectly sharp, while a noisy frame scores *high*, because noise is high-frequency.
- **Photogrammetry-specific blur metrics.** Sieberth, Wackrow and Chandler built SIEDS for UAV image sets. It compares each image with a self-generated reference and gives a value that is only meaningful *relative to the same dataset*, not as an absolute threshold [Sieberth2016] *(metadata only)*. Their earlier ISPRS work found that blur significantly affects photogrammetric processing and can stop automatic processing altogether, which motivated filtering blurred frames out of the sequence [Sieberth2015].
- **Learned no-reference IQA.** BRISQUE [Mittal2012] and NIQE [Mittal2013] use natural-scene statistics; both *(metadata only)*. MUSIQ is a multi-scale transformer trained on human-rated IQA datasets such as KonIQ-10k and SPAQ [Ke2021]. CLIP-IQA prompts CLIP zero-shot to judge both quality ("look") and abstract perception ("feel") [Wang2023CLIPIQA]. **All of them regress human opinion scores.** The common toolbox, IQA-PyTorch, is under a **PolyForm Noncommercial** licence [IQAPyTorch].
- **Task-based ("matchability") measures.** These count repeatable keypoints, or matches that survive verification against a neighbour frame. Hartmann, Havlena and Schindler learned to predict which keypoints will match, so SfM can discard unmatchable ones early [Hartmann2014].

**What correlates with SfM success?** I searched specifically for studies that correlate NR-IQA scores with SfM or MVS outcomes and found none (gap, §9). From first principles (Assessment), SfM depends on **repeatable, well-localised corners**. Motion blur destroys corners along the blur direction and biases their positions. Noise creates unrepeatable responses. H.265 at ~0.10 bpp smooths away fine texture first. A metric that rewards noise, or that rates "pleasant-looking" footage highly, therefore points the wrong way. The ranking I recommend:
1. **Task metric**: the number of verified matches to the previous kept frame, per lens and per sector. This is the closest proxy for what SfM needs, but it costs a matching pass.
2. **Gradient energy or Laplacian variance, computed *after* light denoising and *normalised within a temporal window*** (relative, as Sieberth notes). PocketGS uses exactly this pattern: a sparse-grid gradient-energy score, with the best frame chosen in an 8-frame window and a replacement only if it is 5% better [Guo2026PocketGS]. The LichtFeld 360 plugin offers Tenengrad or Laplacian scoring of 360° frames, picking the best per interval [LichtFeld360].
3. **IMU-predicted blur** (§1.2, §2). This does not depend on the scene at all, so it complements (2) on textureless surfaces.

**Examples of relevant work.**
- *PocketGS* [Guo2026PocketGS]: on-device 3DGS. It uses a displacement gate (≥0.05 m), a gradient-energy sharpness score, and keeps the best frame in an 8-frame window. Reported: a full on-phone pipeline with <3 GB peak memory on MobileScan. The paper reports no separate ablation of the selector, so its effect is not isolated.
- *MM3DGS SLAM* [Sun2024MM3DGS]: keyframes when covisibility falls below a threshold, and uses NIQE to pick the best-quality frame within a window. This is a case where NR-IQA *is* used as a selector, but again without a reported ablation.
- *Sieberth et al.* [Sieberth2015, Sieberth2016]: blur detection designed for UAV photogrammetry, with dataset-relative thresholds.

### 1.2 Exposure, noise and compression scoring in dim scenes

A1 recommends manual exposure: 1/100 s, fixed ISO and WB, D-Log M, Pro mode. DJI has **no HDR video mode** [A1]. **Assessment:** under those settings, exposure scoring mainly needs to catch *anomalies*, not drift.
- **Read exposure from metadata first.** The OSV metadata carries per-frame shutter, gain/ISO and WB, and Gyroflow 1.7.0 reads per-frame ISO and shutter for the Avata 360 [A1]. Flag any frame where these change. A change means the capture protocol failed.
- **Flicker.** Look for a spectral peak in each frame's row-mean profile; rolling shutter turns 100 Hz flicker into horizontal bands. Also look for periodicity in the per-frame mean-luma time series. Frames with banding should be **down-weighted in 3DGS rather than dropped for SfM**, because SIFT/ALIKED descriptors are largely invariant to smooth intensity ramps (Assessment).
- **Noise.** Estimate noise σ from the median absolute deviation of a high-pass residual in flat regions. With ISO fixed, σ is roughly constant, so use it to *normalise* the sharpness score, not to reject frames.
- **Compression.** HEVC frame type is available from `ffprobe` (`pict_type`). **Hypothesis [UNVERIFIED for this camera]:** I- and P-frames hold more texture than B-frames at the same bitrate. When two candidates in a window tie on sharpness, prefer the I/P frame. This is cheap to test with the ablation in §7.
- **Saturation.** Report the fraction of clipped pixels per sector. Lamps saturate. Mask the clipped blobs, dilated by a few pixels, rather than dropping the frame (§3.3).

### 1.3 Redundancy removal and motion-based keyframing

SLAM keyframe policies are the template. ORB-SLAM adds keyframes generously and later culls those whose map points are ≥90% seen by other keyframes, a "survival of the fittest" policy [MurArtal2015]. Gaussian Splatting SLAM triggers keyframes when the covisibility of Gaussians with the last keyframe drops [Matsuki2024]. For an offline video pipeline the equivalent signals are:
- **Rotation-only motion (hovering and yawing in place).** A 360° camera turning in place gains *no* parallax, so those frames add nothing to geometry. Detect them from the IMU angular rate combined with low median optical-flow translation after derotation (rotate flow by the IMU ΔR, then measure what is left).
- **Hovering.** A1 asks for hovers of 3–5 s at control stations, and the drone may also drift in ATTI mode when vision positioning fails over repeating patterns [A1]. Keep the **single sharpest rig-frame per hover**, plus the 120 MP stills.
- **Displacement gate.** Without poses, a proxy for baseline is the median derotated flow magnitude normalised by an inverse-depth prior. A sparse VO pass (or a coarse COLMAP run on a 2 fps subsample) gives metric-free positions to space frames uniformly.

### 1.4 Coverage- and parallax-aware selection

- **Classic view selection.** Hornung, Zeng and Kobbelt choose an image subset for MVS by greedily adding views that improve a coverage and quality measure [Hornung2008] *(metadata only)*. Snavely, Seitz and Szeliski's skeletal graphs keep a subset of images that preserves reconstruction accuracy within a bound, which sped up SfM greatly [Snavely2008] *(metadata only)*. Both are submodular-flavoured greedy set covers on a view graph.
- **Information-based selection.** FisherRF scores candidate views by Fisher information of the radiance-field parameters, for active view selection and uncertainty [Jiang2023FisherRF]. Offline, the same score could rank *which recorded frames* add the most information to a 3DGS model. Its code ships under the Inria Gaussian-Splatting licence, which is **non-commercial** [FisherRFRepo].
- **3DGS-from-video practice.** In practice people use fixed-fps extraction plus sharpest-in-interval selection [LichtFeld360]. The drone-360 indoor 3DGS pipeline extracts equirect frames at 1–3 fps from 30 fps 360° video, cubemaps them and runs COLMAP. Those authors chose *not* to add Laplacian blur filtering because their stable trajectory produced little blur [Chen2024Drone360].

**Assessment:** coverage-aware optimisation (set cover over a view graph) is worthwhile **after** a first SfM pass, when visibility is known. It is the right tool for thinning the 3DGS training set, not the SfM input. For SfM in a repetitive garage, *continuity* matters more than coverage: every gap in the sequential chain is an opportunity for a false loop closure to take over.

### 1.5 How many frames per metre?

[CALC] For a point at range d and a baseline B between kept frames, the triangulation angle is α ≈ B/d.
- COLMAP's defaults: points need ≥1.5° to survive filtering, and the initial pair needs 16° [COLMAPMapperSrc]. MVS depth works best at roughly 5–20° between neighbouring source views (Assessment, a common rule of thumb).
- Garage ranges seen by the walls band: d ≈ 1–6 m. Floor and ceiling: d ≈ 1–1.5 m.
- Spacing s = 0.2 m gives α ≈ 11° at 1 m, 3.8° at 3 m and 1.9° at 6 m between *consecutive* kept frames. Because the 360° camera sees each point for metres of travel, a point at 3 m is observed by ~10–20 kept frames, and the longest baseline among them gives α > 30°. Triangulation is therefore not the constraint.
- The constraints are **matching robustness under the viewpoint change of near surfaces** and **track continuity**. At s = 0.3 m the floor 1.3 m below shifts by ~13° between kept frames, which is easy for SIFT or ALIKED. At s = 0.5 m it shifts by ~21°, and the textureless concrete becomes fragile.

**Recommendation:** for SfM, keep **~4–7 rig-frames per metre** (s ≈ 0.15–0.25 m; at 0.4 m/s and 25 fps that is 1 frame in 10–15). Add every frame needed to keep the sequence chain unbroken through turns. For 3DGS or MVS, keep **~8–12 per metre** (registered later by image-to-model localisation). This agrees with A1's 0.15–0.3 m. It is an engineering estimate, and the ablation in §7 should tune it.

---

## 2. Region-level selection on 360° frames (in depth)

### 2.1 Why blur is direction-dependent on *this* camera

[CALC] For angular velocity **ω** and translational velocity **v**, a scene point in unit direction **r** at depth d moves across the image sphere with angular speed

  |ṙ| = | ω × r + (v − (v·r) r)/d |   (rad/s),

and its blur length in pixels is ≈ 18.3 px/deg × (180/π) × |ṙ| × t_exp [A1: 18.3 px/deg native].
- **Yaw** (ω vertical). |ω × r| = ω·sin(angle between ω and r). This is zero at the zenith and nadir, which are **the fisheye centres on this drone**, and maximal on the horizon, which is **the fisheye rims and seam**. At 30°/s and 1/100 s, the horizon smears by ~5.5 px while the lens centres stay sharp.
- **Pitch or roll.** The blur-free axis is horizontal, so blur falls on two opposite *sides* of each fisheye.
- **Translation.** Blur is greatest perpendicular to the motion and for close surfaces. At 0.4 m/s the floor 1.3 m below sees ≈ 0.4/1.3 rad/s ≈ 17.6°/s, i.e. ≈ 3.2 px at 1/100 s, *at the down-lens centre*. Walls 3 m to the side see ~1.4 px.
- **Defocus** adds a further, depth-dependent term below the rated 1.5 m near focus limit: ≈ 1 binned px at 1 m and ≈ 2 px at 0.5 m [A1].

So a yaw turn smears the walls and keeps the floor and ceiling sharp, while fast translation near the floor smears the nadir and keeps the walls sharp. **A single scalar per frame cannot represent this.** Note also that the most blur-prone band, the horizon, coincides with the seam band, so it is the band A1 already treats as least trustworthy.

### 2.2 What exists

I searched arXiv (title and abstract queries combining omnidirectional, panoramic, 360, equirectangular, cubemap with motion blur, frame selection, keyframe, quality) and the web for per-face, per-view or per-sector quality scoring in rig-based SfM. **I found no published method that scores blur or quality per cubemap face, virtual view or fisheye sector and keeps partial frames.** The nearest work:
- *Drone-captured 360 indoor 3DGS* [Chen2024Drone360] splits each equirect frame into **eight cubemap faces** (the standard four plus four rotated 45°) and runs COLMAP on them. It masks or inpaints the drone body per face. Quality filtering is per frame, and was deliberately omitted.
- *LichtFeld 360 plugin* [LichtFeld360] reframes equirect into 6–24 virtual pinhole views and scores sharpness **per source frame**. Dynamic masks are computed per pinhole crop and then OR-merged back to the equirect. It does no per-view quality filtering.
- *Cube-Splat* [Guo2026CubeSplat] factorises each 360° frame into four cubemap views for 3DGS SLAM and accumulates gradients across faces. It weights faces equally.
- *RIGOR* [Huang2026RIGOR] treats each panorama as a four-view virtual rig and uses rig consistency to detect and repair locally inconsistent predictions. This is a per-view *consistency* check (geometric), not a per-view *image-quality* check, but it is the closest conceptual neighbour.
- *GOFish* [Tu2026GOFish] trains 3DGS directly on >180° fisheyes, with calibrated mip filtering and wide-angle appearance modelling. It models pixel footprint and lens falloff across the field of view, which is a soft, physics-based per-region treatment, but not blur selection.
- **Enabling mechanism (exists):** COLMAP's rig model states that a *frame* is an instance of the rig with *all or a subset* of its sensors [COLMAPRigs]. Per-image masks are supported at feature extraction (`ImageReader.mask_path`) and at fusion (`StereoFusion.mask_path`) [COLMAPFAQ, COLMAPFusionSrc]. Partial frames and per-sector masks therefore need no SfM changes.

### 2.3 How to do it (proposed)

**Granularity options for the primary dual-fisheye input:**
1. **Per lens.** Drop the up- or down-lens image from a rig-frame. Coarse but trivial.
2. **Per angular sector within a lens.** Rings: the centre (θ < 60°), mid (60–85°) and rim/horizon (85–105°). Split the rim into 8 azimuth sectors. Implement by writing a **dynamic per-image mask** that blacks out low-quality sectors. This needs no change to COLMAP, and the image stays in the rig frame.
3. **Per virtual view** (if A3b chooses RIGOR-style or cubemap virtual pinholes). Drop a view from the frame. COLMAP accepts the partial frame.

**Score per region.** quality = min(sharpness_rel, blur_pred_ok, exposure_ok), where:
- *sharpness_rel* is the gradient energy of the region divided by the median energy of the same region over a ±1 s window. Being relative, it cancels texture differences between regions.
- *blur_pred* is the IMU-predicted blur from §2.1. It uses ω from the high-rate quaternions, integrated over the exposure, and needs no pose or depth for the rotational term. A coarse depth prior (floor and ceiling heights from ToF or a first SfM pass) adds the translational term in a second iteration.
- Thresholds (starting points, to be ablated): drop a region if blur_pred > 2 px **or** sharpness_rel < 0.6. Never drop more than 50% of a rig-frame's area, and never drop a frame that is the only sequential link.

**Equirect or cubemap fallback.** The same scores apply per cubemap face. In addition, mask the seam band of ±8–10° latitude at feature extraction [A1]. Nadir and zenith in DJI's stitch are *real* lens-centre content here (not tripod or operator), so do **not** apply the nadir masks used for handheld 360° capture. Do mask the airframe sectors near the horizon, which the stitcher synthesises.

### 2.4 Stitch seams, blend band and fixed masks

- **Raw fisheyes (primary).** Use a fixed per-lens mask for (a) outside the image circle, (b) airframe pixels (props, guards, arms), and (c) optionally the outermost band θ > ~100°, where MTF and vignetting are worst [A1]. A1 notes that a motors-off recording is impossible, so build the airframe mask from a **hover clip**: compute the per-pixel temporal median and MAD over a few hundred frames while the scene moves past. Pixels whose appearance stays constant while the background changes are airframe. Dilate the result, and add an elliptical allowance for prop tips, as the drone-360 paper did [Chen2024Drone360].
- **Stitched equirect (fallback).** Use the airframe region plus a ±8–10° horizon band.
- **Masking vs inpainting.** Reported: inpainting the drone body with ProPainter beat plain masking by **+2.78 dB PSNR** (34.64 vs 31.85 dB) [Chen2024Drone360]. **Assessment:** that comparison scores renders against images that themselves contain inpainted pixels, which favours the inpainting arm. For *measurement* (SfM and MVS), inpainted pixels are fabricated and must stay masked. For *visualisation*, inpainting is acceptable.

---

## 3. Pixel-level masking

### 3.1 Dynamic objects
- **Grounded SAM / Grounded-SAM-2.** Grounding DINO detects regions from a text prompt, and SAM segments them. Reported: 48.7 mean AP zero-shot on SegInW [Ren2024GroundedSAM]. The Grounded-SAM-2 repository is **Apache-2.0** [GroundedSAM2Repo].
- **SAM 2** adds streaming-memory video propagation. Reported: better video-segmentation accuracy with 3× fewer interactions than prior approaches, and image segmentation that is 6× faster than SAM [Ravi2024SAM2]. Apache-2.0 [SAM2Repo]. **Assessment:** prompt with Grounding DINO once every N frames (cars, people, "person", "car", "cart", "door") and propagate with SAM 2. On fisheyes, run detection on perspective crops and back-project the masks, OR-merging them as the LichtFeld plugin does [LichtFeld360], because detectors trained on pinhole images degrade at the rim.
- **YOLO segmentation (Ultralytics)** is fast and good on COCO classes, but is licensed **AGPL-3.0** [UltralyticsRepo], which is a constraint if the pipeline is ever distributed. DynaSLAM is the classic combination of learned segmentation with multi-view geometry to remove dynamic content in SLAM [Bescos2018].
- **Parked cars are static.** Masking them would remove large, well-textured, *static* geometry, which is useful for SfM and needed in the model. **Mask only objects that move during the capture.** Decide per track: a SAM 2 track whose 3D position (after a first SfM pass) is inconsistent across time is dynamic. An all-class "car" mask is the wrong default.

### 3.2 Specular and reflective surfaces
- **Detectors.** Glass detection (GDNet, [Mei2020GDNet]), mirror detection [Yang2019Mirror], and joint specular-highlight detection and removal [Fu2021SHIQ]. All were trained on everyday, mostly well-lit pinhole imagery. Their domain gap to dim, compressed fisheye footage is unknown [UNVERIFIED].
- **Per-consumer policy (Assessment).**
  - **SfM:** specular highlights on car paint and wet floors move with the viewpoint, so they create *consistent-looking but wrong* matches. Mask **saturated or near-saturated specular blobs**: luminance > 0.95 of white, dilated. Optionally mask glass and windows by open-vocabulary prompt ("car window", "windshield", "glass door"). Do **not** mask whole car bodies.
  - **MVS:** reflections produce false depth (a virtual image behind the surface). Use the same masks at fusion (`StereoFusion.mask_path`) [COLMAPFusionSrc], plus geometric consistency filtering.
  - **3DGS:** do **not** hard-mask paint or wet floor. View-dependent colour is what spherical harmonics and robust losses are for, and masking leaves holes in the rendered cars. Down-weight only saturated pixels.
- **Wet floors** are the hardest case: a mirror-like floor creates a second, upside-down garage. Capture should avoid them (A1). If present, mask the floor region by prompt for SfM in the affected sequences.

### 3.3 Saturated lights, flare, flicker bands
Mask lamp blobs, meaning the connected components of clipped pixels dilated by ~2× their radius to cover bloom. Mask flare ghosts if they are detected as features that move with the camera, not the scene: a high-scoring keypoint whose bearing is constant across frames in the *camera* frame is an artefact (the same test as the airframe). For flicker bands, prefer **per-image appearance compensation** in 3DGS (§5) over masking. If row-banding amplitude is >5% of mean luma, down-weight that frame in 3DGS and keep it for SfM.

### 3.4 How each consumer reads masks
| Consumer | Mechanism | Notes |
|---|---|---|
| COLMAP features | `ImageReader.mask_path` (per image, `<name>.png`, black = no features), or `ImageReader.camera_mask_path` (one mask for all images of a camera) [COLMAPFAQ] | Fixed per-lens mask → `camera_mask_path`. Dynamic plus fixed → per-image masks (they must include the fixed part). |
| COLMAP rigs | A frame may contain a subset of sensors [COLMAPRigs] | Enables per-lens or per-view dropping. Configure rigs before sequential matching. |
| COLMAP MVS fusion | `StereoFusion.mask_path`, same format [COLMAPFusionSrc] | PatchMatch still computes depth under the mask; fusion ignores it. |
| gsplat 3DGS | If the dataset provides `mask`, the trainer computes L1 only on unmasked pixels and zeros both sides for SSIM [gsplatTrainer] | Also supports `camera_model` "fisheye"/"ftheta", `app_opt` appearance embeddings, and `post_processing="bilateral_grid"` [gsplatTrainer]. |

---

## 4. Post-SfM filtering (geometry-aware)

**Ownership.** **A3b owns** geometric verification, loop-closure acceptance, disambiguation, and BA-level outlier thresholds. **A3a owns** (i) the *feedback loop*, which turns post-SfM diagnostics into re-selection of input frames and regions, and (ii) the *evaluation protocol* (§7). A3a's tools here are diagnostics, not new SfM algorithms.

**Point-level filters.** COLMAP defaults: observations with reprojection error > 4 px are removed, and points with triangulation angle < 1.5° are dropped [COLMAPMapperSrc]. For export to MVS or 3DGS initialisation, add: track length ≥ 3, triangulation angle ≥ 2–3°, and reprojection error ≤ 2 px in rig-calibrated fisheye pixels. Optionally, take the per-point covariance from BA and drop the top 5% by uncertainty.

**Image-level diagnostics that feed back to A3a.** For each registered image (or lens or sector): count inlier observations, compute mean reprojection error, and measure the residual's *angular sector distribution*. If residuals concentrate in the horizon sectors, that suggests seam or RS problems; mask those sectors and re-run. Unregistered images, or images registered with <100 inliers, should be checked for blur against §2. If they are sharp, they are *coverage holes*, not bad data, and need denser selection nearby rather than removal.

**False loop closures in repetitive scenes.** Reprojection error does not detect a folded map (shared context). The relevant work:
- **Doppelgangers** (ICCV 2023, oral) classifies image pairs as the same surface or a look-alike, using the spatial distribution of keypoints and matches. Reported: **95.2% AP and 93.8% ROC AUC** on their test set (16 scenes). It plugs into COLMAP by pruning pairs below a probability threshold before mapping [Cai2023Doppel]. Code is MIT [DoppelRepo].
- **Doppelgangers++** uses a transformer over MASt3R features, with a training set broadened beyond landmarks to everyday scenes [Xiangli2024DoppelPP]. Licence **CC BY-NC-SA 4.0** (non-commercial) [DoppelPPRepo].
- **Loop and cycle consistency.** Zach et al. check whether the relative transforms around loops of the view graph compose to identity [Zach2010] *(metadata only)*. Yan et al. use geodesic context [Yan2017]. Heinly et al. correct duplicate structure [Heinly2014] *(metadata only)*. The ETH re-implementation study found that **no method worked across all datasets with one parameter set** [SfMDisambigRepo].
- **Cues specific to this scenario** (A3a supplies the inputs, A3b uses them):
  - **Unique marker IDs** (A1): two images both detecting marker ID k are probably near each other, and two images showing *different* IDs at the same place in a pillar pattern are a doppelganger flag.
  - **IMU gravity and yaw-rate integration**: a loop that implies a large inconsistency with integrated gyro yaw over a short interval is suspicious.
  - **Time adjacency**: prefer sequential matching plus verified loops (A3b).

---

## 5. Robust training as soft filtering

**Representative methods (Reported).**
- **NeRF-W** (CVPR 2021) [MartinBrualla2021]: per-image appearance embeddings plus a transient head with uncertainty. This is the origin of the appearance-and-transient split.
- **RobustNeRF** [Sabour2023RobustNeRF]: treats distractors as outliers and uses a trimmed robust loss. No distractor types need to be specified.
- **NeRF On-the-go** (CVPR 2024) [Ren2024OTG]: predicts uncertainty from DINOv2 features with an MLP and uses dilated patch sampling. In WildGaussians' comparison it reached 21.71 PSNR on the On-the-go dataset at ~43 GPU-hours [Kulhanek2024].
- **SpotLessSplats** [SabourSLS2024]: brings robust masking to 3DGS using Stable Diffusion features with clustering ("agg") or a small MLP. Averaged over the RobustNeRF and On-the-go scenes, PSNR rose from **22.60 (3DGS) to 26.08 (SLS-agg) and 26.11 (SLS-mlp)**. A gsplat-based implementation is Apache-2.0 [SLSRepo]. The authors warn that aggressive thresholds remove **rarely viewed scene parts**.
- **WildGaussians** (NeurIPS 2024) [Kulhanek2024]: DINO-based uncertainty plus an appearance module in 3DGS. On On-the-go it averaged **22.15 PSNR at 0.5 GPU-h**, against 19.30 for 3DGS. Ablation: removing uncertainty cost little or nothing at low occlusion (On-the-go low: 20.53 vs 20.62, LPIPS slightly *better* without it) but cost ~2.8 dB at high occlusion (26% occluders). MIT licence [WildGaussiansRepo].
- **Successors:** DeSplat decomposes the scene into static and distractor Gaussians [Wang2024DeSplat]. Robust 3DGS with segmentation (GCPR 2024) [Ungermann2024]. Gaussian in the Wild [Zhang2024GSW]. PDF-GS, progressive distractor filtering (CVPR Findings 2026) [Seo2026PDFGS].
- **Exposure and appearance under flicker.** Bilateral guided radiance fields learn per-view 3D bilateral grids that absorb ISP effects [Wang2024Bilarf], and gsplat exposes this as `post_processing="bilateral_grid"` [gsplatTrainer]. Luminance-GS (CVPR 2025) does view-adaptive curve adjustment for difficult lighting [Cui2025Luminance].
- **Deblurring instead of dropping.** BAD-Gaussians models the camera trajectory during the exposure [Zhao2024BAD]. Deblurring 3DGS uses an MLP that modifies covariances [Lee2024Deblur3DGS]. **Assessment:** physically, BAD-style exposure-trajectory modelling *is* direction-dependent blur on a sphere. Driven by IMU rates, it could keep blurred horizon sectors as soft constraints. Experimental.

**When is soft better than hard? (Assessment, grounded in the ablations above)**
- **Soft** applies when the defect is **rare, local or photometric**: occasional people, flicker pulses, specular sheen, mild blur. In those cases robust losses or appearance models cost nothing and keep coverage.
- **Hard** applies when the defect is **systematic or geometric**: seam parallax, airframe pixels, severe blur (> ~3 px), RS skew during fast yaw. Robust losses learn to accept a persistent error as "scene", and SfM has no soft-weighting knob for keypoints beyond the robust BA loss.
- **For geometry (the primary deliverable), filter hard *before* SfM and MVS.** For appearance (3DGS), filter lightly and let the loss down-weight.
- **Ordering caveat.** Robust 3DGS losses identify outliers by *rendering residual*. Under-observed textureless regions also have high residual early in training, so robust masks can eat the floor and ceiling. Use warm-up scheduling (as in SLS) and cap the masked fraction per image.

---

## 6. The trade-off: when filtering hurts

**Evidence.**
- SLS: thresholding uncertainty too aggressively removes parts of the scene that are rarely viewed. NeRF On-the-go over-masked fine details and even whole structures in some scenes [SabourSLS2024].
- WildGaussians: uncertainty masking is slightly harmful on low-occlusion data [Kulhanek2024].
- SfM disambiguation: removing matches with mis-tuned parameters breaks correct reconstructions as often as it fixes wrong ones. No parameter set works everywhere [SfMDisambigRepo].
- Drone-360: plain masking lost 2.78 dB against inpainting for rendering [Chen2024Drone360]. (See the caveat in §2.4.)

**Mechanisms specific to this scenario (Assessment).**
1. **Broken sequential chains.** Dropping a run of blurred frames during a yaw turn leaves the two aisles connected only through loop-closure retrieval, which is exactly where repetitive bays cause false loops. Per-sector masking (keep the sharp floor and ceiling) preserves the chain.
2. **Textureless starvation.** Floors and ceilings yield few features. A global sharpness threshold that is calibrated on textured walls will reject them disproportionately. Use relative, per-region scoring.
3. **Marker loss.** Markers sit on the floor and on pillars off the horizon. A whole-frame filter driven by horizon blur deletes marker observations that are sharp.
4. **Less redundancy for BA.** Fewer frames means fewer observations per point and weaker covariance. Thinning beyond ~4 frames/m saves little compute, because COLMAP on a few thousand fisheye frames fits a workstation.

---

## 7. Evaluation protocol and ablation design

**Principles.**
1. **The test set must not depend on the filter.** Before any filtering, reserve (a) the held-out tape or laser **marker distances** (never used for scale), and (b) **held-out views**: every 50th rig-frame, chosen in segments of slow flight so they are sharp under *any* filter, and excluded from all training sets. Otherwise a filter that removes blurry frames also removes blurry test frames and inflates PSNR.
2. **Budget-matched controls.** Each filter arm is compared with **uniform subsampling at the same frame count**, so selection quality is separated from quantity.
3. **Same downstream recipe** across arms: the same SfM settings, MVS settings and 3DGS iterations, with ≥3 seeds for 3DGS.

**Metrics, tied to the final goals.**
| Metric | Measures | How |
|---|---|---|
| Held-out marker distance error | Metric accuracy (primary) | Scale from training markers only. Report the median and max absolute error and the % of distance for the ≥3 long (>20 m) pairs. Target ≤1% globally and a few cm locally. |
| Registration rate | Robustness | % of kept rig-frames registered in one model. Number of models. |
| Loop consistency | Folding | Drift at revisits of the anchor area, consistency of the same marker ID across passes (position spread), and gravity consistency (IMU vs model). |
| Sparse/dense geometry | Local quality | Planarity residual of floor patches, and pillar-to-pillar spacing vs the known pitch. |
| Held-out view PSNR / SSIM / LPIPS | Visualisation | Fixed held-out set, rendered with per-image appearance *fitted on the left half only* (the NeRF-W protocol, so appearance cannot leak into the test pixels [Kulhanek2024]). |
| Cost | Practicality | Wall-clock and peak VRAM. |

**Ablation ladder** (one capture, ideally repeated on a second flight):
- A0: uniform 2 fps (baseline).
- A1: + fixed masks (airframe, image circle, blend band).
- A2: + IMU angular-rate gate.
- A3: + parallax spacing (vary 3/5/8 frames per metre).
- A4: + sharpest-in-window, whole frame (Laplacian vs Tenengrad vs NIQE vs CLIP-IQA, as a side test of §1.1).
- A5: A4 but **per-lens / per-sector** masking instead of whole-frame dropping.
- A6: + dynamic and specular masks.
- A7 (3DGS only): hard set vs dense set + SLS loss vs dense set + WildGaussians-style uncertainty, each with and without bilateral grid.

Each step is kept only if it does not worsen the held-out marker error and registration rate beyond noise (bootstrap 95% CI over marker pairs). PSNR decides only among steps that are neutral on geometry.

---

## 8. Method selection

### 8.1 Long list (24) and screening
| # | Candidate | Family | Screen |
|---|---|---|---|
| 1 | Laplacian variance / Tenengrad / FFT energy [Pertuz2013] | Focus measure | **Keep** (merged into S1) |
| 2 | Gradient energy, best-in-window [Guo2026PocketGS] | Focus + window | **Keep** (S1) |
| 3 | SIEDS [Sieberth2016] | Photogrammetric blur | Drop: needs a dataset-relative calibration and has no advantage over windowed S1. Kept as an example |
| 4 | BRISQUE / NIQE [Mittal2012, Mittal2013] | NR-IQA (NSS) | Drop: predicts human opinion and is confounded by noise and compression. Only a side test in A4 |
| 5 | MUSIQ / CLIP-IQA [Ke2021, Wang2023CLIPIQA] | Learned NR-IQA | Drop: aesthetic and perceptual target, GPU cost, non-commercial toolbox licence. Side test only |
| 6 | Matchability / verified-match count [Hartmann2014] | Task-based | **Keep** (S3) |
| 7 | IMU angular-rate gate (OSV quaternions) [A1] | Motion | **Keep** (S2) |
| 8 | Derotated-flow parallax keyframing [MurArtal2015] | Motion | **Keep** (S2) |
| 9 | Covisibility keyframing [Matsuki2024, Sun2024MM3DGS] | SLAM | Drop as an online policy. The idea is reused offline in S2 |
| 10 | View-graph set cover / skeletal graphs [Hornung2008, Snavely2008] | Coverage | Defer: post-SfM 3DGS thinning only |
| 11 | FisherRF view ranking [Jiang2023FisherRF] | Information | Drop for v1: non-commercial licence and pinhole 3DGS. Research option |
| 12 | IMU-predicted per-sector blur + partial rig frames (proposed) | Region-level | **Keep** (S4, experimental) |
| 13 | Temporal-median airframe mask (+ prop ellipses) [Chen2024Drone360] | Fixed mask | Mandatory. Not scored (no alternative) |
| 14 | Grounded-SAM-2 + SAM 2 propagation [Ren2024GroundedSAM, Ravi2024SAM2] | Dynamic mask | **Keep** (S5) |
| 15 | YOLO-seg [UltralyticsRepo] | Dynamic mask | Drop: AGPL and closed-set. Fallback only |
| 16 | GDNet / mirror / SHIQ detectors [Mei2020GDNet, Yang2019Mirror, Fu2021SHIQ] | Specular | Drop: domain gap. Open-vocabulary prompts plus a saturation threshold suffice |
| 17 | Doppelgangers / ++ [Cai2023Doppel, Xiangli2024DoppelPP] | Disambiguation | Hand to A3b (D++ is non-commercial) |
| 18 | Loop/cycle consistency [Zach2010, Yan2017, Heinly2014] | Disambiguation | Hand to A3b |
| 19 | NeRF-W / RobustNeRF / On-the-go [MartinBrualla2021, Sabour2023RobustNeRF, Ren2024OTG] | Robust NeRF | Drop: NeRF training cost (~43 GPU-h for On-the-go). Foundational context |
| 20 | SpotLessSplats [SabourSLS2024] | Robust 3DGS | **Keep** (S6) |
| 21 | WildGaussians [Kulhanek2024] | Robust 3DGS + appearance | **Keep** (S7) |
| 22 | DeSplat / Robust3DGS / GS-W / PDF-GS | Robust 3DGS | Drop for v1: less integrated with gsplat. Watch list |
| 23 | Bilateral grid / Luminance-GS [Wang2024Bilarf, Cui2025Luminance] | Appearance | **Keep** bilateral grid (S8). Luminance-GS on the watch list |
| 24 | BAD-Gaussians / Deblurring 3DGS [Zhao2024BAD, Lee2024Deblur3DGS] | Deblur | Drop for v1 (pinhole, extra cost). Experimental extension of S4 |

### 8.2 Short-list deep dives
**S1. Windowed relative sharpness (gradient energy or Laplacian), per lens and sector.**
- *Idea:* score high-frequency energy and keep the best frame per window.
- *Assumptions:* sharpness differences between neighbouring frames come from blur, not content. This holds within ±0.5 s at 0.4 m/s. It breaks under noise (needs a denoise first) and on textureless regions (needs relative scoring).
- *Reported:* used in PocketGS (window of 8, 5% hysteresis) and the LichtFeld plugin. No isolated ablation was found.
- *Compute:* CPU, milliseconds per frame.
- *Code:* trivial (OpenCV).
- *Failure modes:* rewards noise and banding; is blind to RS skew.

**S2. IMU-gated, parallax-spaced keyframing.**
- *Idea:* reject frames whose angular rate during the exposure would cause > ~2 px horizon blur (ω > ~11°/s at 1/100 s [CALC]). Space the kept frames by derotated flow or coarse VO distance.
- *Assumptions:* the quaternion stream is readable and time-aligned. The parser is immature (A1 risk).
- *Reported:* the displacement-gate pattern appears in PocketGS (0.05 m). ORB-SLAM's culling motivates redundancy removal.
- *Compute:* negligible.
- *Failure modes:* a timestamp offset between the IMU and the frames (calibrate it by cross-correlating gyro rate against optical-flow rotation); vibration at high frequency (props) that the fused attitude does not show.

**S3. Task-based matchability score.**
- *Idea:* for candidate frames, count features that survive mutual-NN plus geometric verification against the last kept frame, per lens or sector.
- *Assumptions:* the matcher used for scoring matches the SfM matcher.
- *Reported:* Hartmann et al. show that predicting matchability prunes useless keypoints. No frame-selection ablation was found.
- *Compute:* GPU matching of ~25 fps × 2 lenses. Feasible on 16 GB with ALIKED/LightGlue at 1–2k keypoints [assessment].
- *Failure modes:* repetitive texture inflates the counts (bays look alike, but consecutive frames are a safe pair); the score couples to the matcher choice.

**S4. IMU-predicted per-sector blur map + partial rig frames (experimental).**
- *Idea:* predict per-sector blur from ω (and later v and depth), then mask sectors or drop single lenses or virtual views instead of whole frames.
- *Assumptions:* COLMAP partial frames (documented) and the per-image mask path (documented).
- *Reported:* none. This is a gap.
- *Compute:* negligible.
- *Failure modes:* needs depth for the translational term; masks that are too large make tracks short; seam-band sectors are already questionable.

**S5. Grounded-SAM-2 masks for moving objects and saturated speculars.**
- *Reported:* see §3.1.
- *Compute:* SAM 2 large video propagation fits in 16 GB at moderate resolution [UNVERIFIED for 3840² fisheye; run on crops].
- *Failure modes:* misses at the fisheye rim (hence crop-and-back-project), and over-masking of parked cars unless gated by motion.

**S6. SpotLessSplats** and **S7. WildGaussians.**
- *Reported:* §5.
- *Assumptions:* pinhole training images and transient distractors. Our capture should have few distractors, so expect small gains.
- *Compute:* both are reported on single consumer GPUs (WildGaussians used an RTX 4090 for its own runs) [Kulhanek2024].
- *Fit:* neither supports fisheye out of the box [assessment from the papers' setups], so train on virtual perspective views or port the loss into gsplat's fisheye/ftheta path.
- *Failure mode:* masking under-observed textureless regions.

**S8. Bilateral-grid appearance compensation (gsplat).**
- *Reported:* bilateral grids remove floaters caused by per-view ISP changes [Wang2024Bilarf].
- *Code:* built into gsplat (Apache-2.0) [gsplatTrainer].
- *Fit:* targets flicker and residual WB pulsing.
- *Failure mode:* it can absorb real shading if over-parameterised.

### 8.3 Scores
Weights: Fit ×3, Evidence ×2, Implementability ×2, Accuracy/quality impact ×3, Maturity ×1 (max 55).
| Item | Fit | Evid. | Impl. | Acc. | Mat. | **Total** | One-line justifications (F / E / I / A / M) |
|---|---|---|---|---|---|---|---|
| S2 IMU + parallax keyframing | 5 | 3 | 4 | 4 | 4 | **45** | F: uses this drone's quaternions and targets yaw blur and hover redundancy · E: established SLAM practice, but no 360° ablation · I: needs an OSV parser (immature) · A: directly removes RS- and blur-biased frames · M: simple and deterministic |
| S1 Windowed sharpness | 4 | 3 | 5 | 3 | 5 | **42** | F: works per sector, needs normalisation for texture · E: widely used, weakly ablated · I: OpenCV · A: moderate, misses RS · M: decades of use |
| S3 Matchability score | 4 | 3 | 4 | 4 | 3 | **41** | F: measures what SfM needs, but repetition inflates it · E: Hartmann 2014, no selection study · I: GPU matcher pass · A: closest proxy to registration success · M: custom glue |
| S5 Grounded-SAM-2 masks | 3 | 4 | 4 | 3 | 4 | **38** | F: an empty lot has few movers, though speculars are common · E: strong segmentation benchmarks · I: Apache-2.0, crops needed · A: prevents some false matches and floaters · M: mature models |
| S8 Bilateral grid | 4 | 3 | 5 | 2 | 4 | **38** | F: flicker and WB pulses are likely · E: SIGGRAPH 2024 · I: a flag in gsplat · A: visual only · M: maintained in gsplat |
| S4 Per-sector IMU blur + partial frames | 5 | 1 | 3 | 4 | 2 | **37** | F: exactly matches up/down-lens physics · E: none published · I: masks plus rig config, needs a depth prior · A: keeps floor/ceiling markers in turns · M: unproven |
| S7 WildGaussians | 4 | 4 | 3 | 2 | 3 | **37** | F: appearance plus transients both apply · E: NeurIPS with ablations · I: MIT, own codebase, pinhole · A: visual only · M: research code |
| S6 SpotLessSplats | 3 | 4 | 4 | 2 | 3 | **34** | F: transients rare here · E: clear ablations · I: gsplat fork, Apache-2.0 · A: visual only · M: research fork |

### 8.4 Picks
- **Primary: S2 + S1 combined, with the mandatory fixed masks.** Run the IMU gate first, then parallax spacing, then the sharpest frame per window scored per lens. This is cheap, explainable, and aimed at the dominant failure modes (yaw blur, hovering, RS). *What would change my mind:* if the A2–A4 ablations show no gain in marker error or registration over budget-matched uniform sampling, simplify to uniform sampling plus masks.
- **Runner-up: S3 (matchability score)** in place of S1 as the within-window criterion. It will beat S1 if noise and banding fool gradient energy, which the A4 side test will show.
- **High-upside experimental: S4 per-sector selection with partial rig frames.** If it raises the registration rate through turns and keeps more marker observations, it is both a pipeline win and a publishable contribution (§9).
- **For 3DGS:** use the dense set + bilateral grid + SLS-style robust loss (warm-up, capped masking). Choose WildGaussians if appearance variation turns out larger than expected.

---

## 9. Recommended staged filtering pipeline

| # | Inputs | Method | Thresholds / heuristics (starting points) | Outputs | Consumed by |
|---|---|---|---|---|---|
| 0 | `.OSV` | Decode the 2 fisheye streams, parse per-frame and high-rate quaternions plus ISO/shutter/WB; estimate the IMU-to-frame time offset (gyro vs flow cross-correlation) | Flag any exposure or WB change | Per-frame table: t, ω(t), exposure, frame type | All stages |
| 1 | Hover clip | Temporal median/MAD airframe mask + image-circle mask + prop ellipses; optional rim band θ > 100° | Dilate 5–10 px | 2 fixed per-lens masks | COLMAP `camera_mask_path`, fusion, gsplat |
| 2 | Table + frames | **IMU gate**: predicted horizon blur = 18.3·ω[°/s]·t_exp | Reject a *frame* if > 3 px. Mark *rim sectors* bad if > 2 px | Candidate set + sector flags | 3, 4 |
| 3 | Candidates | **Redundancy / parallax spacing**: derotated median flow or coarse VO distance; collapse hovers to 1 frame | SfM set 4–7 frames/m; 3DGS set 8–12 frames/m; force-keep frames that maintain the sequential chain | Two candidate lists | 4 |
| 4 | Windows of ±0.25 s | **Sharpest per window**, per lens and sector: denoised gradient energy relative to window median (runner-up: verified match count) | Sector bad if rel < 0.6. Prefer I/P frames on ties | Kept rig-frames with per-sector quality | 5 |
| 5 | Kept frames | **Dynamic / specular / lamp masks**: Grounded-SAM-2 on perspective crops → back-projected; SAM 2 propagation; saturation blobs | Luma > 0.95 → mask, dilate ×2; car masks only if the track moves | Per-image masks (∪ fixed ∪ bad sectors) | COLMAP `mask_path`, fusion, gsplat |
| 6 | Kept frames + masks | **Rig assembly**: partial frames allowed (drop a lens or view if > 50% masked) | Never drop a sequential-link frame | COLMAP DB with rigs and frames | A3b SfM |
| 7 | Sparse model | **Diagnostics and feedback**: per-image inliers and residual sector histogram; marker-ID consistency; gravity check | Images < 100 inliers → check blur; if sharp, densify nearby | Revised selection and masks; loop-suspect list | Re-run 2–6; A3b disambiguation |
| 8 | Registered dense set | **Point filtering for export**: track ≥ 3, tri-angle ≥ 2–3°, reproj ≤ 2 px | (Defaults: 4 px, 1.5°) [COLMAPMapperSrc] | Clean sparse cloud | A3b MVS, A3c 3DGS init |
| 9 | Dense set + masks | **Soft filtering in 3DGS**: masked L1/SSIM, robust loss with warm-up, bilateral grid | Cap the robust-masked fraction at ~30% per image | Trained model | A3c |
| 10 | All arms | **Evaluation** (§7) | Keep a stage only if marker error and registration do not worsen | Ablation table | Project report |

---

## 10. Research gaps

1. **Per-region quality for 360° and rig SfM (main gap).** No method found that scores quality per fisheye sector, cubemap face or virtual view and keeps partial frames. The proposal is to predict a blur map on the sphere from IMU ω (plus v/d later), fuse it with relative image sharpness, and emit per-sector masks and partial rig frames. Evaluate on registration through turns and on marker observations retained. A natural extension is a BAD-Gaussians-style exposure trajectory driven by the IMU, so blurred sectors become *soft* constraints in 3DGS rather than holes.
2. **IQA vs SfM success.** No study found that correlates NR-IQA (BRISQUE, NIQE, MUSIQ, CLIP-IQA) with registration or accuracy. The A4 side test in §7 would produce exactly that evidence for compressed, noisy fisheye video.
3. **Frames per metre for 360° SfM and 3DGS indoors.** Practice uses ad-hoc 1–3 fps [Chen2024Drone360, LichtFeld360]. No principled study ties spacing to range and texture.
4. **Robust 3DGS losses on fisheye and wide-FOV input.** The published robust methods are pinhole. GOFish [Tu2026GOFish] shows wide-FOV 3DGS is maturing, but does not handle distractors.
5. **Filtering under repetition.** How selection density affects false-loop rates in repetitive scenes is unstudied. Too sparse a selection pushes the mapper toward retrieval-based loops.
6. **HEVC frame type and texture.** Whether I/P frames carry measurably more matchable texture than B-frames at ~0.1 bpp is untested.

---

## 11. Interactive component suggestions (for the HTML report)

1. **Direction-dependent blur sphere.** A 3D sphere, with the up and down fisheye footprints and the seam band drawn on it. Sliders for yaw, pitch and roll rate, forward speed, floor and wall distance, and exposure. Colour shows predicted blur in px from §2.1. Toggles render it as the two fisheye discs and as an equirect strip. This makes "walls smear, floor stays sharp" obvious.
2. **Blur-score slider on sample frames.** A strip of fisheye frames with Laplacian, Tenengrad and NIQE per-sector heat maps. The threshold slider shows kept and dropped sectors, with a "relative vs absolute" toggle to demonstrate the textureless-floor trap.
3. **Selection timeline.** The flight timeline with ω(t), sharpness and frames-per-metre tracks. Kept and dropped frames are colour-coded by reason (IMU, hover, blur, link-keep).
4. **Frames-per-metre calculator.** Inputs are speed, fps, range and target triangulation angle. Outputs are spacing, keep ratio, and observations per point.
5. **Mask compositor.** Layer toggles (fixed airframe, dynamic, specular, bad sectors) over one fisheye frame, showing the % of pixels each layer removes.
6. **Ablation explorer.** Arms A0–A7 against the metrics (marker error, registration, PSNR), with budget-matched baselines overlaid.

---

## Handoff

- **Select per lens and per sector, not per frame.** Yaw blur, seam parallax and near-range defocus concentrate in the horizon band at each fisheye rim, while lens centres (floor and ceiling, where markers are) stay sharp. COLMAP accepts **partial rig frames** and per-image masks, so this needs no SfM changes.
- **Primary selector (pre-SfM):** IMU angular-rate gate (reject a frame if predicted horizon blur > 3 px; flag sectors > 2 px) → parallax spacing (**4–7 rig-frames/m for SfM; 8–12/m for 3DGS/MVS**), hovers collapsed → sharpest per ±0.25 s window by *relative, denoised* gradient energy per lens and sector. Runner-up criterion: verified-match count.
- **Masks:** fixed per-lens (image circle, airframe from a hover-clip temporal median, prop ellipses) via `camera_mask_path`; dynamic objects (Grounded-SAM-2 + SAM 2 on perspective crops, back-projected), saturated lamps and specular blobs via per-image `mask_path`. Reuse at `StereoFusion.mask_path` and in the gsplat masked loss. **Do not mask parked cars**, only movers.
- **Do not use NR-IQA (BRISQUE, NIQE, MUSIQ, CLIP-IQA) as selectors.** There is no evidence they predict SfM success. They are only a side test in the ablation, and the common toolbox is non-commercial.
- **For A3b:** A3b owns disambiguation and loop verification. A3a provides marker-ID co-observation, IMU gravity/yaw consistency and per-image residual-sector diagnostics as loop-suspect inputs. Doppelgangers (MIT) fits COLMAP pair pruning. Doppelgangers++ is CC BY-NC-SA. Recommended export filter: track ≥ 3, triangulation ≥ 2–3°, reprojection ≤ 2 px.
- **For A3c:** use soft filtering. Train on the denser set with the masked loss, an SLS-style robust loss (warm-up, cap ~30% masked per image), and gsplat `bilateral_grid` for flicker/WB. Robust methods are pinhole-based, so use virtual views or port the loss to the fisheye/ftheta path. Never inpaint for measurement; inpainting is fine for visualisation only.
- **Evaluation contract:** reserve held-out marker distances and sharp held-out views *before* filtering. Compare each stage with budget-matched uniform sampling. Accept a stage only if marker error and registration rate do not worsen. PSNR/LPIPS breaks ties.
- **Main research gap:** IMU-predicted per-sector blur + partial-frame rig SfM (unpublished as far as I could find). It is also the experimental pick.
- **Capture dependencies from A1:** manual exposure (no HDR video mode), 1/100 s at 25 fps, ≥1–1.5 m from surfaces (fixed focus 1.5 m–∞), hover clip for masks, and possible ATTI drift over repeating patterns, which makes redundancy and blur gating more important.

```json
[
  {"key": "A1", "title": "A1: The DJI Avata 360 as a measurement instrument", "authors": "Agent A1", "venue": "Project research file", "year": 2026, "url": "research/A1_device.md", "code": null, "license": null, "type": "secondary", "verified": true},
  {"key": "Pertuz2013", "title": "Analysis of focus measure operators for shape-from-focus", "authors": "S. Pertuz, D. Puig, M. A. Garcia", "venue": "Pattern Recognition", "year": 2013, "url": "https://doi.org/10.1016/j.patcog.2012.11.011", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Sieberth2016", "title": "Automatic detection of blurred images in UAV image sets", "authors": "T. Sieberth, R. Wackrow, J. H. Chandler", "venue": "ISPRS Journal of Photogrammetry and Remote Sensing", "year": 2016, "url": "https://doi.org/10.1016/j.isprsjprs.2016.09.010", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Sieberth2015", "title": "UAV image blur - its influence and ways to correct it", "authors": "T. Sieberth, R. Wackrow, J. H. Chandler", "venue": "ISPRS Archives XL-1/W4", "year": 2015, "url": "https://isprs-archives.copernicus.org/articles/XL-1-W4/33/2015/", "code": null, "license": "CC BY 3.0", "type": "paper", "verified": true},
  {"key": "Mittal2012", "title": "No-Reference Image Quality Assessment in the Spatial Domain", "authors": "Anish Mittal, Anush K. Moorthy, Alan C. Bovik", "venue": "IEEE Transactions on Image Processing", "year": 2012, "url": "https://doi.org/10.1109/TIP.2012.2214050", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Mittal2013", "title": "Making a 'Completely Blind' Image Quality Analyzer", "authors": "Anish Mittal, Rajiv Soundararajan, Alan C. Bovik", "venue": "IEEE Signal Processing Letters", "year": 2013, "url": "https://doi.org/10.1109/LSP.2012.2227726", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Ke2021", "title": "MUSIQ: Multi-scale Image Quality Transformer", "authors": "Junjie Ke, Qifei Wang, Yilin Wang, Peyman Milanfar, Feng Yang", "venue": "ICCV", "year": 2021, "url": "https://arxiv.org/abs/2108.05997", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Wang2023CLIPIQA", "title": "Exploring CLIP for Assessing the Look and Feel of Images", "authors": "Jianyi Wang, Kelvin C. K. Chan, Chen Change Loy", "venue": "AAAI", "year": 2023, "url": "https://arxiv.org/abs/2207.12396", "code": "https://github.com/IceClear/CLIP-IQA", "license": null, "type": "paper", "verified": true},
  {"key": "IQAPyTorch", "title": "IQA-PyTorch toolbox (LICENSE)", "authors": "Chaofeng Chen", "venue": "GitHub repository", "year": 2022, "url": "https://github.com/chaofengc/IQA-PyTorch", "code": "https://github.com/chaofengc/IQA-PyTorch", "license": "PolyForm Noncommercial", "type": "repo", "verified": true},
  {"key": "Hartmann2014", "title": "Predicting Matchability", "authors": "Wilfried Hartmann, Michal Havlena, Konrad Schindler", "venue": "CVPR", "year": 2014, "url": "https://openaccess.thecvf.com/content_cvpr_2014/html/Hartmann_Predicting_Matchability_2014_CVPR_paper.html", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Guo2026PocketGS", "title": "PocketGS: High-Fidelity On-Device Training for 3D Gaussian Splatting", "authors": "Wenzhi Guo, Guangchi Fang, Shu Yang, Bing Wang", "venue": "arXiv 2601.17354 (frame selection described in v3)", "year": 2026, "url": "https://arxiv.org/abs/2601.17354v3", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "LichtFeld360", "title": "lichtfeld-360-plugin: 360 camera plugin for LichtFeld Studio", "authors": "alexmgee", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/alexmgee/lichtfeld-360-plugin", "code": "https://github.com/alexmgee/lichtfeld-360-plugin", "license": "GPL-3.0-or-later", "type": "repo", "verified": true},
  {"key": "Sun2024MM3DGS", "title": "MM3DGS SLAM: Multi-modal 3D Gaussian Splatting for SLAM Using Vision, Depth, and Inertial Measurements", "authors": "Lisong C. Sun, Neel P. Bhatt, Jonathan C. Liu, Zhiwen Fan, Zhangyang Wang, Todd E. Humphreys, Ufuk Topcu", "venue": "arXiv 2404.00923", "year": 2024, "url": "https://arxiv.org/abs/2404.00923", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "MurArtal2015", "title": "ORB-SLAM: a Versatile and Accurate Monocular SLAM System", "authors": "Raul Mur-Artal, J. M. M. Montiel, Juan D. Tardos", "venue": "IEEE Transactions on Robotics", "year": 2015, "url": "https://arxiv.org/abs/1502.00956", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Matsuki2024", "title": "Gaussian Splatting SLAM", "authors": "Hidenobu Matsuki, Riku Murai, Paul H. J. Kelly, Andrew J. Davison", "venue": "CVPR", "year": 2024, "url": "https://arxiv.org/abs/2312.06741", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Hornung2008", "title": "Image selection for improved Multi-View Stereo", "authors": "A. Hornung, B. Zeng, L. Kobbelt", "venue": "CVPR", "year": 2008, "url": "https://doi.org/10.1109/CVPR.2008.4587688", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Snavely2008", "title": "Skeletal graphs for efficient structure from motion", "authors": "Noah Snavely, Steven M. Seitz, Richard Szeliski", "venue": "CVPR", "year": 2008, "url": "https://doi.org/10.1109/CVPR.2008.4587678", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Jiang2023FisherRF", "title": "FisherRF: Active View Selection and Uncertainty Quantification for Radiance Fields using Fisher Information", "authors": "Wen Jiang, Boshu Lei, Kostas Daniilidis", "venue": "arXiv 2311.17874", "year": 2023, "url": "https://arxiv.org/abs/2311.17874", "code": "https://github.com/jiangwenpl/FisherRF", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "FisherRFRepo", "title": "FisherRF repository LICENSE", "authors": "Wen Jiang et al.", "venue": "GitHub repository", "year": 2024, "url": "https://github.com/jiangwenpl/FisherRF", "code": "https://github.com/jiangwenpl/FisherRF", "license": "Gaussian-Splatting License (non-commercial)", "type": "repo", "verified": true},
  {"key": "Chen2024Drone360", "title": "Scalable Indoor Novel-View Synthesis using Drone-Captured 360 Imagery with 3D Gaussian Splatting", "authors": "Yuanbo Chen, Chengyu Zhang, Jason Wang, Xuefan Gao, Avideh Zakhor", "venue": "ECCV 2024 Workshop (S3DSGR)", "year": 2024, "url": "https://arxiv.org/abs/2410.11285", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Guo2026CubeSplat", "title": "Cube-Splat: High-Fidelity 360° Gaussian Splatting SLAM via Cubemap Factorization and Adjoint-Consistent Optimization", "authors": "Xiangfei Guo, Hao Shi, Yufan Zhang, Zhonghua Yi, Yongqi Mao, Xiaoting Yin, Kaiwei Wang", "venue": "ECCV", "year": 2026, "url": "https://arxiv.org/abs/2609.21347", "code": "https://github.com/guoxf304/CubeSplat", "license": null, "type": "paper", "verified": true},
  {"key": "Huang2026RIGOR", "title": "RIGOR: Rig-Informed Geometry for Omnidirectional Reconstruction", "authors": "Tingjun Huang, Dmitry Rudshin, Mathieu Meyer, Pietro Bonazzi, Marc Pollefeys, Emilia Szymanska", "venue": "arXiv 2609.13504", "year": 2026, "url": "https://arxiv.org/abs/2609.13504", "code": "https://github.com/TangentH/RIGOR", "license": null, "type": "paper", "verified": true},
  {"key": "Tu2026GOFish", "title": "GOFish: Full Field-of-View Gaussian Splatting and Mesh Extraction", "authors": "Allen Tu, Meher Gitika Karumuri, Shifan Zhu, Hailing Wang, Yen-Liang Lin, David Held, Matthias Zwicker, Tom Goldstein", "venue": "arXiv 2610.37818", "year": 2026, "url": "https://arxiv.org/abs/2610.37818", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "COLMAPRigs", "title": "COLMAP documentation: Rig Support", "authors": "COLMAP contributors", "venue": "colmap.github.io", "year": 2026, "url": "https://colmap.github.io/rigs.html", "code": "https://github.com/colmap/colmap", "license": "BSD-3-Clause [UNVERIFIED]", "type": "docs", "verified": true},
  {"key": "COLMAPFAQ", "title": "COLMAP documentation: FAQ (Mask image regions)", "authors": "COLMAP contributors", "venue": "colmap.github.io", "year": 2026, "url": "https://colmap.github.io/faq.html", "code": "https://github.com/colmap/colmap", "license": null, "type": "docs", "verified": true},
  {"key": "COLMAPMapperSrc", "title": "COLMAP src/colmap/sfm/incremental_mapper.h (filter_max_reproj_error=4, filter_min_tri_angle=1.5, init_min_tri_angle=16)", "authors": "COLMAP contributors", "venue": "GitHub source", "year": 2026, "url": "https://github.com/colmap/colmap/blob/main/src/colmap/sfm/incremental_mapper.h", "code": "https://github.com/colmap/colmap", "license": null, "type": "repo", "verified": true},
  {"key": "COLMAPFusionSrc", "title": "COLMAP src/colmap/mvs/fusion.h (StereoFusionOptions.mask_path)", "authors": "COLMAP contributors", "venue": "GitHub source", "year": 2026, "url": "https://github.com/colmap/colmap/blob/main/src/colmap/mvs/fusion.h", "code": "https://github.com/colmap/colmap", "license": null, "type": "repo", "verified": true},
  {"key": "gsplatTrainer", "title": "gsplat examples/simple_trainer.py (masks, app_opt, bilateral_grid, camera models)", "authors": "nerfstudio-project", "venue": "GitHub source", "year": 2026, "url": "https://github.com/nerfstudio-project/gsplat/blob/main/examples/simple_trainer.py", "code": "https://github.com/nerfstudio-project/gsplat", "license": "Apache-2.0", "type": "repo", "verified": true},
  {"key": "Ren2024GroundedSAM", "title": "Grounded SAM: Assembling Open-World Models for Diverse Visual Tasks", "authors": "Tianhe Ren, Shilong Liu, Ailing Zeng, Jing Lin, Kunchang Li, He Cao, Jiayu Chen, Xinyu Huang, Yukang Chen, Feng Yan, Zhaoyang Zeng, Hao Zhang, Feng Li, Jie Yang, Hongyang Li, Qing Jiang, Lei Zhang", "venue": "arXiv 2401.14159", "year": 2024, "url": "https://arxiv.org/abs/2401.14159", "code": "https://github.com/IDEA-Research/Grounded-SAM-2", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "GroundedSAM2Repo", "title": "Grounded-SAM-2 repository", "authors": "IDEA-Research", "venue": "GitHub repository", "year": 2024, "url": "https://github.com/IDEA-Research/Grounded-SAM-2", "code": "https://github.com/IDEA-Research/Grounded-SAM-2", "license": "Apache-2.0", "type": "repo", "verified": true},
  {"key": "Ravi2024SAM2", "title": "SAM 2: Segment Anything in Images and Videos", "authors": "Nikhila Ravi, Valentin Gabeur, Yuan-Ting Hu, Ronghang Hu, Chaitanya Ryali, Tengyu Ma, Haitham Khedr, Roman Rädle, Chloe Rolland, Laura Gustafson, Eric Mintun, Junting Pan, Kalyan Vasudev Alwala, Nicolas Carion, Chao-Yuan Wu, Ross Girshick, Piotr Dollár, Christoph Feichtenhofer", "venue": "arXiv 2408.00714", "year": 2024, "url": "https://arxiv.org/abs/2408.00714", "code": "https://github.com/facebookresearch/sam2", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "SAM2Repo", "title": "SAM 2 repository", "authors": "Meta AI (facebookresearch)", "venue": "GitHub repository", "year": 2024, "url": "https://github.com/facebookresearch/sam2", "code": "https://github.com/facebookresearch/sam2", "license": "Apache-2.0", "type": "repo", "verified": true},
  {"key": "UltralyticsRepo", "title": "Ultralytics YOLO repository", "authors": "Ultralytics", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/ultralytics/ultralytics", "code": "https://github.com/ultralytics/ultralytics", "license": "AGPL-3.0", "type": "repo", "verified": true},
  {"key": "Bescos2018", "title": "DynaSLAM: Tracking, Mapping and Inpainting in Dynamic Scenes", "authors": "Berta Bescos, José M. Fácil, Javier Civera, José Neira", "venue": "IEEE Robotics and Automation Letters", "year": 2018, "url": "https://arxiv.org/abs/1806.05620", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Mei2020GDNet", "title": "Don't Hit Me! Glass Detection in Real-World Scenes", "authors": "Haiyang Mei, Xin Yang, Yang Wang, Yuanyuan Liu, Shengfeng He, Qiang Zhang, Xiaopeng Wei, Rynson W.H. Lau", "venue": "CVPR", "year": 2020, "url": "https://openaccess.thecvf.com/content_CVPR_2020/html/Mei_Dont_Hit_Me_Glass_Detection_in_Real-World_Scenes_CVPR_2020_paper.html", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Yang2019Mirror", "title": "Where Is My Mirror?", "authors": "Xin Yang, Haiyang Mei, Ke Xu, Xiaopeng Wei, Baocai Yin, Rynson W.H. Lau", "venue": "ICCV", "year": 2019, "url": "https://openaccess.thecvf.com/content_ICCV_2019/html/Yang_Where_Is_My_Mirror_ICCV_2019_paper.html", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Fu2021SHIQ", "title": "A Multi-Task Network for Joint Specular Highlight Detection and Removal", "authors": "Gang Fu, Qing Zhang, Lei Zhu, Ping Li, Chunxia Xiao", "venue": "CVPR", "year": 2021, "url": "https://openaccess.thecvf.com/content/CVPR2021/html/Fu_A_Multi-Task_Network_for_Joint_Specular_Highlight_Detection_and_Removal_CVPR_2021_paper.html", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Cai2023Doppel", "title": "Doppelgangers: Learning to Disambiguate Images of Similar Structures", "authors": "Ruojin Cai, Joseph Tung, Qianqian Wang, Hadar Averbuch-Elor, Bharath Hariharan, Noah Snavely", "venue": "ICCV (Oral)", "year": 2023, "url": "https://arxiv.org/abs/2309.02420", "code": "https://github.com/RuojinCai/doppelgangers", "license": "MIT", "type": "paper", "verified": true},
  {"key": "DoppelRepo", "title": "Doppelgangers repository", "authors": "Ruojin Cai", "venue": "GitHub repository", "year": 2023, "url": "https://github.com/RuojinCai/doppelgangers", "code": "https://github.com/RuojinCai/doppelgangers", "license": "MIT", "type": "repo", "verified": true},
  {"key": "Xiangli2024DoppelPP", "title": "Doppelgangers++: Improved Visual Disambiguation with Geometric 3D Features", "authors": "Yuanbo Xiangli, Ruojin Cai, Hanyu Chen, Jeffrey Byrne, Noah Snavely", "venue": "arXiv 2412.05826 (later venue [UNVERIFIED])", "year": 2024, "url": "https://arxiv.org/abs/2412.05826", "code": "https://github.com/doppelgangers25/doppelgangers-plusplus", "license": "CC BY-NC-SA 4.0", "type": "paper", "verified": true},
  {"key": "DoppelPPRepo", "title": "Doppelgangers++ repository LICENSE", "authors": "doppelgangers25", "venue": "GitHub repository", "year": 2025, "url": "https://github.com/doppelgangers25/doppelgangers-plusplus", "code": "https://github.com/doppelgangers25/doppelgangers-plusplus", "license": "CC BY-NC-SA 4.0", "type": "repo", "verified": true},
  {"key": "Zach2010", "title": "Disambiguating visual relations using loop constraints", "authors": "Christopher Zach, Manfred Klopschitz, Marc Pollefeys", "venue": "CVPR", "year": 2010, "url": "https://doi.org/10.1109/CVPR.2010.5539801", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Yan2017", "title": "Distinguishing the Indistinguishable: Exploring Structural Ambiguities via Geodesic Context", "authors": "Qingan Yan, Long Yang, Ling Zhang, Chunxia Xiao", "venue": "CVPR", "year": 2017, "url": "https://openaccess.thecvf.com/content_cvpr_2017/html/Yan_Distinguishing_the_Indistinguishable_CVPR_2017_paper.html", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Heinly2014", "title": "Correcting for Duplicate Scene Structure in Sparse 3D Reconstruction", "authors": "Jared Heinly, Enrique Dunn, Jan-Michael Frahm", "venue": "ECCV", "year": 2014, "url": "https://doi.org/10.1007/978-3-319-10593-2_51", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "SfMDisambigRepo", "title": "SfM disambiguation with COLMAP", "authors": "Lixin Xue et al. (cvg)", "venue": "GitHub repository", "year": 2023, "url": "https://github.com/cvg/sfm-disambiguation-colmap", "code": "https://github.com/cvg/sfm-disambiguation-colmap", "license": null, "type": "repo", "verified": true},
  {"key": "MartinBrualla2021", "title": "NeRF in the Wild: Neural Radiance Fields for Unconstrained Photo Collections", "authors": "Ricardo Martin-Brualla, Noha Radwan, Mehdi S. M. Sajjadi, Jonathan T. Barron, Alexey Dosovitskiy, Daniel Duckworth", "venue": "CVPR", "year": 2021, "url": "https://arxiv.org/abs/2008.02268", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Sabour2023RobustNeRF", "title": "RobustNeRF: Ignoring Distractors with Robust Losses", "authors": "Sara Sabour, Suhani Vora, Daniel Duckworth, Ivan Krasin, David J. Fleet, Andrea Tagliasacchi", "venue": "CVPR", "year": 2023, "url": "https://arxiv.org/abs/2302.00833", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Ren2024OTG", "title": "NeRF On-the-go: Exploiting Uncertainty for Distractor-free NeRFs in the Wild", "authors": "Weining Ren, Zihan Zhu, Boyang Sun, Jiaqi Chen, Marc Pollefeys, Songyou Peng", "venue": "CVPR", "year": 2024, "url": "https://arxiv.org/abs/2405.18715", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "SabourSLS2024", "title": "SpotLessSplats: Ignoring Distractors in 3D Gaussian Splatting", "authors": "Sara Sabour, Lily Goli, George Kopanas, Mark Matthews, Dmitry Lagun, Leonidas Guibas, Alec Jacobson, David J. Fleet, Andrea Tagliasacchi", "venue": "arXiv 2406.20055", "year": 2024, "url": "https://arxiv.org/abs/2406.20055", "code": "https://github.com/lilygoli/SpotLessSplats", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "SLSRepo", "title": "SpotLessSplats gsplat implementation", "authors": "Lily Goli et al.", "venue": "GitHub repository", "year": 2024, "url": "https://github.com/lilygoli/SpotLessSplats", "code": "https://github.com/lilygoli/SpotLessSplats", "license": "Apache-2.0", "type": "repo", "verified": true},
  {"key": "Kulhanek2024", "title": "WildGaussians: 3D Gaussian Splatting in the Wild", "authors": "Jonas Kulhanek, Songyou Peng, Zuzana Kukelova, Marc Pollefeys, Torsten Sattler", "venue": "NeurIPS", "year": 2024, "url": "https://arxiv.org/abs/2407.08447", "code": "https://github.com/jkulhanek/wild-gaussians", "license": "MIT", "type": "paper", "verified": true},
  {"key": "WildGaussiansRepo", "title": "wild-gaussians repository", "authors": "Jonas Kulhanek", "venue": "GitHub repository", "year": 2024, "url": "https://github.com/jkulhanek/wild-gaussians", "code": "https://github.com/jkulhanek/wild-gaussians", "license": "MIT", "type": "repo", "verified": true},
  {"key": "Wang2024DeSplat", "title": "DeSplat: Decomposed Gaussian Splatting for Distractor-Free Rendering", "authors": "Yihao Wang, Marcus Klasson, Matias Turkulainen, Shuzhe Wang, Juho Kannala, Arno Solin", "venue": "arXiv 2411.19756", "year": 2024, "url": "https://arxiv.org/abs/2411.19756", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Ungermann2024", "title": "Robust 3D Gaussian Splatting for Novel View Synthesis in Presence of Distractors", "authors": "Paul Ungermann, Armin Ettenhofer, Matthias Nießner, Barbara Roessle", "venue": "GCPR", "year": 2024, "url": "https://arxiv.org/abs/2408.11697", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Zhang2024GSW", "title": "Gaussian in the Wild: 3D Gaussian Splatting for Unconstrained Image Collections", "authors": "Dongbin Zhang, Chuming Wang, Weitao Wang, Peihao Li, Minghan Qin, Haoqian Wang", "venue": "arXiv 2403.15704", "year": 2024, "url": "https://arxiv.org/abs/2403.15704", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Seo2026PDFGS", "title": "PDF-GS: Progressive Distractor Filtering for Robust 3D Gaussian Splatting", "authors": "Kangmin Seo, MinKyu Lee, Tae-Young Kim, ByeongCheol Lee, JoonSeoung An, Jae-Pil Heo", "venue": "CVPR Findings", "year": 2026, "url": "https://arxiv.org/abs/2604.12580", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Wang2024Bilarf", "title": "Bilateral Guided Radiance Field Processing", "authors": "Yuehao Wang, Chaoyi Wang, Bingchen Gong, Tianfan Xue", "venue": "SIGGRAPH (ACM TOG)", "year": 2024, "url": "https://arxiv.org/abs/2406.00448", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Cui2025Luminance", "title": "Luminance-GS: Adapting 3D Gaussian Splatting to Challenging Lighting Conditions with View-Adaptive Curve Adjustment", "authors": "Ziteng Cui, Xuangeng Chu, Tatsuya Harada", "venue": "CVPR", "year": 2025, "url": "https://arxiv.org/abs/2504.01503", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Zhao2024BAD", "title": "BAD-Gaussians: Bundle Adjusted Deblur Gaussian Splatting", "authors": "Lingzhe Zhao, Peng Wang, Peidong Liu", "venue": "arXiv 2403.11831", "year": 2024, "url": "https://arxiv.org/abs/2403.11831", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Lee2024Deblur3DGS", "title": "Deblurring 3D Gaussian Splatting", "authors": "Byeonghyeon Lee, Howoong Lee, Xiangyu Sun, Usman Ali, Eunbyung Park", "venue": "arXiv 2401.00834", "year": 2024, "url": "https://arxiv.org/abs/2401.00834", "code": null, "license": null, "type": "paper", "verified": true}
]
```
