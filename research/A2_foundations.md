# A2 — Foundations: from pinhole cameras to Gaussian splats

*Learning chapter for the Avata 360 underground-parking reconstruction project. Audience: a strong ML engineer who knows PyTorch and optimization but is new to photogrammetry and 3D Gaussian Splatting (3DGS).*

**How to read this chapter.** Sections 1–5 build the mental model stage by stage, in the same order as the pipeline: camera geometry → sparse reconstruction (SfM/SLAM) → dense geometry → neural and splat-based representations → the 360° special case. Each subsection pairs intuition with the minimum math needed to read papers, and ends with a short *"Why it matters here"* note tying it to the scenario (underground, repetitive, dim, no GNSS, 360°, accuracy-first, 16 GB GPU). Section 6 is a four-week learning path, Section 7 a glossary for tooltips, then widget suggestions, the handoff, and the source list.

**Verification note.** For most of this session the network allowed only GitHub-hosted content plus a web-search index; arXiv, CVF and Semantic Scholar became reachable near the end. Paper metadata (authors, venue, year) and licences were checked against the **official repositories' READMEs, BibTeX blocks and LICENSE files**, the COLMAP `CHANGELOG.rst` and `doc/rigs.rst` / `doc/cameras.rst`, and, where reachable, arXiv abstract pages, CVF open-access records and Semantic Scholar metadata. Each JSON entry's `note` field says how it was checked. Classic textbook facts (pinhole model, epipolar constraint, Levenberg–Marquardt) are standard material; their canonical sources are cited but, where marked, were not re-opened in this session.

---

## 1. Core vocabulary and geometry

### 1.1 The pinhole camera, homogeneous coordinates, intrinsics and extrinsics

**Intuition.** A camera is a function that maps 3D points to 2D pixels. The pinhole model says every ray passes through one point (the *centre of projection*), and the image is where those rays hit a plane at distance $f$ (the *focal length*). Everything else in this chapter (SfM, bundle adjustment, NeRF ray marching, Gaussian splat projection) is built on this one function and its inverse.

**Homogeneous coordinates.** We append a 1 to a point: $\tilde{\mathbf{x}} = (u, v, 1)^\top$ for a pixel, $\tilde{\mathbf{X}} = (X, Y, Z, 1)^\top$ for a 3D point. Two homogeneous vectors that differ only by a non-zero scale represent the same point: $(u,v,1) \sim (2u, 2v, 2)$. This makes perspective division (dividing by depth) a linear operation followed by one normalisation, and it lets translations be written as matrix multiplications. Points at infinity (directions, vanishing points) get last coordinate 0.

**The projection equation.**
$$\lambda \,\tilde{\mathbf{x}} = \mathbf{K}\,[\mathbf{R}\mid\mathbf{t}]\,\tilde{\mathbf{X}}, \qquad \mathbf{K} = \begin{pmatrix} f_x & s & c_x\\ 0 & f_y & c_y \\ 0&0&1\end{pmatrix}$$

- $\mathbf{R}\in SO(3)$, $\mathbf{t}\in\mathbb{R}^3$ are the **extrinsics**: they transform world coordinates into the camera frame ($\mathbf{X}_c = \mathbf{R}\mathbf{X}_w + \mathbf{t}$). The camera centre in world coordinates is $\mathbf{C} = -\mathbf{R}^\top\mathbf{t}$. COLMAP stores this "world-to-camera" convention; many graphics codebases (NeRF/3DGS loaders) use camera-to-world. Mixing them up is the single most common bug when moving poses between tools.
- $\mathbf{K}$ holds the **intrinsics**: focal lengths in pixels ($f_x, f_y$), principal point ($c_x, c_y$), skew $s$ (≈0 for modern sensors).
- $\lambda$ is the depth $Z_c$; dividing by it is the perspective division.
- $\mathbf{P} = \mathbf{K}[\mathbf{R}\mid\mathbf{t}]$ is the $3\times4$ **camera (projection) matrix**, 11 degrees of freedom.

**Back-projection.** The inverse is not a point but a ray: pixel $\mathbf{x}$ maps to the set $\{\mathbf{C} + d\,\mathbf{R}^\top\mathbf{K}^{-1}\tilde{\mathbf{x}} : d>0\}$. Depth is lost. Recovering it requires a second view (triangulation), a sensor (LiDAR), or a learned prior (monocular depth). NeRF and 3DGS renderers start from exactly this ray. [HZ2004] [Szeliski2022]

*Why it matters here.* Accuracy at the cm level requires intrinsics that are right to a fraction of a pixel. A focal-length error rescales depth along every ray, which shows up as global scale or "bending" error that reprojection error cannot always reveal.

### 1.2 Distortion, fisheye and spherical cameras

