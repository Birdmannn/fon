use crate::errors::Error;
use crate::types::{
    CAMPAIGN_DATA_LEN, RECURRING_CAMPAIGN_DATA_LEN, Campaign, CampaignType,
    PARTICIPANT_DATA_LEN, RECURRING_PARTICIPANT_DATA_LEN, ParticipantData, ParticipantStatus,
};
use crate::utils::{parse_campaign_data, parse_participant_data, parse_recurring_participant_state};
use alloc::vec::Vec;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::Entity;
use ckb_std::ckb_types::packed::Script;
use ckb_std::debug;
use ckb_std::high_level::{load_cell_capacity, load_cell_data, load_cell_lock, load_cell_type, load_input, load_script};

pub fn validate_raffle_entry_count(
    participant_address: &[u8; 20], campaign_created_by: &[u8; 20],
    campaign_created_at: u64, campaign_type: CampaignType, ticket_price: u64,
    expected: u64, recurring_round: Option<u64>,
) -> Result<(), Error> {
    let mut count = 0u64;
    let mut i = 1;
    while let Ok(data) = load_cell_data(i, Source::Output) {
        let expected_len = if campaign_type == CampaignType::RecurringRaffle {
            RECURRING_PARTICIPANT_DATA_LEN
        } else {
            PARTICIPANT_DATA_LEN
        };
        if data.len() == expected_len {
            let participant = parse_participant_data(&data)?;
            if &participant.campaign_created_by == campaign_created_by
                && participant.campaign_created_at == campaign_created_at
                && participant.campaign_type == campaign_type
            {
                if &participant.participant_address != participant_address
                    || participant.status != ParticipantStatus::Verified
                    || participant.deposited_amount != ticket_price
                {
                    return Err(Error::InvalidOperation);
                }
                if let Some(round) = recurring_round {
                    let recurring = parse_recurring_participant_state(&data)?;
                    if recurring.round != round || recurring.claimable_amount != 0 {
                        return Err(Error::InvalidOperation);
                    }
                    let lock = load_cell_lock(i, Source::Output).map_err(|_| Error::InvalidCellData)?;
                    let lock_args = lock.args().raw_data();
                    let current_script = load_script().map_err(|_| Error::LoadScriptFailed)?;
                    if lock.code_hash() != current_script.code_hash()
                        || lock_args.len() != 49
                        || lock_args[0] != 255
                        || &lock_args[1..21] != campaign_created_by
                        || lock_args[21..29] != campaign_created_at.to_le_bytes()
                        || &lock_args[29..49] != participant_address
                    {
                        return Err(Error::InvalidOperation);
                    }
                }
                count = count.checked_add(1).ok_or(Error::AmountMismatch)?;
            }
        }
        i += 1;
    }
    if count != expected {
        return Err(Error::InvalidOperation);
    }
    Ok(())
}

#[derive(Clone)]
pub struct ParticipantEntry {
    pub participant: ParticipantData,
    pub input_capacity: u64,
    pub input_tx_hash: [u8; 32],
    pub input_index: u32,
}

#[derive(Clone)]
pub struct RecurringParticipantEntry {
    pub participant: ParticipantData,
    pub recurring_round: u64,
    pub claimable_amount: u64,
    pub input_capacity: u64,
    pub input_position: usize,
    pub input_lock: Script,
    pub input_tx_hash: [u8; 32],
    pub input_index: u32,
}

