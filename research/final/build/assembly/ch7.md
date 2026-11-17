# Chapter 7: Open questions and research opportunities

This chapter gathers the open items from every chapter. They fall into three groups: facts to **measure on the device** before committing to parameters, **engineering unknowns** that decide between the primary path and its fallback, and **research gaps** where the project could contribute something publishable.

### 7.1 Measure on the device (Phase 0)

| # | Unknown | Why it matters | How to measure | Source |
|---|---|---|---|---|
| 1 | Inter-lens baseline *b* | Sets seam parallax (≈ b/d) and the offset between the two lens groups in the rig | Two-camera rig calibration with a board moved through the overlap band | §1.7, §4.1 |
| 2 | Rolling-shutter readout time and row direction per lens | Systematic skew during yaw (~2 px at 10°/s); decides whether the IMU rolling-shutter term (Option C) is needed | Count 100 Hz flicker bands per frame, or a fast-pan edge test | §1.7, §5.2, §6.3 |
| 3 | Factory calibration accuracy vs own fit | Every downstream camera model inherits it; the gate is ≤ 0.5 px on an independent board | Board clip shot in a hover; compare reprojection | §1.7, §6.8.3 |
| 4 | Airframe pixels per fisheye | Fixed per-lens masks | Temporal median of a hover clip | §1.7, §3.2.4 |
| 5 | Actual bitrate per mode | Compression budget per steradian | `ffprobe` on test clips | §1.7 |
| 6 | ISO vs repeatable keypoints on concrete | Choosing the ISO and lighting plan | Static scene at ISO 400–3200 | §1.7 |
| 7 | Defocus at 0.5–1.5 m (fixed focus rated 1.5 m–∞) | Minimum stand-off from walls and markers | Edge width on a board at known distances | §1.5.9, §1.7 |
| 8 | Vision-positioning behaviour in the target lot | Safety; ATTI drift over repeating patterns | 60 s hover-drift test at the lot's real lux | §1.5.8 |
| 9 | Metadata schema for your firmware (attitude, exposure fields) | Gravity priors; PPISP exposure priors | Parse with an OpenOSV-based reader; check gravity against a level surface | §1.4.2 |
| 10 | Quaternion-to-frame time offset | Every IMU-based gate and prior | Correlate IMU rate with optical flow | §6.1.7 |
| 11 | Link range and failsafe behaviour in the lot | Safety: link loss behind concrete; RTH without GNSS may become ATTI drift and an automatic landing | Walk the lot with the drone on the ground or in a low hover with a spotter; set the Signal Lost Action to Hover or Land | §1.5.8, §1.6 |

### 7.2 Engineering unknowns that decide primary vs fallback

- **FTheta refit residual.** gsplat's FTheta model lacks DJI's tangential terms. If the refit residual is above ~0.3 px, pre-warp the images or fall back to the virtual-view splat (§6.1.3, §6.8.2).
- **Splat `max_angle`.** The Phase-0a sweep {80°, 90°, 97°, 103°} on FIORD and then on drone data decides whether the raw-fisheye splat can be trusted beyond 80° off-axis, or whether the rim band stays with virtual views (§5.8, §6.9).
- **GOFish on 16 GB.** GOFish was trained on a 24 GB GPU and is CC BY-NC. Its value as the experimental splat (and as Option B-fish) depends on fitting 16 GB and beating the primary by ≥ 1.5 dB (§5.7, §6.6).
- **Whether 3DGRUT's fisheye path renders θ > 90°.** Not confirmed (§5.2). It matters only as an alternative to gsplat.
- **Code availability** for Seam360GS and DirectFisheye-GS. No code was found (§5.7).
- **Dense completeness on bare concrete.** Whether OpenMVS reaches about 70% floor completeness. If not, PGSR or 2DGS with planar priors outside evaluated regions (§4.4, §6.8.2).
- **Reference accuracy for long check lines.** A distance-only trilateration network may not support a 0.03% claim over 50 m. Measure long lines directly, or borrow a total station (§6.3).
- **Dense evidence on garage-like scenes.** ETH3D indoor and ScanNet++ numbers now exist for COLMAP, ACMM/ACMMP, PGSR, GOF, 2DGS and DN-Splatter (§4.4). An OpenMVS-specific ETH3D value is still [UNVERIFIED], and no benchmark resembles a dim, compressed, textureless garage.

### 7.3 Research gaps and possible contributions

1. **Direction-aware, per-sector frame curation with partial rig frames** (main gap). No published method scores quality per fisheye sector, cubemap face or virtual view and then feeds partial frames to rig SfM. The proposal: an IMU-predicted blur map on the sphere, fused with relative sharpness, which emits per-sector masks (§3.2, §3.10, §6.9.1).
2. **A metric study of the seam band.** Compare the raw-fisheye 10-view rig, the stitched-equirect rig (seam masked and unmasked) and native spherical SfM, with checkpoints stratified by elevation so seam-band error is measured directly (§6.9.1).
3. **A "garage doppelganger" benchmark.** Marker IDs give free ground-truth labels for true and false revisits, so loop gates can be scored by precision and recall: marker-ID, rig consensus, gravity, Doppelgangers, and incremental-vs-global disagreement (§4.2, §6.9.1).
4. **Self-calibrating fisheye-coordinate BA with an IMU rolling-shutter term** for an up/down dual-fisheye rig (Option C, §6.7).
5. **Splatting beyond 180° on real drone data.** FTheta-UT on raw fisheye vs virtual pinhole, `max_angle` sweeps, depth-prior choice, and PPISP vs bilateral grid, with metrics reported per region (poles vs rim) (§5.7, §6.9.1).
6. **Evidence gaps the project could fill as by-products:** whether no-reference IQA scores predict SfM success at all; principled frames-per-metre for 360° indoor capture; robust (distractor-aware) splatting losses on fisheye input; how selection density affects false-loop rates; whether HEVC I/P frames carry more matchable texture than B-frames (§3.10).
7. **Dataset release.** Avata 360 OSV, calibration clip, marker coordinates and laser distances. ORBIT shows that SfM on real 360° video still fails often, so a metric indoor 360° drone dataset would be useful to others [see Ch. 4].
