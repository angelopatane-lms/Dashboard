@echo off
REM Controllo quotidiano dei numeri della Dashboard.
REM Lo lancia l'Utilita' di pianificazione di Windows alle 07:30.
REM Manda un messaggio su Slack solo se trova qualcosa; altrimenti tace.
REM Il registro di cosa ha fatto resta in %LOCALAPPDATA%\controllo-numeri.log

cd /d "C:\Users\Angelo\Desktop\Windserf\Dashboard\dashboard-app"
echo. >> "%LOCALAPPDATA%\controllo-numeri.log"
echo === %DATE% %TIME% === >> "%LOCALAPPDATA%\controllo-numeri.log"
call npx tsx scripts/controllo-numeri.ts >> "%LOCALAPPDATA%\controllo-numeri.log" 2>&1
