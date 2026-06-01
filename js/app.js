import {
  VERSION,
  clamp,
  defaultCalibration,
  deriveCameraFromCapture,
  enrichCaptureJson,
  round,
  safeNumber,
  solvePitchDownFromHorizon
} from "./math.js";
import {
  clearCaptures,
  deleteCapture,
  getAllCaptures,
  putCapture
} from "./storage.js";
import {
  buildAllZip,
  buildCaptureZip,
  downloadBlob,
  extensionFromMime,
  generateEngineSnippet,
  jsonBlob,
  makeJsonForExport,
  safeFileName
} from "./exporters.js";
import { PlatePreview } from "./preview3d.js";

const $ = id => document.getElementById(id);

const els = {
  secureBadge: $("secureBadge"),
  cameraState: $("cameraState"),
  video: $("video"),
  reticleCanvas: $("reticleCanvas"),
  liveReadout: $("liveReadout"),
  startButton: $("startButton"),
  captureButton: $("captureButton"),
  switchButton: $("switchButton"),
  geoButton: $("geoButton"),
  imageType: $("imageType"),
  quality: $("quality"),
  qualityOut: $("qualityOut"),
  targetWidth: $("targetWidth"),
  targetHeight: $("targetHeight"),
  activeCaptureSelect: $("activeCaptureSelect"),
  verticalFov: $("verticalFov"),
  verticalFovOut: $("verticalFovOut"),
  nearClip: $("nearClip"),
  farClip: $("farClip"),
  cameraHeight: $("cameraHeight"),
  unitsPerMeter: $("unitsPerMeter"),
  horizonY: $("horizonY"),
  horizonYOut: $("horizonYOut"),
  vanishingX: $("vanishingX"),
  vanishingXOut: $("vanishingXOut"),
  yawDeg: $("yawDeg"),
  pitchDeg: $("pitchDeg"),
  rollDeg: $("rollDeg"),
  backgroundDepth: $("backgroundDepth"),
  solvePitchButton: $("solvePitchButton"),
  applyCalibrationButton: $("applyCalibrationButton"),
  resetCalibrationButton: $("resetCalibrationButton"),
  previewStage: $("previewStage"),
  plateImage: $("plateImage"),
  threeCanvas: $("threeCanvas"),
  occlusionCanvas: $("occlusionCanvas"),
  maskEditCanvas: $("maskEditCanvas"),
  previewHint: $("previewHint"),
  previewState: $("previewState"),
  startPreviewButton: $("startPreviewButton"),
  pixelModeButton: $("pixelModeButton"),
  drawMaskButton: $("drawMaskButton"),
  finishMaskButton: $("finishMaskButton"),
  undoMaskPointButton: $("undoMaskPointButton"),
  clearMasksButton: $("clearMasksButton"),
  engineSelect: $("engineSelect"),
  generateSnippetButton: $("generateSnippetButton"),
  copySnippetButton: $("copySnippetButton"),
  downloadActiveJsonButton: $("downloadActiveJsonButton"),
  downloadActiveImageButton: $("downloadActiveImageButton"),
  downloadActiveZipButton: $("downloadActiveZipButton"),
  downloadAllZipButton: $("downloadAllZipButton"),
  snippetOutput: $("snippetOutput"),
  captureCount: $("captureCount"),
  refreshButton: $("refreshButton"),
  deleteActiveButton: $("deleteActiveButton"),
  deleteAllButton: $("deleteAllButton"),
  gallery: $("gallery"),
  galleryItemTemplate: $("galleryItemTemplate"),
  log: $("log")
};

const state = {
  stream: null,
  facingMode: "environment",
  records: [],
  activeId: null,
  latestOrientation: null,
  latestMotion: null,
  latestGeo: null,
  reticleFrame: 0,
  preview: null,
  maskMode: false,
  maskPoints: []
};

init();

async function init() {
  setSecureBadge();
  wireUi();
  updateRangeOutputs();

  state.preview = new PlatePreview({
    stage: els.previewStage,
    plateImage: els.plateImage,
    canvas: els.threeCanvas,
    occlusionCanvas: els.occlusionCanvas,
    hint: els.previewHint
  });

  await refreshRecords();
  await registerServiceWorker();
  log(`Ready. Version ${VERSION}. Use HTTPS/GitHub Pages for camera and sensors.`);
}