pub fn collect_recurring_participants(
    campaign_created_by: &[u8; 20],
    campaign_created_at: u64,
    round: u64,
    required_status: ParticipantStatus,
) -> Result<Vec<RecurringParticipantEntry>, Error> {
    let mut participants = Vec::new();
    let current_script = load_script().map_err(|_| Error::LoadScriptFailed)?;
    let mut i = 1;
    while let Ok(data) = load_cell_data(i, Source::Input) {
        if data.len() == RECURRING_PARTICIPANT_DATA_LEN {
            let input_lock = load_cell_lock(i, Source::Input).map_err(|_| Error::InvalidCellData)?;
            let lock_args = input_lock.args().raw_data();
            if input_lock.code_hash() != current_script.code_hash()
                || lock_args.len() != 49
                || lock_args[0] != 255
            {
                i += 1;
                continue;
            }
            let participant = parse_participant_data(&data)?;
            let recurring = parse_recurring_participant_state(&data)?;
            if participant.campaign_created_by != *campaign_created_by
                || participant.campaign_created_at != campaign_created_at
                || participant.campaign_type != CampaignType::RecurringRaffle
                || participant.status != required_status
                || recurring.round != round
                || lock_args[1..21] != participant.campaign_created_by
                || lock_args[21..29] != participant.campaign_created_at.to_le_bytes()
                || lock_args[29..49] != participant.participant_address
            {
                return Err(Error::CampaignDataMismatch);
            }
            let input = load_input(i, Source::Input).map_err(|_| Error::InvalidCellData)?;
            let previous_output = input.previous_output();
            let mut input_tx_hash = [0u8; 32];
            input_tx_hash.copy_from_slice(previous_output.tx_hash().as_slice());
            participants.push(RecurringParticipantEntry {
                participant,
                recurring_round: recurring.round,
                claimable_amount: recurring.claimable_amount,
                input_capacity: load_cell_capacity(i, Source::Input).map_err(|_| Error::InvalidCellData)?,
                input_position: i,
                input_lock,
                input_tx_hash,
                input_index: u32::from_le_bytes(previous_output.index().as_slice().try_into().unwrap()),
            });
        }
        i += 1;
    }
    Ok(participants)
}

pub fn validate_recurring_draw_outputs(
    ordered: &[RecurringParticipantEntry],
    winner_count: usize,
    round: u64,
    reward_per_winner: u64,
) -> Result<(), Error> {
    for (index, entry) in ordered.iter().enumerate() {
        let output_index = index + 1;
        let data = load_cell_data(output_index, Source::Output).map_err(|_| Error::InvalidCellData)?;
        if data.len() != RECURRING_PARTICIPANT_DATA_LEN {
            return Err(Error::InvalidCellData);
        }
        let participant = parse_participant_data(&data)?;
        let recurring = parse_recurring_participant_state(&data)?;
        let expected_status = if index < winner_count { ParticipantStatus::Winner } else { ParticipantStatus::Eliminated };
        let expected_claim = if index < winner_count { reward_per_winner } else { 0 };
        if participant.campaign_created_by != entry.participant.campaign_created_by
            || participant.campaign_created_at != entry.participant.campaign_created_at
            || participant.campaign_type != entry.participant.campaign_type
            || participant.participant_address != entry.participant.participant_address
            || participant.joined_at != entry.participant.joined_at
            || participant.deposited_amount != entry.participant.deposited_amount
            || participant.status != expected_status
            || recurring.round != round
            || recurring.claimable_amount != expected_claim
            || load_cell_capacity(output_index, Source::Output).map_err(|_| Error::InvalidCellData)? != entry.input_capacity
            || load_cell_lock(output_index, Source::Output).map_err(|_| Error::InvalidCellData)? != entry.input_lock
        {
            return Err(Error::InvalidOperation);
        }
    }
    if load_cell_data(ordered.len() + 1, Source::Output).is_ok() {
        // Additional normal change outputs are allowed, but no additional
        // recurring participant records may be minted by the draw.
        let mut i = ordered.len() + 1;
        while let Ok(data) = load_cell_data(i, Source::Output) {
            if data.len() == RECURRING_PARTICIPANT_DATA_LEN {
                return Err(Error::InvalidOperation);
            }
            i += 1;
        }
    }
    Ok(())
}

/// Count non-campaign input cells that have PARTICIPANT_DATA_LEN bytes of data.
/// The campaign cell is always inputs[0], so we start scanning from index 1.
pub fn count_participant_inputs() -> Result<usize, Error> {
    let mut count = 0;
    let mut i = 1; // skip inputs[0] (the campaign cell)
    loop {
        match load_cell_data(i, Source::Input) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    count += 1;
                }
                i += 1;
            }
            Err(_) => break,
        }
    }
    Ok(count)
}

