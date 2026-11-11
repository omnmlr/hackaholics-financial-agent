#![cfg(feature = "bank-tests")]
//! Local Solana bank + actual SPL Token CPI tests, with native or compiled-SBF
//! escrow selected explicitly. All balances and signatures belong to an isolated
//! local bank. Neither mode constitutes genuine Devnet acceptance.
use agus_devnet_escrow::{accounts, instruction, Escrow, State, Terms, TEST_USDC};
use anchor_lang::solana_program::{account_info::AccountInfo, entrypoint::ProgramResult};
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token::spl_token::{
    self,
    state::{Account as TokenAccount, AccountState, Mint},
};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    program_option::COption,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program, sysvar,
    transaction::Transaction,
};

fn entry(program: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // Anchor ties the slice borrow to AccountInfo's inner lifetime. ProgramTest
    // supplies both for this synchronous invocation; no account escapes entry.
    let accounts = unsafe { std::mem::transmute(accounts) };
    agus_devnet_escrow::entry(program, accounts, data)
}
struct Bank {
    ctx: ProgramTestContext,
    seller: Keypair,
    buyer: Keypair,
    verifier: Keypair,
    arbitrators: [Keypair; 3],
    stranger: Keypair,
    source: Pubkey,
    destination: Pubkey,
    sequence: u32,
}
fn token_account(owner: Pubkey, amount: u64) -> Account {
    let state = TokenAccount {
        mint: TEST_USDC,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0; TokenAccount::LEN];
    TokenAccount::pack(state, &mut data).unwrap();
    Account {
        lamports: 3_000_000,
        data,
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}
impl Bank {
    async fn new() -> Self {
        let seller = Keypair::new();
        let buyer = Keypair::new();
        let verifier = Keypair::new();
        let stranger = Keypair::new();
        let arbitrators = [Keypair::new(), Keypair::new(), Keypair::new()];
        let source = Pubkey::new_unique();
        let destination = Pubkey::new_unique();
        let mut p = if std::env::var_os("AGUS_ESCROW_SBF_TEST").is_some() {
            ProgramTest::new("agus_devnet_escrow", agus_devnet_escrow::ID, None)
        } else {
            ProgramTest::new(
                "agus_devnet_escrow",
                agus_devnet_escrow::ID,
                processor!(entry),
            )
        };
        // Only escrow changes between native and SBF runs. SPL Token remains
        // its actual native processor, invoked through the bank's CPI runtime.
        p.prefer_bpf(false);
        p.add_program(
            "spl_token",
            spl_token::id(),
            processor!(spl_token::processor::Processor::process),
        );
        for key in [
            &seller,
            &buyer,
            &verifier,
            &stranger,
            &arbitrators[0],
            &arbitrators[1],
            &arbitrators[2],
        ] {
            p.add_account(
                key.pubkey(),
                Account::new(1_000_000_000, 0, &system_program::ID),
            );
        }
        let mint = Mint {
            mint_authority: COption::None,
            supply: 10_000_000,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        };
        let mut data = vec![0; Mint::LEN];
        Mint::pack(mint, &mut data).unwrap();
        p.add_account(
            TEST_USDC,
            Account {
                lamports: 3_000_000,
                data,
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        p.add_account(source, token_account(seller.pubkey(), 10_000_000));
        p.add_account(destination, token_account(buyer.pubkey(), 0));
        Self {
            ctx: p.start_with_context().await,
            seller,
            buyer,
            verifier,
            arbitrators,
            stranger,
            source,
            destination,
            sequence: 0,
        }
    }
    fn addresses(&self, digest: [u8; 32]) -> (Pubkey, Pubkey) {
        let (escrow, _) = Pubkey::find_program_address(
            &[b"order", self.seller.pubkey().as_ref(), &digest],
            &agus_devnet_escrow::ID,
        );
        let (vault, _) =
            Pubkey::find_program_address(&[b"vault", escrow.as_ref()], &agus_devnet_escrow::ID);
        (escrow, vault)
    }
    fn fund(&self, digest: [u8; 32]) -> Instruction {
        let (escrow, vault) = self.addresses(digest);
        Instruction {
            program_id: agus_devnet_escrow::ID,
            accounts: accounts::Fund {
                seller: self.seller.pubkey(),
                buyer: self.buyer.pubkey(),
                mint: TEST_USDC,
                seller_source: self.source,
                buyer_destination: self.destination,
                escrow,
                vault,
                token_program: spl_token::id(),
                system_program: system_program::ID,
                rent: sysvar::rent::ID,
            }
            .to_account_metas(None),
            data: instruction::Fund {
                terms: Terms {
                    digest,
                    amount: 1_000_000,
                    verifier: self.verifier.pubkey(),
                    arbitrators: self.arbitrators.each_ref().map(|k| k.pubkey()),
                },
            }
            .data(),
        }
    }
    fn transfer(&self, digest: [u8; 32], release: bool) -> accounts::Transfer {
        let (escrow, vault) = self.addresses(digest);
        accounts::Transfer {
            escrow,
            vault,
            mint: TEST_USDC,
            destination: if release {
                self.destination
            } else {
                self.source
            },
            token_program: spl_token::id(),
        }
    }
    async fn send(&mut self, ix: Instruction, who: &[&str]) -> bool {
        self.sequence += 1;
        let mut signers: Vec<&Keypair> = vec![&self.ctx.payer];
        for name in who {
            signers.push(match *name {
                "seller" => &self.seller,
                "buyer" => &self.buyer,
                "verifier" => &self.verifier,
                "a" => &self.arbitrators[0],
                "b" => &self.arbitrators[1],
                "c" => &self.arbitrators[2],
                _ => &self.stranger,
            });
        }
        let unique = solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(
            200_000 + self.sequence,
        );
        let blockhash = self.ctx.banks_client.get_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[unique, ix],
            Some(&self.ctx.payer.pubkey()),
            &signers,
            blockhash,
        );
        self.ctx.banks_client.process_transaction(tx).await.is_ok()
    }
    async fn balance(&mut self, key: Pubkey) -> u64 {
        TokenAccount::unpack(
            &self
                .ctx
                .banks_client
                .get_account(key)
                .await
                .unwrap()
                .unwrap()
                .data,
        )
        .unwrap()
        .amount
    }
    async fn state(&mut self, digest: [u8; 32]) -> Escrow {
        let key = self.addresses(digest).0;
        let a = self
            .ctx
            .banks_client
            .get_account(key)
            .await
            .unwrap()
            .unwrap();
        Escrow::try_deserialize(&mut a.data.as_slice()).unwrap()
    }
}
#[tokio::test]
async fn fund_release_replay_destinations_and_independent_verifier() {
    let mut b = Bank::new().await;
    let d = [1; 32];
    let ix = b.fund(d);
    assert!(b.send(ix.clone(), &["seller"]).await);
    let vault = b.addresses(d).1;
    assert_eq!(b.balance(vault).await, 1_000_000);
    assert_eq!(b.balance(b.source).await, 9_000_000);
    assert!(!b.send(ix, &["seller"]).await);
    let mut release = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::CooperativeRelease {
            transfer: b.transfer(d, true),
            seller: b.seller.pubkey(),
            verifier: b.stranger.pubkey(),
        }
        .to_account_metas(None),
        data: instruction::CooperativeRelease {}.data(),
    };
    assert!(!b.send(release.clone(), &["seller", "stranger"]).await);
    release.accounts = accounts::CooperativeRelease {
        transfer: b.transfer(d, true),
        seller: b.seller.pubkey(),
        verifier: b.verifier.pubkey(),
    }
    .to_account_metas(None);
    let mut missing = release.clone();
    missing.accounts.last_mut().unwrap().is_signer = false;
    assert!(!b.send(missing, &["seller"]).await);
    let mut redirected = release.clone();
    redirected.accounts[3].pubkey = b.source;
    assert!(!b.send(redirected, &["seller", "verifier"]).await);
    assert_eq!(b.balance(vault).await, 1_000_000);
    assert!(b.send(release.clone(), &["seller", "verifier"]).await);
    assert_eq!(b.balance(b.destination).await, 1_000_000);
    assert_eq!(b.balance(vault).await, 0);
    assert!(b.state(d).await.state == State::Released);
    assert!(!b.send(release, &["seller", "verifier"]).await);
    assert_eq!(b.balance(b.destination).await, 1_000_000);
}
#[tokio::test]
async fn disputes_fixed_two_of_three_and_mutual_cancellation() {
    let mut b = Bank::new().await;
    let d = [2; 32];
    assert!(b.send(b.fund(d), &["seller"]).await);
    // Advancing the clock has no withdrawal effect; there is no clock-refund instruction.
    b.ctx.warp_to_slot(1000).unwrap();
    assert_eq!(b.balance(b.addresses(d).1).await, 1_000_000);
    let dispute = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::Dispute {
            escrow: b.addresses(d).0,
            party: b.buyer.pubkey(),
        }
        .to_account_metas(None),
        data: instruction::Dispute {}.data(),
    };
    assert!(b.send(dispute, &["buyer"]).await);
    let mut arb = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::Arbitrate {
            transfer: b.transfer(d, false),
            first: b.arbitrators[0].pubkey(),
            second: b.arbitrators[0].pubkey(),
        }
        .to_account_metas(None),
        data: instruction::Arbitrate { release: false }.data(),
    };
    assert!(!b.send(arb.clone(), &["a"]).await);
    arb.accounts = accounts::Arbitrate {
        transfer: b.transfer(d, false),
        first: b.arbitrators[0].pubkey(),
        second: b.stranger.pubkey(),
    }
    .to_account_metas(None);
    assert!(!b.send(arb.clone(), &["a", "stranger"]).await);
    arb.accounts = accounts::Arbitrate {
        transfer: b.transfer(d, false),
        first: b.arbitrators[0].pubkey(),
        second: b.arbitrators[2].pubkey(),
    }
    .to_account_metas(None);
    assert!(b.send(arb.clone(), &["a", "c"]).await);
    assert!(b.state(d).await.state == State::Refunded);
    assert_eq!(b.balance(b.source).await, 10_000_000);
    assert!(!b.send(arb, &["a", "c"]).await);
    let d = [3; 32];
    assert!(b.send(b.fund(d), &["seller"]).await);
    let cancel = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::MutualCancel {
            transfer: b.transfer(d, false),
            buyer: b.buyer.pubkey(),
            seller: b.seller.pubkey(),
        }
        .to_account_metas(None),
        data: instruction::MutualCancel {}.data(),
    };
    let mut one = cancel.clone();
    one.accounts[5].is_signer = false;
    assert!(!b.send(one, &["seller"]).await);
    assert!(b.send(cancel.clone(), &["buyer", "seller"]).await);
    assert_eq!(b.balance(b.source).await, 10_000_000);
    assert!(!b.send(cancel, &["buyer", "seller"]).await);
}
#[tokio::test]
async fn invalid_terms_mint_destination_and_arbitrated_release() {
    let mut b = Bank::new().await;
    let d = [4; 32];
    let mut zero = b.fund(d);
    zero.data[40..48].fill(0);
    assert!(!b.send(zero, &["seller"]).await);
    let mut duplicate = b.fund(d);
    duplicate.data.copy_within(80..112, 112);
    assert!(!b.send(duplicate, &["seller"]).await);
    let mut wrong_mint = b.fund(d);
    wrong_mint.accounts[2].pubkey = b.source;
    assert!(!b.send(wrong_mint, &["seller"]).await);
    let mut wrong_destination = b.fund(d);
    wrong_destination.accounts[4].pubkey = b.source;
    assert!(!b.send(wrong_destination, &["seller"]).await);
    assert_eq!(b.balance(b.source).await, 10_000_000);
    assert!(b
        .ctx
        .banks_client
        .get_account(b.addresses(d).0)
        .await
        .unwrap()
        .is_none());
    assert!(b.send(b.fund(d), &["seller"]).await);
    let arb = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::Arbitrate {
            transfer: b.transfer(d, true),
            first: b.arbitrators[0].pubkey(),
            second: b.arbitrators[1].pubkey(),
        }
        .to_account_metas(None),
        data: instruction::Arbitrate { release: true }.data(),
    };
    assert!(!b.send(arb.clone(), &["a", "b"]).await);
    let dispute = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::Dispute {
            escrow: b.addresses(d).0,
            party: b.seller.pubkey(),
        }
        .to_account_metas(None),
        data: instruction::Dispute {}.data(),
    };
    assert!(b.send(dispute, &["seller"]).await);
    assert!(b.send(arb, &["a", "b"]).await);
    assert_eq!(b.balance(b.destination).await, 1_000_000);
}

