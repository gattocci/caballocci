# caballocci

Aplicacion de escritorio offline-first para planificar contenido de Instagram, Facebook y X. El MVP usa Electron, React, TypeScript y una base SQLite local basada en sql.js.

## Incluido en este MVP

- Linea de tiempo horizontal de 14 dias con arrastrar y soltar.
- Calendario mensual con reprogramacion mediante arrastre.
- Tablero Kanban para mover publicaciones entre estados.
- Editor con formato, plataformas, texto, hashtags, fecha, proyecto, notas y archivos.
- Vista previa local por plataforma y copia del texto al portapapeles.
- Biblioteca multimedia local en modo copia o referencia al archivo original.
- Historial persistente de cambios de estado.
- Datos de ejemplo en el primer arranque.

Los datos se guardan en el directorio userData de Electron. No se requiere cuenta, conexion social ni acceso a Internet una vez instalada la aplicacion.

## Desarrollo en Windows

Requisitos: Node.js 22 o posterior.

    npm.cmd install
    npm.cmd run dev

## Compilar

    npm.cmd run build

Para generar el instalador NSIS de Windows:

    npm.cmd run dist:win

## Arquitectura

- electron/main.ts: ventana nativa, dialogos de archivos, portapapeles e IPC.
- electron/database.ts: persistencia local y esquema de datos.
- electron/preload.ts: API minima expuesta de forma segura a React.
- src/store.ts: estado y operaciones del dominio.
- src/views.tsx: timeline, calendario, Kanban y biblioteca.
- src/Editor.tsx: editor, adjuntos, preview y publicacion manual.

La separacion entre interfaz, dominio, almacenamiento e IPC permite incorporar despues perfiles reales, autenticacion opcional, proveedores de IA e integraciones sociales sin acoplarlos al flujo offline.
