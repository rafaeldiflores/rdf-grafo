@echo off
cd /d "%~dp0"
echo Panel de ingesta del grafo - iniciando...
python -m streamlit run app.py
pause
