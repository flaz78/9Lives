---
name: browser_automation_playwright
description: "Automazione web con Playwright/Chromium reale, ottimizzata per Docker Linux ARM64 (Raspberry Pi)."
tools:
  - name: browser.navigate
    description: "Naviga un URL con browser reale Playwright."
  - name: browser.screenshot
    description: "Cattura screenshot della pagina corrente."
---

# Quando usare questa skill
Usa questa skill quando serve rendering JavaScript reale (SPA, login dinamici, contenuti caricati client-side) e il browser Playwright e' esplicitamente abilitato.

# Prerequisiti Raspberry ARM64
- Container/build su architettura `linux/arm64`.
- Chromium di sistema installato nel container.
- Variabili ambiente gateway:
  - `PLAYWRIGHT_ENABLED=true`
  - `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`
- Se il gateway torna `exit 132`, disabilita subito questa skill operativa e torna alla skill fallback (`browser_automation`).

# Workflow operativo
1. Esegui `browser.navigate` con `wait_until: networkidle`.
2. Se timeout, riprova con `wait_until: domcontentloaded`.
3. Usa `browser.screenshot` solo quando richiesto o per debug visivo.

# Gestione errori
- Se compare errore browser (launch crash, missing deps, illegal instruction), interrompi la catena Playwright e segnala: "Playwright non disponibile su questo runtime ARM64".
- Proponi fallback operativo con `browser.extractText` (skill `browser_automation`).

# Output
- Restituisci sempre: URL finale, titolo pagina, estratto contenuto.
- Indica chiaramente se il risultato arriva da browser reale Playwright.