function wireUi() {
  els.startButton.addEventListener("click", startAll);
  els.captureButton.addEventListener("click", capturePlate);
  els.switchButton.addEventListener("click", switchCamera);
  els.geoButton.addEventListener("click", () => updateGeolocation(true));
  els.quality.addEventListener("input", updateRangeOutputs);
  for (const el of [els.verticalFov, els.horizonY, els.vanishingX]) {
    el.addEventListener("input", () => {
      updateRangeOutputs();
      drawReticleOnce();
    });
  }
  els.activeCaptureSelect.addEventListener("change", () => selectCapture(els.activeCaptureSelect.value));
  els.solvePitchButton.addEventListener("click", solvePitchFromHorizonUi);
  els.applyCalibrationButton.addEventListener("click", applyCalibrationToActive);
  els.resetCalibrationButton.addEventListener("click", resetCalibrationUi);

  els.startPreviewButton.addEventListener("click", () => {
    state.preview.start();
    els.previewState.textContent = "preview running";
    els.previewState.classList.add("ok");
    drawMaskEditOverlay();
  });
  els.pixelModeButton.addEventListener("click", () => {
    const on = state.preview.togglePixelMode();
    log(`PS1 pixel mode ${on ? "enabled" : "disabled"}.`);
  });
  els.drawMaskButton.addEventListener("click", startMaskDrawing);
  els.finishMaskButton.addEventListener("click", finishMaskDrawing);
  els.undoMaskPointButton.addEventListener("click", undoMaskPoint);
  els.clearMasksButton.addEventListener("click", clearMasks);
  els.maskEditCanvas.addEventListener("pointerdown", addMaskPoint);

  document.querySelectorAll("[data-move]").forEach(btn => {
    btn.addEventListener("click", () => state.preview.move(btn.dataset.move));
  });
  window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (key === "w" || key === "arrowup") state.preview.move("forward");
    if (key === "s" || key === "arrowdown") state.preview.move("back");
    if (key === "a" || key === "arrowleft") state.preview.move("left");
    if (key === "d" || key === "arrowright") state.preview.move("right");
  });

  els.generateSnippetButton.addEventListener("click", generateSnippetForActive);
  els.copySnippetButton.addEventListener("click", copySnippet);
  els.downloadActiveJsonButton.addEventListener("click", downloadActiveJson);
  els.downloadActiveImageButton.addEventListener("click", downloadActiveImage);
  els.downloadActiveZipButton.addEventListener("click", downloadActiveZip);
  els.downloadAllZipButton.addEventListener("click", downloadAllZip);
  els.refreshButton.addEventListener("click", refreshRecords);
  els.deleteActiveButton.addEventListener("click", deleteActive);
  els.deleteAllButton.addEventListener("click", deleteAll);
  window.addEventListener("resize", () => {
    drawReticleOnce();
    drawMaskEditOverlay();
  });
}

function setSecureBadge() {
  const secure = window.isSecureContext || location.protocol === "https:" || location.hostname === "localhost";
  els.secureBadge.textContent = secure ? "secure context" : "HTTPS required";
  els.secureBadge.classList.toggle("ok", secure);
  els.secureBadge.classList.toggle("warn", !secure);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && location.hostname !== "localhost") return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    log(`Service worker skipped: ${error.message}`);
  }
}

async function startAll() {
  try {
    await requestSensorPermissions();
    await startCamera();
  } catch (error) {
    log(`Start failed: ${error.message}`);
  }
}

async function requestSensorPermissions() {
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      log(`Orientation permission: ${result}.`);
    } catch (error) {
      log(`Orientation permission error: ${error.message}`);
    }
  }

  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      log(`Motion permission: ${result}.`);
    } catch (error) {
      log(`Motion permission error: ${error.message}`);
    }
  }

  window.addEventListener("deviceorientation", onDeviceOrientation, true);
  window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
  window.addEventListener("devicemotion", onDeviceMotion, true);
}

function onDeviceOrientation(event) {
  state.latestOrientation = {
    timestamp: new Date().toISOString(),
    type: event.type,
    alphaDeg: nullableRound(event.alpha),
    betaDeg: nullableRound(event.beta),
    gammaDeg: nullableRound(event.gamma),
    absolute: Boolean(event.absolute),
    webkitCompassHeadingDeg: nullableRound(event.webkitCompassHeading),
    webkitCompassAccuracyDeg: nullableRound(event.webkitCompassAccuracy)
  };
}

