---
name: excel_builder
version: 1.1.0
description: "Creazione e lettura di file Excel (.xlsx): fogli multipli formattati, tabelle Markdown in output"
tools:
  - name: excel.createFile
    description: "Crea un file Excel (.xlsx) con uno o più fogli, intestazioni in grassetto e righe di dati. Restituisce il percorso del file creato."
    input:
      type: object
      properties:
        path:
          type: string
          description: "Percorso assoluto dove salvare il file (es: /app/workspace/report.xlsx)"
        sheets:
          type: array
          description: "Lista dei fogli Excel da creare"
          items:
            type: object
            properties:
              name:         { type: string, description: "Nome del foglio (es: 'Vendite')" }
              headers:      { type: array, items: { type: string }, description: "Intestazioni delle colonne" }
              rows:         { type: array, items: { type: array, items: { type: string } }, description: "Righe di dati (array di array di stringhe)" }
              columnWidths: { type: array, items: { type: number }, description: "Larghezza colonne in caratteri (opzionale)" }
            required: [name, headers, rows]
      required: [path, sheets]

  - name: excel.readFile
    description: "Legge un file Excel (.xlsx) esistente e restituisce il contenuto di ogni foglio come tabella Markdown."
    input:
      type: object
      properties:
        path:       { type: string, description: "Percorso assoluto del file Excel da leggere" }
        sheetNames: { type: array, items: { type: string }, description: "Nomi dei fogli da leggere (opzionale, default: tutti)" }
        maxRows:    { type: number, description: "Numero massimo di righe per foglio (default: 500)", default: 500 }
      required: [path]
---

# Regole d'uso
- Salva sempre i file Excel in `/app/workspace/` oppure in una sua sottocartella.
- Usa estensione `.xlsx` nel percorso del file.
- Ogni valore nelle righe deve essere una stringa (anche i numeri: "123.45").
- Per file con molte colonne, specifica `columnWidths` per migliorare la leggibilità.
- Usa `excel.readFile` per leggere file esistenti ricevuti dall'utente o creati in precedenza.
- Dopo la creazione, comunica il percorso all'utente e offri di inviarlo (es. via email con `gmail.sendEmail`, o su Drive con `gdrive.uploadFile`).
- Non creare file con dati sensibili (password, codici fiscali) senza conferma esplicita dell'utente.
