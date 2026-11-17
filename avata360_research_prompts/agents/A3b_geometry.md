# Agent A3b: Geometric accuracy

## Your role
You are a photogrammetry and 3D-vision research engineer. Determine **how to obtain the most accurate, metrically scaled geometry** of an underground parking lot from Avata 360 footage, from camera poses through to the final mesh, and how to **prove** that accuracy. Follow the **Method selection protocol** in `shared_context.md`. Use the A1 Handoff as an input constraint.

## Required sub-questions (each needs example works plus a recommendation)

### 1. Camera model and calibration
Perspective-rig decomposition (cubemap, N virtual views, the FOV/overlap choice) vs. native spherical models (COLMAP ≥4.1, OpenMVG, SphereSfM) vs. working from unstitched fisheye if it is obtainable (see A1). Self-calibration vs. pre-calibration. Handling of stitching error, and rolling-shutter modelling (does any SfM tool support it for 360°?).

### 2. Pose estimation (SfM / SLAM) in repetitive, low-texture indoor spaces
- Incremental vs. global SfM (COLMAP incremental, GLOMAP/COLMAP 4 global mapper), rig constraints, sequential matching plus loop detection, and COLMAP 4.2 multi-component mapping.
- 360°-specific pipelines: IM360, RIGOR, 360 SLAM (e.g. OpenVSLAM/stella_vslam, which supports equirectangular), and others from 2023–2026.
- Learned reconstruction and matchers: MASt3R-SfM, VGGT, π3 and successors; SuperPoint+LightGlue, ALIKED, RoMa, LoMa. Do they help on textureless concrete, and do they scale to hundreds or thousands of frames on 16 GB?
- **False loop closures / perceptual aliasing**: detection and prevention (Doppelgangers-style disambiguation, cycle consistency, sequential priors, view-graph pruning). Coordinate with A3a, which covers filtering; you own the SfM-side defences.
- **Priors**: gravity/IMU (gravity-aligned rotation averaging), planar or Manhattan constraints, known marker positions in bundle adjustment.

### 3. Metric scale and control
- Marker systems visible to a 360° camera (ArUco/AprilTag/coded targets): detection on equirectangular vs. cubemap images, required target size vs. distance, and placement strategy.
- Scale-only vs. full GCP-constrained bundle adjustment; Sim(3) alignment; the checkpoint protocol.
- Alternative scale sources: known parking-bay dimensions, laser distance meters, a phone LiDAR scan as reference.

### 4. Dense geometry
Compare COLMAP PatchMatch and OpenMVS (densify, mesh, refine) against surface-aligned Gaussian methods (2DGS, GOF, PGSR, RaDe-GS, successors), neural SDF (IM360's approach, Neuralangelo-class), and depth-prior fusion (monocular / multi-view depth with scale alignment). Focus on **textureless planar surfaces**, thin structures (pipes, railings) and reflective cars. Planar or Manhattan regularisation for indoor structures. Report the accuracy each method achieves on indoor benchmarks (DTU and Tanks & Temples are acceptable as context, but prefer ScanNet++, ETH3D, Replica, Matterport-like data) and its memory needs.

### 5. Accuracy evaluation and expectations
- An evaluation protocol: checkpoint distance error (mean, RMSE, max, % of distance), floor planarity, pillar-grid regularity, trajectory loop-closure gap, completeness. Optionally, comparison with a reference scan.
- **Realistic accuracy expectations**: from published 360° photogrammetry studies (e.g. surveying and cultural-heritage papers using 360° cameras that compare against TLS/laser scans), what accuracy have consumer 360° cameras achieved indoors? Give numbers with sources.

## Deliverable
`research/A3b_geometry.md`, about 4,000–6,000 words, containing:
- a section per sub-question with examples of relevant work;
- the long list, screening notes, short-list deep dives and the score table;
- a **recommended geometry pipeline** (ordered stages with tools and key settings), plus a runner-up and an experimental variant;
- the accuracy-evaluation protocol and an expected-accuracy table;
- interactive-component suggestions for the HTML (e.g. a "how scale error propagates" calculator, a loop-closure drift demo, or a seam-parallax-vs-distance plot);
- the Handoff and the JSON sources block.
