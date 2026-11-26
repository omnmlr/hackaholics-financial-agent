# Frontend integration contract for Chisom

The first demo can read the fixture or actual local report. The planned HTTP and event contracts below specify the Android handoff. They are pending backend work. The implemented CLI/MCP contracts are available now.

## Screens and navigation

| Screen | Required interaction and data |
| --- | --- |
| Sign in | Existing AGUS Google or email OTP. Reuse mobile browser handoff and secure session storage. Resume to the prior run link after auth. Represent expired, incorrect and throttled OTP separately. |
| Runs | Open from the default tab. Show most recent runs, status, APK revision, associated device class and cluster. Filter by project or outcome. Empty state links to create a run. |
| New run | Select a registered candidate APK and scenario, then a compatible device class. Show cluster, package, APK hash, wallet mode, device lease status and exclusions before confirmation. Confirm once and navigate to the returned run ID. |
| Run detail | Show chronological steps, callback outcome, independent chain result, screenshots and recommended repair. Preserve callback and chain as separate status lines. Tap to expand evidence, share a scrubbed report or start a new run when it is safe. |
| Devices | Show online/leased/offline state and scenario compatibility. Include emulator/test wallet, ordinary Android and independently verified Seeker as separate labels. Release or reacquire an expired lease when supported. |
| Payments | Hide for hosted prototype until provider payout exists. Demo fixtures can show quote, approval and receipt under a clearly visible local test label. A hosted flow opens an explicit immutable wallet review with cluster, mint, amount, recipient and fee. |

Routes for the native shell are `/sign-in`, `/runs`, `/runs/new`, `/runs/:runId`, `/devices` and later `/jobs/:jobId`. Deep links to reports require auth and an owner check. Preserve the AGUS name, approved mascot, wordmark and existing identity. Use the existing typography and interaction tokens. Use semantic text and icons for outcomes, with readable support for dynamic type and no status conveyed by color alone.

## Implemented local contract

- `list_test_scenarios()` returns `{device:{kind,isolated,seekerVerified},cluster,scenarios:[{scenario,title}]}`.
- `start_test_run({scenario})` returns `{runId}`. The caller selects an operator-approved scenario. `get_test_run({runId})` returns the report below. Local CLI `devices`, `run` and `get` share the same core.
- `report` includes `version:1`, `runId`, `scenario`, `scenarioSha256`, `title`, `cluster`, `state`, `startedAt`, `finishedAt?`, `device?`, `chainWindow?`, `steps`, `artifacts`, `callback?`, `receipt?` and `failure?`. `steps[]` contains `action`, `state` and UTC `at`. `receipt` contains payer, payer source, recipient, lamports, fee lamports and finalized slot. `callback` contains either a wallet failure code or a signature and payer. `failure` contains a stable code and remedy.
- Status is `running | passed | failed`. A report with a signature and no receipt may require reconciliation. Asset integer amounts are decimal strings. Public Devnet signatures may link to the cluster-specific explorer. Local validator signatures have no public explorer destination.

## Planned hosted contract

| Endpoint | Request and response |
| --- | --- |
| `GET /api/v1/mobile-test/devices` | `{items: Device[]}`. Device includes `id, name, class, state, compatibility, lastSeenAt`. `class=emulator\|android_device\|verified_seeker` and `state=online\|leased\|offline\|maintenance`. `compatibility[]` declares a wallet mode and evidence level. |
| `GET /api/v1/mobile-test/scenarios` | `{items:[{id,version,title,packageName,walletModes,clusters,expectedChecks}]}`. |
| `POST /api/v1/mobile-test/apks` | Authorizes an upload from `{projectId,packageName,sha256,bytes}` and returns `{apkId,uploadUrl,expiresAt}`. Ready only after server-side checksum and metadata verification. Implement before exposing unknown APK inputs. |
| `POST /api/v1/mobile-test/runs` | `Idempotency-Key` plus `{apkId,scenarioId,scenarioVersion,deviceClass,cluster}`. Returns `202 {runId,state:"queued"}` or stable conflict code. |
| `GET /api/v1/mobile-test/runs/:id` | Local report fields plus `apkId, leaseId?, latestSequence`. Hosted states add `queued, allocating, interrupted, canceled`. `GET /runs?cursor=...` uses an opaque cursor. |
| `GET /api/v1/mobile-test/runs/:id/events` | Authenticated SSE with `Last-Event-ID`. Poll the run snapshot when streaming is disconnected. Each event is `{runId,sequence,at,type,data}`. Types are `run.state_changed`, `step.updated`, `wallet.callback`, `chain.receipt`, `artifact.ready` and `settlement.updated`. Apply in sequence, dedupe by sequence, and refetch on gaps. |
| `GET /api/v1/mobile-test/runs/:id/artifacts/:artifactId` | Tenant-checked metadata and expiring download grant. Show name, content type, captured timestamp and verification hash. |
| `GET /api/v1/mobile-test/jobs/:id` | Later. `{jobId,runId,quote:{mint,atoms,decimals,cluster},settlement:{state,signature?,receipt?}}`. Only finalized evidence permits `paid`. |

A lease moves `requested → active → releasing → released` with `expired` and `lost` exits. Reconnect and refresh the same test when the client loses connectivity. On `DEVICE_BUSY`, wait or choose a different capability class. On `APK_MISMATCH`, return to candidate selection. On `DECLINED` or `NO_WALLET`, show the wallet remedy. On `FINALITY_TIMEOUT` or `RUN_INTERRUPTED`, preserve and reconcile the attempt, and disable one-click payment retry. Authentication failures show sign-in. A tenant mismatch returns a generic resource-unavailable state. The app never asks for a seed, private key or network debug address.

## Fixture data

Use [demo fixture reports](../../packages/mobile-test/examples/reports.json) for loading, wallet rejection, signed-without-receipt, successful Localnet execution and payment display. Keep fixture runs visibly labeled when used for a presentation. Test expired auth, device busy, generation mismatch, SSE disconnect and reopen, duplicate sequences and safe resume.

## Physical inventory and evaluation addendum

- The local discovery response now has `devices[]` with `id, kind, label, state, evidence, observed`. Use the ID for optional `start_test_run({scenario, device})` selection. These aliases are local to a runner. `evidence` distinguishes configuration, runner observations and hardware attestation. Do not expose serials.
- `report.lease` gives the device alias and lease timestamps. `report.deviceProfile` includes `version, observedAt, source, measured, network, hardwareAttested`. Treat absent numerical values as unavailable. Label emulator values clearly, including battery and memory. Managed availability windows and pricing belong to a later provider flow.
- Add an Evaluations entry under run detail. Send `score_test_outcome({runId,outcome})` after the model makes its decision. Show claim, expected outcome, correctness, false financial success, task completion, elapsed run time and scripted actions. Use the same scenario and environment for comparable completions. Keep task outcome and model decision visually distinct.
- The receipt view shows issuer fingerprint, run and device alias, build identifiers, timestamps and evidence digests. Use “Runner-signed report” for the Ed25519 seal. Reserve hardware verification and SAS labels for independently implemented evidence.
- Add provider navigation after authenticated enrollment exists. Planned areas are devices, availability, session history and accepted-work payout. Store explicit training consent separately from ordinary device participation. No guaranteed payout or earnings projection.
