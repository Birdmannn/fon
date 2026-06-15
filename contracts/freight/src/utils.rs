use crate::errors::Error;
use crate::types::{
    AddressKey, CAMPAIGN_DATA_LEN, Campaign, CampaignStatus, CampaignType, PARTICIPANT_DATA_LEN,
    ParticipantData, ParticipantStatus,
};
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::packed::Script;
use ckb_std::debug;
use ckb_std::error::SysError;
use ckb_std::high_level::{load_cell_lock, load_cell_type, load_header, load_input, load_script};
use k256::ecdsa::{Signature, VerifyingKey, signature::hazmat::PrehashVerifier};

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
                if lock_args.len() >= 20 && &lock_args[0..20] == authorized_address {
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
// I don't think this is necessary
pub fn is_initialization() -> Result<bool, SysError> {
    // Check if there are any input cells with current script
    match load_cell_lock(0, Source::GroupInput) {
        Ok(_) => Ok(false),                         // Has inputs, not initialization
        Err(SysError::IndexOutOfBound) => Ok(true), // No inputs, is initialization
        Err(e) => Err(e),
    }
}

// Helper function to extract address from a lock script
fn extract_address_from_lock(lock: &Script) -> Result<[u8; 20], Error> {
    // Get the args field from the lock script
    let lock_args = lock.args().raw_data();

    // For standard SECP256K1 locks, the args contain the address (20 bytes)
    if lock_args.len() < 20 {
        return Err(Error::InvalidCellData);
    }

    // Extract the first 20 bytes (the address)
    let mut address = [0u8; 20];
    address.copy_from_slice(&lock_args[0..20]);

    Ok(address)
}

pub fn extract_caller_address(key: AddressKey) -> Result<[u8; 20], Error> {
    match key {
        AddressKey::Creator => {
            // When creating a campaign, there are NO input cells with the campaign script
            // (because the campaign doesn't exist yet)
            // So we look at ANY input cell to find who's funding this creation
            let lock = load_cell_lock(0, Source::Input)?;
            extract_address_from_lock(&lock)
        }
        AddressKey::Depositor => get_depositor_address(),
        AddressKey::Admin(index) => get_admin_address(index),
    }
}

fn get_depositor_address() -> Result<[u8; 20], Error> {
    // We need to find the input that's NOT a campaign cell
    let mut i = 0;
    while let Ok(lock) = load_cell_lock(i, Source::Input) {
        if !is_campaign_cell(i, Source::Input)? {
            return extract_address_from_lock(&lock);
        }
        i += 1;
    }

    Err(Error::DepositorNotFound) // No non-campaign input found
}

fn is_campaign_cell(index: usize, source: Source) -> Result<bool, Error> {
    let campaign_script = load_script().map_err(|_| Error::LoadScriptFailed);
    let campaign_hash = campaign_script.unwrap().calc_script_hash();

    match load_cell_type(index, source) {
        Ok(Some(type_script)) => Ok(type_script.calc_script_hash() == campaign_hash),
        _ => Ok(false), // No type script, not a campaign cell
    }
}

pub fn validate_campaign_params(
    start_duration: u64,
    task_duration: u64,
    campaign_type: CampaignType,
    maximum_amount: u64,
    aux_amount: u64,
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
    if task_duration < min_task_duration || task_duration > max_task_duration {
        debug!("validate_campaign_params rejected task_duration");
        return Err(Error::InvalidCampaignArgs);
    }

    if campaign_type == CampaignType::Raffle {
        if aux_amount == 0 {
            return Err(Error::InvalidCampaignArgs);
        }
        if maximum_amount % aux_amount != 0 {
            return Err(Error::InvalidCampaignArgs);
        }
    }

    Ok(())
}

// Get current timestamp from block header.
pub fn get_current_timestamp() -> Result<u64, Error> {
    // Load current block header to get timestamp
    // Note: this requires the transaction to include the current block header as a header dep
    // In practice, the transaction creator should include current block header
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
    let maximum_amount = u64::from_le_bytes(data[45..53].try_into().unwrap());
    let current_deposits = u64::from_le_bytes(data[53..61].try_into().unwrap());
    let status: CampaignStatus = data[61].try_into().unwrap();
    // Distribution fields (bytes 62–101)
    let reward_count = u64::from_le_bytes(data[62..70].try_into().unwrap());
    let mut randomness_hash = [0u8; 32];
    randomness_hash.copy_from_slice(&data[70..102]);
    // Summary field (bytes 102–165)
    let mut summary = [0u8; 64];
    summary.copy_from_slice(&data[102..166]);
    // aux_amount (bytes 166–173)
    let aux_amount = u64::from_le_bytes(data[166..174].try_into().unwrap());

    Ok(Campaign {
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
    })
}

/// Shared deposit logic: validates the campaign cell capacity transition and
/// updates `campaign.current_deposits`. Used by both `deposit` and the raffle
/// path of `verify_participant`.
pub fn apply_deposit(campaign: &mut Campaign, amount: u64) -> Result<(), Error> {
    use ckb_std::high_level::load_cell_capacity;

    let input_capacity = load_cell_capacity(0, Source::GroupInput)
        .map_err(|_| Error::InvalidCellData)?;
    let output_capacity = load_cell_capacity(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;

    let expected = input_capacity.checked_add(amount).ok_or(Error::AmountMismatch)?;
    if output_capacity != expected {
        return Err(Error::AmountMismatch);
    }

    campaign.current_deposits = campaign
        .current_deposits
        .checked_add(amount)
        .ok_or(Error::AmountMismatch)?;

    Ok(())
}

/// Verify a 64-byte compact ECDSA signature against a pre-hashed message and
/// a known compressed public key (33 bytes SEC1).
pub fn verify_ecdsa_signature(
    signature: &[u8],
    message: &[u8; 32],
    pubkey: &[u8; 33],
) -> Result<(), crate::errors::Error> {
    if signature.len() != 64 {
        return Err(crate::errors::Error::InvalidSignature);
    }
    let verifying_key = VerifyingKey::from_sec1_bytes(pubkey)
        .map_err(|_| crate::errors::Error::InvalidSignature)?;
    let sig = Signature::from_slice(signature)
        .map_err(|_| crate::errors::Error::InvalidSignature)?;
    verifying_key
        .verify_prehash(message, &sig)
        .map_err(|_| crate::errors::Error::Unauthorized)
}

pub fn parse_participant_data(data: &[u8]) -> Result<ParticipantData, Error> {
    if data.len() < PARTICIPANT_DATA_LEN {
        return Err(Error::InvalidParticipantArgs);
    }
    let mut campaign_tx_hash = [0u8; 32];
    campaign_tx_hash.copy_from_slice(&data[0..32]);

    let campaign_index = u32::from_le_bytes(data[32..36].try_into().unwrap());
    let mut participant_address = [0u8; 20];
    participant_address.copy_from_slice(&data[36..56]);

    let joined_at = u64::from_le_bytes(data[56..64].try_into().unwrap());
    let status: ParticipantStatus = data[64].try_into().unwrap();
    let deposited_amount = u64::from_le_bytes(data[65..73].try_into().unwrap());

    Ok(ParticipantData {
        campaign_tx_hash,
        campaign_index,
        participant_address,
        joined_at,
        status,
        deposited_amount,
    })
}
