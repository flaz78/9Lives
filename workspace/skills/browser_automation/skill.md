---
name: browser_automation
description: "Automazione web compatibile Raspberry ARM64 con fallback: browser reale quando disponibile, altrimenti estrazione testo HTTP."
tools:
  - name: browser.navigate
    description: "Naviga una pagina con browser reale (JS dinamico)."
  - name: browser.screenshot
    description: "Salva screenshot della pagina corrente."
  - name: browser.extractText
    description: "Estrae testo via HTTP senza browser (fallback ARM64-safe)."
---

# Quando usare questa skill
Usa questa skill quando serve leggere contenuto web con possibile JavaScript dinamico, ma con compatibilita robusta su Raspberry ARM64.

# Workflow operativo
1. Prova prima `browser.navigate` con `wait_until: networkidle`.
2. Se `browser.navigate` fallisce per browser non disponibile (es. Playwright disabilitato, chromium non avviabile, errori tipo "Illegal instruction"), passa subito a `browser.extractText`.
3. Usa `browser.screenshot` solo se l'utente lo chiede esplicitamente o se serve prova visiva.

# Regole ARM64
- Non assumere che il browser reale sia sempre disponibile su Raspberry.
- In ambiente Docker ARM64 la configurazione stabile e' `PLAYWRIGHT_ENABLED=false`.
- Se l'utente richiede esplicitamente browser reale, indicare che va abilitato `PLAYWRIGHT_ENABLED=true` e usare Chromium di sistema.

# Output atteso
- Restituisci sempre URL finale e titolo (se disponibile).
- Se sei andato in fallback HTTP, dichiaralo chiaramente in una riga: "Modalita fallback senza browser reale".
- Mantieni il contenuto estratto sintetico quando supera limiti pratici.
