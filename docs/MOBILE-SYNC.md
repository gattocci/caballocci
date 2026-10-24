# Aplicación móvil y sincronización

## Decisiones y semántica

La aplicación de escritorio conserva la fuente de verdad: publicaciones, destinos, texto, orden multimedia e historial viven en SQL.js local. Android recibe un snapshot de lectura y no abre ni modifica la base de datos de escritorio.

Una publicación puede tener varios destinos, cada uno con su propio estado y fecha programada (`distribution_json`). Por eso una confirmación identifica el par **publicación + destino**. `used` significa que el usuario confirmó haber usado ese destino; no certifica una publicación externa. Importar un evento no cambia `posts.status`, el estado del destino ni otro metadato editorial.

En Android se excluyen los destinos que ya están en estado `published` o `not_applicable`, y las publicaciones archivadas. Los demás destinos aparecen hasta que estén marcados en el snapshot o en el registro local pendiente del teléfono. Una confirmación importada reaparece como `used` en el siguiente snapshot. Exportar o sincronizar nunca confirma automáticamente un destino.

## Carpeta raíz y flujo

Para esta integración, configura la carpeta compartida como **Enviar y recibir en ambos dispositivos**. El PC envía publicaciones y Android devuelve confirmaciones; **Solo enviar** o **Solo recibir** impediría que las confirmaciones regresen. Usa una carpeta dedicada, estable y con espacio suficiente. Por ejemplo, la carpeta raíz puede estar en `C:\Users\<usuario>\Syncthing\Caballocci-Sync` en el PC y en `/storage/emulated/0/Pictures/Caballocci` en Android. `Pictures/Caballocci` es solo un ejemplo de ubicación; no indica por sí misma el modo de sincronización. Si la carpeta está actualmente en Solo recibir para otro uso, crea una raíz nueva para la app o cambia su modo en ambos dispositivos.

La **carpeta raíz de sincronización** es la carpeta que eliges en el PC y compartes como carpeta Syncthing. Al aceptar esa carpeta en Android, eliges la ubicación local que verá el teléfono. Son dos rutas locales para la misma carpeta compartida y no tienen que coincidir.

En caballocci, pulsa **Elegir raíz compartida** en el editor o **Elegir carpeta raíz** en Acerca de / Actualizaciones; ambas opciones configuran la misma raíz. Selecciona una carpeta existente o crea una desde el selector. Esa acción configura la raíz en el PC: no crea carpetas de publicación. Comparte esa raíz en Syncthing y elige la ubicación correspondiente al aceptar en Android. No crees manualmente las subcarpetas que aparecen abajo: caballocci y la app Android las crean cuando se necesitan.

```text
<raíz compartida>/
  pc-outbox/
    catalog.json
    publications/
      <lote-espacio-orden-titulo[-listo]-fecha>/
        manifest.json
        caption.txt
        01.png
        ...
  android-inbox/
    <deviceId>/
      <eventId>.json
```

La exportación reutiliza el formato y la rutina existente por publicación para los medios. `catalog.json` es el índice global versionado; contiene referencias relativas a `caption.txt` y a los medios existentes, no duplica los archivos ni depende de un manifest anterior en una carpeta arbitraria. Se publica mediante un archivo temporal y renombrado al finalizar, de modo que Android no lee un catálogo parcialmente escrito.

## Envíos individuales, por selección y globales

Las opciones **Editor → Enviar álbumes al celular**, **Tablero → Enviar selección al celular** y **Acerca de / Actualizaciones → Exportar todas las publicaciones** usan la misma raíz y el mismo exportador. Las tres actualizan `pc-outbox/catalog.json` y crean los álbumes bajo `pc-outbox/publications/`, con medios ordenados según la secuencia visual, `caption.txt` y `manifest.json`. La app Android consume el catálogo común.

El editor envía solo la publicación abierta; el tablero envía las publicaciones seleccionadas en una tanda; la opción global intenta enviar todas las publicaciones no archivadas que tienen medios y al menos un destino cuyo estado no es `published` ni `not_applicable`. Los elementos que no se exporten se reportan con su motivo. Si una publicación seleccionada se omite, sus entradas anteriores válidas permanecen en el catálogo.

Cada tanda recibe una letra secuencial (`a`…`z`, `aa`, `ab`…). El nombre de carpeta sigue el formato `<lote>-<espacio>-<orden>-<titulo>[-listo]-<fecha>`; por ejemplo, `b-marketing-4-lanzamiento-de-otono-2026-10-24_1700`. El código de espacio es un acortamiento legible del espacio al que pertenece la publicación. El ordinal es consecutivo por espacio y sigue avanzando entre tandas: no representa la posición dentro de la tanda. Cuando se importa una confirmación de uso de un destino, la carpeta correspondiente recibe el indicador `listo` antes de la fecha y el catálogo actualiza sus rutas. `listo` significa que alguien marcó al menos un destino como usado; no confirma que se haya publicado en redes. La app Android verá esos cambios cuando Syncthing los replique.

No necesitas crear dos carpetas compartidas: las dos pantallas de escritorio configuran la misma raíz. En Android selecciona la raíz compartida que contiene `pc-outbox/`, no el álbum ni la subcarpeta `pc-outbox/`.

