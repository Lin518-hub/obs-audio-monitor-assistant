!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var StartOnBootCheckbox
Var StartOnBootState

!macro customPageAfterChangeDir
  Page custom StartOnBootPageCreate StartOnBootPageLeave
!macroend

Function StartOnBootPageCreate
  nsDialogs::Create 1018
  Pop $0

  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 18u "启动选项"
  Pop $1
  ${NSD_CreateLabel} 0 22u 100% 28u "可以让 OBS 音频检测助手在开机后自动进入后台运行。"
  Pop $2
  ${NSD_CreateCheckbox} 0 58u 100% 14u "开机自动启动 OBS 音频检测助手"
  Pop $StartOnBootCheckbox
  ${NSD_SetState} $StartOnBootCheckbox ${BST_UNCHECKED}

  nsDialogs::Show
FunctionEnd

Function StartOnBootPageLeave
  ${NSD_GetState} $StartOnBootCheckbox $StartOnBootState
FunctionEnd

!macro customInstall
  ${If} $StartOnBootState == ${BST_CHECKED}
    CreateShortCut "$SMSTARTUP\OBS 音频检测助手.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--hidden"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OBS 音频检测助手" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hidden'
  ${Else}
    Delete "$SMSTARTUP\OBS 音频检测助手.lnk"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OBS 音频检测助手"
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  Delete "$SMSTARTUP\OBS 音频检测助手.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OBS 音频检测助手"
!macroend
