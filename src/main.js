import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SOL, crearCielo, direccion } from './cielo.js';
import { altura, alturaMalla, crearTerreno } from './terreno.js';
import { crearRocas } from './rocas.js';
import { crearLunas } from './lunas.js';
import { crearPolvo } from './polvo.js';
import { crearRover } from './rover.js';
import { crearHuellas } from './huellas.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// --- Rover: sale mirando casi de frente al sol, que queda un poco a su izquierda ---
const ROVER_X = 0.6;
const ROVER_Z = 5.5;
const ROVER_AZIMUT = -4; // grados, con el mismo criterio que direccion() en cielo.js
const ROVER_RUMBO = Math.PI - THREE.MathUtils.degToRad(ROVER_AZIMUT);

// --- Cámara: baja y detrás del rover, mirando un poco hacia arriba para dejar sitio al cielo ---
const FOV = 55;
const ASPECTO_BASE = 16 / 9;
const MIRA_ALTO = 2.3; // la cámara orbita un punto por encima del mástil
const CAMARA_DISTANCIA = 8.5;
const CAMARA_BAJO_MIRA = 0.8;
const camera = new THREE.PerspectiveCamera(FOV, ASPECTO_BASE, 0.3, 3000);

// En ventanas más estrechas que 16:9 se abre el campo de visión para conservar
// el ancho del encuadre: el sol y las dos lunas siguen entrando en cuadro
function ajustarCamara() {
  camera.aspect = window.innerWidth / window.innerHeight;
  const tanMitad = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * Math.max(1, ASPECTO_BASE / camera.aspect);
  camera.fov = Math.min(85, THREE.MathUtils.radToDeg(2 * Math.atan(tanMitad)));
  camera.updateProjectionMatrix();
}
ajustarCamara();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(ROVER_X, alturaMalla(ROVER_X, ROVER_Z) + MIRA_ALTO, ROVER_Z);
camera.position
  .copy(controls.target)
  .addScaledVector(direccion(ROVER_AZIMUT, 0), -CAMARA_DISTANCIA)
  .add(new THREE.Vector3(0, -CAMARA_BAJO_MIRA, 0));
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = 60;
controls.minPolarAngle = THREE.MathUtils.degToRad(40);
controls.maxPolarAngle = THREE.MathUtils.degToRad(99);
controls.update();

// Vaivén lento mientras nadie toca nada: gira solo unos grados a cada lado del encuadre inicial
const VAIVEN = THREE.MathUtils.degToRad(7);
const azimutInicial = controls.getAzimuthalAngle();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.12;

// --- Escena ---
const cielo = crearCielo();
scene.add(cielo);
scene.add(crearTerreno());
// Sin rocas grandes entre la cámara y el rover
scene.add(crearRocas({ x: ROVER_X, z: (ROVER_Z + camera.position.z) / 2, radio: 7 }));
const lunas = crearLunas();
scene.add(lunas);
const polvo = crearPolvo();
scene.add(polvo.puntos);

// --- Luz: sol bajo y cálido, con el relleno anaranjado del cielo en las sombras ---
const SOMBRA_ANCHO = 180;
const SOMBRA_ALTO = 90;
const SOMBRA_MAPA = 4096;
const luzSol = new THREE.DirectionalLight(0xffc08a, 3.6);
luzSol.castShadow = true;
luzSol.shadow.mapSize.set(SOMBRA_MAPA, SOMBRA_MAPA);
luzSol.shadow.camera.left = -SOMBRA_ANCHO / 2;
luzSol.shadow.camera.right = SOMBRA_ANCHO / 2;
luzSol.shadow.camera.top = SOMBRA_ALTO / 2;
luzSol.shadow.camera.bottom = -SOMBRA_ALTO / 2;
luzSol.shadow.camera.near = 50;
luzSol.shadow.camera.far = 800;
luzSol.shadow.radius = 4;
luzSol.shadow.bias = -0.0004;
luzSol.shadow.normalBias = 0.05;
scene.add(luzSol, luzSol.target);
scene.add(new THREE.HemisphereLight(0xc98a55, 0x6a3a22, 1.4));

// La zona con sombras va con el rover. Se mueve a saltos de un texel del mapa
// de sombras (medidos en los ejes de la luz) para que los bordes no tiemblen.
const solX = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, SOL).normalize();
const solY = new THREE.Vector3().crossVectors(SOL, solX);
function centrarSombras(punto) {
  const texelX = SOMBRA_ANCHO / SOMBRA_MAPA;
  const texelY = SOMBRA_ALTO / SOMBRA_MAPA;
  luzSol.target.position
    .set(0, 0, 0)
    .addScaledVector(solX, Math.round(punto.dot(solX) / texelX) * texelX)
    .addScaledVector(solY, Math.round(punto.dot(solY) / texelY) * texelY)
    .addScaledVector(SOL, punto.dot(SOL));
  luzSol.position.copy(luzSol.target.position).addScaledVector(SOL, 400);
}
centrarSombras(controls.target);

