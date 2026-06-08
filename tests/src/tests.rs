use ckb_hash::blake2b_256;
use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{
    bytes::Bytes, core::EpochNumberWithFraction, core::HeaderBuilder, core::TransactionBuilder,
    packed::*, prelude::*,
};
use ckb_testtool::context::Context;
use freight::types::{CampaignStatus, CampaignType, ParticipantStatus};
use secp256k1::global::SECP256K1;
use secp256k1::{Message as SecpMessage, PublicKey, SecretKey};

mod raffle_e2e;

const CREATOR: u8 = 11;
const DEPOSITOR: u8 = 42;
const DEFAULT_CAPACITY: u64 = 100_000;

// ─────────────────────────────── helpers ────────────────────────────────────

fn address_from(seed: u8) -> [u8; 20] {
    let mut address = [0u8; 20];
    for i in 0..20 {
        address[i] = seed.wrapping_add(i as u8);
    }
    address
}

/// Build the 174-byte campaign cell data blob.
fn build_campaign_bytes(
    created_at: u64,
    start_duration: u64,
    task_duration: u64,
    created_by: &[u8; 20],
    campaign_type: CampaignType,
    maximum_amount: u64,
    current_deposits: u64,
    status: CampaignStatus,
    reward_count: u64,
    randomness_hash: [u8; 32],
    summary: &[u8; 64],
    aux_amount: u64,
) -> Bytes {
    let mut data = Vec::with_capacity(174);
    data.extend_from_slice(&created_at.to_le_bytes());
    data.extend_from_slice(&start_duration.to_le_bytes());
    data.extend_from_slice(&task_duration.to_le_bytes());
    data.extend_from_slice(created_by);
    data.push(campaign_type as u8);
    data.extend_from_slice(&maximum_amount.to_le_bytes());
    data.extend_from_slice(&current_deposits.to_le_bytes());
    data.push(status as u8);
    data.extend_from_slice(&reward_count.to_le_bytes());
    data.extend_from_slice(&randomness_hash);
    data.extend_from_slice(summary);
    data.extend_from_slice(&aux_amount.to_le_bytes());
    assert_eq!(data.len(), 174, "campaign data must be exactly 174 bytes");
    Bytes::from(data)
}

/// Build the 73-byte participant cell data blob.
fn build_participant_bytes(
    campaign_tx_hash: &[u8; 32],
    campaign_index: u32,
    participant_address: &[u8; 20],
    joined_at: u64,
    status: ParticipantStatus,
    deposited_amount: u64,
) -> Bytes {
    let mut data = Vec::with_capacity(73);
    data.extend_from_slice(campaign_tx_hash);
    data.extend_from_slice(&campaign_index.to_le_bytes());
    data.extend_from_slice(participant_address);
    data.extend_from_slice(&joined_at.to_le_bytes());
    data.push(status as u8);
    data.extend_from_slice(&deposited_amount.to_le_bytes());
    assert_eq!(data.len(), 73, "participant data must be exactly 73 bytes");
    Bytes::from(data)
}

/// Default non-empty summary for tests.
fn default_summary() -> [u8; 64] {
    let mut s = [0u8; 64];
    let text = b"Test campaign summary";
    s[..text.len()].copy_from_slice(text);
    s
}

/// Build create_campaign type script args.
/// Format: [0x00][start(8)][task(8)][type(1)][max(8)][aux(8)][randomness_hash(32)][reward_count(8)] = 74 bytes
/// Existing tests default to zero randomness and zero reward count.
fn build_create_campaign_script_args(
    start_duration: u64,
    task_duration: u64,
    campaign_type: CampaignType,
    maximum_amount: u64,
    aux_amount: u64,
) -> Bytes {
    let mut args = Vec::with_capacity(74);
    args.push(0u8);
    args.extend_from_slice(&start_duration.to_le_bytes());
    args.extend_from_slice(&task_duration.to_le_bytes());
    args.push(campaign_type as u8);
    args.extend_from_slice(&maximum_amount.to_le_bytes());
    args.extend_from_slice(&aux_amount.to_le_bytes());
    args.extend_from_slice(&[0u8; 32]);
    args.extend_from_slice(&0u64.to_le_bytes());
    Bytes::from(args)
}

fn insert_header(context: &mut Context, timestamp: u64) -> Byte32 {
    let header = HeaderBuilder::default()
        .timestamp(timestamp)
        .number(1u64)
        .epoch(EpochNumberWithFraction::new(1, 0, 1))
        .build();
    let hash = header.hash();
    context.insert_header(header);
    hash
}

/// Build the common inputs/outputs/header for a verify_participant tx.
fn build_verify_participant_base(
    context: &mut Context,
    freight_out_point: &OutPoint,
    always_success_out_point: &OutPoint,
    script_args: Vec<u8>,
    campaign_data: Bytes,
    header_timestamp: u64,
) -> (CellInput, CellInput, CellOutput, Byte32) {
    let header_hash = insert_header(context, header_timestamp);

    let campaign_type_script = context
        .build_script(freight_out_point, Bytes::from(script_args))
        .expect("build freight type script");

    let creator_lock = context
        .build_script(always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let depositor_lock = context
        .build_script(always_success_out_point, Bytes::from(address_from(DEPOSITOR).to_vec()))
        .expect("build depositor lock");

    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_out_point).build();

    let depositor_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder().previous_output(depositor_out_point).build();

    let depositor_output = CellOutput::new_builder()
        .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
        .lock(depositor_lock.clone())
        .build();

    (campaign_input, depositor_input, depositor_output, header_hash)
}

