# caballocci

Aplicación de escritorio offline-first para planificar contenido de Instagram, Facebook y X. Está construida con Electron, React, TypeScript, Vite y SQLite local mediante sql.js.

## Descargar para Windows

La instalación recomendada para usuarios es el instalador de la Release más reciente:

**[Descargar caballocci para Windows](https://github.com/gattocci/caballocci/releases/latest)**

En la sección **Assets**, descarga **caballocci-Setup-<version>-x64.exe**. Windows puede mostrar una advertencia de SmartScreen mientras el proyecto no disponga de certificado; verifica que provenga de **github.com/gattocci/caballocci**.

Las actualizaciones posteriores se ofrecen dentro de **Acerca de / Actualizaciones**. La descarga y la instalación requieren confirmación. Al aceptar, se crea un backup y la actualización se aplica en segundo plano antes de volver a abrir caballocci.

## Funciones

- Línea de tiempo horizontal, calendario y tablero Kanban.
- Espacios para organizar, filtrar y renombrar proyectos.
- Editor, vista previa y publicación manual.
- Biblioteca multimedia local en modo copia o referencia.
- Exportación de medios por publicación para transferirlos al celular con su orden de carrusel.
- Mapa conceptual persistente para relacionar ideas, publicaciones y recursos generales.
- Migraciones SQLite numeradas y transaccionales.
- Backups fechados antes de migraciones e instalaciones de actualizaciones.
- Actualizaciones desde GitHub Releases, siempre confirmadas por el usuario.

Los datos viven fuera de la instalación, en el directorio userData de Electron. Reinstalar, actualizar o desinstalar la aplicación no elimina la base, la biblioteca multimedia ni los backups.

## Enviar medios al celular

Desde el editor puedes enviar la publicación abierta; en el tablero puedes seleccionar varias y enviarlas en una tanda. Ambas acciones exportan al catálogo compartido de la app Android: los álbumes quedan en `pc-outbox/publications/` y se registran en `pc-outbox/catalog.json`. **Acerca de / Actualizaciones → Exportar todas las publicaciones** envía en una tanda todas las publicaciones elegibles. Las carpetas siguen el formato `lote-espacio-orden-titulo[-listo]-fecha`: el lote usa una letra secuencial (`a`…`z`, `aa`, `ab`…) y el ordinal continúa por espacio entre tandas. `listo` indica que Android confirmó el uso de al menos un destino; no significa que se haya publicado en redes.

Los tres flujos usan una única raíz compartida de Syncthing, configurada desde el editor o desde **Acerca de / Actualizaciones**. Debe estar en modo **Enviar y recibir en ambos dispositivos**: el PC envía el catálogo y Android devuelve confirmaciones en `android-inbox/<dispositivo>/`. El flujo es **exportar en caballocci → recibir y marcar en Android → importar en caballocci**. No sincronices la base SQLite activa. Consulta [Sincronización móvil](docs/MOBILE-SYNC.md) para los pasos y formatos.

La exportación de medios por publicación continúa disponible y no marca destinos como usados. La confirmación móvil significa que una persona marcó el destino como usado; no verifica que la red social haya publicado el contenido.

## Desarrollo en Windows

Requisitos: Git y Node.js 22 o posterior.

~~~powershell
git clone https://github.com/gattocci/caballocci.git
cd caballocci
npm.cmd ci
npm.cmd run dev
~~~

En desarrollo, Acerca de / Actualizaciones informa que el updater no está disponible. electron-updater solo se activa en aplicaciones empaquetadas.

Para validar y generar el instalador local:

~~~powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dist:win
~~~

El instalador NSIS x64 y sus metadatos se generan en **release/**. Esa carpeta está excluida de Git: los ejecutables se distribuyen mediante GitHub Releases, no dentro del historial del código fuente.

## Documentación

- [Versionado y publicación](docs/RELEASING.md)
- [Firma de código de Windows](docs/CODE-SIGNING.md)
- [Migraciones y protección de datos](docs/DATA-MIGRATIONS.md)
- [Aplicación móvil y sincronización](docs/MOBILE-SYNC.md)
- [Iconos e instalador](docs/BRANDING.md)
- [Política y modelo de seguridad](SECURITY.md)

## Arquitectura

- **electron/main.ts**: ventana, IPC, rutas locales y ciclo de vida.
- **electron/database.ts**: SQLite, migraciones, backups y persistencia atómica.
- **electron/updater.ts**: comprobación, descarga e instalación ofrecidas al usuario.
- **electron/preload.ts**: API mínima con contextIsolation; nodeIntegration permanece deshabilitado.
- **src/app**: aplicación y estado global.
- **src/features**: timeline, calendario, Kanban, editor, biblioteca y actualizaciones.
- **src/shared**: contratos y tipos compartidos del renderer.

## Datos locales

- Base: **<userData>/caballocci.sqlite**.
- Biblioteca copiada: **<userData>/Media**.
- Backups: **<userData>/Backups**.

En Windows, userData suele estar bajo **%APPDATA%\\caballocci**. La ruta efectiva se muestra en Acerca de / Actualizaciones. La migración desde content-planner.sqlite copia la base antigua y no elimina el original.
