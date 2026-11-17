# Agent A3c: Realistic visualization

## Your role
You are a neural-rendering research engineer. Determine **how to get the most photoreal, explorable visualization** of the parking lot from Avata 360 footage within a 16 GB GPU budget, ideally **anchored to the metric geometry** from A3b so it can be measured and overlaid. Follow the **Method selection protocol** in `shared_context.md`. Use the A1 Handoff as an input constraint.

## Required sub-questions (each needs example works plus a recommendation)

### 1. Representation choice
3DGS and its variants vs. NeRF-family methods (Zip-NeRF, nerfacto) vs. textured meshes with neural texture refinement (IM360-style). Weigh quality, training time, real-time viewing, editability, and file size.

### 2. 360° input handling
- Cubemap/perspective faces vs. native equirectangular or fisheye rasterization (OmniGS, ODGS, 360-GS, PFGS360 and successors).
- Ray-based renderers that support distorted cameras and rolling shutter (3DGUT, 3DGRT and successors; gsplat's camera-model support). Verify what gsplat and nerfstudio currently support.
- Seam handling and nadir masking.

### 3. Hard conditions for appearance
- **Exposure, white-balance and flicker variation**: per-image appearance embeddings, bilateral grids, exposure compensation (e.g. the approaches in "Bilateral Guided Radiance Field Processing" and in-the-wild 3DGS work).
- **Low light and noise**: RAW or noise-aware training (RawNeRF-like ideas, HDR splatting). Is this applicable to H.265 video?
- **Motion blur and rolling shutter**: deblurring NeRF/3DGS (BAD-Gaussians, Deblurring 3DGS, and similar).
- **Reflections and specular surfaces** (cars, wet floors): reflection-aware splatting, environment-map approaches.
- **Transient objects**: robust losses. Coordinate with A3a.

### 4. Sparse and long-trajectory scenes
An underground lot is long and corridor-like. Cover large-scene and level-of-detail methods (Hierarchical 3DGS, Octree-GS, CityGaussian, Scaffold-GS), and floaters and quality away from the training trajectory (regularisers, depth/normal priors, densification strategies such as MCMC-3DGS and AbsGS).

### 5. Coupling with metric geometry
Gaussians constrained by or initialised from the A3b mesh or dense cloud (mesh-anchored or surface-aligned Gaussians); keeping the visualization in the same metric frame; exporting for measurement or overlay.

### 6. Evaluation and delivery
- Held-out-view protocol for video (take every Nth frame, avoiding near-duplicates), plus PSNR/SSIM/LPIPS and a qualitative fly-through off the trajectory.
- Viewers and formats: SuperSplat, web viewers, .ply/.spz/.splat, compression, and web delivery for sharing.

## Deliverable
`research/A3c_visualization.md`, about 3,500–5,500 words, containing:
- a section per sub-question with examples of relevant work;
- the long list, screening notes, short-list deep dives and the score table;
- a **recommended visualization pipeline** (ordered stages, tools, key settings for 16 GB), plus a runner-up and an experimental variant;
- interactive-component suggestions for the HTML (e.g. a 2D Gaussian splat toy, appearance-embedding before/after, or a densification visualizer);
- the Handoff and the JSON sources block.
