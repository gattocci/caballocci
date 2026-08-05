# Firma de codigo de Windows

La autoria de caballocci esta configurada como **NU WAVE** en `package.json`. El nombre que Windows muestra como editor verificado lo determina el certificado de firma: su sujeto debe ser exactamente `NU WAVE`.

## No usar autofirma para Releases

Un certificado autofirmado solo es util para pruebas internas en equipos donde se instala manualmente su raiz de confianza. Para una descarga publica no crea confianza, Windows seguira indicando editor desconocido y SmartScreen seguira mostrando advertencias. No lo uses para una Release de GitHub.

## Configuracion publica

1. Compra un certificado de firma de codigo para la entidad legal **NU WAVE** en una autoridad aceptada por Windows. EV ofrece la mejor reputacion inicial de SmartScreen, aunque tambien funciona un certificado de firma de codigo estandar.
2. Exporta el certificado PFX protegido por contrasena y codificalo en Base64.
3. En GitHub, abre **Settings > Secrets and variables > Actions** y crea `WINDOWS_CERTIFICATE_BASE64` y `WINDOWS_CERTIFICATE_PASSWORD`.
4. El workflow ya entrega esos secretos a electron-builder mediante `CSC_LINK` y `CSC_KEY_PASSWORD`. No subas el PFX, la contrasena ni el Base64 a Git, incluido `testo/`.
5. Publica una Release de prueba y valida tanto instalacion nueva como actualizacion desde una instalacion anterior. Luego cambia `verifyUpdateCodeSignature` de `false` a `true` en `package.json`.

Mientras no existan esos secretos, electron-builder genera el instalador sin firma y el flujo de Release sigue funcionando. La identidad declarada no suplanta una firma: la firma real la determina el certificado.