El lector Android admite texto/snapshot de hasta 16 MB e imágenes de hasta 32 MB cada una. El exportador de medios puede dejar transitoriamente carpetas de preparación `.caballocci-export-*` y el snapshot puede dejar `catalog-*.tmp` si el proceso se interrumpe; ninguno se referencia en `catalog.json`, y el importador solo procesa archivos `.json` terminados.

Flujo completo (inicio, transferencia y cierre):

1. **Inicio · prepara la carpeta raíz.** Instala Syncthing en el PC desde su web oficial y Syncthing-Fork en Android desde Play Store. En el PC, abre la interfaz web —por defecto `http://127.0.0.1:8384`, accesible solo desde ese PC— con el botón **Guardar y abrir Syncthing** en caballocci. Syncthing debe estar ejecutándose.
2. **Elige, comparte y configura la raíz.** Crea o elige una sola carpeta dedicada en el PC, por ejemplo `C:\Users\<usuario>\Syncthing\Caballocci-Sync`, y compártela con el teléfono desde Syncthing. En Syncthing-Fork, acepta la carpeta y asígnale una ubicación local, por ejemplo `/storage/emulated/0/Pictures/Caballocci`. Configura esta carpeta como **Enviar y recibir** en ambos dispositivos. El PC enviará publicaciones y el teléfono devolverá confirmaciones. No uses **Solo enviar** ni **Solo recibir** para esta carpeta.
3. **Indica la raíz a las apps.** En el editor o en **Acerca de / Actualizaciones → App Android de caballocci**, elige la raíz local del PC. En la app Android, selecciona la carpeta sincronizada equivalente, no las subcarpetas `pc-outbox/` ni `android-inbox/`.
4. **Transferencia · prepara y recibe.** Envía una publicación desde el editor, una selección desde el tablero o todas desde Acerca de / Actualizaciones. La app de escritorio crea `pc-outbox/` dentro de la raíz, con el catálogo y los medios. Syncthing la replica en Android y la app muestra las publicaciones por destino.
5. **Cierre · devuelve e importa.** En Android, toca **Marcar como usada**. La app Android crea `android-inbox/<deviceId>/` dentro de la misma raíz y guarda allí cada confirmación. Syncthing la replica al PC; cuando llegue, pulsa **Importar confirmaciones**. Los eventos pendientes se reintentan al abrir la app o con **Reintentar eventos**.

La importación se inicia explícitamente desde Electron; Syncthing no ejecuta código. Los archivos válidos se conservan en la carpeta compartida y volver a importarlos es seguro. Los duplicados se reconocen por `eventId`. JSON inválido, eventos incompletos, identificadores desconocidos o eventos en una carpeta de dispositivo incorrecta se reportan y no se aplican.

Las carpetas son áreas de escritura por convención: el PC solo genera contenido bajo `pc-outbox/` y cada teléfono escribe en su propia subcarpeta dentro de `android-inbox/`. Syncthing no impone permisos por subdirectorio; no se debe modificar el mismo archivo desde varios dispositivos. No se comparte `caballocci.sqlite`.

## Contrato v1

El archivo `pc-outbox/catalog.json` contiene:

```json
{
  "schema": "caballocci.mobile-sync.catalog",
  "version": 1,
  "generatedAt": "2026-10-24T05:30:00.000Z",
  "publications": [
    {
      "postId": "id-estable-de-la-publicacion",
      "targetId": "instagram",
      "targetName": "Instagram",
      "manifestPath": "pc-outbox/publications/carpeta/manifest.json",
      "captionPath": "pc-outbox/publications/carpeta/caption.txt",
      "scheduledAt": null,
      "used": false
    }
  ]
}
```

Cada confirmación es un archivo JSON independiente:

```json
{
  "schema": "caballocci.mobile-sync.usage",
  "version": 1,
  "eventId": "UUID",
  "postId": "id-estable-de-la-publicacion",
  "targetId": "instagram",
  "action": "used",
  "usedAt": "2026-10-24T05:30:00.000Z",
  "deviceId": "UUID-persistente-del-dispositivo"
}
```

El título y la lista ordenada de archivos se leen del manifest de medios existente, evitando duplicarlos en el snapshot. La fecha debe ser ISO 8601 en UTC (`Z`). El nombre del archivo es `<eventId>.json`, y el directorio debe coincidir con `deviceId`. El PC rechaza versiones/esquemas desconocidos y rutas no válidas. `targetId` identifica el destino actual de esa publicación.

## Instalar y ejecutar Android

Requisitos: Node.js 22+, JDK compatible con el Android Gradle Plugin del proyecto, Android SDK/Android Studio y un dispositivo o emulador Android. El acceso real a la carpeta depende también del proveedor de documentos usado por Syncthing.

Para instalar la app en un teléfono sin compilarla, descarga **Descargar APK** desde **Acerca de / Actualizaciones → App Android de caballocci**, abre el archivo descargado y confirma la instalación de Android. Si el sistema lo pide, permite temporalmente instalar apps desde la fuente que abrió el APK. Después abre la app y selecciona la raíz compartida de Syncthing. El APK oficial se adjunta a las Releases de caballocci.

