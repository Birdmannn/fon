use crate::errors::Error;
use crate::types::{CAMPAIGN_DATA_LEN, Campaign, PARTICIPANT_DATA_LEN, ParticipantStatus, TOKEN_DATA_LEN};
use crate::utils::{parse_campaign_data, parse_participant_data};
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::Entity;
use ckb_std::debug;
use ckb_std::high_level::{load_cell, load_cell_data, load_input, load_script};

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
    let current_script = load_script().map_err(|_| Error::LoadScriptFailed)?;
    let current_script_hash = current_script.calc_script_hash();

    let mut user_input_balance = 0u64;
    let mut user_output_balance = 0u64;
    let mut campaign_input_balance = 0u64;
    let mut campaign_output_balance = 0u64;

    // === SCAN INPUT CELLS ===
    let mut i = 0;
    loop {
        match load_cell_data(i, Source::Input) {
            Ok(data) => {
                // Only process token cells (8 bytes)
                if data.len() != TOKEN_DATA_LEN {
                    i += 1;
                    continue;
                }

                // Check if this cell belongs to campaign or user
                let cell = load_cell(i, Source::Input).map_err(|_| Error::InvalidCellData)?;
                let is_campaign_cell = match cell.type_().to_opt() {
                    Some(type_script) => type_script.calc_script_hash() == current_script_hash,
                    None => false,
                };

                let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());

                if is_campaign_cell {
                    campaign_input_balance = campaign_input_balance
                        .checked_add(amount)
                        .ok_or(Error::AmountMismatch)?;
                } else {
                    user_input_balance = user_input_balance
                        .checked_add(amount)
                        .ok_or(Error::AmountMismatch)?;
                }

                i += 1;
            }
            Err(_) => break,
        }
    }

    // === SCAN OUTPUT CELLS ===
    i = 0;
    loop {
        match load_cell_data(i, Source::Output) {
            Ok(data) => {
                if data.len() != TOKEN_DATA_LEN {
                    i += 1;
                    continue;
                }

                let cell = load_cell(i, Source::Output).map_err(|_| Error::InvalidCellData)?;
                let is_campaign_cell = match cell.type_().to_opt() {
                    Some(type_script) => type_script.calc_script_hash() == current_script_hash,
                    None => false,
                };

                let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());

                if is_campaign_cell {
                    campaign_output_balance = campaign_output_balance
                        .checked_add(amount)
                        .ok_or(Error::AmountMismatch)?;
                } else {
                    user_output_balance = user_output_balance
                        .checked_add(amount)
                        .ok_or(Error::AmountMismatch)?;
                }

                i += 1;
            }
            Err(_) => break,
        }
    }

    // === VALIDATE BALANCES ===

    // User balance decreased by deposit_amount
    let expected_user_output = user_input_balance
        .checked_sub(deposit_amount)
        .ok_or(Error::InsufficientBalance)?;

    if user_output_balance != expected_user_output {
        return Err(Error::AmountMismatch);
    }

    // Campaign balance increased by deposit_amount
    let expected_campaign_output = campaign_input_balance
        .checked_add(deposit_amount)
        .ok_or(Error::AmountMismatch)?;

    if campaign_output_balance != expected_campaign_output {
        return Err(Error::AmountMismatch);
    }

    Ok(())
}

pub fn validate_participant_added(participant_address: &[u8; 20]) -> Result<(), Error> {
    // ignore timestamp validation here
    // Load the campaign input to get its outpoint
    let campaign_input = load_input(0, Source::GroupInput)
        .map_err(|_| Error::InvalidCellData)?;
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

                    // Timestamp validation is omitted here
                    // in the future, we can validate with a tolerance

                    // Check status is pending/verified
                    if participant.status != ParticipantStatus::Verified {
                        return Err(Error::InvalidOperation)
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

// fn validate_participant_added(participant_address: &[u8; 20]) -> Result<(), Error> {
//     let current_time = get_current_timestamp()?;

//     // Load the campaign input to get its outpoint
//     let campaign_input = load_input(0, Source::GroupInput)
//         .map_err(|_| Error::InvalidCellData)?;
//     let outpoint = campaign_input.previous_output();

//     // Find the new participant cell in outputs
//     // It's a new cell being created in this transaction
//     let mut i = 0;
//     loop {
//         match load_cell_data(i, Source::Output) {
//             Ok(data) => {
//                 if data.len() == PARTICIPANT_DATA_LEN {
//                     let participant = parse_participant_data(&data)?;

//                     // Check this cell is for the right participant
//                     if &participant.participant_address != participant_address {
//                         i += 1;
//                         continue;
//                     }

//                     // Check it links to the right campaign
//                     if participant.campaign_tx_hash != outpoint.tx_hash().as_slice() {
//                         return Err(Error::CampaignDataMismatch);
//                     }

//                     // Check joined_at is correct
//                     if participant.joined_at != current_time {
//                         return Err(Error::CampaignDataMismatch);
//                     }

//                     // Check status is pending/verified
//                     if participant.status != 0 {
//                         return Err(Error::InvalidOperation);
//                     }

//                     return Ok(());
//                 }
//                 i += 1;
//             }
//             Err(_) => break,
//         }
//     }

//     Err(Error::DepositorNotFound) // No participant cell found in outputs
// }
