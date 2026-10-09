use crate::errors::Error;
use crate::types::{next_recurring_winner_count, AddressKey, Campaign, CampaignStatus, CampaignType, RecurringRaffleState, CAMPAIGN_DATA_LEN, RECURRING_CAMPAIGN_DATA_LEN};
use crate::utils::*;
use crate::validations::*;
use ckb_hash::blake2b_256;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::Entity;
use ckb_std::high_level::{load_cell_capacity, load_cell_lock, load_input, load_script, load_witness_args};
use crate::utils::verify_ecdsa_signature;
use ckb_std::{debug, high_level::load_cell_data};

pub fn create_campaign(args: &[u8]) -> Result<(), Error> {
    let is_campaign_creation = || -> Result<bool, Error> {
        match load_cell_data(0, Source::GroupInput) {
            Ok(_) => Ok(false),
            Err(_) => Ok(true),
        }
    };

    // args format: [start_duration(8)][task_duration(8)][campaign_type(1)][maximum_amount(8)][aux_amount(8)][randomness_hash(32)][reward_count(8)][support_pool_bps(8)][optional tickets_per_user(8)]
    debug!("create_campaign args len={}", args.len());
    if args.len() < 81 {
        return Err(Error::InvalidCampaignArgs);
    }

    let start_duration_in_seconds = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let task_duration_in_seconds = u64::from_le_bytes(args[8..16].try_into().unwrap());
    let campaign_type_byte = args[16];
    let maximum_amount = u64::from_le_bytes(args[17..25].try_into().unwrap());
    let aux_amount = u64::from_le_bytes(args[25..33].try_into().unwrap());
    let mut randomness_hash = [0u8; 32];
    randomness_hash.copy_from_slice(&args[33..65]);
    let reward_count = u64::from_le_bytes(args[65..73].try_into().unwrap());
    let support_pool_bps = u64::from_le_bytes(args[73..81].try_into().unwrap());
    let is_recurring = campaign_type_byte == CampaignType::RecurringRaffle as u8;
    let approval_offset = if is_recurring { 105 } else { 89 };
    let approval = if args.len() > approval_offset {
        crate::approvals::parse_approval(&args[approval_offset..])?
    } else { None };
    let base_args_len = args.len() - approval.as_ref().map_or(0, |gate| gate.encoded_len());
    if (!is_recurring && base_args_len != 81 && base_args_len != 89) || (is_recurring && base_args_len != 105) {
        return Err(Error::InvalidCampaignArgs);
    }
    if args.len() >= 89 {
        let is_gift = campaign_type_byte == CampaignType::FundedTask as u8 && approval.as_ref().is_some_and(|gate| gate.stage == 3);
        if campaign_type_byte != CampaignType::Raffle as u8 && !is_recurring && !is_gift {
            return Err(Error::InvalidCampaignArgs);
        }
        let tickets_per_user = u64::from_le_bytes(args[81..89].try_into().unwrap());
        if (is_gift && tickets_per_user != 0) || (!is_gift && tickets_per_user == 0) {
            return Err(Error::InvalidCampaignArgs);
        }
    }
    let recurring_config = if is_recurring {
        let sleep_duration_in_seconds = u64::from_le_bytes(args[89..97].try_into().unwrap());
        let winner_reduction_bps = u64::from_le_bytes(args[97..105].try_into().unwrap());
        if aux_amount == 0
            || !(60..=365 * 24 * 60 * 60).contains(&sleep_duration_in_seconds)
            || winner_reduction_bps == 0
            || winner_reduction_bps > 10_000
        {
            return Err(Error::InvalidCampaignArgs);
        }
        Some((sleep_duration_in_seconds, winner_reduction_bps))
    } else {
        None
    };

    if !is_campaign_creation()? {
        debug!("create_campaign rejected because group input exists");
        return Err(Error::InvalidCampaignArgs);
    }

    let creator_address = extract_caller_address(AddressKey::Creator)?;
    debug!("create_campaign creator={:x?}", creator_address);
    if !is_authorized_by_address(&creator_address)? {
        debug!("create_campaign unauthorized creator");
        return Err(Error::Unauthorized);
    }

    let campaign_type: CampaignType = campaign_type_byte.try_into().unwrap();
    if let Some(gate) = &approval {
        gate.validate(campaign_type, start_duration_in_seconds)?;
        crate::approvals::verify_single_campaign_cell(Source::GroupOutput)?;
        if gate.confirmed || gate.approvers.iter().any(|entry| entry.1) { return Err(Error::InvalidCampaignArgs); }
    }
    debug!("create_campaign params start={} task={} type={:?} max={} aux={} reward={} support_pool_bps={}", start_duration_in_seconds, task_duration_in_seconds, campaign_type, maximum_amount, aux_amount, reward_count, support_pool_bps);
    validate_campaign_params(
        start_duration_in_seconds,
        task_duration_in_seconds,
        campaign_type,
        maximum_amount,
        aux_amount,
        support_pool_bps,
    )?;

    let created_at = get_current_timestamp()?;
    if approval.as_ref().is_some_and(|gate| gate.stage == 1) {
        created_at.checked_add(start_duration_in_seconds.checked_mul(1000).ok_or(Error::InvalidCampaignArgs)?)
            .ok_or(Error::InvalidCampaignArgs)?;
    }

    // Read summary from the output cell data (bytes 102..166)
    let output_data = load_cell_data(0, Source::Output)?;
    let expected_data_len = if is_recurring { RECURRING_CAMPAIGN_DATA_LEN } else { CAMPAIGN_DATA_LEN };
    let expected_data_len = expected_data_len + approval.as_ref().map_or(0, |gate| gate.encoded_len());
    if output_data.len() != expected_data_len {
        return Err(Error::InvalidCampaignArgs);
    }
    let mut summary = [0u8; 64];
    summary.copy_from_slice(&output_data[102..166]);
    if summary.iter().all(|&b| b == 0) {
        return Err(Error::InvalidCampaignArgs);
    }

    let campaign = Campaign {
        approval,
        created_at,
        start_duration_in_seconds,
        task_duration_in_seconds,
        created_by: creator_address,
        campaign_type,
        maximum_amount,
        current_deposits: 0,
        status: CampaignStatus::Created,
        reward_count,
        randomness_hash,
        summary,
        aux_amount,
        ticket_sales_total: 0,
        creator_support_total: 0,
        support_pool_bps,
    };

    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }
    if let Some((sleep_duration_in_seconds, winner_reduction_bps)) = recurring_config {
        let output_lock = load_cell_lock(0, Source::Output).map_err(|_| Error::InvalidCellData)?;
        let output_lock_args = output_lock.args().raw_data();
        let current_script = load_script().map_err(|_| Error::LoadScriptFailed)?;
        if output_lock.code_hash() != current_script.code_hash()
            || output_lock_args.len() != 21
            || output_lock_args[0] != 255
            || output_lock_args[1..21] != creator_address
        {
            return Err(Error::InvalidCellData);
        }
        let expected = RecurringRaffleState {
            sleep_duration_in_seconds,
            winner_reduction_bps,
            round: 1,
            round_started_at: created_at
                .checked_add(start_duration_in_seconds.checked_mul(1_000).ok_or(Error::InvalidCampaignArgs)?)
                .ok_or(Error::InvalidCampaignArgs)?,
            round_reward_per_winner: 0,
            round_winner_count: 0,
            prize_pool: 0,
        };
        if parse_recurring_raffle_state(&output_data)? != expected {
            return Err(Error::InvalidCellData);
        }
    }

    Ok(())
}

