---
name: google_drive
version: 1.0.0
description: "Gestione file su Google Drive (lettura, scrittura, ricerca, upload/download) tramite OAuth 2.0"
tools:
  - name: gdrive.listFiles
    description: "Elenca file e cartelle in Google Drive"
    input:
      type: object
      properties:
        folderId:  { type: string, description: "ID della cartella (default: 'root' = radice)", default: "root" }
        pageSize:  { type: number, description: "Numero massimo di file (default: 20, max: 100)", default: 20 }
        orderBy:   { type: string, description: "Ordinamento: 'name', 'modifiedTime', 'createdTime'", default: "name" }
        trashed:   { type: boolean, description: "Se true, mostra i file nel cestino", default: false }

  - name: gdrive.getFile
    description: "Recupera i metadati di un file tramite ID"
    input:
      type: object
      properties:
        fileId: { type: string, description: "ID del file" }
      required: [fileId]

  - name: gdrive.readFile
    description: "Legge il contenuto di un file. Google Docs/Sheets/Slides vengono esportati automaticamente come testo/CSV. File binari vengono restituiti in base64."
    input:
      type: object
      properties:
        fileId:       { type: string, description: "ID del file da leggere" }
        exportFormat: { type: string, description: "Formato export per Google Docs (es: 'text/plain', 'text/csv', 'application/pdf')" }
        maxChars:     { type: number, description: "Numero massimo di caratteri per testo (default: 10000)", default: 10000 }
      required: [fileId]

  - name: gdrive.downloadFile
    description: "Scarica un file da Google Drive e lo salva sul filesystem del server"
    input:
      type: object
      properties:
        fileId:       { type: string, description: "ID del file da scaricare" }
        savePath:     { type: string, description: "Percorso dove salvare il file (es: /app/workspace/documento.pdf)" }
        exportFormat: { type: string, description: "Formato export per Google Docs (es: 'application/pdf')" }
      required: [fileId, savePath]

  - name: gdrive.searchFiles
    description: "Cerca file in Google Drive usando query Drive"
    input:
      type: object
      properties:
        query:      { type: string, description: "Query Drive (es: \"name contains 'fattura'\", \"mimeType='application/pdf'\")" }
        maxResults: { type: number, description: "Numero massimo di risultati (default: 20)", default: 20 }
        trashed:    { type: boolean, description: "Includi file nel cestino (default: false)", default: false }
      required: [query]

  - name: gdrive.createFolder
    description: "Crea una nuova cartella in Google Drive"
    input:
      type: object
      properties:
        name:     { type: string, description: "Nome della cartella" }
        parentId: { type: string, description: "ID cartella padre (default: radice)", default: "root" }
      required: [name]

  - name: gdrive.uploadFile
    description: "Carica un file su Google Drive da percorso locale o contenuto base64"
    input:
      type: object
      properties:
        name:     { type: string, description: "Nome del file su Drive (es: 'report.pdf')" }
        folderId: { type: string, description: "ID cartella di destinazione (default: radice)", default: "root" }
        path:     { type: string, description: "Percorso assoluto del file locale (alternativa a content)" }
        content:  { type: string, description: "Contenuto del file in base64 (alternativa a path)" }
        mimeType: { type: string, description: "Tipo MIME (rilevato automaticamente se omesso)" }
      required: [name]

  - name: gdrive.updateFile
    description: "Aggiorna il contenuto e/o il nome di un file esistente su Google Drive"
    input:
      type: object
      properties:
        fileId:   { type: string, description: "ID del file da aggiornare" }
        name:     { type: string, description: "Nuovo nome (opzionale)" }
        path:     { type: string, description: "Percorso file locale con il nuovo contenuto" }
        content:  { type: string, description: "Nuovo contenuto in base64" }
        mimeType: { type: string, description: "Tipo MIME del nuovo contenuto (opzionale)" }
      required: [fileId]

  - name: gdrive.deleteFile
    description: "Sposta un file nel cestino (o elimina definitivamente)"
    input:
      type: object
      properties:
        fileId:      { type: string, description: "ID del file da eliminare" }
        permanently: { type: boolean, description: "Se true, elimina senza passare dal cestino (default: false)", default: false }
      required: [fileId]

  - name: gdrive.moveFile
    description: "Sposta un file in una cartella diversa"
    input:
      type: object
      properties:
        fileId:         { type: string, description: "ID del file da spostare" }
        targetFolderId: { type: string, description: "ID della cartella di destinazione" }
      required: [fileId, targetFolderId]
---

# Regole d'uso
- Usa `gdrive.listFiles` per esplorare la struttura del Drive, partendo da `folderId='root'`.
- Per cercare file usa `gdrive.searchFiles` con query Drive (es: `name contains 'fattura'`, `mimeType='application/pdf'`, `modifiedTime > '2024-01-01'`).
- Per leggere documenti Google usa `gdrive.readFile`: vengono esportati automaticamente (Docs→testo, Sheets→CSV).
- Per file grandi (>512KB) usa `gdrive.downloadFile` per salvarli su filesystem.
- Per caricare file su Drive usa `gdrive.uploadFile` con `path` (file locale) o `content` (base64).
- `gdrive.deleteFile` sposta nel cestino per default; usa `permanently=true` solo se esplicitamente richiesto dall'utente.
- Quando l'utente chiede di salvare o esportare qualcosa, combina la generazione del file su filesystem con `gdrive.uploadFile`.
- Credenziali necessarie: `google.drive_client_id`, `google.drive_client_secret`, `google.drive_refresh_token` — configurabili in Connectors → Google Drive.
