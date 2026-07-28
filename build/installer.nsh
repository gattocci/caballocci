!include MUI2.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER

Var DesktopShortcutCheckbox
Var DesktopShortcutChoice

!macro customInit
  StrCpy $DesktopShortcutChoice ${BST_CHECKED}
  ${if} ${isUpdated}
    SetSilent silent
  ${endif}
!macroend

!macro customPageAfterChangeDir
  Page custom DesktopShortcutPage DesktopShortcutPageLeave
!macroend

Function DesktopShortcutPage
  IfSilent 0 +2
    Abort

  !insertmacro MUI_HEADER_TEXT "Accesos directos" "Elige cómo abrir caballocci"
  nsDialogs::Create 1018
  Pop $0
  ${if} $0 == error
    Abort
  ${endif}

  ${NSD_CreateLabel} 0 4u 100% 24u "Puedes abrir caballocci desde el menú Inicio y, opcionalmente, desde el escritorio."
  Pop $0
  ${NSD_CreateCheckbox} 0 38u 100% 14u "Crear un acceso directo en el escritorio"
  Pop $DesktopShortcutCheckbox
  ${NSD_SetState} $DesktopShortcutCheckbox $DesktopShortcutChoice

  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutChoice
FunctionEnd

!macro customInstall
  ${if} $DesktopShortcutChoice != ${BST_CHECKED}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endif}
!macroend

!endif
