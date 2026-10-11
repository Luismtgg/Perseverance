# Plan: paisaje cinematográfico de Marte (Vite + Three.js)

## Contexto
La carpeta solo tiene `CLAUDE.md` y `.github/`. Se quiere la primera pieza de la simulación de Perseverance: un paisaje marciano "de película" visible en vivo en el navegador de Cursor, con un comando `npm run check` que me permita revisarme solo (captura + errores de consola).

Entorno verificado: Node 24.11, npm 11.13, Chrome en `C:\Program Files\Google\Chrome\Application\chrome.exe`, puerto 5173 libre.

## Fase 0 — Algo en pantalla en < 2 min
Archivos escritos a mano (sin `npm create`, es más rápido y no pregunta nada):
- `package.json` — scripts `dev` (`vite --port 5173 --strictPort`), `build`, `check`; deps `three`; devDeps `vite`, `playwright-core`.
- `index.html` — canvas a pantalla completa, fondo oscuro.
- `src/main.js` — versión mínima: renderer, cámara, terreno ondulado color óxido, cielo en degradado caramelo, luz direccional cálida, niebla.
- `.gitignore` — `node_modules`, `dist`, `check/`.

Luego `npm install` y `npm run dev` en segundo plano → **http://localhost:5173** (abrirlo en el navegador de Cursor; Vite recarga solo con cada cambio).

## Fase 1 — `npm run check`
`scripts/check.mjs` con `playwright-core` (no descarga navegadores):
- `chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })` para tener WebGL sin ventana.
- Usa el servidor de 5173 si responde; si no, levanta uno temporal con la API de Vite y lo cierra al terminar.
- Recoge `console.error`, `pageerror` y peticiones fallidas; espera a `window.__ready` (la escena lo marca tras el primer frame) con tope de 15 s.
- Guarda `check/captura.png` (1600×900), imprime la lista de errores y sale con código 1 si hay alguno.

## Fase 2 — Mejoras (en `src/`, un módulo por elemento)
- `terreno.js` — malla grande desplazada con ruido: dunas anchas con crestas asimétricas (ruido "ridged" estirado según el viento) + ondulaciones finas en el mapa de normales procedural; color que varía entre óxido, ocre y polvo claro.
- `rocas.js` — `InstancedMesh` de icosaedros deformados con ruido (varias formas base, cientos de instancias), apoyadas sobre la altura del terreno, más densas cerca de cámara; proyectan y reciben sombra.
- `cielo.js` — cúpula con shader: degradado caramelo/butterscotch, bruma de polvo más clara en el horizonte, disco solar con halo azulado (como los atardeceres reales de Marte) y unas pocas estrellas tenues en lo alto.
- `lunas.js` — Fobos (más grande, forma de papa irregular) y Deimos (pequeña y brillante), iluminadas desde la dirección del sol; tamaño algo exagerado respecto al real para que se distingan en la captura.
- Luz y ambiente — sol bajo (~12° sobre el horizonte) con `DirectionalLight` cálida, sombras `PCFSoftShadowMap` largas y suaves, luz hemisférica naranja de relleno, `FogExp2` color polvo, partículas de polvo en suspensión, tone mapping ACES + salida sRGB.
- Cámara — a baja altura con `OrbitControls` y un vaivén lento automático; encuadre inicial que deje ver sol, las dos lunas, dunas y rocas a la vez.

## Verificación (máximo 3 rondas)
Tras cada bloque grande: `npm run check` → leo `check/captura.png` → corrijo.
1. Ronda 1: terreno + cielo + sol/sombras.
2. Ronda 2: rocas + lunas + polvo.
3. Ronda 3: pulido de color/encuadre y lo que falle.

**Listo cuando:** 0 errores de consola y la captura muestra dunas, rocas, cielo caramelo con polvo, sol de tarde con sombras suaves y las dos lunas. Si tras la ronda 3 queda algo pendiente, lo digo tal cual en vez de seguir iterando.

No haré commits (no se pidieron).
