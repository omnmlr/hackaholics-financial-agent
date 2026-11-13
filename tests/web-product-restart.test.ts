/** Two independent Node processes and an on-disk database; no provider calls or signing. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("retains invoices and consumed signing authority across a process restart without resubmitting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agus-web-restart-"));
  const password = randomBytes(24).toString("hex"),
    salt = randomBytes(16).toString("hex");
  const script = `
    import {readFile,writeFile} from 'node:fs/promises';
    import {randomUUID} from 'node:crypto';
    import {Account,Asset,Keypair,Memo,Networks,Operation,TransactionBuilder} from '@stellar/stellar-base';
    import {db} from './src/lib/db.ts';
    import {workspace} from './src/lib/agent-workspace/store.ts';
    import {createInvoice,productSnapshot,completeOnboarding} from './src/lib/web-product/service.ts';
    import {preparePaymentIntent,updatePaymentPlan,quotePaymentPlan,approvePaymentPlan,claimPaymentSubmission,getPaymentPlan,listPaymentPlans} from './src/lib/web-product/conversational-payments.ts';
    globalThis.fetch=async()=>{throw new Error('Network forbidden in restart test')};
    const owner='web-restart-owner';
    if(process.argv[1]==='before') {
      await completeOnboarding(owner);
      const source=Keypair.random().publicKey(),recipient=Keypair.random().publicKey(),issuer=Keypair.random().publicKey();
      process.env.POLLAR_TESTNET_USDC_ISSUER=issuer;
      const invoice=await createInvoice(owner,{id:randomUUID(),title:'Fictional restart obligation',counterparty:'Fictional recipient',direction:'payable',currency:'USDC',amount:'10',dueAt:new Date(Date.now()+86400000).toISOString(),note:'Test only'});
      let plan=await preparePaymentIntent(owner,{id:randomUUID(),text:'Send Fictional recipient 10 USDC',privacyMode:false});
      plan=await updatePaymentPlan(owner,plan.id,{recipientLabel:'Fictional recipient',recipientAddress:recipient,amount:'10',asset:'USDC',privacy:false,invoiceId:invoice.id});
      const xdr=new TransactionBuilder(new Account(source,'1'),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.payment({destination:recipient,amount:'10',asset:new Asset('USDC',issuer)})).addMemo(Memo.text(plan.memo)).setTimeout(180).build().toXDR();
      plan=await quotePaymentPlan(owner,plan.id,xdr,source);
      const approved=await approvePaymentPlan(owner,plan.id,plan.reviewDigest,process.env.TEST_OPERATOR_PASSWORD);
      await claimPaymentSubmission(owner,plan.id,approved.nonce);
      // Model a process dying after authorization was consumed and before a wallet outcome.
      await writeFile(process.env.TEST_CONTROL_FILE,JSON.stringify({id:plan.id,invoiceId:invoice.id,nonce:approved.nonce}),{mode:0o600});
    } else {
      const saved=JSON.parse(await readFile(process.env.TEST_CONTROL_FILE,'utf8'));
      const plan=await getPaymentPlan(owner,saved.id);
      let duplicateRejected=false;
      try {await claimPaymentSubmission(owner,plan.id,saved.nonce)} catch(e) {duplicateRejected=e.status===403}
      const state=await productSnapshot(owner),tasks=(await workspace(owner).snapshot()).tasks;
      console.log(JSON.stringify({onboardingCompleted:state.preferences.onboardingCompleted,state:plan.state,approvalConsumed:!!plan.approval?.consumedAt,duplicateRejected,invoiceState:state.invoices.find(i=>i.id===saved.invoiceId).state,taskState:tasks.find(t=>t.id===saved.invoiceId).state,foreignPlans:(await listPaymentPlans('another-owner')).length}));
    }
    await (await db()).$client.close();
  `;
  function run(phase: string) {
    const child = spawnSync(
      process.execPath,
      ["--import=tsx", "--input-type=module", "-e", script, phase],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 25000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          DATABASE_URL: `pglite://${dir}/db`,
          PAYMENT_MODE: "fixture",
          AGUS_WORKSPACE_ENABLED: "true",
          OPERATOR_ID: "web-restart-owner",
          OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
          NEXT_PUBLIC_POLLAR_API_KEY: "pk_test_restart_only",
          TEST_OPERATOR_PASSWORD: password,
          TEST_CONTROL_FILE: join(dir, "control.json"),
        },
      },
    );
    if (child.status !== 0)
      throw new Error(`Restart verification failed: ${child.stderr}`);
    return child.stdout.trim();
  }
  try {
    run("before");
    expect(JSON.parse(run("after"))).toEqual({
      onboardingCompleted: true,
      state: "submitting",
      approvalConsumed: true,
      duplicateRejected: true,
      invoiceState: "open",
      taskState: "awaiting_approval",
      foreignPlans: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