// ─────────────────────────── create_campaign ────────────────────────────────

#[test]
fn test_create_campaign_success() {
    let mut context = Context::default();
    let out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let current_timestamp = 1_700_000_000u64;
    let start_duration = 86400u64;
    let task_duration = 604800u64;
    let maximum_amount = 1000u64;
    let summary = default_summary();

    let block_header = HeaderBuilder::default()
        .timestamp(current_timestamp)
        .number(100u64)
        .epoch(EpochNumberWithFraction::new(1, 0, 1))
        .build();
    let block_header_hash = block_header.hash();
    context.insert_header(block_header);

    let type_args = build_create_campaign_script_args(
        start_duration, task_duration, CampaignType::FundedTask, maximum_amount, 0,
    );
    let campaign_type_script = context
        .build_script(&out_point, type_args)
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let creator_input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .build(),
        Bytes::new(),
    );
    let creator_input = CellInput::new_builder().previous_output(creator_input_out_point).build();

    let campaign_data = build_campaign_bytes(
        current_timestamp, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, maximum_amount, 0, CampaignStatus::Created, 0, [0u8; 32],
        &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(creator_input)
        .header_dep(block_header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY / 2)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY / 2)))
                .lock(creator_lock.clone())
                .build(),
        ])
        .outputs_data(vec![campaign_data, Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("create campaign should pass");
    println!("test_create_campaign_success cycles: {}", cycles);
}

/// FAILURE – summary is all zeros → InvalidCampaignArgs.
#[test]
fn test_create_campaign_empty_summary_rejected() {
    let mut context = Context::default();
    let out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let current_timestamp = 1_700_000_000u64;
    let start_duration = 86400u64;
    let task_duration = 604800u64;
    let maximum_amount = 1000u64;

    let block_header = HeaderBuilder::default()
        .timestamp(current_timestamp)
        .number(100u64)
        .epoch(EpochNumberWithFraction::new(1, 0, 1))
        .build();
    let block_header_hash = block_header.hash();
    context.insert_header(block_header);

    let type_args = build_create_campaign_script_args(
        start_duration, task_duration, CampaignType::FundedTask, maximum_amount, 0,
    );
    let campaign_type_script = context
        .build_script(&out_point, type_args)
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let creator_input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .build(),
        Bytes::new(),
    );
    let creator_input = CellInput::new_builder().previous_output(creator_input_out_point).build();

    // Empty summary (all zeros)
    let campaign_data = build_campaign_bytes(
        current_timestamp, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, maximum_amount, 0, CampaignStatus::Created, 0, [0u8; 32],
        &[0u8; 64], 0,
    );

    let tx = TransactionBuilder::default()
        .input(creator_input)
        .header_dep(block_header_hash)
        .outputs(vec![CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build()])
        .outputs_data(vec![campaign_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "empty summary must be rejected");
}

/// SUCCESS – Raffle campaign creation with valid ticket price.
#[test]
fn test_create_raffle_campaign_success() {
    let mut context = Context::default();
    let out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let current_timestamp = 1_700_000_000u64;
    let start_duration = 86400u64;
    let task_duration = 604800u64;
    let maximum_amount = 1000u64;
    let ticket_price = 100u64; // 1000 / 100 = 10 tickets
    let summary = default_summary();

    let block_header = HeaderBuilder::default()
        .timestamp(current_timestamp)
        .number(100u64)
        .epoch(EpochNumberWithFraction::new(1, 0, 1))
        .build();
    let block_header_hash = block_header.hash();
    context.insert_header(block_header);

    let type_args = build_create_campaign_script_args(
        start_duration, task_duration, CampaignType::Raffle, maximum_amount, ticket_price,
    );
    let campaign_type_script = context
        .build_script(&out_point, type_args)
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let creator_input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .build(),
        Bytes::new(),
    );
    let creator_input = CellInput::new_builder().previous_output(creator_input_out_point).build();

    let campaign_data = build_campaign_bytes(
        current_timestamp, start_duration, task_duration, &creator_address,
        CampaignType::Raffle, maximum_amount, 0, CampaignStatus::Created, 0, [0u8; 32],
        &summary, ticket_price,
    );

    let tx = TransactionBuilder::default()
        .input(creator_input)
        .header_dep(block_header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY / 2)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY / 2)))
                .lock(creator_lock.clone())
                .build(),
        ])
        .outputs_data(vec![campaign_data, Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("raffle campaign creation should pass");
    println!("test_create_raffle_campaign_success cycles: {}", cycles);
}

/// FAILURE – Raffle with maximum_amount not divisible by ticket_price.
#[test]
fn test_create_raffle_invalid_ticket_price_rejected() {
    let mut context = Context::default();
    let out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let current_timestamp = 1_700_000_000u64;
    let start_duration = 86400u64;
    let task_duration = 604800u64;
    let maximum_amount = 1000u64;
    let ticket_price = 300u64; // 1000 % 300 != 0
    let summary = default_summary();

    let block_header = HeaderBuilder::default()
        .timestamp(current_timestamp)
        .number(100u64)
        .epoch(EpochNumberWithFraction::new(1, 0, 1))
        .build();
    let block_header_hash = block_header.hash();
    context.insert_header(block_header);

    let type_args = build_create_campaign_script_args(
        start_duration, task_duration, CampaignType::Raffle, maximum_amount, ticket_price,
    );
    let campaign_type_script = context
        .build_script(&out_point, type_args)
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let creator_input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .build(),
        Bytes::new(),
    );
    let creator_input = CellInput::new_builder().previous_output(creator_input_out_point).build();

    let campaign_data = build_campaign_bytes(
        current_timestamp, start_duration, task_duration, &creator_address,
        CampaignType::Raffle, maximum_amount, 0, CampaignStatus::Created, 0, [0u8; 32],
        &summary, ticket_price,
    );

    let tx = TransactionBuilder::default()
        .input(creator_input)
        .header_dep(block_header_hash)
        .outputs(vec![CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build()])
        .outputs_data(vec![campaign_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "raffle with non-divisible ticket price must be rejected");
}

// ─────────────────────────────── deposit ────────────────────────────────────

#[test]
fn test_deposit_success() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let max_amount = 50_000u64;
    let deposit_amount = 25_000u64;
    let summary = default_summary();

    let header_hash = insert_header(&mut context, created_at);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(start_duration, task_duration, CampaignType::FundedTask, max_amount, 0),
        )
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");
    let depositor_lock = context
        .build_script(&always_success_out_point, Bytes::from(depositor_address.to_vec()))
        .expect("build depositor lock");

    let input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, max_amount, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_in_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        input_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_in_out_point).build();

    let depositor_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder().previous_output(depositor_out_point).build();

    let output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, max_amount, deposit_amount, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );

    let mut witness_action = vec![1u8];
    witness_action.extend_from_slice(&deposit_amount.to_le_bytes());
    let witness_args = WitnessArgsBuilder::default()
        .output_type(Some(Bytes::from(witness_action)).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + deposit_amount)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY - deposit_amount)))
                .lock(depositor_lock)
                .build(),
        ])
        .outputs_data(vec![output_data, Bytes::new()].pack())
        .witnesses(vec![witness_args.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("deposit should succeed");
    println!("test_deposit_success cycles: {}", cycles);
}

#[test]
fn test_deposit_exceeds_maximum_caps_to_remaining() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let max_amount = 1_000u64;
    let deposit_amount = 2_000u64;
    let summary = default_summary();

    let header_hash = insert_header(&mut context, created_at);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(start_duration, task_duration, CampaignType::FundedTask, max_amount, 0),
        )
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build lock");
    let depositor_lock = context
        .build_script(&always_success_out_point, Bytes::from(depositor_address.to_vec()))
        .expect("build depositor lock");

    let campaign_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, max_amount, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_in_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_in_out_point).build();

    let depositor_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder().previous_output(depositor_out_point).build();

    let accepted_deposit = max_amount;
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, max_amount, accepted_deposit, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );

    let mut witness_action = vec![1u8];
    witness_action.extend_from_slice(&deposit_amount.to_le_bytes());
    let witness_args = WitnessArgsBuilder::default()
        .output_type(Some(Bytes::from(witness_action)).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + accepted_deposit)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY - accepted_deposit)))
                .lock(depositor_lock)
                .build(),
        ])
        .outputs_data(vec![campaign_output_data, Bytes::new()].pack())
        .witnesses(vec![witness_args.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("deposit should cap to remaining");
    println!("test_deposit_exceeds_maximum_caps_to_remaining cycles: {}", cycles);
}

#[test]
fn test_deposit_rejects_simple_task() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let max_amount = 50_000u64;
    let deposit_amount = 25_000u64;
    let summary = default_summary();

    let header_hash = insert_header(&mut context, created_at);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(start_duration, task_duration, CampaignType::SimpleTask, max_amount, 0),
        )
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build lock");
    let depositor_lock = context
        .build_script(&always_success_out_point, Bytes::from(depositor_address.to_vec()))
        .expect("build depositor lock");

    let input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::SimpleTask, max_amount, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_in_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        input_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_in_out_point).build();

    let depositor_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder().previous_output(depositor_out_point).build();

    let output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::SimpleTask, max_amount, deposit_amount, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );

    let mut witness_action = vec![1u8];
    witness_action.extend_from_slice(&deposit_amount.to_le_bytes());
    let witness_args = WitnessArgsBuilder::default()
        .output_type(Some(Bytes::from(witness_action)).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + deposit_amount)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY - deposit_amount)))
                .lock(depositor_lock)
                .build(),
        ])
        .outputs_data(vec![output_data, Bytes::new()].pack())
        .witnesses(vec![witness_args.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "SimpleTask deposit must be rejected");
}

