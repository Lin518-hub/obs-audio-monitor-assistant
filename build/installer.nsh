!macro customUnInstall
  Delete "$SMSTARTUP\OBS 音频检测助手.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OBS 音频检测助手"
!macroend
