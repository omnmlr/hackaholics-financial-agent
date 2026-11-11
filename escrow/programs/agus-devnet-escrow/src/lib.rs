#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("AYCkNeJSmk99TSDYq7tH7yRmAfv64vw6vA6SvT732yCi");
pub const TEST_USDC: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

#[program]
pub mod agus_devnet_escrow {
    use super::*;

    pub fn fund(ctx: Context<Fund>, terms: Terms) -> Result<()> {
        terms.validate(ctx.accounts.buyer.key(), ctx.accounts.seller.key())?;
        let e = &mut ctx.accounts.escrow;
        e.digest = terms.digest;
        e.buyer = ctx.accounts.buyer.key();
        e.seller = ctx.accounts.seller.key();
        e.buyer_destination = ctx.accounts.buyer_destination.key();
        e.seller_refund = ctx.accounts.seller_source.key();
        e.verifier = terms.verifier;
        e.arbitrators = terms.arbitrators;
        e.amount = terms.amount;
        e.bump = ctx.bumps.escrow;
        e.state = State::Funded;
        // This verifier is a prototype simulation, never bank-settlement proof.
        e.simulated_verifier = true;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.seller_source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            terms.amount,
            6,
        )
    }

    pub fn cooperative_release(ctx: Context<CooperativeRelease>) -> Result<()> {
        require!(
            ctx.accounts.transfer.escrow.state == State::Funded,
            EscrowError::WrongState
        );
        require_keys_eq!(
            ctx.accounts.seller.key(),
            ctx.accounts.transfer.escrow.seller,
            EscrowError::Authority
        );
        require_keys_eq!(
            ctx.accounts.verifier.key(),
            ctx.accounts.transfer.escrow.verifier,
            EscrowError::Authority
        );
        ctx.accounts.transfer.settle(true)
    }

    pub fn mutual_cancel(ctx: Context<MutualCancel>) -> Result<()> {
        require!(
            matches!(
                ctx.accounts.transfer.escrow.state,
                State::Funded | State::Disputed
            ),
            EscrowError::WrongState
        );
        require_keys_eq!(
            ctx.accounts.buyer.key(),
            ctx.accounts.transfer.escrow.buyer,
            EscrowError::Authority
        );
        require_keys_eq!(
            ctx.accounts.seller.key(),
            ctx.accounts.transfer.escrow.seller,
            EscrowError::Authority
        );
        ctx.accounts.transfer.settle(false)
    }

    pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
        let e = &mut ctx.accounts.escrow;
        require!(e.state == State::Funded, EscrowError::WrongState);
        require!(
            ctx.accounts.party.key() == e.buyer || ctx.accounts.party.key() == e.seller,
            EscrowError::Authority
        );
        e.state = State::Disputed;
        Ok(())
    }

    pub fn arbitrate(ctx: Context<Arbitrate>, release: bool) -> Result<()> {
        let e = &ctx.accounts.transfer.escrow;
        require!(e.state == State::Disputed, EscrowError::WrongState);
        require!(
            arbitration_allowed(
                &e.arbitrators,
                ctx.accounts.first.key(),
                ctx.accounts.second.key()
            ),
            EscrowError::Authority
        );
        ctx.accounts.transfer.settle(release)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Terms {
    pub digest: [u8; 32],
    pub amount: u64,
    pub verifier: Pubkey,
    pub arbitrators: [Pubkey; 3],
}
impl Terms {
    pub fn validate(&self, buyer: Pubkey, seller: Pubkey) -> Result<()> {
        require!(
            self.amount > 0 && self.digest != [0; 32],
            EscrowError::Terms
        );
        require!(
            buyer != seller && buyer != Pubkey::default() && seller != Pubkey::default(),
            EscrowError::Terms
        );
        let keys = [
            buyer,
            seller,
            self.verifier,
            self.arbitrators[0],
            self.arbitrators[1],
            self.arbitrators[2],
        ];
        for i in 2..keys.len() {
            require!(
                keys[i] != Pubkey::default() && !keys[..i].contains(&keys[i]),
                EscrowError::Terms
            );
        }
        Ok(())
    }
}
pub fn arbitration_allowed(keys: &[Pubkey; 3], first: Pubkey, second: Pubkey) -> bool {
    first != second && keys.contains(&first) && keys.contains(&second)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum State {
    Funded,
    Disputed,
    Released,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub digest: [u8; 32],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub buyer_destination: Pubkey,
    pub seller_refund: Pubkey,
    pub verifier: Pubkey,
    pub arbitrators: [Pubkey; 3],
    pub amount: u64,
    pub bump: u8,
    pub state: State,
    pub simulated_verifier: bool,
}

#[derive(Accounts)]
#[instruction(terms: Terms)]
pub struct Fund<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: Opaque destination identity; signed terms bind it and its token account.
    pub buyer: UncheckedAccount<'info>,
    #[account(address = TEST_USDC, constraint = mint.decimals == 6 @ EscrowError::Mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint=mint, token::authority=seller)]
    pub seller_source: Account<'info, TokenAccount>,
    #[account(token::mint=mint, token::authority=buyer)]
    pub buyer_destination: Account<'info, TokenAccount>,
    #[account(init, payer=seller, space=8+Escrow::INIT_SPACE, seeds=[b"order",seller.key().as_ref(),terms.digest.as_ref()], bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(init, payer=seller, seeds=[b"vault",escrow.key().as_ref()], bump, token::mint=mint, token::authority=escrow)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Transfer<'info> {
    #[account(mut, seeds=[b"order",escrow.seller.as_ref(),escrow.digest.as_ref()], bump=escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, seeds=[b"vault",escrow.key().as_ref()], bump, token::mint=mint, token::authority=escrow)]
    pub vault: Account<'info, TokenAccount>,
    #[account(address=TEST_USDC, constraint=mint.decimals==6 @ EscrowError::Mint)]
    pub mint: Account<'info, Mint>,
    /// CHECK: The selected immutable address, classic token-program ownership,
    /// mint and party authority are checked in settle before its token CPI.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}
impl<'info> Transfer<'info> {
    fn settle(&mut self, release: bool) -> Result<()> {
        let bump = [self.escrow.bump];
        let seeds = [
            b"order".as_ref(),
            self.escrow.seller.as_ref(),
            self.escrow.digest.as_ref(),
            bump.as_ref(),
        ];
        let signer = [&seeds[..]];
        let destination = self.destination.to_account_info();
        require_keys_eq!(
            destination.key(),
            if release {
                self.escrow.buyer_destination
            } else {
                self.escrow.seller_refund
            },
            EscrowError::Destination
        );
        require_keys_eq!(*destination.owner, token::ID, EscrowError::Destination);
        {
            let bytes = destination.try_borrow_data()?;
            let account = TokenAccount::try_deserialize(&mut bytes.as_ref())?;
            require_keys_eq!(account.mint, TEST_USDC, EscrowError::Destination);
            require_keys_eq!(
                account.owner,
                if release {
                    self.escrow.buyer
                } else {
                    self.escrow.seller
                },
                EscrowError::Destination
            );
        }
        token::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.vault.to_account_info(),
                    mint: self.mint.to_account_info(),
                    to: destination,
                    authority: self.escrow.to_account_info(),
                },
                &signer,
            ),
            self.escrow.amount,
            6,
        )?;
        // Keep terminal account/PDA, preventing order reuse and replay. No clock
        // path, admin sweep, or authority mutation can release a funded order.
        self.escrow.state = if release {
            State::Released
        } else {
            State::Refunded
        };
        Ok(())
    }
}
#[derive(Accounts)]
pub struct CooperativeRelease<'info> {
    pub transfer: Transfer<'info>,
    pub seller: Signer<'info>,
    pub verifier: Signer<'info>,
}
#[derive(Accounts)]
pub struct MutualCancel<'info> {
    pub transfer: Transfer<'info>,
    pub buyer: Signer<'info>,
    pub seller: Signer<'info>,
}
#[derive(Accounts)]
pub struct Arbitrate<'info> {
    pub transfer: Transfer<'info>,
    pub first: Signer<'info>,
    pub second: Signer<'info>,
}
#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(mut, seeds=[b"order",escrow.seller.as_ref(),escrow.digest.as_ref()], bump=escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    pub party: Signer<'info>,
}
#[error_code]
pub enum EscrowError {
    #[msg("Invalid immutable order terms or authority configuration")]
    Terms,
    #[msg("Only canonical classic Devnet test USDC is supported")]
    Mint,
    #[msg("Operation is invalid in the current escrow state")]
    WrongState,
    #[msg("Required independent signing authorities are missing")]
    Authority,
    #[msg("Token destination does not match immutable terms")]
    Destination,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authority_policy() {
        let keys = [
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ];
        assert!(arbitration_allowed(&keys, keys[0], keys[2]));
        assert!(!arbitration_allowed(&keys, keys[0], keys[0]));
        assert!(!arbitration_allowed(&keys, keys[0], Pubkey::new_unique()));
        let mut t = Terms {
            digest: [1; 32],
            amount: 1,
            verifier: Pubkey::new_unique(),
            arbitrators: keys,
        };
        assert!(t
            .validate(Pubkey::new_unique(), Pubkey::new_unique())
            .is_ok());
        t.arbitrators[1] = keys[0];
        assert!(t
            .validate(Pubkey::new_unique(), Pubkey::new_unique())
            .is_err());
    }
}
