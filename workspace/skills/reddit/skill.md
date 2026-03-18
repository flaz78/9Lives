---
name: reddit
version: 0.1.0
description: "Ricerche su Reddit per trovare discussioni e post"
tools:
  - name: reddit.search
    description: "Esegue una ricerca su Reddit e restituisce i post principali (titolo, subreddit, link, testo)"
    input:
      type: object
      properties:
        query: { type: string, description: "La query di ricerca" }
        sort: { type: string, description: "Ordinamento dei risultati", enum: [relevance, hot, top, new, comments], default: relevance }
        limit: { type: number, description: "Numero massimo di risultati (max 25)", default: 10 }
      required: [query]
---

# Regole d’uso
- Fornisci riassunti dei post trovati se richiesto.
- Specifica sempre il subreddit di provenienza.
- Se un post contiene molto testo, sintetizzalo per l'utente.