function onDeviceMotion(event) {
  state.latestMotion = {
    timestamp: new Date().toISOString(),
    intervalMs: nullableRound(event.interval),
    acceleration: vectorFromAcceleration(event.acceleration),
    accelerationIncludingGravity: vectorFromAcceleration(event.accelerationIncludingGravity),
    rotationRateDegPerSecond: event.rotationRate ? {
      alpha: nullableRound(event.rotationRate.alpha),
      beta: nullableRound(event.rotationRate.beta),
      gamma: nullableRound(event.rotationRate.gamma)
    } : null
  };
}

function vectorFromAcceleration(value) {
  if (!value) return null;
  return {
    x: nullableRound(value.x),
    y: nullableRound(value.y),
    z: nullableRound(value.z)
  };
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("navigator.mediaDevices.getUserMedia is not available in this browser/context.");
  }

  stopCamera();
  const idealWidth = clamp(parseInt(els.targetWidth.value, 10) || 1920, 320, 4096);
  const idealHeight = clamp(parseInt(els.targetHeight.value, 10) || 1080, 240, 4096);
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: state.facingMode },
      width: { ideal: idealWidth },
      height: { ideal: idealHeight },
      aspectRatio: { ideal: idealWidth / idealHeight }
    }
  };

  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (primaryError) {
    log(`Preferred camera failed, trying default camera: ${primaryError.message}`);
    state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }

  els.video.srcObject = state.stream;
  await new Promise(resolve => {
    if (els.video.readyState >= 2) resolve();
    else els.video.onloadedmetadata = () => resolve();
  });
  await els.video.play();

  els.captureButton.disabled = false;
  els.switchButton.disabled = false;
  els.cameraState.textContent = `${state.facingMode} camera on`;
  els.cameraState.classList.add("ok");
  startReticleLoop();
  logCameraTrack();
}

function stopCamera() {
  if (!state.stream) return;
  for (const track of state.stream.getTracks()) track.stop();
  state.stream = null;
}

async function switchCamera() {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  await startCamera();
}

function logCameraTrack() {
  const track = state.stream?.getVideoTracks?.()[0];
  if (!track) return;
  const settings = track.getSettings?.() || {};
  log(`Camera stream: ${settings.width || els.video.videoWidth} x ${settings.height || els.video.videoHeight}, facing ${settings.facingMode || state.facingMode}.`);
}

async function updateGeolocation(verbose = false) {
  if (!navigator.geolocation) {
    if (verbose) log("Geolocation API is not available.");
    return null;
  }
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        const coords = position.coords;
        state.latestGeo = {
          timestamp: new Date(position.timestamp).toISOString(),
          latitude: nullableRound(coords.latitude, 8),
          longitude: nullableRound(coords.longitude, 8),
          altitudeMeters: nullableRound(coords.altitude),
          accuracyMeters: nullableRound(coords.accuracy),
          altitudeAccuracyMeters: nullableRound(coords.altitudeAccuracy),
          headingDeg: nullableRound(coords.heading),
          speedMetersPerSecond: nullableRound(coords.speed)
        };
        if (verbose) log(`GPS updated: accuracy ${state.latestGeo.accuracyMeters ?? "unknown"} m.`);
        resolve(state.latestGeo);
      },
      error => {
        if (verbose) log(`GPS failed: ${error.message}`);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 5000 }
    );
  });
}

async function capturePlate() {
  if (!state.stream || !els.video.videoWidth || !els.video.videoHeight) {
    log("No video frame to capture yet.");
    return;
  }

  try {
    const targetWidth = clamp(parseInt(els.targetWidth.value, 10) || els.video.videoWidth, 320, 4096);
    const targetHeight = clamp(parseInt(els.targetHeight.value, 10) || els.video.videoHeight, 240, 4096);
    const mime = chooseCanvasMime(els.imageType.value);
    const quality = clamp(parseFloat(els.quality.value) || 0.92, 0.55, 1);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    drawVideoCover(ctx, els.video, targetWidth, targetHeight);

    const imageBlob = await canvasToBlob(canvas, mime, quality);
    const thumbBlob = await makeThumbnailBlob(canvas);
    const id = makeCaptureId();
    const ext = extensionFromMime(imageBlob.type || mime);
    const json = await createCaptureJson({ id, canvas, imageBlob, ext });
    const record = { id, imageBlob, thumbnailBlob: thumbBlob, json };
    await putCapture(record);
    state.activeId = id;
    await refreshRecords();
    selectCapture(id);
    log(`Captured ${id}: ${targetWidth} x ${targetHeight}, ${Math.round(imageBlob.size / 1024)} KB.`);
  } catch (error) {
    log(`Capture failed: ${error.message}`);
  }
}

