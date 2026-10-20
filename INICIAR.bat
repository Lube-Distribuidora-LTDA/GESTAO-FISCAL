@echo off
rem Abre o painel GESTAO FISCAL nesta maquina (http://localhost:3103),
rem lendo o DATA WAREHOUSE com o ENV de etl (ou C:\BI\FISCAL\ENV). So esta maquina acessa.
cd /d "%~dp0web"
if not exist node_modules call npm install --no-audit --no-fund
start "" http://localhost:3103
node servidor_local.js
pause