Desde PowerShell:

```powershell
Set-Location companion-apps\mobile-sync
npm.cmd ci
npm.cmd run build
npx.cmd cap sync android
npx.cmd cap open android
```

Desde Android Studio, compilar e instalar la configuración de depuración. Para el desarrollo web aislado se puede usar `npm.cmd run dev`, pero el selector de carpetas y el acceso persistente solo funcionan en la app nativa Android.

El plugin nativo usa `ACTION_OPEN_DOCUMENT_TREE` y conserva el permiso de lectura/escritura con `takePersistableUriPermission`. Revalida el acceso cada vez que lee o escribe. Si Android, Syncthing o el proveedor revocan el permiso, la operación falla explícitamente; vuelve a seleccionar la carpeta. No se solicitan permisos amplios de almacenamiento. Los eventos locales se escriben en un archivo temporal privado, se sincronizan al disco y se renombran antes de mostrarse como guardados.

## Preguntas frecuentes de Syncthing

**¿La ruta `/storage/emulated/0/Pictures/Caballocci` sirve?** Sí, es un ejemplo válido de ubicación local para la raíz compartida en Android. Lo importante es configurar la carpeta como **Enviar y recibir** tanto en PC como en Android. Si esa carpeta está actualmente en Solo recibir para otro uso, crea una nueva raíz para la app o cambia el modo en ambos dispositivos.

**¿Qué carpeta elijo en el PC?** Cualquier carpeta local dedicada, estable y con espacio para los medios. Por ejemplo `C:\Users\<usuario>\Syncthing\Caballocci-Sync`. Evita rutas temporales, unidades extraíbles que desconectes, carpetas de instalación de caballocci y carpetas compartidas por servicios de nube que puedan causar conflictos.

**¿Debo crear `pc-outbox` y `android-inbox`?** No. Tú eliges o creas y compartes una sola carpeta raíz. caballocci crea `pc-outbox/` al exportar; la app Android crea `android-inbox/<deviceId>/` al guardar la primera confirmación.

**¿Qué URL abro en el PC?** La interfaz web de Syncthing suele estar en `http://127.0.0.1:8384`. Esa dirección es local al PC; no la uses como dirección para conectarte desde Android. Si configuraste otro host o puerto, guarda la URL completa en el campo de **Acerca de / Actualizaciones → App Android de caballocci**. El botón solo abre la interfaz en el navegador: Syncthing debe estar instalado y ejecutándose.

**¿Qué modo debo elegir?** Para la única carpeta raíz de la app Android, **Enviar y recibir en ambos dispositivos**. El PC manda publicaciones y Android devuelve confirmaciones. **Solo enviar** o **Solo recibir** es incorrecto para esta carpeta porque bloquea el retorno de las confirmaciones.

La escritura local correcta no implica que Syncthing ya haya terminado de sincronizar. Si el teléfono está desconectado, el evento permanece en su cola hasta poder escribirlo y Syncthing lo transferirá cuando haya conexión local. La importación de escritorio puede repetirse después.

## Recuperación y errores

- **Permiso perdido o carpeta movida:** vuelve a elegir la raíz en Android y recarga el snapshot.
- **Escritura Android fallida:** el evento persiste en el almacenamiento de la app; usa **Reintentar eventos** cuando el permiso/carpeta vuelva a estar disponible.
- **Sin snapshot:** exporta desde el PC y espera la sincronización; actualiza el catálogo en Android.
- **Importación repetida:** los `eventId` ya registrados se cuentan como duplicados, sin insertar otra fila.
- **Publicación o destino borrado/cambiado:** el evento se muestra como desconocido y no modifica el workspace. Revisa el evento y la publicación antes de corregirlo.
- **JSON incompleto o temporal:** los `.tmp` no se importan. Los JSON incompletos se reportan y permanecen disponibles para diagnóstico; no se importan parcialmente.
- **Cierre durante escritura:** el evento local queda pendiente; el Android escribe primero a un nombre temporal en la carpeta sincronizada y lo renombra a `.json` al terminar. Los archivos temporales no se importan.
- **Conflictos Syncthing:** no uses nombres de eventos compartidos. Los UUID y carpetas por dispositivo evitan que dos teléfonos escriban sobre el mismo archivo.

## Estado y limitaciones

La implementación crea el snapshot, los eventos versionados, la persistencia local, la interfaz mínima Capacitor, el puente SAF, la importación idempotente y pruebas unitarias del contrato e importador. La app móvil carga las referencias multimedia como imágenes; los videos se exportan y quedan en el contrato, pero no se muestran en la primera interfaz.

**La integración no se considera validada en Android hasta probar en un dispositivo real:** seleccionar el proveedor/carpeta de Syncthing, cerrar y reiniciar la app, comprobar el permiso persistente, confirmar con la red desconectada, reintentar, observar el evento sincronizado en la PC e importarlo desde Electron. El entorno de desarrollo del repositorio no tiene JDK ni `adb`, así que esa comprobación física no puede ejecutarse aquí.
