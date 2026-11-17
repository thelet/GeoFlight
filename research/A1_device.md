# A1: The DJI Avata 360 as a measurement instrument

*Agent A1 (device and camera primer). Written 2026-11-17; second pass the same day, after official DJI pages became reachable.*

> **How to read the evidence in this file.** The first pass could reach only GitHub. In the second pass I opened the official DJI pages: the **Specs** page [DJISpecs], the **FAQ** [DJIFAQ] (both fetched from `dji.com/uk/...`; the US site returns 404 for this product) and the **User Manual v1.0 (2026.03)** PDF on `dl.djicdn.com` [DJIManual]. I also opened the ExifTool DJI tag page and the Gyroflow v1.7.0 notes on gyroflow.xyz. Still unreachable: DPReview (Cloudflare challenge), the review sites (Engadget, Digital Camera World, CineD, heliguy and others), and DJI's newer manual and release-notes host (`terra-1-g.djicdn.com`).
> - **[DJI-SPEC] / [DJI-FAQ] / [DJI-MANUAL]**: verified on the official DJI page or PDF I opened.
> - **[OPENED]**: other pages I fetched and read, mostly GitHub repositories, pull requests, issues and release notes from community reverse-engineering of the `.OSV` format, plus exiftool.org and gyroflow.xyz.
> - **[SNIPPET]**: taken only from web-search result text (reviews). Formally **[UNVERIFIED]**. After the second pass this tag remains only on review claims.
> - **[TRANSFER]**: measured on the **DJI Osmo 360**, which appears to share the camera architecture, and carried over to the Avata 360 by inference.
> - **[CALC]**: numbers I derive myself. Each shows its formula so it can be re-checked.

---

## 0. TL;DR for the pipeline designer

