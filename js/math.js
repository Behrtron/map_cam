export const VERSION = "1.0.0";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function degToRad(degrees) {
  return (Number(degrees) || 0) * Math.PI / 180;
}

export function radToDeg(radians) {
  return (Number(radians) || 0) * 180 / Math.PI;
}

export function round(value, places = 6) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function verticalToHorizontalFov(verticalFovDeg, aspect) {
  const v = degToRad(verticalFovDeg);
  return radToDeg(2 * Math.atan(Math.tan(v / 2) * aspect));
}

export function horizontalToVerticalFov(horizontalFovDeg, aspect) {
  const h = degToRad(horizontalFovDeg);
  return radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect));
}

export function focalLengthPixelsFromVerticalFov(imageHeight, verticalFovDeg) {
  const h = safeNumber(imageHeight, 1);
  const fov = degToRad(clamp(verticalFovDeg, 1, 179));
  return (h / 2) / Math.tan(fov / 2);
}

export function fovFromFocalLength(sensorSizeMm, focalLengthMm) {
  const sensor = safeNumber(sensorSizeMm, 0);
  const focal = safeNumber(focalLengthMm, 0);
  if (sensor <= 0 || focal <= 0) return null;
  return radToDeg(2 * Math.atan(sensor / (2 * focal)));
}

export function solvePitchDownFromHorizon(imageHeight, horizonYNormalized, verticalFovDeg) {
  const h = safeNumber(imageHeight, 1);
  const cy = h / 2;
  const horizonY = clamp(safeNumber(horizonYNormalized, 0.5), 0, 1) * h;
  const fy = focalLengthPixelsFromVerticalFov(h, verticalFovDeg);
  return radToDeg(Math.atan((cy - horizonY) / fy));
}

export function perspectiveMatrixColumnMajor(verticalFovDeg, aspect, near, far) {
  const f = 1 / Math.tan(degToRad(verticalFovDeg) / 2);
  const nf = 1 / (near - far);
  return [
    round(f / aspect), 0, 0, 0,
    0, round(f), 0, 0,
    0, 0, round((far + near) * nf), -1,
    0, 0, round((2 * far * near) * nf), 0
  ];
}

export function perspectiveMatrixRowMajor(verticalFovDeg, aspect, near, far) {
  const c = perspectiveMatrixColumnMajor(verticalFovDeg, aspect, near, far);
  return [
    c[0], c[4], c[8], c[12],
    c[1], c[5], c[9], c[13],
    c[2], c[6], c[10], c[14],
    c[3], c[7], c[11], c[15]
  ];
}

export function defaultCalibration(width = 1920, height = 1080) {
  return {
    source: "user_estimate",
    notes: [
      "Most mobile browsers do not expose true sensor size, focal length, lens distortion, or per-photo intrinsics.",
      "Adjust verticalFovDeg and horizonYNormalized until the 3D preview lines up with the plate."
    ],
    verticalFovDeg: 55,
    nearClipMeters: 0.03,
    farClipMeters: 1000,
    cameraHeightMeters: 1.6,
    unitsPerMeter: 1,
    horizonYNormalized: 0.5,
    vanishingPointNormalized: { x: 0.5, y: 0.5 },
    yawDeg: 0,
    pitchDownDeg: 0,
    rollDeg: 0,
    backgroundDepthMeters: 20,
    imageWidth: width,
    imageHeight: height
  };
}