pub fn collect_verified_participants(
    campaign_created_by: &[u8; 20],
    campaign_created_at: u64,
    campaign_type: crate::types::CampaignType,
) -> Result<Vec<ParticipantEntry>, Error> {
    let mut participants = Vec::new();
    let mut i = 1; // skip inputs[0] (the campaign cell)
    loop {
        match load_cell_data(i, Source::Input) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    let participant = parse_participant_data(&data)?;
                    if participant.status != ParticipantStatus::Verified {
                        return Err(Error::InvalidOperation);
                    }
                    if &participant.campaign_created_by != campaign_created_by {
                        return Err(Error::CampaignDataMismatch);
                    }
                    if participant.campaign_created_at != campaign_created_at {
                        return Err(Error::CampaignDataMismatch);
                    }
                    if participant.campaign_type != campaign_type {
                        return Err(Error::CampaignDataMismatch);
                    }
                    let input_capacity = load_cell_capacity(i, Source::Input)
                        .map_err(|_| Error::InvalidCellData)?;
                    let input = load_input(i, Source::Input).map_err(|_| Error::InvalidCellData)?;
                    let previous_output = input.previous_output();
                    let mut input_tx_hash = [0u8; 32];
                    input_tx_hash.copy_from_slice(previous_output.tx_hash().as_slice());
                    let input_index = u32::from_le_bytes(previous_output.index().as_slice().try_into().unwrap());
                    participants.push(ParticipantEntry {
                        participant,
                        input_capacity,
                        input_tx_hash,
                        input_index,
                    });
                }
                i += 1;
            }
            Err(_) => break,
        }
    }
    Ok(participants)
}

/// Scan outputs[1+] for a participant cell with the given address, status = Rewarded,
/// and capacity == input_capacity + reward_per_participant.
fn validate_rewarded_output(
    participant_address: &[u8; 20],
    input_capacity: u64,
    reward_per_participant: u64,
) -> Result<(), Error> {
    let expected_capacity = input_capacity
        .checked_add(reward_per_participant)
        .ok_or(Error::AmountMismatch)?;

    let mut i = 1; // skip outputs[0] (the updated campaign cell)
    loop {
        match load_cell_data(i, Source::Output) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    let out = parse_participant_data(&data)?;
                    if &out.participant_address == participant_address {
                        if out.status != ParticipantStatus::Rewarded {
                            return Err(Error::InvalidOperation);
                        }
                        let out_capacity = load_cell_capacity(i, Source::Output)
                            .map_err(|_| Error::InvalidCellData)?;
                        if out_capacity != expected_capacity {
                            return Err(Error::AmountMismatch);
                        }
                        return Ok(());
                    }
                }
                i += 1;
            }
            Err(_) => break,
        }
    }
    Err(Error::InvalidOperation)
}

