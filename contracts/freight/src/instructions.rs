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
        match load_cell_data(0, Source::GroupInput) {
            Ok(_) => Ok(false),
            Err(_) => Ok(true),
        }
    };

    // args format: [start_duration(8)][task_duration(8)][campaign_type(1)][maximum_amount(8)][aux_amount(8)][randomness_hash(32)]
    if args.len() < 65 {
        return Err(Error::InvalidCampaignArgs);
    }

    let start_duration_in_seconds = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let task_duration_in_seconds = u64::from_le_bytes(args[8..16].try_into().unwrap());
    let campaign_type_byte = args[16];
    let maximum_amount = u64::from_le_bytes(args[17..25].try_into().unwrap());
    let aux_amount = u64::from_le_bytes(args[25..33].try_into().unwrap());
    let mut randomness_hash = [0u8; 32];
    randomness_hash.copy_from_slice(&args[33..65]);

    if !is_campaign_creation()? {
        return Err(Error::InvalidCampaignArgs);
    }

    let creator_address = extract_caller_address(AddressKey::Creator)?;
    if !is_authorized_by_address(&creator_address)? {
        return Err(Error::Unauthorized);
    }

    let campaign_type: CampaignType = campaign_type_byte.try_into().unwrap();
    validate_campaign_params(
        start_duration_in_seconds,
        task_duration_in_seconds,
        campaign_type,
        maximum_amount,
        aux_amount,
    )?;

    let created_at = get_current_timestamp()?;

    // Read summary from the output cell data (bytes 102..166)
    let output_data = load_cell_data(0, Source::Output)?;
    if output_data.len() < 174 {
        return Err(Error::InvalidCampaignArgs);
    }
    let mut summary = [0u8; 64];
    summary.copy_from_slice(&output_data[102..166]);
    if summary.iter().all(|&b| b == 0) {
        return Err(Error::InvalidCampaignArgs);
    }

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
        randomness_hash,
        summary,
        aux_amount,
    };

    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

