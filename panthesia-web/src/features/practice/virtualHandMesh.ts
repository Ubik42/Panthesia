import type * as Three from "three";
import type { HandPose, V3 } from "./virtualHandPose";
import { handSkin } from "./stageTheme";

/** The hands drawn as skinned meshes: the WebXR `generic-hand` model (immersive-web/
 * webxr-input-profiles, W3C Software and Document License, `public/models/generic-hand`).
 * The pose's joints drive the model's 25 joints directly; each bone turns from its rest
 * direction to the posed one. Seen from straight above (orthographic), flat white toon shading
 * with an outline, as in the reference video. Three.js loads with the first hands drawn. */

type Side = "left" | "right";
const FINGERS = ["index-finger", "middle-finger", "ring-finger", "pinky-finger"] as const;
const PHALANGES = ["phalanx-proximal", "phalanx-intermediate", "phalanx-distal", "tip"] as const;
const THUMB = ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"] as const;
/** Each joint and the joint its bone points to (the tip keeps its parent bone's turn). */
const CHAINS: string[][] = [
  ["wrist", ...THUMB],
  ...FINGERS.map((f) => [`${f}-metacarpal`, ...PHALANGES.map((p) => `${f}-${p}`)]),
];
const OUTLINE_PX = 2;

type Joint = { bone: Three.Bone; rest: Three.Vector3; restQuat: Three.Quaternion };
type Model = { root: Three.Object3D; joints: Map<string, Joint>; wrist: Three.Vector3; thickness: { value: number } };
type Kit = { THREE: typeof Three; models: Record<Side, Model> };

let kit: Promise<Kit> | null = null;
function loadKit(): Promise<Kit> {
  kit ??= (async () => {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const gradient = new THREE.DataTexture(new Uint8Array([168, 222, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
    const skin = new THREE.MeshToonMaterial({ color: handSkin.fill, gradientMap: gradient });
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
  private kit: Kit | null = null;
  private failed = false;
  private size = "";
  constructor(private canvas: HTMLCanvasElement, private wake: () => void) {}

  private setup(k: Kit) {
    const THREE = k.THREE;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xffffff, 1.6);
    // Light from the upper left, above: the same side as the drop shadow's offset implies.
    light.position.set(-0.6, 0.5, 1);
    this.scene.add(light);
    for (const side of ["left", "right"] as const) {
      k.models[side].root.visible = false;
      this.scene.add(k.models[side].root);
    }
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 4000);
    this.camera.position.set(0, 0, 2000);
    this.camera.lookAt(0, 0, 0);
  }

  draw(poses: HandPose[], width: number, height: number, top: number, opacity: number) {
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
