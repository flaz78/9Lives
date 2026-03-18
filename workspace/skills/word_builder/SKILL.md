---
name: word_builder
version: 1.1.0
description: "Creazione e lettura di documenti Word (.docx): testo formattato, titoli, tabelle, elenchi, conversione in Markdown"
tools:
  - name: word.createFile
    description: "Crea un file Word (.docx) con titolo, paragrafi, intestazioni, tabelle ed elenchi. Restituisce il percorso del file creato."
    input:
      type: object
      properties:
        path:
          type: string
          description: "Percorso assoluto dove salvare il file (es: /app/workspace/documento.docx)"
        title:
          type: string
          description: "Titolo del documento (opzionale)"
        author:
          type: string
          description: "Autore del documento (opzionale)"
        content:
          type: array
          description: "Lista dei blocchi di contenuto"
          items:
            type: object
            properties:
              type:    { type: string, enum: [heading, paragraph, table, list, pageBreak], description: "Tipo di blocco" }
              level:   { type: number, enum: [1, 2, 3], description: "Livello titolo (solo per heading): 1=H1, 2=H2, 3=H3" }
              text:    { type: string, description: "Testo del blocco (per heading e paragraph)" }
              bold:    { type: boolean, description: "Grassetto (solo per paragraph)" }
              italic:  { type: boolean, description: "Corsivo (solo per paragraph)" }
              align:   { type: string, enum: [left, center, right, justify], description: "Allineamento (solo per paragraph)" }
              headers: { type: array, items: { type: string }, description: "Intestazioni colonne (solo per table)" }
              rows:    { type: array, items: { type: array, items: { type: string } }, description: "Righe dati (solo per table)" }
              items:   { type: array, items: { type: string }, description: "Elementi della lista (solo per list)" }
              ordered: { type: boolean, description: "Lista numerata=true, puntata=false (solo per list)" }
            required: [type]
      required: [path, content]

  - name: word.readFile
    description: "Legge un file Word (.docx) esistente e restituisce il contenuto convertito in formato Markdown."
    input:
      type: object
      properties:
        path:     { type: string, description: "Percorso assoluto del file Word da leggere" }
        maxChars: { type: number, description: "Numero massimo di caratteri Markdown da restituire (default: 20000)", default: 20000 }
      required: [path]
---

# Regole d'uso
- Salva sempre i file Word in `/app/workspace/` oppure in una sua sottocartella.
- Usa estensione `.docx` nel percorso del file.
- Struttura il documento con `heading` per i titoli di sezione (level 1, 2, 3) e `paragraph` per il testo.
- Usa `table` per dati tabulari, `list` per elenchi puntati o numerati, `pageBreak` per separare sezioni.
- Usa `word.readFile` per leggere file esistenti ricevuti dall'utente o creati in precedenza: restituisce Markdown.
- Se il documento è molto lungo, usa `maxChars` per limitare l'output o chiedi all'utente quali sezioni leggere.
- Ogni valore nelle righe di una tabella deve essere una stringa.
- Dopo la creazione, comunica il percorso all'utente e offri di inviarlo (es. via email con `gmail.sendEmail`, o su Drive con `gdrive.uploadFile`).
- Non creare documenti con dati sensibili (password, codici fiscali) senza conferma esplicita dell'utente.