pub fn deposit(args: &[u8]) -> Result<(), Error> {
    if args.len() < 8 {
        return Err(Error::InvalidDepositArgs);
    }

    let requested_deposit = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let current_timestamp = get_current_timestamp()?;

    let campaign_cell_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_cell_data)?;

    if current_timestamp > campaign.created_at + campaign.start_duration_in_seconds * 1_000 {
        return Err(Error::DepositNotCompleted);
    }
    if campaign.status != CampaignStatus::Created {
        return Err(Error::DepositNotCompleted);
    }
    if !campaign.accepts_deposits() {
        return Err(Error::DepositNotCompleted);
    }

    let remaining = campaign
        .maximum_amount
        .checked_sub(campaign.current_deposits)
        .ok_or(Error::DepositNotCompleted)?;
    let actual_deposit = if requested_deposit > remaining { remaining } else { requested_deposit };

    validate_deposit_transfer(actual_deposit)?;

    campaign.current_deposits = campaign
        .current_deposits
        .checked_add(actual_deposit)
        .ok_or(Error::AmountMismatch)?;

    let output_campaign_data =
        load_cell_data(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_campaign_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

/// verify_participant for non-raffle campaigns: requires admin ECDSA signature.
/// verify_participant for Raffle campaigns: validates deposit transfer instead.
///
/// # Instruction args (non-raffle)
/// `[admin_address(20)][admin_pubkey(33)]` — signature in witness.input_type
///
/// # Instruction args (raffle)
/// No args needed — ticket price is read from campaign.aux_amount.
pub fn verify_participant(args: &[u8]) -> Result<(), Error> {
    let participant_address = extract_caller_address(AddressKey::Depositor)?;
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    if campaign.is_raffle() {
        // Campaign must be in Created status and within deposit window.
        let timestamp = get_current_timestamp()?;
        if timestamp > campaign.created_at + campaign.start_duration_in_seconds * 1_000 {
            return Err(Error::DepositNotCompleted);
        }
        if campaign.status != CampaignStatus::Created {
            return Err(Error::DepositNotCompleted);
        }

        let ticket_price = campaign.ticket_price();
        if ticket_price == 0 {
            return Err(Error::InvalidCampaignArgs);
        }

        // Validate capacity transition: campaign cell gains exactly ticket_price.
        apply_deposit(&mut campaign, ticket_price)?;

        // Verify output campaign cell data.
        let output_campaign_data =
            load_cell_data(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
        if !verify_campaign_tx(&output_campaign_data, &campaign)? {
            return Err(Error::InvalidCellData);
        }

        // Validate the new participant cell in outputs.
        validate_participant_added(&participant_address, ticket_price)?;
    } else {
        // ── Non-raffle path ──────────────────────────────────────────────────
        if args.len() < 53 {
            return Err(Error::InvalidVerificationArgs);
        }
        let timestamp = get_current_timestamp()?;
        let till = campaign
            .created_at
            .checked_add(campaign.start_duration_in_seconds * 1_000)
            .and_then(|t| t.checked_add(campaign.task_duration_in_seconds * 1_000))
            .ok_or(Error::InvalidCampaignArgs)?;
        if timestamp > till || campaign.status != CampaignStatus::Active {
            return Err(Error::VerificationNotCompleted);
        }

        let witness =
            load_witness_args(0, Source::Input).map_err(|_| Error::InvalidVerificationArgs)?;
        let sig_bytes = witness
            .input_type()
            .to_opt()
            .ok_or(Error::InvalidVerificationArgs)?;
        let sig_raw = sig_bytes.raw_data();
        let signature: &[u8] = &sig_raw;

        let admin_pubkey = get_admin_pubkey(21)?;

        let campaign_outpoint = {
            let campaign_input = load_input(0, Source::GroupInput)?;
            campaign_input.previous_output()
        };

        let mut buf = [0u8; 20 + 32 + 4];
        buf[0..20].copy_from_slice(&participant_address);
        buf[20..52].copy_from_slice(campaign_outpoint.tx_hash().as_slice());
        buf[52..56].copy_from_slice(campaign_outpoint.index().as_slice());
        let message = blake2b_256(&buf);

        verify_ecdsa_signature(signature, &message, &admin_pubkey)?;

        // For non-raffle, deposited_amount is 0 (participants don't deposit here).
        validate_participant_added(&participant_address, 0)?;
    }

    Ok(())
}

/// Cancel a campaign. Can be called by the creator at any time before Completed.
/// Sets status to Cancelled; all other fields unchanged.
pub fn cancel_campaign(_args: &[u8]) -> Result<(), Error> {
    // The caller is the non-campaign input (same pattern as depositor)
    let caller_address = extract_caller_address(AddressKey::Depositor)?;

    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    if campaign.status == CampaignStatus::Completed || campaign.status == CampaignStatus::Cancelled {
        return Err(Error::InvalidOperation);
    }

    // Only the creator may cancel
    if campaign.created_by != caller_address {
        return Err(Error::Unauthorized);
    }

    campaign.status = CampaignStatus::Cancelled;

    let output_data = load_cell_data(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

/// Refund participants of a cancelled campaign.
/// Works for all campaign types; campaign must be Cancelled.
/// Caller must be the campaign creator.
///
/// Transaction structure:
/// - inputs[0]:  campaign cell
/// - inputs[1+]: Verified participant cells linked to this campaign
/// - outputs[0]: updated campaign cell (current_deposits reduced by total refunded)
/// - outputs[1+]: participant cells with status = Refunded, capacity += deposited_amount
pub fn refund(_args: &[u8]) -> Result<(), Error> {
    let caller_address = extract_caller_address(AddressKey::Depositor)?;

    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    if campaign.created_by != caller_address {
        return Err(Error::Unauthorized);
    }
    if campaign.status != CampaignStatus::Cancelled {
        return Err(Error::InvalidOperation);
    }

    // Get the campaign outpoint to verify participant linkage
    let campaign_input = load_input(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let outpoint = campaign_input.previous_output();
    let campaign_index = u32::from_le_bytes(outpoint.index().as_slice().try_into().unwrap());

    let total_refunded = validate_refund_outputs(outpoint.tx_hash().as_slice(), campaign_index)?;

    // Update campaign deposits
    campaign.current_deposits = campaign
        .current_deposits
        .checked_sub(total_refunded)
        .ok_or(Error::AmountMismatch)?;

    let output_data = load_cell_data(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

pub fn batch_deliver(args: &[u8]) -> Result<(), Error> {
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    let timestamp = get_current_timestamp()?;
    let till = campaign.created_at
        .checked_add(campaign.start_duration_in_seconds * 1_000)
        .and_then(|t| t.checked_add(campaign.task_duration_in_seconds * 1_000))
        .ok_or(Error::InvalidCampaignArgs)?;
    if timestamp <= till {
        return Err(Error::InvalidOperation);
    }

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

    let batch_size = count_participant_inputs()?;
    if batch_size == 0 {
        return Err(Error::InvalidOperation);
    }

    let reward_per_participant = if campaign.reward_count == 0 {
        campaign.current_deposits
            .checked_div(batch_size as u64)
            .ok_or(Error::InvalidOperation)?
    } else {
        campaign.current_deposits
            .checked_div(campaign.reward_count)
            .ok_or(Error::InvalidOperation)?
    };

    validate_batch_delivery(reward_per_participant)?;

    let total_payout = reward_per_participant
        .checked_mul(batch_size as u64)
        .ok_or(Error::AmountMismatch)?;
    campaign.current_deposits = campaign.current_deposits
        .checked_sub(total_payout)
        .ok_or(Error::AmountMismatch)?;

    let output_data = load_cell_data(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

pub fn submit_randomness_hash(args: &[u8]) -> Result<(), Error> {
    if args.len() < 40 {
        return Err(Error::InvalidCampaignArgs);
    }
    let reward_count = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let mut randomness_hash = [0u8; 32];
    randomness_hash.copy_from_slice(&args[8..40]);

    let creator_address = extract_caller_address(AddressKey::Creator)?;
    if !is_authorized_by_address(&creator_address)? {
        return Err(Error::Unauthorized);
    }

    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

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

pub fn update_campaign_status(_args: &[u8]) -> Result<(), Error> {
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    let timestamp = get_current_timestamp()?;
    let start_time = campaign
        .created_at
        .checked_add(campaign.start_duration_in_seconds * 1_000)
        .ok_or(Error::InvalidCampaignArgs)?;
    let end_time = start_time
        .checked_add(campaign.task_duration_in_seconds * 1_000)
        .ok_or(Error::InvalidCampaignArgs)?;

    let new_status = if timestamp >= end_time {
        CampaignStatus::Completed
    } else if timestamp >= start_time {
        CampaignStatus::Active
    } else {
        return Err(Error::InvalidOperation); // nothing to update yet
    };

    // Only allow forward transitions
    if new_status as u8 <= campaign.status as u8 {
        return Err(Error::InvalidOperation);
    }

    campaign.status = new_status;

    let output_data = load_cell_data(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}
