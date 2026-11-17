# WAB chat reliability and UX outcomes

- [x] **Fresh conversation entry:** Opening the Ask Wab page after login or returning to the app creates and opens a new chat instead of silently reopening the last chat; direct links to an existing thread still open that saved conversation.
- [x] **In-page chat organization:** Remove the separate openable chat sidebar and add an in-page dropdown that lists recent chats, supports switching, creates a new chat, and exposes deletion without leaving the active conversation.
- [x] **Reliable basic interaction:** A plain greeting such as “hello” returns a helpful assistant response even when external AI providers are unavailable; the user must not see the generic Wab AI error for this deterministic path.
- [x] **Provider-backed reliability:** Preserve provider probing, cascade failover, safe error messages, and retry behavior for financial questions, uploads, and tool-enabled requests; never replay a request after streamed output has started.
- [x] **Regression safety:** Preserve uploads, durable chat history, ledger actions, approval gates, draft restoration, and the existing investor-ready visual language while keeping motion restrained.