export function deriveCameraFromCapture(captureJson) {
  const image = captureJson.image || {};
  const calibration = { ...defaultCalibration(image.width, image.height), ...(captureJson.calibration || {}) };
  const width = safeNumber(image.width, calibration.imageWidth || 1920);
  const height = safeNumber(image.height, calibration.imageHeight || 1080);
  const aspect = width / height;
  const verticalFovDeg = clamp(safeNumber(calibration.verticalFovDeg, 55), 1, 179);
  const horizontalFovDeg = verticalToHorizontalFov(verticalFovDeg, aspect);
  const near = Math.max(0.001, safeNumber(calibration.nearClipMeters, 0.03));
  const far = Math.max(near + 0.001, safeNumber(calibration.farClipMeters, 1000));
  const fx = focalLengthPixelsFromVerticalFov(height, verticalFovDeg);
  const fy = fx;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const pitchSolved = solvePitchDownFromHorizon(width ? height : 1080, calibration.horizonYNormalized, verticalFovDeg);
  const pitchDownDeg = safeNumber(calibration.pitchDownDeg, pitchSolved);
  const yawDeg = safeNumber(calibration.yawDeg, 0);
  const rollDeg = safeNumber(calibration.rollDeg, 0);
  const heightMeters = Math.max(0, safeNumber(calibration.cameraHeightMeters, 1.6));
  const unitsPerMeter = Math.max(0.000001, safeNumber(calibration.unitsPerMeter, 1));

  const intrinsics = {
    model: "estimated_pinhole_square_pixels",
    imageWidth: width,
    imageHeight: height,
    fxPx: round(fx),
    fyPx: round(fy),
    cxPx: round(cx),
    cyPx: round(cy),
    skew: 0,
    radialDistortion: null,
    tangentialDistortion: null,
    principalPointSource: "image_center_estimate",
    fovSource: calibration.source || "user_estimate"
  };

  const camera = {
    coordinateSystem: {
      appWorld: "Y up, meters, camera looks toward negative Z in preview",
      groundPlane: "y = 0",
      pitchConvention: "pitchDownDeg is positive when looking downward toward the ground"
    },
    image: { width, height, aspect: round(aspect, 8) },
    intrinsics,
    lens: {
      verticalFovDeg: round(verticalFovDeg, 6),
      horizontalFovDeg: round(horizontalFovDeg, 6),
      verticalFovRad: round(degToRad(verticalFovDeg), 8),
      horizontalFovRad: round(degToRad(horizontalFovDeg), 8),
      focalLengthPx: round(fy, 6)
    },
    clipping: { nearMeters: near, farMeters: far },
    transformMeters: {
      position: { x: 0, y: round(heightMeters), z: 0 },
      rotationEulerDeg: {
        yawY: round(yawDeg),
        pitchDownX: round(pitchDownDeg),
        rollZ: round(rollDeg)
      }
    },
    projection: {
      matrixColumnMajorOpenGL: perspectiveMatrixColumnMajor(verticalFovDeg, aspect, near, far),
      matrixRowMajorOpenGL: perspectiveMatrixRowMajor(verticalFovDeg, aspect, near, far)
    },
    alignment: {
      horizonYNormalized: round(calibration.horizonYNormalized, 6),
      vanishingPointNormalized: {
        x: round(calibration.vanishingPointNormalized?.x ?? 0.5, 6),
        y: round(calibration.vanishingPointNormalized?.y ?? 0.5, 6)
      },
      pitchFromHorizonDeg: round(pitchSolved, 6),
      backgroundDepthMeters: round(calibration.backgroundDepthMeters ?? 20, 6),
      unitsPerMeter: round(unitsPerMeter, 6)
    },
    confidence: {
      trackSettings: captureJson.cameraTrack?.settings ? "measured_by_browser" : "missing",
      fov: calibration.source === "calibrated" ? "calibrated_by_user" : "estimated_manual_default",
      pose: "estimated_from_manual_horizon_or_device_orientation",
      depthAndOcclusion: "manual_masks_and_planes_required"
    }
  };
  return camera;
}

