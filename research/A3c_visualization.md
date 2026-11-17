# A3c: Photoreal, explorable visualization of the parking lot

*Agent A3c (neural rendering). Written 2026-11-17. Input constraint: A1 Handoff (raw dual-fisheye `.OSV` streams modelled as a 2-camera rig; seam on the horizon; θ > 90° per lens; 25 fps, 1/100 s, D-Log M; heavy H.265 compression).*

> **Evidence note.** `WebFetch` could not resolve arXiv or docs.gsplat.studio, but `curl` through the proxy could. I therefore read arXiv abstract and HTML pages, gsplat docs, nerfstudio docs, and the **source code** of gsplat (`main`), nerfstudio (`main`) and nv-tlabs/3dgrut (`main`) directly via `raw.githubusercontent.com`. Claims about what a tool supports come from its source code or docs, and file and line evidence is given where it matters. The GitHub web UI and API were blocked, so I could not see commit dates or issue threads. "Last activity" is therefore inferred from news entries in each README. Venues not visible on a page I opened are marked **[UNVERIFIED]**. Statements tagged *(assessment)* are my own judgement, not reported results.

---

## 0. TL;DR

1. **Representation:** 3D Gaussian Splatting [Kerbl2023] family, trained with **gsplat** [Ye2024gsplat] (Apache-2.0). NeRFs (Zip-NeRF, nerfacto) are not real-time to view. Textured meshes (IM360-style) are the right *measurement* product but are not the most photoreal.
2. **Training on raw fisheye with θ > 90° is possible today, but only through one specific path.** gsplat's `rasterization()` has `camera_model="ftheta"` with the Unscented Transform (`with_ut=True, with_eval3d=True`), and the code says FTheta needs `global_z_order=False` to render the band beyond 180°. gsplat's **OpenCV `fisheye` model rejects every ray with z ≤ 0**, so it clips exactly the horizon band this drone puts walls in. **nerfstudio's splatfacto cannot** train on fisheye at all: it undistorts to pinhole, its docs say fisheye and equirect rendering is not supported, and it pins `gsplat==1.4.0`.
3. **Rolling shutter** exists as a rasterizer argument in gsplat (`rolling_shutter`, `viewmats_rs`; start and end poses slerped per row) and in 3DGRUT. However, gsplat's `simple_trainer.py` does **not** pass it through, so wiring it in is a small custom job. With A1's capture discipline (≤10°/s, 0.3–0.5 m/s) RS skew and blur are about 2 px, so this is a second-order fix *(assessment, [CALC] below)*.
4. **Appearance:** use **PPISP** [Deutsch2026] (CVPR 2026, Apache-2.0, built into gsplat and 3DGRUT). It models per-sensor chromatic **vignetting** (the fisheye rim falls to ~0.76 shading per A1), a per-sensor response curve, and per-frame exposure and white balance. A controller predicts these for novel views. Keep the **bilateral grid** [Wang2024BilaRF] as a fallback for residual row-banding from flicker.
5. **Metric coupling:** initialise from the A3b dense cloud, **turn off gsplat's default world normalisation** (`--no-normalize-world-space`), freeze or tightly regularise poses, and add a dense depth loss against the A3b mesh. Then the splat lives in the survey frame and can be overlaid on the mesh.
6. **Delivery:** `.ply` as master, then PlayCanvas `splat-transform` to **SOG / Streamed SOG (LOD)** for the web. Use SuperSplat for cleanup and annotation, and Spark (three.js) if you need a custom viewer with a mesh overlay. All three are MIT-licensed.

---

## 1. Representation choice

### Examples of relevant work
- **3D Gaussian Splatting** [Kerbl2023] (SIGGRAPH 2023): an explicit set of anisotropic 3D Gaussians, rasterized with sorted alpha blending at ≥30 fps at 1080p. The INRIA reference code is under a **research/non-commercial licence** (opened LICENSE.md). **gsplat** [Ye2024gsplat] (JMLR MLOSS) reimplements it under Apache-2.0. Its docs report Mip-NeRF 360 at 30k steps: PSNR 28.95, 5.7 GB training memory, versus 9.0 GB for INRIA at the same PSNR.
- **Zip-NeRF** [Barron2023] (ICCV 2023 [UNVERIFIED venue]) is the NeRF quality reference. In the 3DGUT paper's table it renders at **0.2 fps** (PSNR 28.54 on Mip-NeRF 360), versus hundreds of fps for splatting [Wu2025_3DGUT]. **Nerfacto** in Nerfstudio [Tancik2023] is the fast practical NeRF. Being ray-based, it natively supports `FISHEYE` and `EQUIRECTANGULAR` camera types (nerfstudio `cameras.py`).
- **IM360** [Jung2025IM360] (ICCV 2025): spherical SfM, then neural implicit surface, then **mesh-based neural texture optimisation** with diffuse and specular components. On Matterport3D/Stanford2D3D it reports a +3.5 dB PSNR gain for *textured mesh* rendering (abstract). Code: not found.
- **Surface-aligned splats:** 2DGS [Huang2024_2DGS] (SIGGRAPH 2024), PGSR [Chen2024PGSR], MILo [Guedon2025MILo] (SIGGRAPH Asia 2025) and SuGaR [Guedon2024SuGaR] (CVPR 2024) trade a little photorealism for geometry that can be meshed.

### Trade-offs (assessment)

| | 3DGS (gsplat) | NeRF (Zip-NeRF / nerfacto) | Textured mesh + neural texture |
|---|---|---|---|
| Photorealism (near trajectory) | Highest per GPU-hour | Zip-NeRF ≈ 3DGS; nerfacto lower | Lower: textures cannot show view-dependent fuzz, thin wires or grilles |
| Training on 16 GB | 30–90 min per zone | Zip-NeRF: hours; nerfacto: under 1 h | Depends on A3b mesh, plus texture bake |
| Real-time viewing | Yes, including browser (SOG/spz) | No (0.2 fps for Zip-NeRF); needs baking | Yes, any engine |
| Editability | Good: crop, delete, merge in SuperSplat | Poor | Best |
| File size | Large (≈250 B/Gaussian raw; ~10× less with spz/SOG) | Small weights, but no direct viewer | Small–medium |
| Measurement | Not a surface; depth is "expected" | Not a surface | **Is** a surface |

**Recommendation:** use 3DGS (gsplat) for the visualization. **Do not** try to make the splat the measurement product: the A3b mesh is the measurement product. The splat is anchored to it (§5) and overlaid on it.

---

## 2. 360° input handling

### 2.1 Three families
**(a) Re-project to perspective views (cubemap or N tangent views), then use a pinhole splatter.** This is RIGOR's choice for SfM (shared context), and nerfstudio's `equirect2persp` utility does it for equirect. *Pros:* any tool works. *Cons:* a second resampling (A1: another 10–20% of resolution lost), duplicated pixels at overlapping faces, and with stitched input the seam error is still baked in.

**(b) Native equirect (ERP) rasterizers** operate on stitched panoramas.
- **OmniGS** [Li2025OmniGS] (WACV 2025) splats directly into ERP space with derived spherical Jacobians. Code: C++/LibTorch, **GPL-3.0**.
- **ODGS** [Lee2024ODGS] (NeurIPS 2024) uses a per-Gaussian tangent-plane projection. Code is MIT.
- **360-GS** [Bai2024_360GS] uses a tangent-plane projection plus room-layout priors for sparse panoramas.
- **PFGS360** [Zhuang2026PFGS360] (CVPR 2026) is pose-free: it estimates poses from Gaussians with depth priors, for 360° video. It builds on nerfstudio 1.1.5 and a forked `gsplat360`. No licence file was found.
- **Seam360GS** [Shin2025Seam360GS] (ICCV 2025) is the one most relevant to this drone. It adds a **dual-fisheye camera model** to ERP splatting: a learnable **inter-lens gap** (a translation per lens) and a learnable **angular-distortion grid**, optimised jointly with the Gaussians. Reported results: gap error **0.115 cm MAE** on a synthetic set versus 3.30 cm for OmniNeRF. Real data: 360Roam (Insta360) PSNR **26.10 vs 25.08** for OmniGS and LPIPS 0.144 vs 0.145. Ricoh360 PSNR 26.96 vs 26.06. In the ablation, removing both components costs about 1 dB, and the angular part matters most. They also ran on raw dual-fisheye input for +0.34 dB. **Code: not found** [UNVERIFIED].
- **SC-OmniGS** [Huang2025SCOmniGS] (ICLR 2025) self-calibrates poses and spherical distortion but not the gap.

**(c) Native fisheye or arbitrary-camera rasterization:** this trains on the raw 3840² circles.
- **Fisheye-GS** [Liao2024FisheyeGS] derives the equidistant-fisheye Jacobian.
- **DirectFisheye-GS** [Yang2026DirectFisheye] (CVPR 2026 Highlight) feeds native fisheye into 3DGS. It argues that undistortion stretches pixels and causes edge floaters, and adds cross-view joint optimisation to stop rim Gaussians becoming elongated.
- **3DGUT** [Wu2025_3DGUT] (CVPR 2025) replaces EWA linearisation with an **Unscented Transform**: 7 sigma points per Gaussian are projected *exactly* through any camera function, and a 2D Gaussian is re-fit. That makes any distortion model, and rolling shutter (a different pose per sigma point), essentially free. Reported on ScanNet++ fisheye: **PSNR 29.11 / LPIPS 0.252 with 0.38 M Gaussians, vs Fisheye-GS 28.15 / 0.261 with 1.07 M**, and vs 22.76 for 3DGS trained on undistorted crops.
- **3DGRT** [MoenneLoccoz2024_3DGRT] (SIGGRAPH Asia 2024) ray-traces the same particles, giving any camera plus secondary rays (reflections). It is slower and wants RT cores. The authors' own stated limitation for 3DGUT: under very strong distortion the projected footprint is no longer Gaussian, which degrades tile assignment. That is exactly the 90–105° rim here *(assessment)*.

