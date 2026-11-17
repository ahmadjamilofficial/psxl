# WAB chat reliability and conversation UX

## Implementation approach

Fix the active Ask Wab workspace rather than introducing a second chat product. `/app/parser` will create a new thread each time it is entered, while direct thread URLs continue to reopen saved history. The active thread page will own conversation navigation through a compact dropdown header with search, recent grouping, new-chat creation, and deletion.

Basic greetings will be handled deterministically in the server route after authenticated thread ownership is verified, so a provider outage cannot turn “hello” into a generic error. Provider-backed messages will retain the existing model probing and failover cascade. Error handling will preserve actionable retry behavior and never replay a request after output has begun.

## Design direction

Three possible directions were considered: **Claude-like quiet workspace** (0.06), **editorial financial console** (0.08), and **dense operations cockpit** (0.04). The chosen direction is Claude-like quiet workspace.

- **Design Movement:** calm, spacious AI workspace with editorial hierarchy and restrained motion.
- **Core Principles:** one active task surface, predictable navigation, progressive disclosure, and visible recovery states.
- **Color Philosophy:** warm neutral surfaces keep financial data legible; Wab's accent marks action and trust states rather than decorating every element.
- **Layout Paradigm:** a single full-height conversation canvas with a thin context header; chat history is revealed on demand from the active thread control.
- **Signature Elements:** rounded thread switcher, compact status line, and low-noise activity cards.
- **Interaction Philosophy:** every action is reversible or clearly labeled; switching and creating chats never requires leaving the transcript.
- **Animation:** only short entrance and disclosure transitions; no looping decorative motion, no layout-jumping message effects.
- **Typography System:** existing Wab heading/body tokens remain; strong hierarchy comes from spacing and weight, not oversized UI.
- **Brand Essence:** a dependable financial operating partner that turns messy records into traceable decisions; precise, calm, accountable.
- **Brand Voice:** “Here’s what I found.” and “Your data is safe while I retry.”
- **Wordmark & Logo:** preserve the existing Wab mark and brand assets.
- **Signature Brand Color:** preserve `var(--color-accent)` as the action and trust signal.

## Project structure

- `src/routes/app.parser.index.tsx`: fresh-thread entry behavior.
- `src/components/agent/ChatSidebar.tsx`: retained file name for low-risk integration, but becomes an in-page `ChatSwitcher` dropdown instead of a sidebar.
- `src/components/agent/ParserWorkspace.tsx`: active chat header, switcher placement, and existing message/composer flow.
- `src/routes/api/chat.ts`: authenticated deterministic greeting path and existing provider-backed agent path.
- `src/lib/chat-session.ts`: existing draft and pending-upload persistence.

## Outcome criteria

- Opening `/app/parser` after login or navigation always creates and opens a new chat.
- The active chat page contains no separate chat sidebar.
- Users can switch to an existing chat or create a new one from an in-page dropdown.
- A plain greeting does not require an external model provider and returns a normal assistant message.
- Provider-backed requests retain failover and safe, retryable errors.
- Existing uploads, tool approvals, ledger writes, and durable message persistence remain compatible.
