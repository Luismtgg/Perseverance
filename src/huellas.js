import * as THREE from 'three';
import { altura, alturaMalla, colorTerreno, muestra } from './terreno.js';
import { conAtmosfera } from './cielo.js';

const PASO = 0.07; // metros entre puntos de una cinta
const CAPACIDAD = 4000; // puntos por rueda (~280 m de huella); al llenarse se borra lo más viejo
const DESCARTE = 1000;
const SOBRE_SUELO = 0.012;
const PATRON = 0.14; // metros de huella que cubre una repetición de la textura (4 garras)

// Marca de la banda de rodadura: las garras de la rueda dejan surcos algo ondulados.
// Multiplica el color de la arena: 1 en los bordes (sin efecto) y más oscuro dentro.
function crearTexturaHuella() {
  const ANCHO = 64;
  const ALTO = 128;
  const datos = new Uint8Array(ANCHO * ALTO * 4);
  for (let j = 0; j < ALTO; j++) {
    for (let i = 0; i < ANCHO; i++) {
      const u = (i + 0.5) / ANCHO;
      const v = (j + 0.5) / ALTO;
      const fase = v * 4 + 0.14 * Math.sin(u * Math.PI * 2);
      const surco = 1 - THREE.MathUtils.smoothstep(Math.abs(fase - Math.floor(fase) - 0.5), 0.14, 0.34);
      const dentro = THREE.MathUtils.smoothstep(u, 0, 0.16) * THREE.MathUtils.smoothstep(1 - u, 0, 0.16);
      const valor = THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(0.74, 0.5, surco), dentro);
      const k = (j * ANCHO + i) * 4;
      datos[k] = datos[k + 1] = datos[k + 2] = valor * 255;
      datos[k + 3] = 255;
    }
  }
  const textura = new THREE.DataTexture(datos, ANCHO, ALTO, THREE.RGBAFormat);
  textura.wrapT = THREE.RepeatWrapping;
  textura.magFilter = THREE.LinearFilter;
  textura.minFilter = THREE.LinearMipmapLinearFilter;
  textura.generateMipmaps = true;
  textura.anisotropy = 8;
  textura.needsUpdate = true;
  return textura;
}

