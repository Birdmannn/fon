use crate::{
    errors::Error,
    types::{Campaign, CampaignStatus, CampaignType},
    utils::*,
    validations::verify_campaign_tx,
};
use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    error::SysError,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock, load_cell_lock_hash, load_cell_type,
        load_script,
    },
};

pub const MAGIC: &[u8; 4] = b"GFT1";
pub const MAX_SLOTS: usize = 32;

#[derive(Debug, Clone, PartialEq)]
pub struct GiftSlot {
    // Open slots start with a zero claimant and record the signed wallet on claim.
    pub claimant: [u8; 32],
    pub amount: u64,
    pub claimed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GiftPolicy {
    pub creator: [u8; 32],
    pub open: bool,
    pub slots: Vec<GiftSlot>,
}

impl GiftPolicy {
    pub fn encoded_len(&self) -> usize {
        38 + 41 * self.slots.len()
    }
    pub fn validate(
        &self,
        kind: CampaignType,
        maximum: u64,
        reward_count: u64,
        initial: bool,
    ) -> Result<(), Error> {
        if self.creator == [0; 32]
            || kind != CampaignType::FundedTask
            || self.slots.is_empty()
            || self.slots.len() > MAX_SLOTS
            || reward_count != self.slots.len() as u64
        {
            return Err(Error::InvalidCampaignArgs);
        }
        let mut total = 0u64;
        for (i, slot) in self.slots.iter().enumerate() {
            total = total
                .checked_add(slot.amount)
                .ok_or(Error::AmountMismatch)?;
            let equal = maximum / self.slots.len() as u64;
            let expected = if i + 1 == self.slots.len() {
                maximum - equal * (self.slots.len() as u64 - 1)
            } else {
                equal
            };
            if self.open && slot.amount != expected {
                return Err(Error::InvalidCampaignArgs);
            }
            if slot.amount == 0
                || (initial && slot.claimed)
                || (!self.open && slot.claimant == [0; 32])
                || (self.open && (slot.claimed == (slot.claimant == [0; 32])))
                || (slot.claimant != [0; 32]
                    && self.slots[..i].iter().any(|s| s.claimant == slot.claimant))
            {
                return Err(Error::InvalidCampaignArgs);
            }
        }
        if total != maximum {
            return Err(Error::AmountMismatch);
        }
        Ok(())
    }
}

pub fn parse_policy(bytes: &[u8]) -> Result<Option<GiftPolicy>, Error> {
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.len() < 38
        || &bytes[..4] != MAGIC
        || bytes[4] > 1
        || bytes[5] == 0
        || bytes[5] as usize > MAX_SLOTS
        || bytes.len() != 38 + 41 * bytes[5] as usize
    {
        return Err(Error::InvalidCellData);
    }
    let mut slots = Vec::new();
    for entry in bytes[38..].chunks_exact(41) {
        if entry[40] > 1 {
            return Err(Error::InvalidCellData);
        }
        slots.push(GiftSlot {
            claimant: entry[..32].try_into().unwrap(),
            amount: u64::from_le_bytes(entry[32..40].try_into().unwrap()),
            claimed: entry[40] == 1,
        });
    }
    Ok(Some(GiftPolicy {
        creator: bytes[6..38].try_into().unwrap(),
        open: bytes[4] == 1,
        slots,
    }))
}

// Approval precedes the gift policy. Each optional extension is consumed exactly once.
pub fn parse_extensions(
    bytes: &[u8],
) -> Result<(Option<crate::approvals::RaffleApproval>, Option<GiftPolicy>), Error> {
    let approval_len = if bytes.starts_with(crate::approvals::MAGIC) {
        if bytes.len() < 8 {
            return Err(Error::InvalidCellData);
        }
        8 + 33 * bytes[6] as usize
    } else {
        0
    };
    if approval_len > bytes.len() {
        return Err(Error::InvalidCellData);
    }
    let approval = crate::approvals::parse_approval(&bytes[..approval_len])?;
    let gift = parse_policy(&bytes[approval_len..])?;
    Ok((approval, gift))
}

pub fn check_transition(campaign: &Campaign, action: u8) -> Result<(), Error> {
    if campaign.gift.is_none() {
        return Ok(());
    }
    verify_isolated_campaign(Source::Input)?;
    verify_isolated_campaign(Source::Output)?;
    if load_cell_lock(0, Source::GroupInput)? != load_cell_lock(0, Source::GroupOutput)? {
        return Err(Error::InvalidCellData);
    }
    if action == 6 && !signed_wallet(&campaign.gift.as_ref().unwrap().creator)? {
        return Err(Error::Unauthorized);
    }
    let permitted = match campaign.status {
        CampaignStatus::Cancelled => action == 8,
        CampaignStatus::Completed => action == 8,
        CampaignStatus::Created | CampaignStatus::Active => matches!(action, 1 | 6 | 13 | 15),
        _ => false,
    };
    if !permitted {
        return Err(Error::InvalidOperation);
    }
    Ok(())
}

pub fn signed_wallet(hash: &[u8; 32]) -> Result<bool, Error> {
    let own_code = load_script()?.code_hash();
    let mut index = 0;
    loop {
        match load_cell_lock_hash(index, Source::Input) {
            Ok(found) => {
                let lock = load_cell_lock(index, Source::Input)?;
                // Campaign and participant locks are permissive; they cannot sign for a wallet.
                if found == *hash
                    && !(lock.code_hash() == own_code
                        && lock.args().raw_data().first() == Some(&255))
                {
                    return Ok(true);
                }
                index += 1;
            }
            Err(SysError::IndexOutOfBound) => return Ok(false),
            Err(e) => return Err(e.into()),
        }
    }
}

// Count every recipient input, but credit only plain CKB outputs. Converting
// an existing typed/data cell cannot masquerade as a gift payout.
fn payout_capacity(hash: &[u8; 32], source: Source) -> Result<u64, Error> {
    let mut total = 0u64;
    let mut index = 0;
    loop {
        match load_cell_lock_hash(index, source) {
            Ok(found) => {
                if found == *hash
                    && (matches!(source, Source::Input)
                        || (load_cell_type(index, source)?.is_none()
                            && load_cell_data(index, source)?.is_empty()))
                {
                    total = total
                        .checked_add(load_cell_capacity(index, source)?)
                        .ok_or(Error::AmountMismatch)?;
                }
                index += 1;
            }
            Err(SysError::IndexOutOfBound) => return Ok(total),
            Err(e) => return Err(e.into()),
        }
    }
}

fn total_capacity(source: Source) -> Result<u64, Error> {
    let mut total = 0u64;
    let mut index = 0;
    loop {
        match load_cell_capacity(index, source) {
            Ok(capacity) => {
                total = total.checked_add(capacity).ok_or(Error::AmountMismatch)?;
                index += 1;
            }
            Err(SysError::IndexOutOfBound) => return Ok(total),
            Err(e) => return Err(e.into()),
        }
    }
}

// [slot index (1)][claiming wallet full lock hash (32)]
pub fn claim_gift(args: &[u8]) -> Result<(), Error> {
    if args.len() != 33 {
        return Err(Error::InvalidCampaignArgs);
    }
    let claimant: [u8; 32] = args[1..].try_into().unwrap();
    if claimant == [0; 32] || !signed_wallet(&claimant)? {
        return Err(Error::Unauthorized);
    }
    let mut campaign = parse_campaign_data(&load_cell_data(0, Source::GroupInput)?)?;
    check_transition(&campaign, 15)?;
    if campaign.approval.as_ref().is_some_and(|a| !a.satisfied()) {
        return Err(Error::ApprovalRequired);
    }
    let start = campaign
        .created_at
        .checked_add(
            campaign
                .start_duration_in_seconds
                .checked_mul(1000)
                .ok_or(Error::InvalidCampaignArgs)?,
        )
        .ok_or(Error::InvalidCampaignArgs)?;
    if get_current_timestamp()? < start {
        return Err(Error::InvalidOperation);
    }
    let policy = campaign.gift.as_mut().ok_or(Error::InvalidOperation)?;
    // Full funding is required before the first claim. Later claims spend their reserved allocations.
    if !policy.slots.iter().any(|s| s.claimed)
        && campaign.current_deposits < campaign.maximum_amount
    {
        return Err(Error::InsufficientBalance);
    }
    if policy
        .slots
        .iter()
        .any(|s| s.claimed && s.claimant == claimant)
    {
        return Err(Error::InvalidOperation);
    }
    let slot = policy
        .slots
        .get_mut(args[0] as usize)
        .ok_or(Error::Unauthorized)?;
    if slot.claimed || (!policy.open && slot.claimant != claimant) {
        return Err(Error::Unauthorized);
    }
    let amount = slot.amount;
    // A self-claim wallet pays the network fee. Credit the actual bounded fee,
    // never another output or a recipient input recycled as a reward.
    let fee = total_capacity(Source::Input)?
        .checked_sub(total_capacity(Source::Output)?)
        .ok_or(Error::AmountMismatch)?;
    if fee > 1_000_000 || fee >= amount {
        return Err(Error::AmountMismatch);
    }
    let required_increase = amount - fee;
    if payout_capacity(&claimant, Source::Output)?
        < payout_capacity(&claimant, Source::Input)?
            .checked_add(required_increase)
            .ok_or(Error::AmountMismatch)?
    {
        return Err(Error::AmountMismatch);
    }
    slot.claimant = claimant;
    slot.claimed = true;
    campaign.current_deposits = campaign
        .current_deposits
        .checked_sub(amount)
        .ok_or(Error::InsufficientBalance)?;
    campaign.status = if policy.slots.iter().all(|s| s.claimed) {
        CampaignStatus::Completed
    } else {
        CampaignStatus::Active
    };
    if load_cell_capacity(0, Source::GroupInput)?.checked_sub(amount)
        != Some(load_cell_capacity(0, Source::GroupOutput)?)
        || load_cell_lock(0, Source::GroupInput)? != load_cell_lock(0, Source::GroupOutput)?
        || !verify_campaign_tx(&load_cell_data(0, Source::GroupOutput)?, &campaign)?
    {
        return Err(Error::InvalidCellData);
    }
    Ok(())
}

// Recover unclaimed escrow only after cancellation, or surplus after all claims.
pub fn withdraw_gift() -> Result<(), Error> {
    let mut campaign = parse_campaign_data(&load_cell_data(0, Source::GroupInput)?)?;
    check_transition(&campaign, 8)?;
    let creator = campaign
        .gift
        .as_ref()
        .ok_or(Error::InvalidOperation)?
        .creator;
    if !signed_wallet(&creator)? {
        return Err(Error::Unauthorized);
    }
    let amount = campaign.current_deposits;
    if amount == 0 {
        return Err(Error::InvalidOperation);
    }
    let fee = total_capacity(Source::Input)?
        .checked_sub(total_capacity(Source::Output)?)
        .ok_or(Error::AmountMismatch)?;
    if fee > 1_000_000
        || fee >= amount
        || payout_capacity(&creator, Source::Output)?
            < payout_capacity(&creator, Source::Input)?
                .checked_add(amount.saturating_sub(fee))
                .ok_or(Error::AmountMismatch)?
    {
        return Err(Error::AmountMismatch);
    }
    campaign.current_deposits = 0;
    campaign.creator_support_total = 0;
    if load_cell_capacity(0, Source::GroupInput)?.checked_sub(amount)
        != Some(load_cell_capacity(0, Source::GroupOutput)?)
        || load_cell_lock(0, Source::GroupInput)? != load_cell_lock(0, Source::GroupOutput)?
        || !verify_campaign_tx(&load_cell_data(0, Source::GroupOutput)?, &campaign)?
    {
        return Err(Error::InvalidCellData);
    }
    Ok(())
}

// Prevent two campaign groups from counting the same recipient increase twice.
pub fn verify_isolated_campaign(source: Source) -> Result<(), Error> {
    let own_code = load_script()?.code_hash();
    let mut count = 0;
    let mut index = 0;
    loop {
        match load_cell_type(index, source) {
            Ok(Some(script)) => {
                if script.code_hash() == own_code {
                    count += 1;
                }
                index += 1;
            }
            Ok(None) => index += 1,
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    if count != 1 {
        return Err(Error::InvalidCellData);
    }
    Ok(())
}