#[test]
fn test_deposit_within_start_period_millisecond_timestamps() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);
    let created_at_ms = 1_700_000_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let max_amount = 50_000u64;
    let deposit_amount = 10_000u64;
    let deposit_ts_ms = created_at_ms + 100_000u64;
    let summary = default_summary();

    let header_hash = insert_header(&mut context, deposit_ts_ms);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(start_duration, task_duration, CampaignType::FundedTask, max_amount, 0),
        )
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");
    let depositor_lock = context
        .build_script(&always_success_out_point, Bytes::from(depositor_address.to_vec()))
        .expect("build depositor lock");

    let input_data = build_campaign_bytes(
        created_at_ms, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, max_amount, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        input_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_out_point).build();

    let depositor_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder().previous_output(depositor_cell).build();

    let output_data = build_campaign_bytes(
        created_at_ms, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, max_amount, deposit_amount, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );

    let mut witness_action = vec![1u8];
    witness_action.extend_from_slice(&deposit_amount.to_le_bytes());
    let witness_args = WitnessArgsBuilder::default()
        .output_type(Some(Bytes::from(witness_action)).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + deposit_amount)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY - deposit_amount)))
                .lock(depositor_lock)
                .build(),
        ])
        .outputs_data(vec![output_data, Bytes::new()].pack())
        .witnesses(vec![witness_args.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("deposit at +100s should succeed");
    println!("test_deposit_within_start_period_millisecond_timestamps cycles: {}", cycles);
}

#[test]
fn test_deposit_rejects_after_start_period_elapsed() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);
    let created_at_ms = 1_700_000_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let max_amount = 50_000u64;
    let deposit_amount = 10_000u64;
    let deposit_ts_ms = created_at_ms + start_duration * 1_000 + 1_000u64;
    let summary = default_summary();

    let header_hash = insert_header(&mut context, deposit_ts_ms);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(start_duration, task_duration, CampaignType::FundedTask, max_amount, 0),
        )
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");
    let depositor_lock = context
        .build_script(&always_success_out_point, Bytes::from(depositor_address.to_vec()))
        .expect("build depositor lock");

    let input_data = build_campaign_bytes(
        created_at_ms, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, max_amount, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        input_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_out_point).build();

    let depositor_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder().previous_output(depositor_cell).build();

    let output_data = build_campaign_bytes(
        created_at_ms, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, max_amount, deposit_amount, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );

    let mut witness_action = vec![1u8];
    witness_action.extend_from_slice(&deposit_amount.to_le_bytes());
    let witness_args = WitnessArgsBuilder::default()
        .output_type(Some(Bytes::from(witness_action)).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + deposit_amount)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY - deposit_amount)))
                .lock(depositor_lock)
                .build(),
        ])
        .outputs_data(vec![output_data, Bytes::new()].pack())
        .witnesses(vec![witness_args.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "deposit after start period must be rejected");
}