#[tokio::test]
async fn unused_counterparty_account_cannot_block_arbitration() {
    let mut b = Bank::new().await;
    let d = [5; 32];
    assert!(b.send(b.fund(d), &["seller"]).await);
    let change = spl_token::instruction::set_authority(
        &spl_token::id(),
        &b.source,
        Some(&b.stranger.pubkey()),
        spl_token::instruction::AuthorityType::AccountOwner,
        &b.seller.pubkey(),
        &[],
    )
    .unwrap();
    assert!(b.send(change, &["seller"]).await);
    let dispute = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::Dispute {
            escrow: b.addresses(d).0,
            party: b.buyer.pubkey(),
        }
        .to_account_metas(None),
        data: instruction::Dispute {}.data(),
    };
    assert!(b.send(dispute, &["buyer"]).await);
    let release = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::Arbitrate {
            transfer: b.transfer(d, true),
            first: b.arbitrators[0].pubkey(),
            second: b.arbitrators[1].pubkey(),
        }
        .to_account_metas(None),
        data: instruction::Arbitrate { release: true }.data(),
    };
    assert!(b.send(release, &["a", "b"]).await);
    assert_eq!(b.balance(b.destination).await, 1_000_000);
    let mut b = Bank::new().await;
    let d = [6; 32];
    assert!(b.send(b.fund(d), &["seller"]).await);
    let close = spl_token::instruction::close_account(
        &spl_token::id(),
        &b.destination,
        &b.buyer.pubkey(),
        &b.buyer.pubkey(),
        &[],
    )
    .unwrap();
    assert!(b.send(close, &["buyer"]).await);
    let dispute = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::Dispute {
            escrow: b.addresses(d).0,
            party: b.seller.pubkey(),
        }
        .to_account_metas(None),
        data: instruction::Dispute {}.data(),
    };
    assert!(b.send(dispute, &["seller"]).await);
    let refund = Instruction {
        program_id: agus_devnet_escrow::ID,
        accounts: accounts::Arbitrate {
            transfer: b.transfer(d, false),
            first: b.arbitrators[0].pubkey(),
            second: b.arbitrators[2].pubkey(),
        }
        .to_account_metas(None),
        data: instruction::Arbitrate { release: false }.data(),
    };
    assert!(b.send(refund, &["a", "c"]).await);
    assert_eq!(b.balance(b.source).await, 10_000_000);
}
