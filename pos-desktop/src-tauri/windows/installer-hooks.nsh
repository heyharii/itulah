; Central POS / Central Gudang installer hooks (Tauri NSIS).
;
; The ZKTeco fingerprint driver goes in with the app (Hari, 30 Oct 2026): on
; DESKTOP-6Q3F7V9 the Live20R showed "Error" in Device Manager and the door
; never answered a finger until ZKFinger-setup.exe was run by hand. Only when
; libzkfp.dll is not there yet; Windows asks for an administrator's yes once.
; Sysnative: this installer is 32-bit, and System32 would be redirected.
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$WINDIR\Sysnative\libzkfp.dll" zk_done 0
  IfFileExists "$INSTDIR\fingerprint-native\ZKFinger-setup.exe" 0 zk_done
    ExecShellWait "runas" "$INSTDIR\fingerprint-native\ZKFinger-setup.exe" "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-" SW_HIDE
  zk_done:
!macroend