async function createCaptureJson({ id, canvas, imageBlob, ext }) {
  const track = state.stream?.getVideoTracks?.()[0] || null;
  const calibration = readCalibrationUi({ json: { image: { width: canvas.width, height: canvas.height } } });
  calibration.source = "user_estimate";
  calibration.imageWidth = canvas.width;
  calibration.imageHeight = canvas.height;
  const base = {
    schema: "https://example.com/schemas/phone-scene-calibrator.capture.v1.json",
    app: {
      name: "Phone Scene Calibrator",
      version: VERSION,
      storage: "local IndexedDB, exported ZIP"
    },
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    image: {
      fileName: `${safeFileName(id)}.${ext}`,
      width: canvas.width,
      height: canvas.height,
      mimeType: imageBlob.type || `image/${ext}`,
      byteSize: imageBlob.size,
      colorSpace: "browser_canvas_default_srgb",
      source: "drawImage(video) from getUserMedia stream"
    },
    captureContext: {
      pageUrl: location.href,
      secureContext: window.isSecureContext,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      localTimeString: new Date().toString()
    },
    privacy: {
      note: "Device IDs are redacted by default. GPS is included only after using Update GPS or granting permission.",
      redactedFields: ["deviceId", "groupId"]
    },
    device: await getDeviceSnapshot(),
    cameraTrack: track ? getTrackSnapshot(track) : null,
    sensors: {
      orientationAtCapture: state.latestOrientation,
      motionAtCapture: state.latestMotion,
      geolocationAtCapture: state.latestGeo
    },
    calibration,
    scene: {
      coordinateSystem: "Y up, meters, ground plane y=0, camera preview looks toward negative Z",
      groundPlane: {
        normal: { x: 0, y: 1, z: 0 },
        offsetMeters: 0
      },
      backgroundPlate: {
        fileName: `${safeFileName(id)}.${ext}`,
        depthMeters: calibration.backgroundDepthMeters,
        use: "fixed matte/background plate"
      },
      occluders: [],
      colliders: [],
      notes: [
        "Draw occluder polygons around foreground objects that should cover the 3D character.",
        "Add real scene measurements in-engine for precise collision and scale."
      ]
    }
  };
  return enrichCaptureJson(base);
}

async function getDeviceSnapshot() {
  const nav = navigator;
  const snapshot = {
    userAgent: nav.userAgent,
    platform: nav.platform,
    vendor: nav.vendor,
    language: nav.language,
    languages: Array.from(nav.languages || []),
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemoryGB: nav.deviceMemory ?? null,
    maxTouchPoints: nav.maxTouchPoints ?? null,
    cookieEnabled: nav.cookieEnabled,
    online: nav.onLine,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      orientationType: screen.orientation?.type || null,
      orientationAngle: screen.orientation?.angle ?? null
    },
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    },
    visualViewport: window.visualViewport ? {
      width: round(window.visualViewport.width),
      height: round(window.visualViewport.height),
      scale: round(window.visualViewport.scale)
    } : null,
    userAgentData: null
  };

  if (nav.userAgentData) {
    snapshot.userAgentData = {
      brands: nav.userAgentData.brands || null,
      mobile: nav.userAgentData.mobile ?? null,
      platform: nav.userAgentData.platform || null,
      highEntropy: null
    };
    if (typeof nav.userAgentData.getHighEntropyValues === "function") {
      try {
        snapshot.userAgentData.highEntropy = await nav.userAgentData.getHighEntropyValues([
          "architecture",
          "bitness",
          "model",
          "platformVersion",
          "uaFullVersion",
          "fullVersionList"
        ]);
      } catch (error) {
        snapshot.userAgentData.highEntropyError = error.message;
      }
    }
  }
  return snapshot;
}