### 2.2 What the tools support today (verified in source, Nov 2026)

| Stack | Fisheye θ > 90° | Equirect | Rolling shutter | Notes |
|---|---|---|---|---|
| **gsplat `main`** (`version.py` = 1.6.0; latest tagged release on the releases page: v1.5.3) | **Yes, via `camera_model="ftheta"`** + `with_ut` + `with_eval3d` + `global_z_order=False`. `Cameras.cuh` comment: FTheta "max_angle > pi/2 model beyond-180-degree FOV". The **`fisheye` (OpenCV KB-4) model returns invalid for `cam_ray.z <= 0`**, so it is capped at 90° | No | `rolling_shutter=RollingShutterType.{TOP_TO_BOTTOM,…}` + `viewmats_rs` (start/end SE(3), slerp per row) | FTheta = pixel-distance↔angle polynomial + `linear_cde` affine term, with **no tangential terms**. `ftheta_coeffs` are "shared for all cameras", so render each lens in its own call. The trainer warns that `with_eval3d` is incompatible with `DefaultStrategy` and needs MCMC. The COLMAP loader in `simple_trainer` **undistorts** fisheye; only the **NCore** loader feeds FTheta natively. The NCore loader reads start/end poses, but `simple_trainer.py` never passes `viewmats_rs` |
| **nerfstudio splatfacto** (pins `gsplat==1.4.0`) | **No.** `full_images_datamanager` undistorts. Docs FAQ: fisheye/equirect rendering "Currently, no" | No | No | Has MCMC strategy and `use_bilateral_grid` |
| **nerfstudio nerfacto** | Ray-based `FISHEYE` (equidistant) / `EQUIRECTANGULAR` / `FISHEYE624` types | Yes | No | Not real-time |
| **3DGRUT** (Apache-2.0; v2.0.0 June 2026) | COLMAP `OPENCV_FISHEYE` ingested natively. `max_angle` is computed from the image radius (≈105° here). Whether the UT kernel accepts z ≤ 0 for this model I did not verify [UNVERIFIED]. NCore FTheta is supported | No | Yes in the paper (Waymo) and via NCore; COLMAP loader sets `ShutterType.GLOBAL` | MCMC, masks, PPISP, USD/PLY export. 3DGRT path wants RT cores |

**Consequence:** the cleanest route for A1's input decision is **gsplat + FTheta + UT**. Fit DJI's per-lens KB-5 + tangential model to an FTheta `ANGLE_TO_PIXELDIST` polynomial plus `linear_cde`, and check the residual. If the tangential terms leave more than ~0.3 px RMS, pre-warp the images by that small residual field (a near-identity remap, not a re-projection) *(assessment)*. Two calls per rig frame, one per lens, each with its own FTheta parameters and pose `T_world_rig · T_rig_lens` from A3b.

### 2.3 Seam handling and nadir/airframe masking
- **Raw fisheye removes the seam by construction.** The 90–105° overlap band, seen by both lenses from optical centres b apart, becomes an ordinary *multi-view constraint* instead of a blending artefact. It also helps densification on walls *(assessment)*.
- **Per-lens static masks** (A1 §5.7): build them once from a static clip (temporal median, then threshold) and pass them as training masks. gsplat's trainer zeros masked render pixels, and 3DGRUT reads `<image>_mask.png`. **Also mask the outermost ~2–3° of each circle**, where the KB fit is extrapolated and vignetting is strongest *(assessment)*.
- **Fallback (stitched ERP):** mask the ±8–10° horizon band in the photometric loss, as A1 recommends. Or adopt the Seam360GS idea (a learnable gap plus an angular grid) in an ERP rasterizer. Expect to lose wall detail either way.

---
## 3. Hard conditions for appearance

### 3.1 Exposure, white balance, vignetting and flicker
**Examples.**
- **Per-image GLO embeddings.** WildGaussians [Kulhanek2024WildGaussians] (NeurIPS 2024, MIT) feeds per-image embeddings plus DINO-feature uncertainty to an appearance MLP. Splatfacto-W [Xu2024SplatfactoW] puts per-Gaussian neural colour features and per-image embeddings into nerfstudio. gsplat has `app_opt` (a 16-D embedding).
- **Bilateral grids.** BilaRF [Wang2024BilaRF] (SIGGRAPH/TOG 2024, Apache-2.0) learns a per-image 3D bilateral grid of affine colour transforms. It can absorb *spatially varying* ISP effects (local tone mapping), which are what cause floaters. gsplat: `post_processing="bilateral_grid"`, grid `(16,16,8)`, plus an optional fused kernel. splatfacto: `use_bilateral_grid`.
- **PPISP** [Deutsch2026] (CVPR 2026) is a fixed physical chain: per-frame **exposure offset** (a base-2 scale), per-sensor **chromatic vignetting**, colour correction as a homography on RG chromaticity (normalised so it cannot change brightness), and a per-sensor **CRF**. A small **controller**, trained in a second phase with the scene frozen, predicts exposure and WB for *novel* views. The paper argues that GLO and bilateral grids are high-capacity, so they overfit training views and need GT-based colour correction at test time. It evaluates on Mip-NeRF 360, Tanks & Temples, BilaRF, HDR-NeRF, Waymo and its own 3-camera dataset, and reports state-of-the-art results *without* GT colour alignment (abstract; I did not transcribe the table). gsplat exposes it as `post_processing="ppisp"`, and the trainer can feed an **EXIF exposure prior** (`load_exposure`).

**Fit to this drone (assessment).**
- With manual exposure, locked WB and a 1/100 s shutter (A1), the residual variation is (i) lens-rim **vignetting** that differs between the two lenses, (ii) small lamp-to-lamp colour changes, and (iii) residual flicker.
- PPISP's per-*sensor* split maps exactly onto "two lenses = two sensors". Its exposure prior can take DJI's per-frame shutter and gain metadata (A1 §4.2): write it into EXIF of the extracted frames.
- **Flicker:** at 1/100 s with 100 Hz flicker each row integrates one full cycle, so banding should mostly cancel. Any residual (lamp duty-cycle, wrong shutter) appears as **horizontal bands** in the sensor rows. That pattern is spatially varying, so PPISP's global exposure cannot model it, but a coarse bilateral grid can. Use PPISP first, and switch on the bilateral grid only if residual maps show row bands.
- **No HDR video mode exists** (A1, re-verified): there are no bracketed frames to fuse, so HDR-splatting methods that need multi-exposure input do not apply.

### 3.2 Low light and noise: is RAW-style training applicable?
**Examples.**
- **RawNeRF** [Mildenhall2022RawNeRF] (CVPR 2022) trains on *linear raw* frames with a loss weighted to suit their zero-mean noise. Averaging many noisy views denoises the scene and preserves HDR.
- **LE3D** [Jin2024LE3D] brings this to 3DGS. It replaces SH with a colour MLP for linear raw colour and adds depth-distortion and near-far regularisers, because low-SNR SfM is poor [venue UNVERIFIED].
- PPISP and HDR-GS-style work learn a CRF from multi-exposure LDR input.

