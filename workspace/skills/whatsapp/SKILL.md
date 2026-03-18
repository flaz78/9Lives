---
name: whatsapp
version: 0.1.0
description: "Invio messaggi tramite WhatsApp Web (Baileys)"
tools:
  - name: whatsapp.sendMessage
    description: "Invia un messaggio WhatsApp"
    input:
      type: object
      properties:
        to: { type: string, description: "JID del destinatario (es: 3912345678@s.whatsapp.net)" }
        text: { type: string }
      required: [to, text]
  - name: whatsapp.getStatus
    description: "Verifica lo stato della connessione WhatsApp"
    input:
      type: object
      properties: {}
      required: []
---

# Regole d’uso
- Non inviare spam o messaggi non richiesti.
- Usa i JID completi per garantire la consegna.
