import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { alturaMalla } from './terreno.js';

// Modelo oficial de la NASA (NASA-3D-Resources). Viene comprimido con Draco;
// DRACOLoader trae su propio decodificador.
const URL_MODELO = `${import.meta.env.BASE_URL}models/perseverance.glb`;

// Medida real con la que se fija la escala: las ruedas de Perseverance miden 52,5 cm
const DIAMETRO_RUEDA = 0.525;

// El rover real avanza a 4,2 cm/s como mucho; aquí va unas 40 veces más rápido
const VELOCIDAD = 1.8; // m/s
const ACELERACION = 2.5; // m/s²
const GIRO = THREE.MathUtils.degToRad(38); // rad/s; como el real, puede girar sobre sí mismo
const ACELERACION_GIRO = THREE.MathUtils.degToRad(140);
const LIMITE = 380; // radio en metros: antes del borde del cráter
const HUNDIMIENTO = 0.015; // las ruedas se clavan un poco en la arena

// El modelo viene con el mástil plegado sobre la cubierta, como durante el viaje. Sus
// animaciones lo levantan y lo vuelven a plegar; se congelan en un instante en el que
// mástil, cabeza, cableado y sensores de viento ya están desplegados y el brazo sigue recogido.
const ANIMACIONES_MASTIL = ['CylinderAction', 'topAction', 'ArmatureAction', 'Action'];
const INSTANTE_DESPLEGADO = 5; // segundos

// Piezas del modelo que son cámaras (por nombre), sin sus tapas ni su cableado
const ES_CAMARA = /cam|watson|lens/i;
const NO_ES_CAMARA = /cover|wiring/i;

function cargarModelo() {
  const draco = new DRACOLoader();
  return new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync(URL_MODELO)
    .finally(() => draco.dispose());
}

function desplegarMastil(gltf) {
  const mezclador = new THREE.AnimationMixer(gltf.scene);
  for (const clip of gltf.animations) {
    if (!ANIMACIONES_MASTIL.includes(clip.name)) continue;
    const accion = mezclador.clipAction(clip).play();
    accion.time = INSTANTE_DESPLEGADO;
  }
  mezclador.update(0);
}

// Las seis ruedas son una sola pieza: se separan repartiendo sus triángulos por lado y por
// tercio a lo largo, y cada rueda se cuelga de un pivote en su eje para poder hacerla rodar.
// Devuelve, en el espacio del modelo, el apoyo en el suelo de cada una y su pivote.
function separarRuedas(modelo) {
  const pieza = modelo.getObjectByName('Wheels_objs');
  if (!pieza) throw new Error('el modelo no tiene la pieza "Wheels_objs"');
  const mallas = [];
  pieza.traverse((o) => o.isMesh && mallas.push(o));

  // Vértices de cada malla en el espacio del modelo
  const v = new THREE.Vector3();
  const vertices = mallas.map((malla) => {
    const pos = malla.geometry.attributes.position;
    const xyz = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(malla.matrixWorld).toArray(xyz, i * 3);
    return xyz;
  });

  let zMin = Infinity;
  let zMax = -Infinity;
  for (const xyz of vertices) {
    for (let i = 2; i < xyz.length; i += 3) {
      zMin = Math.min(zMin, xyz[i]);
      zMax = Math.max(zMax, xyz[i]);
    }
  }
  const ruedaDe = (x, z) => (x > 0 ? 0 : 3) + Math.min(2, Math.floor(((z - zMin) / (zMax - zMin)) * 3));

  // Triángulos de cada malla repartidos entre las seis ruedas, según su centro
  const cajas = Array.from({ length: 6 }, () => new THREE.Box3());
  const reparto = mallas.map((malla, m) => {
    const xyz = vertices[m];
    const indice = malla.geometry.index;
    const total = indice ? indice.count : xyz.length / 3;
    const vertice = (k) => (indice ? indice.getX(k) : k);
    const porRueda = Array.from({ length: 6 }, () => []);
    for (let k = 0; k < total; k += 3) {
      const a = vertice(k);
      const b = vertice(k + 1);
      const c = vertice(k + 2);
      const r = ruedaDe(
        (xyz[a * 3] + xyz[b * 3] + xyz[c * 3]) / 3,
        (xyz[a * 3 + 2] + xyz[b * 3 + 2] + xyz[c * 3 + 2]) / 3
      );
      porRueda[r].push(a, b, c);
      for (const i of [a, b, c]) cajas[r].expandByPoint(v.fromArray(xyz, i * 3));
    }
    return porRueda;
  });

  // El ancho de la banda de rodadura se mide solo en la franja que toca el suelo,
  // para no contar el cubo ni los radios
  const bandas = cajas.map(() => [Infinity, -Infinity]);
  reparto.forEach((porRueda, m) => {
    porRueda.forEach((indices, r) => {
      for (const i of indices) {
        if (vertices[m][i * 3 + 1] > cajas[r].min.y + 0.03) continue;
        bandas[r][0] = Math.min(bandas[r][0], vertices[m][i * 3]);
        bandas[r][1] = Math.max(bandas[r][1], vertices[m][i * 3]);
      }
    });
  });

  const ruedas = cajas.map((caja, r) => {
    const pivote = new THREE.Group();
    pivote.name = `Rueda_${r + 1}`;
    caja.getCenter(pivote.position);
    mallas.forEach((malla, m) => {
      if (reparto[m][r].length === 0) return;
      // Misma geometría (los vértices se comparten), solo con los triángulos de esta rueda
      const geo = new THREE.BufferGeometry();
      for (const [nombre, atributo] of Object.entries(malla.geometry.attributes)) geo.setAttribute(nombre, atributo);
      geo.setIndex(reparto[m][r]);
      const parte = new THREE.Mesh(geo, malla.material);
      parte.applyMatrix4(malla.matrixWorld);
      parte.position.sub(pivote.position);
      pivote.add(parte);
    });
    modelo.add(pivote);
    return {
      pivote,
      x: (bandas[r][0] + bandas[r][1]) / 2,
      y: caja.min.y,
      z: pivote.position.z,
      ancho: bandas[r][1] - bandas[r][0],
      diametro: caja.max.y - caja.min.y,
    };
  });
  pieza.removeFromParent();
  return ruedas;
}