// ────────────────────────── verify_participant ───────────────────────────────

#[test]
fn test_verify_participant_campaign_expired() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let expired_timestamp = 1_701_000_000u64;
    let summary = default_summary();

    let mut script_args = vec![3u8];
    script_args.extend_from_slice(&[0u8; 20]);
    script_args.extend_from_slice(&[0u8; 33]);

    let campaign_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, 1_000, 0, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );

    let (campaign_input, depositor_input, depositor_output, header_hash) =
        build_verify_participant_base(
            &mut context, &freight_out_point, &always_success_out_point,
            script_args, campaign_data, expired_timestamp,
        );

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![depositor_output])
        .outputs_data(vec![Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "expired campaign must be rejected");
}

#[test]
fn test_verify_participant_invalid_signature() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let active_timestamp = created_at + 100;
    let summary = default_summary();

    let mut script_args = vec![3u8];
    script_args.extend_from_slice(&[0u8; 20]);
    script_args.extend_from_slice(&[0u8; 33]);

    let campaign_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, 1_000, 0, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );

    let (campaign_input, depositor_input, depositor_output, header_hash) =
        build_verify_participant_base(
            &mut context, &freight_out_point, &always_success_out_point,
            script_args, campaign_data, active_timestamp,
        );

    let invalid_sig = vec![0u8; 65];
    let witness_args = WitnessArgsBuilder::default()
        .input_type(Some(Bytes::from(invalid_sig)).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![depositor_output])
        .outputs_data(vec![Bytes::new()].pack())
        .witnesses(vec![witness_args.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "invalid signature must be rejected");
}

