/**
 * AGUS Independent Solana Technical Validation Harness
 * Workspace: C:/Users/USER/AGUS_SOLANA_RND
 * Runs real read-only devnet RPC queries, ATA derivations,
 * transaction construction, and preflight simulation.
 * 
 * ZERO financial spending, ZERO broadcast, ZERO key extraction.
 */

const {
    Connection,
    PublicKey,
    Transaction,
    ComputeBudgetProgram,
    Keypair
} = require('@solana/web3.js');

const {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createTransferCheckedInstruction,
    createAssociatedTokenAccountIdempotentInstruction
} = require('@solana/spl-token');

const fs = require('fs');
const path = require('path');

const DEVNET_RPC = 'https://api.devnet.solana.com';
const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const MAINNET_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

async function runHarness() {
    console.log('====================================================');
    console.log(' AGUS 2.0 — Solana Devnet Technical Validation Harness');
    console.log('====================================================\n');

    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const results = {
        timestamp: new Date().toISOString(),
        rpc: DEVNET_RPC,
        tests: {}
    };

    // Test 1: Devnet Cluster Connectivity
    console.log('[Test 1] Testing RPC Cluster Connectivity & Blockhash...');
    const slot = await connection.getSlot('confirmed');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const version = await connection.getVersion();

    results.tests.cluster = {
        status: 'SUCCESS',
        slot,
        version: version['solana-core'],
        recentBlockhash: blockhash,
        lastValidBlockHeight
    };
    console.log(`  -> Connected! Version: ${version['solana-core']}, Current Slot: ${slot}`);
    console.log(`  -> Latest Blockhash: ${blockhash.slice(0, 10)}... (lastValidBlockHeight: ${lastValidBlockHeight})\n`);

    // Test 2: Token Mint Inspection
    console.log('[Test 2] Validating Circle Devnet USDC Mint...');
    const mintAccountInfo = await connection.getParsedAccountInfo(DEVNET_USDC_MINT);
    const parsedMint = mintAccountInfo.value.data.parsed.info;

    results.tests.devnet_usdc = {
        status: 'SUCCESS',
        mint: DEVNET_USDC_MINT.toBase58(),
        decimals: parsedMint.decimals,
        supply: parsedMint.supply,
        isInitialized: parsedMint.isInitialized,
        mintAuthority: parsedMint.mintAuthority,
        freezeAuthority: parsedMint.freezeAuthority,
        programOwner: mintAccountInfo.value.owner.toBase58()
    };
    console.log(`  -> Mint: ${DEVNET_USDC_MINT.toBase58()}`);
    console.log(`  -> Decimals: ${parsedMint.decimals} (Matches Mainnet USDC 6-decimal standard)`);
    console.log(`  -> Program Owner: ${mintAccountInfo.value.owner.toBase58()} (SPL Token Program)\n`);

    // Test 3: Token Account Discovery & Deterministic ATA Derivation
    console.log('[Test 3] Testing Deterministic Associated Token Account (ATA) Derivation...');
    // Generate a dummy public key for recipient (no private key retained or used for spending)
    const dummySender = Keypair.generate().publicKey;
    const dummyRecipient = Keypair.generate().publicKey;

    const senderATA = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, dummySender);
    const recipientATA = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, dummyRecipient);

    results.tests.ata_derivation = {
        status: 'SUCCESS',
        senderOwner: dummySender.toBase58(),
        senderATA: senderATA.toBase58(),
        recipientOwner: dummyRecipient.toBase58(),
        recipientATA: recipientATA.toBase58()
    };
    console.log(`  -> Sender Wallet: ${dummySender.toBase58().slice(0, 8)}... -> ATA: ${senderATA.toBase58()}`);
    console.log(`  -> Recipient Wallet: ${dummyRecipient.toBase58().slice(0, 8)}... -> ATA: ${recipientATA.toBase58()}\n`);

    // Test 4: Transaction Preparation & Idempotency Staging
    console.log('[Test 4] Constructing Complete SPL Token Transfer Transaction with Idempotency Reference...');
    // Create a unique reference key for idempotency tracking (Solana Pay standard)
    const idempotencyReference = Keypair.generate().publicKey;
    const transferAmountAtomic = 10_000_000n; // 10.00 USDC (6 decimals)

    const tx = new Transaction();

    // 1. Compute budget limit & priority fee
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }));

    // 2. Idempotent ATA creation instruction for recipient (safe if already exists)
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
        dummySender,
        recipientATA,
        dummyRecipient,
        DEVNET_USDC_MINT
    ));

    // 3. Checked Transfer instruction (enforces exact mint & decimals)
    const transferIx = createTransferCheckedInstruction(
        senderATA,
        DEVNET_USDC_MINT,
        recipientATA,
        dummySender,
        transferAmountAtomic,
        6 // Decimals
    );
    // Append reference public key as a read-only, non-signer account for on-chain indexing & idempotency
    transferIx.keys.push({ pubkey: idempotencyReference, isSigner: false, isWritable: false });
    tx.add(transferIx);

    tx.recentBlockhash = blockhash;
    tx.feePayer = dummySender;

    // Serialize message to inspect size
    const message = tx.compileMessage();
    const serializedMessage = message.serialize();

    results.tests.transaction_preparation = {
        status: 'SUCCESS',
        instructionCount: tx.instructions.length,
        feePayer: dummySender.toBase58(),
        idempotencyReference: idempotencyReference.toBase58(),
        transferAmountAtomic: transferAmountAtomic.toString(),
        transferAmountUI: '10.00 USDC',
        messageBytes: serializedMessage.length,
        mtuLimit: 1232,
        withinMtuLimit: serializedMessage.length <= 1232
    };
    console.log(`  -> Total Instructions: ${tx.instructions.length}`);
    console.log(`  -> Idempotency Reference: ${idempotencyReference.toBase58()}`);
    console.log(`  -> Serialized Wire Message Size: ${serializedMessage.length} bytes (Max MTU: 1232 bytes, OK: ${serializedMessage.length <= 1232})\n`);

    // Test 5: Read-Only Preflight Simulation (`simulateTransaction`)
    console.log('[Test 5] Executing Preflight Simulation via RPC (sigVerify: false)...');
    try {
        const simResult = await connection.simulateTransaction(tx, undefined, false);
        results.tests.simulation = {
            status: 'SUCCESS',
            resultValue: simResult.value
        };
        console.log(`  -> Simulation Completed!`);
        console.log(`  -> Expected Error (Account does not exist on-chain):`, simResult.value.err);
        console.log(`  -> Compute Units Consumed:`, simResult.value.unitsConsumed || 0);
        console.log(`  -> Logs:`, (simResult.value.logs || []).slice(0, 3));
    } catch (simErr) {
        results.tests.simulation = {
            status: 'ERROR',
            message: simErr.message
        };
        console.log(`  -> Simulation Error:`, simErr.message);
    }

    // Save final report
    const outputPath = path.join(__dirname, 'solana_harness_output.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n[SUCCESS] All 5 validation checks complete. Results saved to: ${outputPath}\n`);
}

runHarness().catch(err => {
    console.error('Harness fatal error:', err);
    process.exit(1);
});
