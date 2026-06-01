# Phone Scene Calibrator
https://behrtron.github.io/map_cam/
Static GitHub Pages app for capturing mobile camera background plates with paired JSON metadata and export presets for common game engines/rendering tools.

## What it does

- Runs as a static site on GitHub Pages.
- Opens the phone camera with `getUserMedia`.
- Captures a photo plate into canvas.
- Stores the image plus a paired JSON manifest in IndexedDB.
- Records available device data, camera track settings/capabilities, screen/viewport data, device orientation, motion, and optional GPS.
- Lets you tune an estimated pinhole camera: vertical FOV, horizon, yaw, pitch, roll, camera height, near/far clipping, scale, and background depth.
- Exports per-capture ZIP files containing:
  - plate image
  - paired JSON manifest
  - Unity C# setup helper
  - Unreal JSON preset
  - Blender Python setup script
  - Three.js snippet
  - Godot GDScript helper
  - glTF camera JSON
  - foreground occluder masks as SVG and PNG
- Includes a Three.js preview with a low-poly character composited over the photo plate.
- Supports drawing foreground occluder polygons so objects in the photo can appear in front of the 3D character.

## Important limitations

A browser on a phone usually cannot provide full calibrated camera intrinsics, lens distortion, rolling shutter, true depth, or real object geometry. This app exports everything the browser can reasonably expose, then labels the remaining values as estimates. For a professional matchmove workflow, calibrate with known scene measurements, a checkerboard/AprilTag board, photogrammetry, LiDAR, or native ARKit/ARCore data.

This project is best for PS1/pre-rendered-background workflows where a static plate is combined with hand-tuned perspective, ground plane, colliders, and occlusion mattes.

## Deploy on GitHub Pages

1. Create a new GitHub repository.
2. Copy every file in this folder into the repository root.
3. Commit and push.
4. In GitHub, open **Settings -> Pages**.
5. Set **Source** to deploy from your branch, usually `main`, and folder `/root`.
6. Open the Pages URL on your phone.
7. Press **Enable camera + sensors**.

Camera, geolocation, and many sensor APIs require HTTPS or localhost, so do not expect them to work from a plain `file://` URL.

## Use workflow

1. Open the app on a phone.
2. Press **Enable camera + sensors**.
3. Optionally press **Update GPS**.
4. Aim the camera and press **Capture plate + JSON**.
5. In **Camera solve and scene alignment**, tune:
   - vertical FOV
   - horizon Y
   - pitch/yaw/roll
   - camera height
   - scale
   - near/far clips
6. Press **Apply to active capture**.
7. Press **Start preview** to see the low-poly character on the captured plate.
8. Press **Draw occluder** and tap around foreground objects that should cover the character.
9. Export the active capture ZIP or all captures ZIP.

## Coordinate conventions

The app preview uses:

- Y up
- meters
- ground plane at `y = 0`
- camera positioned at `{x:0, y:cameraHeightMeters, z:0}`
- camera looking toward negative Z in the Three.js preview
- `pitchDownDeg` is positive when the camera looks downward toward the ground

Engine exporters include per-engine notes because Unity, Unreal, Blender, Godot, Three.js, and glTF use different camera forward axes, up axes, units, and FOV conventions.

## Privacy notes

- Captures are stored locally in your browser's IndexedDB.
- Device IDs and group IDs from camera APIs are redacted in exported JSON.
- GPS is only included after permission is granted and the app receives a location fix.
- Export ZIPs may still contain sensitive location/device metadata; inspect JSON before sharing.

## Files

- `index.html` - app UI
- `css/styles.css` - responsive mobile-first styling
- `js/app.js` - main capture, metadata, storage, calibration, and UI logic
- `js/math.js` - camera math, FOV conversions, projection matrices, engine profiles
- `js/storage.js` - IndexedDB persistence
- `js/exporters.js` - JSON/snippet/ZIP/mask exporters
- `js/preview3d.js` - Three.js PS1-style plate preview
- `sw.js` - service worker for local same-origin files
- `manifest.webmanifest` - installable PWA metadata

## CDN dependencies

The app imports these browser modules from jsDelivr:

- JSZip 3.10.1
- Three.js 0.160.1

To make the app fully self-contained, download those libraries and change the import paths in `js/exporters.js` and `js/preview3d.js`.
