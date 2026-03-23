use crate::errors::Error;
use crate::types::{AddressKey, Campaign, CampaignStatus, CampaignType};
use crate::utils::*;
use crate::validations::*;
use ckb_hash::blake2b_256;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::Entity;
use ckb_std::high_level::{load_input, load_witness_args};
use crate::utils::verify_ecdsa_signature;
use ckb_std::{debug, high_level::load_cell_data};

pub fn create_campaign(args: &[u8]) -> Result<(), Error> {
    let is_campaign_creation = || -> Result<bool, Error> {
        // Check if there are no input cells with our campaign script
        match load_cell_data(0, Source::GroupInput) {
            Ok(_) => Ok(false), // Has inputs, not a creation
            Err(_) => Ok(true), // No inputs, is a creation
        }
    };
    debug!("Creating campaign with args: {:?}", args);

    // Extract and parse args
    // args format: [start_duration: 8 bytes][task_duration: 8 bytes][campaign_type: 1 byte][maximum_amount: 8 bytes]
    if args.len() < 25 {
        debug!("Args length is less than 25 bytes");
        return Err(Error::InvalidCampaignArgs);
    }

    let start_duration_in_seconds = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let task_duration_in_seconds = u64::from_le_bytes(args[8..16].try_into().unwrap());
    let campaign_type_byte = args[16];
    let maximum_amount = u64::from_le_bytes(args[17..25].try_into().unwrap());

    debug!(
        "Parsed start_duration: {}, task_duration: {}, campaign_type_byte: {}, maximum_amount: {}",
        start_duration_in_seconds, task_duration_in_seconds, campaign_type_byte, maximum_amount
    );

    // This should be a new campaign, so there should be no input cells with the campaign script.
    if !is_campaign_creation()? {
        debug!("Not a campaign creation, input cells with campaign script already exist");
        return Err(Error::InvalidCampaignArgs);
    }

    // require auth
    // get campaign creator address from the lock args of the first input cell (the funder of the campaign creation)
    let creator_address = extract_caller_address(AddressKey::Creator)?;
    if !is_authorized_by_address(&creator_address)? {
        debug!("Unauthorized campaign creator: {:?}", creator_address);
        return Err(Error::Unauthorized);
    }

    let campaign_type: CampaignType = campaign_type_byte.try_into().unwrap();
    // Validate Campaign params
    validate_campaign_params(
        start_duration_in_seconds,
        task_duration_in_seconds,
        campaign_type,
        maximum_amount,
    )?;

    // extract timestamp
    let created_at = get_current_timestamp()?;
    debug!("Created At: {}", created_at);

    // Create campaign struct (reward_count and randomness_hash are zero-initialised)
    let campaign = Campaign {
        created_at,
        start_duration_in_seconds,
        task_duration_in_seconds,
        created_by: creator_address,
        campaign_type,
        maximum_amount,
        current_deposits: 0,
        status: CampaignStatus::Created,
        reward_count: 0,
        randomness_hash: [0u8; 32],
    };

    // verify the output cell contains the correct campaign data
    let output_data = load_cell_data(0, Source::Output)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        debug!("Output cell data does not match expected campaign data");
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

/// Distribute deposited tokens equally among a batch of verified participants.
///
/// # Instruction args
/// - Sequential / all-participants mode (`randomness_hash == [0;32]`): no args needed.
/// - Randomness mode (`randomness_hash != [0;32]`): `[randomness: [u8; 32]]`.
///
/// # Per-participant amount
/// - `reward_count == 0` → distribute to ALL participants: `reward = current_deposits / batch_size`
/// - `reward_count > 0` → fixed N recipients: `reward = current_deposits / reward_count`
///   (remainder stays in the campaign cell, paid out in final batch)
///
/// # Transaction structure
/// - inputs\[0\]:  campaign cell (GroupInput\[0\])
/// - inputs\[1+\]: participant cells with status = Verified, linked to this campaign
/// - outputs\[0\]: updated campaign cell (current_deposits reduced)
/// - outputs\[1+\]: participant cells with status = Rewarded (one per input participant)
pub fn batch_deliver(args: &[u8]) -> Result<(), Error> {
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    // Campaign must be past its task deadline.
    // NOTE: created_at and timestamp are in milliseconds; durations are in seconds → * 1_000.
    let timestamp = get_current_timestamp()?;
    let till = campaign.created_at
        .checked_add(campaign.start_duration_in_seconds * 1_000)
        .and_then(|t| t.checked_add(campaign.task_duration_in_seconds * 1_000))
        .ok_or(Error::InvalidCampaignArgs)?;
    if timestamp <= till {
        return Err(Error::InvalidOperation);
    }

    // Verify randomness commitment if one was previously submitted
    let requires_randomness = campaign.randomness_hash != [0u8; 32];
    if requires_randomness {
        if args.len() < 32 {
            return Err(Error::InvalidVerificationArgs);
        }
        let revealed: &[u8; 32] = args[0..32].try_into().unwrap();
        if blake2b_256(revealed) != campaign.randomness_hash {
            return Err(Error::RandomnessMismatch);
        }
    }

    // Count participant inputs first so we can compute reward_per_participant
    // when reward_count == 0 (distribute-to-all mode).
    let batch_size = count_participant_inputs()?;
    if batch_size == 0 {
        return Err(Error::InvalidOperation);
    }

    // reward_count == 0  → equal split across this batch (all-participants mode)
    // reward_count >  0  → fixed per-person amount (N-recipients mode)
    let reward_per_participant = if campaign.reward_count == 0 {
        campaign.current_deposits
            .checked_div(batch_size as u64)
            .ok_or(Error::InvalidOperation)?
    } else {
        campaign.current_deposits
            .checked_div(campaign.reward_count)
            .ok_or(Error::InvalidOperation)?
    };

    // Validate each participant cell and its Rewarded counterpart in outputs
    validate_batch_delivery(reward_per_participant)?;

    // Deduct from campaign
    let total_payout = reward_per_participant
        .checked_mul(batch_size as u64)
        .ok_or(Error::AmountMismatch)?;
    campaign.current_deposits = campaign.current_deposits
        .checked_sub(total_payout)
        .ok_or(Error::AmountMismatch)?;

    // Verify output campaign cell
    let output_data = load_cell_data(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

/// Commit distribution parameters before the campaign ends.
///
/// # Instruction args (40 bytes)
/// `[reward_count: u64 (8)][randomness_hash: [u8; 32] (32)]`
///
/// - `reward_count = 0` → all participants share equally (no fixed N).
/// - `randomness_hash = [0; 32]` → sequential mode (no randomness required at delivery).
/// - `randomness_hash != [0; 32]` → caller must reveal the preimage when calling `batch_deliver`.
///
/// Can only be called once per campaign and only by the creator.
pub fn submit_randomness_hash(args: &[u8]) -> Result<(), Error> {
    if args.len() < 40 {
        return Err(Error::InvalidCampaignArgs);
    }
    let reward_count = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let mut randomness_hash = [0u8; 32];
    randomness_hash.copy_from_slice(&args[8..40]);

    // Only the campaign creator may call this
    let creator_address = extract_caller_address(AddressKey::Creator)?;
    if !is_authorized_by_address(&creator_address)? {
        return Err(Error::Unauthorized);
    }

    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    // Idempotency guard: once set, cannot be changed
    if campaign.randomness_hash != [0u8; 32] {
        return Err(Error::InvalidOperation);
    }
    if campaign.status == CampaignStatus::Cancelled {
        return Err(Error::InvalidOperation);
    }

    campaign.reward_count = reward_count;
    campaign.randomness_hash = randomness_hash;

    let output_data = load_cell_data(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

pub fn verify_participant(args: &[u8]) -> Result<(), Error> {
    // instruction_args layout (args here = full_script_args[1..]):
    //   [admin_address (20, at full_args[1])][admin_pubkey (33, at full_args[21])]
    // The signature (65 bytes) is read from the transaction witness (input_type of GroupInput[0])
    // instead of type script args. This avoids a circular dependency: the outpoint that must be
    // signed over is determined by the campaign cell content, which would include the signature.
    if args.len() < 53 {
        return Err(Error::InvalidVerificationArgs);
    }

    // A "Depositor" is any caller that owns the non-campaign input cells
    let participant_address = extract_caller_address(AddressKey::Depositor)?;
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let campaign = parse_campaign_data(&campaign_data)?;

    // Check timestamp/status first; this path does not need the witness.
    // NOTE: created_at and timestamp are in milliseconds; durations are in seconds → * 1_000.
    let timestamp = get_current_timestamp()?;
    let till = campaign
        .created_at
        .checked_add(campaign.start_duration_in_seconds * 1_000)
        .and_then(|t| t.checked_add(campaign.task_duration_in_seconds * 1_000))
        .ok_or(Error::InvalidCampaignArgs)?;
    if timestamp > till || campaign.status != CampaignStatus::Active {
        return Err(Error::VerificationNotCompleted);
    }

    // Load the per-transaction signature from the campaign input's witness input_type field.
    // Use Source::Input with index 0: in every verify_participant tx the campaign cell is
    // inputs[0] (GroupInput[0] maps to the same absolute index).
    let witness =
        load_witness_args(0, Source::Input).map_err(|_| Error::InvalidVerificationArgs)?;
    let sig_bytes = witness
        .input_type()
        .to_opt()
        .ok_or(Error::InvalidVerificationArgs)?;
    let sig_raw = sig_bytes.raw_data();
    let signature: &[u8] = &sig_raw;

    // admin_pubkey lives at full_args[21..54]
    let admin_pubkey = get_admin_pubkey(21)?;

    let campaign_outpoint = {
        let campaign_input = load_input(0, Source::GroupInput)?;
        campaign_input.previous_output()
    };

    // Message: blake2b_256(participant_address || campaign_outpoint.tx_hash || campaign_outpoint.index)
    let mut buf = [0u8; 20 + 32 + 4];
    buf[0..20].copy_from_slice(&participant_address);
    buf[20..52].copy_from_slice(campaign_outpoint.tx_hash().as_slice());
    buf[52..56].copy_from_slice(campaign_outpoint.index().as_slice());
    let message = blake2b_256(&buf);

    verify_ecdsa_signature(signature, &message, &admin_pubkey)?;

    validate_participant_added(&participant_address)?;
    Ok(())
}

pub fn deposit(args: &[u8]) -> Result<(), Error> {
    // Extract and parse args
    // args format: [amount: 8 bytes]

    if args.len() < 8 {
        debug!("Args length is less than 8 bytes");
        return Err(Error::InvalidDepositArgs);
    }

    let requested_deposit = u64::from_le_bytes(args[0..8].try_into().unwrap());
    debug!("Parsed deposit amount: {}", requested_deposit);
    let current_timestamp = get_current_timestamp()?;

    // load cell input for campaign data
    let campaign_cell_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_cell_data)?;

    debug!("Current deposit: {}", campaign.current_deposits);
    debug!("Maximum amount: {}", campaign.maximum_amount);

    // validations
    // check if campaign still accepts deposits
    // NOTE: created_at and current_timestamp are in milliseconds (from CKB block header).
    //       start_duration_in_seconds is in seconds, so we multiply by 1_000 to convert.
    if current_timestamp > campaign.created_at + campaign.start_duration_in_seconds * 1_000 {
        debug!("Campaign has already started, no longer accepts deposits");
        return Err(Error::DepositNotCompleted);
    }

    if campaign.status != CampaignStatus::Created {
        debug!(
            "Campaign status is not Created, current status: {:?}",
            campaign.status
        );
        return Err(Error::DepositNotCompleted);
    }

    // VALIDATION: Campaign must accept deposits
    if !campaign.accepts_deposits() {
        debug!("Campaign does not allow deposits");
        return Err(Error::DepositNotCompleted);
    }

    // Calculate actual deposit, capped at remaining capacity
    let remaining = campaign
        .maximum_amount
        .checked_sub(campaign.current_deposits)
        .ok_or(Error::DepositNotCompleted)?;
    let actual_deposit = if requested_deposit > remaining {
        debug!(
            "Partial deposit: requested {}, accepting {}",
            requested_deposit, remaining
        );
        remaining
    } else {
        requested_deposit
    };

    validate_deposit_transfer(actual_deposit)?;

    // update the total deposits
    campaign.current_deposits = campaign
        .current_deposits
        .checked_add(actual_deposit)
        .ok_or(Error::AmountMismatch)?;
    if campaign.current_deposits == campaign.maximum_amount {
        debug!("Campaign has reached maximum amount");
    }

    // verify output campaign cell
    let output_campaign_data =
        load_cell_data(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_campaign_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    debug!("Deposit successful");

    Ok(())
}

pub fn update_campaign_status(args: &[u8]) -> Result<(), Error> {
    // This is to update the campaign status to "Active" when the campaign starts, and "Completed" when the campaign ends.
    // This can be called by anyone, but only updates the status based on the timestamp, to prevent frontrunning.
    Ok(())
}
