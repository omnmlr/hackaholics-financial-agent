# Backend authority review — native AGUS hardening

Scope: PR #38 stacked on PR #37, fictional records only. This is a code and
negative-test review independent of Gemini's self-assessment; it is not an
external penetration test or a claim of a separate human reviewer.

## Authority boundaries examined

| Boundary                                   | Enforcement and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principal and account ownership            | `financialContext` derives tenant/owner from the authenticated operator's persisted binding. `authorizedFinancialAccess` ignores a caller-supplied dispatcher principal. All native reads pass `createSecureReads.check`, the repository access resolver and the underlying read dispatcher authorizer. Foreign/mixed account selections fail before data disclosure. No model declaration accepts a principal, consent, provider or payment permission.                           |
| Current scope, consent and source revision | Native reads check the required scopes before dispatch, after I/O, before final output, and after context CAS. Transaction and evidence scopes are separate. Revocation, expiry and changed revisions discard facts. The new provider-error factual fallback uses these same checks. Negative native tests include revocation during the failing generation and during persistence.                                                                                                |
| Remembered selections                      | Disclosure requires current selected account membership, matching version and unexpired transaction-read consent. Labels are now untrusted content instead of system instructions. Stale hints are discarded; direct detail/evidence from stale selections remains blocked, while an unrelated fresh search/summary/total is possible. Financial display history restores only markers, never bank facts or access.                                                                |
| Untrusted tool input/output                | Strict backend argument and result schemas, result/call correlation, source provenance, duplicate/budget checks and safe factual rendering remain active. Unknown functions and injected authority fields cannot execute. Calendar arguments are validated and converted deterministically; impossible, mixed and reversed boundaries fail before dispatch. Provider narrative, URLs and references are omitted from model-facing record data. Labels remain explicitly untrusted. |
| Arithmetic versus financial facts          | Decimal evaluation proves the expression's arithmetic, not its interpretation or an account balance. Every completed calculation now requires explicit interpretation confirmation in the semantic review. The reviewer uses constrained JSON, is fallible and cannot grant access. Failure preserves only explicitly hypothetical arithmetic or source-backed facts. A rejected interpretation produces uncertainty instead of an asserted financial answer.                      |
| Financial narration                        | Authoring slots, citations, result provenance and deterministic acceptance remain backend-owned. Rejected presentation returns authoritative source cards. User statements are not inserted into those cards as bank evidence. Free financial prose still receives semantic review; lexical backstops are not a universal hallucination proof.                                                                                                                                     |
| Provider failures and secrets              | SDK implicit retries are disabled; application retries only one bounded 500/502/503/504, never 401/403/429. Provider exceptions cross the application boundary as fixed codes. User/history credentials are scrubbed before model disclosure. Browser regressions inject a private-looking error marker and verify it never appears in the UI. No key value is stored in evidence.                                                                                                 |
| Payment authority                          | Native declarations contain calculation, five read functions, financial presentation, account choice and draft handoff. There is no approve/submit/execute/OTP/reconciliation function. Handoff shows a button; only a human click requests an editable unverified draft. Draft extraction cannot approve or execute. Native browser journeys assert zero approval and execution requests.                                                                                         |
| Existing financial controls                | `payments.ts`, `paystack.ts`, `auth.ts`, `config.ts`, database code, migrations and startup scripts have no hardening diff. Existing tests cover password reauthentication, immutable approval snapshots/nonces, edit invalidation, expired/replayed approval, one concurrent execution, OTP claims without replay/storage, idempotency, uncertain outcomes, webhook deduplication and reconciliation. HTTP smoke exercises these with a disposable fixture database.              |
| Persistence and concurrency                | The existing owner-scoped SQL context CAS binds both revision and observed row expiry, preventing a writer from a previous context lifetime. Chat leases serialize HTTP turns. Context recovery does not restore expired authority. New native tests exercise concurrent CAS and revocation during persistence; inherited SQL, restart, lease and ABA tests remain active. No schema migration was added.                                                                          |

## Observations and limits

The initial genuine unauthorized request produced no banking dispatch, citation,
financial presentation or draft. Its generic unavailable response was safe but
unhelpful; it is not credited as an ideal conversational refusal. The malicious
transfer prompt timed out without any tool dispatch; it demonstrates no action,
not a successful natural-language refusal. Deterministic adversarial tests cover
the actual authority boundary when a hostile model requests execution anyway.

Prompt-injection robustness and semantic interpretation remain fallible. This
work verifies deterministic financial authority without claiming that prompts or
the same-model reviewer are security proofs. Testing uses fictional accounts;
no production database, real bank, live transfer, secret change or deployment is
part of this review. Physical microphone recognition and real-device playback
need device acceptance.

The existing shared privacy scrubber deliberately withholds unseparated long
numbers; this can also remove large mathematical operands. Its regexes are a
best-effort disclosure filter, not proof that arbitrary user-supplied secrets can
never be sent. Provider credentials are separate server configuration and are
never inserted into conversation content or diagnostics by the native agent.
