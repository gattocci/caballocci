import { BrowserWindow } from 'electron'
import path from 'node:path'

const startupTips = [
  'Los espacios de trabajo. Una estructura clara reduce la confusión desde el primer día.',
  'Es mejor tener cinco publicaciones listas que treinta a medio hacer.',
  'Revisa y mejora tu método cada semana: identifica qué te hace perder tiempo y simplifica tu flujo de trabajo.',
  'Separa ideas de compromisos: no conviertas cada idea que se te ocurra en una publicación pendiente.',
  'Produce por lotes: dedica sesiones específicas a escribir, preparar imágenes y revisar publicaciones para ahorrar tiempo.',
]

// Los colores de columna representan el estado; los de tarjeta, el color propio de la publicación.
const cardColors = ['#e76042', '#e9a34b', '#d8c45b', '#67b987', '#55b9ad', '#5e9ed2', '#8a83d6', '#ca79ae']

// Tarjetas sin color definido (caen en el neutro #171d19), como `columna-índice`.
const plainCards = new Set(['0-1', '1-2', '3-1', '5-0'])

// Mismas columnas y colores de estado que el Tablero real. `n` = tarjetas fantasma por columna.
const columns = [
  { label: 'Pendiente', color: '#858d87', n: 2 },
  { label: 'Borradores', color: '#59a9e8', n: 3 },
  { label: 'En revisión', color: '#d5a03c', n: 0 }, // vacía, como en la app
  { label: 'Aprobado', color: '#8fbf4a', n: 2 },
  { label: 'Programado', color: '#e76042', n: 1 },
  { label: 'Publicado', color: '#1f7a52', n: 3 },
]

function boardHtml() {
  return columns
    .map((col, ci) => {
      const cards =
        col.n === 0
          ? '<div class="slot"></div>'
          : Array.from({ length: col.n }, (_, i) => `<div class="card${plainCards.has(`${ci}-${i}`) ? ' plain' : ''}" style="--post-color:${cardColors[(ci + i) % cardColors.length]};--d:${(0.25 + ci * 0.1 + i * 0.12).toFixed(2)}s"></div>`).join('')
      return `<div class="col" style="--c:${col.color}"><div class="head">${col.label}</div>${cards}</div>`
    })
    .join('')
}

/** Lightweight native splash shown while the database and renderer initialize. */
export function createSplashWindow() {
  return createSplash(false)
}

/** Startup version of the splash, with a short rotating tip. */
export function createStartupSplashWindow() {
  return createSplash(true)
}

