---
skills:
  allow:
    - "*"
  deny: []

filesystem:
  allow:
    - "workspace/storage/**"
    - "workspace/output/**"
  deny:
    - "*.env"
    - "*.key"
    - "*.pem"
    - "workspace/bootstrap/**"

api:
  allow:
    - "*"
  deny: []

limits:
  max_iterations: 10
  max_tool_calls: 30

confirmation_required:
  - gmail.sendEmail
  - gmail.sendCalendarInvite
---
# Global Guardrails - 9Lives.ai

These are the platform’s default security rules.
Each agent (Live) can add additional restrictions but cannot relax these rules.

## Behavior

-Blocked skill → the tool execution is blocked and the agent receives a structured error.

-Confirmation required → the agent informs the user that the action requires explicit confirmation.

-Allowed skill → execution proceeds normally.

## Notes

- The max_iterations and max_tool_calls limits protect against infinite loops and excessive resource usage.

- Filesystem restrictions prevent access to sensitive files (keys, configurations).

- API restrictions can be used to limit which external services an agent can contact.