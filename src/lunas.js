import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm3, azar } from './ruido.js';
import { GLSL_ATMOSFERA, direccion, uniformsAtmosfera } from './cielo.js';

const DISTANCIA = 800;

// Cuerpo irregular con cráteres: una esfera deformada, no una bola perfecta
function formaLuna({ semilla, forma, crateres, craterGrande }) {
  const rnd = azar(semilla);
  let geo = new THREE.IcosahedronGeometry(1, 14);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);

  const lista = [];
  for (let i = 0; i < crateres; i++) {
    lista.push({
      centro: new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(),
      radio: 0.12 + rnd() * 0.22,
    });
  }
  // Fobos tiene un cráter enorme (Stickney) que le cambia la silueta
  if (craterGrande) lista.push({ centro: new THREE.Vector3(-0.5, 0.25, 0.83).normalize(), radio: craterGrande });

  const v = new THREE.Vector3();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1 + 0.14 * fbm3(v.x * 1.6 + semilla, v.y * 1.6, v.z * 1.6, 4);
    for (const { centro, radio } of lista) {
      const d = Math.acos(Math.min(1, v.dot(centro))) / radio;
      if (d < 1) r -= radio * 0.35 * (1 - d * d);
      else if (d < 1.4) r += radio * 0.05 * (1 - (d - 1) / 0.4);
    }
    pos.setXYZ(i, v.x * r * forma[0], v.y * r * forma[1], v.z * r * forma[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

function crearLuna({ dir, radio, color, brillo, ...forma }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniformsAtmosfera,
      uColor: { value: new THREE.Color(color) },
      uBrillo: { value: brillo },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalMundo;
      varying vec3 vPosMundo;
      varying vec3 vPosLocal;
      void main() {
        vNormalMundo = normalize(mat3(modelMatrix) * normal);
        vPosMundo = (modelMatrix * vec4(position, 1.0)).xyz;
        vPosLocal = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(vPosMundo, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_ATMOSFERA}
      uniform vec3 uColor;
      uniform float uBrillo;
      varying vec3 vNormalMundo;
      varying vec3 vPosMundo;
      varying vec3 vPosLocal;
      void main() {
        vec3 n = normalize(vNormalMundo);
        vec3 haciaCamara = normalize(cameraPosition - vPosMundo);
        // La fase real sería una hoz fina; se abre un poco para que la luna se lea bien,
        // manteniendo el lado iluminado hacia el sol
        vec3 luz = normalize(uSol + haciaCamara * 0.85);
        float ndl = max(dot(n, luz), 0.0);
        float tono = 0.8 + 0.6 * (fbm3(vPosLocal * 3.0) - 0.47);
        // De día el lado oscuro de una luna toma el color del cielo que tiene delante
        vec3 col = cieloSinSol(-haciaCamara);
        col += uColor * tono * uBrillo * smoothstep(0.0, 0.2, ndl) * (0.2 + 0.8 * ndl);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const luna = new THREE.Mesh(formaLuna(forma), material);
  luna.scale.setScalar(radio);
  luna.position.copy(dir).multiplyScalar(DISTANCIA);
  luna.rotation.set(forma.semilla, forma.semilla * 1.7, forma.semilla * 0.6);
  luna.frustumCulled = false;
  return luna;
}

// Fobos (grande, con forma de papa) y Deimos (pequeña y más clara). El tamaño está
// exagerado respecto al real para que se distingan. El grupo debe seguir a la cámara.
export function crearLunas() {
  const lunas = new THREE.Group();
  lunas.add(
    crearLuna({
      semilla: 7,
      dir: direccion(26, 19),
      radio: 19,
      forma: [1.28, 1.0, 1.08],
      crateres: 14,
      craterGrande: 0.55,
      color: 0xb39678,
      brillo: 1.05,
    })
  );
  lunas.add(
    crearLuna({
      semilla: 21,
      dir: direccion(3, 28),
      radio: 8,
      forma: [1.16, 1.0, 0.94],
      crateres: 8,
      color: 0xd8c2a2,
      brillo: 1.4,
    })
  );
  return lunas;
}