#[test]
fn test_verify_participant_success() {
    let secret_key = SecretKey::from_slice(&[1u8; 32]).unwrap();
    let admin_pubkey_bytes = PublicKey::from_secret_key(&SECP256K1, &secret_key).serialize();
    let admin_address = [0u8; 20];
    let summary = default_summary();

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let active_timestamp = created_at + 100;

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let mut script_args = vec![3u8];
    script_args.extend_from_slice(&admin_address);
    script_args.extend_from_slice(&admin_pubkey_bytes);

    let campaign_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, 1_000, 0, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );

    let (campaign_input, depositor_input, depositor_output, header_hash) =
        build_verify_participant_base(
            &mut context, &freight_out_point, &always_success_out_point,
            script_args, campaign_data, active_timestamp,
        );

    let campaign_outpoint = campaign_input.previous_output();
    let tx_hash_bytes: [u8; 32] = campaign_outpoint.tx_hash().as_slice().try_into().unwrap();
    let index_bytes: [u8; 4] = campaign_outpoint.index().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(index_bytes);

    let depositor_address = address_from(DEPOSITOR);
    let mut buf = [0u8; 56];
    buf[..20].copy_from_slice(&depositor_address);
    buf[20..52].copy_from_slice(&tx_hash_bytes);
    buf[52..56].copy_from_slice(&index_bytes);
    let message_hash = blake2b_256(&buf);

    let msg = SecpMessage::from_digest(message_hash);
    let sig = SECP256K1.sign_ecdsa(&msg, &secret_key);
    let signature = sig.serialize_compact();

    let participant_data = build_participant_bytes(
        &tx_hash_bytes, campaign_index, &depositor_address,
        active_timestamp, ParticipantStatus::Verified, 0,
    );
    let participant_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![99u8; 20]))
        .expect("build participant lock");
    let participant_output = CellOutput::new_builder()
        .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
        .lock(participant_lock)
        .build();

    let witness_args = WitnessArgsBuilder::default()
        .input_type(Some(Bytes::from(signature.to_vec())).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![depositor_output, participant_output])
        .outputs_data(vec![Bytes::new(), participant_data].pack())
        .witnesses(vec![witness_args.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("verify_participant should succeed");
    println!("test_verify_participant_success cycles: {}", cycles);
}

// ──────────────────── verify_participant (Raffle path) ───────────────────────

/// SUCCESS – raffle participant entry: no signature needed, ticket price paid.
#[test]
fn test_verify_participant_raffle_success() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let max_amount = 1_000u64;
    let ticket_price = 100u64;
    let summary = default_summary();

    // Timestamp within deposit window
    let ts = created_at + 1_000;
    let header_hash = insert_header(&mut context, ts);

    // Script args: [selector=3] — no admin args needed for raffle
    let script_args = vec![3u8];

    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");

    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");
    let depositor_lock = context
        .build_script(&always_success_out_point, Bytes::from(depositor_address.to_vec()))
        .expect("build depositor lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::Raffle, max_amount, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, ticket_price,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_out_point.clone()).build();

    let depositor_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder().previous_output(depositor_cell).build();

    // Campaign output: current_deposits += ticket_price
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::Raffle, max_amount, ticket_price, CampaignStatus::Created, 0, [0u8; 32], &summary, ticket_price,
    );

    let tx_hash_bytes: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    // Participant output cell
    let participant_data = build_participant_bytes(
        &tx_hash_bytes, campaign_index, &depositor_address,
        ts, ParticipantStatus::Verified, ticket_price,
    );
    let participant_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![77u8; 20]))
        .expect("build participant lock");

    // Witness: selector=3 in output_type (raffle path, no signature)
    let witness_args = WitnessArgsBuilder::default()
        .output_type(Some(Bytes::from(vec![3u8])).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + ticket_price)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY - ticket_price)))
                .lock(depositor_lock.clone())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
                .lock(participant_lock)
                .build(),
        ])
        .outputs_data(vec![campaign_output_data, Bytes::new(), participant_data].pack())
        .witnesses(vec![witness_args.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("raffle verify_participant should succeed");
    println!("test_verify_participant_raffle_success cycles: {}", cycles);
}

// ─────────────────────────────── batch_deliver ───────────────────────────────

#[test]
fn test_batch_deliver_sequential() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000_000u64; // ms
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    // deliver well past end_time
    let deliver_timestamp = created_at + (start_duration + task_duration + 1_000) * 1_000;
    let current_deposits = 1_000_000u64;
    let batch_size: u64 = 2;
    let reward_per_participant = current_deposits / batch_size;
    let summary = default_summary();

    let script_args = vec![2u8];
    let header_hash = insert_header(&mut context, deliver_timestamp);

    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, current_deposits, current_deposits,
        CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );
    let campaign_capacity = 200_000u64;
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&campaign_capacity))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_out_point.clone()).build();

    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    let p1_address = address_from(11u8);
    let p2_address = address_from(22u8);
    let p1_lock = context.build_script(&always_success_out_point, Bytes::from(p1_address.to_vec())).expect("p1 lock");
    let p2_lock = context.build_script(&always_success_out_point, Bytes::from(p2_address.to_vec())).expect("p2 lock");
    let participant_capacity = 100_000u64;

    let p1_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&participant_capacity)).lock(p1_lock.clone()).build(),
        build_participant_bytes(&campaign_tx_hash, campaign_index, &p1_address, created_at, ParticipantStatus::Verified, 0),
    );
    let p2_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&participant_capacity)).lock(p2_lock.clone()).build(),
        build_participant_bytes(&campaign_tx_hash, campaign_index, &p2_address, created_at, ParticipantStatus::Verified, 0),
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, current_deposits, 0, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );
    let rewarded_capacity = participant_capacity + reward_per_participant;

    let tx = TransactionBuilder::default()
        .inputs(vec![
            campaign_input,
            CellInput::new_builder().previous_output(p1_out_point).build(),
            CellInput::new_builder().previous_output(p2_out_point).build(),
        ])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&campaign_capacity)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&rewarded_capacity)).lock(p1_lock).build(),
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&rewarded_capacity)).lock(p2_lock).build(),
        ])
        .outputs_data(vec![
            campaign_output_data,
            build_participant_bytes(&campaign_tx_hash, campaign_index, &p1_address, created_at, ParticipantStatus::Rewarded, 0),
            build_participant_bytes(&campaign_tx_hash, campaign_index, &p2_address, created_at, ParticipantStatus::Rewarded, 0),
        ].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("batch_deliver sequential must succeed");
    println!("test_batch_deliver_sequential cycles: {}", cycles);
}