**Applicability (assessment).** **Mostly not, for H.265 video.**
- The RawNeRF argument needs *raw, unbiased, independent* per-pixel noise. A 0.10 bpp HEVC stream has already been denoised by the ISP. Its residual error is spatially correlated block and ringing artefacts, and it is not zero-mean in texture regions: fine concrete texture is simply removed.
- What survives is the *multi-view averaging* that 3DGS does anyway. With 25 fps at 0.4 m/s, each surface point is seen in dozens of frames.
- Practical consequences:
  1. Decode the **10-bit** D-Log M stream to 16-bit PNG, not 8-bit, so shadows keep their codes.
  2. Convert with a fixed curve (DJI's D-Log M→Rec.709 LUT, which OpenOSV fits, or its inverse to linear [form UNVERIFIED]) and let PPISP's CRF absorb the remainder.
  3. Do **not** denoise frames before splatting. Learned denoisers hallucinate texture inconsistently across frames, which makes floaters *(assessment)*.
  4. Use an L1 + SSIM loss (default λ = 0.2). If RAW-like robustness is wanted, the cheap experiment is a RawNeRF-style weighted L2 in linear space on the 10-bit data.
- The only true RAW source is the **120 MP DNG stills** (A1), but they are few and on a different camera path. Use them for evaluation crops, not for training.

### 3.3 Motion blur, defocus and rolling shutter
**Examples.**
- **Deblurring 3DGS** [Lee2024Deblur3DGS] (ECCV 2024): a small MLP predicts per-Gaussian offsets that model blur.
- **BAD-Gaussians** [Zhao2024BAD] (ECCV 2024, Apache-2.0, nerfstudio 1.0.3): models a camera trajectory *within* the exposure and bundle-adjusts it, rendering blur as an average of virtual sharp frames.
- **Gaussian Splatting on the Move** [Seiskari2024OnTheMove] (ECCV 2024, Apache-2.0, nerfstudio/gsplat): models **motion blur and rolling shutter together** from linear and angular velocities, initialised from VIO/IMU. It uses a screen-space approximation and pose optimisation, and reports gains on synthetic Deblur-NeRF scenes and smartphone video. Its README says joint RS + blur needs known readout and exposure times, and it needs ≥8 GB VRAM.
- **3DGUT** adds RS through per-sigma-point poses (§2.2).

**Size of the problem here [CALC from A1 numbers].**
- Blur ≈ (ω + v/d)·t_exp. At ω = 10°/s, v = 0.4 m/s, d = 2 m and t = 1/100 s: (10 + 11.5)°/s × 0.01 s ≈ 0.21° ≈ **3.9 px** at 18.3 px/deg. At ω = 5°/s it is about 3 px.
- RS skew at a ~10 ms readout (unmeasured) is a similar 2–4 px.
- **Defocus** (fixed focus, rated 1.5 m–∞; A1 re-verified) is about 1–2 binned px at 0.5–1 m and negligible beyond.

**Assessment.**
1. Start with **frame selection**: Laplacian variance plus IMU angular rate, keeping the sharpest frame per 0.15–0.3 m. That costs nothing.
2. Then add **RS rendering** in gsplat. Compute `viewmats_rs` from the A3b pose and the high-rate IMU quaternions at row 0 and row H, and pick the `RollingShutterType` per lens from the measured readout direction. This is ~100 lines in `simple_trainer.py` and makes the forward model exact.
3. Defer blur modelling. Plug in an On-the-Move-style velocity blur only if residual maps show directional smear. Its code is pinhole-only, so it would need porting to the UT path.
4. Defocus is not modelled by any of these. Accept it: it only affects surfaces under 1 m, which A1's flight rules avoid.

### 3.4 Reflective and specular surfaces
**Examples.**
- **3DGS-DR** [Ye2024DR] (deferred shading with an environment map for specular reflections, normal propagation) [venue UNVERIFIED].
- **EnvGS** [Xie2024EnvGS] uses a second set of "environment Gaussians", **ray-traced** for near-field reflections [venue UNVERIFIED].
- **3DGRT** secondary rays [MoenneLoccoz2024_3DGRT], and 3DGUT's hybrid splat-primary / trace-secondary rendering.
- IM360 adds a specular texture term on meshes.

**Assessment.**
- Vanilla 3DGS fakes a mirror by placing a "mirror world" of Gaussians *behind* the floor or car panel. From near-trajectory views it looks right, but it **contradicts the metric geometry** and breaks the depth loss in §5.
- Garage reflections are mostly glossy wet floor and car paint, i.e. near-field, so distant environment maps fit poorly.
- Recommendation: (i) capture an emptier, dry lot; (ii) down-weight the depth loss where a reflection mask is set (car segmentation plus floor-specular detection); (iii) keep SH degree 3. Consider EnvGS or 3DGRT secondary rays only as an experiment, because they cost VRAM and time and the code paths are pinhole-oriented.

### 3.5 Transient objects (coordinate with A3a)
**Examples.**
- **SpotLessSplats** [Sabour2025SpotLess] (ACM TOG, Apache-2.0) clusters Stable-Diffusion features to find distractors and applies a robust, trimmed loss.
- **WildGaussians**: DINO-based uncertainty weighting.
- **RobustNeRF**-style trimmed losses.

**Assessment.** In a parking lot the transients are large and semantically obvious: people, moving cars, a car that left between sorties. **Semantic masks** (A3a's segmentation, dilated by ~10 px) passed as loss masks are cheaper and more predictable than learned robustness. Add a SpotLess-style trimmed loss only if residual "ghosts" remain.

---

## 4. Long, corridor-like scenes: scale, LOD and floaters

**Examples.**
- **Hierarchical 3DGS** [Kerbl2024H3DGS] (SIGGRAPH/TOG 2024 [venue UNVERIFIED], **INRIA non-commercial licence**). The scene is split into 50×50 m chunks for walking captures. Each chunk is trained, then consolidated into a tree of merged Gaussians with LOD selection. Reported: chunks of 2–8 M leaf Gaussians, peak memory **2–5 / 8–10 / 11–16 GB** for the coarse, chunk and hierarchy stages on a 32 GB V100, and 6–88 GB on disk.
- **Octree-GS** [Ren2025OctreeGS] (TPAMI 2025, INRIA-derived licence) and **Scaffold-GS** [Lu2024Scaffold] (CVPR 2024, INRIA-derived licence) use anchor-based neural Gaussians. Scaffold's anchors make Gaussians robust to view change and texture-less areas, and Octree-GS adds LOD levels for consistent frame rates.
- **CityGaussian** [Liu2024CityGaussian] (ECCV 2024, **CC BY-NC-SA 4.0**) uses divide-and-conquer training and LoD.
- **Densification:**
  - **3DGS-MCMC** [Kheradmand2024MCMC] (NeurIPS 2024) treats Gaussians as SGLD samples with relocation and a **hard cap** on their number. It is robust to initialisation and gives a predictable memory ceiling.
  - **AbsGS** [Ye2024AbsGS] uses absolute view-space gradients to split blurry large Gaussians.
  - **Taming 3DGS** [Mallick2024Taming] uses budgeted, score-based densification for limited resources.
  - All three of MCMC, AbsGS and Taming-style `visible_adam` / `SelectiveAdam` are in gsplat.
- **Priors against floaters in textureless indoor scenes:** **DN-Splatter** [Turkulainen2025DNSplatter] (WACV 2025, Apache-2.0, built on gsplat) adds depth (sensor or monocular) and Omnidata-normal losses with edge-aware weighting. It is evaluated on MuSHRoom and ScanNet++, and **MuSHRoom has separate train/eval trajectories**, which is exactly the protocol we want in §6. 360-GS uses room-layout priors.

**Sizing for this project [CALC, assumptions stated].**
- A 60×100 m level flown as aisle lanes plus loops gives about 1–1.5 km of trajectory over 4–6 sorties.
- Keeping one rig frame per 0.25 m gives ~4–6 k rig frames, i.e. **8–12 k fisheye images**.
- At 1920² (half resolution, ~9 px/deg) that is 3.7 MP per image. An 8-bit RGB cache would be ~110 GB, so **stream images from disk**: do not use `cache_images`.
- A Gaussian has 59 floats (3+3+4+1+48 SH). With parameters, gradients and two Adam moments, that is ≈ 0.94 KB, so **3 M Gaussians ≈ 2.8 GB** before rasterizer buffers. gsplat used 5.7 GB in total at Mip-NeRF 360 scale.
- So on 16 GB, budget **≈3–4 M Gaussians per training job** at half resolution, or about 2 M at full 3840² *(assessment)*.
- The whole lot at the density of a room-scale scene would be 15–30 M Gaussians, so **partition**.

**Recommendation.**
- Partition the lot into **zones of ~30–40 m along aisles**, overlapping by 5 m, with a fixed metric frame from A3b.
- Train each zone with **gsplat MCMC** (`cap_max` 3 M). AbsGS gradients apply only to the default strategy, which `with_eval3d` cannot use anyway.
- **Crop each zone to its core** and concatenate. Because all zones share the A3b metric frame and the same PPISP sensor parameters (fixed after zone 1), seams between zones stay small *(assessment)*.
- LOD is handled at delivery (Streamed SOG, §6) rather than with the non-commercial Hierarchical 3DGS code.
- Use the A3b depth (§5) as the main anti-floater prior. It is stronger than monocular depth.

---
## 5. Coupling with metric geometry (A3b)

**Examples.**
- **SuGaR** [Guedon2024SuGaR] (CVPR 2024) regularises Gaussians to align with the surface, extracts a mesh, then *binds* new Gaussians to the mesh triangles for hybrid rendering.
- **2DGS** [Huang2024_2DGS] and **PGSR** [Chen2024PGSR] use planar primitives with depth-normal consistency, giving view-consistent depth. (2DGS has an INRIA-derived licence. PGSR's licence is research and non-profit only, and derivatives must stay non-commercial.)
- **MILo** [Guedon2025MILo] extracts a mesh *inside* the training loop from Gaussian-derived Delaunay vertices.
- **DN-Splatter** regularises toward external depth and normals.

**What "anchored to A3b" should mean here (assessment).**
1. **Same frame, same units.** Train in A3b's metric frame. gsplat's `simple_trainer` **normalises world space by default** (`normalize_world_space=True`, a PCA and scale transform). Disable it, or store and invert the transform before export. Otherwise exported splats will not overlay the mesh.
2. **Poses from A3b, rig-aware.** Each lens pose is T_world_rig · T_rig_lens, using A3b's calibrated rig (including baseline b). Keep `pose_opt` off, or use a tiny learning rate (gsplat's default `pose_opt_lr=1e-5`) followed by a check that the drift is under 1 cm. Refined poses must never be fed back to A3b.
3. **Initialisation** from the A3b dense cloud, voxel-downsampled to 2–3 cm (~1–3 M points per zone), colours included. This beats SfM sparse points on textureless concrete.
4. **Dense depth prior.** Ray-cast the A3b mesh *through the same FTheta camera* (e.g. Open3D `RaycastingScene` with per-pixel bearing vectors) to obtain per-pixel expected depth. Then add an L1 loss on gsplat's `RGB+ED` depth output (λ ≈ 0.05–0.2), masked by mesh confidence, reflection masks and transients. gsplat's built-in `depth_loss` uses only sparse SfM points, so this is custom code.
5. **Optional surface regularisers** (2DGS-style flattening, normal loss toward mesh normals) improve off-trajectory views of floors and walls. They cost some sharpness on cluttered parts such as pipes and signage.
6. **Export and overlay.** Write `.ply` in metric coordinates and record the frame in a PLY comment (splat-transform carries header comments through). The viewer loads mesh, splat and marker annotations together.
7. **Do not measure on splats.** Gaussian "expected depth" is biased at edges and through semi-transparent floaters. Measure on the A3b mesh. Quality-control the coupling with a **splat-depth vs mesh-depth residual map** on held-out views: report the median |Δ| and the fraction of pixels more than 10 cm *in front of* the mesh (= floaters).

---

## 6. Evaluation and delivery

### 6.1 Held-out protocol for video
- **The naive split is wrong.** gsplat's default `test_every=8` holds out every 8th image. At 25 fps and 0.4 m/s, consecutive frames are **1.6 cm apart** [CALC]. Even after keeping one rig frame per 0.25 m, the neighbours of a held-out frame are near-duplicates, so a frame-skip split measures interpolation, not novel views.
- **Recommended protocol (assessment):**
  1. **Block hold-out.** Hold out 2-second blocks every ~20 s, and drop a ±1 s guard band around each block from training.
  2. **Separate validation trajectory.** Fly one short sortie on a different lane and at a ~0.5 m different height, MuSHRoom-style [Turkulainen2025DNSplatter]. Never train on it, and register it into the A3b frame with markers.
  3. **Both lenses** of a held-out rig frame stay out of training.
- **Metrics:**
  - PSNR, SSIM and LPIPS (AlexNet, as gsplat uses), computed **without GT colour alignment**, using the PPISP controller for novel-view exposure.
  - Also gsplat's `cc_*` (colour-corrected) metrics, reported separately, as PPISP recommends.
  - Report them **per region**: floor and ceiling (lens centres), the **rim band θ 85–105°** (walls, overlap), and masked areas excluded.
  - Geometry-consistency proxies from §5.7.
- **Qualitative fly-through off the trajectory.** Render a path offset +0.5 m in height and 1 m laterally from the flight lanes, and look for floaters, the "mirror world" under wet floors, and zone seams. Off-trajectory quality is what users experience and what PSNR on near-trajectory views hides.

### 6.2 Viewers, formats, compression
- **Formats.**
  - `.ply` (INRIA layout, ~248 B per Gaussian with SH3) is the master: about **0.75 GB for 3 M Gaussians** [CALC].
  - **`.spz`** (Niantic, MIT) is "typically around 10x smaller" than PLY (README).
  - **SOG** (PlayCanvas, WebP-texture-based) and **Streamed SOG** (multi-LOD chunks for large scenes) are written by **`splat-transform`** (MIT). It also reads and writes PLY, compressed PLY, SPZ, SPLAT, KSPLAT and LCC, filters SH bands, decimates and emits a standalone HTML viewer.
  - gsplat's `export_splats` writes `.ply`, `.splat` and `.ply_compressed`. 3DGRUT also exports USD `ParticleField` for Omniverse/Isaac.
- **Viewers.**
  - **SuperSplat** (PlayCanvas, MIT): in-browser inspect, crop, delete floaters, publish.
  - **Spark** (World Labs, MIT): a three.js renderer that reads PLY, compressed PLY and SPZ, convenient for a custom page with mesh and marker overlay.
  - gsplat's `simple_viewer` / viser for development.
- **Compression in training:** gsplat `compression="png"` (Self-Organising Gaussians [Morgenstern2024SOG]: attributes sorted into 2D grids and image-compressed). Drop SH to degree 1–2 for web delivery if specular shimmer is acceptable.
- **Web delivery of the whole lot:** use zones, then Streamed SOG with LOD, hosted as static files. Keep one high-quality zone in plain `.ply` for close inspection.

---
## 7. Method selection

### 7.1 Long list (25)
1. INRIA 3DGS [Kerbl2023]
2. gsplat [Ye2024gsplat]
3. nerfstudio splatfacto
4. 3DGRUT (3DGRT/3DGUT) [MoenneLoccoz2024_3DGRT; Wu2025_3DGUT]
5. nerfacto [Tancik2023]
6. Zip-NeRF [Barron2023]
7. IM360 textured mesh [Jung2025IM360]
8. 2DGS
9. PGSR
10. MILo
11. SuGaR
12. OmniGS
13. ODGS
14. 360-GS
15. Seam360GS
16. PFGS360
17. SC-OmniGS
18. Fisheye-GS
19. DirectFisheye-GS
20. Self-Calibrating GS for large FOV [Deng2025SelfCal]
21. GS on the Move / BAD-Gaussians / Deblurring 3DGS
22. Hierarchical 3DGS
23. Octree-GS / Scaffold-GS
24. CityGaussian
25. Appearance and robustness modules (PPISP, BilaRF, WildGaussians, SpotLessSplats), plus reflection modules (3DGS-DR, EnvGS) and DN-Splatter

### 7.2 Screening (dropped, one line each)
- **INRIA 3DGS**: non-commercial licence, pinhole only. gsplat matches its quality with less memory.
- **splatfacto**: no fisheye or θ > 90° (undistorts to pinhole; pins gsplat 1.4.0). Usable only inside the perspective fallback.
- **Zip-NeRF**: 0.2 fps rendering, hours of training. Not explorable in real time.
- **IM360 textured mesh**: no code found, and less photoreal than splats. Its idea belongs to A3b's mesh texturing.
- **OmniGS / ODGS / 360-GS / SC-OmniGS / PFGS360**: all assume a *central* equirect camera, so the horizon seam error (A1) is baked into the targets. PFGS360's pose-free design discards A3b's metric poses. Kept only as the ERP fallback (Seam360GS row below).
- **Fisheye-GS**: equidistant-only Jacobian, outperformed by 3DGUT on its own benchmark.
- **DirectFisheye-GS**: promising (CVPR 2026), but I could not confirm code availability or behaviour beyond 180°. Watch it.
- **Self-calibrating large-FOV GS**: calibration is A3b's job. Keep as an idea only.
- **CityGaussian**: CC BY-NC-SA, and built for city aerial scale.
- **SuGaR / MILo / PGSR / 2DGS as the primary**: they target meshing, and A3b already owns geometry. Their regularisers survive inside S6.
- **3DGS-DR / EnvGS**: pinhole-oriented, VRAM-heavy, uncertain value for near-field garage reflections. Experimental only.

### 7.3 Short-list deep dives
**S1. gsplat (main) + 3DGUT/FTheta on raw dual fisheye + MCMC + PPISP + masks + A3b init and depth.**
- *Core idea:* render each lens with its true camera via the Unscented Transform, so nothing is resampled and the 90–105° band is kept.
- *Assumptions violated:* 3DGUT assumes the projected footprint stays near-Gaussian, which strains at the rim. FTheta has no tangential terms, so they must be refit.
- *Reported:* 3DGUT +0.96 dB PSNR over Fisheye-GS on ScanNet++ fisheye with about a third of the Gaussians. 3DGUT is comparable to 3DGRT on Waymo rolling-shutter cameras. gsplat matches INRIA quality at 5.7 vs 9.0 GB.
- *Compute:* fits 16 GB at half-resolution with `cap_max` ≈ 3 M (§4).
- *Code:* Apache-2.0, actively developed (`main` reports 1.6.0 with FTheta, PPISP, NCore, batch rendering).
- *Gaps:* FTheta and rolling shutter are reachable natively only via the NCore loader, and RS is not wired into `simple_trainer`. Expect to write a custom dataset class (≈300 lines).
- *Failure modes:* rim floaters (the DirectFisheye-GS observation), FTheta fit error, mirror-world reflections.

**S2. 3DGRUT (3DGUT, optionally 3DGRT) on raw fisheye.**
- *Core idea:* the same UT, plus an optional ray-traced hybrid for secondary rays.
- *Reported:* ScanNet++ fisheye averaging PSNR 29.22 (README, L40); NHT variants on Mip-NeRF 360.
- *Code:* Apache-2.0. MCMC, masks, PPISP, multi-sensor COLMAP, NCore v4, v2.0.0 (June 2026).
- *Risks:* I did not verify that its OpenCV-fisheye UT path renders θ > 90°. It is heavier to install, and 3DGRT wants RT cores.
- *Upside:* a ray-traced reflection path for cars and wet floors on the same particles.

**S3. Perspective re-projection (A3b's RIGOR-style views or a cubemap from each fisheye) + standard gsplat pinhole.**
- *Core idea:* use the most mature path and accept the resampling.
- *Assumptions violated:* resampling adds blur (A1: −10–20% resolution), and views must overlap to cover the rim, so pixels are duplicated.
- *Evidence:* undistorting fisheye cost 3DGS 5–6 dB PSNR in the 3DGUT/Fisheye-GS comparison. That number comes from cropping, not from multi-face cubemaps, but it signals the loss.
- *Compute:* lowest. *Maturity:* highest. This is the safe fallback.

**S4. ERP-native with seam calibration (Seam360GS on OmniGS's rasterizer) using DJI-stitched equirect.**
- *Core idea:* learn the lens gap and angular distortion so stitched ERP renders seamlessly.
- *Reported:* 360Roam PSNR 26.10 vs OmniGS 25.08.
- *Violated:* a fixed per-clip optical-flow seam is not a global rigid gap. ERP oversamples the floor and ceiling.
- *Code:* Seam360GS code not found, and OmniGS is GPL-3.0 C++.

**S5. Blur and RS compensation (GS on the Move / BAD-Gaussians).**
- *Reported:* gains on synthetic Deblur-NeRF-derived scenes and phone video.
- *Code:* Apache-2.0, nerfstudio-based, pinhole only.
- *Fit:* the effects here are only 2–4 px under A1's capture rules. Worth doing only as RS in S1.

**S6. Depth- and normal-regularised GS coupled to A3b (DN-Splatter-style, with mesh depth instead of monocular).**
- *Reported:* DN-Splatter improves depth and mesh metrics on MuSHRoom and ScanNet++, and the normal priors reduce floaters in textureless rooms.
- *Code:* Apache-2.0, gsplat-based.
- *Fit:* high, because textureless concrete is exactly its target. A3b's metric depth is stronger than monocular depth.
- *Risk:* over-smoothing clutter. Reflections conflict with the depth loss, so they need masks.

**S7. Hierarchical 3DGS / Octree-GS for LOD.**
- *Reported:* km-scale scenes rendered in real time. Training peaks at 11–16 GB in the hierarchy stage.
- *Licence:* INRIA non-commercial; pinhole only.
- *Fit:* a lot of a few hundred metres does not need km-scale machinery. Delivery-side LOD (Streamed SOG) covers it.

**S8. nerfacto with native fisheye or equirect rays.**
- *Fit:* the only no-custom-code path for raw fisheye rays. Its equidistant fisheye type lacks DJI's distortion terms.
- *Drawbacks:* not real-time, and exporting to splats or meshes loses quality. A useful sanity baseline only.

### 7.4 Score table (weights: fit ×3, evidence ×2, implementability ×2, quality ×3, maturity ×1; max 55)

| | Fit | Evid. | Impl. | Quality | Mat. | **Total** |
|---|---|---|---|---|---|---|
| **S1 gsplat UT/FTheta raw fisheye** | 5 | 3 | 4 | 5 | 3 | **47** |
| S2 3DGRUT raw fisheye | 4 | 4 | 3 | 5 | 3 | 44 |
| S3 perspective + gsplat pinhole | 3 | 4 | 5 | 3 | 5 | 41 |
| S6 A3b-depth-regularised GS (module) | 4 | 3 | 4 | 4 | 3 | 41 |
| S8 nerfacto fisheye rays | 3 | 4 | 4 | 3 | 4 | 38 |
| S7 Hierarchical / Octree LOD | 3 | 4 | 2 | 3 | 3 | 33 |
| S5 blur/RS (On-the-Move, BAD) | 3 | 4 | 3 | 2 | 3 | 32 |
| S4 Seam360GS / OmniGS on ERP | 2 | 3 | 2 | 3 | 2 | 27 |

**Justifications (one line per score).**
- **S1:**
  - fit 5: native rig, θ > 90°, RS-capable, masks.
  - evidence 3: 3DGUT fisheye results exist, but nothing on more-than-180° dual-fisheye rigs.
  - impl 4: Apache, fits 16 GB, but needs a custom loader.
  - quality 5: no resampling, full rim.
  - maturity 3: FTheta, PPISP and UT are recent additions.
- **S2:**
  - fit 4: same UT, but θ > 90° unverified in the COLMAP path.
  - evidence 4: CVPR paper plus README benchmarks.
  - impl 3: heavier build, RT cores for 3DGRT.
  - quality 5: same as S1.
  - maturity 3: v2.0 is recent.
- **S3:**
  - fit 3: works, but resamples and duplicates the rim.
  - evidence 4: the standard path.
  - impl 5: everything works out of the box.
  - quality 3: resolution loss.
  - maturity 5: most mature.
- **S6:**
  - fit 4: targets textureless indoor scenes.
  - evidence 3: shown with monocular or sensor depth, not mesh depth.
  - impl 4: Apache, simple loss.
  - quality 4: fewer floaters off-trajectory.
  - maturity 3.
- **S8:**
  - fit 3: native rays but a simplified fisheye model.
  - evidence 4: nerfstudio paper.
  - impl 4: easy.
  - quality 3: not real-time.
  - maturity 4.
- **S7:**
  - fit 3: oversized for a few hundred metres.
  - evidence 4: SIGGRAPH results.
  - impl 2: NC licence, pinhole.
  - quality 3.
  - maturity 3.
- **S5:**
  - fit 3: the problem is small here.
  - evidence 4: ECCV 2024.
  - impl 3: nerfstudio pinhole fork.
  - quality 2: small gain at 2–4 px.
  - maturity 3.
- **S4:**
  - fit 2: the seam is baked into stitched input.
  - evidence 3: one ICCV paper on other cameras.
  - impl 2: no code, GPL base.
  - quality 3.
  - maturity 2.

### 7.5 Pick
- **Primary:** **S1 + S6.** gsplat (pin a `main` commit) with FTheta/UT on the two raw fisheye streams, MCMC, PPISP, static plus semantic masks, A3b initialisation, A3b mesh-depth loss, and no world normalisation.
- **Runner-up:** **S3.** A3b's perspective views (or a 6-face cubemap per lens, 2100² each at native ~18 px/deg) with gsplat pinhole, the same PPISP, masks and depth. Use it if the FTheta fit or rim floaters fail.
- **High-upside experimental:** S1 extended with **IMU-driven rolling shutter** (`viewmats_rs` from the high-rate quaternions) and a **learnable rig residual**: a Seam360GS-style per-lens translation and rotation offset, regularised toward A3b's calibration and reported back to A3b as a consistency check, not fed into it. A second experimental branch is 3DGRUT hybrid tracing for reflections.
- **What would change my mind:**
  - If the FTheta fit to DJI's KB-5 + tangential model leaves more than 0.5 px RMS, or rim Gaussians explode, switch to S3.
  - If S3's held-out LPIPS on the rim band is within 0.01 of S1's, the simpler S3 wins.
  - If 3DGRUT is shown to render θ > 90° from COLMAP fisheye and installs cleanly, S2 becomes equal and adds reflections.
  - If DirectFisheye-GS releases code supporting more than 180°, re-evaluate it.

---
## 8. Recommended visualization pipeline (16 GB)

1. **Decode.** Extract both 3840² HEVC Main10 streams from `.OSV` (OpenOSV/ffmpeg) into **16-bit PNG**. Apply a fixed D-Log M→Rec.709 (or linear) LUT. Keep per-frame shutter, gain and timestamps from the metadata.
2. **Select frames.** Keep one rig frame per 0.2–0.3 m: the sharpest frame (Laplacian variance) among those with IMU angular rate below 10°/s. Drop frames with ego-motion spikes.
3. **Masks.**
   - Static airframe mask per lens.
   - Outer 2–3° of each image circle.
   - Semantic transients (people, moving cars) from A3a, dilated.
   - Reflection mask, used only for the depth loss.
4. **Cameras and poses from A3b.** Per-lens intrinsics refit from DJI KB-5 + tangential to **FTheta** (`ANGLE_TO_PIXELDIST`, `max_angle` ≈ 105° from calibration, not wider). Pose T_world_rig · T_rig_lens, in metric units.
5. **Zones.** 30–40 m along aisles with 5 m overlap.
6. **Train each zone with gsplat** (custom dataset class modelled on `examples/datasets/ncore.py`):
   - Rasterizer: `camera_model="ftheta"`, `with_ut=True`, `with_eval3d=True`, `global_z_order=False`, `packed=True`.
   - Strategy: `mcmc` with `cap_max=3_000_000`, `init_type` = A3b cloud (2–3 cm voxel). SH degree 3.
   - Steps: `data_factor=2` (1920² circles), `steps_scaler` so each image is seen about 10×. Roughly 60–100 k steps for 4–6 k images; about 1–2 h per zone *(estimate)*.
   - Appearance: `post_processing="ppisp"` with one sensor per lens and EXIF exposure prior. Freeze the sensor parameters after zone 1.
   - Depth: custom mesh-depth L1 on `RGB+ED`, λ = 0.1, decayed to 0.05 after densification.
   - Poses: `pose_opt=False`. `normalize_world_space=False`. Images streamed, not cached.
   - Optional final 5–10 k steps at `data_factor=1` with `cap_max` unchanged, to recover native 18 px/deg detail. Watch VRAM.
7. **Optional rolling shutter:** pass `rolling_shutter`/`viewmats_rs` computed from the IMU at the first and last row, once A1's readout measurement exists.
8. **Evaluate** with the block and validation-sortie protocol (§6.1): metrics per region, PPISP-controller views, mesh-depth residual and floater fraction, off-trajectory fly-through.
9. **Merge and clean.** Crop each zone to its core, concatenate, and clean floaters in SuperSplat. Export a metric `.ply` master.
10. **Deliver.** `splat-transform` → **Streamed SOG** (LOD) for the web; SPZ for Spark-based custom viewers. Load the A3b mesh, markers and measured distances as overlays.

- **Runner-up (S3):** replace steps 4–6 with perspective views (2100² at 90° FOV per face, matching native resolution). Use `camera_model="pinhole"` and the default or MCMC strategy, and keep everything else.
- **Experimental:** on top of the primary, add step 7, plus learnable per-lens SE(3) residuals (regularised, lr ≈ 1e-5) and a 3DGRUT hybrid-tracing run on one reflective zone for comparison.

---

## 9. Interactive component suggestions (for the HTML report)

1. **2D Gaussian splat toy.** Fit an image with N 2D Gaussians in the browser (WebGL). Show densify, split and prune live, with a toggle between "default ADC" and "MCMC relocate with cap". Teaches what densification does and why a cap bounds VRAM.
2. **EWA vs Unscented Transform on a fisheye.** Drag a 3D Gaussian around a 200° fisheye. Show the true projected footprint (Monte Carlo), the EWA linearised ellipse and the UT ellipse from 7 sigma points, and highlight where the `z ≤ 0` cutoff (OpenCV fisheye) deletes it beyond 90°.
3. **Held-out split visualizer.** A trajectory strip at 25 fps with kept frames, held-out blocks and guard bands. A slider for `test_every` shows how a naive split leaves 1.6 cm neighbours.
4. **PPISP before/after slider.** The same frame raw, then with exposure offset, then vignetting, then colour, then CRF applied step by step, plus the controller's prediction on a novel view.
5. **Overlap-band and seam explorer.** Two up/down lens cones; sliders for baseline b and distance d. Show parallax b/d in px for stitched ERP versus "no seam" with a raw rig.
6. **Budget calculator.** Inputs: N Gaussians, SH degree, image resolution, number of images. Outputs: training VRAM estimate, `.ply`/SPZ/SOG size, image-cache RAM.
7. **Splat vs mesh depth residual overlay.** A held-out view with a heat map of |depth_splat − depth_mesh|, showing floaters in front and mirror-world reflections behind.

---

## Handoff

- **Use gsplat (`main`, Apache-2.0) with `camera_model="ftheta"`, `with_ut=True`, `with_eval3d=True`, `global_z_order=False`** to train on the raw fisheye streams. gsplat's OpenCV `fisheye` model clips at θ = 90°. nerfstudio splatfacto cannot train on fisheye at all (it undistorts; pinned to gsplat 1.4.0).
- **A3b must deliver:** per-lens poses (rig-composed, metric), DJI KB-5 + tangential intrinsics plus a refit to an FTheta polynomial (report RMS), the inter-lens baseline, the dense cloud and mesh in the same frame. Splats are trained with **`normalize_world_space=False`** so they overlay that frame.
- **Rolling shutter** is supported by the rasterizer (`rolling_shutter`, `viewmats_rs`) but not wired into gsplat's trainer. It needs A1's readout time and direction per lens, plus IMU quaternions at frame row 0 and row H.
- **Appearance:** PPISP with one "sensor" per lens and per-frame exposure priors from DJI metadata (shutter and gain written to EXIF). Bilateral grid only if flicker row-banding remains. There is no HDR video mode, and RAW-style training does not apply to H.265.
- **Masks needed (A1/A3a):** static airframe per lens, the outer 2–3° of each circle, dilated semantic transients, and reflection masks (depth loss only).
- **16 GB budget:** about 3 M Gaussians per job at 1920² circles; stream images (8–12 k images will not fit in a RAM cache); train in 30–40 m zones with 5 m overlap.
- **Evaluation:** block hold-out with ±1 s guard bands plus a separate validation sortie. Report metrics without GT colour correction (PPISP controller) and with `cc_*` separately, per region (rim band vs poles), plus a splat-vs-mesh depth residual and floater fraction.
- **Delivery:** metric `.ply` master; `splat-transform` → Streamed SOG (LOD) for the web; SuperSplat for cleanup and annotation; Spark for a custom mesh + splat + marker viewer (all MIT).
- **Licences:** avoid INRIA-derived code (3DGS, Hierarchical 3DGS, Scaffold/Octree-GS, 2DGS, MILo, SuGaR, 3DGS-MCMC original) and PGSR or CityGaussian (non-commercial / NC-SA) in anything shipped. gsplat, 3DGRUT, PPISP, NCore, DN-Splatter, BAD-Gaussians, 3dgs-deblur and SpotLessSplats are Apache-2.0. OmniGS is GPL-3.0.
- **Open items:** whether 3DGRUT's COLMAP fisheye path renders θ > 90°; whether Seam360GS and DirectFisheye-GS code exists; the FTheta fit residual on the actual DJI calibration.

```json
[
  {"key": "Kerbl2023", "title": "3D Gaussian Splatting for Real-Time Radiance Field Rendering", "authors": "Bernhard Kerbl, Georgios Kopanas, Thomas Leimkühler, George Drettakis", "venue": "ACM TOG (SIGGRAPH)", "year": 2023, "url": "https://arxiv.org/abs/2308.04079", "code": "https://github.com/graphdeco-inria/gaussian-splatting", "license": "Gaussian-Splatting License (Inria/MPII, research/non-commercial)", "type": "paper", "verified": true},
  {"key": "Ye2024gsplat", "title": "gsplat: An Open-Source Library for Gaussian Splatting", "authors": "Vickie Ye, Ruilong Li, Justin Kerr, Matias Turkulainen, Brent Yi, Zhuoyang Pan, Otto Seiskari, Jianbo Ye, Jeffrey Hu, Matthew Tancik, Angjoo Kanazawa", "venue": "JMLR MLOSS", "year": 2024, "url": "https://arxiv.org/abs/2409.06765", "code": "https://github.com/nerfstudio-project/gsplat", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "gsplatSource", "title": "gsplat main branch source: rendering.py (camera_model ftheta, with_ut, rolling_shutter, global_z_order), cuda/include/Cameras.cuh, examples/simple_trainer.py, examples/datasets/{colmap,ncore}.py, version 1.6.0; releases page (v1.5.3)", "authors": "nerfstudio team and contributors", "venue": "GitHub source", "year": 2026, "url": "https://github.com/nerfstudio-project/gsplat", "code": "https://github.com/nerfstudio-project/gsplat", "license": "Apache-2.0", "type": "repo", "verified": true},
  {"key": "gsplatDocs", "title": "gsplat documentation: evaluation (Mip-NeRF 360 memory/PSNR), large-scale rendering, NCore training with FTheta", "authors": "nerfstudio team", "venue": "docs.gsplat.studio", "year": 2026, "url": "https://docs.gsplat.studio/main/", "code": null, "license": null, "type": "docs", "verified": true},
  {"key": "Tancik2023", "title": "Nerfstudio: A Modular Framework for Neural Radiance Field Development", "authors": "Matthew Tancik, Ethan Weber, Evonne Ng, Ruilong Li, Brent Yi, Terrance Wang, Alexander Kristoffersen, Jake Austin, Kamyar Salahi, Abhik Ahuja, David McAllister, Justin Kerr, Angjoo Kanazawa", "venue": "SIGGRAPH 2023 Conference Proceedings [venue UNVERIFIED in session]", "year": 2023, "url": "https://arxiv.org/abs/2302.04264", "code": "https://github.com/nerfstudio-project/nerfstudio", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "NerfstudioDocs", "title": "Nerfstudio docs: Splatfacto FAQ (no fisheye/equirect rendering), data conventions; source: splatfacto.py, full_images_datamanager.py, cameras.py, pyproject (gsplat==1.4.0)", "authors": "nerfstudio team", "venue": "docs.nerf.studio / GitHub", "year": 2026, "url": "https://docs.nerf.studio/nerfology/methods/splat.html", "code": "https://github.com/nerfstudio-project/nerfstudio", "license": "Apache-2.0", "type": "docs", "verified": true},
  {"key": "Wu2025_3DGUT", "title": "3DGUT: Enabling Distorted Cameras and Secondary Rays in Gaussian Splatting", "authors": "Qi Wu, Janick Martinez Esturo, Ashkan Mirzaei, Nicolas Moenne-Loccoz, Zan Gojcic", "venue": "CVPR 2025", "year": 2025, "url": "https://arxiv.org/abs/2412.12507", "code": "https://github.com/nv-tlabs/3dgrut", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "MoenneLoccoz2024_3DGRT", "title": "3D Gaussian Ray Tracing: Fast Tracing of Particle Scenes", "authors": "Nicolas Moenne-Loccoz, Ashkan Mirzaei, Or Perel, Riccardo de Lutio, Janick Martinez Esturo, Gavriel State, Sanja Fidler, Nicholas Sharp, Zan Gojcic", "venue": "SIGGRAPH Asia 2024 (TOG)", "year": 2024, "url": "https://arxiv.org/abs/2407.07090", "code": "https://github.com/nv-tlabs/3dgrut", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "3DGRUTRepo", "title": "3DGRUT repository README and threedgrut/datasets/dataset_colmap.py (OPENCV_FISHEYE support, PPISP, MCMC, masks, NCore v4, v2.0.0)", "authors": "NVIDIA (nv-tlabs)", "venue": "GitHub", "year": 2026, "url": "https://github.com/nv-tlabs/3dgrut", "code": "https://github.com/nv-tlabs/3dgrut", "license": "Apache-2.0", "type": "repo", "verified": true},
  {"key": "NCore", "title": "NVIDIA NCore: multi-sensor data platform (camera models incl. FTheta, start/end frame poses)", "authors": "NVIDIA", "venue": "GitHub", "year": 2026, "url": "https://github.com/NVIDIA/ncore", "code": "https://github.com/NVIDIA/ncore", "license": "Apache-2.0", "type": "repo", "verified": true},
  {"key": "Deutsch2026", "title": "PPISP: Physically-Plausible Compensation and Control of Photometric Variations in Radiance Field Reconstruction", "authors": "Isaac Deutsch, Nicolas Moënne-Loccoz, Gavriel State, Zan Gojcic", "venue": "CVPR 2026", "year": 2026, "url": "https://arxiv.org/abs/2601.18336", "code": "https://github.com/nv-tlabs/ppisp", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "Wang2024BilaRF", "title": "Bilateral Guided Radiance Field Processing", "authors": "Yuehao Wang, Chaoyi Wang, Bingchen Gong, Tianfan Xue", "venue": "ACM TOG (SIGGRAPH 2024)", "year": 2024, "url": "https://arxiv.org/abs/2406.00448", "code": "https://github.com/yuehaowang/bilarf", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "Kulhanek2024WildGaussians", "title": "WildGaussians: 3D Gaussian Splatting in the Wild", "authors": "Jonas Kulhanek, Songyou Peng, Zuzana Kukelova, Marc Pollefeys, Torsten Sattler", "venue": "NeurIPS 2024", "year": 2024, "url": "https://arxiv.org/abs/2407.08447", "code": "https://github.com/jkulhanek/wild-gaussians", "license": "MIT", "type": "paper", "verified": true},
  {"key": "Xu2024SplatfactoW", "title": "Splatfacto-W: A Nerfstudio Implementation of Gaussian Splatting for Unconstrained Photo Collections", "authors": "Congrong Xu, Justin Kerr, Angjoo Kanazawa", "venue": "arXiv", "year": 2024, "url": "https://arxiv.org/abs/2407.12306", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Mildenhall2022RawNeRF", "title": "NeRF in the Dark: High Dynamic Range View Synthesis from Noisy Raw Images", "authors": "Ben Mildenhall, Peter Hedman, Ricardo Martin-Brualla, Pratul Srinivasan, Jonathan T. Barron", "venue": "CVPR 2022 [venue UNVERIFIED in session]", "year": 2022, "url": "https://arxiv.org/abs/2111.13679", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Jin2024LE3D", "title": "Lighting Every Darkness with 3DGS: Fast Training and Real-Time Rendering for HDR View Synthesis", "authors": "Xin Jin, Pengyi Jiao, Zheng-Peng Duan, Xingchao Yang, Chun-Le Guo, Bo Ren, Chongyi Li", "venue": "arXiv [venue UNVERIFIED]", "year": 2024, "url": "https://arxiv.org/abs/2406.06216", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Zhao2024BAD", "title": "BAD-Gaussians: Bundle Adjusted Deblur Gaussian Splatting", "authors": "Lingzhe Zhao, Peng Wang, Peidong Liu", "venue": "ECCV 2024", "year": 2024, "url": "https://arxiv.org/abs/2403.11831", "code": "https://github.com/WU-CVGL/BAD-Gaussians", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "Lee2024Deblur3DGS", "title": "Deblurring 3D Gaussian Splatting", "authors": "Byeonghyeon Lee, Howoong Lee, Xiangyu Sun, Usman Ali, Eunbyung Park", "venue": "ECCV 2024", "year": 2024, "url": "https://arxiv.org/abs/2401.00834", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Seiskari2024OnTheMove", "title": "Gaussian Splatting on the Move: Blur and Rolling Shutter Compensation for Natural Camera Motion", "authors": "Otto Seiskari, Jerry Ylilammi, Valtteri Kaatrasalo, Pekka Rantalankila, Matias Turkulainen, Juho Kannala, Esa Rahtu, Arno Solin", "venue": "ECCV 2024", "year": 2024, "url": "https://arxiv.org/abs/2403.13327", "code": "https://github.com/SpectacularAI/3dgs-deblur", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "Ye2024DR", "title": "3D Gaussian Splatting with Deferred Reflection", "authors": "Keyang Ye, Qiming Hou, Kun Zhou", "venue": "arXiv (SIGGRAPH 2024 [UNVERIFIED])", "year": 2024, "url": "https://arxiv.org/abs/2404.18454", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Xie2024EnvGS", "title": "EnvGS: Modeling View-Dependent Appearance with Environment Gaussian", "authors": "Tao Xie, Xi Chen, Zhen Xu, Yiman Xie, Yudong Jin, Yujun Shen, Sida Peng, Hujun Bao, Xiaowei Zhou", "venue": "arXiv (CVPR 2025 [UNVERIFIED])", "year": 2024, "url": "https://arxiv.org/abs/2412.15215", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Sabour2025SpotLess", "title": "SpotlessSplats: Ignoring Distractors in 3D Gaussian Splatting", "authors": "Sara Sabour, Lily Goli, George Kopanas, Mark Matthews, Dmitry Lagun, Leonidas Guibas, Alec Jacobson, David J. Fleet, Andrea Tagliasacchi", "venue": "ACM TOG", "year": 2025, "url": "https://arxiv.org/abs/2406.20055", "code": "https://github.com/lilygoli/SpotLessSplats", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "Barron2023", "title": "Zip-NeRF: Anti-Aliased Grid-Based Neural Radiance Fields", "authors": "Jonathan T. Barron, Ben Mildenhall, Dor Verbin, Pratul P. Srinivasan, Peter Hedman", "venue": "ICCV 2023 [venue UNVERIFIED in session]", "year": 2023, "url": "https://arxiv.org/abs/2304.06706", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Jung2025IM360", "title": "IM360: Large-scale Indoor Mapping with 360 Cameras", "authors": "Dongki Jung, Jaehoon Choi, Yonghan Lee, Dinesh Manocha", "venue": "ICCV 2025", "year": 2025, "url": "https://arxiv.org/abs/2502.12545", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Li2025OmniGS", "title": "OmniGS: Fast Radiance Field Reconstruction using Omnidirectional Gaussian Splatting", "authors": "Longwei Li, Huajian Huang, Sai-Kit Yeung, Hui Cheng", "venue": "WACV 2025", "year": 2025, "url": "https://arxiv.org/abs/2404.03202", "code": "https://github.com/liquorleaf/OmniGS", "license": "GPL-3.0", "type": "paper", "verified": true},
  {"key": "Lee2024ODGS", "title": "ODGS: 3D Scene Reconstruction from Omnidirectional Images with 3D Gaussian Splattings", "authors": "Suyoung Lee, Jaeyoung Chung, Jaeyoo Huh, Kyoung Mu Lee", "venue": "NeurIPS 2024", "year": 2024, "url": "https://arxiv.org/abs/2410.20686", "code": "https://github.com/esw0116/ODGS", "license": "MIT", "type": "paper", "verified": true},
  {"key": "Bai2024_360GS", "title": "360-GS: Layout-guided Panoramic Gaussian Splatting For Indoor Roaming", "authors": "Jiayang Bai, Letian Huang, Jie Guo, Wen Gong, Yuanqi Li, Yanwen Guo", "venue": "arXiv", "year": 2024, "url": "https://arxiv.org/abs/2402.00763", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Shin2025Seam360GS", "title": "Seam360GS: Seamless 360° Gaussian Splatting from Real-World Omnidirectional Images", "authors": "Changha Shin, Woong Oh Cho, Seon Joo Kim", "venue": "ICCV 2025", "year": 2025, "url": "https://arxiv.org/abs/2508.20080", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Zhuang2026PFGS360", "title": "Pose-Free Omnidirectional Gaussian Splatting for 360-Degree Videos with Consistent Depth Priors", "authors": "Chuanqing Zhuang, Xin Lu, Zehui Deng, Zhengda Lu, Yiqun Wang, Junqi Diao, Jun Xiao", "venue": "CVPR 2026 (per repository README)", "year": 2026, "url": "https://arxiv.org/abs/2603.23324", "code": "https://github.com/zcq15/PFGS360", "license": null, "type": "paper", "verified": true},
  {"key": "Huang2025SCOmniGS", "title": "SC-OmniGS: Self-Calibrating Omnidirectional Gaussian Splatting", "authors": "Huajian Huang, Yingshu Chen, Longwei Li, Hui Cheng, Tristan Braud, Yajie Zhao, Sai-Kit Yeung", "venue": "ICLR 2025", "year": 2025, "url": "https://arxiv.org/abs/2502.04734", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Liao2024FisheyeGS", "title": "Fisheye-GS: Lightweight and Extensible Gaussian Splatting Module for Fisheye Cameras", "authors": "Zimu Liao, Siyan Chen, Rong Fu, Yi Wang, Zhongling Su, Hao Luo, Li Ma, Linning Xu, Bo Dai, Hengjie Li, Zhilin Pei, Xingcheng Zhang", "venue": "arXiv [venue UNVERIFIED]", "year": 2024, "url": "https://arxiv.org/abs/2409.04751", "code": "https://github.com/zmliao/Fisheye-GS", "license": null, "type": "paper", "verified": true},
  {"key": "Yang2026DirectFisheye", "title": "DirectFisheye-GS: Enabling Native Fisheye Input in Gaussian Splatting with Cross-View Joint Optimization", "authors": "Zhengxian Yang, Fei Xie, Xutao Xue, Rui Zhang, Taicheng Huang, Yang Liu, Mengqi Ji, Tao Yu", "venue": "CVPR 2026 (Highlight, per arXiv comment)", "year": 2026, "url": "https://arxiv.org/abs/2604.00648", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Deng2025SelfCal", "title": "Self-Calibrating Gaussian Splatting for Large Field of View Reconstruction", "authors": "Youming Deng, Wenqi Xian, Guandao Yang, Leonidas Guibas, Gordon Wetzstein, Steve Marschner, Paul Debevec", "venue": "arXiv [venue UNVERIFIED]", "year": 2025, "url": "https://arxiv.org/abs/2502.09563", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Kerbl2024H3DGS", "title": "A Hierarchical 3D Gaussian Representation for Real-Time Rendering of Very Large Datasets", "authors": "Bernhard Kerbl, Andréas Meuleman, Georgios Kopanas, Michael Wimmer, Alexandre Lanvin, George Drettakis", "venue": "ACM TOG (SIGGRAPH 2024) [venue UNVERIFIED in session]", "year": 2024, "url": "https://arxiv.org/abs/2406.12080", "code": "https://github.com/graphdeco-inria/hierarchical-3d-gaussians", "license": "Inria research/non-commercial", "type": "paper", "verified": true},
  {"key": "Ren2025OctreeGS", "title": "Octree-GS: Towards Consistent Real-time Rendering with LOD-Structured 3D Gaussians", "authors": "Kerui Ren, Lihan Jiang, Tao Lu, Mulin Yu, Linning Xu, Zhangkai Ni, Bo Dai", "venue": "TPAMI 2025 (per README)", "year": 2025, "url": "https://arxiv.org/abs/2403.17898", "code": "https://github.com/city-super/Octree-GS", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "Lu2024Scaffold", "title": "Scaffold-GS: Structured 3D Gaussians for View-Adaptive Rendering", "authors": "Tao Lu, Mulin Yu, Linning Xu, Yuanbo Xiangli, Limin Wang, Dahua Lin, Bo Dai", "venue": "CVPR 2024", "year": 2024, "url": "https://arxiv.org/abs/2312.00109", "code": "https://github.com/city-super/Scaffold-GS", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "Liu2024CityGaussian", "title": "CityGaussian: Real-time High-quality Large-Scale Scene Rendering with Gaussians", "authors": "Yang Liu, He Guan, Chuanchen Luo, Lue Fan, Naiyan Wang, Junran Peng, Zhaoxiang Zhang", "venue": "ECCV 2024", "year": 2024, "url": "https://arxiv.org/abs/2404.01133", "code": "https://github.com/Linketic/CityGaussian", "license": "CC BY-NC-SA 4.0", "type": "paper", "verified": true},
  {"key": "Kheradmand2024MCMC", "title": "3D Gaussian Splatting as Markov Chain Monte Carlo", "authors": "Shakiba Kheradmand, Daniel Rebain, Gopal Sharma, Weiwei Sun, Jeff Tseng, Hossam Isack, Abhishek Kar, Andrea Tagliasacchi, Kwang Moo Yi", "venue": "NeurIPS 2024", "year": 2024, "url": "https://arxiv.org/abs/2404.09591", "code": "https://github.com/ubc-vision/3dgs-mcmc", "license": "Gaussian-Splatting License (non-commercial); gsplat reimplementation Apache-2.0", "type": "paper", "verified": true},
  {"key": "Ye2024AbsGS", "title": "AbsGS: Recovering Fine Details for 3D Gaussian Splatting", "authors": "Zongxin Ye, Wenyu Li, Sidun Liu, Peng Qiao, Yong Dou", "venue": "arXiv (ACM MM 2024 [UNVERIFIED])", "year": 2024, "url": "https://arxiv.org/abs/2404.10484", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Mallick2024Taming", "title": "Taming 3DGS: High-Quality Radiance Fields with Limited Resources", "authors": "Saswat Subhajyoti Mallick, Rahul Goel, Bernhard Kerbl, Francisco Vicente Carrasco, Markus Steinberger, Fernando De La Torre", "venue": "arXiv (SIGGRAPH Asia 2024 [UNVERIFIED])", "year": 2024, "url": "https://arxiv.org/abs/2406.15643", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "Turkulainen2025DNSplatter", "title": "DN-Splatter: Depth and Normal Priors for Gaussian Splatting and Meshing", "authors": "Matias Turkulainen, Xuqian Ren, Iaroslav Melekhov, Otto Seiskari, Esa Rahtu, Juho Kannala", "venue": "WACV 2025", "year": 2025, "url": "https://arxiv.org/abs/2403.17822", "code": "https://github.com/maturk/dn-splatter", "license": "Apache-2.0", "type": "paper", "verified": true},
  {"key": "Huang2024_2DGS", "title": "2D Gaussian Splatting for Geometrically Accurate Radiance Fields", "authors": "Binbin Huang, Zehao Yu, Anpei Chen, Andreas Geiger, Shenghua Gao", "venue": "SIGGRAPH 2024", "year": 2024, "url": "https://arxiv.org/abs/2403.17888", "code": "https://github.com/hbb1/2d-gaussian-splatting", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "Chen2024PGSR", "title": "PGSR: Planar-based Gaussian Splatting for Efficient and High-Fidelity Surface Reconstruction", "authors": "Danpeng Chen, Hai Li, Weicai Ye, Yifan Wang, Weijian Xie, Shangjin Zhai, Nan Wang, Haomin Liu, Hujun Bao, Guofeng Zhang", "venue": "arXiv (TVCG [UNVERIFIED])", "year": 2024, "url": "https://arxiv.org/abs/2406.06521", "code": "https://github.com/zju3dv/PGSR", "license": "Custom: educational/research/non-profit only", "type": "paper", "verified": true},
  {"key": "Guedon2024SuGaR", "title": "SuGaR: Surface-Aligned Gaussian Splatting for Efficient 3D Mesh Reconstruction and High-Quality Mesh Rendering", "authors": "Antoine Guédon, Vincent Lepetit", "venue": "CVPR 2024", "year": 2024, "url": "https://arxiv.org/abs/2311.12775", "code": "https://github.com/Anttwo/SuGaR", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "Guedon2025MILo", "title": "MILo: Mesh-In-the-Loop Gaussian Splatting for Detailed and Efficient Surface Reconstruction", "authors": "Antoine Guédon, Diego Gomez, Nissim Maruani, Bingchen Gong, George Drettakis, Maks Ovsjanikov", "venue": "ACM TOG (SIGGRAPH Asia 2025, per README)", "year": 2025, "url": "https://arxiv.org/abs/2506.24096", "code": "https://github.com/Anttwo/MILo", "license": "Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true},
  {"key": "Morgenstern2024SOG", "title": "Compact 3D Scene Representation via Self-Organizing Gaussian Grids", "authors": "Wieland Morgenstern, Florian Barthel, Anna Hilsmann, Peter Eisert", "venue": "arXiv [venue UNVERIFIED]", "year": 2023, "url": "https://arxiv.org/abs/2312.13299", "code": null, "license": null, "type": "paper", "verified": true},
  {"key": "SuperSplat", "title": "SuperSplat Editor", "authors": "PlayCanvas Ltd.", "venue": "GitHub", "year": 2026, "url": "https://github.com/playcanvas/supersplat", "code": "https://github.com/playcanvas/supersplat", "license": "MIT", "type": "repo", "verified": true},
  {"key": "SplatTransform", "title": "splat-transform (PLY/SOG/Streamed SOG LOD/SPZ conversion)", "authors": "PlayCanvas Ltd.", "venue": "GitHub", "year": 2026, "url": "https://github.com/playcanvas/splat-transform", "code": "https://github.com/playcanvas/splat-transform", "license": "MIT", "type": "repo", "verified": true},
  {"key": "SPZ", "title": "spz: compressed 3D Gaussian splat format", "authors": "Niantic Labs", "venue": "GitHub", "year": 2024, "url": "https://github.com/nianticlabs/spz", "code": "https://github.com/nianticlabs/spz", "license": "MIT", "type": "repo", "verified": true},
  {"key": "Spark", "title": "Spark: 3D Gaussian Splatting renderer for THREE.js", "authors": "World Labs Technologies", "venue": "GitHub", "year": 2025, "url": "https://github.com/sparkjsdev/spark", "code": "https://github.com/sparkjsdev/spark", "license": "MIT", "type": "repo", "verified": true},
  {"key": "A1Device", "title": "A1: The DJI Avata 360 as a measurement instrument (project-internal)", "authors": "Agent A1", "venue": "research/A1_device.md", "year": 2026, "url": null, "code": null, "license": null, "type": "secondary", "verified": true}
]
```