function getTrackSnapshot(track) {
  const settings = track.getSettings?.() || {};
  const capabilities = track.getCapabilities?.() || {};
  const constraints = track.getConstraints?.() || {};
  return {
    label: track.label || null,
    kind: track.kind,
    readyState: track.readyState,
    muted: track.muted,
    enabled: track.enabled,
    settings: redactDeviceIds(settings),
    capabilities: redactDeviceIds(capabilities),
    constraints: redactDeviceIds(constraints)
  };
}

function redactDeviceIds(input) {
  const copy = clonePlain(input || {});
  if ("deviceId" in copy) copy.deviceId = "[redacted]";
  if ("groupId" in copy) copy.groupId = "[redacted]";
  return copy;
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function drawVideoCover(ctx, video, width, height) {
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  const sourceAspect = sourceW / sourceH;
  const destAspect = width / height;
  let sx = 0;
  let sy = 0;
  let sw = sourceW;
  let sh = sourceH;
  if (sourceAspect > destAspect) {
    sw = sourceH * destAspect;
    sx = (sourceW - sw) / 2;
  } else {
    sh = sourceW / destAspect;
    sy = (sourceH - sh) / 2;
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
}

function chooseCanvasMime(requested) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const test = canvas.toDataURL(requested);
  if (test.startsWith(`data:${requested}`)) return requested;
  return requested === "image/png" ? "image/png" : "image/jpeg";
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new Error("Canvas export returned null."));
      else resolve(blob);
    }, mime, quality);
  });
}

async function makeThumbnailBlob(sourceCanvas) {
  const maxW = 420;
  const scale = Math.min(1, maxW / sourceCanvas.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceCanvas.width * scale);
  canvas.height = Math.round(sourceCanvas.height * scale);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, "image/jpeg", 0.72);
}

function makeCaptureId() {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "Z");
  let random = Math.floor(Math.random() * 0xffffffff);
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint32Array(1);
    globalThis.crypto.getRandomValues(bytes);
    random = bytes[0];
  }
  return `plate_${stamp}_${random.toString(16)}`;
}

async function refreshRecords() {
  state.records = await getAllCaptures();
  if (state.activeId && !state.records.some(record => record.id === state.activeId)) {
    state.activeId = null;
  }
  if (!state.activeId && state.records.length) state.activeId = state.records[0].id;
  renderActiveSelect();
  renderGallery();
  const active = getActiveRecord();
  if (active) {
    writeCalibrationUi(active.json.calibration || defaultCalibration(active.json.image?.width, active.json.image?.height));
    state.preview?.setRecord(active);
  } else {
    state.preview?.setRecord(null);
    els.snippetOutput.value = "";
  }
  els.captureCount.textContent = `${state.records.length} capture${state.records.length === 1 ? "" : "s"}`;
  drawMaskEditOverlay();
}

function renderActiveSelect() {
  els.activeCaptureSelect.innerHTML = "";
  if (!state.records.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No captures yet";
    els.activeCaptureSelect.appendChild(option);
    return;
  }
  for (const record of state.records) {
    const option = document.createElement("option");
    option.value = record.id;
    option.textContent = `${record.id} (${record.json?.image?.width || "?"}x${record.json?.image?.height || "?"})`;
    option.selected = record.id === state.activeId;
    els.activeCaptureSelect.appendChild(option);
  }
}

function renderGallery() {
  els.gallery.innerHTML = "";
  for (const record of state.records) {
    const node = els.galleryItemTemplate.content.firstElementChild.cloneNode(true);
    const img = node.querySelector("img");
    const title = node.querySelector("h3");
    const meta = node.querySelector("p");
    const thumb = record.thumbnailBlob || record.imageBlob;
    const url = URL.createObjectURL(thumb);
    img.src = url;
    img.onload = () => setTimeout(() => URL.revokeObjectURL(url), 30000);
    title.textContent = record.id;
    const fov = deriveCameraFromCapture(record.json).lens.verticalFovDeg;
    meta.textContent = `${record.json?.createdAt || "unknown time"} | ${record.json?.image?.width || "?"}x${record.json?.image?.height || "?"} | vFOV ${fov} deg | masks ${(record.json.scene?.occluders || []).length}`;
    node.classList.toggle("active", record.id === state.activeId);
    node.querySelector('[data-action="select"]').addEventListener("click", () => selectCapture(record.id));
    node.querySelector('[data-action="zip"]').addEventListener("click", async () => {
      const blob = await buildCaptureZip(record);
      downloadBlob(blob, `${safeFileName(record.id)}.zip`);
    });
    node.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      await deleteCapture(record.id);
      if (state.activeId === record.id) state.activeId = null;
      await refreshRecords();
      log(`Deleted ${record.id}.`);
    });
    els.gallery.appendChild(node);
  }
}

