# Agent A1: DJI Avata 360 drone and camera primer

## Your role
You are a camera-systems and drone-imaging specialist. Produce a complete primer on the **DJI Avata 360** and its camera **as a measurement instrument for photogrammetry**: how it forms images, how that differs from ordinary footage, and which characteristics will limit or complicate metric 3D reconstruction in an underground parking lot.

## Required questions

### 1. Hardware and specifications (verified against official DJI specs)
- Sensors, lenses (FOV, aperture, focus range), pixel size, and the dual-lens geometry: baseline between optical centres, if published or estimable.
- Video modes (360° and single-lens), resolutions, frame rates, bitrate, codec, colour profiles (Normal, D-Log M, HDR), shutter-speed range, ISO range.
- Still photo modes (30 MP / 120 MP 360°, DNG). Are stills a viable alternative to video for this task?
- Drone: weight, flight time, positioning (vision sensors, ToF, GNSS), omnidirectional obstacle sensing, speed modes, indoor and low-light limits.

### 2. How a dual-fisheye 360 camera forms an image (teach this)
- Fisheye projection models (equidistant, equisolid, Kannala-Brandt, unified/EUCM) and why ~200° lenses overlap.
- **Stitching**: why the two lenses lack a shared optical centre, how parallax produces seam errors, and how error grows as objects get closer. Give the formula or an estimate of seam disparity versus distance, given the inter-lens baseline.
- **Equirectangular projection**: the mapping, distortion versus latitude, and pixel density at the poles versus the equator.
- **Reframing / "virtual gimbal"** and horizon levelling: what transformation is applied to each frame, and is it a pure rotation?
- Which stabilization (EIS, RockSteady, HorizonSteady or similar) is used, and how it changes the effective camera model frame by frame.

### 3. How it differs from regular footage (for photogrammetry)
- Compare with a standard perspective drone camera (e.g. a Mavic-class mechanical gimbal): FOV and coverage, angular resolution (pixels per degree), effective resolution per perspective crop (a 90° crop of an 8K equirect frame ≈ how many pixels?), noise, dynamic range.
- Why 360° helps structure-from-motion (constraints in all directions, robustness to occlusion), and why it hurts (low angular resolution, seams, a non-pinhole model, rolling shutter on two sensors).

### 4. Files and data access
- What exactly is inside **OSV**: stitched or dual fisheye? Which software exports what (DJI Studio, LightCut, DJI Fly, others)? Can unstitched or raw fisheye streams be obtained?
- Metadata: is IMU/gyro, attitude or gravity data embedded per frame (camera motion metadata, protobuf tracks, SRT, flight records .txt/.DAT)? Which tools parse it (exiftool, open-source parsers, Gyroflow support)? This matters for gravity priors in SfM.
- Is there any published intrinsic calibration or lens profile?

### 5. Characteristics that limit *this* task (the most important section)
For each item: **mechanism → expected effect on reconstruction → mitigation** (capture-side and processing-side).
- Rolling shutter: readout time, if published or measured by reviewers.
- Motion blur in low light, given the shutter and ISO limits.
- Sensor noise and compression (H.265 at ≤180 Mbps across 8K × 360° → the effective bitrate per steradian).
- Stitch-seam parallax at close range: parking-lot geometry puts walls, pillars and cars 1–5 m away.
- Exposure and white-balance changes, HDR mode, flicker from artificial light (50 Hz mains in Israel → shutter-speed choices).
- Stabilization and reframing effects on geometric consistency. What to disable?
- Nadir and zenith content: is the drone body visible? Where does the "invisible drone" stitching happen?
- Indoor flight: GPS-denied positioning, downward vision sensors in dim light, obstacle-sensing behaviour in tight spaces, safety.

### 6. Capture recommendations
A concrete capture protocol for an underground lot: mode, resolution, frame rate, shutter and ISO strategy, colour profile, stabilization settings, flight speed, height, path pattern (loops, overlap), lighting, marker placement as seen by a 360 camera, and whether to supplement with 360 stills.

## Sources to prioritise
DJI official spec, FAQ, user manual and release notes; DJI Studio / LightCut docs; in-depth reviews with measurements (e.g. DPReview, GSMArena-style lab tests, independent YouTube analyses with measured data, labelled as secondary); prior knowledge from the **DJI Osmo 360** and **Insta360 Antigravity A1**, which are related or competing hardware (state clearly where you transfer findings from them); the Gyroflow and exiftool documentation.

## Output
`research/A1_device.md`, about 3,000–5,000 words, with:
- a spec table;
- teaching sections with simple formulas;
- a **"Limitations → effect → mitigation" table**;
- the capture protocol;
- open unknowns (things to measure on the actual device);
- the Handoff and the JSON sources block.
