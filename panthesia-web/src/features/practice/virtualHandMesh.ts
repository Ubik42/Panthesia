import type * as Three from "three";
import type { HandPose, V3 } from "./virtualHandPose";
import { handSkin } from "./stageTheme";
import { buildKeyboard, paintKeys, type KeyboardModel } from "./virtualKeyboard3d";

/** How the hands are seen: from straight above over the 2D keyboard, or from the front and
 * above with a 3D keyboard drawn under them. */
export type HandView = {
  camera: "top" | "front";
  geometry: (pitch: number) => { x: number; w: number } | undefined;
  low: number;
  high: number;
  /** Keys sounding now, with their note colours. */
  sounding: ReadonlyMap<number, string>;
  /** The keys' fallboard (top) and front edges on the canvas, pixels. */
  band: { top: number; bottom: number };
};

/** The hands drawn as skinned meshes: the WebXR `generic-hand` model (immersive-web/
 * webxr-input-profiles, W3C Software and Document License, `public/models/generic-hand`).
 * The pose's joints drive the model's 25 joints directly; each bone turns from its rest
 * direction to the posed one. Seen from straight above (orthographic), with a skin material
 * and a thin outline. Three.js loads with the first hands drawn. */

type Side = "left" | "right";
const FINGERS = ["index-finger", "middle-finger", "ring-finger", "pinky-finger"] as const;
const PHALANGES = ["phalanx-proximal", "phalanx-intermediate", "phalanx-distal", "tip"] as const;
const THUMB = ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"] as const;
/** Each joint and the joint its bone points to (the tip keeps its parent bone's turn). */
const CHAINS: string[][] = [
  ["wrist", ...THUMB],
  ...FINGERS.map((f) => [`${f}-metacarpal`, ...PHALANGES.map((p) => `${f}-${p}`)]),
];
const OUTLINE_PX = 1.2;

type Joint = { bone: Three.Bone; rest: Three.Vector3; restQuat: Three.Quaternion };
type Model = { root: Three.Object3D; joints: Map<string, Joint>; wrist: Three.Vector3; thickness: { value: number } };
type Kit = { THREE: typeof Three; models: Record<Side, Model> };

let kit: Promise<Kit> | null = null;
function loadKit(): Promise<Kit> {
  kit ??= (async () => {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    // Skin: a physically based material with a soft sheen (the light scattered in the skin's
    // surface) and a warm tone; lit by a warm key light, a cool fill and light from below.
    const skin = new THREE.MeshPhysicalMaterial({
      color: handSkin.fill,
      roughness: 0.62,
      metalness: 0,
      sheen: 0.6,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(handSkin.sheen),
      clearcoat: 0.08,
      clearcoatRoughness: 0.6,
    });
    const load = async (side: Side): Promise<Model> => {
      const gltf = await loader.loadAsync(`/models/generic-hand/${side}.glb`);
      const root = gltf.scene;
      root.matrixAutoUpdate = false;
      const joints = new Map<string, Joint>();
      root.traverse((o) => {
        if ((o as Three.Bone).isBone) joints.set(o.name, { bone: o as Three.Bone, rest: o.position.clone(), restQuat: o.quaternion.clone() });
      });
      const thickness = { value: 0.001 };
      let mesh: Three.SkinnedMesh | undefined;
      root.traverse((o) => {
        if ((o as Three.SkinnedMesh).isSkinnedMesh) mesh = o as Three.SkinnedMesh;
      });
      if (!mesh || !joints.has("wrist")) throw new Error("手模型缺少骨骼");
      mesh.material = skin;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      // Outline: the same skinned mesh pushed out along its normals, back faces only.
      const line = new THREE.MeshBasicMaterial({ color: handSkin.outline, side: THREE.BackSide });
      line.onBeforeCompile = (shader) => {
        shader.uniforms.outline = thickness;
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "uniform float outline;\nvoid main() {")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normalize(normal) * outline;");
      };
      const hull = new THREE.SkinnedMesh(mesh.geometry, line);
      hull.bind(mesh.skeleton, mesh.bindMatrix);
      hull.frustumCulled = false;
      mesh.parent!.add(hull);
      return { root, joints, wrist: joints.get("wrist")!.rest.clone(), thickness };
    };
    const [left, right] = await Promise.all([load("left"), load("right")]);
    return { THREE, models: { left, right } };
  })();
  return kit;
}

/** Rows of the turn from the model's axes (metres, palm normal along X, fingers toward -Y,
 * across the hand along Z) to the keyboard's (X along the keys, Y toward the fallboard, Z up). */
const AXES: Record<Side, number[][]> = {
  right: [
    [0, 0, 1],
    [0, -1, 0],
    [1, 0, 0],
  ],
  left: [
    [0, 0, -1],
    [0, -1, 0],
    [-1, 0, 0],
  ],
};

