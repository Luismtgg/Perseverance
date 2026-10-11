import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm3, azar } from './ruido.js';
import { muestra } from './terreno.js';
import { conAtmosfera } from './cielo.js';

const TAU = Math.PI * 2;

// Roca: esfera deformada con ruido y "tallada" con planos al azar, que le dan
// caras planas y aristas como las de una piedra fracturada.
function formaRoca(semilla, detalle) {
  const rnd = azar(semilla);
  let geo = new THREE.IcosahedronGeometry(1, detalle);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);

  const cortes = [];
  for (let i = 0; i < 11; i++) {
    cortes.push({
      n: new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(),
      d: 0.45 + rnd() * 0.4,
    });
  }

  const p = new THREE.Vector3();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    p.multiplyScalar(1 + 0.3 * fbm3(p.x * 1.3 + semilla, p.y * 1.3, p.z * 1.3, 3));
    for (const corte of cortes) {
      const exceso = p.dot(corte.n) - corte.d;
      if (exceso > 0) p.addScaledVector(corte.n, -exceso);
    }
    p.multiplyScalar(1 + 0.04 * fbm3(p.x * 6, p.y * 6 + semilla, p.z * 6, 2));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  // Normales suaves en las caras y arista viva donde el ángulo es grande
  return toCreasedNormals(geo, 0.5);
}

// Reparte una lista de rocas {x, z, s} entre varias formas, una InstancedMesh por forma
function instanciar(grupo, rocas, formas, material, rnd) {
  const porForma = formas.map(() => []);
  rocas.forEach((roca, i) => porForma[i % formas.length].push(roca));

  const basalto = new THREE.Color(0x6a5850);
  const rojiza = new THREE.Color(0x8a5c42);
  const color = new THREE.Color();
  const matriz = new THREE.Matrix4();
  const posicion = new THREE.Vector3();
  const giro = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const escala = new THREE.Vector3();

  formas.forEach((geo, f) => {
    const lista = porForma[f];
    if (lista.length === 0) return;
    const malla = new THREE.InstancedMesh(geo, material, lista.length);
    lista.forEach(({ x, z, s }, i) => {
      // Un poco hundidas en la arena
      posicion.set(x, muestra(x, z).y + s * 0.05, z);
      euler.set((rnd() - 0.5) * 0.7, rnd() * TAU, (rnd() - 0.5) * 0.7);
      giro.setFromEuler(euler);
      escala.set(s * (0.8 + rnd() * 0.5), s * (0.6 + rnd() * 0.5), s * (0.8 + rnd() * 0.5));
      malla.setMatrixAt(i, matriz.compose(posicion, giro, escala));
      color.copy(basalto).lerp(rojiza, rnd()).multiplyScalar(0.75 + rnd() * 0.5);
      malla.setColorAt(i, color);
    });
    malla.instanceMatrix.needsUpdate = true;
    malla.instanceColor.needsUpdate = true;
    malla.castShadow = true;
    malla.receiveShadow = true;
    grupo.add(malla);
  });
}

// zonaLibre: {x, z, radio} donde no se ponen rocas grandes (la cámara)
export function crearRocas(zonaLibre) {
  const rnd = azar(1976);
  const grupo = new THREE.Group();
  const material = conAtmosfera(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }),
    { polvoEncima: true }
  );

  // Cuanto más grande la roca, más lejos de la cámara: que no tape el paisaje
  const libre = (x, z, s) =>
    s < 0.3 || Math.hypot(x - zonaLibre.x, z - zonaLibre.z) > zonaLibre.radio + s * 9;

  // Rocas grandes: pocas, con piedras menores alrededor, y fuera de las dunas
  const grandes = [];
  for (let intento = 0; grandes.length < 340 && intento < 6000; intento++) {
    const r = 5 + 170 * rnd() ** 1.7;
    const a = rnd() * TAU;
    const x = Math.sin(a) * r;
    const z = -6 + Math.cos(a) * r;
    if (muestra(x, z).duna > 0.8 + rnd() * 1.5) continue;
    const s = 0.3 + 1.5 * rnd() ** 4;
    if (!libre(x, z, s)) continue;
    grandes.push({ x, z, s });
    const satelites = Math.floor(rnd() * 4);
    for (let k = 0; k < satelites; k++) {
      const sx = x + (rnd() - 0.5) * s * 7;
      const sz = z + (rnd() - 0.5) * s * 7;
      const ss = s * (0.15 + rnd() * 0.35);
      if (libre(sx, sz, ss)) grandes.push({ x: sx, z: sz, s: ss });
    }
  }

  // Guijarros: muchos y pequeños, más densos cerca de la cámara
  const guijarros = [];
  for (let i = 0; i < 900; i++) {
    const r = 2 + 55 * rnd() ** 1.4;
    const a = rnd() * TAU;
    guijarros.push({
      x: zonaLibre.x + Math.sin(a) * r,
      z: zonaLibre.z - 8 + Math.cos(a) * r,
      s: 0.05 + 0.2 * rnd() ** 2,
    });
  }

  instanciar(grupo, grandes, [11, 23, 37, 58].map((s) => formaRoca(s, 3)), material, rnd);
  instanciar(grupo, guijarros, [5, 17, 29].map((s) => formaRoca(s, 1)), material, rnd);
  return grupo;
}
