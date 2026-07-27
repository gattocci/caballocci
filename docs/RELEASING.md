# Versionado y publicación

caballocci usa versionado semántico (`MAJOR.MINOR.PATCH`). La versión de `package.json` es la fuente de verdad y la etiqueta Git debe coincidir exactamente con ella prefijada por `v`.

## Qué publica una Release

El workflow `.github/workflows/release-windows.yml` solo se ejecuta al subir una etiqueta `v*`. Un push normal a cualquier rama no publica instaladores ni actualizaciones.

GitHub Actions usa el `GITHUB_TOKEN` efímero proporcionado por GitHub con permiso `contents: write`. No se necesita ni debe almacenarse ningún token en el repositorio o en el código de la aplicación.
Las Actions de terceros están fijadas por SHA y checkout no conserva credenciales Git. La única exposición explícita de `GITHUB_TOKEN` ocurre en el paso que publica la Release.

## Preparar una versión

1. Decide el incremento SemVer: PATCH para correcciones compatibles, MINOR para funciones compatibles y MAJOR para cambios incompatibles.
2. Actualiza `package.json` y `package-lock.json` conjuntamente. Para publicar `0.1.1`:

```powershell
npm.cmd version 0.1.1 --no-git-tag-version
npm.cmd ci
npm.cmd run build
npm.cmd run dist:win
node scripts/verify-release.mjs v0.1.1 --artifacts
```

3. Prueba el instalador de `release/` en Windows. Comprueba un arranque limpio y una actualización sobre una instalación con datos existentes.
4. Revisa y confirma los cambios de versión y funcionalidad.
5. Crea y sube la etiqueta desde el commit publicado:

```powershell
git tag -a v0.1.1 -m "caballocci 0.1.1"
git push origin main
git push origin v0.1.1
```

No crees la etiqueta antes de que el commit con la misma versión esté en la rama remota. El workflow falla si la etiqueta no es SemVer o no coincide con `package.json`.

## Artefactos

La Release pública debe contener como mínimo:

- `caballocci-Setup-<version>-x64.exe`: instalador NSIS asistido.
- `caballocci-Setup-<version>-x64.exe.blockmap`: mapa para descarga diferencial.
- `latest.yml`: versión, URL y hash usados por `electron-updater`.

El workflow publica estos archivos en GitHub Releases y además los conserva como artefacto de la ejecución. `scripts/verify-release.mjs` verifica tanto la correspondencia etiqueta/versión como la presencia de los tres tipos de archivo.
El comando `npm.cmd run dist:win` ejecuta esa verificación automáticamente al terminar el empaquetado local.
La caché local de Electron y de las herramientas de empaquetado se guarda en `.electron-builder-cache/`, fuera de Git, para evitar depender de permisos de `%LOCALAPPDATA%`.

## Comportamiento de actualización

- La aplicación empaquetada comprueba automáticamente después del arranque y permite una comprobación manual.
- Encontrar una versión no inicia la descarga: el usuario pulsa Descargar actualización.
- Terminar la descarga no instala: el usuario pulsa Reiniciar y actualizar.
- Justo antes de `quitAndInstall`, caballocci persiste SQLite y crea un backup `before-update`.
- Después de la confirmación, NSIS se ejecuta silenciosamente y caballocci vuelve a abrirse; no se repite el asistente de instalación inicial.
- En desarrollo no se consulta GitHub y se muestra el estado no disponible.

## Historial de Releases y limpieza del repositorio

Los instaladores, blockmaps y latest.yml pertenecen a GitHub Releases, no al historial Git. No uses `git add -f release/*.exe`: el README enlaza la Release más reciente para usuarios y mantiene las instrucciones del código fuente separadas para desarrolladores.
`*.exe` está excluido globalmente para evitar añadir por accidente un instalador a la raíz. Antes de `git add .`, revisa siempre `git status --short`.

Las Releases anteriores pueden permanecer publicadas. El updater selecciona la Release estable más reciente; conservar versiones históricas no aumenta el tamaño de un clon del repositorio ni interfiere con las actualizaciones. No reutilices etiquetas ni reemplaces binarios ya publicados.

## Firma de código y SmartScreen

La configuración actual permite producir instaladores sin firma porque el proyecto no dispone de certificado. Windows SmartScreen puede mostrar una advertencia de editor desconocido; el usuario debe verificar que el instalador proviene de `https://github.com/gattocci/caballocci/releases`.

Para distribución pública sostenida se recomienda un certificado de firma de código. Debe configurarse mediante secretos de GitHub Actions compatibles con electron-builder, nunca mediante certificados, contraseñas o tokens incluidos en el repositorio. Después de habilitar firma, elimina `verifyUpdateCodeSignature: false` y valida instalación y actualización firmadas.

## Fallos y recuperación

- Si el workflow falla, corrige el commit y publica una versión/etiqueta nueva; no reemplaces binarios de una Release ya consumida por clientes.
- Si una migración falla, la transacción se revierte y el arranque falla sin persistir el esquema parcial. El backup previo queda en `Backups`.
- Para recuperar datos, cierra caballocci, conserva una copia de todos los archivos y restaura un `.sqlite` de backup como `caballocci.sqlite`. No borres `Media`.
