import { describe, expect, it } from "vitest";
import { MultiAccountFinancialIntelligenceService } from "../../src/lib/financial-intelligence/service";

describe("Financial Intelligence - Analytics & Evidence-Based Insights", () => {
  it("computes isolated balances per currency without cross-currency contamination", async () => {
    const service = new MultiAccountFinancialIntelligenceService();

    const gtbNgn = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "058", name: "GTBank", type: "commercial_bank" },
      accountNumberMasked: "******1234",
      accountName: "GTB Naira Savings",
      currency: "NGN",
      accountType: "savings",
    });

    const mercuryUsd = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "MERC", name: "Mercury Bank", type: "commercial_bank" },
      accountNumberMasked: "******5678",
      accountName: "Mercury USD Operating",
      currency: "USD",
      accountType: "checking",
    });

    const phantomUsdc = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "SOL", name: "Phantom Wallet", type: "crypto_wallet" },
      accountNumberMasked: "7x...9qW",
      accountName: "Solana USDC Treasury",
      currency: "USDC",
      accountType: "wallet",
    });

    // Ingest NGN statement
    const ngnCsv = `
Trans Date,Description,Amount,Type
2026-11-01,Salary Inflow,500000.00,Credit
2026-11-02,Groceries,35000.00,Debit
`.trim();
    await service.ingestStatement("user_gerald", gtbNgn.id, ngnCsv, "ngn.csv");

    // Ingest USD statement
    const usdCsv = `
Date,Description,Amount,Type
2026-11-01,Client Consulting,2500.00,Credit
2026-11-03,GitHub Co-Pilot,20.00,Debit
`.trim();
    await service.ingestStatement("user_gerald", mercuryUsd.id, usdCsv, "usd.csv");

    // Ingest USDC statement
    const usdcCsv = `
Date,Description,Amount,Type
2026-11-01,Grant Funding,1000.000000,Credit
2026-11-04,Escrow Transfer,100.000000,Debit
`.trim();
    await service.ingestStatement("user_gerald", phantomUsdc.id, usdcCsv, "usdc.csv");

    const overview = await service.getFinancialOverview("user_gerald");

    expect(overview.tagline).toBe("Your money, and what's next.");

    // Verify NGN balance
    const ngnSummary = overview.balances.currencySummaries.NGN;
    expect(ngnSummary.totalAtoms).toBe(46500000n); // ₦465,000.00
    expect(ngnSummary.formatted).toBe("₦465,000.00");

    // Verify USD balance
    const usdSummary = overview.balances.currencySummaries.USD;
    expect(usdSummary.totalAtoms).toBe(248000n); // $2,480.00 (cents)
    expect(usdSummary.formatted).toBe("$2,480.00");

    // Verify USDC balance
    const usdcSummary = overview.balances.currencySummaries.USDC;
    expect(usdcSummary.totalAtoms).toBe(900000000n); // 900 USDC (6 decimals)
    expect(usdcSummary.formatted).toBe("900.000000 USDC");
  });

  it("strictly excludes internal transfers and reversals from true cash flow and spending", async () => {
    const service = new MultiAccountFinancialIntelligenceService();

    const gtb = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "058", name: "GTBank", type: "commercial_bank" },
      accountNumberMasked: "******1234",
      accountName: "GTB Main",
      currency: "NGN",
      accountType: "checking",
    });

    const kuda = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "090267", name: "Kuda", type: "microfinance" },
      accountNumberMasked: "******5678",
      accountName: "Kuda Spend",
      currency: "NGN",
      accountType: "wallet",
    });

    // GTBank:
    // Income: +₦200,000
    // Transfer to Kuda: -₦50,000 (Internal)
    // Transfer Fee: -₦53.75 (Bank Fee Expense)
    // Failed Transfer: -₦10,000
    // Reversal of Failed: +₦10,000
    const gtbCsv = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Nov-2026,01-Nov-2026,REF001,,200000.00,200000.00,SALARY INFLOW
02-Nov-2026,02-Nov-2026,REF002,50000.00,,150000.00,TRF TO KUDA / JOHN DOE / NIP:999888
02-Nov-2026,02-Nov-2026,REF003,53.75,,149946.25,TRANSFER CHARGE AND VAT
03-Nov-2026,03-Nov-2026,REF004,10000.00,,139946.25,TRF TO FAILED BENEFICIARY / REF 777
03-Nov-2026,03-Nov-2026,REF004,,10000.00,149946.25,FAILED NIP REVERSAL / REF 777
`.trim();

    await service.ingestStatement("user_gerald", gtb.id, gtbCsv, "gtb.csv");

    // Kuda:
    // Received internal transfer: +₦50,000 (Internal)
    // Grocery spending: -₦15,000
    const kudaCsv = `
