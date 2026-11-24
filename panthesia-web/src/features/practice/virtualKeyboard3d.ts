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
  // The piano around the keys: the key bed's front rail, the fallboard behind, a wooden floor.
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x0f0e10, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(right + 400, 50, 46), lacquer);
  back.position.set(right / 2, keyHeight + 25, 1);
  back.receiveShadow = true;
  group.add(back);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(right + 400, 14, 50), lacquer);
  rail.position.set(right / 2, -7, -WHITE_DEPTH - 20);
  group.add(rail);
  const tile = woodTile();
  const texture = new THREE.CanvasTexture(tile);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const floorWidth = right + 3000,
    floorDepth = 2400;
  texture.repeat.set(floorWidth / (tile.width * 1.4), floorDepth / (tile.height * 1.4));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorWidth, floorDepth), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 }));
  floor.position.set(right / 2, -floorDepth / 2 + keyHeight, -WHITE_DEPTH - 60);
  floor.receiveShadow = true;
  group.add(floor);
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