function selectCapture(id) {
  if (!id) return;
  state.activeId = id;
  const active = getActiveRecord();
  if (!active) return;
  writeCalibrationUi(active.json.calibration || defaultCalibration(active.json.image?.width, active.json.image?.height));
  renderActiveSelect();
  renderGallery();
  state.preview.setRecord(active);
  state.preview.applyCameraFromRecord();
  drawMaskEditOverlay();
  log(`Selected ${id}.`);
}

function getActiveRecord() {
  return state.records.find(record => record.id === state.activeId) || null;
}

function readCalibrationUi(record = getActiveRecord()) {
  const image = record?.json?.image || {};
  const existing = record?.json?.calibration || defaultCalibration(image.width, image.height);
  return {
    ...existing,
    source: existing.source || "user_estimate",
    verticalFovDeg: safeNumber(els.verticalFov.value, existing.verticalFovDeg || 55),
    nearClipMeters: Math.max(0.001, safeNumber(els.nearClip.value, existing.nearClipMeters || 0.03)),
    farClipMeters: Math.max(0.01, safeNumber(els.farClip.value, existing.farClipMeters || 1000)),
    cameraHeightMeters: Math.max(0, safeNumber(els.cameraHeight.value, existing.cameraHeightMeters || 1.6)),
    unitsPerMeter: Math.max(0.000001, safeNumber(els.unitsPerMeter.value, existing.unitsPerMeter || 1)),
    horizonYNormalized: clamp(safeNumber(els.horizonY.value, 50) / 100, 0, 1),
    vanishingPointNormalized: {
      x: clamp(safeNumber(els.vanishingX.value, 50) / 100, 0, 1),
      y: existing.vanishingPointNormalized?.y ?? 0.5
    },
    yawDeg: safeNumber(els.yawDeg.value, existing.yawDeg || 0),
    pitchDownDeg: safeNumber(els.pitchDeg.value, existing.pitchDownDeg || 0),
    rollDeg: safeNumber(els.rollDeg.value, existing.rollDeg || 0),
    backgroundDepthMeters: Math.max(0.1, safeNumber(els.backgroundDepth.value, existing.backgroundDepthMeters || 20)),
    imageWidth: image.width || existing.imageWidth,
    imageHeight: image.height || existing.imageHeight
  };
}

function writeCalibrationUi(calibration) {
  const c = { ...defaultCalibration(), ...(calibration || {}) };
  els.verticalFov.value = c.verticalFovDeg;
  els.nearClip.value = c.nearClipMeters;
  els.farClip.value = c.farClipMeters;
  els.cameraHeight.value = c.cameraHeightMeters;
  els.unitsPerMeter.value = c.unitsPerMeter;
  els.horizonY.value = (c.horizonYNormalized ?? 0.5) * 100;
  els.vanishingX.value = (c.vanishingPointNormalized?.x ?? 0.5) * 100;
  els.yawDeg.value = c.yawDeg || 0;
  els.pitchDeg.value = c.pitchDownDeg || 0;
  els.rollDeg.value = c.rollDeg || 0;
  els.backgroundDepth.value = c.backgroundDepthMeters || 20;
  updateRangeOutputs();
}

function updateRangeOutputs() {
  els.qualityOut.value = Number(els.quality.value).toFixed(2);
  els.verticalFovOut.value = Number(els.verticalFov.value).toFixed(1);
  els.horizonYOut.value = Number(els.horizonY.value).toFixed(1);
  els.vanishingXOut.value = Number(els.vanishingX.value).toFixed(1);
}

function solvePitchFromHorizonUi() {
  const active = getActiveRecord();
  const imageHeight = active?.json?.image?.height || parseInt(els.targetHeight.value, 10) || 1080;
  const pitch = solvePitchDownFromHorizon(
    imageHeight,
    safeNumber(els.horizonY.value, 50) / 100,
    safeNumber(els.verticalFov.value, 55)
  );
  els.pitchDeg.value = round(pitch, 3);
  log(`Solved pitchDownDeg ${round(pitch, 3)} from horizon.`);
}

