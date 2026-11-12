# AGUS 2.0 — Multi-Account Financial Intelligence Layer

> **Official Product Tagline:** *"Your money, and what's next."*

---

## 1. Executive Summary & Product Context

AGUS is an AI-native personal financial agent designed to provide users with a unified, truthful view of their complete financial situation across multiple bank accounts, digital fintech wallets, and cryptocurrency holdings (e.g., NGN, USD, USDC).

In Nigerian banking and African fintech environments, live open-banking provider APIs are frequently unavailable, unconsented, rate-limited, or subject to strict regulatory gating. To eliminate dependency on unapproved live banking connections, this implementation introduces a **provider-independent, deterministic financial intelligence engine**.

This subsystem ingests raw bank statements (CSV/exports), normalizes them to canonical financial records, deduplicates overlapping records, reconciles internal transfers between owned accounts, categorizes transactions (including granular detection of hidden bank charges), identifies recurring subscriptions, and evaluates data freshness and completeness.

All analytics are **100% deterministic, mathematically verified with integer minor units (BigInt)**, strictly multi-tenant isolated, and immune to spreadsheet formula injection.

---

## 2. Canonical Financial Data Model

Located in [`src/lib/financial-intelligence/types.ts`](file:///C:/Users/USER/.gemini/antigravity/worktrees/hackaholics/multi_account_intelligence/src/lib/financial-intelligence/types.ts).

### 2.1 Multi-Account & Multi-Institution Support
- **`FinancialAccount`**: Represents an account or wallet owned by an authenticated user (`ownerId`), scoped to a tenant (`tenantId`).
- **Institutions**: Commercial banks (`GTBank`, `Access Bank`, `Zenith Bank`, `First Bank`), microfinance institutions (`Kuda`, `Moniepoint`, `Opay`), fintech wallets, and crypto wallets (`Phantom`, `Solana USDC`).
- **Currencies**: `NGN` (Naira), `USD` (US Dollars), `USDC` (Solana canonical Circle USDC), `EUR`, `GBP`.

### 2.2 Integer Minor-Unit Scaling (`BigInt`)
Floating-point mathematics is strictly forbidden in AGUS monetary calculations. All monetary balances and transaction amounts are represented as integer atoms (`bigint`):
- `NGN`: scale 2 (`1 NGN = 100 kobo`).
- `USD`: scale 2 (`1 USD = 100 cents`).
- `USDC`: scale 6 (`1 USDC = 1,000,000 micro-units`).
- Helper functions `serializeMonetaryAmount` and `formatMonetaryAmount` ensure safe serialization for JSON transport and UI display.

### 2.3 Strict Currency Isolation Invariant
Different currencies are never summed or combined directly without an explicit exchange rate quote. Calling `assertSameCurrency(c1, c2)` enforces this invariant by throwing a `CurrencyMismatchError`. Balance summaries return isolated balances grouped by currency: `Record<SupportedCurrency, CurrencyBalanceSummary>`.

### 2.4 Balance Semantics
- `availableAtoms`: Immediately spendable funds.
- `currentAtoms` / `ledgerAtoms`: Booked ledger balance.
- `asOf`: Precise observation timestamp.
- `isStale`: Marked `true` if transactions or balance snapshots are older than 30 days, generating actionable warnings.

---

## 3. Provider-Independent Ingestion Engine

Located in [`src/lib/financial-intelligence/ingestion/`](file:///C:/Users/USER/.gemini/antigravity/worktrees/hackaholics/multi_account_intelligence/src/lib/financial-intelligence/ingestion/).

### 3.1 Safe RFC 4180 CSV Parsing & Formula Injection Protection
- **RFC 4180 Compliance**: Supports quoted cells, embedded commas, escaped quotes (`""`), multiline remarks, and auto-detects comma, semicolon, or tab delimiters.
- **Resource Limits**: Guards against memory exhaustion denial-of-service via bounded rows (`maxRows: 10,000`) and field lengths (`maxFieldLength: 10,000`).
- **Formula Injection Immunity**: Spreadsheet programs (Excel, Google Sheets, LibreOffice) execute formulas in untrusted CSV cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r`. `sanitizeCsvField()` disarms formula prefixes by escaping them with a leading `'` and stripping control characters, while correctly preserving genuine negative and positive numeric values (e.g. `-1500.50`).

### 3.2 Institution Format Detection & Normalization
Header signatures automatically detect statement format:
- **Guaranty Trust Bank (GTBank)**: `Trans Date`, `Value Date`, `Reference`, `Debits`, `Credits`, `Balance`, `Remarks`.
- **Access Bank**: `Trans. Date`, `Value Date`, `Description`, `Debit`, `Credit`, `Balance`.
- **Zenith Bank**: `Trans Date`, `Value Date`, `Narration`, `Debit`, `Credit`, `Balance`, `Ref`.
- **Kuda Microfinance Bank**: `Date`, `Description`, `Amount`, `Balance`, `Type`.
- **Moniepoint Microfinance Bank**: `Date & Time`, `Transaction Type`, `Amount`, `Fee`, `Beneficiary/Sender`, `Status`, `Session ID`.
- **Generic / Standard CSV**: Multi-currency schemas with standard date, amount, description, reference.

### 3.3 Idempotency & Deduplication
- **Deterministic Transaction Fingerprint**: Computed as `sha256(accountId | postedAt[YYYY-MM-DD] | amountAtoms | cleanDescription | reference)`.
- Re-importing an identical statement file produces 0 duplicates in the ledger and records `duplicateCount` in the ingestion audit log.
- Ingesting overlapping statements (e.g. overlapping date ranges) preserves prior records and safely appends new transactions.

### 3.4 Reversals & Correction Pairs
- Automatically identifies credits that reverse failed debits (`FAILED NIP`, `REVERSAL`, `DISPUTE REFUND`, or matching original references within a 7-day window).
- Links both records: `reversalOfId = debit.id` and sets status to `"reversed"`.
- Excludes reversed pairs from net income and spending.

---

## 4. Cross-Account Reconciliation Engine

Located in [`src/lib/financial-intelligence/reconciliation/`](file:///C:/Users/USER/.gemini/antigravity/worktrees/hackaholics/multi_account_intelligence/src/lib/financial-intelligence/reconciliation/).

### 4.1 Internal Transfer Correlation
When a user moves money between two owned accounts (e.g. GTBank to Kuda):
1. **Pass 1 (Reference Matching)**: Exact matching NIP session ID, reference, or transaction reference within the time window. Marked as `confirmed` internal transfer.
2. **Pass 2 (Amount & Window Matching)**: Exact matching amount (`-X` on Account A, `+X` on Account B) within a 48-hour posting window. If narration or bank name correlates, marked as `confirmed`; otherwise marked as `probable`.
3. **Pass 3 (Fee Splitting Matching)**: Correlates transactions where the sending bank bundled the transfer fee into the debit (e.g., `-₦50,053.75` on GTBank vs `+₦50,000.00` on Kuda). Extracts the ₦53.75 as a legitimate transfer fee expense while matching the ₦50,000 principal as an internal transfer.
4. **Ambiguity Guard**: When multiple matching credits exist for a debit, the debit is flagged as `unresolved` rather than risking a false match.

### 4.2 Durable User Overrides
- Users can confirm or reject probable transfers or reclassify counterparties and categories via `applyUserOverride()`.
- Overrides are durably stored with `matchedBy: "user_override"` and `updatedAt`.
- Subsequent automated ingestion and reconciliation passes **never overwrite** user overrides.

### 4.3 Neutrality Invariant
- **Internal transfers MUST NEVER distort spending or income totals.** Moving ₦100,000 from GTBank to Kuda is net-zero; it neither represents ₦100,000 of income nor ₦100,000 of spending.

---

## 5. Deterministic Financial Intelligence Services

Located in [`src/lib/financial-intelligence/analytics/`](file:///C:/Users/USER/.gemini/antigravity/worktrees/hackaholics/multi_account_intelligence/src/lib/financial-intelligence/analytics/).

### 5.1 Balances & Staleness
- Aggregates balances isolated per currency.
- Emits staleness warnings if any owned account has no activity in >30 days.

### 5.2 True Cash Flow
- **Gross Income**: Sum of external credits (strictly excluding internal transfers and reversals).
- **Gross Spending**: Sum of external debits and bank fees (strictly excluding internal transfer principals and reversals).
- **Net Cash Flow**: `Gross Income - Gross Spending`.
- **Savings Rate %**: `(Net Cash Flow / Gross Income) * 100`.

### 5.3 Granular Bank Charges Deep Dive
Identifies and segments hidden Nigerian banking fees:
- **Electronic Money Transfer Levy (EMTL / Stamp Duty)**: ₦50 statutory charge.
- **SMS Alert Charges**: Notification charges.
- **Card & Account Maintenance Fees**: Monthly recurring card charges.
- **Transfer Fees & VAT**: NIP interbank transfer commission and VAT.
- Every category item includes the full array of supporting `transactionIds` for one-click auditability.

### 5.4 Recurring & Subscription Detection
- Analyzes intervals and amount stability to detect subscriptions (Netflix, Spotify, Apple, Google, OpenAI), utility bills (Ikeja Electric, airtime/data top-ups), and periodic income (salary, stipends).
- Identifies cadences (`weekly`, `biweekly`, `monthly`, `annual`) and predicts the next expected charge date.

### 5.5 Data Quality & Coverage Diagnostics
- Detects missing statement periods (>45-day gaps in active accounts).
- Emits health score (0–100) and actionable warnings for missing periods or unconfirmed transfers.

---

## 6. Service API & Usage Example

```typescript
import { MultiAccountFinancialIntelligenceService } from "@/lib/financial-intelligence";

const service = new MultiAccountFinancialIntelligenceService();

// 1. Register user accounts
const gtb = service.registerAccount({
  ownerId: "user_gerald",
  institution: { code: "058", name: "GTBank", type: "commercial_bank" },
  accountNumberMasked: "******1234",
  accountName: "GTB Main Checking",
  currency: "NGN",
  accountType: "checking",
});

const kuda = service.registerAccount({
  ownerId: "user_gerald",
  institution: { code: "090267", name: "Kuda Bank", type: "microfinance" },
  accountNumberMasked: "******5678",
  accountName: "Kuda Spend Wallet",
  currency: "NGN",
  accountType: "wallet",
});

// 2. Ingest bank statement CSVs
service.ingestStatement("user_gerald", gtb.id, gtbCsvString, "gtb_statement.csv");
service.ingestStatement("user_gerald", kuda.id, kudaCsvString, "kuda_statement.csv");

// 3. Obtain comprehensive overview
const overview = service.getFinancialOverview("user_gerald", "NGN");

console.log(overview.tagline); // "Your money, and what's next."
console.log(overview.balances.currencySummaries.NGN.formatted); // e.g. "₦465,000.00"
console.log(overview.cashFlow.overall.formattedIncome);        // True external income
console.log(overview.cashFlow.overall.formattedSpending);      // True external spending
console.log(overview.spending.bankCharges.formattedTotal);     // e.g. "₦261.75"
```

---

## 7. Verification Evidence

The test suite contains **40 comprehensive automated tests** across 5 test suites:

```text
 ✓ tests/financial-intelligence/analytics.test.ts (5 tests)
 ✓ tests/financial-intelligence/property-invariants.test.ts (5 tests)
 ✓ tests/financial-intelligence/synthetic-bank-statements.test.ts (5 tests)
 ✓ tests/financial-intelligence/ingestion.test.ts (21 tests)
 ✓ tests/financial-intelligence/reconciliation.test.ts (4 tests)

 Test Files  5 passed (5)
      Tests  40 passed (40)
```

### Verified Mathematical Invariants
1. **Internal Transfer Neutrality**: Moving funds across owned accounts alters neither the aggregate currency balance nor the external cash flow metrics.
2. **Ledger Conservation**: Ending balance equals starting balance plus verified external changes.
3. **Currency Isolation**: Strictly throws `CurrencyMismatchError` on cross-currency mixing without explicit rates.
4. **Formula Injection Immunity**: Verified across arbitrary malicious payloads (`=cmd|...`, `=HYPERLINK`, `@SUM`, `+`, `-`, `\t`, `\r`).
5. **Multi-User Isolation**: User A and User B cannot access, view, or contaminate each other's accounts or financial overviews.

---

## 8. Handoff Memo for Lead Engineer Codex

1. **Isolation**: All work is safely isolated in `feature/multi-account-intelligence` within worktree `C:\Users\USER\.gemini\antigravity\worktrees\hackaholics\multi_account_intelligence`.
2. **Preservation**: No existing banking execution, Solana signing routes, database migration checksums, or AI conversation prompts were modified.
3. **Integration Ready**: `MultiAccountFinancialIntelligenceService` can be bound directly to the personal agent tool dispatcher, mobile balance screens, and database repositories when ready.