// Existing tickets commit to the first 20 wallet-argument bytes, not a full
// script hash. Pin supported wallet programs so an arbitrary always-success
// script with copied arguments cannot redirect a participant's payout.
fn supported_raffle_wallet(lock: &Script) -> bool {
    const WALLETS: &[([u8; 32], u8)] = &[
        // JoyID testnet
        ([0xd2, 0x37, 0x61, 0xb3, 0x64, 0x21, 0x07, 0x35, 0xc1, 0x9c, 0x60, 0x56, 0x1d, 0x21, 0x3f, 0xb3, 0xbe, 0xae, 0x2f, 0xd6, 0x17, 0x27, 0x43, 0x71, 0x9e, 0xff, 0x69, 0x20, 0xe0, 0x20, 0xba, 0xac], 1),
        // JoyID mainnet
        ([0xd0, 0x0c, 0x84, 0xf0, 0xec, 0x8f, 0xd4, 0x41, 0xc3, 0x8b, 0xc3, 0xf8, 0x7a, 0x37, 0x1f, 0x54, 0x71, 0x90, 0xf2, 0xfc, 0xff, 0x88, 0xe6, 0x42, 0xbc, 0x5b, 0xf5, 0x4b, 0x9e, 0x31, 0x83, 0x23], 1),
        // secp256k1
        ([0x9b, 0xd7, 0xe0, 0x6f, 0x3e, 0xcf, 0x4b, 0xe0, 0xf2, 0xfc, 0xd2, 0x18, 0x8b, 0x23, 0xf1, 0xb9, 0xfc, 0xc8, 0x8e, 0x5d, 0x4b, 0x65, 0xa8, 0x63, 0x7b, 0x17, 0x72, 0x3b, 0xbd, 0xa3, 0xcc, 0xe8], 1),
        // OmniLock testnet
        ([0xf3, 0x29, 0xef, 0xfd, 0x1c, 0x47, 0x5a, 0x29, 0x78, 0x45, 0x3c, 0x86, 0x00, 0xe1, 0xea, 0xf0, 0xbc, 0x20, 0x87, 0xee, 0x09, 0x3c, 0x3e, 0xe6, 0x4c, 0xc9, 0x6e, 0xc6, 0x84, 0x77, 0x52, 0xcb], 1),
        // OmniLock mainnet
        ([0x9b, 0x81, 0x97, 0x93, 0xa6, 0x44, 0x63, 0xae, 0xd7, 0x7c, 0x61, 0x5d, 0x6c, 0xb2, 0x26, 0xee, 0xa5, 0x48, 0x7c, 0xcf, 0xc0, 0x78, 0x30, 0x43, 0xa5, 0x87, 0x25, 0x4c, 0xda, 0x2b, 0x6f, 0x26], 1),
        // Pilot passkey
        ([0x2b, 0xa4, 0x31, 0xb2, 0x7a, 0x84, 0x4a, 0x36, 0x64, 0xe2, 0x4c, 0x54, 0x8e, 0xcd, 0x17, 0x5c, 0xea, 0x3b, 0xa0, 0x05, 0x59, 0x0f, 0x4f, 0x36, 0x2b, 0xee, 0x5a, 0x94, 0xac, 0xac, 0x92, 0xe6], 4),
        // Pilot account
        ([0x37, 0xd1, 0xff, 0x51, 0x9a, 0xe1, 0x9f, 0x7b, 0x16, 0xcd, 0x7e, 0xe9, 0xb4, 0xf7, 0x26, 0x30, 0x0c, 0xdc, 0xc6, 0xfe, 0xce, 0x92, 0x3b, 0xf8, 0xbe, 0xe4, 0x04, 0x66, 0xa1, 0x5c, 0xef, 0x28], 4),
        // Pilot session
        ([0xdd, 0xa8, 0xf7, 0xcf, 0xc3, 0x19, 0x89, 0x1c, 0x35, 0xaa, 0x68, 0x42, 0x56, 0x74, 0x77, 0x6f, 0x79, 0xc0, 0xe1, 0xc9, 0xc0, 0xf1, 0xc6, 0xad, 0xc2, 0x53, 0x99, 0x0f, 0xa4, 0x32, 0x26, 0x95], 4),
    ];
    WALLETS.iter().any(|(hash, hash_type)| lock.code_hash().as_slice() == hash && lock.hash_type().as_slice() == &[*hash_type])
}

/// A regular raffle consumes its tickets. Rewarded state cells are not payouts:
/// the full ticket capacity plus the reward must become a plain wallet cell.
fn validate_raffle_wallet_payouts(winners: &[ParticipantEntry], reward: u64) -> Result<(), Error> {
    let script = load_script().map_err(|_| Error::LoadScriptFailed)?;
    let mut paid_outputs = Vec::new();
    for winner in winners {
        let expected = winner.input_capacity.checked_add(reward).ok_or(Error::AmountMismatch)?;
        let mut matched = None;
        let mut index = 1;
        while let Ok(lock) = load_cell_lock(index, Source::Output) {
            let args = lock.args().raw_data();
            if !paid_outputs.contains(&index)
                && lock.code_hash() != script.code_hash()
                && supported_raffle_wallet(&lock)
                && args.len() >= 20
                && (args[0..20] == winner.participant.participant_address
                    || ckb_hash::blake2b_256(lock.as_slice())[0..20] == winner.participant.participant_address)
                && load_cell_type(index, Source::Output).map_err(|_| Error::InvalidCellData)?.is_none()
                && load_cell_data(index, Source::Output).map_err(|_| Error::InvalidCellData)?.is_empty()
                && load_cell_capacity(index, Source::Output).map_err(|_| Error::InvalidCellData)? == expected
            {
                matched = Some(index);
                break;
            }
            index += 1;
        }
        paid_outputs.push(matched.ok_or(Error::InvalidOperation)?);
    }
    Ok(())
}

