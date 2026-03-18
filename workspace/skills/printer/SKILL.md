---
name: printer
description: "Stampa file locali sulla stampante predefinita. Usa questa skill quando l'utente chiede di stampare un documento (PDF, TXT, DOCX, immagini) già presente nella workspace."
tools:
  - name: print.default
    description: "Invia un file alla stampante predefinita"
    input:
      type: object
      properties:
        filePath:
          type: string
          description: "Percorso file relativo alla workspace (es: storage/output/report.pdf)"
        copies:
          type: integer
          description: "Numero copie (opzionale, default 1)"
        printer:
          type: string
          description: "Nome stampante opzionale (solo Linux/CUPS)"
      required: [filePath]
---

# Regole d'uso
- Verifica sempre che `filePath` sia un file esistente nella workspace.
- Chiedi conferma prima di inviare la stampa se l'utente non ha specificato numero copie.
- Usa `copies` solo se richiesto dall'utente.
- Usa `printer` solo se l'utente indica una stampante specifica (su Linux/CUPS).
- Se `printer` non e' valorizzato, il tool usa prima la stampante configurata nel connector (`printer.default_name`) e poi la default di sistema.
- Se il sistema non ha un backend di stampa disponibile, segnala chiaramente l'errore e proponi alternative.
