# Identidad visual e instalador

## Dónde cambiar el icono

La fuente editable del símbolo está en **build/icon-source.svg**. Los archivos consumidos por Electron y NSIS se regeneran con:

~~~powershell
npm.cmd run brand:assets
~~~

El comando produce:

- **build/icon.png**: icono del ejecutable y accesos directos de Windows.
- **public/caballocci-icon.png**: favicon del renderer.
- **build/installerSidebar.bmp**: panel de bienvenida y final del instalador.
- **build/uninstallerSidebar.bmp**: panel del desinstalador.
- **build/installerHeader.bmp**: cabecera de las páginas intermedias.

El generador está en **scripts/generate-brand-assets.ps1**. Si cambia la geometría del símbolo, actualiza tanto el SVG como la función Draw-Mark del generador y vuelve a ejecutar el comando. Después revisa visualmente todos los PNG/BMP y genera un instalador de prueba.

package.json conecta estos recursos mediante build.win.icon y build.nsis. Electron Builder convierte el PNG principal al formato necesario para Windows; ese icono aparece en la ventana, escritorio, menú Inicio, ejecutable, instalador y desinstalador.

## Instalador inicial y actualizaciones

La instalación inicial usa el asistente NSIS porque permite elegir la carpeta de instalación. Está configurado en español y muestra la identidad de caballocci. NSIS sigue siendo una interfaz nativa de Windows y no admite una personalización comparable con HTML/CSS.

Las actualizaciones son distintas: el usuario las busca, descarga y confirma dentro de caballocci. Después de la confirmación se crea un backup, la aplicación se cierra, NSIS se ejecuta en modo silencioso y caballocci vuelve a abrirse. El asistente completo no debe mostrarse durante una actualización normal. **build/installer.nsh** refuerza este comportamiento cuando el instalador recibe el indicador de actualización, incluso si fue iniciado por una versión anterior del updater.

Alternativas futuras para una instalación completamente personalizada incluyen WiX Burn, Advanced Installer o un bootstrapper propio. Cambiar de tecnología aumenta el mantenimiento y debe verificarse con electron-updater, instalación por usuario, desinstalación y actualizaciones diferenciales.

## Binarios y Releases

No añadas instaladores EXE, archivos blockmap ni latest.yml al repositorio Git. Son artefactos generados y harían crecer permanentemente el historial. **release/** permanece en .gitignore.

GitHub Releases es la superficie de descarga para usuarios. Cada Release conserva su instalador para auditoría y recuperación, mientras que **/releases/latest** dirige a la versión estable más reciente. electron-updater utiliza latest.yml de esa Release.

Las Releases antiguas pueden conservarse: no afectan la actualización normal y aportan trazabilidad. Si una versión es defectuosa, crea una versión PATCH nueva; no sustituyas silenciosamente sus binarios ni reutilices un tag.
