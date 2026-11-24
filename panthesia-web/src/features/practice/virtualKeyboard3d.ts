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
  // The piano around the keys and the room around the piano (seen in the free view): an upright
  // piano in black lacquer with the keys 72 cm above a wooden floor, a bench, a rug, walls with
  // wainscoting and a window.
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x0f0e10, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15 });
  const box = (w: number, d: number, h: number, x: number, y: number, z: number, material: Three.Material, shadow = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const FLOOR = -720;
  const left = -45,
    wide = right + 90,
    mid = right / 2;
  // Key bed, the cheeks at both ends, the upper case with its fallboard, the lower panel.
  box(wide, keyHeight + 40, 40, mid, keyHeight / 2 + 5, -WHITE_DEPTH - 20, lacquer);
  box(45, keyHeight + 50, 95, left + 22, keyHeight / 2 + 10, -20, lacquer);
  box(45, keyHeight + 50, 95, right + 23, keyHeight / 2 + 10, -20, lacquer);
  box(wide, 280, 1010, mid, keyHeight + 160, 445, lacquer);
  const fallboard = box(wide - 90, 40, 120, mid, keyHeight + 28, 40, lacquer);
  fallboard.rotation.x = -0.25;
  box(wide, 50, -FLOOR - 70, mid, keyHeight + 40, (FLOOR - 70) / 2 + 0, lacquer);
  box(wide, 280, 30, mid, keyHeight + 160, FLOOR + 15, lacquer);
  // A brass strip under the keys (the lock rail's trim).
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xb8903f, metalness: 0.9, roughness: 0.3 });
  box(wide - 120, 6, 6, mid, -18, -WHITE_DEPTH - 4, brass, false);

  // Floor.
  const tile = woodTile();
  const texture = new THREE.CanvasTexture(tile);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const floorWidth = right + 6000,
    floorDepth = 6000;
  texture.repeat.set(floorWidth / (tile.width * 2.2), floorDepth / (tile.height * 2.2));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorWidth, floorDepth), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 }));
  floor.position.set(mid, keyHeight + 900 - floorDepth / 2, FLOOR);
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

  // Walls: warm plaster above dark wainscoting; a window on the back wall.
  const plaster = new THREE.MeshStandardMaterial({ color: 0xd9cdb8, roughness: 0.95 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.6 });
  const backY = keyHeight + 420,
    wallW = right + 5000;
  box(wallW, 40, 3000, mid, backY, FLOOR + 1500, plaster, false);
  box(wallW, 30, 900, mid, backY - 30, FLOOR + 450, panel, false);
  box(wallW, 40, 30, mid, backY - 50, FLOOR + 910, walnut, false);
  for (const side of [-1, 1]) {
    const x = mid + side * (wallW / 2);
    box(40, 5000, 3000, x, backY - 2500, FLOOR + 1500, plaster, false);
    box(30, 5000, 900, x - side * 30, backY - 2500, FLOOR + 450, panel, false);
  }
  const glow = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
  const windowFrame = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 });
  for (const dx of [-1, 1]) {
    const wx = mid + dx * Math.max(900, right * 0.45);
    box(900, 20, 1300, wx, backY - 30, FLOOR + 1650, windowFrame, false);
    box(800, 22, 1200, wx, backY - 34, FLOOR + 1650, glow, false);
    box(800, 26, 24, wx, backY - 40, FLOOR + 1650, windowFrame, false);
    box(24, 26, 1200, wx, backY - 40, FLOOR + 1650, windowFrame, false);
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
