import * as THREE from 'three';

// Dirección unitaria en el cielo. Azimut 0° = hacia -Z (frente a la cámara), positivo a la derecha.
export function direccion(azimutGrados, elevacionGrados) {
  const az = THREE.MathUtils.degToRad(azimutGrados);
  const el = THREE.MathUtils.degToRad(elevacionGrados);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

// Sol de tarde: bajo y un poco a la izquierda del encuadre
export const SOL = direccion(-19, 11);

export const uniformsAtmosfera = {
  uSol: { value: SOL },
  uDensidad: { value: 0.0018 },
};

// Color del cielo compartido por la cúpula, la bruma del terreno y las lunas,
// para que el horizonte se funda sin costura.
export const GLSL_ATMOSFERA = /* glsl */ `
  uniform vec3 uSol;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float ruido3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
          mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
          mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float fbm3(vec3 p) {
    float suma = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      suma += amp * ruido3(p);
      p = p * 2.03 + 7.1;
      amp *= 0.5;
    }
    return suma;
  }

  // Degradado caramelo + resplandor del polvo alrededor del sol (sin disco ni vetas)
  vec3 atmosfera(vec3 d) {
    float h = max(d.y, 0.0);
    float s = max(dot(d, uSol), 0.0);
    vec3 horizonte = vec3(0.62, 0.31, 0.12);
    vec3 medio = vec3(0.40, 0.185, 0.07);
    vec3 cenit = vec3(0.16, 0.07, 0.03);
    vec3 col = mix(horizonte, medio, smoothstep(0.0, 0.22, h));
    col = mix(col, cenit, smoothstep(0.12, 0.85, h));
    // El polvo dispersa la luz hacia delante: resplandor ancho y cálido
    col += vec3(1.0, 0.62, 0.30) * (pow(s, 5.0) * 0.30 + pow(s, 24.0) * 0.35);
    // Halo azulado pegado al disco, como en los atardeceres marcianos: el polvo fino
    // dispersa el azul hacia delante, así que sustituye al tono cálido en vez de sumarse
    col = mix(col, vec3(0.76, 0.98, 1.38), pow(s, 160.0) * 0.75);
    return col;
  }

  // Igual que atmosfera() pero con vetas de polvo estiradas sobre el horizonte
  vec3 cieloSinSol(vec3 d) {
    float h = max(d.y, 0.0);
    float vetas = fbm3(vec3(d.x * 2.5, d.y * 16.0, d.z * 2.5)) - 0.47;
    vetas *= 0.4 * smoothstep(0.0, 0.06, h) * pow(1.0 - h, 3.0);
    return atmosfera(d) * (1.0 + vetas);
  }
`;

export function crearCielo() {
  const cielo = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: uniformsAtmosfera,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${GLSL_ATMOSFERA}
        varying vec3 vDir;

        // Unas pocas estrellas tenues en lo alto, donde hay menos polvo que atravesar.
        // Proyección estereográfica (conforme): las estrellas quedan redondas.
        float estrellas(vec3 d) {
          vec2 uv = d.xz / (1.0 + max(d.y, 0.0)) * 34.0;
          // Radio en píxeles, no en ángulo: un punto nítido a cualquier resolución
          float radio = 1.5 * length(fwidth(uv)) * 0.7071;
          vec2 celda = floor(uv);
          float azar = hash31(vec3(celda, 3.7));
          if (azar < 0.94) return 0.0;
          vec2 centro = celda + 0.25 + 0.5 * vec2(hash31(vec3(celda, 11.0)), hash31(vec3(celda, 23.0)));
          float brillo = 0.35 + 0.65 * (azar - 0.94) / 0.06;
          float alto = smoothstep(0.18, 0.45, d.y);
          float lejosDelSol = smoothstep(0.93, 0.6, dot(d, uSol));
          return smoothstep(radio, radio * 0.3, length(uv - centro)) * brillo * alto * lejosDelSol;
        }

        void main() {
          vec3 d = normalize(vDir);
          vec3 col = cieloSinSol(d);
          col += vec3(1.0, 0.95, 0.88) * estrellas(d) * 0.3;
          // Disco solar (~1.1° de radio)
          col += vec3(1.0, 0.93, 0.82) * smoothstep(0.99978, 0.99984, dot(d, uSol)) * 30.0;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
  );
  cielo.renderOrder = -1;
  cielo.frustumCulled = false;
  return cielo;
}

// Añade a un material estándar la bruma de polvo (del color del cielo en esa
// dirección) y, opcionalmente, polvo asentado en las caras que miran hacia arriba.
export function conAtmosfera(material, { polvoEncima = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniformsAtmosfera);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vPosMundo;
        varying float vArriba;`
      )
      .replace(
        '#include <fog_vertex>',
        /* glsl */ `#include <fog_vertex>
        vec4 posM = vec4(transformed, 1.0);
        vec3 norM = objectNormal;
        #ifdef USE_INSTANCING
          posM = instanceMatrix * posM;
          norM = mat3(instanceMatrix) * norM;
        #endif
        vPosMundo = (modelMatrix * posM).xyz;
        vArriba = normalize(mat3(modelMatrix) * norM).y;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vPosMundo;
        varying float vArriba;
        uniform float uDensidad;
        ${GLSL_ATMOSFERA}`
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        ${polvoEncima ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.25, 0.12), smoothstep(0.6, 1.0, vArriba) * 0.45);' : ''}`
      )
      .replace(
        '#include <tonemapping_fragment>',
        /* glsl */ `{
          vec3 rayo = vPosMundo - cameraPosition;
          float distancia = length(rayo);
          vec3 haciaHorizonte = normalize(vec3(rayo.x, 0.03 * distancia, rayo.z));
          float bruma = 1.0 - exp(-pow(distancia * uDensidad, 1.6));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, atmosfera(haciaHorizonte), bruma);
        }
        #include <tonemapping_fragment>`
      );
  };
  material.customProgramCacheKey = () => `atmosfera-${polvoEncima}`;
  return material;
}
