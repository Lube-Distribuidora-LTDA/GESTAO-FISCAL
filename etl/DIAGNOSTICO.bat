@echo off
rem ===========================================================================
rem  DIAGNOSTICO - Gestao Fiscal
rem  Roda todas as consultas contra o WinThor SEM GRAVAR NADA, mede o tempo e
rem  confere a 1147 contra o PCMOV, mes a mes. Resultado na tela e em
rem  diagnostico_fiscal.log (na pasta "2 - SISTEMA FISCAL").
rem ===========================================================================
setlocal
cd /d "%~dp0"
title Gestao Fiscal - diagnostico
python "2 - SISTEMA FISCAL\diagnostico_fiscal.py"
echo.
pause
endlocal
