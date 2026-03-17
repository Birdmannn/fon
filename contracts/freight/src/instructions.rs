use crate::errors::Error;
use crate::types::{AddressKey, Campaign, CampaignStatus, CampaignType};
use crate::utils::*;
use crate::validations::*;
use ckb_hash::blake2b_256;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::Entity;
use ckb_std::high_level::load_input;
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

    // Create campaign struct
    let campaign = Campaign {
        created_at,
        start_duration_in_seconds,
        task_duration_in_seconds,
        created_by: creator_address,
        campaign_type,
        maximum_amount,
        current_deposits: 0, // No deposits yet
        status: CampaignStatus::Created,
    };

    // verify the output cell contains the correct campaign data
    let output_data = load_cell_data(0, Source::Output)?;
    if !verify_campaign_tx(&output_data, &campaign)? {
        debug!("Output cell data does not match expected campaign data");
        return Err(Error::InvalidCellData);
    }

    Ok(())
}

// Anybody can call distribute, keeps track of a particular timestamp,
// and only allows distribution after that timestamp.
// This is to prevent frontrunning of the distribution.
pub fn distribute(args: &[u8]) -> Result<(), Error> {
    // args[0] task_id
    // args[1] address. This address must be the admin passed into the constructor
    Ok(())
}

pub fn verify_participant(args: &[u8]) -> Result<(), Error> {
    // Parse args, signature [65 bytes],
    // for expiry: the signature should be valid as long as the event is still on
    if args.len() < 65 {
        return Err(Error::InvalidVerificationArgs);
    }
    let signature = &args[0..65];
    // A "Depositor" is basically any caller that owns the input cells
    let participant_address = extract_caller_address(AddressKey::Depositor)?;
    let campaign_data = load_cell_data(0, Source::GroupInput)?;
    let campaign = parse_campaign_data(&campaign_data)?;

    // the timestamp on ckb might not be accurate, but this is what we use as deterrent
    let timestamp = get_current_timestamp()?;
    let till = campaign.created_at
        + campaign.start_duration_in_seconds
        + campaign.task_duration_in_seconds;
    if timestamp > till || campaign.status != CampaignStatus::Active {
        return Err(Error::VerificationNotCompleted);
    }

    let admin_pubkey_hash = get_admin_pubkey()?;
    let campaign_outpoint = {
        let campaign_input = load_input(0, Source::GroupInput)?;
        campaign_input.previous_output() // txhash + index
    };

    let tx_hash = campaign_outpoint.tx_hash();
    let index = campaign_outpoint.index();

    let tx_hash_bytes = tx_hash.as_slice();
    let index_bytes = index.as_slice();
    // Build the message here.
    // Concatenate all fields into one buffer [participant address], [campaign outpoint]
    let mut buf = [0u8; 20 + 32 + 4]; // 20 bytes for address, 32 bytes for tx hash, 4 bytes for index
    buf[0..20].copy_from_slice(&participant_address);
    buf[20..52].copy_from_slice(tx_hash_bytes);
    buf[52..56].copy_from_slice(index_bytes);

    let message = blake2b_256(&buf);
    let pubkey_hash = recover_pubkey_hash(signature, &message);
    if pubkey_hash != admin_pubkey_hash {
        return Err(Error::Unauthorized);
    }

    // final step. validate participant added
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
    if current_timestamp > campaign.created_at + campaign.start_duration_in_seconds {
        debug!("Campaign has already started, no longer accepts deposits");
        return Err(Error::DepositNotCompleted);
    }

    // check if deposit exceeds maximum amount
    if campaign.current_deposits + requested_deposit > campaign.maximum_amount {
        debug!(
            "Deposit amount {} exceeds maximum amount {}, current deposits {}",
            requested_deposit, campaign.maximum_amount, campaign.current_deposits
        );
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
        load_cell_data(0, Source::GroupInput).map_err(|_| Error::InvalidCellData)?;
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

pub fn batch_deliver(args: &[u8]) -> Result<(), Error> {
    // amount to deliver, with hard cap on number of deliverable target
    // takes in the amount to deliver, number of targets, and sequence of delivery (Random, or so)
    // the randomized sequence can be generated off-chain, and hash stored
    // if random, the hash is gotten, if the hash is not available, the delivery fails
    Ok(())
}

pub fn submit_randomness_hash(args: &[u8]) -> Result<(), Error> {
    // submit the hash of the randomness used for distribution, to prevent frontrunning
    // only submitted before the campaign starts, and can only be submitted by the campaign creator (or admin)
    Ok(())
}
