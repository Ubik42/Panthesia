import type * as Three from "three";
import { woodTile } from "../../stage/woodFloor";

/** The keyboard in 3D for the front camera of the virtual hands: millimetres in the keyboard's
 * frame (X along the keys, Y toward the fallboard, Z up from the white keys' surface), built
 * from the 2D layout so keys sit exactly where the stage draws them. Proportions and materials
 * after pianomotion-studio's 3D keyboard (shafranek-js, MIT; see NOTICE.md). */
type Geometry = (pitch: number) => { x: number; w: number } | undefined;
const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);
const WHITE_DEPTH = 22;
const BLACK_TOP = 10;
const BLACK_LENGTH = 0.635;
const PRESS = 4;

export type KeyboardModel = {
  group: Three.Group;
  keys: Map<number, { mesh: Three.Mesh; material: Three.MeshPhysicalMaterial; base: Three.Color; black: boolean }>;
  layout: string;
  width: number;
  depth: number;
};

export function buildKeyboard(THREE: typeof Three, geometry: Geometry, scale: number, keyHeight: number, low: number, high: number, layout: string): KeyboardModel {
  const group = new THREE.Group();
  const keys: KeyboardModel["keys"] = new Map();
  const white = new THREE.Color(0xf6f5f0),
    black = new THREE.Color(0x16171b);
  let right = 0;
  for (let pitch = low; pitch <= high; pitch++) {
    const g = geometry(pitch);
    if (!g) continue;
    const x = g.x / scale,
      w = g.w / scale;
    right = Math.max(right, x + w);
    const isB = isBlack(pitch);
    const length = isB ? keyHeight * BLACK_LENGTH : keyHeight;
    const height = isB ? BLACK_TOP + 12 : WHITE_DEPTH;
    const box = new THREE.BoxGeometry(isB ? w : w - 0.9, length, height, 1, 1, 1);
    if (isB) {
      // Black keys narrow toward the top and slope at the front.
      const pos = box.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) > 0) {
          pos.setX(i, pos.getX(i) * 0.8);
          if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) + 4);
        }
      }
      box.computeVertexNormals();
    }
    const material = new THREE.MeshPhysicalMaterial({
      color: isB ? black : white,
      roughness: isB ? 0.28 : 0.22,
      clearcoat: isB ? 0.55 : 0.45,
      clearcoatRoughness: 0.3,
    });
    const mesh = new THREE.Mesh(box, material);
    mesh.position.set(x + w / 2, isB ? keyHeight - length / 2 : length / 2, isB ? BLACK_TOP - height / 2 : -height / 2);
    mesh.castShadow = isB;
    mesh.receiveShadow = true;
    group.add(mesh);
    keys.set(pitch, { mesh, material, base: (isB ? black : white).clone(), black: isB });
  }
  // A digital piano in a room (seen in the free view): a slim body with a flat top behind the keys
  // (nothing in front of the hands), side panels to the floor, the keys 72 cm up; on the top a
  // vase of flowers and a photograph of the sea; a bench and a rug; sunlight through the windows.
  const satin = new THREE.MeshPhysicalMaterial({ color: 0x17161a, roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const box = (w: number, d: number, h: number, x: number, y: number, z: number, material: Three.Material, shadow = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const FLOOR = -720;
  /** Half the room's depth (and the space beside the keyboard): the piano stands in the middle. */
  const ROOM_HALF = 4200;
  const left = -40,
    wide = right + 80,
    mid = right / 2;
  const TOP = 38; // the body's flat top, above the white keys
  const backEdge = keyHeight + 170;
  // Key bed under the keys, the cheeks at both ends, the flat top behind the keys.
  box(wide, keyHeight + 30, 34, mid, keyHeight / 2 + 2, -WHITE_DEPTH - 17, satin);
  box(40, backEdge + 20, 70, left + 20, backEdge / 2 - 10, TOP - 35, satin);
  box(40, backEdge + 20, 70, right + 20, backEdge / 2 - 10, TOP - 35, satin);
  box(wide, backEdge - keyHeight + 10, 66, mid, (keyHeight + backEdge) / 2 + 5, TOP - 33, satin);
  // Felt strip where the keys meet the body.
  box(right, 6, 8, mid, keyHeight + 3, 4, new THREE.MeshStandardMaterial({ color: 0x5a1d24, roughness: 1 }), false);
  // Side panels and a back panel down to the floor, a pedal bar with three pedals.
  for (const x of [left + 15, right + 25]) box(30, backEdge - 40, -FLOOR - 40, x, backEdge / 2 + 20, (FLOOR - 40) / 2, satin);
  box(wide, 20, 560, mid, backEdge - 10, FLOOR + 380, satin);
  box(wide - 60, 260, 40, mid, backEdge - 160, FLOOR + 20, satin);
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xc9a253, metalness: 0.9, roughness: 0.28 });
  for (const dx of [-70, 0, 70]) box(36, 150, 12, mid + dx, backEdge - 300, FLOOR + 48, brass);

  // Floor.
  const tile = woodTile();
  const texture = new THREE.CanvasTexture(tile);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const floorWidth = right + 2 * ROOM_HALF,
    floorDepth = 2 * ROOM_HALF;
  texture.repeat.set(floorWidth / (tile.width * 2.2), floorDepth / (tile.height * 2.2));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorWidth, floorDepth), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 }));
  floor.position.set(mid, 0, FLOOR);
  floor.receiveShadow = true;
  group.add(floor);

  // A rug in front of the piano and a bench on it.
  const rugCanvas = document.createElement("canvas");
  rugCanvas.width = rugCanvas.height = 256;
  const rc = rugCanvas.getContext("2d")!;
  rc.fillStyle = "#6b2a24";
  rc.fillRect(0, 0, 256, 256);
  rc.strokeStyle = "#c9a25a";
  rc.lineWidth = 6;
  rc.strokeRect(14, 14, 228, 228);
  rc.strokeStyle = "#2c3a5a";
  rc.lineWidth = 3;
  rc.strokeRect(30, 30, 196, 196);
  for (let k = 0; k < 6; k++) {
    rc.beginPath();
    rc.arc(128, 128, 18 + k * 16, 0, Math.PI * 2);
    rc.strokeStyle = k % 2 ? "#c9a25a" : "#8b3b30";
    rc.stroke();
  }
  const rugTexture = new THREE.CanvasTexture(rugCanvas);
  rugTexture.colorSpace = THREE.SRGBColorSpace;
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(1600, right * 0.9), 1500), new THREE.MeshStandardMaterial({ map: rugTexture, roughness: 0.95 }));
  rug.position.set(mid, -700, FLOOR + 2);
  rug.receiveShadow = true;
  group.add(rug);
  const walnut = new THREE.MeshPhysicalMaterial({ color: 0x3a2416, roughness: 0.45, clearcoat: 0.5 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 });
  const benchW = Math.min(900, right * 0.6);
  box(benchW, 330, 60, mid, -520, FLOOR + 490, leather);
  box(benchW + 20, 350, 30, mid, -520, FLOOR + 450, walnut);
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) box(40, 40, 440, mid + dx * (benchW / 2 - 30), -520 + dy * 140, FLOOR + 220, walnut);

  // Walls: warm plaster above dark wainscoting, windows on the wall behind the piano. The piano
  // stands in the middle of the room; each wall is one-sided, facing in, so from outside the
  // room (a camera turned or zoomed far out) it is not drawn and never hides the piano.
  const plaster = new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.95 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
  const windowFrame = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 });
  const wall = (w: number, h: number, x: number, y: number, z: number, nx: number, ny: number, material: Three.Material) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.up.set(0, 0, 1);
    mesh.lookAt(x + nx, y + ny, z);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const backY = ROOM_HALF,
    frontY = -ROOM_HALF,
    wallW = right + 2 * ROOM_HALF;
  const sides: [number, number, number, number, number][] = [
    // centre x, centre y, width, inward normal x, y
    [mid, backY, wallW, 0, -1],
    [mid, frontY, wallW, 0, 1],
    [mid - wallW / 2, 0, 2 * ROOM_HALF, 1, 0],
    [mid + wallW / 2, 0, 2 * ROOM_HALF, -1, 0],
  ];
  for (const [x, y, w, nx, ny] of sides) {
    wall(w, 3000, x, y, FLOOR + 1500, nx, ny, plaster);
    wall(w, 900, x + nx * 3, y + ny * 3, FLOOR + 450, nx, ny, panel);
    wall(w, 30, x + nx * 6, y + ny * 6, FLOOR + 905, nx, ny, walnut);
  }
  for (const dx of [-1, 1]) {
    const wx = mid + dx * Math.max(900, right * 0.45);
    wall(900, 1300, wx, backY - 4, FLOOR + 1650, 0, -1, windowFrame);
    wall(800, 1200, wx, backY - 6, FLOOR + 1650, 0, -1, glow);
    wall(800, 24, wx, backY - 8, FLOOR + 1650, 0, -1, windowFrame);
    wall(24, 1200, wx, backY - 8, FLOOR + 1650, 0, -1, windowFrame);
  }

  // On the piano: a vase of flowers and a framed photograph of the sea.
  const vaseX = mid + Math.min(520, right * 0.33),
    topZ = TOP;
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ef, roughness: 0.05, transmission: 0.85, thickness: 6, ior: 1.45, transparent: true, opacity: 0.6 });
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(38, 30, 190, 32, 1, false), glass);
  vase.rotation.x = Math.PI / 2;
  vase.position.set(vaseX, keyHeight + 95, topZ + 95);
  group.add(vase);
  const stem = new THREE.MeshStandardMaterial({ color: 0x3f6b33, roughness: 0.8 });
  const petals = [0xf2c4ce, 0xffffff, 0xf5d36b, 0xe86f7e, 0xf2c4ce, 0xb58bd8, 0xffffff];
  const rnd = (k: number) => (Math.sin(k * 12.9898) * 43758.5453) % 1;
  petals.forEach((color, k) => {
    const a = (k / petals.length) * Math.PI * 2,
      lean = 0.18 + Math.abs(rnd(k + 1)) * 0.25,
      length = 260 + Math.abs(rnd(k + 3)) * 140;
    const end = new THREE.Vector3(vaseX + Math.cos(a) * Math.sin(lean) * length, keyHeight + 95 + Math.sin(a) * Math.sin(lean) * length, topZ + 190 + Math.cos(lean) * length * 0.75);
    const start = new THREE.Vector3(vaseX, keyHeight + 95, topZ + 120);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, start.distanceTo(end), 6), stem);
    rod.position.copy(start).add(end).multiplyScalar(0.5);
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
    group.add(rod);
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(34 + Math.abs(rnd(k + 7)) * 16, 16, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    bloom.scale.set(1, 1, 0.7);
    bloom.position.copy(end);
    bloom.castShadow = true;
    group.add(bloom);
    const centre = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe0a030, roughness: 0.8 }));
    centre.position.copy(end).add(new THREE.Vector3(0, -12, 18));
    group.add(centre);
  });
  for (let k = 0; k < 5; k++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(30, 10, 8), stem);
    leaf.scale.set(1.6, 0.35, 0.6);
    const a = k * 1.3;
    leaf.position.set(vaseX + Math.cos(a) * 60, keyHeight + 95 + Math.sin(a) * 50, topZ + 230 + k * 18);
    leaf.rotation.z = a;
    group.add(leaf);
  }
  // The photograph: the sea at evening, drawn into the frame.
  const photo = document.createElement("canvas");
  photo.width = 320;
  photo.height = 240;
  const pc = photo.getContext("2d")!;
  const sky = pc.createLinearGradient(0, 0, 0, 140);
  sky.addColorStop(0, "#5f8fc9");
  sky.addColorStop(0.6, "#f2b27a");
  sky.addColorStop(1, "#f7d9a6");
  pc.fillStyle = sky;
  pc.fillRect(0, 0, 320, 140);
  pc.fillStyle = "#fff2c8";
  pc.beginPath();
  pc.arc(205, 128, 20, 0, Math.PI * 2);
  pc.fill();
  const sea = pc.createLinearGradient(0, 132, 0, 240);
  sea.addColorStop(0, "#3d78a8");
  sea.addColorStop(1, "#173e63");
  pc.fillStyle = sea;
  pc.fillRect(0, 132, 320, 108);
  pc.fillStyle = "rgba(255,236,190,0.75)";
  for (let k = 0; k < 14; k++) pc.fillRect(190 - k * 2 + ((k * 37) % 23), 136 + k * 6, 30 - k, 2);
  pc.strokeStyle = "rgba(255,255,255,0.35)";
  for (let k = 0; k < 10; k++) {
    pc.beginPath();
    const y = 150 + k * 9;
    pc.moveTo(0, y);
    for (let x = 0; x <= 320; x += 20) pc.lineTo(x, y + Math.sin(x * 0.05 + k) * 1.5);
    pc.stroke();
  }
  pc.fillStyle = "#e9d6b0";
  pc.beginPath();
  pc.moveTo(0, 240);
  pc.quadraticCurveTo(110, 205, 320, 228);
  pc.lineTo(320, 240);
  pc.fill();
  const photoTexture = new THREE.CanvasTexture(photo);
  photoTexture.colorSpace = THREE.SRGBColorSpace;
  const frameX = mid - Math.min(520, right * 0.33);
  const frame = new THREE.Group();
  const wood = new THREE.MeshPhysicalMaterial({ color: 0x6b4428, roughness: 0.4, clearcoat: 0.4 });
  const border = new THREE.Mesh(new THREE.BoxGeometry(250, 14, 196), wood);
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(214, 160), new THREE.MeshStandardMaterial({ map: photoTexture, roughness: 0.35 }));
  picture.rotation.x = Math.PI / 2;
  picture.position.y = -7.5;
  frame.add(border, picture);
  border.castShadow = true;
  frame.position.set(frameX, keyHeight + 110, topZ + 98);
  frame.rotation.x = -0.18;
  frame.rotation.z = 0.12;
  group.add(frame);

  // Sunlight through the windows: a warm sun casting long light, beams in the air and bright
  // patches on the floor.
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.4);
  sun.position.set(mid + 900, backY + 1400, FLOOR + 2600);
  sun.target.position.set(mid - 200, -900, FLOOR);
  group.add(sun, sun.target);
  const beamCanvas = document.createElement("canvas");
  beamCanvas.width = 4;
  beamCanvas.height = 128;
  const bc = beamCanvas.getContext("2d")!;
  const beamFade = bc.createLinearGradient(0, 0, 0, 128);
  beamFade.addColorStop(0, "rgba(255,226,170,0.55)");
  beamFade.addColorStop(1, "rgba(255,226,170,0)");
  bc.fillStyle = beamFade;
  bc.fillRect(0, 0, 4, 128);
  const beamTexture = new THREE.CanvasTexture(beamCanvas);
  const beamMaterial = new THREE.MeshBasicMaterial({ map: beamTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.55 });
  const patchMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const dx of [-1, 1]) {
    const wx = mid + dx * Math.max(900, right * 0.45);
    const from = new THREE.Vector3(wx, backY - 40, FLOOR + 1650),
      to = new THREE.Vector3(wx - 350, backY - 1900, FLOOR + 2);
    for (const spread of [-280, 0, 280]) {
      const a = from.clone().add(new THREE.Vector3(spread, 0, 0)),
        b = to.clone().add(new THREE.Vector3(spread * 1.2, 0, 0));
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(220, a.distanceTo(b)), beamMaterial);
      beam.position.copy(a).add(b).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().sub(b).normalize());
      group.add(beam);
    }
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1300), patchMaterial);
    patch.position.set(wx - 350, backY - 1900, FLOOR + 3);
    patch.rotation.z = 0.2;
    group.add(patch);
  }
  return { group, keys, layout, width: right, depth: keyHeight };
}

/** Sounding keys go down and take their note's colour. */
export function paintKeys(THREE: typeof Three, model: KeyboardModel, sounding: ReadonlyMap<number, string>) {
  const mix = new THREE.Color();
  for (const [pitch, key] of model.keys) {
    const color = sounding.get(pitch);
    if (color) {
      mix.set(color);
      key.material.color.copy(key.base).lerp(mix, key.black ? 0.75 : 0.6);
      key.material.emissive.copy(mix).multiplyScalar(0.18);
    } else {
      key.material.color.copy(key.base);
      key.material.emissive.setRGB(0, 0, 0);
    }
    const rest = key.black ? BLACK_TOP - (BLACK_TOP + 12) / 2 : -WHITE_DEPTH / 2;
    key.mesh.position.z = rest - (color ? PRESS : 0);
  }
}