#[test]
fn test_batch_deliver_randomness_success() {
    let preimage = [7u8; 32];
    let randomness_hash = blake2b_256(&preimage);
    let summary = default_summary();

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000_000u64; // ms
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deliver_timestamp = created_at + (start_duration + task_duration + 1_000) * 1_000;
    let current_deposits = 1_000_000u64;
    let reward_count = 2u64;
    let reward_per_participant = current_deposits / reward_count;

    let mut script_args = vec![2u8];
    script_args.extend_from_slice(&preimage);

    let header_hash = insert_header(&mut context, deliver_timestamp);
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, current_deposits, current_deposits,
        CampaignStatus::Active, reward_count, randomness_hash, &summary, 0,
    );
    let campaign_capacity = 200_000u64;
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&campaign_capacity)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
        campaign_input_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_out_point.clone()).build();

    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    let p1_address = address_from(11u8);
    let p2_address = address_from(22u8);
    let p1_lock = context.build_script(&always_success_out_point, Bytes::from(p1_address.to_vec())).expect("p1 lock");
    let p2_lock = context.build_script(&always_success_out_point, Bytes::from(p2_address.to_vec())).expect("p2 lock");
    let participant_capacity = 100_000u64;

    let p1_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&participant_capacity)).lock(p1_lock.clone()).build(),
        build_participant_bytes(&campaign_tx_hash, campaign_index, &p1_address, created_at, ParticipantStatus::Verified, 0),
    );
    let p2_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&participant_capacity)).lock(p2_lock.clone()).build(),
        build_participant_bytes(&campaign_tx_hash, campaign_index, &p2_address, created_at, ParticipantStatus::Verified, 0),
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, current_deposits, 0, CampaignStatus::Active, reward_count, randomness_hash, &summary, 0,
    );
    let rewarded_capacity = participant_capacity + reward_per_participant;

    let tx = TransactionBuilder::default()
        .inputs(vec![
            campaign_input,
            CellInput::new_builder().previous_output(p1_out_point).build(),
            CellInput::new_builder().previous_output(p2_out_point).build(),
        ])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&campaign_capacity)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&rewarded_capacity)).lock(p1_lock).build(),
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&rewarded_capacity)).lock(p2_lock).build(),
        ])
        .outputs_data(vec![
            campaign_output_data,
            build_participant_bytes(&campaign_tx_hash, campaign_index, &p1_address, created_at, ParticipantStatus::Rewarded, 0),
            build_participant_bytes(&campaign_tx_hash, campaign_index, &p2_address, created_at, ParticipantStatus::Rewarded, 0),
        ].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("batch_deliver with randomness must succeed");
    println!("test_batch_deliver_randomness_success cycles: {}", cycles);
}

#[test]
fn test_batch_deliver_wrong_preimage() {
    let correct_preimage = [7u8; 32];
    let randomness_hash = blake2b_256(&correct_preimage);
    let wrong_preimage = [8u8; 32];
    let summary = default_summary();

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000_000u64; // ms
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deliver_timestamp = created_at + (start_duration + task_duration + 1_000) * 1_000;
    let current_deposits = 1_000_000u64;
    let reward_count = 2u64;

    let mut script_args = vec![2u8];
    script_args.extend_from_slice(&wrong_preimage);

    let header_hash = insert_header(&mut context, deliver_timestamp);
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, current_deposits, current_deposits,
        CampaignStatus::Active, reward_count, randomness_hash, &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
        campaign_input_data,
    );
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, current_deposits, 0, CampaignStatus::Active, reward_count, randomness_hash, &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .header_dep(header_hash)
        .outputs(vec![CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "wrong randomness preimage must be rejected");
}

#[test]
fn test_batch_deliver_deadline_not_passed() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000_000u64; // ms
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let early_timestamp = created_at + 1_000; // +1 second, well before start_time

    let script_args = vec![2u8];
    let header_hash = insert_header(&mut context, early_timestamp);
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, 1_000_000, 1_000_000, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
        campaign_input_data,
    );
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &address_from(CREATOR),
        CampaignType::SimpleTask, 1_000_000, 0, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .header_dep(header_hash)
        .outputs(vec![CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "batch_deliver before deadline must be rejected");
}

// ───────────────────────── submit_randomness_hash ────────────────────────────

