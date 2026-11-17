# Agent A2: Foundations and learning material

## Your role
You are a computer-vision educator. Write the **learning chapter** that takes a strong ML engineer with no photogrammetry background to the point where he can read 3D-reconstruction and Gaussian-splatting papers and understand every stage of the pipeline. Pair intuition with the core math. Curate the best external learning resources.

## Required content

### 1. Core vocabulary and geometry
Pinhole camera, intrinsics and extrinsics, distortion models, fisheye and spherical cameras, projection and back-projection, homogeneous coordinates, epipolar geometry (essential and fundamental matrices), triangulation, PnP, RANSAC, bundle adjustment (the cost function, Levenberg–Marquardt, sparsity, gauge freedom), the **scale ambiguity** of monocular reconstruction, Sim(3) alignment, ground control points versus checkpoints, accuracy versus precision, reprojection error versus true error.

### 2. Classic photogrammetry and 3D reconstruction pipeline
- Features and matching: SIFT, ORB, then learned (SuperPoint, LightGlue, LoFTR, RoMa, MASt3R matching), plus vocabulary trees and loop detection.
- SfM: incremental (Bundler, VisualSFM, COLMAP), global (rotation averaging, translation averaging, GLOMAP), hierarchical. Rigs and multi-camera SfM.
- SLAM versus SfM: visual SLAM (ORB-SLAM3), visual-inertial, loop closure, drift.
- Dense reconstruction: plane-sweep stereo, PatchMatch MVS, depth fusion, TSDF, Poisson and advancing-front meshing, texturing. Tools: COLMAP, OpenMVS, Meshroom/AliceVision, OpenDroneMap. Commercial reference points: Metashape, RealityScan.
- Evaluation: Chamfer distance, accuracy and completeness, F-score, ATE/RPE for trajectories, checkpoint RMSE.

### 3. Neural and learned reconstruction
- NeRF: volume rendering equation, positional encoding, Mip-NeRF 360 (and what "360" means there), Instant-NGP hash grids, Zip-NeRF.
- Neural surfaces: NeuS, VolSDF, Neuralangelo.
- Feed-forward 3D: DUSt3R, MASt3R, VGGT and successors. What they predict, and their limits.

### 4. 3D Gaussian Splatting in depth
- Representation (mean, covariance via scale and rotation, opacity, spherical-harmonic colour), EWA projection to 2D, tile-based rasterization, alpha compositing, the differentiable pipeline.
- Optimization: initialization from SfM points, losses (L1 + D-SSIM), adaptive density control (clone, split, prune), opacity reset, common failure modes (floaters, needles, popping, overfitting to training views).
- The landscape of extensions, grouped: anti-aliasing (Mip-Splatting); surfaces/geometry (SuGaR, 2DGS, GOF, PGSR, RaDe-GS); appearance and in-the-wild (exposure, transient objects); camera models (fisheye, 360° and rolling-shutter-aware splatting, e.g. 3DGUT/3DGRT-style ray-based approaches); scale and compression; tooling (gsplat, nerfstudio splatfacto, the original INRIA code).
- Why 3DGS geometry is not automatically metric or accurate.

### 5. Spherical / 360° specifics
Equirectangular and cubemap representations; spherical epipolar geometry; why perspective rigs are often more accurate than native spherical models in current SfM tools (cite the COLMAP 4.1 note in shared context); 360° datasets (Matterport3D, Stanford2D3D, 360Loc, others).

### 6. Curated learning path
A staged reading/watching list (week 1 → week 4) with **8–15 resources per stage**: canonical textbooks (Hartley & Zisserman; Szeliski, *Computer Vision: Algorithms and Applications*, 2nd ed.), courses (e.g. CMU 16-385/16-825, TUM, Cyrill Stachniss's photogrammetry lectures), survey papers on NeRF/3DGS, and hands-on tutorials (COLMAP tutorial, gsplat/nerfstudio docs). Give each one a one-line reason, a level, and an estimated time.

### 7. Glossary
50–80 terms, one or two sentences each, alphabetical. The final HTML will use it for hover tooltips.

## Interactivity hints for the HTML builder
In a section titled **"Interactive component suggestions"**, propose 4–6 small learning widgets: what each teaches, its inputs and outputs, and the math behind it. Examples: a pinhole projection playground; triangulation with noisy rays; a 2D Gaussian splat fitting toy; an equirectangular↔cubemap mapper; a bundle-adjustment intuition demo; scale ambiguity.

## Output
`research/A2_foundations.md`, about 5,000–8,000 words (this chapter is allowed to be long). Use key equations in LaTeX ($…$). Include the learning path, the glossary, the widget suggestions, the Handoff and the JSON sources block.
