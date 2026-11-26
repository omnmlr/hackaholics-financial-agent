use agus_devnet_escrow::{accounts, instruction, Escrow, State, Terms, TEST_USDC};
use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountSerialize, InstructionData, ToAccountMetas};
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn encoded(
    data: Vec<u8>,
    keys: Vec<anchor_lang::solana_program::instruction::AccountMeta>,
) -> String {
    let metas = keys
        .iter()
        .map(|k| {
            format!(
                "{{\"address\":\"{}\",\"signer\":{},\"writable\":{}}}",
                k.pubkey, k.is_signer, k.is_writable
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"dataHex\":\"{}\",\"keys\":[{}]}}", hex(&data), metas)
}
fn main() {
    let seller = Pubkey::new_from_array([1; 32]);
    let buyer = Pubkey::new_from_array([2; 32]);
    let source = Pubkey::new_from_array([3; 32]);
    let destination = Pubkey::new_from_array([4; 32]);
    let verifier = Pubkey::new_from_array([5; 32]);
    let arbitrators = [
        Pubkey::new_from_array([6; 32]),
        Pubkey::new_from_array([7; 32]),
        Pubkey::new_from_array([8; 32]),
    ];
    let digest = [9; 32];
    let (escrow, bump) = Pubkey::find_program_address(
        &[b"order", seller.as_ref(), &digest],
        &agus_devnet_escrow::ID,
    );
    let (vault, _) =
        Pubkey::find_program_address(&[b"vault", escrow.as_ref()], &agus_devnet_escrow::ID);
    let keys = accounts::Fund {
        seller,
        buyer,
        mint: TEST_USDC,
        seller_source: source,
        buyer_destination: destination,
        escrow,
        vault,
        token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        rent: anchor_lang::solana_program::sysvar::rent::ID,
    }
    .to_account_metas(None);
    let data = instruction::Fund {
        terms: Terms {
            digest,
            amount: 1_000_000,
            verifier,
            arbitrators,
        },
    }
    .data();
    let mut account = Vec::new();
    Escrow {
        digest,
        buyer,
        seller,
        buyer_destination: destination,
        seller_refund: source,
        verifier,
        arbitrators,
        amount: 1_000_000,
        bump,
        state: State::Funded,
        simulated_verifier: true,
    }
    .try_serialize(&mut account)
    .unwrap();
    let metas = keys
        .iter()
        .map(|k| {
            format!(
                "{{\"address\":\"{}\",\"signer\":{},\"writable\":{}}}",
                k.pubkey, k.is_signer, k.is_writable
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let prefix=format!("{{\"source\":\"Anchor 0.31.1 Rust serializer; synthetic addresses only\",\"terms\":{{\"digest\":\"{}\",\"amountAtoms\":\"1000000\",\"buyer\":\"{}\",\"seller\":\"{}\",\"buyerDestination\":\"{}\",\"sellerSource\":\"{}\",\"verifier\":\"{}\",\"arbitrators\":[\"{}\",\"{}\",\"{}\"]}},\"escrow\":\"{}\",\"vault\":\"{}\",\"fundDataHex\":\"{}\",\"accountHex\":\"{}\",\"keys\":[{}]}}",hex(&digest),buyer,seller,destination,source,verifier,arbitrators[0],arbitrators[1],arbitrators[2],escrow,vault,hex(&data),hex(&account),metas);
    let transfer = |release| accounts::Transfer {
        escrow,
        vault,
        mint: TEST_USDC,
        destination: if release { destination } else { source },
        token_program: anchor_spl::token::ID,
    };
    let release = encoded(
        instruction::CooperativeRelease {}.data(),
        accounts::CooperativeRelease {
            transfer: transfer(true),
            seller,
            verifier,
        }
        .to_account_metas(None),
    );
    let cancel = encoded(
        instruction::MutualCancel {}.data(),
        accounts::MutualCancel {
            transfer: transfer(false),
            buyer,
            seller,
        }
        .to_account_metas(None),
    );
    let arbitrate_release = encoded(
        instruction::Arbitrate { release: true }.data(),
        accounts::Arbitrate {
            transfer: transfer(true),
            first: arbitrators[0],
            second: arbitrators[2],
        }
        .to_account_metas(None),
    );
    let arbitrate_refund = encoded(
        instruction::Arbitrate { release: false }.data(),
        accounts::Arbitrate {
            transfer: transfer(false),
            first: arbitrators[0],
            second: arbitrators[2],
        }
        .to_account_metas(None),
    );
    let dispute = encoded(
        instruction::Dispute {}.data(),
        accounts::Dispute {
            escrow,
            party: buyer,
        }
        .to_account_metas(None),
    );
    print!("{}", prefix.strip_suffix('}').unwrap());
    println!(",\"release\":{},\"cancel\":{},\"arbitrateRelease\":{},\"arbitrateRefund\":{},\"dispute\":{}}}",release,cancel,arbitrate_release,arbitrate_refund,dispute);
}