#[test]
fn test_submit_randomness_hash_success() {
    let preimage = [5u8; 32];
    let randomness_hash = blake2b_256(&preimage);
    let reward_count = 3u64;
    let summary = default_summary();

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let mut script_args = vec![5u8];
    script_args.extend_from_slice(&reward_count.to_le_bytes());
    script_args.extend_from_slice(&randomness_hash);

    let creator_address = address_from(CREATOR);
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::SimpleTask, 1_000_000, 500_000, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
        campaign_input_data,
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::SimpleTask, 1_000_000, 500_000, CampaignStatus::Active, reward_count, randomness_hash, &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .outputs(vec![CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("submit_randomness_hash must succeed");
    println!("test_submit_randomness_hash_success cycles: {}", cycles);
}

#[test]
fn test_submit_randomness_hash_already_set() {
    let existing_hash = blake2b_256(&[1u8; 32]);
    let new_hash = blake2b_256(&[5u8; 32]);
    let reward_count = 3u64;
    let summary = default_summary();

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let mut script_args = vec![5u8];
    script_args.extend_from_slice(&reward_count.to_le_bytes());
    script_args.extend_from_slice(&new_hash);

    let creator_address = address_from(CREATOR);
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::SimpleTask, 1_000_000, 500_000, CampaignStatus::Active, 2, existing_hash, &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
        campaign_input_data,
    );
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::SimpleTask, 1_000_000, 500_000, CampaignStatus::Active, reward_count, new_hash, &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .outputs(vec![CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "second submit_randomness_hash must be rejected");
}

#[test]
fn test_submit_randomness_hash_campaign_cancelled() {
    let preimage = [5u8; 32];
    let randomness_hash = blake2b_256(&preimage);
    let reward_count = 3u64;
    let summary = default_summary();

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let mut script_args = vec![5u8];
    script_args.extend_from_slice(&reward_count.to_le_bytes());
    script_args.extend_from_slice(&randomness_hash);

    let creator_address = address_from(CREATOR);
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::SimpleTask, 1_000_000, 0, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
        campaign_input_data,
    );
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::SimpleTask, 1_000_000, 0, CampaignStatus::Cancelled, reward_count, randomness_hash, &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .outputs(vec![CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "submit_randomness_hash on cancelled campaign must be rejected");
}

// ─────────────────────────── cancel_campaign ────────────────────────────────

/// SUCCESS – creator cancels a Created campaign.
#[test]
fn test_cancel_campaign_success() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;

    // Script args: [selector=6]
    let script_args = vec![6u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );

    // Creator input cell (non-campaign) so Depositor address extraction works
    let creator_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .build(),
        Bytes::new(),
    );

    // Output: same data but status = Cancelled
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .inputs(vec![
            CellInput::new_builder().previous_output(campaign_out_point).build(),
            CellInput::new_builder().previous_output(creator_cell).build(),
        ])
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
                .lock(creator_lock.clone())
                .build(),
        ])
        .outputs_data(vec![campaign_output_data, Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("cancel_campaign should succeed");
    println!("test_cancel_campaign_success cycles: {}", cycles);
}

/// FAILURE – cannot cancel an already-cancelled campaign.
#[test]
fn test_cancel_campaign_already_cancelled() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;

    let script_args = vec![6u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .outputs(vec![CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "cancelling an already-cancelled campaign must be rejected");
}

/// FAILURE – non-creator tries to cancel.
#[test]
fn test_cancel_campaign_unauthorized() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let attacker_address = address_from(99u8);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;

    let script_args = vec![6u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");
    let attacker_lock = context
        .build_script(&always_success_out_point, Bytes::from(attacker_address.to_vec()))
        .expect("build attacker lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );

    // Attacker provides their own input cell (not the creator's)
    let attacker_cell = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(attacker_lock.clone())
            .build(),
        Bytes::new(),
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .inputs(vec![
            CellInput::new_builder().previous_output(campaign_out_point).build(),
            CellInput::new_builder().previous_output(attacker_cell).build(),
        ])
        .outputs(vec![CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "non-creator cancel must be rejected");
}

// ──────────────────────────────── refund ────────────────────────────────────

/// SUCCESS – creator refunds two verified participants of a cancelled campaign.
#[test]
fn test_refund_success() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deposit_per_participant = 5_000u64;
    let total_deposits = deposit_per_participant * 2;

    // Script args: [selector=7]
    let script_args = vec![7u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, total_deposits, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );
    let campaign_capacity = DEFAULT_CAPACITY + total_deposits;
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&campaign_capacity))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );
    let campaign_input = CellInput::new_builder().previous_output(campaign_out_point.clone()).build();

    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    let p1_address = address_from(11u8);
    let p2_address = address_from(22u8);
    let p1_lock = context.build_script(&always_success_out_point, Bytes::from(p1_address.to_vec())).expect("p1 lock");
    let p2_lock = context.build_script(&always_success_out_point, Bytes::from(p2_address.to_vec())).expect("p2 lock");
    let participant_capacity = 10_000u64;

    let p1_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&participant_capacity)).lock(p1_lock.clone()).build(),
        build_participant_bytes(&campaign_tx_hash, campaign_index, &p1_address, created_at, ParticipantStatus::Verified, deposit_per_participant),
    );
    let p2_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&participant_capacity)).lock(p2_lock.clone()).build(),
        build_participant_bytes(&campaign_tx_hash, campaign_index, &p2_address, created_at, ParticipantStatus::Verified, deposit_per_participant),
    );

    // Campaign output: current_deposits reduced by total refunded
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );

    let refunded_capacity = participant_capacity + deposit_per_participant;

    let tx = TransactionBuilder::default()
        .inputs(vec![
            campaign_input,
            CellInput::new_builder().previous_output(p1_out_point).build(),
            CellInput::new_builder().previous_output(p2_out_point).build(),
        ])
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(campaign_capacity - total_deposits)))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&refunded_capacity)).lock(p1_lock).build(),
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&refunded_capacity)).lock(p2_lock).build(),
        ])
        .outputs_data(vec![
            campaign_output_data,
            build_participant_bytes(&campaign_tx_hash, campaign_index, &p1_address, created_at, ParticipantStatus::Refunded, deposit_per_participant),
            build_participant_bytes(&campaign_tx_hash, campaign_index, &p2_address, created_at, ParticipantStatus::Refunded, deposit_per_participant),
        ].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("refund should succeed");
    println!("test_refund_success cycles: {}", cycles);
}

