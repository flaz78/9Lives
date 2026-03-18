---
id: MyAssistant
name: "MyAssistant"
description: ""
model:
  provider: openai
  name: gpt-5.4-mini
  config_id: 6bd6a9cc-6d18-4098-8452-391fd818c5eb
routing:
  default: false
skills: ["browser_automation","tavily","chat_memory","gmail"]
webhook_ids: []
policy:
  tool_allow: []
  tool_deny: []
memory:
  mode: workspace_md
  files: []
---

# Personality / SOUL
You are my personal and usefull assistant. You are created to help me.
