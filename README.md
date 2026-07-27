# caballocci

Aplicación de escritorio offline-first para planificar contenido de Instagram, Facebook y X. Usa Electron, React, TypeScript, Vite y SQLite local mediante sql.js.

## Funciones

- Línea de tiempo horizontal, calendario y tablero Kanban.
- Editor, vista previa y publicación manual.
- Biblioteca multimedia local en modo copia o referencia.
- Migraciones SQLite numeradas y transaccionales.
- Backups fechados antes de migraciones e instalaciones de actualizaciones.
- Actualizaciones desde GitHub Releases, siempre confirmadas por el usuario.

Los datos se guardan fuera de la instalación, en el directorio `userData` de Electron. Reinstalar o actualizar la aplicación no elimina la base, la biblioteca multimedia ni los backups.

## Desarrollo en Windows

Requisitos: Node.js 22 o posterior.

```powershell
npm.cmd ci
npm.cmd run dev
```

En desarrollo, la pantalla Acerca de / Actualizaciones informa que el updater no está disponible. `electron-updater` solo se activa cuando `app.isPackaged` es verdadero.

## Compilar y empaquetar

```powershell
npm.cmd run build
npm.cmd run dist:win
```

El instalador NSIS x64 y sus metadatos se generan en `release/`. Consulta [docs/RELEASING.md](docs/RELEASING.md) para publicar una versión y [docs/DATA-MIGRATIONS.md](docs/DATA-MIGRATIONS.md) para añadir migraciones.

## Arquitectura

- `electron/main.ts`: ventana, IPC, rutas locales y ciclo de vida.
- `electron/database.ts`: SQLite, migraciones, backups y persistencia atómica.
- `electron/updater.ts`: comprobación, descarga e instalación ofrecidas al usuario.
- `electron/preload.ts`: API mínima con `contextIsolation`; `nodeIntegration` permanece deshabilitado.
- `src/app`: aplicación y estado global.
- `src/features`: timeline, calendario, Kanban, editor, biblioteca y actualizaciones.
- `src/shared`: contratos y tipos compartidos del renderer.

## Datos locales

- Base: `<userData>/caballocci.sqlite`.
- Biblioteca copiada: `<userData>/Media`.
- Backups: `<userData>/Backups`.

En Windows, `userData` suele estar bajo `%APPDATA%\caballocci`. La ruta efectiva se muestra en Acerca de / Actualizaciones. La migración compatible desde `content-planner.sqlite` copia la base antigua y no elimina el original.
