import * as THREE from 'three';
import { azar } from './ruido.js';
import { uniformsAtmosfera } from './cielo.js';

const CAJA = 60; // lado del volumen de motas que rodea a la cámara
const CANTIDAD = 1600;

// Motas de polvo en suspensión que derivan con el viento y brillan a contraluz.
// Devuelve { puntos, actualizar(tiempo, camara, altoPx) }.
export function crearPolvo() {
  const rnd = azar(404);
  const posiciones = new Float32Array(CANTIDAD * 3);
  const escalas = new Float32Array(CANTIDAD);
  for (let i = 0; i < CANTIDAD; i++) {
    posiciones[i * 3] = rnd() * CAJA;
    posiciones[i * 3 + 1] = rnd() * CAJA;
    posiciones[i * 3 + 2] = rnd() * CAJA;
    escalas[i] = 0.02 + rnd() ** 3 * 0.07;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
  geo.setAttribute('aEscala', new THREE.BufferAttribute(escalas, 1));

  const uniforms = {
    uSol: uniformsAtmosfera.uSol,
    uTiempo: { value: 0 },
    uCentro: { value: new THREE.Vector3() },
    uEscalaPx: { value: 800 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3 uSol;
      uniform float uTiempo;
      uniform vec3 uCentro;
      uniform float uEscalaPx;
      attribute float aEscala;
      varying float vAlfa;
      void main() {
        // Deriva con el viento y se repite dentro de la caja centrada en la cámara
        vec3 p = position + vec3(0.78, 0.04, 0.626) * uTiempo * 0.8;
        p.y += sin(uTiempo * 0.4 + position.x) * 0.3;
        p = mod(p - uCentro + ${(CAJA / 2).toFixed(1)}, ${CAJA.toFixed(1)}) - ${(CAJA / 2).toFixed(1)} + uCentro;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        gl_PointSize = clamp(aEscala * uEscalaPx / max(dist, 0.1), 1.0, 24.0);
        gl_Position = projectionMatrix * mv;
        float haciaSol = max(dot(normalize(p - cameraPosition), uSol), 0.0);
        vAlfa = smoothstep(${(CAJA / 2).toFixed(1)}, ${(CAJA / 3).toFixed(1)}, length(p - uCentro))
              * smoothstep(0.4, 2.5, dist)
              * (0.25 + 0.75 * pow(haciaSol, 4.0));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlfa;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlfa * 0.18;
        gl_FragColor = vec4(1.0, 0.78, 0.5, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const puntos = new THREE.Points(geo, material);
  puntos.frustumCulled = false;

  return {
    puntos,
    actualizar(tiempo, camara, altoPx) {
      uniforms.uTiempo.value = tiempo;
      uniforms.uCentro.value.copy(camara.position);
      uniforms.uEscalaPx.value = altoPx / (2 * Math.tan(THREE.MathUtils.degToRad(camara.fov) / 2));
    },
  };
}
