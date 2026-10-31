' Startet eine .bat-Datei ohne sichtbares Konsolenfenster.
' Fuer geplante Aufgaben: Programm "wscript.exe", Argument "<Pfad>\run_hidden.vbs" "<Pfad>\lauf_berichte.bat"
If WScript.Arguments.Count < 1 Then WScript.Quit 1
Set sh = CreateObject("WScript.Shell")
sh.Run """" & WScript.Arguments(0) & """", 0, False
