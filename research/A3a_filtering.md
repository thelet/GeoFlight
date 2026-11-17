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
- **WildGaussians** (NeRF 2024 → NeurIPS 2024) [Kulhanek2024]: DINO-based uncertainty plus an appearance module in 3DGS. On On-the-go it averaged **22.15 PSNR at 0.5 GPU-h**, against 19.30 for 3DGS. Ablation: removing uncertainty cost little or nothing at low occlusion (On-the-go low: 20.53 vs 20.62, LPIPS slightly *better* without it) but cost ~2.8 dB at high occlusion (26% occluders). MIT licence [WildGaussiansRepo].
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

