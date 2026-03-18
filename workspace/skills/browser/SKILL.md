---
name: browser
version: 0.1.0
description: "Estrazione di testo e contenuto da pagine web"
tools:
  - name: browser.extractText
    description: "Esegue il fetch di un URL e restituisce il contenuto testuale pulito della pagina"
    input:
      type: object
      properties:
        url: { type: string, description: "L'URL della pagina da leggere (es: 'https://example.com')" }
      required: [url]
---

# Regole d’uso
- Utilizza questa skill per leggere articoli, documentazione o post di blog.
- Restituisce il testo principale della pagina, rimuovendo script e tag HTML.
- Se l'URL non è accessibile, informa l'utente sull'errore specifico (es: 404, 403).
