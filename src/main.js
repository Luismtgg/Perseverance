import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SOL, crearCielo } from './cielo.js';
import { altura, crearTerreno } from './terreno.js';
import { crearRocas } from './rocas.js';
import { crearLunas } from './lunas.js';
import { crearPolvo } from './polvo.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// --- Cámara: baja, mirando un poco hacia arriba para dejar sitio al cielo ---
const CAMARA_X = 0;
const CAMARA_Z = 14;
const ALTURA_OJOS = 2.2;
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 3000);
camera.position.set(CAMARA_X, altura(CAMARA_X, CAMARA_Z) + ALTURA_OJOS, CAMARA_Z);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-3, camera.position.y + 2.5, -10);
controls.enableDamping = true;
controls.minDistance = 6;
controls.maxDistance = 90;
controls.minPolarAngle = THREE.MathUtils.degToRad(55);
controls.maxPolarAngle = THREE.MathUtils.degToRad(99);
controls.update();

// Vaivén lento: gira solo unos grados a cada lado del encuadre inicial
const VAIVEN = THREE.MathUtils.degToRad(7);
const azimutInicial = controls.getAzimuthalAngle();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.12;

// --- Escena ---
const cielo = crearCielo();
scene.add(cielo);
scene.add(crearTerreno());
scene.add(crearRocas({ x: CAMARA_X, z: CAMARA_Z, radio: 7 }));
const lunas = crearLunas();
scene.add(lunas);
const polvo = crearPolvo();
scene.add(polvo.puntos);

// --- Luz: sol bajo y cálido, con el relleno anaranjado del cielo en las sombras ---
const luzSol = new THREE.DirectionalLight(0xffc08a, 3.6);
luzSol.target.position.set(0, 0, -30);
luzSol.position.copy(luzSol.target.position).addScaledVector(SOL, 400);
luzSol.castShadow = true;
luzSol.shadow.mapSize.set(4096, 4096);
luzSol.shadow.camera.left = -90;
luzSol.shadow.camera.right = 90;
luzSol.shadow.camera.top = 45;
luzSol.shadow.camera.bottom = -45;
luzSol.shadow.camera.near = 50;
luzSol.shadow.camera.far = 800;
luzSol.shadow.radius = 4;
luzSol.shadow.bias = -0.0004;
luzSol.shadow.normalBias = 0.05;
scene.add(luzSol, luzSol.target);
scene.add(new THREE.HemisphereLight(0xc98a55, 0x6a3a22, 1.4));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const reloj = new THREE.Clock();
renderer.setAnimationLoop(() => {
  // OrbitControls gira a la izquierda con velocidad positiva (azimut decreciente)
  const desvio = controls.getAzimuthalAngle() - azimutInicial;
  if (desvio > VAIVEN) controls.autoRotateSpeed = Math.abs(controls.autoRotateSpeed);
  else if (desvio < -VAIVEN) controls.autoRotateSpeed = -Math.abs(controls.autoRotateSpeed);
  controls.update();

  // Nunca por debajo de la arena
  const suelo = altura(camera.position.x, camera.position.z) + 1.0;
  if (camera.position.y < suelo) camera.position.y = suelo;

  // El cielo y las lunas están "en el infinito": siguen a la cámara
  cielo.position.copy(camera.position);
  lunas.position.copy(camera.position);
  polvo.actualizar(reloj.getElapsedTime(), camera, renderer.domElement.height);
  renderer.render(scene, camera);
  window.__ready = true;
});