pub fn validate_batch_delivery_for_winners(
    winners: &[ParticipantEntry],
    reward_per_participant: u64,
) -> Result<(), Error> {
    if winners.first().map(|winner| winner.participant.campaign_type) == Some(CampaignType::Raffle) {
        return validate_raffle_wallet_payouts(winners, reward_per_participant);
    }
    for winner in winners {
        validate_rewarded_output(
            &winner.participant.participant_address,
            winner.input_capacity,
            reward_per_participant,
        )?;
    }

    let mut rewarded_outputs = 0usize;
    let mut i = 1;
    loop {
        match load_cell_data(i, Source::Output) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    let out = parse_participant_data(&data)?;
                    if out.status == ParticipantStatus::Rewarded {
                        rewarded_outputs += 1;
                        let is_winner = winners.iter().any(|winner| winner.participant.participant_address == out.participant_address);
                        if !is_winner {
                            return Err(Error::InvalidOperation);
                        }
                    }
                }
                i += 1;
            }
            Err(_) => break,
        }
    }

    if rewarded_outputs != winners.len() {
        return Err(Error::InvalidOperation);
    }

    Ok(())
}

pub fn verify_campaign_tx(output_data: &[u8], expected_campaign: &Campaign) -> Result<bool, Error> {
    let expected_len = if expected_campaign.campaign_type == CampaignType::RecurringRaffle {
        RECURRING_CAMPAIGN_DATA_LEN
    } else {
        CAMPAIGN_DATA_LEN
    };
    let expected_len = expected_len + expected_campaign.approval.as_ref().map_or(0, |gate| gate.encoded_len()) + expected_campaign.gift.as_ref().map_or(0, |policy| policy.encoded_len());
    if output_data.len() != expected_len {
        debug!(
            "Output data length {} does not match expected campaign data length {}",
            output_data.len(),
            expected_len
        );
        return Ok(false);
    }

    // Parse output data into a Campaign struct
    let output_campaign = parse_campaign_data(output_data)?;
    // Compare the parsed campaign with the expected campaign
    Ok(output_campaign == *expected_campaign)
}

