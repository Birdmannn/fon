use crate::errors::Error;
use crate::types::{
    AddressKey, CAMPAIGN_DATA_LEN, Campaign, CampaignStatus, CampaignType, PARTICIPANT_DATA_LEN,
    RECURRING_CAMPAIGN_DATA_LEN, RECURRING_PARTICIPANT_DATA_LEN, ParticipantData,
    ParticipantStatus, RecurringParticipantState, RecurringRaffleState,
};
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::packed::Script;
use ckb_std::debug;
use ckb_std::error::SysError;
use ckb_std::high_level::{load_cell_lock, load_cell_type, load_header, load_script};
use k256::ecdsa::{signature::hazmat::PrehashVerifier, Signature, VerifyingKey};

pub struct Address([u8; 20]);

impl Address {
    pub fn require_authorized(&self) -> Result<(), Error> {
        if is_authorized_by_address(&self.0)? {
            Ok(())
        } else {
            Err(Error::Unauthorized)
        }
    }
}

pub fn is_authorized_by_address(authorized_address: &[u8; 20]) -> Result<bool, Error> {
    let mut i = 0;
    loop {
        match load_cell_lock(i, Source::Input) {
            Ok(lock) => {
                let lock_args = lock.args().raw_data();
                if lock_args.first() != Some(&255)
                    && lock_args.len() >= 20
                    && &lock_args[0..20] == authorized_address
                {
                    return Ok(true);
                }
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(false)
}

// Script args parsing.
// `index` is the byte offset into the full type script args where the field starts.
// Layout: [selector (1)][admin_address (20, index=1)][admin_pubkey (33, index=21)][instruction-specific...]
fn get_admin_address(index: usize) -> Result<[u8; 20], Error> {
    let script = load_script()?;
    let args = script.args().raw_data();
    if args.len() < index + 20 {
        return Err(Error::InvalidTypeScriptArgs);
    }
    let mut admin_address = [0u8; 20];
    admin_address.copy_from_slice(&args[index..index + 20]);
    Ok(admin_address)
}

// `index` is the byte offset into the full type script args where the pubkey starts.
pub fn get_admin_pubkey(index: usize) -> Result<[u8; 33], Error> {
    let script = load_script()?;
    let args = script.args().raw_data();
    if args.len() < index + 33 {
        return Err(Error::InvalidTypeScriptArgs);
    }
    let mut admin_pubkey = [0u8; 33];
    admin_pubkey.copy_from_slice(&args[index..index + 33]);
    Ok(admin_pubkey)
}

// Cell counting
pub fn count_script_cells(source: Source) -> Result<usize, Error> {
    let current_script = load_script()?;
    let current_script_hash = current_script.calc_script_hash();

    let mut count = 0;
    let mut i = 0;

    loop {
        match load_cell_lock(i, source) {
            Ok(lock) => {
                if lock.calc_script_hash() == current_script_hash {
                    count += 1;
                }
                i += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }

    Ok(count)
}

// Initialization detection
pub fn is_initialization() -> Result<bool, SysError> {
    match load_cell_lock(0, Source::GroupInput) {
        Ok(_) => Ok(false),
        Err(SysError::IndexOutOfBound) => Ok(true),
        Err(e) => Err(e),
    }
}

fn extract_address_from_lock(lock: &Script) -> Result<[u8; 20], Error> {
    let lock_args = lock.args().raw_data();
    let offset = usize::from(lock_args.first() == Some(&255));
    if lock_args.len() < offset + 20 {
        return Err(Error::InvalidCellData);
    }

    let mut address = [0u8; 20];
    address.copy_from_slice(&lock_args[offset..offset + 20]);
    Ok(address)
}

pub fn extract_caller_address(key: AddressKey) -> Result<[u8; 20], Error> {
    match key {
        AddressKey::Creator => {
            let lock = load_cell_lock(0, Source::Input)?;
            extract_address_from_lock(&lock)
        }
        AddressKey::Depositor => get_depositor_address(),
        AddressKey::Admin(index) => get_admin_address(index),
    }
}

fn get_depositor_address() -> Result<[u8; 20], Error> {
    let mut i = 0;
    while let Ok(lock) = load_cell_lock(i, Source::Input) {
        let args = lock.args().raw_data();
        if !is_campaign_cell(i, Source::Input)? && args.first() != Some(&255) {
            return extract_address_from_lock(&lock);
        }
        i += 1;
    }

    Err(Error::DepositorNotFound)
}

fn is_campaign_cell(index: usize, source: Source) -> Result<bool, Error> {
    let campaign_script = load_script().map_err(|_| Error::LoadScriptFailed);
    let campaign_hash = campaign_script.unwrap().calc_script_hash();

    match load_cell_type(index, source) {
        Ok(Some(type_script)) => Ok(type_script.calc_script_hash() == campaign_hash),
        _ => Ok(false),
    }
}

pub fn validate_campaign_params(
    start_duration: u64,
    task_duration: u64,
    campaign_type: CampaignType,
    maximum_amount: u64,
    aux_amount: u64,
    support_pool_bps: u64,
) -> Result<(), Error> {
    let max_duration = 365 * 24 * 60 * 60;
    debug!("validate_campaign_params start={} task={} max_duration={}", start_duration, task_duration, max_duration);
    if start_duration > max_duration {
        debug!("validate_campaign_params rejected start_duration");
        return Err(Error::InvalidCampaignArgs);
    }

    let min_task_duration = 60;
    let max_task_duration = 365 * 24 * 60 * 60;
    debug!("validate_campaign_params min_task_duration={} max_task_duration={}", min_task_duration, max_task_duration);
    if (campaign_type != CampaignType::SimpleTask && task_duration < min_task_duration)
        || task_duration > max_task_duration
    {
        debug!("validate_campaign_params rejected task_duration");
        return Err(Error::InvalidCampaignArgs);
    }

    if campaign_type == CampaignType::Raffle || campaign_type == CampaignType::RecurringRaffle {
        if aux_amount != 0 && maximum_amount % aux_amount != 0 {
            return Err(Error::InvalidCampaignArgs);
        }
        if support_pool_bps > 10_000 {
            return Err(Error::InvalidCampaignArgs);
        }
    } else if support_pool_bps != 0 {
        return Err(Error::InvalidCampaignArgs);
    }

    Ok(())
}

pub fn get_current_timestamp() -> Result<u64, Error> {
    match load_header(0, Source::HeaderDep) {
        Ok(header) => {
            let timestamp: u64 = header.raw().timestamp().into();
            debug!("Current timestamp from header: {}", timestamp);
            Ok(timestamp)
        }
        Err(_) => Err(Error::NoTimeStampAvailable),
    }
}

pub fn parse_campaign_data(data: &[u8]) -> Result<Campaign, Error> {
    if data.len() < CAMPAIGN_DATA_LEN {
        return Err(Error::InvalidCellData);
    }
    let created_at = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let start_duration_in_seconds = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let task_duration_in_seconds = u64::from_le_bytes(data[16..24].try_into().unwrap());
    let created_by = {
        let mut addr = [0u8; 20];
        addr.copy_from_slice(&data[24..44]);
        addr
    };
    let campaign_type: CampaignType = data[44].try_into().unwrap();
    if data.len() < crate::approvals::base_data_len(campaign_type) { return Err(Error::InvalidCellData); }
    let maximum_amount = u64::from_le_bytes(data[45..53].try_into().unwrap());
    let current_deposits = u64::from_le_bytes(data[53..61].try_into().unwrap());
    let status: CampaignStatus = data[61].try_into().unwrap();
    let reward_count = u64::from_le_bytes(data[62..70].try_into().unwrap());
    let mut randomness_hash = [0u8; 32];
    randomness_hash.copy_from_slice(&data[70..102]);
    let mut summary = [0u8; 64];
    summary.copy_from_slice(&data[102..166]);
    let aux_amount = u64::from_le_bytes(data[166..174].try_into().unwrap());
    let ticket_sales_total = u64::from_le_bytes(data[174..182].try_into().unwrap());
    let creator_support_total = u64::from_le_bytes(data[182..190].try_into().unwrap());
    let support_pool_bps = u64::from_le_bytes(data[190..198].try_into().unwrap());

    let (approval, gift) = crate::gifts::parse_extensions(&data[crate::approvals::base_data_len(campaign_type)..])?;
    if let Some(policy) = &gift { policy.validate(campaign_type, maximum_amount, reward_count, false)?; }
    Ok(Campaign {
        approval,
        gift,
        created_at,
        start_duration_in_seconds,
        task_duration_in_seconds,
        created_by,
        campaign_type,
        maximum_amount,
        current_deposits,
        status,
        reward_count,
        randomness_hash,
        summary,
        aux_amount,
        ticket_sales_total,
        creator_support_total,
        support_pool_bps,
    })
}

pub fn parse_recurring_raffle_state(data: &[u8]) -> Result<RecurringRaffleState, Error> {
    if data.len() < RECURRING_CAMPAIGN_DATA_LEN {
        return Err(Error::InvalidCellData);
    }
    Ok(RecurringRaffleState {
        sleep_duration_in_seconds: u64::from_le_bytes(data[198..206].try_into().unwrap()),
        winner_reduction_bps: u64::from_le_bytes(data[206..214].try_into().unwrap()),
        round: u64::from_le_bytes(data[214..222].try_into().unwrap()),
        round_started_at: u64::from_le_bytes(data[222..230].try_into().unwrap()),
        round_reward_per_winner: u64::from_le_bytes(data[230..238].try_into().unwrap()),
        round_winner_count: u64::from_le_bytes(data[238..246].try_into().unwrap()),
        prize_pool: u64::from_le_bytes(data[246..254].try_into().unwrap()),
    })
}

pub fn apply_deposit(campaign: &mut Campaign, amount: u64) -> Result<(), Error> {
    use ckb_std::high_level::load_cell_capacity;

    let input_capacity = load_cell_capacity(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let output_capacity = load_cell_capacity(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;

    let expected = input_capacity.checked_add(amount).ok_or(Error::AmountMismatch)?;
    if output_capacity != expected {
        return Err(Error::AmountMismatch);
    }

    campaign.current_deposits = campaign.current_deposits.checked_add(amount).ok_or(Error::AmountMismatch)?;

    Ok(())
}

pub fn apply_creator_support_deposit(campaign: &mut Campaign, amount: u64) -> Result<(), Error> {
    apply_deposit(campaign, amount)?;
    campaign.creator_support_total = campaign
        .creator_support_total
        .checked_add(amount)
        .ok_or(Error::AmountMismatch)?;
    Ok(())
}

pub fn apply_ticket_sale_deposit(campaign: &mut Campaign, amount: u64, ticket_count: u64) -> Result<(), Error> {
    apply_deposit(campaign, amount)?;
    campaign.ticket_sales_total = campaign
        .ticket_sales_total
        .checked_add(if campaign.ticket_price() == 0 { ticket_count } else { amount })
        .ok_or(Error::AmountMismatch)?;
    Ok(())
}

pub fn verify_ecdsa_signature(
    signature: &[u8],
    message: &[u8; 32],
    pubkey: &[u8; 33],
) -> Result<(), crate::errors::Error> {
    if signature.len() != 64 {
        return Err(crate::errors::Error::InvalidSignature);
    }
    let verifying_key = VerifyingKey::from_sec1_bytes(pubkey).map_err(|_| crate::errors::Error::InvalidSignature)?;
    let sig = Signature::from_slice(signature).map_err(|_| crate::errors::Error::InvalidSignature)?;
    verifying_key
        .verify_prehash(message, &sig)
        .map_err(|_| crate::errors::Error::Unauthorized)
}

pub fn parse_participant_data(data: &[u8]) -> Result<ParticipantData, Error> {
    if data.len() < PARTICIPANT_DATA_LEN {
        return Err(Error::InvalidParticipantArgs);
    }
    let mut campaign_created_by = [0u8; 20];
    campaign_created_by.copy_from_slice(&data[0..20]);

    let campaign_created_at = u64::from_le_bytes(data[20..28].try_into().unwrap());
    let campaign_type: CampaignType = data[28].try_into().unwrap();

    let mut participant_address = [0u8; 20];
    participant_address.copy_from_slice(&data[29..49]);

    let joined_at = u64::from_le_bytes(data[49..57].try_into().unwrap());
    let status: ParticipantStatus = data[57].try_into().unwrap();
    let deposited_amount = u64::from_le_bytes(data[58..66].try_into().unwrap());

    Ok(ParticipantData {
        campaign_created_by,
        campaign_created_at,
        campaign_type,
        participant_address,
        joined_at,
        status,
        deposited_amount,
    })
}

pub fn parse_recurring_participant_state(data: &[u8]) -> Result<RecurringParticipantState, Error> {
    if data.len() != RECURRING_PARTICIPANT_DATA_LEN {
        return Err(Error::InvalidParticipantArgs);
    }
    Ok(RecurringParticipantState {
        round: u64::from_le_bytes(data[66..74].try_into().unwrap()),
        claimable_amount: u64::from_le_bytes(data[74..82].try_into().unwrap()),
    })
}
