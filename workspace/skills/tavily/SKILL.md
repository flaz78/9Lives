---
name: tavily
version: 0.1.0
description: "Ricerca web AI-powered tramite Tavily Search API. Restituisce risultati pertinenti con contenuto estratto e risposta sintetica. Preferibile a DuckDuckGo per ricerche che richiedono fonti autorevoli, contenuto approfondito o analisi recente."
tools:
  - name: tavily.search
    description: "Esegue una ricerca web AI-powered tramite Tavily. Restituisce risultati con titoli, URL, contenuto estratto e risposta sintetica opzionale"
    input:
      type: object
      properties:
        query: { type: string, description: "La query di ricerca" }
        search_depth: { type: string, description: "'basic' (veloce, default) o 'advanced' (più approfondita)" }
        max_results: { type: number, description: "Numero massimo di risultati (1-10, default 5)" }
        include_answer: { type: boolean, description: "Se true, include una risposta sintetica AI (default true)" }
        include_domains: { type: array, items: { type: string }, description: "Domini da includere (es: ['wikipedia.org'])" }
        exclude_domains: { type: array, items: { type: string }, description: "Domini da escludere" }
      required: [query]
  - name: tavily.extract
    description: "Estrae il contenuto testuale da uno o più URL tramite Tavily. Utile per leggere articoli o documentazione trovati in precedenza"
    input:
      type: object
      properties:
        urls: { type: array, items: { type: string }, description: "Lista di URL da cui estrarre il contenuto (max 5)" }
      required: [urls]
---

# Regole d'uso
- Usa `tavily.search` per ricerche web generali: notizie, fatti, ricerche approfondite, informazioni recenti.
- Preferisci `search_depth: advanced` quando la ricerca richiede fonti autorevoli o analisi dettagliata.
- Usa `include_answer: true` (default) per ottenere una risposta sintetica AI oltre ai link.
- Usa `tavily.extract` per leggere il contenuto completo di URL specifici trovati in precedenza.
- Cita sempre le fonti (titolo + URL) nei tuoi output quando usi i risultati di Tavily.
- Se la ricerca non produce risultati sufficienti, prova a riformulare la query o aumenta `max_results`.
- Per argomenti molto specifici, usa `include_domains` per restringere la ricerca a fonti autorevoli.