1. In 360° mode the two lenses point **up and down**, not front and back. So the stitch seam lies on the **horizon**, and that is exactly where walls, pillars, cars and wall-mounted markers appear in a parking lot [OPENED: OpenOSV PR #3][SNIPPET: reviews]. This one fact drives most of the recommendations below.
2. `.OSV` is an MP4 holding **two unstitched 3840×3840 10-bit HEVC fisheye streams**, plus protobuf metadata. The metadata carries a **per-unit factory lens calibration** (an f-θ / Kannala–Brandt-type model with 5 radial and 2 tangential terms, and per-lens extrinsic angles) and **~1–4 kHz fused attitude quaternions** [OPENED: dji-osv-converter docs, OpenOSV PR #3]. **Work from the dual-fisheye streams rather than DJI's stitched equirectangular output whenever possible.**
3. Native angular resolution is about **18 px/deg** (fx ≈ 1040–1047 px/rad) [OPENED/CALC]. A perspective view matched to that resolution, with a 90° field of view, is only about **2100×2100 px**, roughly 3× coarser per degree than a Mavic-class camera. At 2 m this gives about 1 mm/px, which is fine for cm-level work, but marker detection range is limited.
4. Seam parallax scales as ≈ b/d. The inter-lens baseline b is **not published**. For a plausible b of about 2–4 cm, the seam disparity is about 1–2° (20–40 px in 8K equirect) at 1 m and about 0.3–0.5° at 5 m [CALC, b UNVERIFIED]. Community measurement on Avata 360 footage shows **0.7° mean / 2.2° max parallax and 12–13 px doubling at 6K** [OPENED: PR #3].
5. Low light with 50 Hz mains means flicker at 100 Hz. Record at **25/50 fps with a 1/100 s shutter** (or 1/50 s at 25 fps), fly slowly, and expect ISO of about 800–3200 in a typical garage [CALC].
6. Indoor flight runs on vision positioning plus a downward 3D ToF sensor, with no GNSS. Omnidirectional obstacle sensing works **only in 360° mode** (the side and rear sensing uses the two fisheye cameras), needs **≥1 lux and visible texture**, and single-lens mode has forward sensing only [DJI-FAQ][DJI-MANUAL]. The manual explicitly lists **surfaces with repeating identical patterns**, monochrome, reflective and transparent surfaces as cases where the vision system fails. If vision and GNSS are both unavailable the drone drops to **ATTI mode** (no position hold) [DJI-MANUAL].
7. The lenses are **fixed focus, rated 1.5 m to ∞** (f = 2.5 mm, f/1.9) [DJI-SPEC]. Garage geometry often puts surfaces closer than 1.5 m. The defocus there is modest in video (≈1 binned pixel at 1 m, ≈2 px at 0.5 m [CALC, §5.9]), but it is one more reason to stay ≥1 m from walls and to keep markers ≥1.5 m from the lens.
8. Official ISO ceilings depend on mode: 360° video goes to **ISO 12 800 in D-Log M** in every mode, and to 25 600 in Normal colour except at 8K 48–60 fps. 360° photos stop at ISO 6400 [DJI-SPEC]. DJI says there is **no separate HDR video mode**; "HDR" in marketing refers to the sensor's dynamic range (up to 13.5 stops claimed) [DJI-FAQ].

---

## 1. Hardware and specifications

### 1.1 Spec table

| Item | Value | Evidence |
|---|---|---|
| Announced | March 26, 2026 ("DJI's first 360° drone, as of March 2026") | [DJI-FAQ]; date [SNIPPET: DroneGirl, DroneLife, CineD]; shared context |
| Camera architecture | Two fisheye prime lenses on a **single-axis mechanical gimbal (tilt)**, mechanical range −95° to 173°. In 360° mode the gimbal stays stationary and only the "360° Virtual Gimbal" view moves (tilt and roll −180° to 180°). In single-lens mode the gimbal tilts (−30° to 60° with RC 2/RC-N2/RC-N3; −60° to 60° with goggles + motion controller). The gimbal rotates to 360° mode automatically on the first takeoff and rotates back to the locked position on landing. Lens-up/lens-down orientation in 360° mode is shown only in manual figures; it is confirmed from file metadata | [DJI-SPEC][DJI-MANUAL]; orientation [OPENED: PR #3] |
| Sensors | 2 × **1/1.1-inch square CMOS**, 64 MP effective per sensor. DJI: "optimized pixel arrangement" raises the vertical pixel count to 4000 (versus 3000 on a rectangular sensor), and each sensor's 360° imaging area equals a 1-inch 4:3 sensor. The Osmo 360 debug track names an OmniVision **OV68A40** [TRANSFER] | [DJI-SPEC][DJI-FAQ]; [OPENED: osv-format-notes] |
| Pixel pitch | DJI states **2.4 µm** pixels. 64 MP on a ~10 mm square implies ~1.2 µm native pitch, so 2.4 µm is the **2×2-binned** (quad-Bayer, 4000×4000 ≈ 16 MP) pitch used for video. Consistency check: f / pitch = 2.5 mm / 2.4 µm ≈ 1040 px/rad, which matches the factory fx ≈ 1038–1047 px of the 3840-px streams [CALC] | [DJI-FAQ]; [CALC] |
| Dynamic range | "Up to 13.5 stops" (DJI claim, not a lab measurement) | [DJI-FAQ] |
| Lens | FOV **200°**; focal length **2.5 mm** (7.8 mm equivalent); **f/1.9**; focus mode **FF (fixed focus)**; focus range **1.5 m to ∞**. No ND filters supported. Front elements are user-replaceable (replacement lens kit) | [DJI-SPEC][DJI-FAQ] |
| Per-lens video stream | 3840×3840, HEVC Main10, yuv420p10le, 59.94 fps tested | [OPENED: PR #3 (Avata 360); osv-format-notes (Osmo 360)] |
| Factory intrinsics (one unit, fw 01.00.06.00) | Up ("slave") lens fx 1046.98, cx/cy 1906.92/1911.23. Down ("master") lens fx 1038.19, cx/cy 1926.75/1923.78. Extrinsic Euler angles stored (pitch ≈ 90.1°). Firmware 01.00.06.00 slightly re-calibrated fx/cx | [OPENED: PR #3] |
| 360° video | 8K (2:1) 7680×3840 and 6K (2:1) 6000×3000, each at **60/50/48/30/25/24 fps** | [DJI-SPEC][DJI-FAQ] |
| Single-lens video | 4K 4:3 3840×2880 and 4K 16:9 3840×2160 @ 60/50/48/30/25/24 fps; 2.7K 4:3 2688×2016 and 2.7K 16:9 2688×1512 @ up to **120** fps. The 4:3 modes need Goggles 3/N3 with RC Motion 3 or FPV RC 3. **Video only** (no photos). FOV presets: "Natural Wide" only with RC 2/RC-N2/RC-N3; "Standard (Dewarp)/Wide/Natural Wide" with goggles. **No FOV in degrees is published.** One review gives "28 mm equivalent" [SNIPPET, UNVERIFIED] | [DJI-SPEC][DJI-MANUAL] |
| Bitrate / codec | Max **180 Mbps**; **OSV** for 360° video, **MP4 (HEVC/H.265)** for single-lens video; exFAT; 42 GB internal storage plus microSD (UHS-I U3 or faster required). Sidecar `.LRF` proxy and `.SRT` observed in files. Per-mode bitrates are not published | [DJI-SPEC][DJI-FAQ][DJI-MANUAL]; sidecars [OPENED: orbis-reframe #34, OpenOSV] |
| Colour | **Normal** and **D-Log M** only. No HLG listed. DJI: "an HDR mode [is] unnecessary"; the marketing term "8K/60fps HDR" refers to sensor dynamic range. 10-bit is observed in the files (Main10), but the spec page does not state bit depth | [DJI-SPEC][DJI-FAQ]; 10-bit [OPENED: PR #3] |
| Shutter | Video **1/8000–1/25 s**; photo **1/8000–1/30 s** | [DJI-SPEC] |
| ISO | 360° video: 8K@60/50/48: **100–12 800** (Normal and D-Log M); 8K@30/25/24 and 6K@all frame rates: **100–25 600 Normal, 100–12 800 D-Log M**. 360° photo: **100–6400**. Single-lens video: 100–12 800. *This resolves the first-pass conflict: both 12 800 and 25 600 were right, for different modes.* | [DJI-SPEC] |
| Exposure control | Pro (manual) mode exists for photo and video; the camera panel exposes EV, shutter and ISO | [DJI-FAQ][DJI-MANUAL] |
| Stills | 360° single shot: **30 MP** (JPEG 7776×3888; DNG 7680×3840) and **120 MP** (JPEG 15520×7760; DNG 15360×7680). JPEG/DNG. 120 MP uses multi-frame **SmartPhoto** by default (scene recognition/HDR), disabled when the aircraft or gimbal moves or in Pro mode. DJI Studio does not yet edit 360° RAW photos (third-party software required) | [DJI-SPEC][DJI-MANUAL][DJI-FAQ] |
| Weight / size | Takeoff weight approx. **455 g**; 246×199×55.5 mm; battery ≈149 g, ≥2700 mAh, 14.32 V, ≥38.67 Wh. EU class C1 | [DJI-SPEC] |
| Flight time | Max flight **≈23 min** (wind tunnel, 21.6 km/h forward); max hover **≈22 min**; reviewers report 18–20 min in practice [SNIPPET] | [DJI-SPEC] |
| Speeds | Horizontal: **Cine 6 m/s, Normal 12 m/s by default (adjustable to 16 m/s), Sport 18 m/s**. Ascent 2/6/10 m/s, descent 1.5/6/10 m/s (Cine/Normal/Sport). *This resolves the speed conflict: reviewers quoting 12 m/s and the 16 m/s spec line are both right.* Max pitch 48°. Obstacle avoidance and the vision system are **disabled in Sport mode**. No manual (M/acro) mode | [DJI-SPEC][DJI-MANUAL][DJI-FAQ] |
| Obstacle sensing | Omnidirectional vision system + **forward LiDAR** + **downward 3D infrared (ToF)**. Ranges: forward 0.5–20 m (FOV 90°×90°); backward, lateral and upward 0.5–18 m; downward 0.5–20 m (FOV 90°×90°). Lateral, rear (and by implication upward) sensing uses the **fisheye cameras**, so omnidirectional sensing exists **only in 360° mode**; single-lens mode has forward sensing only. Needs discernible texture and ≥1 lux. The LiDAR misses obstacles below 10% reflectivity and glass | [DJI-SPEC][DJI-FAQ][DJI-MANUAL] |
| Positioning | GNSS: GPS + Galileo + BeiDou. Hover accuracy: vision ±0.1 m vertical / ±0.3 m horizontal; GNSS ±0.5 / ±1.5 m. 3D ToF effective height 10 m, precise hover range 0.3–10 m, ToF FOV 60°×60°. Operating environment for vision: **diffuse surfaces with discernible patterns, diffuse reflectivity >20% (e.g. concrete), lux >1**. Without GNSS the downward vision system works best at 0.5–30 m height. Falls back to **ATTI** if vision and GNSS both fail | [DJI-SPEC][DJI-MANUAL] |
| Other light thresholds (manual) | FocusTrack and QuickShots: caution below 5 lux. APAS: extra caution below **300 lux** | [DJI-MANUAL] |
| Embedded motion data | Fused attitude quaternion per frame, plus a high-rate quaternion batch (≈4 kHz on the Avata 360 clip; ≈1 kHz / ~33 per frame on the Osmo 360), gravity vector, shutter time, gain, sensor temperature. Gyroflow 1.7.0 also reads per-frame ISO, shutter, WB and, on the Avata 360, aperture and focal length | [OPENED: PR #3; osv-format.md; Gyroflow v1.7.0 notes] |
| Flight log | Flight telemetry is saved to an internal recorder, read with **DJI Assistant 2 (Consumer Drones Series)** | [DJI-MANUAL] |

### 1.2 Dual-lens geometry and baseline

DJI does not publish the separation between the two optical centres, and the metadata decoded so far holds only **rotations** between the lenses, with **no translation** [OPENED: PR #3, osv-format-notes]. Back-to-back 360 modules of this sensor class are usually a few centimetres thick. I therefore use **b ≈ 2–4 cm** as a working range [UNVERIFIED estimate]. **Measuring b is open unknown #1** (see §7). The second pass searched again: the official spec page, FAQ and user manual v1.0 give no baseline, minimum stitching distance or lens-to-lens dimension, and no review I could reach measured one. For reference only, Insta360 publishes minimum stitching "safety distances" of about 0.6 m (sides) and 0.8 m (bottom) for its handheld X-series cameras [SNIPPET: Insta360 online manual], which is a different (smaller, front/back) module. One indirect method: stitch with DJI Studio at several distances, or fit b as a free parameter in a two-camera rig calibration (COLMAP rig / Kalibr) against a target at known distance.

### 1.3 Stills as an alternative?

The 120 MP 360° still has an equatorial sampling of 15520/360 ≈ **43 px/deg**, about twice the video's [CALC]. That would come from the unbinned 64 MP readout. DNG avoids H.265 artefacts altogether.

The drawbacks are throughput (one shot every few seconds, while hovering), a longest shutter of 1/30 s, a maximum photo ISO of **6400** [DJI-SPEC], and multi-frame processing: by default the 120 MP single shot uses **SmartPhoto**, which "needs to take multiple shots continuously" and merges them (scene recognition or HDR). SmartPhoto is skipped when the aircraft or gimbal moves, when the drone cannot hover stably, and in **Pro/manual mode** [DJI-MANUAL]. For measurement stills, shoot in Pro mode, so each still is closer to a single exposure (whether the 120 MP output is still a multi-frame/remosaic product in Pro mode is not documented). Note that the DNG sizes differ from the JPEG ones (15360×7680 vs 15520×7760) [DJI-SPEC], and DJI Studio cannot yet edit 360° RAW photos [DJI-FAQ]. **Verdict:** stills are not a replacement for video coverage. They are a **valuable supplement** at control stations: hover near each marker cluster and take 120 MP DNGs. Those images then anchor scale and give the highest-resolution observations of the markers. (Assessment.)

---

## 2. How a dual-fisheye 360 camera forms an image

### 2.1 Fisheye projection models

A pinhole camera maps a ray at angle θ from the optical axis to radius r = f·tan θ. This diverges at 90°, so it cannot represent a 200° lens. Fisheye models replace tan θ with a function that stays finite:

| Model | r(θ) | Notes |
|---|---|---|
| Equidistant | f·θ | Constant angular sampling. COLMAP `SIMPLE_FISHEYE` / `FISHEYE` [OPENED: COLMAP fisheye.h] |
| Equisolid | 2f·sin(θ/2) | Equal-area; common in real lenses |
| Stereographic | 2f·tan(θ/2) | Conformal |
| Kannala–Brandt (KB) [Kannala2006] | f·(θ + k₁θ³ + k₂θ⁵ + k₃θ⁷ + k₄θ⁹) | A polynomial in θ that fits any of the above. OpenCV fisheye and COLMAP `OPENCV_FISHEYE` use 4 terms |
| Unified / MEI [Mei2007], EUCM [Khomenko2016], Double-Sphere [Usenko2018] | project onto a unit sphere, then a pinhole shifted by ξ (α, β) | Closed-form inverse. With ξ > 1 they cover >180° fields. COLMAP ships an `eucm` model family [OPENED: COLMAP models.h] |

**DJI's own model** has been reverse-engineered from DJI Studio by community projects [OPENED: osv-format-notes]. It is "f-θ" with five odd radial terms, θ_d = θ + k₁θ³ + … + k₅θ¹¹, followed by Brown tangential terms p₁, p₂, then u = fx·x″ + cx. In other words it is **KB-5 + tangential**. The same project reports that it fits DJI's reference to **2.1/3.9 px RMS** on the two lenses. A different tool fits the MEI model with ≤0.33 px residual, but drops the tangential terms [OPENED: orbis-reframe #34].

**Why a ~200° lens.** Each lens must see past its own 180° hemisphere so the two images overlap. The overlap band lets the stitcher (a) find correspondences to align the lenses, (b) blend exposure and colour differences, and (c) hide the drone body and the camera housing. DJI's Osmo 360 stitcher uses an overlap ratio of 0.038 × 360° ≈ 13.7°, giving an effective 193.7° per lens and a ~292 px blend band at 8K [OPENED: osv-format-notes, constants.md] [TRANSFER].

**Sanity check on the Avata 360 calibration** [CALC]: fx ≈ 1047 px/rad and an image 3840 px wide (radius ≈ 1920 px). Under the equidistant approximation, the image-circle edge lies at θ ≈ 1920/1047 ≈ 1.83 rad ≈ **105°**, matching a ~200–210° lens. The angular sampling is about 1047 px/rad = **18.3 px/deg** near the axis.

**Tooling caveat (assessment).** Many implementations (OpenCV `cv::fisheye`, and COLMAP models that go through the normalized plane u/w) parametrise rays through z > 0. Rays with θ ≥ 90° then cannot be represented. COLMAP's own equirectangular model notes that its normalized-plane inverse is valid only for Z > 0 [OPENED: COLMAP spherical.h]. On this drone the θ ∈ [90°, 100°] band of each lens is **the horizon**, so a model that clips it throws away the walls. Check that whatever model downstream agents choose works on bearing vectors (EUCM, Double-Sphere, spherical), not on tan θ.

### 2.2 Stitching and seam parallax

The two lenses have **different optical centres**, separated by baseline b along the (vertical) optical axis. A stitcher pretends both share one centre, the midpoint. A scene point P at horizontal range d, lying on the horizon plane, is seen from the upper lens at depression angle atan((b/2)/d) and from the lower lens at elevation atan((b/2)/d). The **angular disagreement** at the seam is

  δ(d) ≈ 2·atan(b/(2d)) ≈ **b/d** (radians).

A stitcher tuned for a reference distance d₀ (stitch distance, or optical-flow "parallax-aware" seams) leaves a residual

  δ_res(d) ≈ b·|1/d − 1/d₀|.

The error grows as **1/d**, so it is negligible for a sky-and-landscape drone and serious at 1–5 m.

| Distance d | δ for b = 2 cm | δ for b = 4 cm | Pixels in 8K equirect (21.3 px/deg), b = 3 cm |
|---|---|---|---|
| 0.5 m | 2.3° | 4.6° | ~73 px |
| 1 m | 1.15° | 2.3° | ~37 px |
| 2 m | 0.57° | 1.15° | ~18 px |
| 5 m | 0.23° | 0.46° | ~7 px |
| 10 m | 0.11° | 0.23° | ~4 px |

[CALC; b UNVERIFIED]

**Reported measurement** [OPENED: PR #3, community test on an outdoor Avata 360 clip, 6K export, scene distances unknown]: the seam runs along the horizon. Overlap NCC was 0.70–0.71, mean parallax 0.71–0.73° (max 2.2°), and residual doubling 12–13 px (~0.75°). This is consistent with b/d ≈ 0.013, for example b ≈ 3 cm at d ≈ 2.4 m.

**Consequence for metric reconstruction (assessment).** Stitched equirectangular frames are **not a central projection** near the seam. A point at 1–2 m can be displaced by tens of pixels, and the displacement depends on depth and on the optical-flow seam the stitcher chose for that clip. That is a systematic, scene-dependent error which bundle adjustment cannot model. Two remedies:
1. Treat the two fisheyes as a **2-camera rigid rig** with separate intrinsics and a calibrated relative pose (rotation from the factory metadata, translation measured). This removes the error by construction.
2. If equirect must be used, **mask a band of ±~8–10° around the horizon** in feature extraction. This costs exactly the wall content.

### 2.3 Equirectangular projection

Longitude λ ∈ [−π, π) and latitude φ ∈ [−π/2, π/2] map linearly to pixels [OPENED: COLMAP spherical.h]:

  x = (λ/2π + 0.5)·W, y = (0.5 − φ/π)·H, with W = 2H.

Vertical sampling is uniform at H/π px/rad. Horizontal sampling at latitude φ is W/(2π·cos φ) px per radian of *true arc*: rows near the poles are hugely **oversampled**. The pixel solid angle is ∝ cos φ.

- 8K: 7680/360 = **21.3 px/deg** at the equator. At φ = 60° a row is oversampled ×2, and at φ = 80° ×5.8.
- The band |φ| > 60° takes up **1/3 of the image rows** but only **13.4% of the sphere** (1 − sin 60°) [CALC].
- On this drone the poles are the **ceiling and floor**. Those surfaces are textureless and they get the highest-resolution *native* sampling, because they sit at each fisheye's centre. Walls sit at the fisheye **rim**, where lens MTF, chromatic aberration and vignetting are worst (shading falls to 0.76 at the rim on the Osmo 360 [OPENED: osv-format.md] [TRANSFER]).
- Native 18.3 px/deg versus 8K equirect 21.3 px/deg means the 8K equirect slightly **upsamples** the sensor at the equator. 6K equirect (16.7 px/deg) roughly matches native resolution [CALC].

### 2.4 Reframing, the "virtual gimbal", and horizon levelling

In 360° mode the mechanical gimbal "remains stationary" and only the camera view is adjusted, through the **360° Virtual Gimbal** (tilt and roll −180° to 180°, up to 100°/s) [DJI-MANUAL][DJI-SPEC]. Stabilization and horizon handling in this mode are therefore entirely digital. DJI Fly offers two gimbal modes in 360° mode: **Follow** (view kept level relative to the horizontal plane) and **FPV** (view rolls with the aircraft) [DJI-MANUAL]. Community re-implementations of DJI's RockSteady and HorizonSteady equivalents for OSV apply **one rotation R per frame to the stitched sphere** [OPENED: levelling.md]:

  R(f) = bridge · raw(f)ᵀ · smooth(f) · bridgeᵀ · K.

Here raw(f) is the per-frame fused IMU quaternion, smooth(f) is a Gaussian-smoothed version (σ = 15 frames), and "horizon" mode rebuilds the basis from the gravity "up". DJI's actual pipeline is closed. Its behaviour matches these re-implementations to ≤0.24° in level and to comparable jitter [OPENED: levelling.md] [TRANSFER from Osmo 360].

**Is it a pure rotation?** For a perfect central spherical camera, yes, and then it is harmless to SfM: each frame simply gets a different orientation. It is *not* harmless in three ways (assessment):
1. **Resampling** blurs and aliases, which costs another ~10–20% of effective resolution.
2. The stitch is non-central (§2.2), so rotating it does not undo the depth-dependent seam error. Levelling moves the seam *to* the horizon on this drone, because the lens axis is vertical.
3. Any **rolling-shutter correction** (per-row warping) is non-rigid. The community converter ships RS correction disabled, because it measured worse than no correction on the Osmo 360 [OPENED: levelling.md].

Reframed 16:9 "flat" exports are a further crop plus rotation, and sometimes a non-perspective "dewarp" (Engadget notes edge softness) [SNIPPET]. **Do not use reframed exports for photogrammetry.**

### 2.5 Which stabilization?

The official spec names the EIS modes only for **single-lens mode**: RockSteady 3.0 (all controllers) and a switch between RockSteady 3.0 and **HorizonBalancing** (goggles with RC Motion 3 or FPV RC 3) [DJI-SPEC]. Single-lens footage is therefore an electronically stabilized, possibly dewarped crop, a poor measurement source. For 360° mode DJI names no EIS mode. Levelling and smoothing are a property of the virtual gimbal view and the 360° editors. In the OSV workflow, stabilization is a **post-processing choice in DJI Studio** (or in third-party tools), applied to stitched output. It is not baked into the dual-fisheye streams: the raw streams are recorded in the sensor frame, and attitude is stored separately [OPENED: OpenOSV, osv-format.md]. Which gimbal mode (Follow or FPV) is chosen should not affect the recorded dual-fisheye streams, only the default view and the attitude flags in the metadata, but this is untested [UNVERIFIED]. **Recommendation:** for photogrammetry, export **unstabilized**, or better, decode the raw fisheyes. Use the stored attitude quaternions as **rotation/gravity priors** instead of baking them into pixels.

---

## 3. How it differs from regular drone footage

| Quantity | Avata 360, 360° mode | Mavic-class 4K perspective camera (≈72° HFOV) |
|---|---|---|
| Coverage | Full sphere (minus any body occlusion) | ~1.1 sr (≈9% of sphere) [CALC: Ω = 4·asin(sin36°·sin27°)] |
| Angular resolution | ~18 px/deg native; 21.3 px/deg 8K equirect | ~46 px/deg at 3840 px wide; ~63 px/deg for 5280-px stills [CALC; Mavic HFOV UNVERIFIED] |
| 90° perspective crop, matched to native | W = 2·(180/π)·18.3 ≈ **2100 px** square (~4.4 MP). Cropping at 8K-equirect resolution gives ~2440 px, but that is upsampled | n/a |
| Bitrate per steradian | 180 Mbps / 4π ≈ **14 Mbps/sr** | ~150 Mbps / 1.08 ≈ **140 Mbps/sr** |
| Bits per pixel per frame (60 fps) | 180e6 / (2·3840²·60) ≈ **0.10 bpp** | 150e6 / (3840·2160·60) ≈ 0.30 bpp |
| Optical model | Two non-central fisheyes, or a non-central stitched sphere | Near-ideal pinhole + Brown distortion, mechanically stabilized |
| Rolling shutter | Two sensors, readout unknown, and readout direction relative to the scene differs per lens | One sensor, gimbal-stabilized |

[CALC]

**Why 360° helps SfM.** Every frame sees in every direction, so rotations are well constrained (no "looking at a blank wall" degeneracy). Any feature-rich direction can carry tracking when the others are textureless. Fast yaw does not leave the field of view. Loop closures can happen from any heading. Translation-vs-rotation ambiguity is reduced, because bearing vectors span the whole sphere (the classic argument for spherical/omnidirectional SfM; see IM360, RIGOR in the shared context).

**Why it hurts.**
- About 3× fewer pixels per degree, so each feature is localized ~3× worse in angle. One pixel subtends 1/18.3° ≈ 0.95 mrad, i.e. ≈ **1.9 mm at 2 m** [CALC]. That is still well under the cm target, but marker detection range shrinks (see §6).
- The model is non-pinhole and non-central (seams).
- Compression is ~10× tighter per steradian.
- Two rolling shutters, both fixed to an FPV airframe.
- The seam sits on the most useful band of the scene.

---

## 4. Files and data access

### 4.1 What is inside `.OSV`

An `.OSV` is a plain ISO-BMFF/MP4 [OPENED: OpenOSV, osv-format.md, osv-format-notes]:
- **Two HEVC Main10 video tracks, one per fisheye lens, unstitched**, each 3840×3840 10-bit. Stitching happens in software.
- AAC audio, an MJPEG thumbnail, sensor debug tracks (`dbgi`) and two or more **`CAM meta` protobuf tracks**.
- A sidecar `.LRF` low-resolution proxy and an `.SRT` file are written alongside [OPENED: orbis-reframe #34].
- Track numbering changes between firmware versions, so identify streams by content [OPENED: osv-format.md].

**Unstitched fisheye is therefore available directly**, e.g. `ffmpeg -i X.OSV -map 0:v:0 …` (assessment; the exact mapping differs by firmware). Third-party extractors: OpenOSV (Apache-2.0), dji-osv-converter (no licence file found), osv2mov, osv2mkv, osvcut, osmo360-reframe (Osmo 360-focused; Avata 360 support in OpenOSV is "opens, untested on Avata" [OPENED: OpenOSV]).

**Export options:** DJI names **DJI Fly** (mobile) and **DJI Studio** (desktop) as the editors for Avata 360 footage, and states that panoramic videos "must be edited before you can share them as regular videos" [DJI-FAQ][DJI-MANUAL]. DJI Studio stitches and exports equirect MP4 (a 6000×3000 export was used as reference in PR #3), with three "stitching optimisation" options per one review [SNIPPET]. LightCut is not mentioned in DJI's Avata 360 pages; its support is [UNVERIFIED]. The official pages say nothing about exporting unstitched fisheye or about stitch-distance settings. Normal NLEs do not read OSV natively [SNIPPET: heliguy]. Files can be copied over USB with the aircraft powered off, by card reader, or by QuickTransfer to a phone [DJI-MANUAL][DJI-FAQ].

### 4.2 Metadata

Avata 360 (fw 01.00.06.00, one clip) [OPENED: PR #3]:
- **Clip header**: product name and schema, per-lens calibration in "slots 3/4" (`native_refine_far`), IMU rate field.
- **Per-frame**: one attitude quaternion per frame (field `3.4.14.4` on that clip).
- **High-rate**: fused attitude batch `3.3.2.1.3` at **≈4 kHz** (42 331 samples over 10.6 s).
- A possible **drone-frame quaternion**, separate from the camera's (unverified lead).
- Field numbering **differs from the Osmo 360** (e.g. the attitude sits in fields 22/23 vs 9/10), and differed between clips in that thread. Parsers are still immature.

Osmo 360 (closely related) [OPENED: osv-format.md] [TRANSFER]:
- Per-frame quaternion (world-up = +Z) that matches DJI's levelling to 0.24°.
- Accelerometer "gravity" vector that can disagree with the quaternion by **up to 52°** during manoeuvres, so do not use it raw for gravity.
- Per-frame shutter time (µs), gain, WB gains, sensor temperature, and a per-unit **camera-to-IMU mount rotation**.

**Parsers:**
- **ExifTool**: re-checked on exiftool.org (current version 13.64, 16 Nov 2026). The "DJI Protobuf Tags" table has an Osmo 360 protocol (`dvtm_oq101`: serial number, model, FNumber, frame number, timestamp, ISO, shutter speed, colour temperature, accelerometer X/Y/Z, GPS; **no quaternion**) and an Avata 2 protocol, but **no Avata 360 protocol** [OPENED: ExifTool DJI tag names page; also DJI.pm source in the first pass]. Unknown djmd tags can be dumped with the `Unknown` option (1, or 2 to include dbgi debug tags), which is a cheap first look at Avata 360 files.
- **Gyroflow v1.7.0** (re-checked on gyroflow.xyz/download): lists "DJI Osmo 360 … and DJI Avata 360" under **"Motion data only"**: Gyroflow cannot play these files, so you open a playable copy as the video and load the original under *Motion data → Open file*. The same notes say Gyroflow now reads per-frame ISO, shutter speed and white balance from DJI files, "plus the aperture and focal length on the Avata 360" [OPENED: Gyroflow v1.7.0 notes on gyroflow.xyz and GitHub releases]. The Gyroflow README's DJI list (Avata, Avata 2, O3/O4 Air Unit, Action, Neo) does not yet include the 360 models [OPENED: Gyroflow README]. Gyroflow's dual-fisheye support for the Osmo 360 is an open enhancement for 2.0 [OPENED: gyroflow #1164].
- **telemetry-parser** README does not yet list them [OPENED].
- DJI flight logs (`.txt`/`.DAT`) are on telemetry-parser's TODO list [OPENED]. The manual says flight telemetry and aircraft status are saved to an internal recorder and read with **DJI Assistant 2 (Consumer Drones Series)** [DJI-MANUAL]. Whether it contains VIO velocity or position indoors is [UNVERIFIED].

**Why it matters:** the quaternions give per-frame **gravity direction** (good to ~0.1–0.3°) and relative rotation priors. That supports gravity-aligned SfM (RIGOR-style projection; pitch/roll priors), lets you reject folded maps whose implied gravity is inconsistent, and supports rolling-shutter modelling. Positions are **not** in the camera metadata indoors (no GNSS).

### 4.3 Published calibration

DJI publishes no lens profile, but every file carries a **per-unit factory calibration** that can be read (§1.1). Firmware updates have changed it slightly (fx 1046.81 → 1046.98) [OPENED: PR #3]. Two caveats: lens protectors/ND filters change it (OpenOSV has separate "Lens Protectors / ND" profiles [OPENED]), and **no translation between lenses** is stored.

---

## 5. Characteristics that limit *this* task

### 5.1 Rolling shutter
**Mechanism.** Each sensor reads rows sequentially. No readout time has been published or measured for the Avata 360 or Osmo 360 [UNVERIFIED]. The **upper bound** is the frame period: <16.7 ms at 60 fps [CALC]. For comparison, the first pass quoted "10.9 ms for a competing 8K 360 camera" from a CineD snippet. A second search shows that snippet is about the **Insta360 Luna Ultra**, where CineD reports **25.3 ms in 8K mode** and 10.9 ms only in a 4K25 tele mode [SNIPPET: CineD lab test; page not reachable]. So no sensor-class figure exists, and a long (>15 ms) full-frame readout at 8K is plausible. Neither DJI nor any reachable review publishes a readout for the Avata 360 or the Osmo 360. With lenses facing up and down, rows sweep across *horizontal* directions differently for the two lenses, and yaw produces a shear/twist around the vertical axis. The Osmo 360 metadata stores ~33 high-rate quaternions **spanning the readout**, which is exactly what RS correction needs [OPENED: osv-format-notes].
**Effect.** At 60°/s yaw and ~10 ms readout, skew ≈ 0.6° ≈ 11 px; at ~16 ms (frame-period bound at 60 fps) it is ≈1° ≈ 18 px [CALC]. This produces geometric inconsistency between frames and biased poses.
**Mitigation.** Capture: slow, smooth yaw (≤15–20°/s), no FPV flips. Processing: drop frames with high angular rate (use the IMU); model RS with the high-rate quaternions as a later step; measure readout (§7).

### 5.2 Motion blur
**Mechanism.** Blur ≈ (ω + v/d)·t_exp, in angle. At 18 px/deg, 1/100 s and ω = 30°/s → 0.3° ≈ **5.5 px**. Translation at 1 m/s and d = 2 m → 0.29° ≈ 5 px [CALC].
**Effect.** Features are lost, corners are biased, and marker detection fails.
**Mitigation.** Keep total ≤1–2 px: v ≈ 0.3 m/s at 2 m, ω ≤ 5–10°/s, at 1/100 s. Select frames by sharpness (Laplacian variance) and IMU angular rate. Add light.

### 5.3 Noise and compression
**Mechanism.** In a garage at about 50–150 lux (EV100 ≈ 4.3–5.9), f/1.9 and 1/100 s (EV ≈ 8.5 at ISO 100) need **ISO ≈ 800–2000** [CALC: ISO ≈ 100·2^(8.5−EV)]. Then H.265 at 0.10 bpp smooths away fine texture first, and fine texture is exactly what concrete offers.
The ISO ceiling is **12 800 in D-Log M** in every 360° mode, and 25 600 in Normal colour (except 8K at 48–60 fps) [DJI-SPEC], so the camera will not run out of gain in a garage; noise, not the ISO limit, is the constraint. DJI claims 2.4 µm (binned) pixels and up to 13.5 stops of dynamic range [DJI-FAQ]; there is no independent measurement I could open.
**Effect.** Fewer and less repeatable keypoints on floors and walls. Block artefacts create false matches. The photometric loss in 3DGS fits compression noise.
**Mitigation.** Prefer **30/25 fps over 60/50 fps** if the bitrate cap stays at 180 Mbps (≈ doubles bpp; verify that DJI does not lower the bitrate at lower frame rates [UNVERIFIED]). Use **6K rather than 8K** if the 6K bitrate is equal, because 6K is near native sampling. Use D-Log M 10-bit (less quantization in shadows) with a **fixed** exposure; if ISO above 12 800 were ever needed, only Normal colour allows it. Add light. Use 120 MP DNG stills at stations.

### 5.4 Stitch-seam parallax at close range
**Mechanism.** See §2.2: δ ≈ b/d, with the seam **on the horizon**.
**Effect.** At 1–5 m, 7–40 px of depth-dependent misregistration along the band that holds pillars, walls and wall markers. This causes distorted or doubled geometry and biased scale if markers sit on the seam.
**Mitigation.** Process the **two raw fisheyes as a rig** and do not use stitched output. If equirect must be used, mask the seam band. Place markers **on the floor and ceiling or well above/below the horizon band** as seen from flight height. Fly at mid-height so walls are seen obliquely by each lens. Treat any measurement that crosses the seam as suspect.

### 5.5 Exposure, white balance, HDR and flicker
**Mechanism.** Auto exposure and WB drift between garage zones. For video DJI says there is **no HDR mode** (the sensor's range is used directly) [DJI-FAQ], so multi-exposure video merging is not a concern; the 120 MP SmartPhoto still mode does merge frames [DJI-MANUAL]. 50 Hz mains (Israel) → **100 Hz** flicker from fluorescent and cheap LED lights. A shutter that is not a multiple of 10 ms produces banding (rolling shutter × flicker) and frame-to-frame brightness pulsing.
**Effect.** Matching across exposure changes gets harder. Banding creates fake "texture" that moves. 3DGS gets floaters and inconsistent colour.
**Mitigation.** Use **manual exposure**: shutter **1/100 s** (or 1/50 s at 25 fps), fixed ISO, **locked WB**. Record at **25 or 50 fps** (PAL family). At 60 fps 1/60 s is the longest shutter possible, and that is not flicker-safe. (No HDR video switch exists; for stills use Pro mode, which disables SmartPhoto/HDR [DJI-MANUAL].) Neither the manual nor the spec mentions an anti-flicker setting. Downstream: per-image exposure/appearance compensation in 3DGS.

### 5.6 Stabilization and reframing
**Mechanism.** §2.4. A per-frame rotation is harmless in principle, but resampling, the non-central seam and any RS warp are not.
**Mitigation.** Disable stabilization in export (or use the raw fisheyes). Never use reframed or "flat" outputs. Use the IMU quaternions as **priors**, not as pixel warps.

### 5.7 Nadir/zenith and the "invisible drone"
**Mechanism.** The airframe (props, guards, arms) lies roughly in the **horizontal plane** around the up/down camera module. It therefore falls in or near the overlap band, and the stitcher hides it by choosing pixels from the lens that sees past it [SNIPPET: reviewers note the challenge of concealing the aircraft between the lenses; extreme attitudes expose the seam]. The manual confirms the mechanism: "parts of the aircraft" may appear in the live view but "will not appear in the final footage" [DJI-MANUAL], i.e. they are removed in stitching. The exact occluded sector in the raw fisheyes is **unknown** [UNVERIFIED]; no measurement is published.
**Effect.** In raw fisheyes, parts of the airframe are visible near the rim of each lens. Those static-in-image pixels will produce **fake static features** that corrupt SfM. In stitched output the region is synthesized, i.e. not real measurement.
**Mitigation.** Build a **fixed per-lens mask** from a static recording (§7) and apply it to all frames. Exclude the blend band.

### 5.8 Indoor flight: positioning and safety
**Mechanism.** No GNSS, so hover relies on the downward vision and ToF sensors. Vision needs light (lux >1) and diffuse surfaces with discernible patterns and >20% reflectivity, e.g. concrete [DJI-SPEC]. The downward vision system works best at 0.5–30 m height without GNSS [DJI-MANUAL]. Obstacle sensing is vision-based, ≥1 lux, needs texture, and works only in 360° mode, because side and rear sensing uses the fisheye cameras [DJI-FAQ]. The manual lists where the vision system "cannot work properly": monochrome surfaces, highly reflective, water or transparent surfaces, moving objects, frequent and drastic lighting changes, <1 lux, surfaces that strongly reflect or absorb infrared (mirrors, **asphalt**), textureless surfaces, **repeating identical patterns**, and thin obstacles. The forward LiDAR misses obstacles below 10% reflectivity and glass [DJI-MANUAL]. Almost every item on that list occurs in an underground car park. With vision and GNSS both unavailable the aircraft enters **ATTI mode**: no automatic hover or braking, and the manual tells the pilot to land as soon as possible, especially in confined spaces [DJI-MANUAL]. APAS (assisted bypass) calls for extra caution below **300 lux** [DJI-MANUAL]. Vision positioning and obstacle avoidance are off in Sport mode [DJI-MANUAL].
**Effect.** Drift, toilet-bowling, or unexpected braking or bypass near pillars. Risk to people and cars. Some lots have low clearance (~2.1–2.5 m) [UNVERIFIED typical value].
**Mitigation.** Fly with permission, outside opening hours, in **Cine mode** (6 m/s max; keeps vision positioning and obstacle sensing on) and **360° mode** (the only mode with omnidirectional sensing), never Sport, with a spotter. Before flight, check whether DJI Fly reports vision positioning available; if it shows ATTI, do not fly there. Add texture under the flight path (taped markers or mats) and lighting. Keep 0.5–1 m from surfaces. Do short battery-limited sorties (~15 min usable). Practise in a bright section first. The prop-guard (cinewhoop) design reduces contact risk but does not remove it.

### 5.9 Fixed focus and close range
**Mechanism.** Both lenses are fixed focus, rated **1.5 m to ∞**, with f = 2.5 mm and f/1.9 [DJI-SPEC]. If the lens is set near its hyperfocal distance H with a near limit of H/2 = 1.5 m, then H ≈ 3 m, and the implied circle of confusion is c = f²/(N·H) = 6.25/(1.9·3000) ≈ 1.1 µm, about one *native* 64 MP pixel [CALC; the focus setting is inferred, not published]. The blur-spot diameter at distance d is then b ≈ (f²/N)·(1/d − 1/H) ≈ 3.3 mm²·(1/d − 1/3 m):
- d = 1.5 m: ≈1.1 µm (≈0.5 binned 2.4 µm pixel);
- d = 1 m: ≈2.2 µm (≈0.9 binned px);
- d = 0.5 m: ≈5.5 µm (≈2.3 binned px) [CALC].
**Effect.** In 3840-px video, defocus is negligible beyond ~1 m and mild below it. It adds to seam parallax (§2.2) and motion blur (§5.2), which are all worst at the same short range. Stills at 120 MP (native pitch) are affected about twice as much in pixels.
**Mitigation.** Keep ≥1 m from surfaces in general and ≥1.5 m from markers used for scale. Prefer marker detections from frames where the marker is 1.5–5 m away.

### 5.10 Summary table: Limitations → effect → mitigation

| Limitation | Mechanism | Effect on reconstruction | Capture-side mitigation | Processing-side mitigation |
|---|---|---|---|---|
| Seam on horizon | Non-coincident centres, δ ≈ b/d; lenses up/down | 7–40 px depth-dependent errors on walls and pillars at 1–5 m; doubled features | Markers off the horizon band (floor/ceiling); mid-height flight | Use raw dual fisheye as a 2-cam rig; else mask ±8–10° seam band |
| Low angular resolution | ~18 px/deg native | ~3× worse angular precision than a Mavic; small markers unreadable beyond a few m | Larger markers; fly closer to markers; 120 MP stills at stations | 6K-equivalent processing; sub-pixel marker refinement in raw fisheye |
| Compression | 0.10 bpp at 8K60 | Fine texture lost; block artefacts | 25/30 fps; D-Log M; more light | Frame selection; don't over-trust low-texture regions |
| Noise | ISO 800–3200 in dim light | Fewer, noisier keypoints | Add light (LED panels on tripods); fixed ISO | Learned matchers robust to noise; denoise before features (with care) |
| Motion blur | t_exp × (ω + v/d) | Lost tracks, biased corners | ≤0.3–0.5 m/s, ≤10°/s yaw, 1/100 s | Sharpness + IMU-rate frame selection |
| Rolling shutter | Unknown readout (<16.7 ms at 60 fps), 2 sensors | Pose bias and inconsistency during yaw | Smooth, slow yaw; no flips | Drop high-ω frames; RS model with high-rate quaternions |
| Flicker | 100 Hz light vs shutter | Banding; brightness pulsing | 1/100 s or 1/50 s; 25/50 fps | Per-frame exposure compensation |
| Auto exposure/WB/HDR | Camera adapts | Photometric inconsistency | Manual exposure, locked WB, HDR off | Appearance embeddings in 3DGS |
| Stabilization/reframe | Per-frame resample; possible RS warp | Blur; non-rigid errors | — | Don't use stabilized/reframed exports; use IMU as priors |
| Fixed focus (1.5 m–∞) | f = 2.5 mm, f/1.9, FF | ~1–2 px defocus at 0.5–1 m; worse in 120 MP stills | Stay ≥1 m from surfaces, ≥1.5 m from scale markers | Weight or reject close-range marker detections |
| Airframe in view | Body near the horizon band | Static fake features | Record a static mask clip | Per-lens fixed mask |
| No GNSS / VIO limits | Vision+ToF positioning, ≥1 lux, >20% reflectivity, fails on repetitive/reflective/IR-absorbing (asphalt) surfaces; ATTI fallback | Drift, unsafe flight; no metric prior | Lighting, texture, Cine mode, 360° mode, spotter | Scale from markers only; gravity from IMU |
| Repetition | Identical bays and pillars | False loops, folded map | Unique markers (ArUco/AprilTag IDs) in every bay; continuous trajectory | Sequential matching + verified loops; marker-ID constraints |
| Reflective surfaces / moving objects | Specular cars, wet floor, people | Wrong matches, floaters | Empty lot; dry floor | Masks (segmentation) for cars/people |

---

## 6. Capture protocol (underground lot)

**Pre-flight (one time per device)**
1. Update firmware and record the version (calibration changes with firmware). Remove lens protectors or record which ones are fitted. The front elements are user-replaceable [DJI-FAQ]; re-calibrate after any replacement.
2. **Calibration clip**: DJI states that photo and video capture are **not supported before takeoff** [DJI-MANUAL] and that handheld shooting is not supported [DJI-FAQ]. So the first-pass idea of a motors-off, hand-held calibration clip does not work. Instead, **hover** (Cine mode, in a bright, textured, safe space) in front of large wall- or stand-mounted AprilGrid/ChArUco boards at ~1, 1.5, 2 and 4 m, and yaw/translate slowly so the boards pass through both lenses and **through the seam**. Use it to check the factory intrinsics, estimate the **inter-lens translation b**, and build the airframe mask. (Whether a recording started in flight continues after landing is untested; any bench trick that records with motors off is [UNVERIFIED].)
3. **Readout clip**: film a 100 Hz flickering light or a fast-panning vertical edge to estimate rolling-shutter readout (§7).

**Camera settings (measurement pass)**
- 360° mode (single-lens mode loses omnidirectional sensing and coverage, and its footage is EIS-processed [DJI-SPEC]).
- **6K or 8K at 25 fps** (both offered at 24/25/30/48/50/60 fps [DJI-SPEC]; 50 fps if blur demands it), **Pro mode**: **1/100 s**, ISO fixed as low as the light allows (target ≤1600; the D-Log M ceiling is 12 800 [DJI-SPEC]), WB locked (e.g. 4000–5000 K to match the lamps), **D-Log M** (10-bit in files), no digital effects. There is no HDR video switch to turn off [DJI-FAQ]. Verify which combination gives the highest bitrate (DJI publishes only the 180 Mbps maximum).
- Record the `.OSV` (+ `.LRF`, `.SRT`). Never rely on reframed recordings.

**Lighting**
Add 2–4 portable LED panels (flicker-free, high CRI), static during each pass, so the lighting stays consistent. Better a constant, even field than bright spots.

**Markers (as seen by a 360 camera)**
- Angular size: a marker needs about ≥40–60 px across in the fisheye to decode robustly [assessment]. At 18 px/deg that means ≥2.5–3.5° subtended. So **A3 (~30 cm) markers are readable to about 5–6 m; A4 (~20 cm) to about 3–4 m** [CALC: size/(d·tan(θ))].
- Keep scale markers **≥1.5 m** from the lens when they are observed (the rated near focus limit, §5.9).
- Placement: mostly on the **floor** (seen at the down-lens centre, best resolution and away from the seam; at 1.2–1.5 m flight height, the floor right below is just inside the focus limit, so prefer detections from 1.5–5 m slant range) and on **pillars at heights well away from flight height** (e.g. flight at 1.5 m, markers at 0.3 m and 2.3 m). Avoid the horizon band.
- Use unique IDs in every bay to break repetition. Measure held-out marker-to-marker distances with tape or laser (see project accuracy target). Add ≥3 distances >20 m for the ≤1% global check.

**Flight**
- Mode: **Cine** (vision positioning and obstacle sensing stay on; never Sport, where they are disabled [DJI-MANUAL]). Speed **0.3–0.5 m/s**, yaw ≤10°/s, no rolls or flips. Keep nearly constant attitude; let the 360 camera do the "looking around".
- Height: ~1.2–1.8 m (between car roofs and the ceiling services) so floor and ceiling both lie within ~1–2 m of a lens centre. Keep ≥0.75 m from pillars and walls (seam parallax and safety).
- Path: lawnmower lanes down each driving aisle, plus **closed loops** around each block of bays. Revisit a start "anchor" area every 1–2 minutes for drift and loop control. Overlap is not a concern for 360 video at 25 fps; spacing between kept frames of 0.15–0.3 m is ample (assessment).
- Battery sorties of ≤15 min, each beginning and ending at a shared, marker-rich anchor area so separate flights can be merged.

**Supplement**
At each marker cluster or junction, **hover 3–5 s and take 120 MP DNG stills in Pro mode** (Pro mode disables the multi-frame SmartPhoto merge [DJI-MANUAL]; DNG is 15360×7680 [DJI-SPEC]) (or capture them with a handheld Osmo 360 / tripod if allowed). These give the highest-resolution marker observations and a rigid, blur-free "backbone".

---

## 7. Open unknowns: measure on the actual device

1. **Inter-lens baseline b** (translation between optical centres). Not in the DJI spec, FAQ or manual, and not in any reachable review (second pass). Method: calibrate as a 2-camera rig with a board passing through the overlap band.
2. **Rolling-shutter readout time** per mode (8K60, 6K25…), and the row direction for each lens. Not published by DJI; no lab test (CineD/DPReview-style) found for the Avata 360 or Osmo 360 in the second pass. Method: 100 Hz flicker banding (count bands per frame) or a fast-pan edge test.
3. **Actual bitrate** per mode/frame rate (`ffprobe`), and whether 25 fps gets the full 180 Mbps.
4. **Airframe visibility**: which pixels of each fisheye show props, guards or arms. DJI confirms parts of the aircraft can appear in the live view and are removed from the final (stitched) footage [DJI-MANUAL], but publishes no sector. Method: hover clip in a uniform, textured room; temporal-median mask (a motors-off clip is not possible, see §6).
5. **Accuracy of the factory calibration** versus your own fit (reprojection on an independent board). Effect of lens protectors.
6. **ISO/noise curve**: which ISO preserves enough concrete texture after H.265. Method: record a static scene at ISO 400/800/1600/3200 and count repeatable keypoints.
7. **Vision-positioning behaviour** in the target lot at its real lux: hover drift over 60 s, obstacle-braking distances near pillars.
8. **Metadata schema for your firmware**: which fields hold attitude and per-frame exposure. Validate quaternion-derived gravity against a level surface.
9. **Single-lens mode FOV and projection**: DJI names the presets ("Natural Wide"; with goggles also "Standard (Dewarp)" and "Wide") but gives no angles [DJI-SPEC]. One review says "28 mm equivalent" [SNIPPET, UNVERIFIED]. FocusTrack fixes the 360° reframed view at 104° [DJI-MANUAL], which is a reframe, not a lens FOV. If single-lens mode is a dewarped crop with mechanical tilt, it may give higher px/deg for marker close-ups, but it is EIS-processed.
10. Whether 120 MP stills in **Pro mode** are single exposures. DJI says SmartPhoto (multi-frame) is the default and is disabled in Pro mode [DJI-MANUAL], but the 120 MP path may still be a remosaic of the quad-Bayer sensor.
11. **Real defocus at 0.5–1.5 m** (fixed focus rated 1.5 m–∞): measure MTF/edge width on a board at those distances.
12. Whether the Avata 360 has any **anti-flicker** setting (none in the manual or spec) and how the rolling shutter interacts with 100 Hz light at 1/100 s.

---

## Handoff

- **Input format decision:** decode `.OSV` into the **two raw 3840×3840 10-bit fisheye streams** and model them as a **2-camera rigid rig**. Use stitched equirect (DJI Studio) only as a fallback or baseline, and then mask the horizon seam band.
- **The seam is on the horizon** (lenses face up and down). Parallax ≈ b/d: tens of pixels at 1–2 m. The inter-lens baseline b is unpublished and must be calibrated.
- **Lens model:** DJI uses KB-5 + tangential (f-θ) per lens, with factory calibration embedded per unit (fx ≈ 1040–1047 px, ~105° half-FOV). Downstream camera models must handle **θ > 90°** (EUCM/Double-Sphere/bearing-vector), not tan θ-based models.
- **Resolution budget:** ~18 px/deg native (≈2100 px across a matched 90° perspective crop). 6K equirect ≈ native. 8K equirect slightly upsamples.
- **IMU priors are available:** per-frame and ~1–4 kHz fused attitude quaternions (gravity good to ~0.1–0.3°). Gyroflow 1.7.0 reads the motion data; ExifTool has no Avata 360 schema. Parsers are immature, so plan to write or adapt a protobuf reader (OpenOSV, Apache-2.0, is the best starting point).
- **Capture:** 360° mode, Pro mode, 25 fps, 1/100 s, fixed ISO (D-Log M ceiling 12 800) and WB, D-Log M, stabilization off in export (no HDR video mode exists); Cine flight mode at 0.3–0.5 m/s; markers on the floor and ceiling or off the horizon band, observed from 1.5–5 m; A3 markers within ~5 m; 120 MP DNG stills in Pro mode at control stations.
- **Verified optics (official):** 2 × 1/1.1″ square 64 MP sensors, 2.4 µm binned pixels, 200° FOV, f = 2.5 mm, f/1.9, **fixed focus 1.5 m–∞**. 2.5 mm / 2.4 µm ≈ 1040 px/rad matches the factory fx, so the 3840-px streams are the binned readout.
- **Flight safety indoors:** official vision limits (>1 lux, >20% diffuse reflectivity, fails on repeating patterns, reflective/IR-absorbing surfaces such as asphalt) mean the drone may drop to ATTI in a car park. Omnidirectional sensing exists only in 360° mode, and nothing in Sport mode.
- **Scale comes only from markers.** Indoors there is no GNSS, and the drone's VIO is not logged in camera metadata.
- **Fixed per-lens masks** are needed for the airframe and the blend band. Expect noise (ISO 800–3200) and heavy compression (0.10 bpp at 8K60).
- DJI spec numbers are now **verified** against the official spec page, FAQ and User Manual v1.0 (second pass). The ISO disagreement (12 800 vs 25 600) and the speed disagreement (12 vs 16 m/s in Normal) are both mode-dependent and resolved in §1.1. Still unverified: inter-lens baseline, rolling-shutter readout, airframe-visible sector, single-lens FOV in degrees, per-mode bitrates.

```json
[
  {"key": "OpenOSV", "title": "OpenOSV: open-source DJI Osmo 360 (.OSV) workflow (importer, stitcher, reframe)", "authors": "Kemerd", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/Kemerd/OpenOSV", "code": "https://github.com/Kemerd/OpenOSV", "license": "Apache-2.0", "type": "repo", "verified": true},
  {"key": "OpenOSV_PR3", "title": "DJI Avata 360: clips stitch (its own field numbering), colour fitted to DJI's Avata 360 LUT, lens-up levelling (PR #3)", "authors": "Kemerd; test data by debsahu", "venue": "GitHub pull request", "year": 2026, "url": "https://github.com/Kemerd/OpenOSV/pull/3", "code": "https://github.com/Kemerd/OpenOSV", "license": "Apache-2.0", "type": "secondary", "verified": true},
  {"key": "OSVConverterFormat", "title": "dji-osv-converter docs: osv-format.md (reverse-engineered OSV format reference)", "authors": "zindello", "venue": "GitHub repository docs", "year": 2026, "url": "https://github.com/zindello/dji-osv-converter/blob/main/docs/osv-format.md", "code": "https://github.com/zindello/dji-osv-converter", "license": null, "type": "secondary", "verified": true},
  {"key": "OSVConverterNotes", "title": "dji-osv-converter docs: osv-format-notes.md (tracks, calibration block, DJI f-theta lens model, stitch parameters)", "authors": "zindello", "venue": "GitHub repository docs", "year": 2026, "url": "https://github.com/zindello/dji-osv-converter/blob/main/docs/osv-format-notes.md", "code": "https://github.com/zindello/dji-osv-converter", "license": null, "type": "secondary", "verified": true},
  {"key": "OSVConverterLevelling", "title": "dji-osv-converter docs: levelling.md (RockSteady / horizon levelling math, RS correction disabled)", "authors": "zindello", "venue": "GitHub repository docs", "year": 2026, "url": "https://github.com/zindello/dji-osv-converter/blob/main/docs/levelling.md", "code": "https://github.com/zindello/dji-osv-converter", "license": null, "type": "secondary", "verified": true},
  {"key": "OSVConverterConstants", "title": "dji-osv-converter docs: constants.md (SEAM_OVERLAP_RATIO 0.038, RS_SIGMA 15)", "authors": "zindello", "venue": "GitHub repository docs", "year": 2026, "url": "https://github.com/zindello/dji-osv-converter/blob/main/docs/constants.md", "code": "https://github.com/zindello/dji-osv-converter", "license": null, "type": "secondary", "verified": true},
  {"key": "ExifToolDJI", "title": "Image::ExifTool::DJI (DJI.pm) protobuf tag definitions", "authors": "Phil Harvey", "venue": "ExifTool source (GitHub mirror)", "year": 2026, "url": "https://raw.githubusercontent.com/exiftool/exiftool/master/lib/Image/ExifTool/DJI.pm", "code": "https://github.com/exiftool/exiftool", "license": "Perl (Artistic/GPL) [UNVERIFIED]", "type": "repo", "verified": true},
  {"key": "GyroflowReleases", "title": "Gyroflow releases (v1.7.0: Osmo 360 and Avata 360 motion data only)", "authors": "Gyroflow contributors (AdrianEddy et al.)", "venue": "GitHub releases", "year": 2026, "url": "https://github.com/gyroflow/gyroflow/releases", "code": "https://github.com/gyroflow/gyroflow", "license": "GPL-3.0 [UNVERIFIED]", "type": "repo", "verified": true},
  {"key": "Gyroflow1164", "title": "Support Osmo 360 as two fisheye lens cameras (issue #1164)", "authors": "nagelp", "venue": "GitHub issue", "year": 2026, "url": "https://github.com/gyroflow/gyroflow/issues/1164", "code": null, "license": null, "type": "secondary", "verified": true},
  {"key": "TelemetryParser", "title": "telemetry-parser README (supported cameras; DJI flight logs TODO)", "authors": "AdrianEddy", "venue": "GitHub repository", "year": 2026, "url": "https://github.com/AdrianEddy/telemetry-parser", "code": "https://github.com/AdrianEddy/telemetry-parser", "license": null, "type": "repo", "verified": true},
  {"key": "OrbisReframe34", "title": "Avata 360 (issue #34): OSV/LRF/SRT, DJI lens model vs MEI", "authors": "Schabo/orbis-reframe contributors", "venue": "GitHub issue", "year": 2026, "url": "https://github.com/Schabo/orbis-reframe/issues/34", "code": null, "license": null, "type": "secondary", "verified": true},
  {"key": "AFP209", "title": "360 mode for DJI Osmo 360, Avata 360 and Insta360 Antigravity A1 (issue #209)", "authors": "anton-belkin/ActionFootagePlayer contributors", "venue": "GitHub issue", "year": 2026, "url": "https://github.com/anton-belkin/ActionFootagePlayer/issues/209", "code": null, "license": null, "type": "secondary", "verified": true},
  {"key": "COLMAPSpherical", "title": "COLMAP sensor/models/spherical.h (EQUIRECTANGULAR model)", "authors": "COLMAP contributors", "venue": "GitHub source", "year": 2026, "url": "https://github.com/colmap/colmap/blob/main/src/colmap/sensor/models/spherical.h", "code": "https://github.com/colmap/colmap", "license": "BSD-3-Clause [UNVERIFIED]", "type": "repo", "verified": true},
  {"key": "COLMAPFisheye", "title": "COLMAP sensor/models/fisheye.h and models.h (SIMPLE_FISHEYE, FISHEYE; eucm family)", "authors": "COLMAP contributors", "venue": "GitHub source", "year": 2026, "url": "https://github.com/colmap/colmap/blob/main/src/colmap/sensor/models/fisheye.h", "code": "https://github.com/colmap/colmap", "license": "BSD-3-Clause [UNVERIFIED]", "type": "repo", "verified": true},
  {"key": "DJISpecs", "title": "DJI Avata 360 - Specs", "authors": "DJI", "venue": "dji.com (UK regional page; US page returns 404)", "year": 2026, "url": "https://www.dji.com/uk/avata-360/specs", "code": null, "license": null, "type": "official", "verified": true},
  {"key": "DJIFAQ", "title": "DJI Avata 360 - FAQ", "authors": "DJI", "venue": "dji.com (UK regional page)", "year": 2026, "url": "https://www.dji.com/uk/avata-360/faq", "code": null, "license": null, "type": "official", "verified": true},
  {"key": "DJIManual", "title": "DJI Avata 360 User Manual v1.0 (2026.03)", "authors": "DJI", "venue": "dl.djicdn.com", "year": 2026, "url": "https://dl.djicdn.com/downloads/DJI_Avata_360/DJI_Avata_360_User_Manual_en.pdf", "code": null, "license": null, "type": "official", "verified": true},
  {"key": "DJISupport", "title": "Support for DJI Avata 360 (FAQ/specs)", "authors": "DJI", "venue": "dji.com", "year": 2026, "url": "https://www.dji.com/uk/support/product/avata-360", "code": null, "license": null, "type": "official", "verified": true},
  {"key": "DJIManualJune", "title": "DJI Avata 360 User Manual (2026-06-23 revision) and Release Notes (2026-11-13)", "authors": "DJI", "venue": "terra-1-g.djicdn.com (linked from dji.com downloads; host blocked in this sandbox)", "year": 2026, "url": "https://www.dji.com/uk/downloads/products/avata-360", "code": null, "license": null, "type": "official", "verified": false},
  {"key": "ExifToolDJITags", "title": "ExifTool Tag Names: DJI Tags (DJI Protobuf Tags), ExifTool 13.64", "authors": "Phil Harvey", "venue": "exiftool.org", "year": 2026, "url": "https://exiftool.org/TagNames/DJI.html", "code": "https://github.com/exiftool/exiftool", "license": null, "type": "docs", "verified": true},
  {"key": "GyroflowV170", "title": "Gyroflow v1.7.0: what's new (Osmo 360 and Avata 360 motion data only; Avata 360 aperture and focal length)", "authors": "Gyroflow contributors", "venue": "gyroflow.xyz", "year": 2026, "url": "https://gyroflow.xyz/download", "code": "https://github.com/gyroflow/gyroflow", "license": null, "type": "docs", "verified": true},
  {"key": "GyroflowReadme", "title": "Gyroflow README (supported gyro sources)", "authors": "Gyroflow contributors", "venue": "GitHub", "year": 2026, "url": "https://raw.githubusercontent.com/gyroflow/gyroflow/master/README.md", "code": "https://github.com/gyroflow/gyroflow", "license": null, "type": "repo", "verified": true},
  {"key": "CineDLunaUltra", "title": "Insta360 Luna Ultra Lab Test: rolling shutter, dynamic range and exposure latitude", "authors": "CineD", "venue": "cined.com", "year": 2026, "url": "https://www.cined.com/insta360-luna-ultra-lab-test-rolling-shutter-dynamic-range-and-exposure-latitude/", "code": null, "license": null, "type": "secondary", "verified": false},
  {"key": "Insta360Stitching", "title": "Insta360 X3 FAQ: stitching / minimum safety distance", "authors": "Insta360", "venue": "onlinemanual.insta360.com", "year": 2025, "url": "https://onlinemanual.insta360.com/x3/en-us/faq/specs/stitching", "code": null, "license": null, "type": "secondary", "verified": false},
  {"key": "Engadget2026", "title": "DJI Avata 360 drone review: 360 video hits new highs", "authors": "Engadget", "venue": "Engadget", "year": 2026, "url": "https://www.engadget.com/cameras/dji-avata-360-drone-review-360-video-hits-new-highs-120014666.html", "code": null, "license": null, "type": "secondary", "verified": false},
  {"key": "DCW2026", "title": "DJI Avata 360 review: 8K, FPV, and 360°", "authors": "Digital Camera World", "venue": "digitalcameraworld.com", "year": 2026, "url": "https://www.digitalcameraworld.com/drones/dji-avata-360-review", "code": null, "license": null, "type": "secondary", "verified": false},
  {"key": "Heliguy2026", "title": "How to edit DJI Avata 360 panoramic videos on a computer", "authors": "heliguy", "venue": "heliguy.com", "year": 2026, "url": "https://www.heliguy.com/blogs/posts/edit-dji-avata-360-panoramic-video-computer/", "code": null, "license": null, "type": "secondary", "verified": false},
  {"key": "CineD2026", "title": "DJI Avata 360 Drone Introduced - 8K60 360 Video and O4+ Transmission", "authors": "CineD", "venue": "cined.com", "year": 2026, "url": "https://www.cined.com/dji-avata-360-drone-introduced-8k60-360-video-and-o4-transmission/", "code": null, "license": null, "type": "secondary", "verified": false},
  {"key": "Kannala2006", "title": "A Generic Camera Model and Calibration Method for Conventional, Wide-Angle, and Fish-Eye Lenses", "authors": "Juho Kannala, Sami S. Brandt", "venue": "IEEE TPAMI", "year": 2006, "url": "https://doi.org/10.1109/TPAMI.2006.153", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Mei2007", "title": "Single View Point Omnidirectional Camera Calibration from Planar Grids", "authors": "Christopher Mei, Patrick Rives", "venue": "ICRA", "year": 2007, "url": "https://doi.org/10.1109/ROBOT.2007.364084", "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Khomenko2016", "title": "An Enhanced Unified Camera Model", "authors": "Bogdan Khomenko, Patrick Rives et al. [UNVERIFIED author list]", "venue": "IEEE Robotics and Automation Letters", "year": 2016, "url": null, "code": null, "license": null, "type": "paper", "verified": false},
  {"key": "Usenko2018", "title": "The Double Sphere Camera Model", "authors": "Vladyslav Usenko, Nikolaus Demmel, Daniel Cremers", "venue": "3DV", "year": 2018, "url": "https://arxiv.org/abs/1807.08957", "code": null, "license": null, "type": "paper", "verified": true}
]
```