// --- Rover y huellas (el modelo tarda un momento en llegar) ---
// Reflejos del cielo en el metal del rover
const pmrem = new THREE.PMREMGenerator(renderer);
const entorno = pmrem.fromScene(new THREE.Scene().add(crearCielo()), 0, 1, 2000).texture;
pmrem.dispose();

let rover = null;
let huellas = null;
let cargaTerminada = false;
crearRover({ x: ROVER_X, z: ROVER_Z, rumbo: ROVER_RUMBO, entorno })
  .then(async (r) => {
    // Los materiales del rover se compilan antes de enseñarlo, sin congelar la imagen
    await renderer.compileAsync(r.objeto, camera, scene);
    rover = r;
    huellas = crearHuellas(rover.ruedas);
    scene.add(rover.objeto, huellas.objeto);
  })
  .catch((error) => console.error(`No se pudo cargar el rover: ${error.message}`))
  .finally(() => (cargaTerminada = true));

// --- Teclado: W/S avanzan y retroceden, A/D giran ---
const TECLAS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const pulsadas = new Set();
window.addEventListener('keydown', (e) => {
  if (!TECLAS.includes(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
  pulsadas.add(e.code);
  controls.autoRotate = false;
});
window.addEventListener('keyup', (e) => pulsadas.delete(e.code));
window.addEventListener('blur', () => pulsadas.clear());
const eje = (mas, menos) => (pulsadas.has(mas) ? 1 : 0) - (pulsadas.has(menos) ? 1 : 0);

// Si alguien mueve la cámara a mano se respeta: se acaba el vaivén y la cámara
// tarda unos segundos en volver sola a colocarse detrás del rover
const ESPERA_TRAS_ARRASTRE = 3;
let arrastrando = false;
let finArrastre = -Infinity;
controls.addEventListener('start', () => {
  arrastrando = true;
  controls.autoRotate = false;
});
controls.addEventListener('end', () => {
  arrastrando = false;
  finArrastre = reloj.getElapsed();
});

window.addEventListener('resize', () => {
  ajustarCamara();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const mira = new THREE.Vector3();
const brazo = new THREE.Vector3();

// La cámara acompaña al rover sin perder el ángulo desde el que se le mira
function seguirRover(dt) {
  mira.copy(rover.objeto.position);
  mira.y += MIRA_ALTO;
  camera.position.add(brazo.subVectors(mira, controls.target));
  controls.target.copy(mira);

  // Mientras avanza, la cámara se va colocando detrás
  const libre = !arrastrando && reloj.getElapsed() - finArrastre > ESPERA_TRAS_ARRASTRE;
  if (rover.velocidad > 0.3 && libre) {
    brazo.subVectors(camera.position, mira);
    const actual = Math.atan2(brazo.x, brazo.z);
    const detras = rover.rumbo + Math.PI;
    const falta = Math.atan2(Math.sin(detras - actual), Math.cos(detras - actual));
    brazo.applyAxisAngle(THREE.Object3D.DEFAULT_UP, falta * (1 - Math.exp(-dt * 0.9)));
    camera.position.copy(mira).add(brazo);
  }
}

const reloj = new THREE.Timer();
reloj.connect(document);
renderer.setAnimationLoop((ahora) => {
  reloj.update(ahora);
  const dt = reloj.getDelta();

  if (rover) {
    rover.actualizar(dt, eje('KeyW', 'KeyS'), eje('KeyA', 'KeyD'));
    huellas.actualizar(rover.objeto);
    seguirRover(dt);
    centrarSombras(rover.objeto.position);
  }

  // OrbitControls gira a la izquierda con velocidad positiva (azimut decreciente)
  const desvio = controls.getAzimuthalAngle() - azimutInicial;
  if (desvio > VAIVEN) controls.autoRotateSpeed = Math.abs(controls.autoRotateSpeed);
  else if (desvio < -VAIVEN) controls.autoRotateSpeed = -Math.abs(controls.autoRotateSpeed);
  // Con el delta, el vaivén va igual de lento a 60 Hz que a 144 Hz
  controls.update(dt);

  // Nunca por debajo de la arena
  const suelo = altura(camera.position.x, camera.position.z) + 1.0;
  if (camera.position.y < suelo) camera.position.y = suelo;

  // El cielo y las lunas están "en el infinito": siguen a la cámara
  cielo.position.copy(camera.position);
  lunas.position.copy(camera.position);
  polvo.actualizar(reloj.getElapsed(), camera, renderer.domElement.height);
  renderer.render(scene, camera);
  window.__ready = cargaTerminada;
});
