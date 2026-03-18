---
name: search
version: 0.1.0
description: "Ricerche web tramite DuckDuckGo"
tools:
  - name: search.duckduckgo
    description: "Esegue una ricerca su DuckDuckGo e restituisce i risultati principali"
    input:
      type: object
      properties:
        query: { type: string, description: "La query di ricerca (es: 'meteo Milano')" }
      required: [query]
---

# Regole d’uso
- Fornisci risposte basate sui risultati della ricerca.
- Cita le fonti se possibile.
- Se la ricerca non produce risultati utili, prova a variare la query.