pub fn approve_campaign(args: &[u8]) -> Result<(), Error> {
    if args.len() != 1 { return Err(Error::InvalidCampaignArgs); }
    let input_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&input_data)?;
    if campaign.status == CampaignStatus::Cancelled { return Err(Error::InvalidOperation); }
    let deadline = campaign.created_at.checked_add(campaign.start_duration_in_seconds.checked_mul(1000).ok_or(Error::InvalidCampaignArgs)?)
        .ok_or(Error::InvalidCampaignArgs)?;
    let gate = campaign.approval.as_mut().ok_or(Error::InvalidOperation)?;
    if gate.stage == 1 && get_current_timestamp()? >= deadline { return Err(Error::ApprovalDeadlineMissed); }
    let entry = gate.approvers.get_mut(args[0] as usize).ok_or(Error::Unauthorized)?;
    if entry.1 { return Err(Error::InvalidOperation); }
    let mut authorized = false;
    let own_code_hash = load_script()?.code_hash();
    let mut index = 0;
    loop {
        match ckb_std::high_level::load_cell_lock_hash(index, Source::Input) {
            Ok(hash) => {
                let lock = load_cell_lock(index, Source::Input)?;
                let is_state_lock = lock.code_hash() == own_code_hash && lock.args().raw_data().first() == Some(&255);
                if hash == entry.0 && !is_state_lock { authorized = true; }
                index += 1;
            },
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(error) => return Err(error.into()),
        }
    }
    if !authorized { return Err(Error::Unauthorized); }
    entry.1 = true;
    let output_data = load_cell_data(0, Source::GroupOutput)?;
    if !verify_campaign_tx(&output_data, &campaign)?
        || load_cell_capacity(0, Source::GroupInput)? != load_cell_capacity(0, Source::GroupOutput)?
        || load_cell_lock(0, Source::GroupInput)? != load_cell_lock(0, Source::GroupOutput)?
        || (campaign.is_recurring_raffle() && parse_recurring_raffle_state(&input_data)? != parse_recurring_raffle_state(&output_data)?)
    { return Err(Error::InvalidCellData); }
    Ok(())
}

