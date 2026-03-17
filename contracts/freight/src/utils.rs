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
use secp256k1::{
    Message, Secp256k1,
    ecdsa::{RecoverableSignature, RecoveryId},
};

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

// Script args parsing
fn get_admin_address() -> Result<[u8; 20], Error> {
    let script = load_script()?;
    let args = script.args().raw_data();
    if args.len() < 53 {
        return Err(Error::InvalidTypeScriptArgs);
    }
    let mut admin_address = [0u8; 20];
    admin_address.copy_from_slice(&args[0..20]);
    Ok(admin_address)
}

// Admin pubkey for signature verification
pub fn get_admin_pubkey() -> Result<[u8; 33], Error> {
    let script = load_script()?;
    let args = script.args().raw_data();
    // 33 bytes, compressed secp256k1 pubkey hash
    if args.len() < 53 {
        return Err(Error::InvalidTypeScriptArgs);
    }
    let mut admin_pubkey_hash = [0u8; 33];
    admin_pubkey_hash.copy_from_slice(&args[20..53]);
    Ok(admin_pubkey_hash)
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
        AddressKey::Admin => get_admin_address(),
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
) -> Result<(), Error> {
    // Start duration should not actually be more than a year. For now, it is hardcoded
    let max_duration = 365 * 24 * 60 * 60;
    if start_duration > max_duration {
        return Err(Error::InvalidCampaignArgs);
    }

    // Task duration should atleast be thirty minutes, and should not be more than a year.
    let min_task_duration = 30 * 60; // 30 minutes in seconds
    let max_task_duration = 365 * 24 * 60 * 60; // 1 year in seconds

    if task_duration < min_task_duration || task_duration > max_task_duration {
        return Err(Error::InvalidCampaignArgs);
    }

    let _ = (campaign_type, maximum_amount);

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

    let output_campaign = Campaign {
        created_at,
        start_duration_in_seconds,
        task_duration_in_seconds,
        created_by,
        campaign_type,
        maximum_amount,
        current_deposits,
        status,
    };

    Ok(output_campaign)
}

pub fn recover_pubkey_hash(signature: &[u8], message: &[u8; 32]) -> [u8; 33] {
    let secp = Secp256k1::verification_only();
    let recovery_id = RecoveryId::from_i32(signature[64] as i32).expect("invalid recovery id");
    let sig = RecoverableSignature::from_compact(&signature[0..64], recovery_id)
        .expect("invalid signature");
    let msg = Message::from_digest(*message);
    secp.recover_ecdsa(&msg, &sig)
        .expect("pubkey recovery failed")
        .serialize() // returns compressed [u8; 33]
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

    let status_bytes = data[64];
    let status: ParticipantStatus = status_bytes.try_into().unwrap();

    let data = ParticipantData {
        campaign_tx_hash,
        campaign_index,
        participant_address,
        joined_at,
        status,
    };

    Ok(data)
}