async function applyCalibrationToActive() {
  const record = getActiveRecord();
  if (!record) {
    log("No active capture to calibrate.");
    return;
  }
  record.json.calibration = readCalibrationUi(record);
  record.json = enrichCaptureJson(record.json);
  await putCapture(record);
  await refreshRecords();
  selectCapture(record.id);
  generateSnippetForActive();
  log(`Applied calibration to ${record.id}.`);
}

function resetCalibrationUi() {
  const record = getActiveRecord();
  const width = record?.json?.image?.width || parseInt(els.targetWidth.value, 10) || 1920;
  const height = record?.json?.image?.height || parseInt(els.targetHeight.value, 10) || 1080;
  writeCalibrationUi(defaultCalibration(width, height));
  log("Calibration controls reset. Press Apply to store it on the active capture.");
}

function startMaskDrawing() {
  const record = getActiveRecord();
  if (!record) {
    log("Capture a plate before drawing masks.");
    return;
  }
  state.maskMode = true;
  state.maskPoints = [];
  els.maskEditCanvas.classList.add("editing");
  els.previewHint.textContent = "Tap around the foreground object. Press Finish polygon when done.";
  drawMaskEditOverlay();
}

async function finishMaskDrawing() {
  const record = getActiveRecord();
  if (!record || !state.maskMode) return;
  if (state.maskPoints.length < 3) {
    log("A mask needs at least 3 points.");
    return;
  }
  const masks = record.json.scene.occluders || [];
  const mask = {
    id: `occluder_${String(masks.length + 1).padStart(2, "0")}`,
    label: `Occluder ${masks.length + 1}`,
    type: "foreground_occluder_polygon",
    coordinateSpace: "normalized_image_uv_top_left_origin",
    depthBehavior: "preview_always_in_front_export_as_matte_or_depth_mesh",
    points: state.maskPoints.map(pt => ({ x: round(pt.x, 6), y: round(pt.y, 6) }))
  };
  record.json.scene.occluders = [...masks, mask];
  record.json = enrichCaptureJson(record.json);
  await putCapture(record);
  state.maskMode = false;
  state.maskPoints = [];
  els.maskEditCanvas.classList.remove("editing");
  await refreshRecords();
  selectCapture(record.id);
  log(`Added ${mask.id}.`);
}

function undoMaskPoint() {
  if (!state.maskPoints.length) return;
  state.maskPoints.pop();
  drawMaskEditOverlay();
}

async function clearMasks() {
  const record = getActiveRecord();
  if (!record) return;
  record.json.scene.occluders = [];
  record.json = enrichCaptureJson(record.json);
  await putCapture(record);
  state.maskMode = false;
  state.maskPoints = [];
  els.maskEditCanvas.classList.remove("editing");
  await refreshRecords();
  selectCapture(record.id);
  log(`Cleared masks for ${record.id}.`);
}

function addMaskPoint(event) {
  if (!state.maskMode) return;
  const rect = els.maskEditCanvas.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  state.maskPoints.push({ x, y });
  drawMaskEditOverlay();
}

function drawMaskEditOverlay() {
  const canvas = els.maskEditCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const record = getActiveRecord();
  if (!record) return;

  const existing = record.json.scene?.occluders || [];
  for (const mask of existing) drawPolygon(ctx, mask.points || [], w, h, "rgba(56, 189, 248, 0.18)", "rgba(56, 189, 248, 0.82)");
  if (state.maskPoints.length) drawPolygon(ctx, state.maskPoints, w, h, "rgba(167, 139, 250, 0.18)", "rgba(167, 139, 250, 0.95)", false);
}