/// FAILURE – refund on a non-cancelled campaign.
#[test]
fn test_refund_campaign_not_cancelled() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deposit_amount = 5_000u64;

    let script_args = vec![7u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    // Campaign is Active, not Cancelled
    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, deposit_amount, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );
    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    let p_address = address_from(11u8);
    let p_lock = context.build_script(&always_success_out_point, Bytes::from(p_address.to_vec())).expect("p lock");
    let p_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(p_lock.clone()).build(),
        build_participant_bytes(&campaign_tx_hash, campaign_index, &p_address, created_at, ParticipantStatus::Verified, deposit_amount),
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .inputs(vec![
            CellInput::new_builder().previous_output(campaign_out_point).build(),
            CellInput::new_builder().previous_output(p_out_point).build(),
        ])
        .outputs(vec![
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY)).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + deposit_amount))).lock(p_lock).build(),
        ])
        .outputs_data(vec![
            campaign_output_data,
            build_participant_bytes(&campaign_tx_hash, campaign_index, &p_address, created_at, ParticipantStatus::Refunded, deposit_amount),
        ].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "refund on non-cancelled campaign must be rejected");
}

/// FAILURE – refund with wrong output capacity (not enough returned).
#[test]
fn test_refund_wrong_output_capacity() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deposit_amount = 5_000u64;

    let script_args = vec![7u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, deposit_amount, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );
    let campaign_capacity = DEFAULT_CAPACITY + deposit_amount;
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&campaign_capacity))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );
    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    let p_address = address_from(11u8);
    let p_lock = context.build_script(&always_success_out_point, Bytes::from(p_address.to_vec())).expect("p lock");
    let participant_capacity = 10_000u64;
    let p_out_point = context.create_cell(
        CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&participant_capacity)).lock(p_lock.clone()).build(),
        build_participant_bytes(&campaign_tx_hash, campaign_index, &p_address, created_at, ParticipantStatus::Verified, deposit_amount),
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Cancelled, 0, [0u8; 32], &summary, 0,
    );

    // Wrong: participant gets back only their original capacity, not deposit
    let wrong_refund_capacity = participant_capacity;

    let tx = TransactionBuilder::default()
        .inputs(vec![
            CellInput::new_builder().previous_output(campaign_out_point).build(),
            CellInput::new_builder().previous_output(p_out_point).build(),
        ])
        .outputs(vec![
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&(campaign_capacity - deposit_amount))).lock(creator_lock.clone()).type_(Some(campaign_type_script.clone()).pack()).build(),
            CellOutput::new_builder().capacity(Pack::<Uint64>::pack(&wrong_refund_capacity)).lock(p_lock).build(),
        ])
        .outputs_data(vec![
            campaign_output_data,
            build_participant_bytes(&campaign_tx_hash, campaign_index, &p_address, created_at, ParticipantStatus::Refunded, deposit_amount),
        ].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "refund with wrong output capacity must be rejected");
}

// ──────────────────────── update_campaign_status ────────────────────────────

/// SUCCESS – Created → Active when timestamp >= start_time.
#[test]
fn test_update_campaign_status_to_active() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;   // 1 day in seconds
    let task_duration = 604_800u64;

    // Timestamp is exactly at start_time (created_at + start_duration * 1000 ms)
    let active_ts = created_at + start_duration * 1_000;
    let header_hash = insert_header(&mut context, active_ts);

    let script_args = vec![4u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 10_000, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 10_000, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .header_dep(header_hash)
        .outputs(vec![CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("update to Active should succeed");
    println!("test_update_campaign_status_to_active cycles: {}", cycles);
}

/// SUCCESS – Active → Completed when timestamp >= end_time.
#[test]
fn test_update_campaign_status_to_completed() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;

    // Timestamp past end_time
    let completed_ts = created_at + (start_duration + task_duration) * 1_000 + 1_000;
    let header_hash = insert_header(&mut context, completed_ts);

    let script_args = vec![4u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 10_000, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 10_000, CampaignStatus::Completed, 0, [0u8; 32], &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .header_dep(header_hash)
        .outputs(vec![CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, 10_000_000).expect("update to Completed should succeed");
    println!("test_update_campaign_status_to_completed cycles: {}", cycles);
}

/// FAILURE – trying to update status before start_time → InvalidOperation.
#[test]
fn test_update_campaign_status_too_early() {
    let summary = default_summary();
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;

    // Timestamp before start_time
    let early_ts = created_at + 1_000;
    let header_hash = insert_header(&mut context, early_ts);

    let script_args = vec![4u8];
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Created, 0, [0u8; 32], &summary, 0,
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );

    // Trying to set Active too early
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration, &creator_address,
        CampaignType::FundedTask, 50_000, 0, CampaignStatus::Active, 0, [0u8; 32], &summary, 0,
    );

    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(campaign_out_point).build())
        .header_dep(header_hash)
        .outputs(vec![CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build()])
        .outputs_data(vec![campaign_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "update_campaign_status before start_time must be rejected");
    println!("test_update_campaign_status_too_early correctly rejected: {:?}", result.err());
}
