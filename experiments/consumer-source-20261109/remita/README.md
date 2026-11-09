# Remita public TEST admission experiment

Observed 9 November 2026, 08:01 UTC / 09:01 WAT. This was one real **sandbox authentication** request, not a bank integration, simulated transfer or payment. No bank endpoint, real customer data or live credential was used. No token or password was persisted.

## Permission and input provenance

The current [official public collection](https://api.remita.net/api/collections/24289864/2sAY4vi3YC?segregateAuth=true&versionTag=latest) explicitly says other first-generation services may use its public test credentials before UAT/KYC. Its Generate Token request currently contains username/password **placeholders**, not usable values.

For the single admission attempt, the probe instead extracted the literal credentials from the [official RITS .NET README at commit `af6ae4b62b600cfb07c128103d63c81a3963d491`](https://github.com/RemitaPaymentServices/rits-sdk-dotnet-v3/blob/af6ae4b62b600cfb07c128103d63c81a3963d491/README.md). That example is explicitly labelled **Sample Demo Code** and selects `RemitaRITs(EnvironmentConfig.TEST)`. The script checks both statements before using those public samples. It neither searches for leaked keys nor uses credentials from an undocumented environment.

The only POST destination is exactly:

```text
https://demo.remita.net/remita/exapp/api/v1/send/api/uaasvc/uaa/token
```

The script checks the current collection's token URL against this full allowlist, disables redirects, preserves TLS verification and makes no retries. It calls no account-enquiry, bank-list, source-enrolment, mandate or transfer endpoint.

## Actual result and exact limitation

See [actual-output.json](actual-output.json). HTTP **200** returned a 41-byte JSON object with only `status` and `message`; no nonempty token field was returned. **The public TEST sample did not establish token admission.** No second request was made. The response values were not retained by this sanitized runner, so the precise provider status/message and cause of non-admission remain unknown; do not infer expiry, invalid credentials or consumer-role rejection specifically.

Consequently no authenticated scope, expiry, customer-source grant or source-bank access was observed. The experiment does not establish that every Remita sandbox is inaccessible; it establishes that this published historical TEST sample did not produce a token in this attempt.

The current REST Funds Transfer documentation separately requires registration using **an invitation link sent by Remita**, followed by retrieval of an issued **Secret Key**. That is the concrete current admission object not available here. Even an issued integration key/engine token would still be insufficient evidence of a delegated **personal customer's source-account authorization**: the current public contract does not expose a tested consumer source-enrolment flow, customer-source grant, full bank-history permission or 20-bank source matrix.

The smallest next external action is for Remita to issue a developer client for its permitted **consumer source-account** use case, identify the supported hosted enrolment flow and its returned source-authority object, and supply explicitly designated sandbox customer/source fixtures. Requesting merely a generic merchant Funds Transfer key does not settle that requirement. No provider was contacted or account registered in this experiment.

## Reproduction and stopping rule

From this folder:

```sh
python admission_probe.py
```

Default mode performs **zero network requests**. An explicitly authorized repetition can use `python admission_probe.py --sandbox-token`; this fetches the two public documentation artefacts and makes at most one authentication POST. It does not take arbitrary credentials or URLs as input. Source hashes for the actual run are in the saved output. Do not rerun simply to obtain a better result, and do not extend the sample to bank operations without documented consumer-source access.
