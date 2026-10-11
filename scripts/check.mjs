// npm run check — abre la página en Chrome sin ventana, guarda una captura
// y lista los errores de consola. Sale con código 1 si hay alguno.
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

const URL_DEV = 'http://localhost:5173/';
const SALIDA = 'check/captura.png';
const ESPERA_LISTO_MS = 15000;

async function responde(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

let servidor = null;
let navegador = null;
const errores = [];

try {
  // Usa el servidor de desarrollo si ya está prendido; si no, levanta uno temporal
  let url = URL_DEV;
  if (!(await responde(url))) {
    const { createServer } = await import('vite');
    servidor = await createServer({ server: { port: 5174 }, logLevel: 'error' });
    await servidor.listen();
    url = servidor.resolvedUrls.local[0];
  }

  // Primero con la GPU real (rápido); si no hay WebGL, cae al renderizador por software
  const variantes = [
    ['--ignore-gpu-blocklist', '--use-angle=d3d11'],
    ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  ];
  let pagina = null;
  for (const args of variantes) {
    navegador = await chromium.launch({ channel: 'chrome', headless: true, args });
    pagina = await navegador.newPage({ viewport: { width: 1600, height: 900 } });
    const gpu = await pagina.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'WebGL2';
    });
    if (gpu) {
      console.log(`GPU:     ${gpu}`);
      break;
    }
    await navegador.close();
    navegador = pagina = null;
  }
  if (!pagina) throw new Error('Chrome no pudo crear un contexto WebGL2');

  pagina.on('console', (msg) => {
    if (msg.type() === 'error') errores.push(`console.error: ${msg.text()}`);
  });
  pagina.on('pageerror', (err) => errores.push(`excepción: ${err.message}`));
  pagina.on('requestfailed', (req) =>
    errores.push(`petición fallida: ${req.url()} (${req.failure()?.errorText ?? 'sin detalle'})`)
  );
  pagina.on('response', (res) => {
    if (res.status() >= 400) errores.push(`HTTP ${res.status()}: ${res.url()}`);
  });

  await pagina.goto(url, { waitUntil: 'load' });
  try {
    await pagina.waitForFunction(() => window.__ready === true, null, { timeout: ESPERA_LISTO_MS });
  } catch {
    errores.push(`la escena no marcó window.__ready en ${ESPERA_LISTO_MS / 1000} s`);
  }
  // Unos frames más para que sombras y texturas terminen de asentarse
  await pagina.waitForTimeout(1000);

  await mkdir(dirname(SALIDA), { recursive: true });
  await pagina.screenshot({ path: SALIDA });

  console.log(`URL:     ${url}`);
  console.log(`Captura: ${SALIDA}`);
} catch (err) {
  errores.push(`el check no pudo completarse: ${err.message}`);
} finally {
  await navegador?.close();
  await servidor?.close();
}

if (errores.length === 0) {
  console.log('Errores: ninguno');
} else {
  console.log(`Errores: ${errores.length}`);
  for (const e of errores) console.log(`  - ${e}`);
  process.exitCode = 1;
}