export class HandMeshDrawing {
  private renderer: Three.WebGLRenderer | null = null;
  private scene: Three.Scene | null = null;
  private camera: Three.OrthographicCamera | null = null;
  private perspective: Three.PerspectiveCamera | null = null;
  private keyLight: Three.DirectionalLight | null = null;
  private keyboard: KeyboardModel | null = null;
  private kit: Kit | null = null;
  private failed = false;
  private size = "";
  constructor(private canvas: HTMLCanvasElement, private wake: () => void) {}

  private setup(k: Kit) {
    const THREE = k.THREE;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff3e6, 0x6b4a36, 1.1));
    const light = new THREE.DirectionalLight(0xfff1e0, 2.2);
    // Key light from the upper left, above: the same side as the drop shadow's offset implies.
    light.position.set(-0.6, 0.5, 1);
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0004;
    light.shadow.radius = 3;
    this.scene.add(light);
    this.scene.add(light.target);
    this.keyLight = light;
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
    fill.position.set(0.8, -0.4, 0.6);
    this.scene.add(fill);
    for (const side of ["left", "right"] as const) {
      k.models[side].root.visible = false;
      this.scene.add(k.models[side].root);
    }
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 4000);
    this.camera.position.set(0, 0, 2000);
    this.camera.lookAt(0, 0, 0);
    this.perspective = new THREE.PerspectiveCamera(30, 1, 10, 20000);
    this.perspective.up.set(0, 0, 1);
  }

  draw(poses: HandPose[], width: number, height: number, top: number, opacity: number, view?: HandView) {
    if (!this.kit) {
      if (!this.failed)
        void loadKit().then(
          (k) => {
            this.kit = k;
            this.setup(k);
            this.wake();
          },
          () => (this.failed = true),
        );
      this.hide();
      return;
    }
    const { THREE, models } = this.kit;
    const renderer = this.renderer!,
      scene = this.scene!,
      camera = this.camera!;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const size = `${width}:${height}:${ratio}`;
    if (size !== this.size) {
      this.size = size;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
    }
    if (view?.camera === "front") return this.drawFront(poses, width, height, top, view);
    if (this.keyboard) this.keyboard.group.visible = false;
    this.keyLight!.castShadow = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setViewport(0, 0, width, height);
    const scale = poses[0]?.scale ?? 1,
      front = poses[0]?.front ?? height;
    // Millimetres on the keyboard to pixels: x * scale across, front - y * scale down.
    camera.left = 0;
    camera.right = width / scale;
    camera.top = front / scale;
    camera.bottom = (front - height) / scale;
    camera.updateProjectionMatrix();
    for (const side of ["left", "right"] as const) models[side].root.visible = false;
    for (const pose of poses) this.place(THREE, models[pose.side], pose);
    // Draw below the fallboard edge only, as the 2D hands did.
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, width, Math.max(0, height - top));
    renderer.clear();
    renderer.render(scene, camera);
    const lift = Math.max(2, scale * 5);
    this.canvas.style.filter = `drop-shadow(${lift.toFixed(1)}px ${(-lift * 0.15).toFixed(1)}px ${(lift * 0.9).toFixed(1)}px ${handSkin.shadow})`;
    this.canvas.style.opacity = String(opacity);
    this.canvas.style.visibility = poses.length ? "visible" : "hidden";
    this.canvas.dataset.handRenderer = "mesh";
    this.canvas.dataset.handPoses = String(poses.length);
  }

  /** Put one model in the pose: every joint at its posed place, every bone turned to point at
   * the next joint. */
  private place(THREE: typeof Three, model: Model, pose: HandPose) {
    const R = AXES[pose.side];
    const w = model.wrist;
    // Keyboard millimetres to model metres: the inverse of R (its transpose), about the wrist.
    // The hand's turn is applied to the whole model (below), so joints are placed unturned.
    const c = Math.cos(pose.yaw),
      sn = Math.sin(pose.yaw);
    const toModel = (p: V3) => {
      const ex = p.x - pose.wrist.x,
        ey = p.y - pose.wrist.y;
      const d = [c * ex + sn * ey, -sn * ex + c * ey, p.z - pose.wrist.z];
      return new THREE.Vector3(
        w.x + (R[0][0] * d[0] + R[1][0] * d[1] + R[2][0] * d[2]) / 1000,
        w.y + (R[0][1] * d[0] + R[1][1] * d[1] + R[2][1] * d[2]) / 1000,
        w.z + (R[0][2] * d[0] + R[1][2] * d[1] + R[2][2] * d[2]) / 1000,
      );
    };
    const posed = new Map<string, Three.Vector3>();
    posed.set("wrist", toModel(pose.wrist));
    pose.fingers[0].points.forEach((p, k) => posed.set(THUMB[k], toModel(p)));
    FINGERS.forEach((f, i) => {
      posed.set(`${f}-metacarpal`, toModel(pose.metacarpals[i]));
      pose.fingers[i + 1].points.forEach((p, k) => posed.set(`${f}-${PHALANGES[k]}`, toModel(p)));
    });
    const turn = new THREE.Quaternion(),
      from = new THREE.Vector3(),
      to = new THREE.Vector3();
    for (const chain of CHAINS) {
      for (let k = 0; k < chain.length; k++) {
        const joint = model.joints.get(chain[k]);
        const at = posed.get(chain[k]);
        if (!joint || !at) continue;
        const next = chain[k + 1];
        const nextJoint = next && model.joints.get(next);
        const nextAt = next && posed.get(next);
        // The wrist bone keeps its rest turn; the tip keeps the distal bone's turn.
        if (k > 0 && nextJoint && nextAt) {
          from.subVectors(nextJoint.rest, joint.rest).normalize();
          to.subVectors(nextAt, at).normalize();
          turn.setFromUnitVectors(from, to);
        } else if (k === 0) turn.identity();
        joint.bone.position.copy(at);
        joint.bone.quaternion.copy(turn).multiply(joint.restQuat);
      }
    }
    // Model metres to keyboard millimetres: key = wrist + Rz(yaw) 1000 R (m - w).
    const m = new THREE.Matrix4().set(
      R[0][0] * 1000, R[0][1] * 1000, R[0][2] * 1000, 0,
      R[1][0] * 1000, R[1][1] * 1000, R[1][2] * 1000, 0,
      R[2][0] * 1000, R[2][1] * 1000, R[2][2] * 1000, 0,
      0, 0, 0, 1,
    );
    m.premultiply(new THREE.Matrix4().makeRotationZ(pose.yaw));
    const shift = new THREE.Vector3(-w.x, -w.y, -w.z).applyMatrix4(m);
    m.setPosition(pose.wrist.x + shift.x, pose.wrist.y + shift.y, pose.wrist.z + shift.z);
    model.root.matrix.copy(m);
    model.root.matrixWorldNeedsUpdate = true;
    model.root.visible = true;
    model.thickness.value = OUTLINE_PX / pose.scale / 1000;
  }

  /** The front camera: a perspective view from in front of and above the keys, the 3D keyboard
   * under the hands, shadows from the hands on the keys. Covers the keyboard's area below `top`. */
  private drawFront(poses: HandPose[], width: number, height: number, top: number, view: HandView) {
    const { THREE, models } = this.kit!;
    const renderer = this.renderer!,
      scene = this.scene!,
      camera = this.perspective!,
      light = this.keyLight!;
    const keyPx = view.geometry(60)?.w ?? view.geometry(view.low)?.w ?? 20;
    const scale = poses[0]?.scale ?? keyPx / 23.5;
    const keyHeight = Math.max(60, (view.band.bottom - view.band.top) / scale);
    const layout = `${view.low}:${view.high}:${Math.round(scale * 1000)}:${Math.round(keyHeight)}:${Math.round(view.geometry(view.low)?.x ?? 0)}`;
    if (this.keyboard?.layout !== layout) {
      if (this.keyboard) scene.remove(this.keyboard.group);
      this.keyboard = buildKeyboard(THREE, view.geometry, scale, keyHeight, view.low, view.high, layout);
      scene.add(this.keyboard.group);
    }
    this.keyboard.group.visible = true;
    paintKeys(THREE, this.keyboard, view.sounding);
    for (const side of ["left", "right"] as const) models[side].root.visible = false;
    for (const pose of poses) this.place(THREE, models[pose.side], pose);
    // The camera: the whole visible width of keys at a 50 degree horizontal view, 40 degrees
    // above the keys, looking a little behind their middle.
    const regionHeight = Math.max(1, height - top);
    const span = width / scale;
    const aspect = width / regionHeight;
    const half = (25 * Math.PI) / 180;
    const distance = (span / 2 / Math.tan(half)) * 1.02;
    const elevation = (52 * Math.PI) / 180;
    const target = new THREE.Vector3(span / 2, keyHeight * 0.62, -4);
    camera.aspect = aspect;
    camera.fov = (2 * Math.atan(Math.tan(half) / aspect) * 180) / Math.PI;
    camera.near = distance * 0.2;
    camera.far = distance * 4;
    camera.position.set(target.x, target.y - distance * Math.cos(elevation), target.z + distance * Math.sin(elevation));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    // The key light casts the hands' shadows on the keys.
    light.castShadow = true;
    light.target.position.copy(target);
    light.position.set(target.x - 300, target.y - 450, target.z + 1300);
    const shadow = light.shadow.camera as Three.OrthographicCamera;
    shadow.left = -span * 0.6;
    shadow.right = span * 0.6;
    shadow.top = keyHeight * 3;
    shadow.bottom = -keyHeight * 3;
    shadow.near = 100;
    shadow.far = 4000;
    shadow.updateProjectionMatrix();
    renderer.setClearColor(0x15110e, 1);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, width, regionHeight);
    renderer.setScissor(0, 0, width, regionHeight);
    renderer.clear();
    renderer.render(scene, camera);
    this.canvas.style.filter = "none";
    this.canvas.style.opacity = "1";
    this.canvas.style.visibility = "visible";
    this.canvas.dataset.handRenderer = "mesh-front";
    this.canvas.dataset.handPoses = String(poses.length);
  }

  hide() {
    this.canvas.style.visibility = "hidden";
    this.canvas.dataset.handPoses = "0";
  }
  dispose() {
    this.hide();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
