---
name: image_base64
version: 0.1.0
description: "Conversione tra file immagine e stringhe base64. Usa questa skill quando l'utente chiede di trasformare un'immagine in base64, generare una data URI, oppure ricreare/salvare un'immagine partendo da una stringa base64."
tools:
  - name: image.toBase64
    description: "Legge un file immagine dallo storage e lo converte in base64"
    input:
      type: object
      properties:
        subDir: { type: string, description: "Sottocartella dello storage (es: 'images')" }
        fileName: { type: string, description: "Nome del file immagine (es: 'foto.png')" }
        includeDataUri:
          type: boolean
          description: "Se true restituisce anche la data URI completa"
          default: true
      required: [subDir, fileName]

  - name: image.fromBase64
    description: "Crea un file immagine in storage a partire da una stringa base64 o data URI"
    input:
      type: object
      properties:
        base64: { type: string, description: "Stringa base64 pura o data URI" }
        subDir: { type: string, description: "Sottocartella di destinazione nello storage" }
        fileName: { type: string, description: "Nome del file di output (es: 'output.png')" }
      required: [base64, subDir, fileName]
---

# Regole d'uso
- Usa `image.toBase64` quando serve serializzare un file immagine gia' presente nello storage.
- Usa `image.fromBase64` quando devi ricreare un file immagine da base64 o da una data URI.
- Specifica estensioni coerenti con il contenuto (`.png`, `.jpg`, `.webp`) per evitare ambiguita'.
- Questi tool lavorano sullo storage workspace del progetto, non su percorsi arbitrari esterni.