pub fn validate_deposit_transfer(deposit_amount: u64) -> Result<(), Error> {
    let campaign_input_capacity =
        load_cell_capacity(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let campaign_output_capacity =
        load_cell_capacity(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;

    let expected_campaign_output = campaign_input_capacity
        .checked_add(deposit_amount)
        .ok_or(Error::AmountMismatch)?;

    if campaign_output_capacity != expected_campaign_output {
        return Err(Error::AmountMismatch);
    }

    Ok(())
}

pub fn validate_creator_tip_transfer(deposit_amount: u64, creator_address: &[u8; 20]) -> Result<(), Error> {
    let campaign_input_capacity =
        load_cell_capacity(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let campaign_output_capacity =
        load_cell_capacity(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;

    if campaign_output_capacity != campaign_input_capacity {
        return Err(Error::AmountMismatch);
    }

    let creator_tip_type = load_cell_type(1, Source::Output).map_err(|_| Error::InvalidCellData)?;
    if creator_tip_type.is_some() {
        return Err(Error::AmountMismatch);
    }

    let creator_tip_lock = load_cell_lock(1, Source::Output).map_err(|_| Error::InvalidCellData)?;
    let creator_tip_lock_args = creator_tip_lock.args().raw_data();
    if creator_tip_lock_args.len() < 20 || &creator_tip_lock_args[0..20] != creator_address {
        return Err(Error::AmountMismatch);
    }

    let creator_tip_capacity =
        load_cell_capacity(1, Source::Output).map_err(|_| Error::InvalidCellData)?;
    if creator_tip_capacity != deposit_amount {
        return Err(Error::AmountMismatch);
    }

    Ok(())
}

pub fn validate_creator_withdraw_transfer(withdraw_amount: u64, creator_address: &[u8; 20]) -> Result<(), Error> {
    let campaign_input_capacity =
        load_cell_capacity(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let campaign_output_capacity =
        load_cell_capacity(0, Source::GroupOutput).map_err(|_| Error::InvalidCellData)?;

    let expected_campaign_output = campaign_input_capacity
        .checked_sub(withdraw_amount)
        .ok_or(Error::AmountMismatch)?;
    if campaign_output_capacity != expected_campaign_output {
        return Err(Error::AmountMismatch);
    }

    let creator_withdraw_type = load_cell_type(1, Source::Output).map_err(|_| Error::InvalidCellData)?;
    if creator_withdraw_type.is_some() {
        return Err(Error::AmountMismatch);
    }

    let creator_withdraw_lock = load_cell_lock(1, Source::Output).map_err(|_| Error::InvalidCellData)?;
    let creator_withdraw_lock_args = creator_withdraw_lock.args().raw_data();
    if creator_withdraw_lock_args.len() < 20 || &creator_withdraw_lock_args[0..20] != creator_address {
        return Err(Error::AmountMismatch);
    }

    let creator_withdraw_capacity =
        load_cell_capacity(1, Source::Output).map_err(|_| Error::InvalidCellData)?;
    if creator_withdraw_capacity != withdraw_amount {
        return Err(Error::AmountMismatch);
    }

    Ok(())
}

pub fn validate_participant_added(
    participant_address: &[u8; 20],
    campaign_created_by: &[u8; 20],
    campaign_created_at: u64,
    campaign_type: crate::types::CampaignType,
    deposited_amount: u64,
) -> Result<(), Error> {
    let mut i = 0;
    loop {
        match load_cell_data(i, Source::Output) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    let participant = parse_participant_data(&data)?;

                    if &participant.participant_address != participant_address {
                        i += 1;
                        continue;
                    }

                    if &participant.campaign_created_by != campaign_created_by {
                        return Err(Error::CampaignDataMismatch);
                    }
                    if participant.campaign_created_at != campaign_created_at {
                        return Err(Error::CampaignDataMismatch);
                    }
                    if participant.campaign_type != campaign_type {
                        return Err(Error::CampaignDataMismatch);
                    }

                    if participant.status != ParticipantStatus::Verified {
                        return Err(Error::InvalidOperation);
                    }

                    if participant.deposited_amount != deposited_amount {
                        return Err(Error::AmountMismatch);
                    }

                    return Ok(());
                }
                i += 1;
            }
            Err(_) => break,
        }
    }

    Err(Error::InvalidOperation)
}

/// For every Verified participant in inputs[1+], verify:
/// - it links to the current campaign
/// - a corresponding output participant cell exists with status = Refunded
/// - output capacity == input capacity + participant.deposited_amount
/// Returns the total amount refunded so the caller can validate the campaign cell.
pub fn validate_refund_outputs(
    campaign_created_by: &[u8; 20],
    campaign_created_at: u64,
    campaign_type: crate::types::CampaignType,
) -> Result<u64, Error> {
    let mut total_refunded = 0u64;
    let mut i = 1; // skip inputs[0] (the campaign cell)
    loop {
        match load_cell_data(i, Source::Input) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    let participant = parse_participant_data(&data)?;

                    if &participant.campaign_created_by != campaign_created_by {
                        return Err(Error::CampaignDataMismatch);
                    }
                    if participant.campaign_created_at != campaign_created_at {
                        return Err(Error::CampaignDataMismatch);
                    }
                    if participant.campaign_type != campaign_type {
                        return Err(Error::CampaignDataMismatch);
                    }
                    if participant.status != ParticipantStatus::Verified {
                        return Err(Error::InvalidOperation);
                    }

                    let input_capacity =
                        load_cell_capacity(i, Source::Input).map_err(|_| Error::InvalidCellData)?;

                    validate_refunded_output(
                        &participant.participant_address,
                        input_capacity,
                        participant.deposited_amount,
                    )?;

                    total_refunded = total_refunded
                        .checked_add(participant.deposited_amount)
                        .ok_or(Error::AmountMismatch)?;
                }
                i += 1;
            }
            Err(_) => break,
        }
    }
    Ok(total_refunded)
}

/// Scan outputs[1+] for a participant cell with the given address, status = Refunded,
/// and capacity == input_capacity + deposited_amount.
fn validate_refunded_output(
    participant_address: &[u8; 20],
    input_capacity: u64,
    deposited_amount: u64,
) -> Result<(), Error> {
    let expected_capacity = input_capacity
        .checked_add(deposited_amount)
        .ok_or(Error::AmountMismatch)?;

    let mut i = 1; // skip outputs[0] (the updated campaign cell)
    loop {
        match load_cell_data(i, Source::Output) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    let out = parse_participant_data(&data)?;
                    if &out.participant_address == participant_address {
                        if out.status != ParticipantStatus::Refunded {
                            return Err(Error::InvalidOperation);
                        }
                        let out_capacity = load_cell_capacity(i, Source::Output)
                            .map_err(|_| Error::InvalidCellData)?;
                        if out_capacity != expected_capacity {
                            return Err(Error::AmountMismatch);
                        }
                        return Ok(());
                    }
                }
                i += 1;
            }
            Err(_) => break,
        }
    }
    Err(Error::InvalidOperation)
}
