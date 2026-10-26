' 静默启动 Spark Terminal（不弹黑框）
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir
result = WshShell.Run("node """ & scriptDir & "\scripts\launch.mjs"" --silent", 0, True)
If result <> 0 Then
  MsgBox "Spark Terminal could not start. See launch-error.log in the application folder.", 16, "Spark Terminal"
End If
