---
name: telegram
version: 0.1.0
description: "Invio/ricezione messaggi Telegram"
tools:
  - name: telegram.sendMessage
    description: "Invia un messaggio a una chat Telegram"
    input:
      type: object
      properties:
        chatId: { type: string }
        text: { type: string }
      required: [chatId, text]
---

# Regole d’uso
- Non inviare messaggi senza contesto sufficiente.
- Se `policy.requireApproval=true`, chiedi conferma prima di inviare.
