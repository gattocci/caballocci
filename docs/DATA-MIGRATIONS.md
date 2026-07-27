# Datos, backups y migraciones

## Garantías de conservación

El instalador es por usuario y no elimina `userData` al desinstalar. La base SQLite, la carpeta `Media` y `Backups` no forman parte del directorio de instalación, por lo que una actualización NSIS no las reemplaza.

La compatibilidad histórica busca `content-planner.sqlite` en las ubicaciones conocidas. Si `caballocci.sqlite` todavía no existe, copia la base antigua al nombre nuevo. Nunca mueve ni elimina el archivo de origen.

## Migraciones numeradas

Las migraciones viven en el arreglo `migrations` de `electron/database.ts` y usan `PRAGMA user_version` como versión del esquema. Deben ser contiguas, inmutables y crecientes.

Para modificar el esquema:

1. Añade una entrada con el siguiente número y un nombre descriptivo.
2. Escribe SQL compatible con SQLite/sql.js. No recrees ni borres la base.
3. Prefiere cambios aditivos. Si necesitas reconstruir una tabla, copia explícitamente todas las columnas/datos dentro de la misma migración.
4. No edites una migración ya publicada. Añade otra que corrija el resultado.
5. Prueba una base nueva, una base de la versión anterior y una base existente vacía.

Cada migración se ejecuta dentro de `BEGIN TRANSACTION` y `COMMIT`. Un error ejecuta `ROLLBACK` y evita persistir el estado parcial. Antes de la primera migración pendiente sobre una base existente se copia el archivo original a `Backups` con fecha y sufijo `before-migration`.

## Backups

Los nombres usan UTC ISO seguro para Windows:

```text
caballocci-2026-07-27T20-10-00-000Z-before-migration.sqlite
caballocci-2026-07-27T20-10-00-000Z-before-update.sqlite
caballocci-2026-07-27T20-10-00-000Z-manual.sqlite
```

Se crea un backup:

- antes de aplicar migraciones pendientes a una base existente;
- justo antes de reiniciar para instalar una actualización descargada;
- cuando el usuario selecciona Crear backup ahora.

La escritura normal exporta primero a `caballocci.sqlite.tmp` y después reemplaza el archivo final, reduciendo el riesgo de dejar una base parcialmente escrita. Los backups no incluyen archivos externos referenciados; sí se conserva su ruta en SQLite. Los archivos copiados a `Media` permanecen en el workspace y no son alterados por migraciones ni actualizaciones.
