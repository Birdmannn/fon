use crate::errors::Error;
use crate::types::{
    CAMPAIGN_DATA_LEN, Campaign, PARTICIPANT_DATA_LEN, ParticipantStatus,
};
use crate::utils::{parse_campaign_data, parse_participant_data};
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::Entity;
use ckb_std::debug;
use ckb_std::high_level::{load_cell_capacity, load_cell_data, load_input};

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

/// For every Verified participant in inputs[1+], verify it links to the current campaign
/// and that a corresponding Rewarded participant cell appears in outputs[1+] with
/// capacity increased by exactly `reward_per_participant` shannons.
pub fn validate_batch_delivery(reward_per_participant: u64) -> Result<(), Error> {
    let campaign_input = load_input(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let outpoint = campaign_input.previous_output();
    let campaign_tx_hash = outpoint.tx_hash();
    let campaign_index = u32::from_le_bytes(outpoint.index().as_slice().try_into().unwrap());

    let mut i = 1; // skip inputs[0] (the campaign cell)
    loop {
        match load_cell_data(i, Source::Input) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    let participant = parse_participant_data(&data)?;

                    if participant.status != ParticipantStatus::Verified {
                        return Err(Error::InvalidOperation);
                    }
                    if participant.campaign_tx_hash != campaign_tx_hash.as_slice() {
                        return Err(Error::CampaignDataMismatch);
                    }
                    if participant.campaign_index != campaign_index {
                        return Err(Error::CampaignDataMismatch);
                    }

                    let input_capacity =
                        load_cell_capacity(i, Source::Input).map_err(|_| Error::InvalidCellData)?;

                    validate_rewarded_output(
                        &participant.participant_address,
                        input_capacity,
                        reward_per_participant,
                    )?;
                }
                i += 1;
            }
            Err(_) => break,
        }
    }

    Ok(())
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

pub fn verify_campaign_tx(output_data: &[u8], expected_campaign: &Campaign) -> Result<bool, Error> {
    if output_data.len() != CAMPAIGN_DATA_LEN {
        debug!(
            "Output data length {} does not match expected campaign data length {}",
            output_data.len(),
            CAMPAIGN_DATA_LEN
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

pub fn validate_participant_added(participant_address: &[u8; 20]) -> Result<(), Error> {
    // ignore timestamp validation here
    // Load the campaign input to get its outpoint
    let campaign_input = load_input(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
    let outpoint = campaign_input.previous_output();

    // Find the new participant cell in outputs
    // it's a new cell being created in this transaction
    let mut i = 0;
    loop {
        match load_cell_data(i, Source::Output) {
            Ok(data) => {
                if data.len() == PARTICIPANT_DATA_LEN {
                    let participant = parse_participant_data(&data)?;

                    // Check this cell is for the right participant
                    if &participant.participant_address != participant_address {
                        i += 1;
                        continue;
                    }

                    // Check it links to the right campaign
                    if participant.campaign_tx_hash != outpoint.tx_hash().as_slice() {
                        return Err(Error::CampaignDataMismatch);
                    }

                    let index_value =
                        u32::from_le_bytes(outpoint.index().as_slice().try_into().unwrap());
                    if participant.campaign_index != index_value {
                        return Err(Error::CampaignDataMismatch);
                    }

                    // Timestamp validation is omitted here
                    // in the future, we can validate with a tolerance

                    // Check status is pending/verified
                    if participant.status != ParticipantStatus::Verified {
                        return Err(Error::InvalidOperation);
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
