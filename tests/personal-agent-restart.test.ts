/** Real independent processes/on-disk SQL, scripted model, zero external calls. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
it("recovers a crash between a proposal commit and journal acknowledgement without duplicating the memory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agus-engine-restart-"));
  const script = `
 import {sql} from 'drizzle-orm';
 import {db} from './src/lib/db.ts';
 import {workspace} from './src/lib/agent-workspace/store.ts';
 import {runJournal} from './src/lib/personal-agent/journal.ts';
 import {createPersonalAgent,executionKey} from './src/lib/personal-agent/engine.ts';
 import {z} from 'zod';
 const id='bf5bec49-9333-4983-8b81-183c40e7ed1d',owner='restart-owner';
 const args={text:'Gerald proposed a follow-up',category:'agreement'};
 const schema=z.strictObject({text:z.string(),category:z.literal('agreement')});
 const journal=runJournal(owner),store=workspace(owner);
 if(process.argv[1]==='crash'){
   const run=await journal.create({id,conversationId:'restart-chat',goal:'Remember the proposed follow-up',accountIds:[]});
   const {lease}=await journal.claim(id);
   const key=executionKey(id,'save_note',args);
   await journal.update(id,lease,{step:{sequence:1,key,name:'save_note',effect:'proposal',state:'started',startedAt:new Date().toISOString()}});
   await store.proposeMemory(args,key);
   // Model a dead process whose lease has elapsed, without a blocking 90-second sleep.
   await (await db()).execute(sql\x60UPDATE agus2_agent_runs SET lease_until=now()-interval '1 second' WHERE owner=\x24{owner} AND id=\x24{id}\x60);
 }else{
   let generations=0,proposals=0;
   const model={provider:'scripted',model:'scripted',generate:async input=>{
     const text=input.responseJsonSchema?'{"grounded":true}':'The memory proposal is saved; please confirm it.';
     if(!input.responseJsonSchema&&generations++===0){const call={name:'save_note',id:'new-native-call-id',args};return {text:'',content:{role:'model',parts:[{functionCall:call}]},calls:[call]};}
     return {text,content:{role:'model',parts:[{text}]},calls:[]};
   }};
   const tool={declaration:{name:'save_note',parametersJsonSchema:{}},schema,effect:'proposal',idempotent:true,execute:async(args,ctx)=>{proposals++;const memory=await store.proposeMemory(args,ctx.key);return {summary:'Memory proposed; awaiting human confirmation',data:memory,awaitingUser:true};}};
   const result=await createPersonalAgent({model,journal,tools:[tool]}).run({id,resume:true});
   const saved=await journal.read(id),memories=(await store.snapshot()).memories;
   console.log(JSON.stringify({state:result.execution.state,memories:memories.length,confirmed:memories[0].confirmed,states:saved.steps.map(s=>s.state),proposals}));
 }
 await (await db()).$client.close();`;
  function run(phase: string) {
    const child = spawnSync(
      process.execPath,
      ["--import=tsx", "--input-type=module", "-e", script, phase],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          DATABASE_URL: `pglite://${directory}/db`,
          PAYMENT_MODE: "fixture",
          AGUS_WORKSPACE_ENABLED: "true",
        },
      },
    );
    if (child.status !== 0)
      throw new Error(`Restart child failed: ${child.stderr}`);
    return child.stdout.trim();
  }
  try {
    run("crash");
    expect(JSON.parse(run("recover"))).toEqual({
      state: "waiting_user",
      memories: 1,
      confirmed: false,
      states: ["unknown", "succeeded"],
      proposals: 1,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