// The input's inclusion header cannot be substituted with a stale header dep.
// This seals the initial approval once, so later recurring rounds need no votes.
pub fn confirm_raffle_approval(args: &[u8]) -> Result<(), Error> {
    if !args.is_empty() { return Err(Error::InvalidCampaignArgs); }
    let input_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&input_data)?;
    if campaign.status != CampaignStatus::Created { return Err(Error::InvalidOperation); }
    let deadline = campaign.created_at.checked_add(campaign.start_duration_in_seconds.checked_mul(1000).ok_or(Error::InvalidCampaignArgs)?)
        .ok_or(Error::InvalidCampaignArgs)?;
    let gate = campaign.approval.as_mut().ok_or(Error::InvalidOperation)?;
    if gate.stage != 1 || gate.confirmed || !gate.threshold_met() { return Err(Error::ApprovalRequired); }
    let header = ckb_std::high_level::load_header(0, Source::GroupInput)?;
    let recorded_at: u64 = header.raw().timestamp().into();
    if recorded_at >= deadline { return Err(Error::ApprovalDeadlineMissed); }
    gate.confirmed = true;
    let output_data = load_cell_data(0, Source::GroupOutput)?;
    if !verify_campaign_tx(&output_data, &campaign)?
        || load_cell_capacity(0, Source::GroupInput)? != load_cell_capacity(0, Source::GroupOutput)?
        || load_cell_lock(0, Source::GroupInput)? != load_cell_lock(0, Source::GroupOutput)?
        || (campaign.is_recurring_raffle() && parse_recurring_raffle_state(&input_data)? != parse_recurring_raffle_state(&output_data)?)
    { return Err(Error::InvalidCellData); }
    Ok(())
}

