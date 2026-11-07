!macro NSIS_HOOK_POSTUNINSTALL
  ; Tauri clears AppData itself; TrayClip also stores data beside the executable.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\data"
    ; Only remove the install directory if nothing else remains.
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
