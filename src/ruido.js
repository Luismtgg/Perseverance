// Ruido de valor determinista (2D y 3D) y utilidades numéricas compartidas.

function hash2(ix, iz) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(ix, iy, iz) {
  return hash2(ix + Math.imul(iy, 0x9e3779b1), iz + Math.imul(iy, 0x7f4a7c15));
}

const quintica = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Ruido 2D en [-1, 1]
export function ruido2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = quintica(x - ix);
  const v = quintica(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

// Ruido 3D en [-1, 1]
export function ruido3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const u = quintica(x - ix);
  const v = quintica(y - iy);
  const w = quintica(z - iz);
  const mezcla = (a, b, t) => a + (b - a) * t;
  const abajo = mezcla(
    mezcla(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u),
    mezcla(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u),
    v
  );
  const arriba = mezcla(
    mezcla(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u),
    mezcla(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u),
    v
  );
  return mezcla(abajo, arriba, w) * 2 - 1;
}

// Suma de octavas, normalizada a [-1, 1]. Cada octava rota el dominio para
// que no se note la rejilla del ruido.
export function fbm2(x, z, octavas = 4) {
  let suma = 0;
  let amp = 0.5;
  let total = 0;
  for (let i = 0; i < octavas; i++) {
    suma += amp * ruido2(x, z);
    total += amp;
    amp *= 0.5;
    const nx = x * 1.6 - z * 1.2 + 19.7;
    z = x * 1.2 + z * 1.6 - 7.3;
    x = nx;
  }
  return suma / total;
}

export function fbm3(x, y, z, octavas = 4) {
  let suma = 0;
  let amp = 0.5;
  let total = 0;
  for (let i = 0; i < octavas; i++) {
    suma += amp * ruido3(x, y, z);
    total += amp;
    amp *= 0.5;
    x = x * 2.03 + 11.3;
    y = y * 2.03 - 5.7;
    z = z * 2.03 + 3.9;
  }
  return suma / total;
}

// smoothstep; admite a > b para invertir la rampa
export function suave(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Generador pseudoaleatorio con semilla (mulberry32): la escena sale igual en cada recarga
export function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