Real lenses bend rays. **Radial distortion** (barrel/pincushion) is modelled as a polynomial in the normalised radius $r$: $\mathbf{x}_d = \mathbf{x}(1 + k_1 r^2 + k_2 r^4 + \dots)$, plus **tangential** terms $p_1,p_2$ for decentred lenses (the Brown–Conrady model, COLMAP's `OPENCV`). This works up to roughly 100–120° field of view.

**Fisheye** lenses (the Avata 360's are ~200° each) cannot be described as a distorted pinhole, because points at 90° or more off-axis would project to infinity. Fisheye models instead map the **angle** $\theta$ between the ray and the optical axis to an image radius: equidistant $r = f\theta$, equisolid, stereographic, or a polynomial $r = f(\theta + k_1\theta^3 + \dots)$ (Kannala–Brandt, COLMAP's `OPENCV_FISHEYE`). Unified/omnidirectional models (UCM, EUCM, double-sphere) project onto a unit sphere first and then onto a plane from a shifted centre. COLMAP lists `SIMPLE_RADIAL_FISHEYE`, `RADIAL_FISHEYE`, `OPENCV_FISHEYE`, `FOV`, `THIN_PRISM_FISHEYE` and `RAD_TAN_THIN_PRISM_FISHEYE` in its camera documentation, and its 4.1.0 release added EUCM and spherical (equirectangular) models [COLMAP-changelog] [COLMAP-cameras].

**Spherical (equirectangular) cameras.** A 360° camera is most naturally a *bearing-vector* sensor: each pixel is a unit vector $\mathbf{b}\in S^2$. The equirectangular image stores the longitude $\phi\in[-\pi,\pi)$ along $u$ and the latitude $\theta\in[-\pi/2,\pi/2]$ along $v$:
$$u = \tfrac{W}{2\pi}(\phi + \pi), \quad v = \tfrac{H}{\pi}(\tfrac{\pi}{2} - \theta), \qquad \mathbf{b} = (\cos\theta\sin\phi,\; -\sin\theta,\; \cos\theta\cos\phi)$$
(axis conventions vary by tool; always check). There is no focal length or principal point in the usual sense, and no single image plane, so plane-based tricks (homographies, rectification) must be redone on the sphere.

*Why it matters here.* DJI's standard 360° export is an equirectangular image **stitched** from two fisheyes (the `.OSV` file also holds the raw fisheyes, see Ch. 1). Stitching assumes all scene points are far away (or at one chosen depth). In a parking garage, pillars and cars are 1–5 m away, so the two lenses' small, unpublished baseline (Ch. 1 estimates ~2–4 cm [UNVERIFIED]) produces **parallax at the stitch seam**: the equirectangular image is *not* a perfect central projection there. §5 returns to this.

### 1.3 Epipolar geometry: essential and fundamental matrices

**Intuition.** If a 3D point is seen in image 1 at $\mathbf{x}_1$, its match in image 2 must lie on a line (the *epipolar line*): the image of the back-projected ray from view 1. This collapses a 2D search to 1D and gives a test for whether a match is geometrically plausible.

For calibrated cameras, with normalised coordinates $\hat{\mathbf{x}} = \mathbf{K}^{-1}\tilde{\mathbf{x}}$ and relative pose $(\mathbf{R},\mathbf{t})$ from view 1 to view 2:
$$\hat{\mathbf{x}}_2^\top \mathbf{E}\,\hat{\mathbf{x}}_1 = 0, \qquad \mathbf{E} = [\mathbf{t}]_\times \mathbf{R}$$
$\mathbf{E}$ is the **essential matrix** (5 DoF: 3 rotation + 2 for the direction of $\mathbf{t}$, because the length of $\mathbf{t}$ cancels). It is estimated from 5 correspondences [Nister2004]. For uncalibrated pixels, $\mathbf{F} = \mathbf{K}_2^{-\top}\mathbf{E}\mathbf{K}_1^{-1}$ is the **fundamental matrix** (7 DoF; 7- or 8-point algorithm). Note that **the scale of $\mathbf{t}$ is unobservable from two images**, which is the first appearance of the scale ambiguity (§1.6).

Degenerate cases matter in practice: pure rotation (no baseline) makes $\mathbf{E}$ undefined, and a dominant plane (floor!) makes $\mathbf{F}$ ambiguous, in which case a homography explains the matches better. COLMAP checks for both during initialisation [Schoenberger2016SfM].

**On the sphere** the constraint is the same with bearing vectors: $\mathbf{b}_2^\top \mathbf{E}\,\mathbf{b}_1 = 0$. The "epipolar line" becomes an **epipolar great circle**, and the epipoles are two antipodal points that are both inside the 360° image. (§5.2.)

### 1.4 Triangulation, PnP and RANSAC

**Triangulation** intersects two or more back-projected rays to get a 3D point. Because noisy rays never meet exactly, we solve a least-squares problem. The linear (DLT) method stacks $\mathbf{x}_i \times (\mathbf{P}_i\tilde{\mathbf{X}}) = 0$ and takes the SVD null vector; the "gold standard" minimises reprojection error. Uncertainty depends on the **triangulation angle**: depth error grows roughly as $\sigma_Z \approx Z^2\sigma_{px}/(f\,B)$ for baseline $B$. Small baselines (a drone moving slowly towards a wall) produce elongated uncertainty ellipsoids along the viewing ray.

**PnP (Perspective-n-Point)** is the reverse: given known 3D points and their 2D projections, find the camera pose. P3P needs 3 points (up to 4 solutions); EPnP and others handle $n\geq4$ efficiently [Lepetit2009]. Incremental SfM uses PnP to *register* each new image against the existing map.

**RANSAC** [Fischler1981] makes these estimators robust to wrong matches: repeatedly sample a minimal set (5 points for $\mathbf{E}$, 3 for P3P), fit a model, count inliers within a threshold, keep the best. The number of iterations needed for confidence $p$ with inlier ratio $w$ and sample size $s$ is $N = \log(1-p)/\log(1-w^s)$; this is why minimal solvers with small $s$ matter. Modern variants (LO-RANSAC, MAGSAC++, GC-RANSAC) refine the model locally or soften the threshold.

*Why it matters here.* RANSAC rejects *random* outliers. It does **not** reject *consistent* wrong matches, e.g. pillar P3 matched to the identical-looking pillar P7 across many features. Such matches form their own geometrically consistent inlier set. This is the mechanism behind false loop closures in repetitive scenes.

### 1.5 Bundle adjustment

**The cost function.** Bundle adjustment (BA) jointly refines all camera parameters $\{\mathbf{K}_i,\mathbf{R}_i,\mathbf{t}_i\}$ and 3D points $\{\mathbf{X}_j\}$ to minimise reprojection error:
$$\min_{\{\mathbf{P}_i\},\{\mathbf{X}_j\}} \sum_{(i,j)\in\mathcal{O}} \rho\!\left(\big\|\pi(\mathbf{P}_i,\mathbf{X}_j) - \mathbf{x}_{ij}\big\|^2_{\Sigma_{ij}}\right)$$
where $\pi$ is the full projection (including distortion), $\mathcal{O}$ the set of observations, $\Sigma_{ij}$ the measurement covariance, and $\rho$ a robust loss (Huber, Cauchy) that down-weights outliers. "Bundle" refers to the bundle of rays through each camera centre. The classic reference is Triggs et al.'s survey [Triggs2000].

**Levenberg–Marquardt (LM).** Linearise residuals $\mathbf{r}(\boldsymbol{\theta}+\boldsymbol{\delta}) \approx \mathbf{r} + \mathbf{J}\boldsymbol{\delta}$ and solve
$$(\mathbf{J}^\top\mathbf{J} + \mu\,\mathbf{D})\,\boldsymbol{\delta} = -\mathbf{J}^\top\mathbf{r}.$$
Small $\mu$ ≈ Gauss–Newton (fast near the optimum); large $\mu$ ≈ gradient descent (safe far away). $\mu$ is adapted per step depending on whether the cost decreased. For ML readers: this is a second-order trust-region method on a sum of squares, not SGD. It converges in tens of iterations, but only to the *local* minimum near the initialisation, which is why SfM spends so much effort on good initial poses.

**Sparsity and the Schur complement.** Each residual depends on one camera and one point, so $\mathbf{J}^\top\mathbf{J}$ has a block "arrowhead" structure: a large block-diagonal point block $\mathbf{V}$, a smaller camera block $\mathbf{U}$, and off-diagonal blocks $\mathbf{W}$. Eliminating points gives the **reduced camera system** $(\mathbf{U} - \mathbf{W}\mathbf{V}^{-1}\mathbf{W}^\top)\boldsymbol{\delta}_c = \dots$, whose size is set by the number of cameras, not points. Ceres Solver (used by COLMAP) exploits this; COLMAP 4.1.0 also added a GPU BA backend, Caspar, which its changelog says is often 1–2 orders of magnitude faster than the Ceres CUDA backend on medium-to-large problems [COLMAP-changelog].

**Gauge freedom.** Reprojection error is unchanged if you apply any similarity transform $\mathbf{S}\in\mathrm{Sim}(3)$ (rotation, translation, uniform scale: 7 DoF) to all cameras and points together. The normal equations are therefore rank-deficient by 7. Solvers fix the gauge by holding one camera fixed and the scale (e.g. one baseline) fixed, or by damping. Practically: *BA alone can never tell you where the origin is, which way is up, or how big anything is.* Those come from external information (GCPs, IMU gravity, known distances).

### 1.6 The scale ambiguity of monocular reconstruction, and Sim(3) alignment

Multiply every 3D point and every camera translation by $s>0$: all projections are unchanged. A single moving camera therefore reconstructs the scene **up to an unknown global scale**, and in long sequences, scale can also **drift** (different parts of the trajectory end up at slightly different scales) unless loops are closed or constraints added. Visual-inertial systems recover metric scale from accelerometer data; stereo rigs from a known baseline; our scenario has no GNSS, and although the `.OSV` metadata carries fused attitude quaternions (a gravity prior, Ch. 1), no metric accelerometer stream suitable for visual-inertial scale is available, so **scale must come from measured markers or known dimensions**.

**Sim(3) alignment** finds the similarity $(s,\mathbf{R},\mathbf{t})$ that best maps reconstructed points $\mathbf{p}_k$ to reference points $\mathbf{q}_k$:
$$\min_{s,\mathbf{R},\mathbf{t}} \sum_k \|\mathbf{q}_k - (s\mathbf{R}\mathbf{p}_k + \mathbf{t})\|^2$$
which has a closed-form solution via SVD of the cross-covariance (Umeyama's method). Three non-collinear points suffice; in practice use many, well spread. **Caveat:** a single global Sim(3) fixes scale *at the alignment points* but cannot fix *drift* or *bending* in between. To constrain those, the markers must enter the bundle adjustment as constraints (GCPs), not just a post-hoc alignment.

### 1.7 Ground control points, checkpoints, accuracy vs precision, reprojection vs true error

- **Ground control points (GCPs)** are surveyed points whose coordinates are used *inside* the adjustment to fix datum and scale (and reduce drift).
- **Checkpoints (CPs)** are surveyed points that are **withheld** from the adjustment and used only for evaluation. Accuracy must be reported on checkpoints; reporting it on GCPs is like reporting training loss. For this project: printed markers, a subset used as GCPs/scale bars, the rest as checkpoints, with tape/laser distances as ground truth.
- **Accuracy** = closeness to the true value (bias + spread). **Precision** = repeatability/spread (e.g. the standard deviation BA reports from its covariance). A reconstruction can be extremely precise and wrong: consistently 2% too large, or consistently folded.
- **Reprojection error** (mean pixel distance between observed and projected features) measures **self-consistency** of the model with the observations it was fit to. It does **not** measure accuracy. A map folded by a false loop closure, or uniformly mis-scaled, can have sub-pixel reprojection error. True error requires external ground truth: checkpoint RMSE, distance errors between markers, or comparison with a laser scan.
- **Checkpoint RMSE** $=\sqrt{\tfrac1N\sum_k\|\hat{\mathbf{q}}_k - \mathbf{q}_k\|^2}$, usually also reported per axis, plus relative **distance error** $|\hat d - d|/d$ for marker pairs (our ≤1% target).

---

## 2. The classic photogrammetry and 3D reconstruction pipeline

The canonical pipeline is: **images → features → matches → sparse SfM (poses + sparse points) → dense MVS (depth maps) → fusion → mesh → texture**. Neural methods (§3–4) mostly replace the last three stages and *still consume SfM poses*. Bad poses poison everything downstream.

### 2.1 Features and matching

**Hand-crafted features.**
- **SIFT** [Lowe2004] detects blobs in a difference-of-Gaussians scale space and describes each with a 128-D histogram of gradient orientations, normalised for rotation and scale. Still COLMAP's default and still very competitive for accuracy.
- **ORB** [Rublee2011] is a fast binary descriptor (oriented FAST corners + rotated BRIEF), compared with Hamming distance. It is the backbone of ORB-SLAM. Fast but less distinctive than SIFT.

**Learned features and matchers.**
- **SuperPoint** [DeTone2018]: a CNN that jointly detects keypoints and describes them, trained self-supervised via synthetic shapes and homographic adaptation.
- **SuperGlue** [Sarlin2020] and its faster successor **LightGlue** [Lindenberger2023] are attention-based *matchers*: given two sets of keypoints, they reason jointly about which match, using context. LightGlue adapts its depth to pair difficulty. Code and weights are Apache-2.0; the README notes SuperPoint itself has a more restrictive (non-commercial) licence.
- **Detector-free / dense matchers**: **LoFTR** [Sun2021] matches on a coarse transformer feature grid and refines; it works where keypoint detectors find nothing (low texture). **RoMa** [Edstedt2024] regresses a dense warp with DINOv2 features and is among the most robust matchers; code MIT (DINOv2 Apache-2.0).
- **MASt3R** [Leroy2024] grounds matching in 3D: it predicts dense 3D pointmaps *and* local descriptors for an image pair, yielding matches that are robust to large viewpoint change. Licence CC BY-NC-SA 4.0 (non-commercial).
- COLMAP 4.2.0 added **LoMa** learned extraction/matching via ONNX [COLMAP-changelog].

**Vocabulary trees and loop detection.** Exhaustive matching is $O(N^2)$ pairs. Image retrieval quantises descriptors into "visual words" with a hierarchical k-means **vocabulary tree** [Nister2006] and ranks candidate pairs by TF-IDF similarity; learned global descriptors (NetVLAD and successors) do the same with a CNN. For video, **sequential matching** (each frame with its next $k$ neighbours) plus retrieval-based **loop detection** is standard. Retrieval proposes pairs; geometric verification (RANSAC on $\mathbf{E}$/$\mathbf{F}$) accepts them.

*Why it matters here.* In a parking garage, retrieval will happily propose "bay 12 ↔ bay 31" because they *look* the same, and geometric verification may accept it. Dim light also reduces SIFT keypoint counts and pushes towards learned matchers, but learned matchers are *better* at matching repeated structure, which can make false loop closures *more* likely, not less. Robust pipelines combine temporal priors (sequential video), conservative loop acceptance, and checks of the pose graph.

### 2.2 Structure from Motion (SfM)

SfM recovers camera poses (and often intrinsics) plus a sparse point cloud from unordered or ordered images.

**Incremental SfM** (Bundler [Snavely2006] → VisualSFM [Wu2013] → COLMAP [Schoenberger2016SfM]): pick a well-conditioned initial pair, triangulate, then repeatedly register the next best image with PnP, triangulate new points, and run local/global BA. Robust and accurate, but slow for large sets and prone to drift and to order-dependent failures; errors early on are baked in.

**Global SfM**: estimate all relative poses first, then solve for all absolute orientations at once (**rotation averaging**, robustly over the view graph), then all positions (**translation averaging**, harder because pairwise translations have unknown scale), then one BA. Faster and less drift-prone, historically less robust. **GLOMAP** [Pan2024] replaced translation averaging with a joint **global positioning** of cameras and points and reported accuracy comparable to or better than COLMAP's incremental mapper at much higher speed. Since COLMAP 4.0.0, GLOMAP is integrated into COLMAP as the global mapper, and 4.2.0 added multi-component support (disconnected view-graph components are reconstructed separately) [COLMAP-changelog].

**Hierarchical SfM** partitions the view graph into clusters, reconstructs each, and merges them. Useful at large scale; merges are another place where repetitive scenes can mis-register.

**Rigs and multi-camera SfM.** A rig is several cameras with fixed relative poses (`sensor_from_rig`). Modelling the rig reduces unknowns (one pose per *frame*, not per camera) and adds strong constraints. COLMAP has first-class rig support, and its 360° workflow treats virtual perspective views rendered from each panorama as a rig with known extrinsics [COLMAP-rigs].

### 2.3 SLAM versus SfM

**Visual SLAM** (Simultaneous Localisation and Mapping) processes a video stream causally and in real time: track the current frame against a local map, insert keyframes, run local BA, detect loops, and correct drift with **pose-graph optimisation** or global BA. **ORB-SLAM3** [Campos2021] supports monocular, stereo, RGB-D, visual-inertial and fisheye cameras, multi-map "atlas" operation and place recognition; licence GPLv3.

| | SfM | SLAM |
|---|---|---|
| Input | unordered or ordered images, offline | video stream, online |
| Goal | max accuracy | real-time, bounded latency |
| Optimisation | (repeated) full BA | local BA + pose graph / occasional full BA |
| Typical failure | registration gaps, slow | tracking loss under fast motion/low texture, drift |

**Drift** is the accumulation of small relative-pose errors; it grows with trajectory length. **Loop closure** recognises a revisited place and adds a constraint that redistributes accumulated error around the loop. It is powerful *and* dangerous: one false loop closure in a repetitive garage glues two different bays together, "folding" the map, and subsequent optimisation will happily make it self-consistent. **Visual-inertial** odometry fuses IMU data, which gives metric scale, gravity direction and robustness to fast rotation. For the Avata 360, Ch. 1 finds high-rate fused attitude quaternions in the `.OSV` metadata (usable as gravity and rotation priors) but no logged metric accelerations or drone VIO, so visual-inertial scale is not available.

*For this project:* SLAM-style sequential processing is a good fit for FPV video (strong temporal priors, fewer spurious long-range pairs), while offline SfM/BA is needed for the final accuracy.

### 2.4 Dense reconstruction

SfM gives poses and a sparse cloud. **Multi-view stereo (MVS)** estimates a depth (and normal) for *every* pixel.

- **Plane-sweep stereo**: for each candidate depth plane, warp neighbouring images into the reference view and compute photo-consistency (e.g. NCC); pick the best depth per pixel. Simple and GPU-friendly; basis of many learned MVS networks (cost volumes).
- **PatchMatch MVS**: initialise per-pixel depth/normal hypotheses randomly, then *propagate* good hypotheses to neighbours and *refine* by random perturbation, exploiting spatial coherence. COLMAP's dense stereo adds pixel-wise view selection and geometric consistency [Schoenberger2016MVS]; OpenMVS and ACMM-family methods are other implementations.
- **Depth fusion**: merge per-view depth maps into one point cloud, keeping points consistent across views (COLMAP's `stereo_fusion`).
- **TSDF fusion** [Curless1996]: accumulate a truncated signed distance to the surface in a voxel grid, averaging over views; extract the zero level set with marching cubes. Common for RGB-D and for extracting meshes from rendered depths (2DGS, GOF use variants).
- **Meshing**: **Screened Poisson** [Kazhdan2013] fits an implicit indicator function to oriented points (watertight, smooth, may hallucinate surfaces in holes); **Delaunay/graph-cut** meshing (OpenMVS) labels tetrahedra inside/outside using visibility; **advancing-front** grows a surface over the points (COLMAP 4.1.0 added an advancing-front mesher [COLMAP-changelog]).
- **Texturing**: project images onto mesh faces, choose the best view per face, blend seams.

**Tools.** COLMAP (BSD, SfM + MVS + meshing) [Schoenberger2016SfM]; OpenMVS [OpenMVS] (AGPL-3.0; densify, mesh, refine, texture); Meshroom/AliceVision (MPL-2.0) [Griwodz2021]; OpenDroneMap/ODM [ODM] (AGPL-3.0; aerial-mapping oriented, GNSS-centric). Commercial reference points: Agisoft Metashape and RealityScan (formerly RealityCapture), both widely used in surveying and known for strong GCP workflows. *(Assessment, not measured here.)*

*Why it matters here.* Classical MVS relies on photo-consistency, which fails on **textureless** concrete (no signal), **specular** car paint and wet floors (view-dependent appearance), and **moving** objects. Expect holes on floors/ceilings and noise on cars. Planar priors (garages are mostly planes) are therefore valuable. Classical MVS remains the accuracy reference for *textured* surfaces.

### 2.5 Evaluation metrics

- **Accuracy** (precision, in the benchmark sense): for each reconstructed point, distance to the nearest ground-truth point; report mean/median or the fraction below a threshold $\tau$.
- **Completeness** (recall): for each ground-truth point, distance to the nearest reconstructed point.
- **F-score**: harmonic mean of precision and recall at threshold $\tau$, $F = 2PR/(P+R)$. Popularised for full scenes by Tanks and Temples [Knapitsch2017].
- **Chamfer distance**: the mean of the two directed nearest-neighbour distances, $\mathrm{CD} = \tfrac12\big(\tfrac{1}{|A|}\sum_{a}\min_b\|a-b\| + \tfrac{1}{|B|}\sum_{b}\min_a\|a-b\|\big)$ (some papers use squared distances; check the definition). DTU reports this.
- **ATE / RPE** for trajectories [Sturm2012]: ATE aligns the estimated trajectory to ground truth (rigidly, or by Sim(3) for monocular) and reports RMSE of position differences, which captures global consistency; RPE measures the error of relative motion over a fixed interval $\Delta$, which captures local drift.
- **Checkpoint RMSE and marker-distance error** (§1.7): the survey-style metrics that match this project's acceptance criterion.
- **Rendering metrics** (for the visualisation goal only): PSNR, SSIM, LPIPS on held-out views. These say nothing about metric accuracy.

---
## 3. Neural and learned reconstruction

### 3.1 NeRF and the volume rendering equation

**NeRF** [Mildenhall2020] represents a scene as an MLP $F_\Theta(\mathbf{x},\mathbf{d}) \mapsto (\sigma, \mathbf{c})$: volume density $\sigma$ at position $\mathbf{x}$ and view-dependent colour $\mathbf{c}$ for viewing direction $\mathbf{d}$. A pixel's colour is the expected colour along its camera ray $\mathbf{r}(t) = \mathbf{o} + t\mathbf{d}$:
$$C(\mathbf{r}) = \int_{t_n}^{t_f} T(t)\,\sigma(\mathbf{r}(t))\,\mathbf{c}(\mathbf{r}(t),\mathbf{d})\,dt, \qquad T(t) = \exp\!\Big(-\!\int_{t_n}^{t}\sigma(\mathbf{r}(s))\,ds\Big).$$
$T(t)$ is the **transmittance**: the probability that light travels from $t_n$ to $t$ unblocked. Discretised with samples $t_i$ and spacings $\delta_i$:
$$\hat C = \sum_i T_i\,\alpha_i\,\mathbf{c}_i,\quad \alpha_i = 1 - e^{-\sigma_i\delta_i},\quad T_i = \prod_{j<i}(1-\alpha_j).$$
This **alpha-compositing** form is exactly what 3DGS also uses, with Gaussians instead of ray samples. The whole thing is differentiable, so $\Theta$ is fitted by gradient descent on a photometric loss against the training images, **given known camera poses** (from COLMAP).

**Positional encoding.** MLPs are biased towards low frequencies ("spectral bias"). NeRF maps each coordinate through $\gamma(p) = (\sin 2^0\pi p, \cos 2^0\pi p, \dots, \sin 2^{L-1}\pi p, \cos 2^{L-1}\pi p)$ so the network can represent fine detail; Tancik et al. later analysed this as Fourier features [Tancik2020].

**Mip-NeRF 360** [Barron2022]. Important for vocabulary: **"360" here means unbounded scenes captured by a camera orbiting a central object (with background extending to infinity), *not* panoramic/360° input images.** It adds (i) a non-linear *scene contraction* that maps unbounded space into a bounded ball, (ii) *online distillation* with a small proposal MLP to place samples, and (iii) a *distortion regulariser* that suppresses floaters. It builds on mip-NeRF's cone tracing with integrated positional encoding, which is a principled anti-aliasing scheme. Its "Mip-NeRF 360 dataset" became the standard 3DGS benchmark.

**Instant-NGP** [Mueller2022] replaced most of the MLP with a **multiresolution hash encoding**: $L$ grids of increasing resolution, each storing trainable feature vectors in a hash table of size $T$; collisions are tolerated and resolved implicitly by training. Training dropped from hours to seconds-to-minutes. Licence: NVIDIA source-code licence (non-commercial use; commercial via NVIDIA).

**Zip-NeRF** [Barron2023] combines mip-NeRF 360's anti-aliasing with hash-grid speed, using multisampling to approximate cone integrals over the grid. It was long the quality reference for NeRF on unbounded scenes.

*Why it matters here.* NeRFs give photoreal views but geometry is a by-product of density, poorly constrained in textureless or specular regions. They are training-time and memory heavy relative to 3DGS. For this project they are mainly vocabulary and background for neural surfaces.

### 3.2 Neural implicit surfaces: NeuS, VolSDF, Neuralangelo

Density fields do not define a crisp surface. Neural surface methods instead learn a **signed distance function** (SDF) $f(\mathbf{x})$ and convert it to density for volume rendering, so the surface is the zero level set and can be extracted with marching cubes.

- **NeuS** [Wang2021NeuS] derives an *unbiased* SDF→opacity conversion using a logistic density $\phi_s(f)$ whose sharpness $s$ is learned, so that the rendering weight peaks exactly at the surface.
- **VolSDF** [Yariv2021] defines density as a scaled Laplace CDF of the negative SDF, $\sigma(\mathbf{x}) = \alpha\,\Psi_\beta(-f(\mathbf{x}))$, and derives an error bound to guide sampling.
- **Neuralangelo** [Li2023] combines multiresolution hash grids with numerical gradients and coarse-to-fine optimisation to recover high-detail surfaces at large scale. Licence: NVIDIA source-code licence (non-commercial).
- **Eikonal loss** $\mathbb{E}\,(\|\nabla f\|-1)^2$ keeps $f$ a valid distance field in all of these.

Trade-off: smooth, watertight geometry with good hole-filling on textureless areas; slow training (hours to days), and smoothness priors can erase thin structures. IM360 (shared context) is an example that pairs spherical SfM with neural surface reconstruction for large indoor 360° scenes [Jung2025IM360].

### 3.3 Feed-forward 3D: DUSt3R, MASt3R, VGGT and successors

A new family of large networks predicts 3D structure from images **in one forward pass**, without per-scene optimisation or known intrinsics.

- **DUSt3R** [Wang2024DUSt3R] (CVPR 2024): given two images, a ViT predicts a dense **pointmap** for each, i.e. a 3D point per pixel, both expressed in the *first* camera's frame, plus confidence. Relative pose, intrinsics and depth fall out of the pointmaps. For more than two views, pairwise predictions are fused by a *global alignment* optimisation. It does not use SuperGlue or any keypoint matcher. Code and checkpoints: CC BY-NC-SA 4.0 (non-commercial), with training-data licence caveats.
- **MASt3R** [Leroy2024] (ECCV 2024): adds a dense local-feature head to DUSt3R for accurate, reciprocal matching. **MASt3R-SfM** [Duisterhof2025] (3DV 2025) builds a full SfM pipeline on it. CC BY-NC-SA 4.0.
- **VGGT** [Wang2025VGGT] (CVPR 2025): a 1B-parameter transformer that takes many views at once and outputs camera parameters, depth maps, pointmaps and point tracks. Since July 2025 the code and a separate commercial checkpoint permit commercial use (excluding military); the original checkpoint remains non-commercial.
- **π³** [Wang2025Pi3]: removes the reference-view dependence with a permutation-equivariant architecture.
- **MapAnything** [Keetha2026] (3DV 2026): a feed-forward model that predicts **metric** 3D geometry and can accept optional inputs such as intrinsics, poses or depth; an Apache-2.0 model variant is offered.

**What they predict and their limits.** They predict *plausible* geometry from learned priors. Strengths: robustness where classical matching fails (low texture, wide baselines), excellent initialisation, very fast. Limits for this project: (1) working resolution is typically ~512 px on the long side, far below 8K; (2) memory grows with the number of views, so long videos need chunking (VGGT-Long-style approaches); (3) accuracy is generally below BA-refined SfM on well-textured scenes, so the outputs are best used as an *initialisation* or matcher and then refined with BA; (4) "metric" predictions are learned scale estimates, not survey-grade, and must still be checked against markers; (5) most assume pinhole input, so equirectangular frames need to be split into perspective views first; (6) several have non-commercial licences.

---

## 4. 3D Gaussian Splatting in depth

3DGS [Kerbl2023] (Kerbl, Kopanas, Leimkühler, Drettakis; ACM TOG 42(4), SIGGRAPH 2023) replaced NeRF's implicit field with an **explicit set of millions of 3D Gaussians**, rendered by fast rasterisation instead of ray marching. Training takes minutes to tens of minutes; rendering runs in real time (≥30 fps at 1080p per the paper).

### 4.1 Representation

Each Gaussian $k$ has:
- **mean** $\boldsymbol{\mu}_k\in\mathbb{R}^3$;
- **covariance** $\boldsymbol{\Sigma}_k = \mathbf{R}_k\mathbf{S}_k\mathbf{S}_k^\top\mathbf{R}_k^\top$, parameterised by a scale vector $\mathbf{s}_k$ (stored as log-scales; $\mathbf{S}=\mathrm{diag}(\mathbf{s})$) and a unit quaternion $\mathbf{q}_k$ ($\to\mathbf{R}_k$). This factorisation keeps $\boldsymbol\Sigma$ positive semi-definite during gradient descent, which optimising $\boldsymbol\Sigma$ directly would not;
- **opacity** $o_k\in(0,1)$ (stored as a logit);
- **colour** as **spherical-harmonic (SH)** coefficients, degree 3 by default (16 coefficients per channel, 48 floats), so colour can vary with viewing direction (a cheap model of specularity).

The density is $G_k(\mathbf{x}) = \exp\!\big(-\tfrac12(\mathbf{x}-\boldsymbol\mu_k)^\top\boldsymbol\Sigma_k^{-1}(\mathbf{x}-\boldsymbol\mu_k)\big)$.

### 4.2 EWA projection, tile rasterisation and alpha compositing

**Projection.** Following EWA splatting [Zwicker2001], a 3D Gaussian under a *locally affine* approximation of the projection becomes a 2D Gaussian with covariance
$$\boldsymbol\Sigma'_k = \mathbf{J}\,\mathbf{W}\,\boldsymbol\Sigma_k\,\mathbf{W}^\top\mathbf{J}^\top,$$
where $\mathbf{W}$ is the world-to-camera rotation and $\mathbf{J}$ the Jacobian of the perspective projection at the Gaussian's centre (keeping the upper-left $2\times2$). **This linearisation is exact only for pinhole projection near the centre**; it degrades for wide-angle, fisheye and spherical cameras and cannot model rolling shutter. That limitation motivates 3DGUT/3DGRT (§4.4).

**Tile-based rasterisation.** The screen is split into 16×16-pixel tiles. Each projected Gaussian (culled to its ~3σ extent) is duplicated for every tile it overlaps, with a key combining tile ID and depth; one GPU radix sort orders everything; each tile then walks its depth-sorted list front to back.

**Alpha compositing.** For pixel $\mathbf{p}$,
$$C(\mathbf{p}) = \sum_{k\in\mathcal{N}} \mathbf{c}_k\,\alpha_k \prod_{j<k}(1-\alpha_j),\qquad \alpha_k = o_k\exp\!\big(-\tfrac12(\mathbf{p}-\boldsymbol\mu'_k)^\top\boldsymbol\Sigma'^{-1}_k(\mathbf{p}-\boldsymbol\mu'_k)\big).$$
Same form as NeRF's discrete volume rendering, with Gaussians replacing ray samples. Processing stops when accumulated opacity saturates. Sorting is per Gaussian centre, not per pixel, which is an approximation and causes **popping** when ordering changes with viewpoint.

**Differentiability.** The backward pass re-traverses the sorted lists back to front, propagating gradients to $\boldsymbol\mu, \mathbf{s}, \mathbf{q}, o$ and SH coefficients. Everything is custom CUDA.

### 4.3 Optimisation

- **Initialisation**: Gaussians are created at the **SfM sparse points**, with colour from the points and scale from nearest-neighbour distances. 3DGS therefore inherits COLMAP's poses *and* its sparse coverage. Poor SfM in textureless regions means few seeds there.
- **Loss**: $\mathcal{L} = (1-\lambda)\,\mathcal{L}_1 + \lambda\,\mathcal{L}_{\text{D-SSIM}}$ with $\lambda = 0.2$.
- **Adaptive density control** (every 100 iterations from iteration 500 to 15,000 by default in the reference code [Kerbl2023]): Gaussians whose view-space positional gradient exceeds a threshold (default 0.0002) are densified. **Clone** small ones (under-reconstruction: copy and move along the gradient). **Split** large ones (over-reconstruction: replace with two smaller samples drawn from the original). **Prune** Gaussians with very low opacity or excessive size.
- **Opacity reset**: periodically set all opacities to a small value so that unnecessary Gaussians (especially floaters near cameras) can be pruned.
- **Schedule**: 30,000 iterations by default; the reference README asks for 24 GB VRAM to train to paper quality, with options for smaller GPUs [Kerbl2023]. gsplat reports reproducing the original with up to 4× less GPU memory [Ye2025gsplat], which is directly relevant to the 16 GB budget.
- **Alternative densification**: MCMC-style relocation (available in gsplat) treats Gaussians as samples and caps their number, which is useful for memory control.

**Common failure modes.**
- **Floaters**: semi-transparent blobs in free space that explain view-specific effects (exposure changes, reflections, moving objects) for a few training views.
- **Needles/spikes**: highly anisotropic Gaussians that look fine from training views but streak from novel ones.
- **Popping**: sudden changes when sort order flips.
- **Overfitting to training views**: good PSNR on training views but artefacts off-trajectory. FPV footage samples a narrow corridor of viewpoints, which makes this likely.
- **Specular/reflective surfaces**: SH colour cannot represent mirror-like reflections, so 3DGS often "paints" a reflected scene *behind* the surface, which wrecks geometry on car paint, glass and wet floors.

### 4.4 The extension landscape (grouped)

**Anti-aliasing.** **Mip-Splatting** [Yu2024Mip] adds a 3D smoothing filter (bounded by the maximal sampling rate of the training views) and a 2D Mip filter to remove aliasing/dilation artefacts when zooming or changing resolution.

**Surfaces and geometry.**
- **SuGaR** [Guedon2024]: regularises Gaussians to align with the surface, extracts a mesh (Poisson), optionally binds Gaussians to the mesh for joint refinement. CVPR 2024.
- **2DGS** [Huang2024] (SIGGRAPH 2024): replaces 3D ellipsoids with oriented 2D disks (surfels) with ray–splat intersection, adding depth-distortion and normal-consistency losses; meshes via TSDF fusion of rendered depth. Consistently better geometry than 3DGS, slightly lower rendering quality.
- **GOF** (Gaussian Opacity Fields) [Yu2024GOF] (ACM TOG 2024): defines a view-independent opacity field from the Gaussians and extracts its level set directly (via a tetrahedral grid), suitable for unbounded scenes.
- **PGSR** [Chen2024PGSR]: flattens Gaussians into planes, renders unbiased depth and normals, and adds single- and multi-view geometric consistency plus exposure compensation. Particularly interesting for planar-dominated scenes like parking garages. Licence: research/non-profit only.
- **RaDe-GS** [Zhang2024RaDe]: rasterises depth and normal maps for general Gaussians efficiently; the README says it is accepted to ACM TOG and now integrates PGSR's multi-view regularisation.
- Licence caveat: SuGaR, 2DGS, GOF, Mip-Splatting and RaDe-GS ship the **Inria/MPII Gaussian-Splatting licence** (non-commercial research and evaluation) because they derive from the reference code.

**Appearance and in-the-wild.** Real captures have exposure, white-balance and vignetting changes; vanilla 3DGS does **not** handle these, it bakes them into floaters or colour errors. Remedies: per-image appearance embeddings (NeRF-W style), per-image affine colour transforms, **bilateral grids** [Wang2024BilaRF] (integrated in gsplat), and the exposure-compensation option added to the INRIA code in its October 2024 update [Kerbl2023]. **WildGaussians** [Kulhanek2024] (NeurIPS 2024) adds DINO-feature-based appearance and uncertainty modelling to handle transient occluders such as people and cars. For flickering artificial light, appearance modelling is not optional.

**Camera models: fisheye, 360°, rolling shutter.**
- **3DGRT** [MoenneLoccoz2024] (ACM TOG / SIGGRAPH Asia 2024) ray-traces Gaussian particles with hardware ray tracing, so any camera model and secondary effects are possible, at higher cost.
- **3DGUT** [Wu2025_3DGUT] (CVPR 2025) keeps rasterisation but replaces the EWA linearisation with an **unscented transform**: project sigma points of each Gaussian through the *exact* nonlinear camera model (including distortion and time-dependent rolling-shutter effects) and refit a 2D Gaussian. Code Apache-2.0 (3dgrut), and integrated into gsplat.
- **Fisheye-GS** adapts the projection Jacobian to the equidistant fisheye model; 3DGUT's README follows its ScanNet++ preprocessing.
- **Omnidirectional splatting**: **OmniGS** [Li2025OmniGS] (WACV 2025) and **ODGS** [Lee2024ODGS] (NeurIPS 2024; MIT licence) rasterise Gaussians directly into equirectangular images.
- **Rolling shutter and motion blur**: *Gaussian Splatting on the Move* [Seiskari2024] (ECCV 2024) models both in a differentiable renderer using velocity estimates, and refines poses.

**Scale and compression.** **Hierarchical 3DGS** [Kerbl2024Hier] (ACM TOG 2024) builds a level-of-detail hierarchy and trains large scenes in chunks, which is the natural route for a whole garage on 16 GB. A large compression literature (quantisation, pruning, SH distillation, anchor-based scaffolds) shrinks models by 10–50×; see the surveys [Chen2024Survey].

**Tooling.**
- **INRIA reference code** [Kerbl2023]: canonical, non-commercial licence, CUDA.
- **gsplat** [Ye2025gsplat] (Apache-2.0; JMLR 2025): a library of CUDA kernels with Python bindings; supports 3DGUT, fisheye/FTheta camera models, MCMC densification, bilateral grids and PPISP appearance compensation (per its README news).
- **nerfstudio** [Tancik2023] (Apache-2.0): a modular framework; its `splatfacto` method is built on gsplat and accepts COLMAP data.

### 4.5 Why 3DGS geometry is not automatically metric or accurate

1. **Scale and frame are inherited from SfM.** 3DGS has no notion of metres; its scale is whatever the input poses had. If SfM drifted or folded, the splat faithfully reproduces that error.
2. **The objective is photometric.** The loss rewards matching training pixels, not placing Gaussians on surfaces. Any arrangement that renders correctly from the training views is a valid minimum. Reflections get painted behind surfaces, textureless walls get arbitrary depth, and floaters fill free space.
3. **There is no single surface.** Gaussians are semi-transparent volumes; "depth" must be defined (expected depth, median depth, opacity level set), and different definitions disagree by centimetres. 2DGS/GOF/PGSR/RaDe-GS exist to address exactly this.
4. **Coverage bias.** FPV trajectories see floors and ceilings at grazing angles; geometry there is weakly constrained.
5. **Evaluation mismatch.** High PSNR on held-out views does not imply geometric accuracy.

**Practical consequence for this project:** treat SfM + BA (with GCPs) as the metric backbone, MVS or a geometry-regularised splatting method as the dense-geometry source *validated on checkpoints*, and vanilla 3DGS as the visualisation layer.

---

## 5. Spherical / 360° specifics

### 5.1 Equirectangular and cubemap representations

- **Equirectangular (ERP)**: longitude/latitude grid (§1.2). Easy to store and stream; heavy, non-uniform distortion: a pixel at latitude $\theta$ covers a solid angle proportional to $\cos\theta$, so the poles are hugely oversampled and objects there are stretched horizontally. Local features computed on ERP pixels are not rotation/scale-invariant in the usual sense.
- **Cubemap**: six 90°-FoV pinhole images on the faces of a cube centred at the camera. Each face is an ordinary perspective image, so all classical tools work, at the cost of seams between faces and features that straddle edges. Variants render overlapping views (e.g. 8–12 views with >90° FoV, or RIGOR's four-view virtual rig per gravity-aligned panorama [RIGOR2026]) to keep features away from edges.
- **Dual-fisheye (raw)**: the two native lens images. They avoid stitching artefacts and are a central model per lens; they need a two-camera rig model with a small baseline and fisheye intrinsics. Ch. 1 shows that the Avata 360's `.OSV` file does contain both raw 3840×3840 fisheye streams, and Ch. 4 builds its primary pipeline on them.

The mapping ERP → cubemap face is: for each face pixel, form the ray $\mathbf{K}_{face}^{-1}\tilde{\mathbf{x}}$, rotate it by the face rotation, convert to $(\phi,\theta)$, and sample the ERP with bilinear/bicubic interpolation.

### 5.2 Spherical epipolar geometry

With bearing vectors the essential-matrix constraint holds unchanged: $\mathbf{b}_2^\top[\mathbf{t}]_\times\mathbf{R}\,\mathbf{b}_1 = 0$. Geometrically, all rays from both centres to a 3D point lie in the epipolar plane, and that plane cuts each sphere in a **great circle**. Errors must be measured as **angles** on the sphere (or in a local tangent plane), not in ERP pixels, because a pixel near the pole subtends a much smaller angle than one at the equator. Benefits of the full sphere: wide field of view makes rotation estimation very well conditioned and reduces the forward-motion ambiguity typical of narrow cameras. Costs: lower angular resolution per pixel (8K ERP spreads 7,680 pixels over 360°, roughly 21 px/degree, versus ~40–60 px/degree for a typical 4K perspective video with 70–90° FoV), and seam/stitching artefacts.

### 5.3 Why perspective rigs often beat native spherical models in current SfM tools

COLMAP 4.1.0's changelog says the new spherical (equirectangular) camera models enable native reconstruction of 360° images but are "generally faster but less accurate than rendering perspective views", as in its `panorama_sfm` example [COLMAP-changelog]. Its docs describe the recommended workflow: render virtual pinhole images (similar to a cubemap) and treat them as a rig with known extrinsics and intrinsics, which makes reconstruction more robust [COLMAP-rigs]. Plausible reasons (assessment):
1. **Feature detectors and descriptors** (SIFT, SuperPoint, …) are designed and trained for perspective images; ERP distortion changes local appearance with latitude.
2. **Pixel-space residuals** in ERP are anisotropic and latitude-dependent unless the solver works in angular/tangent-plane errors.
3. **Rig constraints** with known relative poses are strong regularisers, and rig BA is mature.
4. **Learned matchers and MVS** (and feed-forward models) assume pinhole input.

The ORBIT benchmark [ORBIT2026] (accepted at CVPR 2026; arXiv version titled ORBIT++) tracks web-sourced 360° videos to obtain reference trajectories, then crops them into challenging perspective clips; COLMAP and other state-of-the-art SfM methods still struggle on those clips. IM360 [Jung2025IM360] integrates the spherical camera model into every core SfM component, with dense matching designed for 360° images, for large indoor scenes. RIGOR [RIGOR2026] takes the rig route: it treats each gravity-aligned panorama as a four-view virtual rig fed to a frozen feed-forward perspective backbone, uses the rig to detect inconsistent predictions and verify loop closures, and corrects drift with a Sim(3) pose graph.

### 5.4 360° datasets

- **Matterport3D** [Chang2017] (3DV 2017): RGB-D data captured throughout 90 properties with a Matterport Pro camera (colour and depth images, camera poses, textured meshes, floor plans, semantics). Access requires signing terms of use.
- **Stanford 2D-3D-Semantics (2D-3D-S)** [Armeni2017]: indoor office areas with equirectangular RGB, depth, normals and semantics; licence agreement required.
- **360Loc** [Huang2024_360Loc] (CVPR 2024): omnidirectional visual-localisation benchmark with 360° mapping images and cross-device queries (360°, pinhole and several fisheye variants generated from the 360° images) (scenes include one named `atrium`). Useful for testing 360° localisation pipelines.
- **ORBIT** [ORBIT2026] (CVPR 2026): pose-estimation benchmark of challenging clips cropped from web 360° videos, with reference trajectories from panoramic rig-based SfM.
- Others to look at, not verified here: Structured3D (synthetic panoramas), 360VO/360 SLAM datasets, TartanAir panorama sequences (COLMAP 4.2.0 notes mention TartanAir panoramas in its reconstruction benchmarks [COLMAP-changelog]). **[UNVERIFIED]** beyond that note.

None of these is a dim, repetitive underground garage captured by an FPV drone; the project will likely need its own small benchmark with surveyed markers.

---
## 6. Curated learning path (week 1 → week 4)

Level: **B** = beginner to the subfield, **I** = intermediate, **A** = advanced/paper-level. Times are rough estimates for focused study. Each week ends with a hands-on milestone. Resources marked † were not opened in this session (network limits); they are canonical and the reader should confirm current URLs.

### Week 1 — Camera geometry, epipolar geometry, estimation (goal: derive and implement projection, triangulation, RANSAC)

| # | Resource | Why | Level | Time |
|---|---|---|---|---|
| 1 | Hartley & Zisserman, *Multiple View Geometry*, 2nd ed., ch. 6 (camera models), 9 (epipolar geometry/F), 12 (triangulation) [HZ2004]† | The reference text; notation used by most papers | I | 8 h |
| 2 | Szeliski, *Computer Vision: Algorithms and Applications*, 2nd ed., ch. 2 (image formation), 7–8 (features, alignment), 11 (SfM) [Szeliski2022] | Gentler, modern, free PDF for personal use from the author's site | B–I | 8 h |
| 3 | Cyrill Stachniss, *Photogrammetry I* lectures (Uni Bonn, YouTube) [Stachniss-Photo] | Photogrammetrist's view: DLT, P3P, calibration, accuracy vs precision | B | 6 h (selected videos) |
| 4 | TUM *Computer Vision II: Multiple View Geometry* (Cremers) [TUM-MVG] | Clean derivations of E/F, 8-point, reconstruction from two views | I | 6 h |
| 5 | CMU 16-385 *Computer Vision* lecture slides on cameras, two-view geometry and SfM [CMU16385] | Compact slides with good figures; assignments implement 8-point and triangulation | B–I | 4 h |
| 6 | Fischler & Bolles, RANSAC (1981) [Fischler1981]† | Original robust estimation paper; short and readable | B | 1 h |
| 7 | Nistér, five-point relative pose (2004) [Nister2004]† | Why 5 points and how minimal solvers are built | A | 2 h (skim) |
| 8 | Lepetit et al., EPnP (2009) [Lepetit2009]† | The standard efficient PnP | I | 1.5 h |
| 9 | Kannala–Brandt / COLMAP camera-model docs [COLMAP-cameras] | Distortion and fisheye models as actually implemented | I | 1 h |
| 10 | Exercise: write a NumPy pinhole + equirectangular projector, DLT triangulation, 5-point/8-point + RANSAC on synthetic data | Turns notation into intuition; reused for widgets | I | 6 h |

**Milestone:** given synthetic cameras and noisy matches, recover relative pose and triangulate; plot error vs baseline and noise.

### Week 2 — SfM, bundle adjustment, SLAM, MVS, evaluation (goal: run and diagnose COLMAP end to end)

| # | Resource | Why | Level | Time |
|---|---|---|---|---|
| 1 | Triggs et al., *Bundle Adjustment — A Modern Synthesis* [Triggs2000] | Cost functions, sparsity, gauge freedom, quality control; read §§1–6 and gauge section | A | 4 h |
| 2 | Schönberger & Frahm, *Structure-from-Motion Revisited* (CVPR 2016) [Schoenberger2016SfM] | The design of COLMAP's incremental mapper | I | 2 h |
| 3 | Pan et al., *Global Structure-from-Motion Revisited* (GLOMAP, ECCV 2024) [Pan2024] | Modern global SfM; now COLMAP's global mapper | I | 2 h |
| 4 | COLMAP documentation: tutorial, rigs, 360° panorama section, changelog [COLMAP-rigs] [COLMAP-changelog] | What the tool actually does; 360° workflow; version-specific behaviour | B | 3 h |
| 5 | Stachniss, *Photogrammetry II* lectures (BA, SfM, dense reconstruction) [Stachniss-Photo] | Least-squares adjustment, GCPs, error propagation from a surveying viewpoint | I | 5 h |
| 6 | Campos et al., ORB-SLAM3 (T-RO 2021) [Campos2021] | Reference visual/visual-inertial SLAM; loop closure and multi-map | I | 2.5 h |
| 7 | Sarlin et al., hloc / *From Coarse to Fine* (CVPR 2019) and LightGlue (ICCV 2023) [Sarlin2019] [Lindenberger2023] | Learned features/matchers plugged into COLMAP | I | 3 h |
| 8 | Schönberger et al., *Pixelwise View Selection for Unstructured MVS* (ECCV 2016) [Schoenberger2016MVS] | PatchMatch MVS as in COLMAP | A | 2 h |
| 9 | Kazhdan & Hoppe, Screened Poisson (2013) [Kazhdan2013]† and Curless & Levoy, VRIP/TSDF (1996) [Curless1996]† | The two meshing/fusion workhorses | I | 3 h |
| 10 | Knapitsch et al., Tanks and Temples (TOG 2017) [Knapitsch2017] | Precision/recall/F-score evaluation of full pipelines | I | 1.5 h |
| 11 | Sturm et al., TUM RGB-D benchmark (IROS 2012) [Sturm2012] | ATE/RPE definitions used everywhere | B | 1 h |
| 12 | Szeliski 2nd ed., ch. 12–13 (depth estimation, 3D reconstruction) [Szeliski2022] | MVS and fusion in context | I | 4 h |
| 13 | Hands-on: COLMAP on a short indoor video (sequential matcher), then on cubemap views of a 360° clip via `panorama_sfm`; inspect reprojection error, track lengths, and a deliberately induced false loop closure | Builds diagnostic instincts | I | 8 h |

**Milestone:** a COLMAP reconstruction of a small indoor space, scaled with two measured distances, with a third held-out distance reported as error.

### Week 3 — Neural fields, neural surfaces, feed-forward 3D (goal: read NeRF-family papers fluently)

| # | Resource | Why | Level | Time |
|---|---|---|---|---|
| 1 | Mildenhall et al., NeRF (ECCV 2020) [Mildenhall2020] | Volume rendering equation and positional encoding | I | 2.5 h |
| 2 | Tewari et al., *Advances in Neural Rendering* (Eurographics 2022 STAR) [Tewari2022] | Survey of concepts and representations before 3DGS | I | 4 h |
| 3 | Tancik et al., Fourier features (NeurIPS 2020) [Tancik2020]† | Why positional encoding works | A | 1.5 h |
| 4 | Barron et al., Mip-NeRF 360 (CVPR 2022) [Barron2022] | Unbounded scenes, contraction, distortion loss; source of the standard benchmark | A | 2.5 h |
| 5 | Müller et al., Instant-NGP (TOG 2022) [Mueller2022] | Hash grids; the speed revolution | I | 2 h |
| 6 | Barron et al., Zip-NeRF (ICCV 2023) [Barron2023] | Anti-aliasing + grids; quality reference | A | 2 h (skim) |
| 7 | Wang et al., NeuS (2021) [Wang2021NeuS] and Yariv et al., VolSDF (NeurIPS 2021) [Yariv2021] | SDF-based volume rendering | A | 3 h |
| 8 | Li et al., Neuralangelo (CVPR 2023) [Li2023] | Large-scale neural surfaces | I | 1.5 h |
| 9 | Wang et al., DUSt3R (CVPR 2024) [Wang2024DUSt3R] and Leroy et al., MASt3R (ECCV 2024) [Leroy2024] | Pointmap regression and 3D-grounded matching | I | 3 h |
| 10 | Wang et al., VGGT (CVPR 2025) [Wang2025VGGT]; skim π³ [Wang2025Pi3] and MapAnything [Keetha2026] | Current feed-forward frontier and its limits | I | 3 h |
| 11 | CMU 16-825 *Learning for 3D Vision* (Tulsiani) [CMU16825] | Course framing of representations and differentiable rendering; PyTorch3D assignments | I | 6 h (selected lectures) |
| 12 | nerfstudio docs and paper (SIGGRAPH 2023) [Tancik2023] | Hands-on framework for NeRF and splatfacto | B | 3 h |

**Milestone:** train nerfacto/splatfacto in nerfstudio on the week-2 COLMAP output; run VGGT or MASt3R on 20 cubemap frames and compare its poses with COLMAP's after Sim(3) alignment.

### Week 4 — 3D Gaussian Splatting and 360°-specific methods (goal: modify a 3DGS training loop)

| # | Resource | Why | Level | Time |
|---|---|---|---|---|
| 1 | Kerbl et al., 3DGS (TOG/SIGGRAPH 2023) [Kerbl2023], paper + reference README | The method and its default hyper-parameters | I | 3 h |
| 2 | Zwicker et al., EWA Volume Splatting (IEEE Vis 2001) [Zwicker2001] | Where $\mathbf{J}\mathbf{W}\boldsymbol\Sigma\mathbf{W}^\top\mathbf{J}^\top$ comes from | A | 2 h |
| 3 | Chen & Wang, *A Survey on 3D Gaussian Splatting* [Chen2024Survey] | Map of the extension landscape | I | 3 h |
| 4 | gsplat repository, docs and JMLR paper [Ye2025gsplat] | The library to build on; 3DGUT, MCMC, bilateral grid, memory savings | I | 4 h |
| 5 | Yu et al., Mip-Splatting (CVPR 2024) [Yu2024Mip] | Anti-aliasing; frequency reasoning for splats | A | 1.5 h |
| 6 | Huang et al., 2DGS (SIGGRAPH 2024) [Huang2024] | Geometry-accurate splats; depth-distortion and normal losses | A | 2 h |
| 7 | Chen et al., PGSR [Chen2024PGSR] and Yu et al., GOF [Yu2024GOF] | Planar and opacity-field surfaces; most relevant to garages | A | 3 h |
| 8 | Wu et al., 3DGUT (CVPR 2025) [Wu2025_3DGUT] and Moënne-Loccoz et al., 3DGRT [MoenneLoccoz2024] | Exact camera models, rolling shutter in splatting | A | 3 h |
| 9 | Seiskari et al., *Gaussian Splatting on the Move* (ECCV 2024) [Seiskari2024] | Motion blur and rolling shutter from natural camera motion | I | 1.5 h |
| 10 | Kulhanek et al., WildGaussians (NeurIPS 2024) [Kulhanek2024] and Wang et al., BilaRF (TOG 2024) [Wang2024BilaRF] | Appearance/exposure and transients | I | 2.5 h |
| 11 | Kerbl et al., Hierarchical 3DGS (TOG 2024) [Kerbl2024Hier] | Chunked training for large scenes | A | 1.5 h |
| 12 | OmniGS (WACV 2025) [Li2025OmniGS] and ODGS (NeurIPS 2024) [Lee2024ODGS] | Native equirectangular splatting | I | 2 h |
| 13 | IM360 (ICCV 2025) [Jung2025IM360], RIGOR (2026) [RIGOR2026], ORBIT (CVPR 2026) [ORBIT2026] | State of the art and open problems for 360° SfM | A | 3 h |
| 14 | Hands-on: in gsplat, train on cubemap views; add a bilateral grid; render depth and compare marker distances with the COLMAP+MVS result | Experiences why photoreal ≠ metric | A | 10 h |

**Milestone:** a short written comparison: same scene, SfM+MVS vs 2DGS/PGSR vs vanilla 3DGS, scored on held-out marker distances, plus PSNR on held-out frames.

---

## 7. Glossary

- **Absolute trajectory error (ATE):** RMSE of position differences between an estimated trajectory and ground truth after rigid or Sim(3) alignment; measures global consistency.
- **Accuracy:** Closeness of a measurement to the true value; includes bias. Contrast with precision.
- **Adaptive density control:** The 3DGS procedure that clones, splits and prunes Gaussians during training based on gradients, size and opacity.
- **Alpha compositing:** Front-to-back blending $C=\sum_k c_k\alpha_k\prod_{j<k}(1-\alpha_j)$ used by both NeRF and 3DGS.
- **Appearance embedding:** A learned per-image vector or colour transform that absorbs exposure, white-balance and lighting differences so they do not corrupt geometry.
- **Back-projection:** Mapping a pixel to the 3D ray of points that project onto it; depth is unknown without more information.
- **Baseline:** Distance between two camera centres; larger baselines give better-conditioned triangulation but harder matching.
- **Bearing vector:** Unit 3D direction of a pixel's ray; the natural measurement for spherical cameras.
- **Bilateral grid:** A low-resolution 3D grid of affine colour transforms indexed by pixel position and intensity, used to model per-image tone/exposure changes.
- **Bundle adjustment (BA):** Joint non-linear least-squares refinement of camera parameters and 3D points that minimises (robust) reprojection error.
- **Camera matrix:** The $3\times4$ matrix $\mathbf{P}=\mathbf{K}[\mathbf{R}\mid\mathbf{t}]$ that maps homogeneous world points to homogeneous pixels.
- **Chamfer distance:** Symmetric average nearest-neighbour distance between two point sets; a combined accuracy/completeness score.
- **Checkpoint (CP):** A surveyed point withheld from the adjustment and used only to measure accuracy.
- **Completeness:** Fraction of ground-truth surface within a threshold of the reconstruction (recall).
- **Cubemap:** Six 90° perspective images on the faces of a cube, used to represent a full sphere with pinhole cameras.
- **D-SSIM:** $1-\mathrm{SSIM}$ (often halved), a structural-similarity loss term used with L1 in 3DGS.
- **Densification:** Adding Gaussians (by cloning or splitting) in under- or over-reconstructed regions.
- **Depth fusion:** Merging per-view depth maps into one consistent point cloud or volume.
- **Distortion model:** Parametric correction (radial, tangential, fisheye) for deviation of a real lens from the pinhole model.
- **Drift:** Accumulation of small pose errors over a trajectory, causing growing global error and scale inconsistency.
- **DUSt3R:** A transformer (CVPR 2024) that regresses dense pointmaps for an image pair in a common frame, from which poses and depth follow.
- **Epipolar line / great circle:** The locus in image 2 where a point from image 1 must appear; a line for pinhole cameras, a great circle for spherical ones.
- **Equirectangular projection (ERP):** Panorama format mapping longitude and latitude linearly to image columns and rows.
- **Essential matrix:** $\mathbf{E}=[\mathbf{t}]_\times\mathbf{R}$, encoding calibrated relative pose up to scale; satisfies $\hat{\mathbf{x}}_2^\top\mathbf{E}\hat{\mathbf{x}}_1=0$.
- **EWA splatting:** Elliptical-weighted-average projection of 3D Gaussian kernels to 2D via a local affine approximation; the basis of 3DGS rasterisation.
- **Extrinsics:** Rotation and translation relating world and camera coordinates.
- **F-score:** Harmonic mean of precision and recall at a distance threshold.
- **Feed-forward reconstruction:** Predicting cameras and geometry in one network pass without per-scene optimisation (DUSt3R, VGGT, MapAnything).
- **Fisheye lens:** Very wide-angle lens (≥180° possible) modelled by mapping ray angle to image radius rather than by a distorted pinhole.
- **Floater:** A spurious semi-transparent primitive in free space that explains view-specific effects in training images.
- **Fundamental matrix:** Uncalibrated counterpart of the essential matrix, $\mathbf{F}=\mathbf{K}_2^{-\top}\mathbf{E}\mathbf{K}_1^{-1}$, 7 DoF.
- **Gauge freedom:** The 7-DoF similarity ambiguity (position, orientation, scale) under which BA's cost is invariant; must be fixed externally.
- **Gaussian Splatting (3DGS):** Scene representation as anisotropic 3D Gaussians with opacity and SH colour, optimised through a differentiable tile rasteriser (Kerbl et al., SIGGRAPH 2023).
- **Global SfM:** SfM that solves all camera rotations and positions jointly (rotation/translation averaging or global positioning) before one BA.
- **GLOMAP:** Global SfM system (ECCV 2024) integrated into COLMAP since 4.0.
- **Ground control point (GCP):** Surveyed point used inside the adjustment to fix datum and scale and limit drift.
- **Hash encoding:** Instant-NGP's multiresolution grids of trainable features stored in hash tables.
- **Homogeneous coordinates:** Coordinates with an extra component, defined up to scale, that make projective maps linear.
- **Homography:** $3\times3$ projective map between two images of a plane, or between images under pure rotation.
- **Incremental SfM:** SfM that grows the reconstruction one image at a time with PnP, triangulation and repeated BA (COLMAP's default).
- **Intrinsics:** Internal camera parameters: focal length, principal point, skew and distortion.
- **Levenberg–Marquardt:** Damped Gauss–Newton method interpolating between Gauss–Newton and gradient descent; the standard BA solver.
- **LightGlue:** Adaptive attention-based keypoint matcher (ICCV 2023), successor to SuperGlue.
- **Loop closure:** Recognising a revisited place and adding a constraint that corrects accumulated drift; false ones fold the map.
- **MASt3R:** DUSt3R extension (ECCV 2024) with dense descriptors for 3D-grounded matching.
- **Mip-NeRF 360:** NeRF variant (CVPR 2022) for unbounded scenes captured by orbiting cameras; "360" does not mean panoramic input.
- **Multi-view stereo (MVS):** Dense per-pixel depth estimation from many calibrated images.
- **NeRF:** Neural radiance field: an MLP mapping position and direction to density and colour, rendered by volume rendering.
- **Neural SDF:** A network representing a signed distance function, rendered via an SDF-to-density mapping (NeuS, VolSDF).
- **Opacity reset:** Periodically lowering all Gaussian opacities during 3DGS training so unneeded Gaussians can be pruned.
- **ORB:** Fast binary feature (oriented FAST + rotated BRIEF) used in ORB-SLAM.
- **PatchMatch:** Randomised propagate-and-refine algorithm for dense correspondence, used for per-pixel depth/normal estimation in MVS.
- **Perspective-n-Point (PnP):** Estimating camera pose from known 3D points and their 2D projections.
- **Photo-consistency:** The assumption that a surface point looks the same in all views; violated by specular, textureless or moving surfaces.
- **Pinhole model:** Ideal central projection through a single point onto an image plane.
- **Pointmap:** Per-pixel 3D coordinates in a chosen frame, the output representation of DUSt3R-family models.
- **Poisson surface reconstruction:** Fitting a smooth indicator function to oriented points and extracting its level set as a watertight mesh.
- **Pose graph:** Graph of camera poses with relative-pose constraints, optimised to distribute loop-closure corrections.
- **Precision (survey sense):** Repeatability or spread of estimates, independent of bias.
- **RANSAC:** Random sample consensus: robust model fitting by repeated minimal-sample hypotheses and inlier counting.
- **Relative pose error (RPE):** Error in relative motion over a fixed interval; measures local drift.
- **Reprojection error:** Pixel distance between an observed feature and the projection of its 3D point; measures self-consistency, not accuracy.
- **Rig:** Several cameras with fixed, known (or jointly estimated) relative poses, reconstructed as one unit.
- **Rolling shutter:** Sensor readout row by row, so different image rows are captured at different times; causes skew under fast motion.
- **Rotation averaging:** Estimating absolute camera rotations from many noisy relative rotations.
- **Scale ambiguity:** Monocular reconstructions are recoverable only up to a global scale factor.
- **Schur complement:** Algebraic elimination of point variables in BA, leaving a smaller reduced camera system.
- **SIFT:** Scale-invariant feature transform: DoG keypoints with 128-D gradient-histogram descriptors.
- **Sim(3):** The 7-DoF group of similarity transforms (rotation, translation, uniform scale).
- **SLAM:** Simultaneous localisation and mapping: online, causal estimation of trajectory and map from a sensor stream.
- **Spherical harmonics (SH):** Orthonormal basis on the sphere; 3DGS stores view-dependent colour as SH coefficients (degree 3 by default).
- **Structure from Motion (SfM):** Recovering camera poses and sparse 3D structure from overlapping images.
- **SuperPoint:** Self-supervised CNN for joint keypoint detection and description.
- **Tile-based rasterisation:** Splitting the screen into tiles, sorting overlapping Gaussians per tile by depth, and compositing per pixel in parallel.
- **Transmittance:** Fraction of light surviving along a ray up to a point, $T=\exp(-\int\sigma)$ or $\prod(1-\alpha)$.
- **Triangulation:** Estimating a 3D point from its projections in two or more views with known poses.
- **TSDF:** Truncated signed distance function accumulated in a voxel grid to fuse depth maps; meshed with marching cubes.
- **Unscented transform:** Propagating a Gaussian through a non-linear function by mapping sigma points and refitting; used by 3DGUT for exact camera models.
- **Vocabulary tree:** Hierarchical quantisation of descriptors into visual words for fast image retrieval and loop detection.
- **Volume rendering:** Integrating density-weighted colour along a ray to produce a pixel value.

---
## Interactive component suggestions

1. **Pinhole and equirectangular projection playground.** *Teaches:* intrinsics/extrinsics, the effect of focal length and distortion, and how the same 3D scene maps into a pinhole image vs an ERP panorama. *Inputs:* sliders for $f$, $c_x, c_y$, $k_1$, camera yaw/pitch/position; toggle pinhole/fisheye(equidistant)/ERP. *Outputs:* a wireframe "parking bay" (pillars, floor grid) projected live; points behind the camera greyed out in pinhole mode but visible in ERP. *Math:* $\lambda\tilde{\mathbf{x}}=\mathbf{K}[\mathbf{R}\mid\mathbf{t}]\tilde{\mathbf{X}}$; $r=f\theta$; $u=\tfrac{W}{2\pi}(\phi+\pi)$, $v=\tfrac{H}{\pi}(\tfrac\pi2-\theta)$.

2. **Triangulation with noisy rays.** *Teaches:* why baseline and angle control depth uncertainty; why depth error grows quadratically with distance. *Inputs:* two draggable cameras in a 2D top view, pixel-noise $\sigma$, number of Monte-Carlo trials. *Outputs:* scatter cloud of triangulated points and its covariance ellipse; readout of depth std vs the approximation $Z^2\sigma/(fB)$. *Math:* midpoint or DLT triangulation; error propagation.

3. **Scale ambiguity and drift with markers.** *Teaches:* monocular reconstruction is up to scale; one global Sim(3) fixes scale at markers but not drift between them; GCPs inside BA do. *Inputs:* a 1D/2D corridor trajectory with a slider for per-step scale drift; toggles "align with 2 markers (post-hoc Sim(3))" vs "constrain all markers in BA"; choose which markers are GCPs vs checkpoints. *Outputs:* reconstructed vs true corridor, checkpoint RMSE and % distance error, and reprojection error (which stays small throughout, showing it is not accuracy). *Math:* Umeyama Sim(3) closed form; least squares with soft constraints.

4. **False loop closure in a repetitive garage.** *Teaches:* how identical pillars produce consistent wrong matches that RANSAC accepts and how BA then "folds" the map while keeping residuals low. *Inputs:* a 2D pose-graph of a loop through repeated bays; button to add a wrong loop edge (bay 3 ↔ bay 7); robust-kernel toggle. *Outputs:* optimised trajectory before/after, per-edge residuals, ATE vs ground truth. *Math:* 2D pose-graph optimisation with Gauss–Newton/LM, Huber/Cauchy kernels.

5. **Bundle-adjustment intuition (2D).** *Teaches:* LM damping, convergence basin, sparsity of $\mathbf{J}^\top\mathbf{J}$, and gauge freedom. *Inputs:* perturbation magnitude of initial poses; $\mu$ schedule; toggle "fix first camera + scale". *Outputs:* cost per iteration, animated cameras/points, a heat map of the $\mathbf{J}^\top\mathbf{J}$ sparsity pattern, and the null-space directions when the gauge is not fixed. *Math:* $(\mathbf{J}^\top\mathbf{J}+\mu\mathbf{D})\boldsymbol\delta=-\mathbf{J}^\top\mathbf{r}$; Schur complement.

6. **2D Gaussian splat fitting toy (+ ERP↔cubemap mapper as a tab).** *Teaches:* how anisotropic Gaussians, alpha compositing and clone/split/prune fit an image, and why photometric fitting does not imply correct geometry. *Inputs:* a target image (e.g. a garage photo crop), number of initial Gaussians, densification threshold, opacity-reset toggle; second tab: an ERP image and a yaw/pitch/FoV for virtual perspective views. *Outputs:* live render vs target, Gaussian ellipses overlay, loss curve; in the second tab, the six cube faces or $N$ overlapping views and their seams. *Math:* $\boldsymbol\Sigma=\mathbf{R}\mathbf{S}\mathbf{S}^\top\mathbf{R}^\top$, compositing $\sum c_k\alpha_k\prod(1-\alpha_j)$, L1+D-SSIM; ray→$(\phi,\theta)$ sampling for the mapper.

---

## Handoff

- **Reprojection error and PSNR are not accuracy metrics.** All downstream agents must report accuracy as checkpoint RMSE and marker-pair distance error (%), with markers split into GCPs (used in BA) and held-out checkpoints.
- **Scale and drift:** monocular/360° video gives scale only up to a factor and can drift; a post-hoc Sim(3) to two markers is insufficient. Markers (or measured distances) should enter BA as constraints.
- **Repetitive structure is the main geometric risk:** RANSAC does not reject consistent wrong matches between identical pillars/bays; prefer sequential matching with temporal priors, conservative loop acceptance and pose-graph sanity checks. Stronger learned matchers can make this worse, not better.
- **360° handling:** COLMAP 4.1.0's changelog states native equirectangular models are faster but less accurate than rendering perspective views (`panorama_sfm`, treated as a rig with known extrinsics). Default to virtual perspective rigs; keep stitch-seam parallax in mind and consider raw dual-fisheye if available.
- **3DGS is not metric by itself:** scale and frame come from SfM; geometry comes from a photometric objective. Use SfM+BA as the metric backbone and validate any splat-derived geometry (2DGS, GOF, PGSR, RaDe-GS) on checkpoints.
- **Appearance modelling is mandatory** for dim/flickering light (bilateral grid, per-image embeddings, exposure compensation); vanilla 3DGS does not handle exposure changes.
- **Camera-model fidelity:** EWA's affine projection is a pinhole approximation; for fisheye/ERP/rolling shutter, 3DGUT (Apache-2.0, in gsplat) or native omnidirectional splatting (OmniGS, ODGS) are the relevant options.
- **Licences:** INRIA 3DGS and its derivatives (Mip-Splatting, SuGaR, 2DGS, GOF, RaDe-GS) are non-commercial; PGSR is research/non-profit only; DUSt3R/MASt3R are CC BY-NC-SA 4.0; Instant-NGP and Neuralangelo use NVIDIA non-commercial licences. COLMAP (BSD), gsplat/nerfstudio/3dgrut (Apache-2.0), LightGlue (Apache-2.0, SuperPoint weights excluded), RoMa (MIT), ODGS (MIT) are permissive.
- **16 GB GPU:** the INRIA reference asks for 24 GB at paper quality; gsplat reports up to 4× less memory, and Hierarchical 3DGS / chunking is the route for a full garage.
- **Feed-forward models (VGGT, MASt3R, MapAnything)** are useful initialisers/matchers at ~512 px resolution but should be refined with BA and never trusted for metric scale without markers.

```json
[
{"key": "Kerbl2023", "title": "3D Gaussian Splatting for Real-Time Radiance Field Rendering", "authors": "Bernhard Kerbl, Georgios Kopanas, Thomas Leimkühler, George Drettakis", "venue": "ACM Transactions on Graphics 42(4) (SIGGRAPH 2023)", "year": 2023, "url": "https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/", "code": "https://github.com/graphdeco-inria/gaussian-splatting", "license": "Inria/MPII Gaussian-Splatting License (non-commercial research and evaluation)", "type": "paper", "verified": true, "note": "BibTeX, defaults and licence read from official README/LICENSE"},
{"key": "Kerbl2024Hier", "title": "A Hierarchical 3D Gaussian Representation for Real-Time Rendering of Very Large Datasets", "authors": "Bernhard Kerbl, Andreas Meuleman, Georgios Kopanas, Michael Wimmer, Alexandre Lanvin, George Drettakis", "venue": "ACM Transactions on Graphics", "year": 2024, "url": "https://github.com/graphdeco-inria/hierarchical-3d-gaussians", "code": "https://github.com/graphdeco-inria/hierarchical-3d-gaussians", "license": null, "type": "paper", "verified": true, "note": "BibTeX from official README; licence not checked"},
{"key": "Zwicker2001", "title": "EWA Volume Splatting", "authors": "Matthias Zwicker, Hanspeter Pfister, Jeroen van Baar, Markus Gross", "venue": "IEEE Visualization 2001", "year": 2001, "url": "https://www.merl.com/publications/TR2001-27", "code": null, "license": null, "type": "paper", "verified": true, "note": "search-index confirmation only (multiple consistent records)"},
{"key": "Mildenhall2020", "title": "NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis", "authors": "Ben Mildenhall, Pratul P. Srinivasan, Matthew Tancik, Jonathan T. Barron, Ravi Ramamoorthi, Ren Ng", "venue": "ECCV", "year": 2020, "url": "https://arxiv.org/abs/2003.08934", "code": "https://github.com/bmild/nerf", "license": null, "type": "paper", "verified": true, "note": "BibTeX from official README"},
{"key": "Tancik2020", "title": "Fourier Features Let Networks Learn High Frequency Functions in Low Dimensional Domains", "authors": "Matthew Tancik, Pratul P. Srinivasan, Ben Mildenhall, Sara Fridovich-Keil, Nithin Raghavan, Utkarsh Singhal, Ravi Ramamoorthi, Jonathan T. Barron, Ren Ng", "venue": "NeurIPS", "year": 2020, "url": "https://arxiv.org/abs/2006.10739", "code": null, "license": null, "type": "paper", "verified": true, "note": "arXiv abstract page/API opened"},
{"key": "Barron2022", "title": "Mip-NeRF 360: Unbounded Anti-Aliased Neural Radiance Fields", "authors": "Jonathan T. Barron, Ben Mildenhall, Dor Verbin, Pratul P. Srinivasan, Peter Hedman", "venue": "CVPR", "year": 2022, "url": "https://arxiv.org/abs/2111.12077", "code": "https://github.com/google-research/multinerf", "license": "Apache-2.0 (multinerf LICENSE)", "type": "paper", "verified": true, "note": "CVF open-access record opened"},
{"key": "Mueller2022", "title": "Instant Neural Graphics Primitives with a Multiresolution Hash Encoding", "authors": "Thomas Müller, Alex Evans, Christoph Schied, Alexander Keller", "venue": "ACM Transactions on Graphics", "year": 2022, "url": "https://nvlabs.github.io/instant-ngp/", "code": "https://github.com/NVlabs/instant-ngp", "license": "NVIDIA Source Code License (non-commercial)", "type": "paper", "verified": true, "note": "BibTeX from official README"},
{"key": "Barron2023", "title": "Zip-NeRF: Anti-Aliased Grid-Based Neural Radiance Fields", "authors": "Jonathan T. Barron, Ben Mildenhall, Dor Verbin, Pratul P. Srinivasan, Peter Hedman", "venue": "ICCV", "year": 2023, "url": "https://arxiv.org/abs/2304.06706", "code": "https://github.com/jonbarron/camp_zipnerf", "license": null, "type": "paper", "verified": true, "note": "CVF open-access record opened"},
{"key": "Wang2021NeuS", "title": "NeuS: Learning Neural Implicit Surfaces by Volume Rendering for Multi-view Reconstruction", "authors": "Peng Wang, Lingjie Liu, Yuan Liu, Christian Theobalt, Taku Komura, Wenping Wang", "venue": "NeurIPS", "year": 2021, "url": "https://arxiv.org/abs/2106.10689", "code": "https://github.com/Totoro97/NeuS", "license": null, "type": "paper", "verified": true, "note": "authors from arXiv/README; NeurIPS 2021 venue via Semantic Scholar"},
{"key": "Yariv2021", "title": "Volume Rendering of Neural Implicit Surfaces", "authors": "Lior Yariv, Jiatao Gu, Yoni Kasten, Yaron Lipman", "venue": "NeurIPS", "year": 2021, "url": "https://arxiv.org/abs/2106.12052", "code": "https://github.com/lioryariv/volsdf", "license": null, "type": "paper", "verified": true, "note": "BibTeX from official README"},
{"key": "Li2023", "title": "Neuralangelo: High-Fidelity Neural Surface Reconstruction", "authors": "Zhaoshuo Li, Thomas Müller, Alex Evans, Russell H. Taylor, Mathias Unberath, Ming-Yu Liu, Chen-Hsuan Lin", "venue": "CVPR", "year": 2023, "url": "https://research.nvidia.com/labs/dir/neuralangelo/", "code": "https://github.com/NVlabs/neuralangelo", "license": "NVIDIA Source Code License for Neuralangelo (non-commercial)", "type": "paper", "verified": true, "note": "BibTeX and licence header from official repo"},
{"key": "Wang2024DUSt3R", "title": "DUSt3R: Geometric 3D Vision Made Easy", "authors": "Shuzhe Wang, Vincent Leroy, Yohann Cabon, Boris Chidlovskii, Jerome Revaud", "venue": "CVPR", "year": 2024, "url": "https://arxiv.org/abs/2312.14132", "code": "https://github.com/naver/dust3r", "license": "CC BY-NC-SA 4.0", "type": "paper", "verified": true, "note": "BibTeX and licence from official README"},
{"key": "Leroy2024", "title": "Grounding Image Matching in 3D with MASt3R", "authors": "Vincent Leroy, Yohann Cabon, Jerome Revaud", "venue": "ECCV", "year": 2024, "url": "https://arxiv.org/abs/2406.09756", "code": "https://github.com/naver/mast3r", "license": "CC BY-NC-SA 4.0", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo"},
{"key": "Duisterhof2025", "title": "MASt3R-SfM: a Fully-Integrated Solution for Unconstrained Structure-from-Motion", "authors": "Bardienus Pieter Duisterhof, Lojze Zust, Philippe Weinzaepfel, Vincent Leroy, Yohann Cabon, Jerome Revaud", "venue": "International Conference on 3D Vision (3DV)", "year": 2025, "url": "https://github.com/naver/mast3r", "code": "https://github.com/naver/mast3r", "license": "CC BY-NC-SA 4.0", "type": "paper", "verified": true, "note": "BibTeX from MASt3R README"},
{"key": "Wang2025VGGT", "title": "VGGT: Visual Geometry Grounded Transformer", "authors": "Jianyuan Wang, Minghao Chen, Nikita Karaev, Andrea Vedaldi, Christian Rupprecht, David Novotny", "venue": "CVPR", "year": 2025, "url": "https://github.com/facebookresearch/vggt", "code": "https://github.com/facebookresearch/vggt", "license": "Custom licence permitting commercial use (excl. military) since July 2025; only VGGT-1B-Commercial checkpoint is commercial, original checkpoint non-commercial", "type": "paper", "verified": true, "note": "BibTeX and licence notes from official README"},
{"key": "Wang2025Pi3", "title": "π³: Permutation-Equivariant Visual Geometry Learning", "authors": "Yifan Wang, Jianjun Zhou, Haoyi Zhu, Wenzheng Chang, Yang Zhou, Zizun Li, Junyi Chen, Jiangmiao Pang, Chunhua Shen, Tong He", "venue": "arXiv:2507.13347", "year": 2025, "url": "https://github.com/yyfz/Pi3", "code": "https://github.com/yyfz/Pi3", "license": null, "type": "paper", "verified": true, "note": "BibTeX from official README"},
{"key": "Keetha2026", "title": "MapAnything: Universal Feed-Forward Metric 3D Reconstruction", "authors": "Nikhil Keetha, Norman Müller, Johannes Schönberger, Lorenzo Porzi, Yuchen Zhang, Tobias Fischer, Arno Knapitsch, Duncan Zauss, Ethan Weber, Nelson Antunes, Jonathon Luiten, Manuel Lopez-Antequera, Samuel Rota Bulò, Christian Richardt, Deva Ramanan, Sebastian Scherer, Peter Kontschieder", "venue": "International Conference on 3D Vision (3DV)", "year": 2026, "url": "https://github.com/facebookresearch/map-anything", "code": "https://github.com/facebookresearch/map-anything", "license": "Apache-2.0 model variant available (facebook/map-anything-apache); default model licence not checked", "type": "paper", "verified": true, "note": "BibTeX from official README"},
{"key": "DeTone2018", "title": "SuperPoint: Self-Supervised Interest Point Detection and Description", "authors": "Daniel DeTone, Tomasz Malisiewicz, Andrew Rabinovich", "venue": "CVPR Deep Learning for Visual SLAM Workshop", "year": 2018, "url": "https://arxiv.org/abs/1712.07629", "code": "https://github.com/magicleap/SuperPointPretrainedNetwork", "license": "Magic Leap licence (non-commercial)", "type": "paper", "verified": true, "note": "BibTeX from official README"},
{"key": "Sarlin2020", "title": "SuperGlue: Learning Feature Matching with Graph Neural Networks", "authors": "Paul-Edouard Sarlin, Daniel DeTone, Tomasz Malisiewicz, Andrew Rabinovich", "venue": "CVPR", "year": 2020, "url": "https://arxiv.org/abs/1911.11763", "code": "https://github.com/magicleap/SuperGluePretrainedNetwork", "license": null, "type": "paper", "verified": true, "note": "BibTeX from hloc README"},
{"key": "Sarlin2019", "title": "From Coarse to Fine: Robust Hierarchical Localization at Large Scale", "authors": "Paul-Edouard Sarlin, Cesar Cadena, Roland Siegwart, Marcin Dymczyk", "venue": "CVPR", "year": 2019, "url": "https://arxiv.org/abs/1812.03506", "code": "https://github.com/cvg/Hierarchical-Localization", "license": "Apache-2.0", "type": "paper", "verified": true, "note": "arXiv API: authors, 'Camera-ready for CVPR 2019'"},
{"key": "Lindenberger2023", "title": "LightGlue: Local Feature Matching at Light Speed", "authors": "Philipp Lindenberger, Paul-Edouard Sarlin, Marc Pollefeys", "venue": "ICCV", "year": 2023, "url": "https://arxiv.org/abs/2306.13643", "code": "https://github.com/cvg/LightGlue", "license": "Apache-2.0 (SuperPoint weights under separate restrictive licence)", "type": "paper", "verified": true, "note": "BibTeX and licence from official README"},
{"key": "Sun2021", "title": "LoFTR: Detector-Free Local Feature Matching with Transformers", "authors": "Jiaming Sun, Zehong Shen, Yuang Wang, Hujun Bao, Xiaowei Zhou", "venue": "CVPR", "year": 2021, "url": "https://arxiv.org/abs/2104.00680", "code": "https://github.com/zju3dv/LoFTR", "license": "Apache-2.0", "type": "paper", "verified": true, "note": "BibTeX and licence from official README"},
{"key": "Edstedt2024", "title": "RoMa: Robust Dense Feature Matching", "authors": "Johan Edstedt, Qiyu Sun, Georg Bökman, Mårten Wadenbäck, Michael Felsberg", "venue": "CVPR", "year": 2024, "url": "https://arxiv.org/abs/2305.15404", "code": "https://github.com/Parskatt/RoMa", "license": "MIT (DINOv2 Apache-2.0)", "type": "paper", "verified": true, "note": "BibTeX and licence from official README"},
{"key": "Lowe2004", "title": "Distinctive Image Features from Scale-Invariant Keypoints", "authors": "David G. Lowe", "venue": "International Journal of Computer Vision 60(2)", "year": 2004, "url": "https://doi.org/10.1023/B:VISI.0000029664.99615.94", "code": null, "license": null, "type": "paper", "verified": true, "note": "verified via Semantic Scholar metadata (DOI lookup); publisher page not opened"},
{"key": "Rublee2011", "title": "ORB: An efficient alternative to SIFT or SURF", "authors": "Ethan Rublee, Vincent Rabaud, Kurt Konolige, Gary Bradski", "venue": "ICCV", "year": 2011, "url": "https://doi.org/10.1109/ICCV.2011.6126544", "code": null, "license": null, "type": "paper", "verified": true, "note": "verified via Semantic Scholar metadata (DOI lookup); publisher page not opened"},
{"key": "Nister2006", "title": "Scalable Recognition with a Vocabulary Tree", "authors": "David Nistér, Henrik Stewénius", "venue": "CVPR", "year": 2006, "url": "https://doi.org/10.1109/CVPR.2006.264", "code": null, "license": null, "type": "paper", "verified": true, "note": "verified via Semantic Scholar metadata (DOI lookup); publisher page not opened"},
{"key": "Nister2004", "title": "An Efficient Solution to the Five-Point Relative Pose Problem", "authors": "David Nistér", "venue": "IEEE TPAMI 26(6)", "year": 2004, "url": "https://doi.org/10.1109/TPAMI.2004.17", "code": null, "license": null, "type": "paper", "verified": true, "note": "verified via Semantic Scholar metadata (DOI lookup); publisher page not opened"},
{"key": "Fischler1981", "title": "Random Sample Consensus: A Paradigm for Model Fitting with Applications to Image Analysis and Automated Cartography", "authors": "Martin A. Fischler, Robert C. Bolles", "venue": "Communications of the ACM 24(6)", "year": 1981, "url": "https://doi.org/10.1145/358669.358692", "code": null, "license": null, "type": "paper", "verified": true, "note": "verified via Semantic Scholar metadata (DOI lookup); publisher page not opened"},
{"key": "Lepetit2009", "title": "EPnP: An Accurate O(n) Solution to the PnP Problem", "authors": "Vincent Lepetit, Francesc Moreno-Noguer, Pascal Fua", "venue": "International Journal of Computer Vision 81(2)", "year": 2009, "url": "https://doi.org/10.1007/s11263-008-0152-6", "code": null, "license": null, "type": "paper", "verified": false, "note": "from domain knowledge; page not opened (network restricted)"},
{"key": "Triggs2000", "title": "Bundle Adjustment — A Modern Synthesis", "authors": "Bill Triggs, Philip F. McLauchlan, Richard I. Hartley, Andrew W. Fitzgibbon", "venue": "Vision Algorithms: Theory and Practice (ICCV 1999 workshop), LNCS 1883, pp. 298–372", "year": 2000, "url": "https://hal.inria.fr/inria-00548290", "code": null, "license": null, "type": "paper", "verified": true, "note": "search-index confirmation; workshop 1999, LNCS volume dated 2000"},
{"key": "Snavely2006", "title": "Photo Tourism: Exploring Photo Collections in 3D", "authors": "Noah Snavely, Steven M. Seitz, Richard Szeliski", "venue": "ACM SIGGRAPH (ACM TOG 25(3))", "year": 2006, "url": "https://doi.org/10.1145/1141911.1141964", "code": null, "license": null, "type": "paper", "verified": false, "note": "from domain knowledge; page not opened (network restricted)"},
{"key": "Wu2013", "title": "Towards Linear-Time Incremental Structure from Motion", "authors": "Changchang Wu", "venue": "International Conference on 3D Vision (3DV)", "year": 2013, "url": "https://doi.org/10.1109/3DV.2013.25", "code": null, "license": null, "type": "paper", "verified": true, "note": "verified via Semantic Scholar metadata (DOI lookup); publisher page not opened"},
{"key": "Schoenberger2016SfM", "title": "Structure-from-Motion Revisited", "authors": "Johannes Lutz Schönberger, Jan-Michael Frahm", "venue": "CVPR", "year": 2016, "url": "https://colmap.github.io/", "code": "https://github.com/colmap/colmap", "license": "BSD (new BSD)", "type": "paper", "verified": true, "note": "BibTeX and licence from COLMAP README/LICENSE"},
{"key": "Schoenberger2016MVS", "title": "Pixelwise View Selection for Unstructured Multi-View Stereo", "authors": "Johannes Lutz Schönberger, Enliang Zheng, Marc Pollefeys, Jan-Michael Frahm", "venue": "ECCV", "year": 2016, "url": "https://colmap.github.io/", "code": "https://github.com/colmap/colmap", "license": "BSD (new BSD)", "type": "paper", "verified": true, "note": "BibTeX from COLMAP README"},
{"key": "Pan2024", "title": "Global Structure-from-Motion Revisited", "authors": "Linfei Pan, Daniel Barath, Marc Pollefeys, Johannes Lutz Schönberger", "venue": "ECCV", "year": 2024, "url": "https://github.com/colmap/glomap", "code": "https://github.com/colmap/colmap", "license": "BSD", "type": "paper", "verified": true, "note": "BibTeX from GLOMAP and COLMAP READMEs; GLOMAP merged into COLMAP 4.0"},
{"key": "COLMAP-changelog", "title": "COLMAP CHANGELOG (releases 4.0.0–4.2.1)", "authors": "COLMAP developers", "venue": "Official release notes", "year": 2026, "url": "https://github.com/colmap/colmap/blob/main/CHANGELOG.rst", "code": "https://github.com/colmap/colmap", "license": "BSD", "type": "docs", "verified": true, "note": "opened directly; 4.1.0 spherical-model note, Caspar BA, EUCM, advancing-front meshing; 4.0.0 GLOMAP; 4.2.0 multi-component, LoMa"},
{"key": "COLMAP-rigs", "title": "COLMAP documentation: Rigs — Reconstruction from 360° spherical images", "authors": "COLMAP developers", "venue": "Official documentation (doc/rigs.rst)", "year": 2026, "url": "https://colmap.github.io/rigs.html", "code": "https://github.com/colmap/colmap", "license": "BSD", "type": "docs", "verified": true, "note": "opened via repository source"},
{"key": "COLMAP-cameras", "title": "COLMAP documentation: Camera Models", "authors": "COLMAP developers", "venue": "Official documentation (doc/cameras.rst)", "year": 2026, "url": "https://colmap.github.io/cameras.html", "code": "https://github.com/colmap/colmap", "license": "BSD", "type": "docs", "verified": true, "note": "opened via repository source"},
{"key": "Campos2021", "title": "ORB-SLAM3: An Accurate Open-Source Library for Visual, Visual-Inertial and Multi-Map SLAM", "authors": "Carlos Campos, Richard Elvira, Juan J. Gómez Rodríguez, José M. M. Montiel, Juan D. Tardós", "venue": "IEEE Transactions on Robotics 37(6), 1874–1890", "year": 2021, "url": "https://github.com/UZ-SLAMLab/ORB_SLAM3", "code": "https://github.com/UZ-SLAMLab/ORB_SLAM3", "license": "GPL-3.0", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo (README BibTeX abbreviates third author as Gómez, Juan J.)"},
{"key": "Curless1996", "title": "A Volumetric Method for Building Complex Models from Range Images", "authors": "Brian Curless, Marc Levoy", "venue": "ACM SIGGRAPH", "year": 1996, "url": "https://doi.org/10.1145/237170.237269", "code": null, "license": null, "type": "paper", "verified": true, "note": "verified via Semantic Scholar metadata (DOI lookup); publisher page not opened"},
{"key": "Kazhdan2013", "title": "Screened Poisson Surface Reconstruction", "authors": "Michael Kazhdan, Hugues Hoppe", "venue": "ACM Transactions on Graphics 32(3)", "year": 2013, "url": "https://doi.org/10.1145/2487228.2487237", "code": "https://github.com/mkazhdan/PoissonRecon", "license": null, "type": "paper", "verified": true, "note": "verified via Semantic Scholar metadata (DOI lookup); publisher page not opened"},
{"key": "Griwodz2021", "title": "AliceVision Meshroom: An open-source 3D reconstruction pipeline", "authors": "Carsten Griwodz, Simone Gasparini, Lilian Calvet, Pierre Gurdjos, Fabien Castan, Benoit Maujean, Gregoire De Lillo, Yann Lanthony", "venue": "Proceedings of the 12th ACM Multimedia Systems Conference (MMSys '21)", "year": 2021, "url": "https://github.com/alicevision/Meshroom", "code": "https://github.com/alicevision/Meshroom", "license": "MPL-2.0", "type": "paper", "verified": true, "note": "BibTeX and licence from official repo"},
{"key": "OpenMVS", "title": "OpenMVS: open Multi-View Stereo reconstruction library", "authors": "cdcseacave and contributors", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/cdcseacave/openMVS", "code": "https://github.com/cdcseacave/openMVS", "license": "AGPL-3.0", "type": "repo", "verified": true, "note": "LICENSE read directly"},
{"key": "ODM", "title": "ODM - A command line toolkit to generate maps, point clouds, 3D models and DEMs from drone, balloon or kite images", "authors": "OpenDroneMap Authors", "venue": "GitHub repository", "year": 2020, "url": "https://github.com/OpenDroneMap/ODM", "code": "https://github.com/OpenDroneMap/ODM", "license": "AGPL-3.0", "type": "repo", "verified": true, "note": "citation and LICENSE from official repo"},
{"key": "Knapitsch2017", "title": "Tanks and Temples: Benchmarking Large-Scale Scene Reconstruction", "authors": "Arno Knapitsch, Jaesik Park, Qian-Yi Zhou, Vladlen Koltun", "venue": "ACM Transactions on Graphics 36(4)", "year": 2017, "url": "https://www.tanksandtemples.org/", "code": null, "license": null, "type": "paper", "verified": true, "note": "search-index confirmation only"},
{"key": "Sturm2012", "title": "A Benchmark for the Evaluation of RGB-D SLAM Systems", "authors": "Jürgen Sturm, Nikolas Engelhard, Felix Endres, Wolfram Burgard, Daniel Cremers", "venue": "IEEE/RSJ IROS", "year": 2012, "url": "https://cvg.cit.tum.de/data/datasets/rgbd-dataset", "code": null, "license": null, "type": "paper", "verified": true, "note": "search-index confirmation only"},
{"key": "Yu2024Mip", "title": "Mip-Splatting: Alias-free 3D Gaussian Splatting", "authors": "Zehao Yu, Anpei Chen, Binbin Huang, Torsten Sattler, Andreas Geiger", "venue": "CVPR", "year": 2024, "url": "https://niujinshuchong.github.io/mip-splatting/", "code": "https://github.com/autonomousvision/mip-splatting", "license": "Inria/MPII Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo"},
{"key": "Guedon2024", "title": "SuGaR: Surface-Aligned Gaussian Splatting for Efficient 3D Mesh Reconstruction and High-Quality Mesh Rendering", "authors": "Antoine Guédon, Vincent Lepetit", "venue": "CVPR", "year": 2024, "url": "https://anttwo.github.io/sugar/", "code": "https://github.com/Anttwo/SuGaR", "license": "Inria/MPII Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo"},
{"key": "Huang2024", "title": "2D Gaussian Splatting for Geometrically Accurate Radiance Fields", "authors": "Binbin Huang, Zehao Yu, Anpei Chen, Andreas Geiger, Shenghua Gao", "venue": "SIGGRAPH 2024 Conference Papers", "year": 2024, "url": "https://surfsplatting.github.io/", "code": "https://github.com/hbb1/2d-gaussian-splatting", "license": "Inria/MPII Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo"},
{"key": "Yu2024GOF", "title": "Gaussian Opacity Fields: Efficient Adaptive Surface Reconstruction in Unbounded Scenes", "authors": "Zehao Yu, Torsten Sattler, Andreas Geiger", "venue": "ACM Transactions on Graphics", "year": 2024, "url": "https://niujinshuchong.github.io/gaussian-opacity-fields/", "code": "https://github.com/autonomousvision/gaussian-opacity-fields", "license": "Inria/MPII Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo (arXiv title variant: '...Efficient High-quality Compact Surface Reconstruction...')"},
{"key": "Chen2024PGSR", "title": "PGSR: Planar-based Gaussian Splatting for Efficient and High-Fidelity Surface Reconstruction", "authors": "Danpeng Chen, Hai Li, Weicai Ye, Yifan Wang, Weijian Xie, Shangjin Zhai, Nan Wang, Haomin Liu, Hujun Bao, Guofeng Zhang", "venue": "arXiv:2406.06521 (README BibTeX)", "year": 2024, "url": "https://zju3dv.github.io/pgsr/", "code": "https://github.com/zju3dv/PGSR", "license": "Custom ZJU licence: educational, research and non-profit use only", "type": "paper", "verified": true, "note": "BibTeX and LICENSE.md from official repo; arXiv metadata confirmed"},
{"key": "Zhang2024RaDe", "title": "RaDe-GS: Rasterizing Depth in Gaussian Splatting", "authors": "Baowen Zhang, Chuan Fang, Rakesh Shrestha, Yixun Liang, Xiaoxiao Long, Ping Tan", "venue": "ACM Transactions on Graphics (accepted, per README); arXiv 2024", "year": 2024, "url": "https://baowenz.github.io/radegs/", "code": "https://github.com/BaowenZ/RaDe-GS", "license": "Inria/MPII Gaussian-Splatting License (non-commercial)", "type": "paper", "verified": true, "note": "authors and TOG acceptance from official README"},
{"key": "Wang2024BilaRF", "title": "Bilateral Guided Radiance Field Processing", "authors": "Yuehao Wang, Chaoyi Wang, Bingchen Gong, Tianfan Xue", "venue": "ACM Transactions on Graphics 43(4) (SIGGRAPH 2024)", "year": 2024, "url": "https://bilarfpro.github.io/", "code": "https://github.com/yuehaowang/bilarf", "license": null, "type": "paper", "verified": true, "note": "search-index confirmation only"},
{"key": "Kulhanek2024", "title": "WildGaussians: 3D Gaussian Splatting in the Wild", "authors": "Jonas Kulhanek, Songyou Peng, Zuzana Kukelova, Marc Pollefeys, Torsten Sattler", "venue": "NeurIPS", "year": 2024, "url": "https://wild-gaussians.github.io/", "code": "https://github.com/jkulhanek/wild-gaussians", "license": "MIT for repo code, but README asks users to follow the 3DGS and Mip-Splatting licences for the renderer (non-commercial)", "type": "paper", "verified": true, "note": "BibTeX from official README"},
{"key": "MoenneLoccoz2024", "title": "3D Gaussian Ray Tracing: Fast Tracing of Particle Scenes", "authors": "Nicolas Moenne-Loccoz, Ashkan Mirzaei, Or Perel, Riccardo de Lutio, Janick Martinez Esturo, Gavriel State, Sanja Fidler, Nicholas Sharp, Zan Gojcic", "venue": "ACM Transactions on Graphics (SIGGRAPH Asia 2024)", "year": 2024, "url": "https://github.com/nv-tlabs/3dgrut", "code": "https://github.com/nv-tlabs/3dgrut", "license": "Apache-2.0", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo"},
{"key": "Wu2025_3DGUT", "title": "3DGUT: Enabling Distorted Cameras and Secondary Rays in Gaussian Splatting", "authors": "Qi Wu, Janick Martinez Esturo, Ashkan Mirzaei, Nicolas Moenne-Loccoz, Zan Gojcic", "venue": "CVPR", "year": 2025, "url": "https://research.nvidia.com/labs/toronto-ai/3DGUT/", "code": "https://github.com/nv-tlabs/3dgrut", "license": "Apache-2.0", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo"},
{"key": "Seiskari2024", "title": "Gaussian Splatting on the Move: Blur and Rolling Shutter Compensation for Natural Camera Motion", "authors": "Otto Seiskari, Jerry Ylilammi, Valtteri Kaatrasalo, Pekka Rantalankila, Matias Turkulainen, Juho Kannala, Esa Rahtu, Arno Solin", "venue": "ECCV", "year": 2024, "url": "https://arxiv.org/abs/2403.13327", "code": "https://github.com/SpectacularAI/3dgs-deblur", "license": null, "type": "paper", "verified": true, "note": "authors from arXiv API; ECCV 2024 from search index; code per arXiv comment"},
{"key": "Li2025OmniGS", "title": "OmniGS: Fast Radiance Field Reconstruction using Omnidirectional Gaussian Splatting", "authors": "Longwei Li, Huajian Huang, Sai-Kit Yeung, Hui Cheng", "venue": "WACV", "year": 2025, "url": "https://liquorleaf.github.io/research/OmniGS/", "code": "https://github.com/LiquorLeaf/OmniGS", "license": null, "type": "paper", "verified": true, "note": "authors and venue from official README"},
{"key": "Lee2024ODGS", "title": "ODGS: 3D Scene Reconstruction from Omnidirectional Images with 3D Gaussian Splatting", "authors": "Suyoung Lee, Jaeyoung Chung, Jaeyoo Huh, Kyoung Mu Lee", "venue": "NeurIPS", "year": 2024, "url": "https://robot0321.github.io/odgs/index.html", "code": "https://github.com/esw0116/ODGS", "license": "MIT (README badge)", "type": "paper", "verified": true, "note": "authors and venue from official README"},
{"key": "Ye2025gsplat", "title": "gsplat: An open-source library for Gaussian splatting", "authors": "Vickie Ye, Ruilong Li, Justin Kerr, Matias Turkulainen, Brent Yi, Zhuoyang Pan, Otto Seiskari, Jianbo Ye, Jeffrey Hu, Matthew Tancik, Angjoo Kanazawa", "venue": "Journal of Machine Learning Research", "year": 2025, "url": "https://docs.gsplat.studio/", "code": "https://github.com/nerfstudio-project/gsplat", "license": "Apache-2.0", "type": "repo", "verified": true, "note": "BibTeX, news items and LICENSE from official repo"},
{"key": "Tancik2023", "title": "Nerfstudio: A Modular Framework for Neural Radiance Field Development", "authors": "Matthew Tancik, Ethan Weber, Evonne Ng, Ruilong Li, Brent Yi, Justin Kerr, Terrance Wang, Alexander Kristoffersen, Jake Austin, Kamyar Salahi, Abhik Ahuja, David McAllister, Angjoo Kanazawa", "venue": "ACM SIGGRAPH 2023 Conference Proceedings", "year": 2023, "url": "https://docs.nerf.studio/", "code": "https://github.com/nerfstudio-project/nerfstudio", "license": "Apache-2.0", "type": "paper", "verified": true, "note": "BibTeX and LICENSE from official repo"},
{"key": "Chen2024Survey", "title": "A Survey on 3D Gaussian Splatting", "authors": "Guikun Chen, Wenguan Wang", "venue": "ACM Computing Surveys (accepted, per arXiv comment); arXiv:2401.03890", "year": 2024, "url": "https://arxiv.org/abs/2401.03890", "code": "https://github.com/guikunchen/Awesome3DGS", "license": null, "type": "paper", "verified": true, "note": "arXiv abstract page opened"},
{"key": "Tewari2022", "title": "Advances in Neural Rendering", "authors": "Ayush Tewari, Justus Thies, Ben Mildenhall, Pratul Srinivasan, Edgar Tretschk, Yifan Wang, Christoph Lassner, Vincent Sitzmann, Ricardo Martin-Brualla, Stephen Lombardi, Tomas Simon, Christian Theobalt, Matthias Niessner, Jonathan T. Barron, Gordon Wetzstein, Michael Zollhoefer, Vladislav Golyanik", "venue": "Computer Graphics Forum 41(2) (Eurographics 2022 STAR)", "year": 2022, "url": "https://arxiv.org/abs/2111.05849", "code": null, "license": null, "type": "paper", "verified": true, "note": "arXiv abstract page opened (STAR at Eurographics 2022); CGF 41(2) from search index"},
{"key": "Chang2017", "title": "Matterport3D: Learning from RGB-D Data in Indoor Environments", "authors": "Angel Chang, Angela Dai, Thomas Funkhouser, Maciej Halber, Matthias Niessner, Manolis Savva, Shuran Song, Andy Zeng, Yinda Zhang", "venue": "International Conference on 3D Vision (3DV)", "year": 2017, "url": "https://niessner.github.io/Matterport/", "code": "https://github.com/niessner/Matterport", "license": "Dataset terms of use (signed agreement required)", "type": "paper", "verified": true, "note": "BibTeX and access terms from official README"},
{"key": "Armeni2017", "title": "Joint 2D-3D-Semantic Data for Indoor Scene Understanding", "authors": "Iro Armeni, Sasha Sax, Amir R. Zamir, Silvio Savarese", "venue": "arXiv:1702.01105", "year": 2017, "url": "https://github.com/alexsax/2D-3D-Semantics", "code": "https://github.com/alexsax/2D-3D-Semantics", "license": "Dataset licence agreement required", "type": "paper", "verified": true, "note": "BibTeX from official README"},
{"key": "Huang2024_360Loc", "title": "360Loc: A Dataset and Benchmark for Omnidirectional Visual Localization with Cross-device Queries", "authors": "Huajian Huang, Changkun Liu, Yipeng Zhu, Hui Cheng, Tristan Braud, Sai-Kit Yeung", "venue": "CVPR", "year": 2024, "url": "https://huajianup.github.io/research/360Loc/", "code": "https://github.com/HuajianUP/360Loc", "license": null, "type": "paper", "verified": true, "note": "authors and venue from official README"},
{"key": "Jung2025IM360", "title": "IM360: Large-scale Indoor Mapping with 360 Cameras", "authors": "Dongki Jung, Jaehoon Choi, Yonghan Lee, Dinesh Manocha", "venue": "ICCV", "year": 2025, "url": "https://arxiv.org/abs/2502.12545", "code": null, "license": null, "type": "paper", "verified": true, "note": "CVF open-access record and arXiv page opened; earlier arXiv v2 title differed; project page jdk9405.github.io/IM360"},
{"key": "RIGOR2026", "title": "RIGOR: Rig-Informed Geometry for Omnidirectional Reconstruction", "authors": "Tingjun Huang, Dmitry Rudshin, Mathieu Meyer, Pietro Bonazzi, Marc Pollefeys, Emilia Szymanska", "venue": "arXiv:2609.13504", "year": 2026, "url": "https://arxiv.org/abs/2609.13504", "code": "https://github.com/TangentH/RIGOR", "license": null, "type": "paper", "verified": true, "note": "arXiv API metadata and abstract read; code licence not checked"},
{"key": "ORBIT2026", "title": "ORBIT: Benchmarking SfM in the Wild with 360° Video (arXiv version: ORBIT++)", "authors": "Sara Sabour, Linyi Jin, Richard Tucker, Amir Hertz, Marcus Brubaker, Saurabh Saxena, Junhwa Hur, Andrea Tagliasacchi, Deqing Sun, David J. Fleet, Richard Szeliski, Noah Snavely", "venue": "CVPR", "year": 2026, "url": "https://arxiv.org/abs/2608.22039", "code": null, "license": null, "type": "paper", "verified": true, "note": "arXiv page opened (comment: a revision was accepted at CVPR 2026); project page orbit-sfm.github.io"},
{"key": "HZ2004", "title": "Multiple View Geometry in Computer Vision, 2nd edition", "authors": "Richard Hartley, Andrew Zisserman", "venue": "Cambridge University Press", "year": 2004, "url": "https://www.robots.ox.ac.uk/~vgg/hzbook/", "code": null, "license": null, "type": "official", "verified": false, "note": "canonical textbook; page not opened (network restricted)"},
{"key": "Szeliski2022", "title": "Computer Vision: Algorithms and Applications, 2nd edition", "authors": "Richard Szeliski", "venue": "Springer (Texts in Computer Science)", "year": 2022, "url": "https://szeliski.org/Book/", "code": null, "license": "Free PDF for personal use from author's site", "type": "official", "verified": true, "note": "search-index confirmation only"},
{"key": "Stachniss-Photo", "title": "Photogrammetry I & II (lecture course and YouTube recordings)", "authors": "Cyrill Stachniss (University of Bonn)", "venue": "Course page", "year": 2021, "url": "https://www.ipb.uni-bonn.de/photogrammetry-i-ii/", "code": null, "license": null, "type": "official", "verified": true, "note": "search-index confirmation only; slides by email request"},
{"key": "TUM-MVG", "title": "Computer Vision II: Multiple View Geometry (IN2228)", "authors": "Daniel Cremers (TUM)", "venue": "Course page", "year": 2025, "url": "https://cvg.cit.tum.de/teaching/online/mvg", "code": null, "license": null, "type": "official", "verified": true, "note": "search-index confirmation only; older recordings on YouTube"},
{"key": "CMU16385", "title": "16-385 Computer Vision", "authors": "Ioannis Gkioulekas (Spring 2018–2020 offerings) and others", "venue": "Carnegie Mellon University course page", "year": 2020, "url": "https://www.cs.cmu.edu/~16385/", "code": null, "license": null, "type": "official", "verified": true, "note": "search-index confirmation only"},
{"key": "CMU16825", "title": "16-825 Learning for 3D Vision", "authors": "Shubham Tulsiani", "venue": "Carnegie Mellon University course page", "year": 2025, "url": "https://learning3d.github.io/", "code": null, "license": null, "type": "official", "verified": true, "note": "search-index confirmation only"}
]
```
