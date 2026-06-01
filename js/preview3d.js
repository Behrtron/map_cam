import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js";
import { degToRad, deriveCameraFromCapture } from "./math.js";

export class PlatePreview {
  constructor({ stage, plateImage, canvas, occlusionCanvas, hint }) {
    this.stage = stage;
    this.plateImage = plateImage;
    this.canvas = canvas;
    this.occlusionCanvas = occlusionCanvas;
    this.hint = hint;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.character = null;
    this.grid = null;
    this.record = null;
    this.frame = 0;
    this.running = false;
    this.pixelMode = false;
    this.imageUrl = null;
    this.clock = new THREE.Clock();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
  }

  setRecord(record) {
    this.record = record || null;
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null;

    if (!record) {
      this.plateImage.removeAttribute("src");
      this.stage.style.removeProperty("aspect-ratio");
      if (this.hint) this.hint.textContent = "Select or capture a plate, then press Start preview.";
      this.drawOcclusion();
      return;
    }

    this.imageUrl = URL.createObjectURL(record.imageBlob);
    this.plateImage.onload = () => {
      const w = record.json?.image?.width || this.plateImage.naturalWidth || 16;
      const h = record.json?.image?.height || this.plateImage.naturalHeight || 9;
      this.stage.style.aspectRatio = `${w} / ${h}`;
      if (this.hint) this.hint.textContent = "Preview ready. Use the movement buttons or keyboard WASD.";
      this.resize();
      this.applyCameraFromRecord();
      this.drawOcclusion();
    };
    this.plateImage.src = this.imageUrl;
  }

  start() {
    if (!this.renderer) this.createScene();
    this.running = true;
    this.resize();
    this.applyCameraFromRecord();
    this.animate();
  }

  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  togglePixelMode() {
    this.pixelMode = !this.pixelMode;
    this.stage.classList.toggle("pixelated", this.pixelMode);
    this.resize();
    return this.pixelMode;
  }

  createScene() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true
    });
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.03, 1000);
    this.scene.add(this.camera);

    const ambient = new THREE.AmbientLight(0xffffff, 1.35);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1.5);
    directional.position.set(1.5, 3.5, 2);
    this.scene.add(directional);

    this.grid = new THREE.GridHelper(30, 30, 0x60a5fa, 0x334155);
    this.grid.position.y = 0;
    this.scene.add(this.grid);

    this.character = this.makeCharacter();
    this.character.position.set(0, 0, -5);
    this.scene.add(this.character);
  }

  makeCharacter() {
    const group = new THREE.Group();
    group.name = "LowPolyPlateCharacter";

    const skin = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.75, flatShading: true });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.85, flatShading: true });
    const pants = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.9, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1, flatShading: true });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.85, 6), shirt);
    body.position.y = 0.95;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), skin);
    head.position.y = 1.52;
    group.add(head);

    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.12, 7), dark);
    hair.position.y = 1.72;
    group.add(hair);

    const legGeo = new THREE.BoxGeometry(0.16, 0.65, 0.18);
    const leftLeg = new THREE.Mesh(legGeo, pants);
    leftLeg.position.set(-0.12, 0.35, 0);
    group.add(leftLeg);
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.12;
    group.add(rightLeg);

    const armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.13);
    const leftArm = new THREE.Mesh(armGeo, skin);
    leftArm.position.set(-0.41, 0.93, 0);
    leftArm.rotation.z = 0.18;
    group.add(leftArm);
    const rightArm = leftArm.clone();
    rightArm.position.x = 0.41;
    rightArm.rotation.z = -0.18;
    group.add(rightArm);

    const footGeo = new THREE.BoxGeometry(0.23, 0.1, 0.34);
    const leftFoot = new THREE.Mesh(footGeo, dark);
    leftFoot.position.set(-0.12, 0.05, -0.04);
    group.add(leftFoot);
    const rightFoot = leftFoot.clone();
    rightFoot.position.x = 0.12;
    group.add(rightFoot);

    return group;
  }

  applyCameraFromRecord() {
    if (!this.camera || !this.record?.json) return;
    const solved = deriveCameraFromCapture(this.record.json);
    this.camera.fov = solved.lens.verticalFovDeg;
    this.camera.aspect = solved.image.aspect || this.camera.aspect;
    this.camera.near = solved.clipping.nearMeters;
    this.camera.far = solved.clipping.farMeters;
    this.camera.position.set(
      solved.transformMeters.position.x,
      solved.transformMeters.position.y,
      solved.transformMeters.position.z
    );
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(
      degToRad(-solved.transformMeters.rotationEulerDeg.pitchDownX),
      degToRad(solved.transformMeters.rotationEulerDeg.yawY),
      degToRad(solved.transformMeters.rotationEulerDeg.rollZ)
    );
    this.camera.updateProjectionMatrix();
  }

  move(direction) {
    if (!this.character) return;
    const amount = 0.25;
    if (direction === "forward") this.character.position.z -= amount;
    if (direction === "back") this.character.position.z += amount;
    if (direction === "left") this.character.position.x -= amount;
    if (direction === "right") this.character.position.x += amount;
  }

  resize() {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = this.pixelMode ? 0.38 : 1;
    const renderW = Math.max(1, Math.round(width * dpr * scale));
    const renderH = Math.max(1, Math.round(height * dpr * scale));

    if (this.renderer) {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(renderW, renderH, false);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      if (this.camera) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
    }

    this.occlusionCanvas.width = Math.round(width * dpr);
    this.occlusionCanvas.height = Math.round(height * dpr);
    this.occlusionCanvas.style.width = `${width}px`;
    this.occlusionCanvas.style.height = `${height}px`;
    this.drawOcclusion();
  }

  drawOcclusion() {
    const canvas = this.occlusionCanvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.record?.json || !this.plateImage.complete || !this.plateImage.naturalWidth) return;
    const masks = this.record.json.scene?.occluders || [];
    if (!masks.length) return;

    const rect = containRect(canvas.width, canvas.height, this.plateImage.naturalWidth, this.plateImage.naturalHeight);
    for (const mask of masks) {
      const points = mask.points || [];
      if (points.length < 3) continue;
      ctx.save();
      ctx.beginPath();
      points.forEach((pt, i) => {
        const x = rect.x + pt.x * rect.width;
        const y = rect.y + pt.y * rect.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(this.plateImage, rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    }
  }

  animate() {
    if (!this.running) return;
    this.frame = requestAnimationFrame(() => this.animate());
    const dt = this.clock.getDelta();
    if (this.character) {
      const t = performance.now() * 0.004;
      this.character.rotation.y = Math.sin(t) * 0.08;
      this.character.position.y = Math.abs(Math.sin(t * 1.4)) * 0.025;
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
    this.drawOcclusion();
  }
}

function containRect(canvasWidth, canvasHeight, imageWidth, imageHeight) {
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height
  };
}
