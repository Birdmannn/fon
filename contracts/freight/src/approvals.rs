use crate::{
    errors::Error,
    types::{
        CAMPAIGN_DATA_LEN, Campaign, CampaignStatus, CampaignType, RECURRING_CAMPAIGN_DATA_LEN,
    },
};
use alloc::vec::Vec;

// Optional, versioned tail. Each identity is a complete lock-script hash.
pub const MAGIC: &[u8; 4] = b"APV1";
pub const MAX_APPROVERS: usize = 32;

#[derive(Debug, Clone, PartialEq)]
pub struct RaffleApproval {
    pub stage: u8, // 1 = raffle commencement, 2 = raffle delivery, 3 = gift commencement
    pub required: u8,
    pub confirmed: bool, // Proves the threshold-setting cell was mined before the deadline.
    pub approvers: Vec<([u8; 32], bool)>,
}

impl RaffleApproval {
    pub fn satisfied(&self) -> bool {
        (self.stage != 1 || self.confirmed) && self.threshold_met()
    }

    pub fn threshold_met(&self) -> bool {
        self.approvers.iter().filter(|entry| entry.1).count() >= self.required as usize
    }

    pub fn encoded_len(&self) -> usize {
        8 + self.approvers.len() * 33
    }

    pub fn validate(&self, campaign_type: CampaignType, start_delay: u64) -> Result<(), Error> {
        if !matches!(
            campaign_type,
            CampaignType::Raffle | CampaignType::RecurringRaffle | CampaignType::FundedTask
        ) || !(1..=3).contains(&self.stage)
            || (self.stage == 3) != (campaign_type == CampaignType::FundedTask)
            || self.approvers.is_empty()
            || self.approvers.len() > MAX_APPROVERS
            || self.required == 0
            || self.required as usize > self.approvers.len()
            || (self.stage == 1 && start_delay == 0)
            || (self.stage == 2
                && (campaign_type == CampaignType::RecurringRaffle
                    || self.required as usize != self.approvers.len()))
        {
            return Err(Error::InvalidCampaignArgs);
        }
        for (index, (hash, _)) in self.approvers.iter().enumerate() {
            if *hash == [0; 32] || self.approvers[..index].iter().any(|entry| entry.0 == *hash) {
                return Err(Error::InvalidCampaignArgs);
            }
        }
        Ok(())
    }
}

pub fn base_data_len(campaign_type: CampaignType) -> usize {
    if campaign_type == CampaignType::RecurringRaffle {
        RECURRING_CAMPAIGN_DATA_LEN
    } else {
        CAMPAIGN_DATA_LEN
    }
}

pub fn parse_approval(bytes: &[u8]) -> Result<Option<RaffleApproval>, Error> {
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.len() < 8 || &bytes[..4] != MAGIC {
        return Err(Error::InvalidCellData);
    }
    let count = bytes[6] as usize;
    if count == 0 || count > MAX_APPROVERS || bytes.len() != 8 + count * 33 || bytes[7] > 1 {
        return Err(Error::InvalidCellData);
    }
    let mut approvers = Vec::with_capacity(count);
    for entry in bytes[8..].chunks_exact(33) {
        let hash = entry[..32].try_into().map_err(|_| Error::InvalidCellData)?;
        if entry[32] > 1 {
            return Err(Error::InvalidCellData);
        }
        approvers.push((hash, entry[32] == 1));
    }
    Ok(Some(RaffleApproval {
        stage: bytes[4],
        required: bytes[5],
        confirmed: bytes[7] == 1,
        approvers,
    }))
}

pub fn commencement_failed(campaign: &Campaign, timestamp: u64) -> Result<bool, Error> {
    if !campaign
        .approval
        .as_ref()
        .is_some_and(|gate| gate.stage == 1 && !gate.satisfied())
    {
        return Ok(false);
    }
    let deadline = campaign
        .created_at
        .checked_add(
            campaign
                .start_duration_in_seconds
                .checked_mul(1000)
                .ok_or(Error::InvalidCampaignArgs)?,
        )
        .ok_or(Error::InvalidCampaignArgs)?;
    Ok(campaign
        .approval
        .as_ref()
        .is_some_and(|gate| gate.stage == 1 && !gate.satisfied() && timestamp >= deadline))
}

pub fn check_transition(campaign: &Campaign, instruction: u8, timestamp: u64) -> Result<(), Error> {
    if campaign.status == CampaignStatus::Cancelled && !matches!(instruction, 7 | 8) {
        return Err(Error::InvalidOperation);
    }
    if commencement_failed(campaign, timestamp)?
        && !matches!(instruction, 6 | 14)
        && !(campaign.status == CampaignStatus::Cancelled && matches!(instruction, 7 | 8))
    {
        return Err(Error::ApprovalDeadlineMissed);
    }
    if let Some(gate) = &campaign.approval {
        // Freeze the threshold-setting cell until its actual inclusion header is checked.
        if gate.stage == 1
            && gate.threshold_met()
            && !gate.confirmed
            && campaign.status != CampaignStatus::Cancelled
            && !matches!(instruction, 6 | 14)
        {
            return Err(Error::ApprovalRequired);
        }
        if gate.stage == 1
            && !gate.satisfied()
            && !matches!(instruction, 6 | 13 | 14)
            && !(campaign.status == CampaignStatus::Cancelled && matches!(instruction, 7 | 8))
        {
            return Err(Error::ApprovalRequired);
        }
        // Gifts keep their existing approval window: no raffle deadline or proof
        // transaction, but commencement, participation and payouts require quorum.
        if gate.stage == 3
            && !gate.satisfied()
            && matches!(instruction, 2 | 3 | 4 | 8 | 15)
            && campaign.status != CampaignStatus::Cancelled
        {
            return Err(Error::ApprovalRequired);
        }
        // Withdrawals must not bypass delivery approval by taking the prize pool.
        if gate.stage == 2
            && !gate.satisfied()
            && matches!(instruction, 2 | 8)
            && campaign.status != CampaignStatus::Cancelled
        {
            return Err(Error::ApprovalRequired);
        }
    }
    Ok(())
}

// Every gated script group has exactly one campaign cell. Otherwise a valid
// transition could smuggle a second output with forged approval flags.
pub fn verify_single_campaign_cell(source: ckb_std::ckb_constants::Source) -> Result<(), Error> {
    match ckb_std::high_level::load_cell_data(1, source) {
        Err(ckb_std::error::SysError::IndexOutOfBound) => Ok(()),
        Ok(_) => Err(Error::InvalidCellData),
        Err(error) => Err(error.into()),
    }
}
