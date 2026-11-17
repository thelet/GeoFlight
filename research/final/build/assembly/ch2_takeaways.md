### Key takeaways

- The whole pipeline is one optimisation story: features → matches → relative geometry (epipolar constraints, RANSAC) → triangulation and PnP → **bundle adjustment**, which jointly refines cameras and points by minimising reprojection error (§2.1, §2.2).
- **Reprojection error measures self-consistency, not accuracy.** A map folded by a false loop closure can still have low reprojection error. Accuracy must be measured on **held-out checkpoints** in metric units (§2.1, §2.2).
- Monocular and 360° video recover geometry only **up to scale**, and errors drift along the trajectory. Markers or measured distances should enter bundle adjustment as constraints; a post-hoc Sim(3) alignment fixes scale but not bending (§2.1).
- 3D Gaussian Splatting [Kerbl2023] is a differentiable rasteriser of anisotropic Gaussians optimised for **appearance**. Its geometry is not automatically metric or accurate, and vanilla 3DGS does **not** handle exposure changes without appearance modelling (§2.4).
- For 360° input, current tools are usually more accurate when panoramas are rendered into **perspective rigs** than when a native spherical model is used. COLMAP 4.1's release notes say this directly. It is the starting point for the camera-model choice in Ch. 4 (§2.5).