export function buildEngineProfiles(captureJson) {
  const cam = deriveCameraFromCapture(captureJson);
  const h = cam.transformMeters.position.y;
  const yaw = cam.transformMeters.rotationEulerDeg.yawY;
  const pitchDown = cam.transformMeters.rotationEulerDeg.pitchDownX;
  const roll = cam.transformMeters.rotationEulerDeg.rollZ;
  const aspect = cam.image.aspect;
  const vFov = cam.lens.verticalFovDeg;
  const hFov = cam.lens.horizontalFovDeg;
  const near = cam.clipping.nearMeters;
  const far = cam.clipping.farMeters;
  const units = cam.alignment.unitsPerMeter;

  return {
    generic: cam,
    unity: {
      coordinateSystem: "Y up, local +Z forward, values in meters unless unitsPerMeter changes them",
      cameraFieldOfViewProperty: "Camera.fieldOfView uses vertical FOV in degrees",
      fieldOfViewDeg: round(vFov),
      aspect: round(aspect),
      nearClipPlane: near,
      farClipPlane: far,
      transform: {
        position: { x: 0, y: round(h * units), z: 0 },
        eulerDegreesXYZ: { x: round(pitchDown), y: round(yaw), z: round(roll) }
      },
      backgroundPlate: captureJson.image?.fileName || null,
      occluderMasks: captureJson.scene?.occluders || []
    },
    unreal: {
      coordinateSystem: "Z up, X forward, values in centimeters",
      cameraFieldOfViewProperty: "CameraComponent FieldOfView is treated as horizontal FOV in degrees",
      FieldOfView: round(hFov),
      AspectRatio: round(aspect),
      OrthoWidth: null,
      NearClipPlaneCm: round(near * 100),
      FarClipPlaneCm: round(far * 100),
      ActorTransform: {
        Location: { X: 0, Y: 0, Z: round(h * 100 * units) },
        Rotation: { Pitch: round(-pitchDown), Yaw: round(yaw), Roll: round(roll) },
        Scale3D: { X: 1, Y: 1, Z: 1 }
      },
      backgroundPlate: captureJson.image?.fileName || null,
      occluderMasks: captureJson.scene?.occluders || []
    },
    blender: {
      coordinateSystem: "Z up, camera looks local -Z, values in meters",
      camera: {
        angleYRad: round(degToRad(vFov), 8),
        angleXRad: round(degToRad(hFov), 8),
        lensUnit: "FOV",
        clipStart: near,
        clipEnd: far,
        sensorFit: "AUTO"
      },
      objectTransform: {
        locationXYZ: [0, round(-h * units), 0],
        rotationEulerXYZRadians: [round(degToRad(90 - pitchDown), 8), 0, round(degToRad(roll), 8)]
      },
      backgroundPlate: captureJson.image?.fileName || null,
      occluderMasks: captureJson.scene?.occluders || []
    },
    three: {
      coordinateSystem: "Y up, camera looks local -Z, values in meters",
      constructor: {
        fov: round(vFov),
        aspect: round(aspect),
        near,
        far
      },
      position: { x: 0, y: round(h * units), z: 0 },
      rotationOrder: "YXZ",
      rotationRadians: {
        x: round(degToRad(-pitchDown), 8),
        y: round(degToRad(yaw), 8),
        z: round(degToRad(roll), 8)
      },
      backgroundPlate: captureJson.image?.fileName || null,
      occluderMasks: captureJson.scene?.occluders || []
    },
    godot: {
      coordinateSystem: "Y up, camera looks local -Z, values in meters",
      Camera3D: {
        fov: round(vFov),
        near,
        far,
        keepAspect: "KEEP_HEIGHT"
      },
      transform: {
        origin: { x: 0, y: round(h * units), z: 0 },
        rotationDegreesXYZ: { x: round(-pitchDown), y: round(yaw), z: round(roll) }
      },
      backgroundPlate: captureJson.image?.fileName || null,
      occluderMasks: captureJson.scene?.occluders || []
    },
    gltf: {
      cameras: [
        {
          name: "PlateCamera",
          type: "perspective",
          perspective: {
            yfov: round(degToRad(vFov), 8),
            aspectRatio: round(aspect, 8),
            znear: near,
            zfar: far
          }
        }
      ],
      extras: {
        transformMeters: cam.transformMeters,
        backgroundPlate: captureJson.image?.fileName || null,
        occluderMasks: captureJson.scene?.occluders || []
      }
    }
  };
}

export function enrichCaptureJson(captureJson) {
  const copy = structuredCloneSafe(captureJson);
  copy.estimatedCamera = deriveCameraFromCapture(copy);
  copy.engineProfiles = buildEngineProfiles(copy);
  copy.updatedAt = new Date().toISOString();
  return copy;
}

export function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
