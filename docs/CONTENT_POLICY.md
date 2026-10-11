# Content Policy & Enforcement (draft for team review)

This document is a starting point. It must be reviewed against the laws of each country where the service is offered before launch, including Thailand's PDPA and Computer Crime Act, and against app-store rules.

## Violation categories and default severity

| Category | Severity | Automated handling |
|---|---|---|
| sexual_minors: any sexual content involving minors, including fictional characters described as under 18 | critical | Blocked on input, output and character publishing (`moderateText`). Reports are sorted first |
| sexual_content: explicit sexual content | high (output) / medium (report) | Blocked on output when clearly explicit. Prohibited by the system prompt |
| self_harm | high | **Never blocks the user.** Flags the message and shows crisis resources (Thailand 1323). The model is instructed to step out of character |
| violence, illegal | high | Prohibited by the system prompt. Handled by reports and review |
| hate, harassment, privacy, impersonation | medium | Handled by reports and review |
| spam, other | low | Handled by reports and review |
| prompt_injection | low (metric) | Flagged only. The prompt structure neutralises it |

Automated checks are deterministic pattern rules that act as a first line of defence. High-risk decisions are **not** delegated to a single LLM. They combine pattern rules, provider safety systems (refusals are handled as content-policy failures with a refund), user reports and human review.

## Content levels (enforced in the AI instructions, `RATING_GUIDANCE` in `src/server/ai/prompt.ts`)

| Level | Who | Allowed |
|---|---|---|
| General | everyone (13+) | non-graphic violence, friendship/affection/light flirting |
| Teen | everyone (13+) | moderate action/fantasy violence, tension, non-sexual romance |
| Mature | confirmed 18+ **and** opted in | intense/graphic action and horror, dark and morally complex themes, crime, strong language, fictional alcohol/drug use, passionate/sensual romance with intimacy implied off-screen |

Never, at any level: explicit description of sexual acts (scenes fade to black), sexualisation of anyone under 18 or who seems under 18, approving depictions of sexual violence, real-world harmful instructions. If a user turns off mature content, their existing mature chats stop accepting new messages.

## Age-appropriate access

- Sign-up requires confirming the user is 13 or older.
- Mature-rated characters are hidden unless the viewer has confirmed 18+ **and** opted in. Only 18+ accounts can create them.
- Explicit sexual content is not allowed for anyone, including at the mature rating.

## User tools

- Report characters, individual AI messages and users. One report per user per target, rate-limited.
- Block characters. They are hidden from discovery and search, and new chats with them are prevented.
- Delete chats, memories, all history, or the whole account (7-day grace period, then erased by the maintenance job).

## Enforcement ladder

| Action | Effect |
|---|---|
| warning | Recorded and visible to the user under Safety → Account standing |
| restriction | The user can browse and read but not chat, create, publish or claim bonuses |
| suspension | Sessions are revoked and sign-in is blocked |
| reinstatement | Access is restored |

Characters can be hidden (removed from discovery and new chats), suspended (cannot be published or chatted with) or restored. A character with 3 or more open high/critical reports is auto-hidden pending review. The hide is reversible and audited.

Users can appeal any warning, restriction or suspension once per decision. An accepted appeal against a restriction or suspension restores access.

## Audit

Every staff action records the actor, action, target and reason in `AuditLog`. Reviewers see a snapshot of the reported content, not the full conversation.

## Items to confirm before launch

- [ ] Legal review of this policy, the Terms of Service and the Privacy Policy (PDPA: data-subject rights, retention, cross-border transfer to AI providers).
- [ ] Data retention periods for ledger and payment records after account erasure. They are currently cascade-deleted, and accounting rules may require keeping them.
- [ ] Escalation path for critical reports (e.g. CSAM reporting obligations).
- [ ] Store age rating and content declarations.


**Rough language (2026-10-12):** swearing, insults and trash-talk, including characters insulting the user back, are allowed at every rating. Still excluded: slurs against protected groups, and threats or harassment aimed at real, identifiable people. Gemini's harassment filter is off; hate speech, dangerous and sexual filters stay on.
