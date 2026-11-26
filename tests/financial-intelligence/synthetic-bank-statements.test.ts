import { describe, expect, it } from "vitest";
import { ingestStatementFile } from "../../src/lib/financial-intelligence/ingestion/engine";
import { formatMonetaryAmount } from "../../src/lib/financial-intelligence/types";

describe("Financial Intelligence - Synthetic Bank Statements Ingestion", () => {
  it("ingests realistic GTBank statement with Debits, Credits, and Remarks", () => {
    const gtbankCsv = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Nov-2026,01-Nov-2026,GT00123456,,250000.00,250000.00,SALARY/OCTOBER 2026 STIPEND
02-Nov-2026,02-Nov-2026,GT00123457,50.00,,249950.00,ELECTRONIC MONEY TRANSFER LEVY
03-Nov-2026,03-Nov-2026,GT00123458,4500.00,,245450.00,POS/WEB/DOMINOS PIZZA IKEJA
04-Nov-2026,04-Nov-2026,GT00123459,100000.00,,145450.00,TRF TO KUDA / 2001234567 / JOHN DOE
05-Nov-2026,05-Nov-2026,GT00123460,53.75,,145396.25,TRANSFER CHARGE AND VAT
06-Nov-2026,06-Nov-2026,GT00123461,4.00,,145392.25,SMS ALERT CHARGE
`.trim();

    const res = ingestStatementFile({
      content: gtbankCsv,
      fileName: "gtbank_november.csv",
      accountId: "acc_gtb_01",
      ownerId: "user_gerald",
      currency: "NGN",
    });

    expect(res.format).toBe("gtbank");
    expect(res.importedTransactions.length).toBe(6);

    const salary = res.importedTransactions.find((t) => t.category === "income")!;
    expect(salary.amountAtoms).toBe(25000000n); // ₦250,000.00
    expect(salary.status).toBe("posted");

    const emtl = res.importedTransactions.find((t) => t.rawDescription.includes("ELECTRONIC MONEY TRANSFER LEVY"))!;
    expect(emtl.category).toBe("bank_charges");
    expect(emtl.amountAtoms).toBe(-5000n); // -₦50.00

    const sms = res.importedTransactions.find((t) => t.rawDescription.includes("SMS ALERT"))!;
    expect(sms.category).toBe("bank_charges");
    expect(sms.amountAtoms).toBe(-400n); // -₦4.00
  });

  it("ingests realistic Access Bank statement with Debit, Credit, and Description", () => {
    const accessCsv = `
Trans. Date,Value Date,Description,Debit,Credit,Balance
01/11/2026,01/11/2026,OPENING BALANCE,,,10000.00
02/11/2026,02/11/2026,NIP/000013231102123456/DIVIDEND INFLOW/ACCESS,,75000.00,85000.00
03/11/2026,03/11/2026,AIRTIME PURCHASE MTN 08031234567,1000.00,,84000.00
04/11/2026,04/11/2026,MONTHLY CARD MAINTENANCE FEE,100.00,,83900.00
`.trim();

    const res = ingestStatementFile({
      content: accessCsv,
      fileName: "access_statement.csv",
      accountId: "acc_access_01",
      ownerId: "user_gerald",
      currency: "NGN",
    });

    expect(res.format).toBe("access_bank");
    expect(res.importedTransactions.length).toBe(3); // Opening balance row has 0 debit and 0 credit, skipped

    const airtime = res.importedTransactions.find((t) => t.rawDescription.includes("AIRTIME"))!;
    expect(airtime.category).toBe("utilities");
    expect(airtime.amountAtoms).toBe(-100000n); // -₦1,000.00

    const cardMaint = res.importedTransactions.find((t) => t.rawDescription.includes("CARD MAINTENANCE"))!;
    expect(cardMaint.category).toBe("bank_charges");
    expect(cardMaint.amountAtoms).toBe(-10000n); // -₦100.00
  });

  it("ingests realistic Kuda statement with Type, Description, and Amount", () => {
    const kudaCsv = `
Date,Description,Amount,Balance,Type
2026-11-04,Transfer from John Doe GTBank,100000.00,105000.00,Credit
2026-11-05,Netflix Subscription,4500.00,100500.00,Debit
2026-11-06,Electricity Ikeja Electric DISCO,12000.00,88500.00,Debit
`.trim();

    const res = ingestStatementFile({
      content: kudaCsv,
      fileName: "kuda_statement.csv",
      accountId: "acc_kuda_01",
      ownerId: "user_gerald",
      currency: "NGN",
    });

    expect(res.format).toBe("kuda");
    expect(res.importedTransactions.length).toBe(3);

    const transferIn = res.importedTransactions[0];
    expect(transferIn.amountAtoms).toBe(10000000n); // +₦100,000.00

    const netflix = res.importedTransactions[1];
    expect(netflix.amountAtoms).toBe(-450000n); // -₦4,500.00
    expect(netflix.cleanDescription).toContain("Netflix");

    const electricity = res.importedTransactions[2];
    expect(electricity.amountAtoms).toBe(-1200000n); // -₦12,000.00
    expect(electricity.category).toBe("utilities");
  });

  it("ingests realistic Moniepoint statement with Session ID and Fee column", () => {
    const moniepointCsv = `
Date & Time,Transaction Type,Amount,Fee,Beneficiary/Sender,Status,Session ID
01-Nov-2026 10:15:00,Transfer,20000.00,10.00,Mama T's Kitchen,Successful,100004261101101500
02-Nov-2026 12:30:00,Deposit,50000.00,0.00,Client Payment Co,Successful,100004261102123000
`.trim();

    const res = ingestStatementFile({
      content: moniepointCsv,
      fileName: "moniepoint.csv",
      accountId: "acc_moniepoint_01",
      ownerId: "user_gerald",
      currency: "NGN",
    });

    expect(res.format).toBe("moniepoint");
    expect(res.importedTransactions.length).toBe(2);

    const food = res.importedTransactions[0];
    expect(food.amountAtoms).toBe(-2000000n); // debit -₦20,000
    expect(food.reference).toBe("100004261101101500");

    const deposit = res.importedTransactions[1];
    expect(deposit.amountAtoms).toBe(5000000n); // credit +₦50,000
  });

  it("ingests multi-currency statements (USD / USDC) with correct scaling", () => {
    const usdCsv = `
Date,Description,Amount,Type
2026-11-01,Client Wire Payment,1500.00,Credit
2026-11-02,AWS Cloud Hosting,240.50,Debit
`.trim();

    const resUsd = ingestStatementFile({
      content: usdCsv,
      fileName: "usd_mercury.csv",
      accountId: "acc_usd_01",
      ownerId: "user_gerald",
      currency: "USD",
    });

    expect(resUsd.importedTransactions[0].amountAtoms).toBe(150000n); // $1,500.00 (cents)
    expect(formatMonetaryAmount(resUsd.importedTransactions[0].amountAtoms, "USD")).toBe("$1,500.00");
    expect(resUsd.importedTransactions[1].amountAtoms).toBe(-24050n); // -$240.50

    const usdcCsv = `
Date,Description,Amount,Type
2026-11-01,Solana USDC Grant Inflow,5000.000000,Credit
2026-11-02,Solana Escrow Funding,250.123456,Debit
`.trim();

    const resUsdc = ingestStatementFile({
      content: usdcCsv,
      fileName: "usdc_phantom.csv",
      accountId: "acc_usdc_01",
      ownerId: "user_gerald",
      currency: "USDC",
    });

    expect(resUsdc.importedTransactions[0].amountAtoms).toBe(5000000000n); // 5000 * 10^6
    expect(resUsdc.importedTransactions[1].amountAtoms).toBe(-250123456n);
    expect(formatMonetaryAmount(resUsdc.importedTransactions[0].amountAtoms, "USDC")).toBe("5,000.000000 USDC");
  });
});
