import { describe, expect, it } from "vitest";
import {
  type FinancialAccount,
  type FinancialTransaction,
} from "../../src/lib/financial-intelligence/types";
import { reconcileCrossAccountTransfers } from "../../src/lib/financial-intelligence/reconciliation/matcher";
import { MultiAccountFinancialIntelligenceService } from "../../src/lib/financial-intelligence/service";

describe("Financial Intelligence - Cross-Account Reconciliation Engine", () => {
  const user1Accounts: FinancialAccount[] = [
    {
      id: "acc_gtb",
      ownerId: "user_1",
      tenantId: "default",
      institution: { code: "058", name: "Guaranty Trust Bank", type: "commercial_bank" },
      accountNumberMasked: "******1234",
      accountName: "John Doe GTB Checking",
      currency: "NGN",
      accountType: "checking",
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    },
    {
      id: "acc_kuda",
      ownerId: "user_1",
      tenantId: "default",
      institution: { code: "090267", name: "Kuda Microfinance Bank", type: "microfinance" },
      accountNumberMasked: "******5678",
      accountName: "John Doe Kuda Spend",
      currency: "NGN",
      accountType: "wallet",
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    },
  ];

  it("matches internal transfers by exact reference across owned accounts", () => {
    const transactions: FinancialTransaction[] = [
      {
        id: "tx_out",
        accountId: "acc_gtb",
        ownerId: "user_1",
        tenantId: "default",
        postedAt: "2026-11-02T10:00:00Z",
        amountAtoms: -5000000n, // -₦50,000
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: "TRF TO KUDA / JOHN DOE / NIP:9988776655",
        cleanDescription: "Transfer - John Doe",
        counterparty: { name: "John Doe", institution: "Kuda" },
        category: "transfer",
        reference: "9988776655",
        provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
      },
      {
        id: "tx_in",
        accountId: "acc_kuda",
        ownerId: "user_1",
        tenantId: "default",
        postedAt: "2026-11-02T10:02:00Z",
        amountAtoms: 5000000n, // +₦50,000
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: "NIP/9988776655/JOHN DOE/GTB",
        cleanDescription: "Transfer - John Doe",
        counterparty: { name: "John Doe", institution: "GTB" },
        category: "transfer",
        reference: "9988776655",
        provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 1, importedAt: "" },
      },
    ];

    const result = reconcileCrossAccountTransfers({
      accounts: user1Accounts,
      transactions,
    });

    expect(result.confirmedTransfersCount).toBe(2);
    const txOut = result.transactions.find((t) => t.id === "tx_out")!;
    const txIn = result.transactions.find((t) => t.id === "tx_in")!;

    expect(txOut.internalTransferMetadata?.isInternalTransfer).toBe(true);
    expect(txOut.internalTransferMetadata?.confidence).toBe("confirmed");
    expect(txOut.internalTransferMetadata?.counterpartTransactionId).toBe("tx_in");
    expect(txOut.internalTransferMetadata?.counterpartAccountId).toBe("acc_kuda");

    expect(txIn.internalTransferMetadata?.isInternalTransfer).toBe(true);
    expect(txIn.internalTransferMetadata?.counterpartTransactionId).toBe("tx_out");
  });

  it("matches internal transfers with fee deduction splitting (-₦50,053.75 vs +₦50,000.00)", () => {
    const transactions: FinancialTransaction[] = [
      {
        id: "tx_out_with_fee",
        accountId: "acc_gtb",
        ownerId: "user_1",
        tenantId: "default",
        postedAt: "2026-11-03T14:00:00Z",
        amountAtoms: -5005375n, // -₦50,053.75 (including ₦53.75 transfer fee)
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: "TRANSFER TO KUDA",
        cleanDescription: "Transfer",
        counterparty: {},
        category: "transfer",
        provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
      },
      {
        id: "tx_in_principal",
        accountId: "acc_kuda",
        ownerId: "user_1",
        tenantId: "default",
        postedAt: "2026-11-03T14:05:00Z",
        amountAtoms: 5000000n, // +₦50,000.00
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: "TRANSFER FROM GTB",
        cleanDescription: "Transfer",
        counterparty: {},
        category: "transfer",
        provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 1, importedAt: "" },
      },
    ];

    const result = reconcileCrossAccountTransfers({
      accounts: user1Accounts,
      transactions,
    });

    expect(result.probableTransfersCount).toBe(2);
    const debit = result.transactions.find((t) => t.id === "tx_out_with_fee")!;
    expect(debit.internalTransferMetadata?.isInternalTransfer).toBe(true);
    expect(debit.internalTransferMetadata?.transferFeeAtoms).toBe(5375n);
  });

  it("leaves ambiguous multiple matches as unresolved instead of making false correlations", () => {
    const transactions: FinancialTransaction[] = [
      {
        id: "tx_debit_1",
        accountId: "acc_gtb",
        ownerId: "user_1",
        tenantId: "default",
        postedAt: "2026-11-05T12:00:00Z",
        amountAtoms: -2000000n, // ₦20,000
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: "TRANSFER",
        cleanDescription: "Transfer",
        counterparty: {},
        category: "transfer",
        provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
      },
      // Two identical credits on the same day with no references
      {
        id: "tx_credit_1",
        accountId: "acc_kuda",
        ownerId: "user_1",
        tenantId: "default",
        postedAt: "2026-11-05T12:15:00Z",
        amountAtoms: 2000000n,
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: "DEPOSIT",
        cleanDescription: "Deposit",
        counterparty: {},
        category: "transfer",
        provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 1, importedAt: "" },
      },
      {
        id: "tx_credit_2",
        accountId: "acc_kuda",
        ownerId: "user_1",
        tenantId: "default",
        postedAt: "2026-11-05T12:30:00Z",
        amountAtoms: 2000000n,
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: "DEPOSIT",
        cleanDescription: "Deposit",
        counterparty: {},
        category: "transfer",
        provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 2, importedAt: "" },
      },
    ];

    const result = reconcileCrossAccountTransfers({
      accounts: user1Accounts,
      transactions,
    });

    expect(result.unresolvedCount).toBe(1);
    const debit = result.transactions.find((t) => t.id === "tx_debit_1")!;
    expect(debit.internalTransferMetadata?.confidence).toBe("unresolved");
  });

  it("persists user classification overrides across future ingestion and reconciliation cycles", async () => {
    const service = new MultiAccountFinancialIntelligenceService();

    const gtbAcc = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "058", name: "Guaranty Trust Bank", type: "commercial_bank" },
      accountNumberMasked: "******1111",
      accountName: "GTB Main",
      currency: "NGN",
      accountType: "checking",
    });

    const kudaAcc = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "090267", name: "Kuda Bank", type: "microfinance" },
      accountNumberMasked: "******2222",
      accountName: "Kuda Spend",
      currency: "NGN",
      accountType: "wallet",
    });

    const gtbCsv = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Nov-2026,01-Nov-2026,GTB001,35000.00,,65000.00,TRF TO EMERGENCY RESERVE