Date,Description,Amount,Balance,Type,Reference
2026-11-02,NIP/999888/JOHN DOE/GTB,50000.00,50000.00,Credit,999888
2026-11-04,POS/WEB/DOMINOS PIZZA,15000.00,35000.00,Debit,REF005
`.trim();

    await service.ingestStatement("user_gerald", kuda.id, kudaCsv, "kuda.csv");

    const overview = await service.getFinancialOverview("user_gerald");

    // True income should be ₦200,000.00 (NOT ₦260,000.00)
    expect(overview.cashFlow.overall.grossIncomeAtoms).toBe(20000000n);
    expect(overview.cashFlow.overall.formattedIncome).toBe("₦200,000.00");

    // True spending should be ₦15,000 (Domino's) + ₦53.75 (Transfer fee) = ₦15,053.75 (NOT ₦75,053.75)
    expect(overview.cashFlow.overall.grossSpendingAtoms).toBe(1505375n);
    expect(overview.cashFlow.overall.formattedSpending).toBe("₦15,053.75");

    // Net cash flow: ₦200,000.00 - ₦15,053.75 = ₦184,946.25
    expect(overview.cashFlow.overall.netCashFlowAtoms).toBe(18494625n);
    expect(overview.cashFlow.overall.formattedNet).toBe("₦184,946.25");

    // Savings rate should be ~92.47%
    expect(overview.cashFlow.overall.savingsRatePercentage).toBeCloseTo(92.47, 1);

    // Internal transfers excluded count: GTB debit + Kuda credit = 2
    expect(overview.cashFlow.excludedInternalTransfersCount).toBe(2);
  });

  it("produces granular bank charges deep dive with supporting transaction references", async () => {
    const service = new MultiAccountFinancialIntelligenceService();

    const acc = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "058", name: "GTBank", type: "commercial_bank" },
      accountNumberMasked: "******1234",
      accountName: "GTB Main",
      currency: "NGN",
      accountType: "checking",
    });

    const statement = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Nov-2026,01-Nov-2026,F1,50.00,,10000.00,ELECTRONIC MONEY TRANSFER LEVY
02-Nov-2026,02-Nov-2026,F2,50.00,,9950.00,EMTL STAMP DUTY
03-Nov-2026,03-Nov-2026,F3,8.00,,9942.00,SMS ALERT CHARGE
04-Nov-2026,04-Nov-2026,F4,100.00,,9842.00,MONTHLY CARD MAINTENANCE CHARGE
05-Nov-2026,05-Nov-2026,F5,53.75,,9788.25,TRANSFER CHARGE AND VAT
`.trim();

    await service.ingestStatement("user_gerald", acc.id, statement, "charges.csv");

    const overview = await service.getFinancialOverview("user_gerald");
    const charges = overview.spending.bankCharges;

    expect(charges.chargeCount).toBe(5);
    expect(charges.totalBankChargesAtoms).toBe(26175n); // ₦50 + ₦50 + ₦8 + ₦100 + ₦53.75 = ₦261.75
    expect(charges.formattedTotal).toBe("₦261.75");

    // Check individual breakdowns
    const emtl = charges.breakdown.find((b) => b.chargeType === "stamp_duty_emtl")!;
    expect(emtl.count).toBe(2);
    expect(emtl.totalAtoms).toBe(10000n); // ₦100.00
    expect(emtl.transactionIds.length).toBe(2);

    const sms = charges.breakdown.find((b) => b.chargeType === "sms_alert")!;
    expect(sms.count).toBe(1);
    expect(sms.totalAtoms).toBe(800n); // ₦8.00

    const card = charges.breakdown.find((b) => b.chargeType === "card_maintenance")!;
    expect(card.count).toBe(1);
    expect(card.totalAtoms).toBe(10000n); // ₦100.00

    const trf = charges.breakdown.find((b) => b.chargeType === "transfer_fee_vat")!;
    expect(trf.count).toBe(1);
    expect(trf.totalAtoms).toBe(5375n); // ₦53.75
  });

  it("detects recurring subscription commitments and predicts next charge date", async () => {
    const service = new MultiAccountFinancialIntelligenceService();

    const acc = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "058", name: "GTBank", type: "commercial_bank" },
      accountNumberMasked: "******1234",
      accountName: "GTB Main",
      currency: "NGN",
      accountType: "checking",
    });

    // 3 successive monthly Netflix charges
    const statement = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Sep-2026,01-Sep-2026,NET01,4500.00,,90000.00,POS/WEB/NETFLIX.COM AMSTERDAM NL
01-Oct-2026,01-Oct-2026,NET02,4500.00,,85500.00,POS/WEB/NETFLIX.COM AMSTERDAM NL
01-Nov-2026,01-Nov-2026,NET03,4500.00,,81000.00,POS/WEB/NETFLIX.COM AMSTERDAM NL
`.trim();

    await service.ingestStatement("user_gerald", acc.id, statement, "netflix.csv");

    const overview = await service.getFinancialOverview("user_gerald");
    const recurring = overview.recurringCommitments;

    expect(recurring.length).toBe(1);
    const sub = recurring[0];
    expect(sub.merchantName).toContain("Netflix");
    expect(sub.cadence).toBe("monthly");
    expect(sub.isFixedAmount).toBe(true);
    expect(sub.averageAmountAtoms).toBe(450000n);
    expect(sub.occurrenceCount).toBe(3);
    expect(sub.predictedNextAt).toBeDefined();
  });

  it("evaluates data quality health score, missing statement periods, and stale accounts", async () => {
    const service = new MultiAccountFinancialIntelligenceService();

    const acc = await service.registerAccount({
      ownerId: "user_gerald",
      institution: { code: "058", name: "GTBank", type: "commercial_bank" },
      accountNumberMasked: "******1234",
      accountName: "GTB Main",
      currency: "NGN",
      accountType: "checking",
    });

    // Statement with a 60-day gap between transactions
    const statement = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Jan-2026,01-Jan-2026,R1,1000.00,,50000.00,GROCERIES
15-Mar-2026,15-Mar-2026,R2,2000.00,,48000.00,GROCERIES
`.trim();

    await service.ingestStatement("user_gerald", acc.id, statement, "gap.csv");

    const overview = await service.getFinancialOverview("user_gerald");
    const dq = overview.dataQuality;

    expect(dq.identifiedGaps.length).toBe(1);
    expect(dq.identifiedGaps[0].gapDays).toBeGreaterThan(60);
    expect(dq.warnings.length).toBeGreaterThan(0);
    expect(dq.overallHealthScore).toBeLessThan(100);
  });
});
