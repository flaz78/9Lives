---
name: gmail
version: 0.4.0
description: "Gestione Email tramite Gmail (SMTP/IMAP con App Password) con supporto allegati"
tools:
  - name: gmail.listEmails
    description: "Elenca le email recenti della casella Gmail"
    input:
      type: object
      properties:
        maxResults:  { type: number, description: "Numero massimo di email (default: 10)", default: 10 }
        labelIds:    { type: string, description: "Cartella: INBOX, '[Gmail]/Sent Mail', '[Gmail]/Trash', '[Gmail]/Spam' (default: INBOX)", default: "INBOX" }
        unreadOnly:  { type: boolean, description: "Se true, mostra solo le non lette (default: false)", default: false }

  - name: gmail.readEmail
    description: "Legge il contenuto completo di una email (testo + lista allegati con nome, tipo, dimensione)"
    input:
      type: object
      properties:
        messageId:  { type: string, description: "ID del messaggio (da listEmails o searchEmails)" }
        mailbox:    { type: string, description: "Cartella del messaggio (default: INBOX)", default: "INBOX" }
        markAsRead: { type: boolean, description: "Se true, segna come letta (default: false)", default: false }
      required: [messageId]

  - name: gmail.searchEmails
    description: "Cerca email tramite query Gmail (es: 'from:mario subject:fattura is:unread')"
    input:
      type: object
      properties:
        query:      { type: string, description: "Query di ricerca Gmail" }
        maxResults: { type: number, description: "Numero massimo di risultati (default: 10)", default: 10 }
        mailbox:    { type: string, description: "Cartella in cui cercare (default: INBOX)", default: "INBOX" }
      required: [query]

  - name: gmail.sendEmail
    description: "Invia una nuova email tramite Gmail con supporto allegati (file su server o base64)"
    input:
      type: object
      properties:
        to:      { type: string, description: "Destinatario (es: 'mario.rossi@example.com')" }
        subject: { type: string, description: "Oggetto dell'email" }
        body:    { type: string, description: "Corpo dell'email in testo semplice" }
        cc:      { type: string, description: "Destinatari in CC separati da virgola (opzionale)" }
        attachments:
          type: array
          description: "Lista allegati (opzionale)"
          items:
            type: object
            properties:
              filename:    { type: string, description: "Nome del file (es: report.pdf)" }
              path:        { type: string, description: "Percorso assoluto del file sul server (es: /app/workspace/report.pdf)" }
              content:     { type: string, description: "Contenuto del file in base64 (alternativa a path)" }
              contentType: { type: string, description: "Tipo MIME (opzionale, rilevato automaticamente)" }
            required: [filename]
      required: [to, subject, body]

  - name: gmail.replyEmail
    description: "Risponde a un messaggio nel suo thread Gmail con supporto allegati"
    input:
      type: object
      properties:
        messageId: { type: string, description: "ID del messaggio a cui rispondere (UID IMAP)" }
        body:      { type: string, description: "Testo della risposta" }
        replyAll:  { type: boolean, description: "Se true, risponde a tutti i destinatari (default: false)", default: false }
        mailbox:   { type: string, description: "Cartella del messaggio originale (default: INBOX)", default: "INBOX" }
        attachments:
          type: array
          description: "Lista allegati nella risposta (opzionale)"
          items:
            type: object
            properties:
              filename:    { type: string, description: "Nome del file" }
              path:        { type: string, description: "Percorso assoluto del file sul server" }
              content:     { type: string, description: "Contenuto in base64 (alternativa a path)" }
              contentType: { type: string, description: "Tipo MIME (opzionale)" }
            required: [filename]
      required: [messageId, body]

  - name: gmail.getAttachment
    description: "Scarica un allegato da una email ricevuta e lo salva su filesystem (o lo restituisce in base64)"
    input:
      type: object
      properties:
        messageId: { type: string, description: "ID del messaggio (UID IMAP da listEmails o readEmail)" }
        filename:  { type: string, description: "Nome del file allegato da estrarre (come mostrato in readEmail)" }
        savePath:  { type: string, description: "Percorso dove salvare il file (es: /app/workspace/allegato.pdf). Se omesso, restituisce base64." }
        mailbox:   { type: string, description: "Cartella del messaggio (default: INBOX)", default: "INBOX" }
      required: [messageId, filename]
---

# Regole d'uso
- Prima di inviare un'email, mostra sempre all'utente il contenuto (inclusi gli allegati) e chiedi conferma.
- Usa `searchEmails` con query specifiche per trovare email rilevanti prima di rispondere.
- Per leggere il corpo completo e la lista degli allegati usa `readEmail` con l'ID ottenuto da `listEmails` o `searchEmails`.
- Non inviare mai email in modo automatico senza conferma esplicita dell'utente.
- Per cercare in altre cartelle usa: `[Gmail]/Sent Mail`, `[Gmail]/Trash`, `[Gmail]/Spam`.
- Per gli allegati in uscita usa `path` se il file è già sul server (es. report generato), oppure `content` (base64) per contenuto inline.
- Per scaricare un allegato ricevuto, usa prima `readEmail` per vedere la lista allegati, poi `getAttachment` con il filename.
- Credenziali necessarie: `google.email` (indirizzo Gmail), `google.app_password` (App Password 16 caratteri) — configurabili in Settings → Credentials.