// Cinta que va creciendo detrás de una rueda, pegada a la malla del terreno
function crearCinta(ancho, material) {
  const posiciones = new THREE.BufferAttribute(new Float32Array(CAPACIDAD * 6), 3);
  const normales = new THREE.BufferAttribute(new Float32Array(CAPACIDAD * 6), 3);
  const colores = new THREE.BufferAttribute(new Float32Array(CAPACIDAD * 6), 3);
  const uvs = new THREE.BufferAttribute(new Float32Array(CAPACIDAD * 4), 2);
  const atributos = [posiciones, normales, colores, uvs];
  for (const a of atributos) a.setUsage(THREE.DynamicDrawUsage);

  // Dos vértices por punto (izquierda y derecha del sentido de marcha) y un
  // rectángulo entre cada punto y el siguiente, con la cara hacia arriba
  const indices = new Uint32Array((CAPACIDAD - 1) * 6);
  for (let k = 0; k < CAPACIDAD - 1; k++) {
    const a = k * 2;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k * 6);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', posiciones);
  geo.setAttribute('normal', normales);
  geo.setAttribute('color', colores);
  geo.setAttribute('uv', uvs);
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.setDrawRange(0, 0);

  const malla = new THREE.Mesh(geo, material);
  malla.frustumCulled = false; // la geometría cambia a cada paso
  malla.receiveShadow = true;
  malla.renderOrder = -0.5; // antes que el polvo en suspensión

  let cuenta = 0;
  let recorrido = 0;
  const ultimo = new THREE.Vector2(); // último punto puesto (x, z)
  const sentido = new THREE.Vector2(); // dirección del último tramo
  let empezada = false;
  const color = new THREE.Color();

  let subirTodo = false;

  function punto(x, z, dx, dz) {
    if (cuenta === CAPACIDAD) {
      for (const a of atributos) {
        a.array.copyWithin(0, DESCARTE * 2 * a.itemSize);
        a.clearUpdateRanges();
      }
      cuenta -= DESCARTE;
      subirTodo = true;
    }

    // Normal del terreno, suave como la de la malla (sin las ondas del mapa de normales)
    const D = 0.5;
    const nx = altura(x - D, z) - altura(x + D, z);
    const nz = altura(x, z - D) - altura(x, z + D);
    const inv = 1 / Math.hypot(nx, 2 * D, nz);
    colorTerreno(x, z, muestra(x, z).duna, color);

    // Izquierda del sentido de marcha: arriba × sentido
    const lx = dz * (ancho / 2);
    const lz = -dx * (ancho / 2);
    for (let lado = 0; lado < 2; lado++) {
      const i = cuenta * 2 + lado;
      const s = lado === 0 ? 1 : -1;
      const px = x + lx * s;
      const pz = z + lz * s;
      posiciones.setXYZ(i, px, alturaMalla(px, pz) + SOBRE_SUELO, pz);
      normales.setXYZ(i, nx * inv, 2 * D * inv, nz * inv);
      colores.setXYZ(i, color.r, color.g, color.b);
      uvs.setXY(i, lado, recorrido / PATRON);
    }
    for (const a of atributos) {
      // Sin rangos, three sube el atributo entero (hace falta tras descartar lo viejo)
      if (!subirTodo) a.addUpdateRange(cuenta * 2 * a.itemSize, 2 * a.itemSize);
      a.needsUpdate = true;
    }
    cuenta++;
    geo.setDrawRange(0, Math.max(0, cuenta - 1) * 6);
  }

  return {
    malla,
    // Llamar con la posición actual del apoyo de la rueda
    avanzar(x, z) {
      if (!empezada) {
        ultimo.set(x, z);
        empezada = true;
        return;
      }
      const dx = x - ultimo.x;
      const dz = z - ultimo.y;
      const tramo = Math.hypot(dx, dz);
      if (tramo < PASO) return;
      const ux = dx / tramo;
      const uz = dz / tramo;

      // Al empezar, o si la rueda cambia de sentido de golpe (marcha atrás, giro sobre
      // sí mismo), se repite el último punto con la orientación nueva: así el tramo
      // anterior se cierra limpio en vez de retorcerse
      subirTodo = false;
      if (cuenta === 0 || ux * sentido.x + uz * sentido.y < 0.5) punto(ultimo.x, ultimo.y, ux, uz);
      recorrido += tramo;
      punto(x, z, ux, uz);
      ultimo.set(x, z);
      sentido.set(ux, uz);
    },
  };
}

// Huellas de las ruedas: una cinta por rueda. `ruedas` son los apoyos { x, z, ancho }
// en el espacio del rover. Devuelve { objeto, actualizar(rover) }.
export function crearHuellas(ruedas) {
  // Se mezcla quedándose con el más oscuro entre la huella y lo que ya hay dibujado:
  // donde varias ruedas pisan el mismo sitio la marca no se oscurece dos veces,
  // y los bordes (que valen lo mismo que la arena) se funden sin costura.
  const material = conAtmosfera(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(1.12, 1.12, 1.12),
      vertexColors: true,
      map: crearTexturaHuella(),
      roughness: 1,
      metalness: 0,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MinEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    })
  );

  const objeto = new THREE.Group();
  const cintas = ruedas.map((rueda) => crearCinta(rueda.ancho, material));
  for (const cinta of cintas) objeto.add(cinta.malla);

  const apoyo = new THREE.Vector3();
  return {
    objeto,
    actualizar(rover) {
      rover.updateMatrixWorld();
      ruedas.forEach((rueda, i) => {
        apoyo.set(rueda.x, 0, rueda.z).applyMatrix4(rover.matrixWorld);
        cintas[i].avanzar(apoyo.x, apoyo.z);
      });
    },
  };
}
