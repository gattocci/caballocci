import { BrowserWindow } from 'electron'
import path from 'node:path'

/** Lightweight native splash shown while the database and renderer initialize. */
export function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 520,
    height: 360,
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

  // Pure CSS (no scripts): the CSP stays locked down. Cells with a post chip use --c (color) and --d (delay).
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
      background: radial-gradient(ellipse 70% 55% at 50% 0%, #ef65481f, transparent 70%), #101311; box-shadow: inset 0 0 0 1px #29312b; }
    main { display: grid; justify-items: center; gap: 14px; animation: enter .6s ease-out both; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .mark { display: grid; grid-template-columns: repeat(3, 6px); align-items: end; gap: 4px; width: 42px; height: 42px; padding: 11px 10px; border-radius: 12px; background: #ef6548; box-shadow: 0 8px 28px #ef654838; }
    .mark i { display: block; border-radius: 2px 2px 0 0; background: #181510; transform-origin: bottom; animation: bar 1.8s ease-in-out infinite; }
    .mark i:nth-child(1) { height: 9px; }
    .mark i:nth-child(2) { height: 16px; animation-delay: .15s; }
    .mark i:nth-child(3) { height: 12px; animation-delay: .3s; }
    h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -0.8px; }

    .cal { width: 342px; padding: 8px; border: 1px solid #303a33; border-radius: 7px; background: #131815; }
    .cal-head, .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
    .cal-head { margin-bottom: 4px; }
    .cal-head span { color: #7c8780; font: 600 8px 'DM Mono', ui-monospace, Consolas, monospace; text-align: center; letter-spacing: .5px; }
    .cal-grid b { position: relative; height: 26px; border-radius: 2px; background: #171d19; }
    .cal-grid b.off { background: #101411; }
    .cal-grid b.today { box-shadow: inset 0 0 0 1px #ef654866; animation: today 2.4s ease-in-out infinite; }
    .cal-grid b.p::after { content: ''; position: absolute; inset: 3px; border-left: 3px solid var(--c); border-radius: 1px; background: #222a25; opacity: 0; animation: chip 6s ease-out infinite; animation-delay: var(--d); }
    .cal-grid b.p::before { content: ''; position: absolute; z-index: 1; left: 11px; right: 6px; top: 9px; height: 3px; border-radius: 2px; background: #6b776f; opacity: 0; animation: chip 6s ease-out infinite; animation-delay: var(--d); }

    .status { display: grid; justify-items: center; min-height: 14px; margin: 0; color: #89938c; font-size: 11px; letter-spacing: .04em; }
    .loader { width: 96px; height: 2px; overflow: hidden; border-radius: 2px; background: #29312b; }
    .loader::after { display: block; width: 36%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #ef6548, #d0a64b); content: ''; animation: load 1.1s ease-in-out infinite; }

    @keyframes enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes bar { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.35); } }
    @keyframes today { 0%, 100% { box-shadow: inset 0 0 0 1px #ef654833; } 50% { box-shadow: inset 0 0 0 1px #ef6548aa; } }
    @keyframes chip { 0% { opacity: 0; transform: translateY(-7px) scale(.94); } 8%, 78% { opacity: 1; transform: none; } 92%, 100% { opacity: 0; transform: none; } }
    @keyframes load { from { transform: translateX(-110%); } to { transform: translateX(290%); } }
    @media (prefers-reduced-motion: reduce) {
      * { animation: none !important; }
      .cal-grid b.p::after, .cal-grid b.p::before { opacity: 1; }
      .loader::after { width: 100%; }
    }
  </style>
</head>
<body>
  <main aria-label="Iniciando caballocci">
    <div class="brand"><div class="mark" aria-hidden="true"><i></i><i></i><i></i></div><h1>caballocci</h1></div>
    <div class="cal" aria-hidden="true">
      <div class="cal-head"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="cal-grid">
        <b class="off"></b><b></b><b class="p" style="--c:#55bf8b;--d:.3s"></b><b></b><b></b><b class="p" style="--c:#d0a64b;--d:1.5s"></b><b></b>
        <b></b><b class="p" style="--c:#ef6548;--d:.7s"></b><b></b><b></b><b class="p" style="--c:#55bf8b;--d:2s"></b><b></b><b class="off"></b>
        <b class="p" style="--c:#d0a64b;--d:1.1s"></b><b></b><b class="today p" style="--c:#ef6548;--d:2.4s"></b><b class="p" style="--c:#6aa6d9;--d:.5s"></b><b></b><b></b><b class="p" style="--c:#55bf8b;--d:1.8s"></b>
        <b></b><b class="p" style="--c:#6aa6d9;--d:2.8s"></b><b></b><b></b><b class="p" style="--c:#d0a64b;--d:.9s"></b><b class="off"></b><b class="off"></b>
      </div>
    </div>
    <p class="status" data-splash-status aria-live="polite">Iniciando caballocci</p>
    <div class="loader" aria-hidden="true"></div>
  </main>
</body>
</html>`

  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splash.once('ready-to-show', () => splash.show())
  return splash
}
