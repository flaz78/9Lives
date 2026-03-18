---
name: filesystem
version: 0.1.0
description: "Gestione file system locale per salvare e leggere file"
tools:
  - name: filesystem.saveFile
    description: "Salva il contenuto in un file in una sottocartella specifica"
    input:
      type: object
      properties:
        subDir: { type: string, description: "Sottocartella (es: 'output' o 'logs')" }
        fileName: { type: string, description: "Nome del file (es: 'report.txt')" }
        content: { type: string, description: "Contenuto testuale da salvare" }
      required: [subDir, fileName, content]
  - name: filesystem.list
    description: "Elenca i file e le cartelle presenti in una specifica sottocartella dello storage"
    input:
      type: object
      properties:
        subDir: { type: string, description: "Sottocartella da elencare (es: 'output', 'logs' o '.' per la root)", default: "." }
  - name: filesystem.renameFile
    description: "Rinomina o sposta un file esistente all'interno dello storage"
    input:
      type: object
      properties:
        subDir: { type: string, description: "Sottocartella in cui si trova il file (es: 'output')" }
        oldName: { type: string, description: "Nome attuale del file" }
        newName: { type: string, description: "Nuovo nome del file" }
      required: [subDir, oldName, newName]
  - name: filesystem.deleteFile
    description: "Elimina un file esistente dallo storage"
    input:
      type: object
      properties:
        subDir: { type: string, description: "Sottocartella in cui si trova il file" }
        fileName: { type: string, description: "Nome del file da eliminare" }
      required: [subDir, fileName]
---

# Regole d’uso
- Usa nomi di file descrittivi.
- Assicurati che il contenuto sia formattato correttamente prima di salvare.
- Non sovrascrivere file critici se non esplicitamente richiesto.
