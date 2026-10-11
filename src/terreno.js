import * as THREE from 'three';
import { fbm2, suave } from './ruido.js';
import { conAtmosfera } from './cielo.js';

const RADIO = 900;
const SEGMENTOS = 512;
const BALDOSA = 10; // metros que cubre una repetición del mapa de ondas

// Dirección del viento (unitaria, en XZ). Las crestas quedan perpendiculares a él
// y casi de frente al sol, que las ilumina a contraluz.
const VIENTO_X = 0.78;
const VIENTO_Z = 0.626;

// Perfil asimétrico de duna: subida larga a barlovento, cara de avalancha corta y cresta viva
function perfil(t, quiebre) {
  const s = t < quiebre ? t / quiebre : (1 - t) / (1 - quiebre);
  return s * s * (2 - s);
}

const _muestra = { y: 0, duna: 0 };

// Altura del terreno y altura local de duna en (x, z). Devuelve un objeto reutilizado.
export function muestra(x, z) {
  const r = Math.hypot(x, z);

  // Relieve amplio
  let y = fbm2(x * 0.004 + 3.1, z * 0.004 - 8.2, 3) * 7;

  // Campo de dunas grandes, despejado alrededor de la cámara
  const claro = suave(8, 34, Math.hypot(x, z - 6));
  const lejos = suave(700, 350, r);
  const mascara =
    suave(-0.5, 0.1, fbm2(x * 0.005 + 40, z * 0.005 - 13, 2)) * (0.12 + 0.88 * claro) * lejos;
  const fase = (x * VIENTO_X + z * VIENTO_Z) / 58 + fbm2(x * 0.011, z * 0.011, 2) * 1.1;
  const amp = mascara * (0.65 + 0.35 * fbm2(x * 0.02 + 7, z * 0.02 + 1, 2));
  const duna = perfil(fase - Math.floor(fase), 0.7) * amp * 9;
  y += duna;

  // Dunas menores, solo cerca (lejos la malla no tiene resolución para ellas)
  const cerca = suave(260, 90, r);
  const fase2 = (x * 0.62 + z * 0.785) / 15 + fbm2(x * 0.03 - 5, z * 0.03 + 9, 2) * 0.9;
  const mascara2 = suave(0.0, 0.5, fbm2(x * 0.012 - 20, z * 0.012 + 31, 2)) * cerca;
  y += perfil(fase2 - Math.floor(fase2), 0.7) * mascara2 * 0.7;

  // Detalle fino
  y += fbm2(x * 0.35, z * 0.35, 2) * 0.06;

  // Borde del cráter en el horizonte
  y += suave(420, 820, r) * (30 + 60 * (1 - Math.abs(fbm2(x * 0.0035 + 90, z * 0.0035 - 40, 4))));

  _muestra.y = y;
  _muestra.duna = duna;
  return _muestra;
}

export const altura = (x, z) => muestra(x, z).y;

// Mapa de normales repetible con ondas de arena (megaondas de ~1.3 m) y grano fino
function crearMapaOndas() {
  const N = 512;
  const TAU = Math.PI * 2;
  const alturas = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const v = j / N;
      // Frecuencias enteras: todo es periódico y la baldosa no deja costura
      const fase =
        6 * u + 5 * v +
        0.18 * Math.sin(TAU * (2 * v - u)) +
        0.12 * Math.sin(TAU * (3 * u + v) + 1.3) +
        0.06 * Math.sin(TAU * (5 * v - 2 * u) + 0.7);
      let h = perfil(fase - Math.floor(fase), 0.65);
      h *= 0.7 + 0.3 * Math.sin(TAU * (u + 2 * v) + 2.0);
      h += (Math.random() - 0.5) * 0.06;
      alturas[j * N + i] = h;
    }
  }

  const FUERZA = 2.0;
  const datos = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const izq = alturas[j * N + ((i + N - 1) % N)];
      const der = alturas[j * N + ((i + 1) % N)];
      const aba = alturas[((j + N - 1) % N) * N + i];
      const arr = alturas[((j + 1) % N) * N + i];
      const nx = (izq - der) * FUERZA;
      const ny = (aba - arr) * FUERZA;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const k = (j * N + i) * 4;
      datos[k] = (nx * inv * 0.5 + 0.5) * 255;
      datos[k + 1] = (ny * inv * 0.5 + 0.5) * 255;
      datos[k + 2] = (inv * 0.5 + 0.5) * 255;
      datos[k + 3] = 255;
    }
  }

  const textura = new THREE.DataTexture(datos, N, N, THREE.RGBAFormat);
  textura.wrapS = textura.wrapT = THREE.RepeatWrapping;
  textura.magFilter = THREE.LinearFilter;
  textura.minFilter = THREE.LinearMipmapLinearFilter;
  textura.generateMipmaps = true;
  textura.anisotropy = 8;
  textura.needsUpdate = true;
  return textura;
}

export function crearTerreno() {
  const n = SEGMENTOS + 1;
  const posiciones = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const dunas = new Float32Array(n * n);

  // Rejilla más densa en el centro, donde está la cámara
  const coordenada = (i) => {
    const u = (i / SEGMENTOS) * 2 - 1;
    return RADIO * u * (0.12 + 0.88 * Math.abs(u));
  };

  for (let j = 0; j < n; j++) {
    const z = coordenada(j);
    for (let i = 0; i < n; i++) {
      const x = coordenada(i);
      const k = j * n + i;
      const m = muestra(x, z);
      posiciones[k * 3] = x;
      posiciones[k * 3 + 1] = m.y;
      posiciones[k * 3 + 2] = z;
      uvs[k * 2] = x / BALDOSA;
      uvs[k * 2 + 1] = z / BALDOSA;
      dunas[k] = m.duna;
    }
  }

  const indices = new Uint32Array(SEGMENTOS * SEGMENTOS * 6);
  let q = 0;
  for (let j = 0; j < SEGMENTOS; j++) {
    for (let i = 0; i < SEGMENTOS; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  // Color por vértice: óxido y ocre en manchas, arena clara en las dunas,
  // suelo más oscuro y pedregoso entre ellas
  const oxido = new THREE.Color(0x9a6444);
  const ocre = new THREE.Color(0xb5895a);
  const arena = new THREE.Color(0xcfa274);
  const oscuro = new THREE.Color(0x6b4a3a);
  const c = new THREE.Color();
  const colores = new Float32Array(n * n * 3);
  for (let k = 0; k < n * n; k++) {
    const x = posiciones[k * 3];
    const z = posiciones[k * 3 + 2];
    const enDuna = suave(0.15, 2.5, dunas[k]);
    c.copy(oxido).lerp(ocre, suave(-0.35, 0.4, fbm2(x * 0.013 + 5, z * 0.013 - 2, 3)));
    c.lerp(oscuro, (1 - enDuna) * suave(0.0, 0.5, fbm2(x * 0.07 - 11, z * 0.07 + 4, 3)) * 0.6);
    c.lerp(arena, enDuna * 0.75);
    colores[k * 3] = c.r;
    colores[k * 3 + 1] = c.g;
    colores[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colores, 3));

  const material = conAtmosfera(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      normalMap: crearMapaOndas(),
      normalScale: new THREE.Vector2(1, 1),
    })
  );

  const terreno = new THREE.Mesh(geo, material);
  terreno.castShadow = true;
  terreno.receiveShadow = true;
  return terreno;
}
