---
name: pdf_reader
version: 1.0.0
description: "Lettura del testo contenuto in file PDF con supporto a intervalli di pagine"
tools:
  - name: pdf.readFile
    description: "Legge il testo di un file PDF e lo restituisce come testo semplice. Supporta PDF con testo selezionabile (non PDF da scansione)."
    input:
      type: object
      properties:
        path:     { type: string, description: "Percorso del file PDF (es: /app/workspace/documento.pdf oppure solo 'documento.pdf')" }
        pages:    { type: string, description: "Intervallo di pagine da leggere (es: '1', '1-5', '3-10'). Se omesso, legge tutto il documento." }
        maxChars: { type: number, description: "Numero massimo di caratteri da restituire (default: 20000)", default: 20000 }
      required: [path]
---

# Regole d'uso
- Usa `pdf.readFile` per leggere PDF ricevuti dall'utente (tramite filesystem) o scaricati da Drive con `gdrive.downloadFile`.
- Per documenti molto lunghi, usa `pages` per leggere solo le sezioni rilevanti (es. `'1-10'` per le prime 10 pagine).
- Se il testo è troncato (`truncated: true`), informa l'utente e offri di leggere pagine specifiche.
- Questo tool funziona solo su PDF con testo selezionabile. Per PDF da scansione (immagini) il testo estratto sarà vuoto o incompleto.
- I file PDF dell'utente devono trovarsi in `/app/workspace/` per essere accessibili all'agente.