pub fn deposit(args: &[u8]) -> Result<(), Error> {
    if args.len() < 8 {
        return Err(Error::InvalidDepositArgs);
    }

    let requested_deposit = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let campaign_cell_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_cell_data)?;
    let mut recurring = if campaign.is_recurring_raffle() {
        Some(parse_recurring_raffle_state(&campaign_cell_data)?)
    } else {
        None
    };

    if !campaign.accepts_deposits() {
        return Err(Error::DepositNotCompleted);
    }

    if campaign.campaign_type == CampaignType::SimpleTask {
        validate_creator_tip_transfer(requested_deposit, &campaign.created_by)?;
        campaign.current_deposits = campaign
            .current_deposits
            .checked_add(requested_deposit)
            .ok_or(Error::AmountMismatch)?;
    } else if campaign.is_raffle() {
        apply_creator_support_deposit(&mut campaign, requested_deposit)?;
        if let Some(state) = recurring.as_mut() {
            let contribution = requested_deposit
                .checked_mul(campaign.support_pool_bps)
                .ok_or(Error::AmountMismatch)? / 10_000;
            state.prize_pool = state.prize_pool.checked_add(contribution).ok_or(Error::AmountMismatch)?;
        }
    } else {
        apply_deposit(&mut campaign, requested_deposit)?;
    }

    let output_campaign_data =
        load_cell_data(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_campaign_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }
    if let Some(expected) = recurring {
        verify_recurring_campaign_lock()?;
        if parse_recurring_raffle_state(&output_campaign_data)? != expected {
            return Err(Error::InvalidCellData);
        }
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
/// Optional [ticket_count(8)] — absent means one ticket.
pub fn verify_participant(args: &[u8]) -> Result<(), Error> {
    let participant_address = extract_caller_address(AddressKey::Depositor)?;
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    if campaign.is_raffle() {
        // Ticket purchases are only allowed after the campaign has started
        // (i.e. after the momentum-building start_duration has elapsed)
        // and before the task_duration window has closed.
        //
        // Timeline:
        //   created_at
        //     └─ + start_duration ──► sales open  (status transitions to Active)
        //          └─ + task_duration ──► sales close (draw can happen)
        let timestamp = get_current_timestamp()?;
        let mut recurring = if campaign.is_recurring_raffle() {
            Some(parse_recurring_raffle_state(&campaign_data)?)
        } else {
            None
        };
        let sales_open = recurring.as_ref().map(|state| state.round_started_at).unwrap_or(
            campaign.created_at
                .checked_add(campaign.start_duration_in_seconds * 1_000)
                .ok_or(Error::InvalidCampaignArgs)?,
        );
        let sales_close = sales_open
            .checked_add(campaign.task_duration_in_seconds * 1_000)
            .ok_or(Error::InvalidCampaignArgs)?;

        if timestamp < sales_open {
            return Err(Error::DepositNotCompleted); // too early — still in momentum window
        }
        if timestamp >= sales_close {
            return Err(Error::DepositNotCompleted); // too late — sales window closed
        }
        if campaign.status != CampaignStatus::Active {
            return Err(Error::DepositNotCompleted); // must be Active
        }

        let ticket_count = if args.is_empty() {
            1
        } else if args.len() == 8 {
            u64::from_le_bytes(args[0..8].try_into().unwrap())
        } else {
            return Err(Error::InvalidVerificationArgs);
        };
        if ticket_count == 0 {
            return Err(Error::InvalidVerificationArgs);
        }
        let ticket_price = campaign.ticket_price();
        let ticket_limit = campaign.ticket_limit();
        if ticket_limit != 0 && campaign.sold_tickets().checked_add(ticket_count).ok_or(Error::AmountMismatch)? > ticket_limit {
            return Err(Error::InvalidOperation);
        }

        let script_args = load_script().map_err(|_| Error::InvalidCampaignArgs)?.args().raw_data();
        let tickets_per_user = if script_args.len() >= 90 {
            u64::from_le_bytes(script_args[82..90].try_into().unwrap())
        } else {
            1
        };
        if ticket_count > tickets_per_user {
            return Err(Error::InvalidOperation);
        }

        let total_price = ticket_price.checked_mul(ticket_count).ok_or(Error::AmountMismatch)?;

        apply_ticket_sale_deposit(&mut campaign, total_price, ticket_count)?;
        if let Some(state) = recurring.as_mut() {
            state.prize_pool = state.prize_pool.checked_add(total_price).ok_or(Error::AmountMismatch)?;
        }

        // Verify output campaign cell data.
        let output_campaign_data =
            load_cell_data(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
        if !verify_campaign_tx(&output_campaign_data, &campaign)? {
            return Err(Error::InvalidCellData);
        }
        if let Some(expected) = recurring.as_ref() {
            verify_recurring_campaign_lock()?;
            if parse_recurring_raffle_state(&output_campaign_data)? != *expected {
                return Err(Error::InvalidCellData);
            }
        }

        // Validate the new participant cell in outputs.
        validate_raffle_entry_count(
            &participant_address, &campaign.created_by, campaign.created_at,
            campaign.campaign_type, ticket_price, ticket_count,
            recurring.as_ref().map(|state| state.round),
        )?;
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
        validate_participant_added(
            &participant_address,
            &campaign.created_by,
            campaign.created_at,
            campaign.campaign_type,
            0,
        )?;
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

    if campaign.status == CampaignStatus::Completed
        || campaign.status == CampaignStatus::Cancelled
        || (campaign.is_recurring_raffle()
            && (campaign.status == CampaignStatus::Sleeping
                || campaign.status == CampaignStatus::Finished))
    {
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

    let total_refunded = validate_refund_outputs(
        &campaign.created_by,
        campaign.created_at,
        campaign.campaign_type,
    )?;

    // Update campaign deposits
    campaign.current_deposits = campaign
        .current_deposits
        .checked_sub(total_refunded)
        .ok_or(Error::AmountMismatch)?;
    if campaign.is_raffle() {
        campaign.ticket_sales_total = campaign
            .ticket_sales_total
            .checked_sub(total_refunded)
            .ok_or(Error::AmountMismatch)?;
    }

    let output_data = load_cell_data(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

pub fn creator_withdraw(_args: &[u8]) -> Result<(), Error> {
    let caller_address = extract_caller_address(AddressKey::Depositor)?;

    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;

    if campaign.created_by != caller_address {
        return Err(Error::Unauthorized);
    }

    let timestamp = get_current_timestamp()?;
    let can_withdraw = campaign
        .can_creator_withdraw(timestamp)
        .ok_or(Error::InvalidOperation)?;
    if !can_withdraw {
        return Err(Error::InvalidOperation);
    }

    let withdraw_amount = campaign
        .creator_withdrawable_amount()
        .ok_or(Error::AmountMismatch)?;
    if withdraw_amount == 0 {
        return Err(Error::InvalidOperation);
    }

    validate_creator_withdraw_transfer(withdraw_amount, &campaign.created_by)?;

    campaign.current_deposits = campaign
        .current_deposits
        .checked_sub(withdraw_amount)
        .ok_or(Error::AmountMismatch)?;
    campaign.creator_support_total = campaign
        .creator_support_total
        .checked_sub(withdraw_amount)
        .ok_or(Error::AmountMismatch)?;
    campaign.support_pool_bps = 0;

    let output_data = load_cell_data(0, Source::GroupOutput)
        .map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

fn compare_participants(left: &ParticipantEntry, right: &ParticipantEntry) -> core::cmp::Ordering {
    left.participant.joined_at
        .cmp(&right.participant.joined_at)
        .then_with(|| left.participant.participant_address.cmp(&right.participant.participant_address))
        .then_with(|| left.input_tx_hash.cmp(&right.input_tx_hash))
        .then_with(|| left.input_index.cmp(&right.input_index))
}

fn derive_shuffle_seed(revealed: &[u8; 32], participants_len: usize, campaign_tx_hash: &[u8; 32], campaign_index: u32) -> [u8; 32] {
    let mut material = [0u8; 32 + 32 + 4 + 8];
    material[0..32].copy_from_slice(revealed);
    material[32..64].copy_from_slice(campaign_tx_hash);
    material[64..68].copy_from_slice(&campaign_index.to_le_bytes());
    material[68..76].copy_from_slice(&(participants_len as u64).to_le_bytes());
    blake2b_256(&material)
}

fn derive_round_hash(seed: &[u8; 32], round: u64) -> [u8; 32] {
    let mut material = [0u8; 40];
    material[0..32].copy_from_slice(seed);
    material[32..40].copy_from_slice(&round.to_le_bytes());
    blake2b_256(&material)
}

fn draw_uniform_index(seed: &[u8; 32], round: &mut u64, upper_bound: usize) -> usize {
    let range = upper_bound as u64;
    let threshold = u64::MAX - (u64::MAX % range);

    loop {
        let round_hash = derive_round_hash(seed, *round);
        *round = round.saturating_add(1);
        let candidate = u64::from_le_bytes(round_hash[0..8].try_into().unwrap());
        if candidate < threshold {
            return (candidate % range) as usize;
        }
    }
}

fn deterministic_shuffle(participants: &mut [ParticipantEntry], seed: &[u8; 32]) {
    if participants.len() <= 1 {
        return;
    }

    let mut round = 0u64;
    let mut i = participants.len();
    while i > 1 {
        i -= 1;
        let j = draw_uniform_index(seed, &mut round, i + 1);
        participants.swap(i, j);
    }
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

    let campaign_input = load_input(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let outpoint = campaign_input.previous_output();
    let mut campaign_tx_hash = [0u8; 32];
    campaign_tx_hash.copy_from_slice(outpoint.tx_hash().as_slice());
    let campaign_index = u32::from_le_bytes(outpoint.index().as_slice().try_into().unwrap());

    let mut participants = collect_verified_participants(
        &campaign.created_by,
        campaign.created_at,
        campaign.campaign_type,
    )?;
    let participant_count = participants.len();
    if participant_count == 0 {
        return Err(Error::InvalidOperation);
    }

    participants.sort_by(compare_participants);

    let winner_count = if campaign.reward_count == 0 {
        participant_count
    } else {
        core::cmp::min(campaign.reward_count as usize, participant_count)
    };
    if winner_count == 0 {
        return Err(Error::InvalidOperation);
    }

    let requires_randomness = campaign.randomness_hash != [0u8; 32] && participant_count > winner_count;
    if requires_randomness {
        if args.len() < 32 {
            return Err(Error::InvalidVerificationArgs);
        }
        let revealed: &[u8; 32] = args[0..32].try_into().unwrap();
        if blake2b_256(revealed) != campaign.randomness_hash {
            return Err(Error::RandomnessMismatch);
        }
        let seed = derive_shuffle_seed(revealed, participant_count, &campaign_tx_hash, campaign_index);
        deterministic_shuffle(&mut participants, &seed);
    }

    let winners = &participants[..winner_count];
    let reward_pool_amount = campaign
        .reward_pool_amount()
        .ok_or(Error::AmountMismatch)?;
    let reward_per_participant = reward_pool_amount
        .checked_div(winner_count as u64)
        .ok_or(Error::InvalidOperation)?;

    validate_batch_delivery_for_winners(winners, reward_per_participant)?;

    let total_payout = reward_per_participant
        .checked_mul(winner_count as u64)
        .ok_or(Error::AmountMismatch)?;
    campaign.current_deposits = campaign.current_deposits
        .checked_sub(total_payout)
        .ok_or(Error::AmountMismatch)?;
    if campaign.is_raffle() {
        campaign.ticket_sales_total = 0;
        campaign.creator_support_total = campaign.current_deposits;
        campaign.support_pool_bps = 0;
    }

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
    let recurring = if campaign.is_recurring_raffle() {
        Some(parse_recurring_raffle_state(&campaign_data)?)
    } else {
        None
    };

    let timestamp = get_current_timestamp()?;
    let start_time = campaign
        .created_at
        .checked_add(campaign.start_duration_in_seconds * 1_000)
        .ok_or(Error::InvalidCampaignArgs)?;
    let end_time = start_time
        .checked_add(campaign.task_duration_in_seconds * 1_000)
        .ok_or(Error::InvalidCampaignArgs)?;

    let new_status = if campaign.is_recurring_raffle() {
        if campaign.status == CampaignStatus::Created && timestamp >= start_time {
            CampaignStatus::Active
        } else {
            return Err(Error::InvalidOperation);
        }
    } else if campaign.campaign_type == CampaignType::SimpleTask && timestamp >= start_time {
        CampaignStatus::Active
    } else if timestamp >= end_time {
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
    if let Some(expected) = recurring {
        verify_recurring_campaign_lock()?;
        if parse_recurring_raffle_state(&output_data)? != expected {
            return Err(Error::InvalidCellData);
        }
    }

    Ok(())
}

fn verify_recurring_campaign_lock() -> Result<(), Error> {
    let input_lock = load_cell_lock(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let output_lock = load_cell_lock(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
    if input_lock != output_lock {
        return Err(Error::InvalidCellData);
    }
    Ok(())
}

fn verify_recurring_output(campaign: &Campaign, recurring: &RecurringRaffleState) -> Result<(), Error> {
    verify_recurring_campaign_lock()?;
    let output = load_cell_data(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output, campaign)? || parse_recurring_raffle_state(&output)? != *recurring {
        return Err(Error::InvalidCellData);
    }
    Ok(())
}

fn compare_recurring_participants(
    left: &RecurringParticipantEntry,
    right: &RecurringParticipantEntry,
) -> core::cmp::Ordering {
    left.participant.joined_at
        .cmp(&right.participant.joined_at)
        .then_with(|| left.participant.participant_address.cmp(&right.participant.participant_address))
        .then_with(|| left.input_tx_hash.cmp(&right.input_tx_hash))
        .then_with(|| left.input_index.cmp(&right.input_index))
}

fn recurring_shuffle_seed(
    revealed: &[u8; 32],
    campaign: &Campaign,
    recurring: &RecurringRaffleState,
    participants_len: usize,
) -> [u8; 32] {
    let mut material = [0u8; 32 + 20 + 8 + 8 + 8];
    material[0..32].copy_from_slice(revealed);
    material[32..52].copy_from_slice(&campaign.created_by);
    material[52..60].copy_from_slice(&campaign.created_at.to_le_bytes());
    material[60..68].copy_from_slice(&recurring.round.to_le_bytes());
    material[68..76].copy_from_slice(&(participants_len as u64).to_le_bytes());
    blake2b_256(&material)
}

fn shuffle_recurring_participants(participants: &mut [RecurringParticipantEntry], seed: &[u8; 32]) {
    if participants.len() <= 1 {
        return;
    }
    let mut hash_round = 0u64;
    let mut i = participants.len();
    while i > 1 {
        i -= 1;
        let j = draw_uniform_index(seed, &mut hash_round, i + 1);
        participants.swap(i, j);
    }
}

pub fn draw_recurring_raffle(args: &[u8]) -> Result<(), Error> {
    if args.len() != 32 {
        return Err(Error::InvalidVerificationArgs);
    }
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;
    if !campaign.is_recurring_raffle() || campaign.status != CampaignStatus::Active {
        return Err(Error::InvalidOperation);
    }
    let mut recurring = parse_recurring_raffle_state(&campaign_data)?;
    let timestamp = get_current_timestamp()?;
    let round_ends_at = recurring.round_started_at
        .checked_add(campaign.task_duration_in_seconds.checked_mul(1_000).ok_or(Error::InvalidCampaignArgs)?)
        .ok_or(Error::InvalidCampaignArgs)?;
    if timestamp < round_ends_at {
        return Err(Error::InvalidOperation);
    }
    let revealed: &[u8; 32] = args.try_into().map_err(|_| Error::InvalidVerificationArgs)?;
    if blake2b_256(revealed) != campaign.randomness_hash {
        return Err(Error::RandomnessMismatch);
    }
    let mut participants = collect_recurring_participants(
        &campaign.created_by,
        campaign.created_at,
        recurring.round,
        crate::types::ParticipantStatus::Verified,
    )?;
    if participants.is_empty() {
        recurring.round = recurring.round.checked_add(1).ok_or(Error::AmountMismatch)?;
        recurring.round_started_at = timestamp;
        recurring.round_reward_per_winner = 0;
        recurring.round_winner_count = 0;
        campaign.ticket_sales_total = 0;
        let input_capacity = load_cell_capacity(0, Source::GroupInput)
            .map_err(|_| Error::InvalidCellData)?;
        let output_capacity = load_cell_capacity(0, Source::GroupOutput)
            .map_err(|_| Error::InvalidCellData)?;
        if output_capacity != input_capacity {
            return Err(Error::AmountMismatch);
        }
        return verify_recurring_output(&campaign, &recurring);
    }
    participants.sort_by(compare_recurring_participants);
    let winner_count = core::cmp::min(campaign.reward_count as usize, participants.len());
    if winner_count == 0 {
        return Err(Error::InvalidOperation);
    }
    let seed = recurring_shuffle_seed(revealed, &campaign, &recurring, participants.len());
    shuffle_recurring_participants(&mut participants, &seed);
    let reward_per_winner = recurring.prize_pool
        .checked_div(winner_count as u64)
        .ok_or(Error::InvalidOperation)?;

    validate_recurring_draw_outputs(&participants, winner_count, recurring.round, reward_per_winner)?;
    campaign.status = CampaignStatus::Sleeping;
    recurring.round_reward_per_winner = reward_per_winner;
    recurring.round_winner_count = winner_count as u64;
    verify_recurring_output(&campaign, &recurring)
}

fn find_recurring_participant(status: crate::types::ParticipantStatus) -> Result<RecurringParticipantEntry, Error> {
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let campaign = parse_campaign_data(&campaign_data)?;
    let recurring = parse_recurring_raffle_state(&campaign_data)?;
    let entries = collect_recurring_participants(
        &campaign.created_by,
        campaign.created_at,
        recurring.round,
        status,
    )?;
    if entries.len() != 1 {
        return Err(Error::InvalidOperation);
    }
    Ok(entries[0].clone())
}

fn validate_participant_release(entry: &RecurringParticipantEntry, amount: u64) -> Result<(), Error> {
    if !is_authorized_by_address(&entry.participant.participant_address)? {
        return Err(Error::Unauthorized);
    }
    let expected_capacity = entry.input_capacity.checked_add(amount).ok_or(Error::AmountMismatch)?;
    let mut i = 1;
    while let Ok(lock) = load_cell_lock(i, Source::Output) {
        let args = lock.args().raw_data();
        if args.first() != Some(&255)
            && args.len() >= 20
            && &args[0..20] == &entry.participant.participant_address
            && load_cell_capacity(i, Source::Output).map_err(|_| Error::InvalidCellData)? >= expected_capacity
        {
            return Ok(());
        }
        i += 1;
    }
    Err(Error::AmountMismatch)
}

pub fn claim_recurring_raffle(_args: &[u8]) -> Result<(), Error> {
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;
    let mut recurring = parse_recurring_raffle_state(&campaign_data)?;
    if !campaign.is_recurring_raffle() || campaign.status != CampaignStatus::Sleeping {
        return Err(Error::InvalidOperation);
    }
    let deadline = recurring.round_started_at
        .checked_add(campaign.task_duration_in_seconds.checked_mul(1_000).ok_or(Error::InvalidCampaignArgs)?)
        .and_then(|value| value.checked_add(recurring.sleep_duration_in_seconds.checked_mul(1_000)?))
        .ok_or(Error::InvalidCampaignArgs)?;
    if get_current_timestamp()? > deadline {
        return Err(Error::InvalidOperation);
    }
    let winner = find_recurring_participant(crate::types::ParticipantStatus::Winner)?;
    if winner.claimable_amount != recurring.round_reward_per_winner || winner.claimable_amount == 0 {
        return Err(Error::AmountMismatch);
    }
    validate_participant_release(&winner, winner.claimable_amount)?;
    campaign.current_deposits = campaign.current_deposits.checked_sub(winner.claimable_amount).ok_or(Error::AmountMismatch)?;
    recurring.prize_pool = recurring.prize_pool.checked_sub(winner.claimable_amount).ok_or(Error::AmountMismatch)?;
    if recurring.round_winner_count == 1 {
        campaign.status = CampaignStatus::Finished;
        campaign.ticket_sales_total = 0;
        campaign.creator_support_total = campaign.current_deposits;
        campaign.support_pool_bps = 0;
        recurring.prize_pool = 0;
    }
    let input_capacity = load_cell_capacity(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let output_capacity = load_cell_capacity(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
    if output_capacity != input_capacity.checked_sub(winner.claimable_amount).ok_or(Error::AmountMismatch)? {
        return Err(Error::AmountMismatch);
    }
    verify_recurring_output(&campaign, &recurring)
}

pub fn rollover_recurring_raffle(_args: &[u8]) -> Result<(), Error> {
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let mut campaign = parse_campaign_data(&campaign_data)?;
    let mut recurring = parse_recurring_raffle_state(&campaign_data)?;
    if !campaign.is_recurring_raffle() || campaign.status != CampaignStatus::Sleeping {
        return Err(Error::InvalidOperation);
    }
    let timestamp = get_current_timestamp()?;
    let deadline = recurring.round_started_at
        .checked_add(campaign.task_duration_in_seconds.checked_mul(1_000).ok_or(Error::InvalidCampaignArgs)?)
        .and_then(|value| value.checked_add(recurring.sleep_duration_in_seconds.checked_mul(1_000)?))
        .ok_or(Error::InvalidCampaignArgs)?;
    if timestamp <= deadline {
        return Err(Error::InvalidOperation);
    }
    if recurring.round_winner_count == 1 {
        campaign.status = CampaignStatus::Finished;
        campaign.ticket_sales_total = 0;
        campaign.creator_support_total = campaign.current_deposits;
        campaign.support_pool_bps = 0;
        recurring.prize_pool = 0;
    } else {
        campaign.reward_count = next_recurring_winner_count(recurring.round_winner_count, recurring.winner_reduction_bps)
            .ok_or(Error::InvalidCampaignArgs)?;
        campaign.status = CampaignStatus::Active;
        campaign.ticket_sales_total = 0;
        recurring.round = recurring.round.checked_add(1).ok_or(Error::AmountMismatch)?;
        recurring.round_started_at = timestamp;
        recurring.round_reward_per_winner = 0;
        recurring.round_winner_count = 0;
    }
    let input_capacity = load_cell_capacity(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let output_capacity = load_cell_capacity(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
    if output_capacity != input_capacity {
        return Err(Error::AmountMismatch);
    }
    verify_recurring_output(&campaign, &recurring)
}

pub fn reclaim_recurring_participant(_args: &[u8]) -> Result<(), Error> {
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let campaign = parse_campaign_data(&campaign_data)?;
    let recurring = parse_recurring_raffle_state(&campaign_data)?;
    if !campaign.is_recurring_raffle() {
        return Err(Error::InvalidOperation);
    }
    let mut candidates = collect_recurring_participants(
        &campaign.created_by,
        campaign.created_at,
        recurring.round,
        crate::types::ParticipantStatus::Eliminated,
    )?;
    if candidates.is_empty() {
        // A winner from an earlier round becomes reclaimable after rollover.
        let mut i = 1;
        while let Ok(data) = load_cell_data(i, Source::Input) {
            if data.len() == crate::types::RECURRING_PARTICIPANT_DATA_LEN {
                let participant = parse_participant_data(&data)?;
                let state = parse_recurring_participant_state(&data)?;
                if participant.status == crate::types::ParticipantStatus::Winner && state.round < recurring.round {
                    candidates = collect_recurring_participants(
                        &campaign.created_by,
                        campaign.created_at,
                        state.round,
                        crate::types::ParticipantStatus::Winner,
                    )?;
                    break;
                }
            }
            i += 1;
        }
    }
    if candidates.len() != 1 {
        return Err(Error::InvalidOperation);
    }
    validate_participant_release(&candidates[0], 0)?;
    let output = load_cell_data(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;
    if !verify_campaign_tx(&output, &campaign)? || parse_recurring_raffle_state(&output)? != recurring {
        return Err(Error::InvalidCellData);
    }
    Ok(())
}