function createSplash(showTip: boolean) {
  const splash = new BrowserWindow({
    width: 620,
    height: showTip ? 480 : 380,
    center: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    frame: false,
    show: false,
    backgroundColor: '#101311',
    title: 'caballocci',
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // CSS puro (sin scripts): el CSP sigue cerrado.
  // Una publicación viaja por el flujo real del Tablero: Borradores → Aprobado → Programado → Publicado.
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <title>caballocci</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { display: grid; place-items: center; overflow: hidden; color: #f4f6f5; font-family: 'Segoe UI', sans-serif;
      background: #101311; box-shadow: inset 0 0 0 1px #29312b; }
    main { display: grid; justify-items: center; gap: 20px; width: 560px; animation: enter .6s ease-out both; }

    .brand { display: flex; align-items: center; gap: 12px; }
    .mark { display: grid; grid-template-columns: repeat(3, 6px); align-items: end; gap: 4px; width: 42px; height: 42px; padding: 11px 10px; border-radius: 12px; background: #ef6548; }
    .mark i { display: block; border-radius: 2px 2px 0 0; background: #181510; transform-origin: bottom; animation: bar 1.8s ease-in-out infinite; }
    .mark i:nth-child(1) { height: 9px; }
    .mark i:nth-child(2) { height: 16px; animation-delay: .15s; }
    .mark i:nth-child(3) { height: 12px; animation-delay: .3s; }
    h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -0.8px; }

    /* Mini tablero */
    .board { position: relative; width: 100%; padding: 10px; border: 1px solid #29312b; border-radius: 10px; background: #131815; }
    .cols { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; height: 158px; overflow: hidden;
      -webkit-mask-image: linear-gradient(#000 78%, transparent); mask-image: linear-gradient(#000 78%, transparent); }
    .col { display: flex; flex-direction: column; gap: 6px; }
    .head { height: 18px; padding: 0 6px; border-radius: 3px; background: var(--c); color: #101311; white-space: nowrap; overflow: hidden;
      font: 700 7.5px/18px 'DM Mono', ui-monospace, Consolas, monospace; letter-spacing: .06em; text-transform: uppercase; }
    .card, .hero { height: 34px; border-radius: 4px; background-color: color-mix(in srgb, var(--post-color, #e9a34b) 13%, #171d19);
      background-image: linear-gradient(#3a453d, #3a453d), linear-gradient(#2c352f, #2c352f);
      background-repeat: no-repeat; background-position: 23px 11px, 11px 21px; background-size: 52% 3px, 34% 3px; }
    .card.plain { background-color: #171d19; }
    .card { flex: none; opacity: 0; animation: pop .5s ease-out both; animation-delay: var(--d); }
    .slot { height: 34px; border: 1px dashed #2b362f; border-radius: 4px; opacity: 0; animation: pop .5s ease-out .5s both; }

    .hero { position: absolute; top: 24px; left: 0; width: calc((100% - 30px) / 6); z-index: 2; opacity: 0; outline: 1px solid #d0a64b;
      animation: journey 5.6s cubic-bezier(.5, 0, .2, 1) 1s infinite; }
    .hero::before { content: ''; position: absolute; left: 10px; top: 8px; width: 9px; height: 9px; border-radius: 2px; background: #d94b73; }

    /* Estado + consejo */
    .progress { display: grid; justify-items: center; gap: 10px; }
    .status { position: relative; min-height: 14px; margin: 0; color: #89938c; font-size: 11px; letter-spacing: .04em; }
    /* Puntos animados al mismo ritmo que la barra (1.3s). Absolutos para que el texto no se mueva. */
    .status::after { position: absolute; left: 100%; content: ''; animation: dots 1.3s steps(1, end) infinite; }

    .tip-wrap { display: grid; justify-items: center; gap: 12px; width: 100%; animation: rise .8s ease-out .5s both; }
    .tip-label { display: flex; align-items: center; gap: 12px; width: 100%; margin: 0; color: #d0a64b; text-transform: uppercase;
      font: 600 9px 'DM Mono', ui-monospace, Consolas, monospace; letter-spacing: .22em; }
    .tip-label::before, .tip-label::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, transparent, #3a4439); }
    .tip-label::after { transform: scaleX(-1); }
    .tip { max-width: 460px; min-height: 66px; margin: 0; color: #d6dcd8; text-align: center; font: 400 14px/1.55 'Segoe UI', sans-serif; text-wrap: balance; }

    .loader { width: 148px; height: 3px; overflow: hidden; border-radius: 3px; background: #29312b; }
    .loader::after { display: block; width: 36%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #ef6548, #d0a64b); content: ''; animation: load 1.3s ease-in-out infinite; }

    @keyframes enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.96); } to { opacity: 1; transform: none; } }
    @keyframes bar { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.35); } }
    @keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
    @keyframes load { from { transform: translateX(-110%); } to { transform: translateX(290%); } }
    /* Una columna = 100% + 6px de su ancho. Borradores (col 2) → Aprobado (col 4) → Programado (col 5) → Publicado (col 6). */
    @keyframes journey {
      0%   { opacity: 0; transform: translateX(0) scale(.92); box-shadow: none; }
      7%, 20% { opacity: 1; transform: translateX(0) scale(1); box-shadow: 0 6px 18px #0008; }
      30%, 42% { opacity: 1; transform: translateX(calc(200% + 12px)) scale(1); box-shadow: 0 6px 18px #0008; }
      52%, 62% { opacity: 1; transform: translateX(calc(300% + 18px)) scale(1); box-shadow: 0 6px 18px #0008; }
      72% { opacity: 1; transform: translateX(calc(400% + 24px)) scale(1.04); box-shadow: 0 6px 18px #0008; }
      80%, 92% { opacity: 1; transform: translateX(calc(400% + 24px)) scale(1); box-shadow: none; }
      100% { opacity: 0; transform: translateX(calc(400% + 24px)) scale(1); box-shadow: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { animation: none !important; }
      .card, .slot, .tip-wrap { opacity: 1; }
      .hero { display: none; }
      .status::after { animation: none; content: '...'; }
      .loader::after { width: 100%; }
    }
  </style>
</head>
<body>
  <main aria-label="Iniciando caballocci">
    <div class="brand"><div class="mark" aria-hidden="true"><i></i><i></i><i></i></div><h1>caballocci</h1></div>
    <div class="board" aria-hidden="true">
      <div class="cols">${boardHtml()}<div class="hero" style="--post-color:#5e9ed2"></div></div>
    </div>
    ${showTip ? `<section class="tip-wrap" aria-label="Consejo de caballocci"><p class="tip-label">Consejo</p><p class="tip">${startupTips[Math.floor(Math.random() * startupTips.length)]}</p></section>` : ''}
    <div class="progress">
      <p class="status" data-splash-status aria-live="polite">Iniciando caballocci</p>
      <div class="loader" role="progressbar" aria-label="Cargando caballocci" aria-valuetext="En curso"></div>
    </div>
  </main>
</body>
</html>`

  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splash.once('ready-to-show', () => splash.show())
  return splash
}