// Devuelve { objeto, ruedas, camaras, rumbo, velocidad, actualizar(dt, avance, giro) }.
// ruedas: apoyos { x, z, ancho, radio } en el espacio del rover.
// rumbo en radianes: 0 mira hacia +Z y crece al girar a la izquierda.
export async function crearRover({ x, z, rumbo, entorno }) {
  const gltf = await cargarModelo();
  const modelo = gltf.scene;
  desplegarMastil(gltf);
  modelo.updateMatrixWorld(true);

  // --- Tamaño real ---
  let ruedas = separarRuedas(modelo);
  const diametroModelo = ruedas.reduce((suma, r) => suma + r.diametro, 0) / ruedas.length;
  const escala = DIAMETRO_RUEDA / diametroModelo;
  modelo.scale.setScalar(escala);
  // El origen queda en el suelo, bajo las ruedas
  modelo.position.y = -Math.min(...ruedas.map((r) => r.y)) * escala;
  ruedas = ruedas.map((r) => ({
    pivote: r.pivote,
    x: r.x * escala,
    z: r.z * escala,
    ancho: r.ancho * escala,
    radio: (r.diametro * escala) / 2,
  }));

  const camaras = [];
  modelo.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // Las piezas con huesos (cables) se deforman fuera de su caja original
      if (o.isSkinnedMesh) o.frustumCulled = false;
      for (const material of [].concat(o.material)) {
        material.envMap = entorno;
        material.envMapIntensity = 0.6;
        // El vidrio con transmisión obliga a dibujar la escena dos veces; para unas
        // lentes tan pequeñas basta con un cristal translúcido que refleje el cielo
        if (material.transmission > 0) {
          material.transmission = 0;
          material.transparent = true;
          material.opacity = 0.35;
          material.depthWrite = false;
        }
      }
    }
    const esCamara = (obj) => ES_CAMARA.test(obj.name) && !NO_ES_CAMARA.test(obj.name);
    // Una pieza con varios materiales llega como grupo con hijos del mismo nombre: cuenta el grupo
    if (esCamara(o) && !(o.parent && esCamara(o.parent))) camaras.push(o);
  });

  const objeto = new THREE.Group();
  objeto.name = 'Perseverance';
  objeto.add(modelo);

  const caja = new THREE.Box3().setFromObject(modelo);
  const medida = caja.getSize(new THREE.Vector3());
  console.log(
    `[rover] Perseverance a tamaño real (escala ${escala.toFixed(3)}): ` +
      `${medida.z.toFixed(2)} m de largo, ${medida.x.toFixed(2)} m de ancho, ${medida.y.toFixed(2)} m de alto`
  );
  console.log(`[rover] Piezas que son cámaras:\n${camaras.map((c) => `  - ${c.name}`).join('\n')}`);

  // --- Conducción ---
  const estado = { x, z, rumbo, velocidad: 0, velocidadGiro: 0 };
  const acercar = (valor, meta, paso) => valor + THREE.MathUtils.clamp(meta - valor, -paso, paso);

  // Distancias entre apoyos, para sacar la inclinación del terreno bajo el rover
  const delanteras = ruedas.filter((r) => r.z > 0.5);
  const traseras = ruedas.filter((r) => r.z < -0.5);
  const izquierdas = ruedas.filter((r) => r.x > 0);
  const derechas = ruedas.filter((r) => r.x < 0);
  const media = (lista, eje) => lista.reduce((suma, r) => suma + r[eje], 0) / lista.length;
  const batalla = media(delanteras, 'z') - media(traseras, 'z');
  const via = media(izquierdas, 'x') - media(derechas, 'x');

  const adelante = new THREE.Vector3();
  const izquierda = new THREE.Vector3();
  const arriba = new THREE.Vector3();
  const base = new THREE.Matrix4();
  const giroMeta = new THREE.Quaternion();

  // Apoya el rover sobre la malla: altura media de las seis ruedas e inclinación
  // según la diferencia entre ejes (cabeceo) y entre lados (balanceo)
  function asentar(dt) {
    const sen = Math.sin(estado.rumbo);
    const cos = Math.cos(estado.rumbo);
    const suelo = (r) => alturaMalla(estado.x + r.x * cos + r.z * sen, estado.z - r.x * sen + r.z * cos);
    const alturaDe = (lista) => lista.reduce((suma, r) => suma + suelo(r), 0) / lista.length;

    adelante.set(sen * batalla, alturaDe(delanteras) - alturaDe(traseras), cos * batalla).normalize();
    izquierda.set(cos * via, alturaDe(izquierdas) - alturaDe(derechas), -sen * via).normalize();
    arriba.crossVectors(adelante, izquierda).normalize();
    izquierda.crossVectors(arriba, adelante);
    giroMeta.setFromRotationMatrix(base.makeBasis(izquierda, arriba, adelante));

    const y = alturaDe(ruedas) - HUNDIMIENTO;
    if (dt === null) {
      objeto.quaternion.copy(giroMeta);
      objeto.position.set(estado.x, y, estado.z);
    } else {
      // Suavizado: el chasis no copia cada arista de la malla
      const k = 1 - Math.exp(-dt * 10);
      objeto.quaternion.slerp(giroMeta, k);
      objeto.position.set(estado.x, THREE.MathUtils.lerp(objeto.position.y, y, k), estado.z);
    }
  }
  asentar(null);

  return {
    objeto,
    ruedas,
    camaras,
    get rumbo() {
      return estado.rumbo;
    },
    get velocidad() {
      return estado.velocidad;
    },
    // avance: +1 adelante, -1 atrás. giro: +1 izquierda, -1 derecha.
    actualizar(dt, avance, giro) {
      dt = Math.min(dt, 0.1);
      estado.velocidad = acercar(estado.velocidad, avance * VELOCIDAD, ACELERACION * dt);
      estado.velocidadGiro = acercar(estado.velocidadGiro, giro * GIRO, ACELERACION_GIRO * dt);
      estado.rumbo += estado.velocidadGiro * dt;

      // Cada rueda rueda lo que avanza su apoyo: al girar, las de un lado van hacia atrás
      for (const rueda of ruedas) {
        rueda.pivote.rotation.x += ((estado.velocidad - estado.velocidadGiro * rueda.x) * dt) / rueda.radio;
      }

      const nx = estado.x + Math.sin(estado.rumbo) * estado.velocidad * dt;
      const nz = estado.z + Math.cos(estado.rumbo) * estado.velocidad * dt;
      if (Math.hypot(nx, nz) < LIMITE) {
        estado.x = nx;
        estado.z = nz;
      } else {
        estado.velocidad = 0;
      }
      asentar(dt);
    },
  };
}