function drawPolygon(ctx, points, w, h, fill, stroke, closed = true) {
  if (!points.length) return;
  ctx.save();
  ctx.lineWidth = 2 * Math.min(window.devicePixelRatio || 1, 2);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  points.forEach((pt, i) => {
    const x = pt.x * w;
    const y = pt.y * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (closed && points.length > 2) ctx.closePath();
  if (closed && points.length > 2) ctx.fill();
  ctx.stroke();
  ctx.fillStyle = stroke;
  for (const pt of points) {
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, 4 * Math.min(window.devicePixelRatio || 1, 2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function generateSnippetForActive() {
  const record = getActiveRecord();
  if (!record) {
    els.snippetOutput.value = "No active capture.";
    return;
  }
  const text = generateEngineSnippet(record, els.engineSelect.value);
  els.snippetOutput.value = text;
}

async function copySnippet() {
  const text = els.snippetOutput.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    log("Snippet copied to clipboard.");
  } catch (error) {
    log(`Clipboard failed: ${error.message}`);
  }
}

function downloadActiveJson() {
  const record = getActiveRecord();
  if (!record) return;
  downloadBlob(jsonBlob(makeJsonForExport(record)), `${safeFileName(record.id)}.json`);
}

function downloadActiveImage() {
  const record = getActiveRecord();
  if (!record) return;
  const fileName = record.json?.image?.fileName || `${safeFileName(record.id)}.${extensionFromMime(record.imageBlob.type)}`;
  downloadBlob(record.imageBlob, fileName);
}

async function downloadActiveZip() {
  const record = getActiveRecord();
  if (!record) return;
  try {
    const blob = await buildCaptureZip(record);
    downloadBlob(blob, `${safeFileName(record.id)}.zip`);
    log(`ZIP exported for ${record.id}.`);
  } catch (error) {
    log(`ZIP failed: ${error.message}`);
  }
}

async function downloadAllZip() {
  if (!state.records.length) {
    log("No captures to export.");
    return;
  }
  try {
    const blob = await buildAllZip(state.records);
    downloadBlob(blob, `phone_scene_captures_${new Date().toISOString().slice(0, 10)}.zip`);
    log(`All-captures ZIP exported with ${state.records.length} capture(s).`);
  } catch (error) {
    log(`All ZIP failed: ${error.message}`);
  }
}

async function deleteActive() {
  const record = getActiveRecord();
  if (!record) return;
  if (!confirm(`Delete ${record.id} from this browser?`)) return;
  await deleteCapture(record.id);
  state.activeId = null;
  await refreshRecords();
  log(`Deleted ${record.id}.`);
}

async function deleteAll() {
  if (!state.records.length) return;
  if (!confirm("Delete every local capture from this browser? Export a ZIP first if you need them.")) return;
  await clearCaptures();
  state.activeId = null;
  await refreshRecords();
  log("Deleted all local captures.");
}

function startReticleLoop() {
  if (state.reticleFrame) cancelAnimationFrame(state.reticleFrame);
  const loop = () => {
    drawReticleOnce();
    state.reticleFrame = requestAnimationFrame(loop);
  };
  loop();
}

function drawReticleOnce() {
  const canvas = els.reticleCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.lineWidth = 1 * dpr;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  for (let i = 1; i < 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo((w / 3) * i, 0);
    ctx.lineTo((w / 3) * i, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, (h / 3) * i);
    ctx.lineTo(w, (h / 3) * i);
    ctx.stroke();
  }

  const horizonY = clamp(safeNumber(els.horizonY.value, 50) / 100, 0, 1) * h;
  const vanishingX = clamp(safeNumber(els.vanishingX.value, 50) / 100, 0, 1) * w;
  ctx.strokeStyle = "rgba(56,189,248,0.9)";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(w, horizonY);
  ctx.stroke();
  ctx.fillStyle = "rgba(56,189,248,0.95)";
  ctx.beginPath();
  ctx.arc(vanishingX, horizonY, 5 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const track = state.stream?.getVideoTracks?.()[0];
  const settings = track?.getSettings?.() || {};
  const ori = state.latestOrientation;
  els.liveReadout.textContent = [
    state.stream ? `${settings.width || els.video.videoWidth}x${settings.height || els.video.videoHeight}` : "No stream",
    `vFOV ${Number(els.verticalFov.value).toFixed(1)} deg`,
    ori ? `alpha ${ori.alphaDeg ?? "?"} beta ${ori.betaDeg ?? "?"} gamma ${ori.gammaDeg ?? "?"}` : "orientation waiting",
    state.latestGeo ? `GPS +/-${state.latestGeo.accuracyMeters ?? "?"}m` : "GPS not stored"
  ].join(" | ");
}

function nullableRound(value, places = 6) {
  return Number.isFinite(Number(value)) ? round(Number(value), places) : null;
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  els.log.textContent = `${line}\n${els.log.textContent || ""}`.slice(0, 12000);
}
