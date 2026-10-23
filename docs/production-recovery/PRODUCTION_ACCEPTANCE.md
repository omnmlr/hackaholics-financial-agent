# AGUS production recovery — genuine acceptance passed

Owner approved the prepared production release and normal application test records
in chat on 23 October 2026. The release was published at 09:25 Africa/Lagos and
verified against the public website, not a local or mocked endpoint.

- Website: <https://askagus.netlify.app>
- Production deploy: `6adb19bb9eac1794dc5909d0`, ready, production context, locked.
- Application: `6fbbcf66fb5233e4b554f91cbde1508ad72a369d`.
- Provider/model: native Gemini, `gemini-3.5-flash-lite`, tested new API key.
- PR #44 remains **draft** and unmerged. The application branch is unchanged.

## Genuine public verification

One request at a time, at least 15 seconds between generation turns. Nine observed
model calls, within the 16-call budget. No quota ceiling, maximum capacity or
concurrent-load claim is established by this trial.

| Flow | Result |
| --- | --- |
| Anonymous authentication boundary | Protected API returned 401 |
| Production operator sign-in | Public UI succeeded using the supplied production password |
| Ordinary conversation | Genuine reply, HTTP 200, one model call |
| Sequential ordinary conversation | Genuine educational reply, HTTP 200, two model calls |
| Account-selection gate | Asked the user to select an authorized records account |
| Authorized financial search | HTTP 200, three model calls/three tool calls, AI narration and citations; asked which fictional Ada candidate was intended |
| Screenshot payment preparation | Two independent genuine image calls; editable Ada/Wema/0000000001/NGN 500 and Chidi/Access/0000000002/NGN 600 proposals |
| Draft reopening | Same unverified draft ID and proposals on repeated requests |
| Saved chats and persistence | Five turns saved across two new chats; reload and fresh-login retrieval passed |
| Browser errors | Zero |

Recipient names, bank codes, account numbers and amounts were checked. No payment
verification, approval or submission endpoint was called. The two proposals remain
unverified and simulated. No payment batch was created.

The full private browser report and screenshot are retained under
`/workspace/work/agus-production-release`; the screenshot was not published to Git.
Closed results without transcripts are in `production-acceptance-summary.json`.

## Existing financial records preserved

Read-only SQL compared the original production branch before and after acceptance:

- Three accounts and 77 transactions retained.
- Account, transaction and consent payload fingerprints match exactly.
- The one existing payment batch and its full payload fingerprint match exactly.
- Chat count changed from 25 to 27; turn count from 65 to 70, as approved.
- No database migrations, branch changes, resets or direct SQL writes were run.

The production database binding and its protected metadata remain unchanged.
Staging's independent database and operator credentials were not copied into
production. No Railway operation or real-money configuration change was made.

## Actual published configuration and artifact

The production `AI_API_KEY` value-only update succeeded without recreating the
variable. Its `is_secret: true`, existing builds/functions/runtime scopes, value
identities and all non-production contexts were retained. Staging's approval for
readable standard variables was not reused. All unrelated variables, including
operator identity/hash, database binding and payment flags, match the snapshot.

Netlify canonicalizes a former `AI_MODEL` all-context value into individual
contexts when the production value is patched. Its automatic expansion omitted
`dev-server`; that context was explicitly restored to its former effective model.
Final model values are Flash-Lite in production and the previous model in dev,
dev-server, branch-deploy and deploy-preview. This maintains the approved semantic
scope; the representation differs from the preliminary plan's all-plus-override.

The production Git branch still points to the old application. The new deployment
is locked so automatic publishing cannot replace the repair. Do not unlock it
until a separately authorized subsequent release addresses that branch state.

Netlify's published function metadata confirms Node 22, Next adapter 5.16.3,
32,437,529 archive bytes and an archive digest matching the independently verified
local package:
`d0e182668971031117791054441ddde406741fc34d54b6063dbef6362b081458`.
The function identity is separate from that archive digest; comparison uses the
digest field, not an assumption that function ID is a content hash.

Public HTML and eight script responses were scanned. No credential-derived leak
was found. One literal overlap was excluded only after the complete served asset
was proved byte-identical to the installed upstream vendor file and accepted
staging asset that predated receipt of the production credential. This is not a
heuristic redaction or an allowance for application-generated content.

A non-printing scan of 69 available hosted log rows found no known credential
matches. Closed diagnostics found zero provider authentication, invalid-key or
quota errors in the sampled rows. No raw hosted log messages were published.

## Preserved backup and corrected rollback

Private original configuration snapshots remain outside Git in the protected
release directory. Previous production deployment `6ada1aa358e288da5818c039` is
still ready and retained, with its sealed original runtime credentials.

On a material regression, restore that deployment and lock it. Restore the entire
original **non-secret AI_MODEL value set** from the snapshot using a whole-variable
value update: merely deleting the production override is insufficient after
Netlify's all-context expansion. That exact context expansion/restoration behavior
was additionally rehearsed on the credential-free scratch site. Preserve the
variable's scopes/secret flag and every unrelated setting.

Restoring the previous deploy restores its captured runtime secrets. The site-level
AI key binding can remain the tested new key; recovering the old key's plaintext
for future rebuilds still requires an owner-held copy. Keep the restored deployment
locked. The original application's 401 defect can return on rollback: this is a
previous-state recovery, not a claim that the original release was healthy.

No production rollback was necessary. The closed verification scripts and all
earlier staging/investigation evidence remain on this separate evidence branch;
none enters the five-file application diff in PR #44.

Remaining limits: exact project quotas and maximum capacity are unverified; the
production Git branch remains old and publishing is intentionally locked. The
earlier staging spending-narration fallback is preserved in its own evidence;
this production financial-search test used genuine AI narration successfully.