`.trim();

    await service.ingestStatement("user_gerald", gtbAcc.id, gtbCsv, "gtb.csv");

    const txsBefore = await service.queryTransactions("user_gerald");
    const transferTx = txsBefore.items[0];

    // User explicitly overrides: confirms it as internal transfer to kudaAcc
    await service.applyUserOverride("user_gerald", transferTx.id, {
      isInternalTransfer: true,
      counterpartAccountId: kudaAcc.id,
      notes: "Emergency reserve transfer to Kuda vault",
      updatedAt: new Date().toISOString(),
    });

    // Ingest a second statement later
    const gtbCsv2 = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
05-Nov-2026,05-Nov-2026,GTB002,1200.00,,63800.00,POS PURCHASE
`.trim();
    await service.ingestStatement("user_gerald", gtbAcc.id, gtbCsv2, "gtb_part2.csv");

    // Verify user override persisted!
    const txsAfter = await service.queryTransactions("user_gerald");
    const overriddenTx = txsAfter.items.find((t) => t.id === transferTx.id)!;

    expect(overriddenTx.internalTransferMetadata?.isInternalTransfer).toBe(true);
    expect(overriddenTx.internalTransferMetadata?.matchedBy).toBe("user_override");
    expect(overriddenTx.userOverride?.notes).toBe("Emergency reserve transfer to Kuda vault");
  });
});
