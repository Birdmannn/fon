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

/// Build the 102-byte campaign cell data blob.
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
) -> Bytes {
    let mut data = Vec::with_capacity(102);
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
    assert_eq!(data.len(), 102, "campaign data must be exactly 102 bytes");
    Bytes::from(data)
}

/// Build the 65-byte participant cell data blob.
fn build_participant_bytes(
    campaign_tx_hash: &[u8; 32],
    campaign_index: u32,
    participant_address: &[u8; 20],
    joined_at: u64,
    status: ParticipantStatus,
) -> Bytes {
    let mut data = Vec::with_capacity(65);
    data.extend_from_slice(campaign_tx_hash);
    data.extend_from_slice(&campaign_index.to_le_bytes());
    data.extend_from_slice(participant_address);
    data.extend_from_slice(&joined_at.to_le_bytes());
    data.push(status as u8);
    assert_eq!(data.len(), 65, "participant data must be exactly 65 bytes");
    Bytes::from(data)
}

fn build_create_campaign_script_args(
    start_duration: u64,
    task_duration: u64,
    campaign_type: CampaignType,
    maximum_amount: u64,
) -> Bytes {
    let mut args = Vec::with_capacity(26);
    args.push(0u8);
    args.extend_from_slice(&start_duration.to_le_bytes());
    args.extend_from_slice(&task_duration.to_le_bytes());
    args.push(campaign_type as u8);
    args.extend_from_slice(&maximum_amount.to_le_bytes());
    Bytes::from(args)
}

/// Insert a block header into the context and return its hash for use as a
/// header-dep.
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

/// Build the common inputs / outputs / header for a `verify_participant`
/// (selector = 3) transaction.
///
/// Script args layout: [selector=3 (1)][admin_address (20)][admin_pubkey (33)]
/// The signature is NO LONGER in the type script args – it goes in the witness.
///
/// Returns `(campaign_input, depositor_input, depositor_output, header_hash)`.
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
        .build_script(
            always_success_out_point,
            Bytes::from(address_from(CREATOR).to_vec()),
        )
        .expect("build creator lock");

    let depositor_lock = context
        .build_script(
            always_success_out_point,
            Bytes::from(address_from(DEPOSITOR).to_vec()),
        )
        .expect("build depositor lock");

    // Campaign cell (GroupInput[0]) – the cell being spent
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_data,
    );
    let campaign_input = CellInput::new_builder()
        .previous_output(campaign_out_point)
        .build();

    // Depositor cell (non-campaign input so get_depositor_address() succeeds)
    let depositor_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder()
        .previous_output(depositor_out_point)
        .build();

    // Change output for the depositor
    let depositor_output = CellOutput::new_builder()
        .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
        .lock(depositor_lock.clone())
        .build();

    (
        campaign_input,
        depositor_input,
        depositor_output,
        header_hash,
    )
}

// ─────────────────────────── create_campaign ────────────────────────────────

#[test]
fn test_create_campaign_success() {
    let mut context = Context::default();
    let out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);

    let current_timestamp = 1_700_000_000u64;
    let timestamp: Uint64 = current_timestamp.pack();
    let block_number: Uint64 = 100u64.pack();

    let block_header = HeaderBuilder::default()
        .timestamp(timestamp)
        .number(block_number)
        .epoch(EpochNumberWithFraction::new(1, 0, 1))
        .build();
    let block_header_hash = block_header.hash();
    context.insert_header(block_header);

    let start_duration_in_seconds = 86400u64;
    let task_duration_in_seconds = 604800u64;
    let campaign_type = CampaignType::FundedTask;
    let maximum_amount = 1000u64;

    let mut type_script_args = Vec::new();
    type_script_args.push(0);
    type_script_args.extend_from_slice(&start_duration_in_seconds.to_le_bytes());
    type_script_args.extend_from_slice(&task_duration_in_seconds.to_le_bytes());
    type_script_args.push(campaign_type as u8);
    type_script_args.extend_from_slice(&maximum_amount.to_le_bytes());

    let campaign_type_script = context
        .build_script(&out_point, Bytes::from(type_script_args))
        .expect("campaign build type script");

    let creator_lock_script = context
        .build_script(
            &always_success_out_point,
            Bytes::from(creator_address.to_vec()),
        )
        .expect("creator build creator lock script");

    let creator_input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock_script.clone())
            .build(),
        Bytes::new(),
    );
    let creator_input = CellInput::new_builder()
        .previous_output(creator_input_out_point)
        .build();

    let campaign_data = build_campaign_bytes(
        current_timestamp,
        start_duration_in_seconds,
        task_duration_in_seconds,
        &creator_address,
        CampaignType::FundedTask,
        maximum_amount,
        0,
        CampaignStatus::Created,
        0,
        [0u8; 32],
    );

    let outputs = vec![
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY / 2)))
            .lock(creator_lock_script.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY / 2)))
            .lock(creator_lock_script.clone())
            .build(),
    ];
    let outputs_data = vec![campaign_data, Bytes::new()];

    let tx = TransactionBuilder::default()
        .input(creator_input)
        .header_dep(block_header_hash)
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, 10_000_000)
        .expect("create campaign transaction should pass verification");
    println!("create campaign consume cycles: {}", cycles);
}

// ─────────────────────────────── deposit ────────────────────────────────────

/// SUCCESS – a deposit-backed stable selector-0 campaign cell uses witness
/// output_type to dispatch deposit, increasing both capacity and current_deposits.
#[test]
fn test_deposit_success() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);
    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64; // 1 day
    let task_duration = 604_800u64; // 7 days
    let max_amount = 50_000u64;
    let deposit_amount = 25_000u64;

    let header_hash = insert_header(&mut context, created_at);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(
                start_duration,
                task_duration,
                CampaignType::FundedTask,
                max_amount,
            ),
        )
        .expect("build type script");

    let creator_lock = context
        .build_script(
            &always_success_out_point,
            Bytes::from(creator_address.to_vec()),
        )
        .expect("build lock script");

    let depositor_lock = context
        .build_script(
            &always_success_out_point,
            Bytes::from(depositor_address.to_vec()),
        )
        .expect("build depositor lock");

    // Input campaign cell: status = Created, type = FundedTask
    let input_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::FundedTask,
        max_amount,
        0,
        CampaignStatus::Created,
        0,
        [0u8; 32],
    );
    let campaign_in_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        input_data,
    );
    let campaign_input = CellInput::new_builder()
        .previous_output(campaign_in_out_point)
        .build();

    let depositor_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder()
        .previous_output(depositor_out_point)
        .build();

    // Output campaign cell: capacity and current_deposits both increased.
    let output_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::FundedTask,
        max_amount,
        deposit_amount,
        CampaignStatus::Created,
        0,
        [0u8; 32],
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
        .witnesses(vec![
            witness_args.as_bytes().pack(),
            Bytes::new().pack(),
        ])
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, 10_000_000)
        .expect("witness-dispatched deposit should succeed");
    println!("deposit_success cycles: {}", cycles);
}

/// SUCCESS – if the requested deposit exceeds remaining headroom, the contract
/// caps the accepted amount to the remaining campaign capacity.
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
    let deposit_amount = 2_000u64; // intentionally exceeds max_amount

    let header_hash = insert_header(&mut context, created_at);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(
                start_duration,
                task_duration,
                CampaignType::FundedTask,
                max_amount,
            ),
        )
        .expect("build type script");

    let creator_lock = context
        .build_script(
            &always_success_out_point,
            Bytes::from(creator_address.to_vec()),
        )
        .expect("build lock script");

    let depositor_lock = context
        .build_script(
            &always_success_out_point,
            Bytes::from(depositor_address.to_vec()),
        )
        .expect("build depositor lock");

    let campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::FundedTask,
        max_amount,
        0,
        CampaignStatus::Created,
        0,
        [0u8; 32],
    );
    let campaign_in_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_data.clone(),
    );
    let campaign_input = CellInput::new_builder()
        .previous_output(campaign_in_out_point)
        .build();

    let depositor_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder()
        .previous_output(depositor_out_point)
        .build();

    let accepted_deposit = max_amount;
    let campaign_output_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::FundedTask,
        max_amount,
        accepted_deposit,
        CampaignStatus::Created,
        0,
        [0u8; 32],
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
        .witnesses(vec![
            witness_args.as_bytes().pack(),
            Bytes::new().pack(),
        ])
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, 10_000_000)
        .expect("deposit should cap to remaining headroom and succeed");
    println!(
        "test_deposit_exceeds_maximum_caps_to_remaining cycles: {}",
        cycles
    );
}

/// FAILURE – SimpleTask campaigns are not deposit-backed and must reject deposits.
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

    let header_hash = insert_header(&mut context, created_at);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(
                start_duration,
                task_duration,
                CampaignType::SimpleTask,
                max_amount,
            ),
        )
        .expect("build type script");

    let creator_lock = context
        .build_script(
            &always_success_out_point,
            Bytes::from(creator_address.to_vec()),
        )
        .expect("build lock script");

    let depositor_lock = context
        .build_script(
            &always_success_out_point,
            Bytes::from(depositor_address.to_vec()),
        )
        .expect("build depositor lock");

    let input_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::SimpleTask,
        max_amount,
        0,
        CampaignStatus::Created,
        0,
        [0u8; 32],
    );
    let campaign_in_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        input_data,
    );
    let campaign_input = CellInput::new_builder()
        .previous_output(campaign_in_out_point)
        .build();

    let depositor_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(depositor_lock.clone())
            .build(),
        Bytes::new(),
    );
    let depositor_input = CellInput::new_builder()
        .previous_output(depositor_out_point)
        .build();

    let output_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::SimpleTask,
        max_amount,
        deposit_amount,
        CampaignStatus::Created,
        0,
        [0u8; 32],
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
        .witnesses(vec![
            witness_args.as_bytes().pack(),
            Bytes::new().pack(),
        ])
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "SimpleTask deposit must be rejected");
    println!(
        "test_deposit_rejects_simple_task correctly rejected: {:?}",
        result.err()
    );
}

/// REGRESSION – deposit must succeed when the tx timestamp is still within the
/// start period, even when using real CKB millisecond-scale timestamps.
///
/// This test catches the bug where `created_at` (in ms) was compared directly
/// to `created_at + start_duration_seconds` without unit conversion, causing
/// the deposit window to close after just `start_duration` *milliseconds*
/// (≈86 seconds for a 1-day campaign) instead of `start_duration * 1000` ms.
#[test]
fn test_deposit_within_start_period_millisecond_timestamps() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);

    // Use realistic ms-scale timestamps (as CKB block headers produce).
    let created_at_ms = 1_700_000_000_000u64; // creation time in ms
    let start_duration = 86_400u64;           // 1 day in seconds
    let task_duration = 604_800u64;           // 7 days in seconds
    let max_amount = 50_000u64;
    let deposit_amount = 10_000u64;

    // Deposit happens 100 seconds (100_000 ms) after creation – well within the
    // 1-day window.  With the old bug, the check was:
    //   100_000 > 1_700_000_000_000 + 86_400  → TRUE  → deposit rejected (wrong!)
    // With the fix:
    //   100_000_ms_elapsed > 86_400_000_ms_window? → FALSE → deposit accepted (correct!)
    let deposit_ts_ms = created_at_ms + 100_000u64; // +100 seconds in ms

    // Insert the header the depositor presents (tip block at deposit time).
    let header_hash = insert_header(&mut context, deposit_ts_ms);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(
                start_duration,
                task_duration,
                CampaignType::FundedTask,
                max_amount,
            ),
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
        CampaignType::FundedTask, max_amount, 0, CampaignStatus::Created, 0, [0u8; 32],
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
        CampaignType::FundedTask, max_amount, deposit_amount, CampaignStatus::Created, 0, [0u8; 32],
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

    let cycles = context
        .verify_tx(&tx, 10_000_000)
        .expect("deposit at +100 s should succeed (timestamp unit fix)");
    println!("test_deposit_within_start_period_millisecond_timestamps cycles: {}", cycles);
}

/// FAILURE – deposit must be rejected when the current block timestamp has
/// passed the end of the start period (in milliseconds).
#[test]
fn test_deposit_rejects_after_start_period_elapsed() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let depositor_address = address_from(DEPOSITOR);

    let created_at_ms = 1_700_000_000_000u64;
    let start_duration = 86_400u64;  // 1 day in seconds
    let task_duration = 604_800u64;
    let max_amount = 50_000u64;
    let deposit_amount = 10_000u64;

    // Deposit happens 1 second AFTER the 1-day start window in ms.
    let deposit_ts_ms = created_at_ms + start_duration * 1_000 + 1_000u64;

    let header_hash = insert_header(&mut context, deposit_ts_ms);

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_create_campaign_script_args(
                start_duration, task_duration, CampaignType::FundedTask, max_amount,
            ),
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
        CampaignType::FundedTask, max_amount, 0, CampaignStatus::Created, 0, [0u8; 32],
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
        CampaignType::FundedTask, max_amount, deposit_amount, CampaignStatus::Created, 0, [0u8; 32],
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
    println!("test_deposit_rejects_after_start_period_elapsed correctly rejected: {:?}", result.err());
}

// ────────────────────────── verify_participant ───────────────────────────────
//
// Script args layout for verify_participant (selector = 3):
//   full_args[0]     = 3 (selector)
//   full_args[1..21] = admin_address (20 bytes)
//   full_args[21..54]= admin_pubkey  (33 bytes, compressed secp256k1)
//
// The per-participant signature (65 bytes) is passed in the transaction
// witness: WitnessArgs.input_type of the campaign cell (witnesses[0]).

/// FAILURE – the campaign's deadline has already passed (timestamp > till).
#[test]
fn test_verify_participant_campaign_expired() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64; // 1 day
    let task_duration = 604_800u64; // 7 days
    // till = created_at + start_duration + task_duration = 1_700_691_200
    let expired_timestamp = 1_701_000_000u64; // well past the deadline

    // Script args: [selector=3][admin_address(20)][admin_pubkey(33)] = 54 bytes
    // Signature is irrelevant – we fail at the timestamp check first.
    let mut script_args = vec![3u8];
    script_args.extend_from_slice(&[0u8; 20]); // admin_address at args[1..21]
    script_args.extend_from_slice(&[0u8; 33]); // admin_pubkey  at args[21..54]

    let campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        1_000,
        0,
        CampaignStatus::Active,
        0,
        [0u8; 32],
    );

    let (campaign_input, depositor_input, depositor_output, header_hash) =
        build_verify_participant_base(
            &mut context,
            &freight_out_point,
            &always_success_out_point,
            script_args,
            campaign_data,
            expired_timestamp,
        );

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![depositor_output])
        .outputs_data(vec![Bytes::new()].pack())
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(
        result.is_err(),
        "expired campaign must be rejected with VerificationNotCompleted"
    );
    println!(
        "test_verify_participant_campaign_expired correctly rejected: {:?}",
        result.err()
    );
}

/// FAILURE – the signature in the witness is all-zero bytes (invalid secp256k1 scalar).
/// The contract must return Err(InvalidSignature) instead of panicking.
#[test]
fn test_verify_participant_invalid_signature() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let active_timestamp = created_at + 100; // within active window

    // Script args: no signature slot (signature goes in witness instead)
    let mut script_args = vec![3u8];
    script_args.extend_from_slice(&[0u8; 20]); // admin_address at args[1..21]
    script_args.extend_from_slice(&[0u8; 33]); // admin_pubkey  at args[21..54]

    let campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        1_000,
        0,
        CampaignStatus::Active,
        0,
        [0u8; 32],
    );

    let (campaign_input, depositor_input, depositor_output, header_hash) =
        build_verify_participant_base(
            &mut context,
            &freight_out_point,
            &always_success_out_point,
            script_args,
            campaign_data,
            active_timestamp,
        );

    // All-zero signature: r=0 is an invalid secp256k1 scalar →
    // RecoverableSignature::from_compact returns Err → propagates as InvalidSignature
    let invalid_sig = vec![0u8; 65];
    let witness_args = WitnessArgsBuilder::default()
        .input_type(Some(Bytes::from(invalid_sig)).pack())
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![depositor_output])
        .outputs_data(vec![Bytes::new()].pack())
        .witnesses(vec![
            witness_args.as_bytes().pack(), // campaign input witness
            Bytes::new().pack(),            // depositor input witness
        ])
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(
        result.is_err(),
        "invalid signature must be rejected (not a panic)"
    );
    println!(
        "test_verify_participant_invalid_signature correctly rejected: {:?}",
        result.err()
    );
}

/// SUCCESS – uses a real secp256k1 admin keypair.
/// The admin signs blake2b_256(depositor_address || campaign_outpoint) off-chain
/// and provides the signature in the transaction witness.
#[test]
fn test_verify_participant_success() {
    // Deterministic admin keypair ([1u8; 32] is a valid secp256k1 scalar)
    let secret_key = SecretKey::from_slice(&[1u8; 32]).unwrap();
    let admin_pubkey_bytes = PublicKey::from_secret_key(&SECP256K1, &secret_key).serialize();
    let admin_address = [0u8; 20]; // arbitrary; not checked in verify_participant

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let active_timestamp = created_at + 100; // inside active window

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    // Script args: [selector=3][admin_address(20)][admin_pubkey(33)] — no signature slot
    let mut script_args = vec![3u8];
    script_args.extend_from_slice(&admin_address);
    script_args.extend_from_slice(&admin_pubkey_bytes);

    let campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        1_000,
        0,
        CampaignStatus::Active,
        0,
        [0u8; 32],
    );

    let (campaign_input, depositor_input, depositor_output, header_hash) =
        build_verify_participant_base(
            &mut context,
            &freight_out_point,
            &always_success_out_point,
            script_args,
            campaign_data,
            active_timestamp,
        );

    // The campaign outpoint is now known (create_cell has been called).
    // Because the signature is in the witness (not the type script args),
    // the outpoint is not affected by the signature — no circular dependency.
    let campaign_outpoint = campaign_input.previous_output();
    let tx_hash_bytes: [u8; 32] = campaign_outpoint.tx_hash().as_slice().try_into().unwrap();
    let index_bytes: [u8; 4] = campaign_outpoint.index().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(index_bytes);

    // Build message: blake2b_256(depositor_address || tx_hash || index)
    let depositor_address = address_from(DEPOSITOR);
    let mut buf = [0u8; 56];
    buf[..20].copy_from_slice(&depositor_address);
    buf[20..52].copy_from_slice(&tx_hash_bytes);
    buf[52..56].copy_from_slice(&index_bytes);
    let message_hash = blake2b_256(&buf);

    // Admin signs off-chain with standard (non-recoverable) ECDSA → 64 bytes
    let msg = SecpMessage::from_digest(message_hash);
    let sig = SECP256K1.sign_ecdsa(&msg, &secret_key);
    let signature = sig.serialize_compact(); // [u8; 64]

    // Build the participant output cell required by validate_participant_added.
    // Layout: [campaign_tx_hash(32)][campaign_index(4)][participant_address(20)][joined_at(8)][status(1)]
    let participant_data = build_participant_bytes(
        &tx_hash_bytes,
        campaign_index,
        &depositor_address,
        active_timestamp,
        ParticipantStatus::Verified,
    );
    let participant_lock = context
        .build_script(&always_success_out_point, Bytes::from(vec![99u8; 20]))
        .expect("build participant lock");
    let participant_output = CellOutput::new_builder()
        .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
        .lock(participant_lock)
        .build();

    // Witness: signature in input_type of the campaign cell (witnesses[0])
    let witness_args = WitnessArgsBuilder::default()
        .input_type(Some(Bytes::from(signature.to_vec())).pack()) // 64 bytes
        .build();

    let tx = TransactionBuilder::default()
        .inputs(vec![campaign_input, depositor_input])
        .header_dep(header_hash)
        .outputs(vec![depositor_output, participant_output])
        .outputs_data(vec![Bytes::new(), participant_data].pack())
        .witnesses(vec![
            witness_args.as_bytes().pack(), // campaign input witness (holds signature)
            Bytes::new().pack(),            // depositor input witness
        ])
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, 10_000_000)
        .expect("verify_participant with valid admin signature must succeed");
    println!("test_verify_participant_success cycles: {}", cycles);
}

// ─────────────────────────────── batch_deliver ───────────────────────────────

/// SUCCESS – sequential (reward_count = 0, no randomness).
/// Two Verified participants each receive reward_per_participant in capacity.
#[test]
fn test_batch_deliver_sequential() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;  // 1 day
    let task_duration = 604_800u64;  // 7 days
    // till = 1_700_691_200; deliver at well past deadline
    let deliver_timestamp = 1_701_000_000u64;

    let current_deposits = 1_000_000u64;
    let batch_size: u64 = 2;
    let reward_per_participant = current_deposits / batch_size; // 500_000

    // Script args: [selector=2] — no instruction_args needed (no randomness)
    let script_args = vec![2u8];
    let header_hash = insert_header(&mut context, deliver_timestamp);

    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");

    let creator_lock = context
        .build_script(
            &always_success_out_point,
            Bytes::from(address_from(CREATOR).to_vec()),
        )
        .expect("build creator lock");

    // Campaign input cell (past deadline, fully deposited, reward_count = 0 = all-participants)
    let campaign_input_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits,
        current_deposits,
        CampaignStatus::Active,
        0,         // reward_count = 0 → all-participants mode
        [0u8; 32], // no randomness
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
    let campaign_input = CellInput::new_builder()
        .previous_output(campaign_out_point.clone())
        .build();

    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index = u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    // Two participant addresses
    let p1_address = address_from(11u8);
    let p2_address = address_from(22u8);

    let p1_lock = context
        .build_script(&always_success_out_point, Bytes::from(p1_address.to_vec()))
        .expect("p1 lock");
    let p2_lock = context
        .build_script(&always_success_out_point, Bytes::from(p2_address.to_vec()))
        .expect("p2 lock");

    let participant_capacity = 100_000u64;

    let p1_input_data = build_participant_bytes(
        &campaign_tx_hash,
        campaign_index,
        &p1_address,
        created_at,
        ParticipantStatus::Verified,
    );
    let p1_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&participant_capacity))
            .lock(p1_lock.clone())
            .build(),
        p1_input_data,
    );

    let p2_input_data = build_participant_bytes(
        &campaign_tx_hash,
        campaign_index,
        &p2_address,
        created_at,
        ParticipantStatus::Verified,
    );
    let p2_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&participant_capacity))
            .lock(p2_lock.clone())
            .build(),
        p2_input_data,
    );

    // Campaign output: current_deposits = 0 (all paid out)
    let campaign_output_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits,
        0,
        CampaignStatus::Active,
        0,
        [0u8; 32],
    );

    // Participant outputs: status = Rewarded, capacity += reward_per_participant
    let rewarded_capacity = participant_capacity + reward_per_participant;

    let p1_output_data = build_participant_bytes(
        &campaign_tx_hash,
        campaign_index,
        &p1_address,
        created_at,
        ParticipantStatus::Rewarded,
    );
    let p2_output_data = build_participant_bytes(
        &campaign_tx_hash,
        campaign_index,
        &p2_address,
        created_at,
        ParticipantStatus::Rewarded,
    );

    let tx = TransactionBuilder::default()
        .inputs(vec![
            campaign_input,
            CellInput::new_builder().previous_output(p1_out_point).build(),
            CellInput::new_builder().previous_output(p2_out_point).build(),
        ])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&campaign_capacity))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&rewarded_capacity))
                .lock(p1_lock)
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&rewarded_capacity))
                .lock(p2_lock)
                .build(),
        ])
        .outputs_data(vec![campaign_output_data, p1_output_data, p2_output_data].pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, 10_000_000)
        .expect("batch_deliver sequential must succeed");
    println!("test_batch_deliver_sequential cycles: {}", cycles);
}

/// SUCCESS – randomness mode: campaign has a committed randomness_hash and the
/// correct preimage is provided in the instruction args.
#[test]
fn test_batch_deliver_randomness_success() {
    let preimage = [7u8; 32];
    let randomness_hash = blake2b_256(&preimage);

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deliver_timestamp = 1_701_000_000u64;
    let current_deposits = 1_000_000u64;
    let reward_count = 2u64; // N-recipients mode
    let reward_per_participant = current_deposits / reward_count;

    // Script args: [selector=2][preimage(32)]
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
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, current_deposits,
        CampaignStatus::Active,
        reward_count,
        randomness_hash,
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
    let campaign_input = CellInput::new_builder()
        .previous_output(campaign_out_point.clone())
        .build();

    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index =
        u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    let p1_address = address_from(11u8);
    let p2_address = address_from(22u8);
    let p1_lock = context
        .build_script(&always_success_out_point, Bytes::from(p1_address.to_vec()))
        .expect("p1 lock");
    let p2_lock = context
        .build_script(&always_success_out_point, Bytes::from(p2_address.to_vec()))
        .expect("p2 lock");
    let participant_capacity = 100_000u64;

    let p1_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&participant_capacity))
            .lock(p1_lock.clone())
            .build(),
        build_participant_bytes(
            &campaign_tx_hash, campaign_index, &p1_address, created_at,
            ParticipantStatus::Verified,
        ),
    );
    let p2_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&participant_capacity))
            .lock(p2_lock.clone())
            .build(),
        build_participant_bytes(
            &campaign_tx_hash, campaign_index, &p2_address, created_at,
            ParticipantStatus::Verified,
        ),
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, 0,
        CampaignStatus::Active,
        reward_count,
        randomness_hash,
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
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&campaign_capacity))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&rewarded_capacity))
                .lock(p1_lock)
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&rewarded_capacity))
                .lock(p2_lock)
                .build(),
        ])
        .outputs_data(
            vec![
                campaign_output_data,
                build_participant_bytes(
                    &campaign_tx_hash, campaign_index, &p1_address, created_at,
                    ParticipantStatus::Rewarded,
                ),
                build_participant_bytes(
                    &campaign_tx_hash, campaign_index, &p2_address, created_at,
                    ParticipantStatus::Rewarded,
                ),
            ]
            .pack(),
        )
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context
        .verify_tx(&tx, 10_000_000)
        .expect("batch_deliver with correct randomness preimage must succeed");
    println!("test_batch_deliver_randomness_success cycles: {}", cycles);
}

/// FAILURE – wrong randomness preimage provided → RandomnessMismatch.
#[test]
fn test_batch_deliver_wrong_preimage() {
    let correct_preimage = [7u8; 32];
    let randomness_hash = blake2b_256(&correct_preimage);
    let wrong_preimage = [8u8; 32];

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deliver_timestamp = 1_701_000_000u64;
    let current_deposits = 1_000_000u64;
    let reward_count = 2u64;

    // Wrong preimage in instruction args
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
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, current_deposits,
        CampaignStatus::Active,
        reward_count,
        randomness_hash, // correct hash in campaign
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
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, 0,
        CampaignStatus::Active,
        reward_count, randomness_hash,
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
    assert!(result.is_err(), "wrong randomness preimage must be rejected");
    println!(
        "test_batch_deliver_wrong_preimage correctly rejected: {:?}",
        result.err()
    );
}

/// FAILURE – randomness_hash set in campaign but no preimage provided in args → InvalidVerificationArgs.
#[test]
fn test_batch_deliver_missing_randomness_args() {
    let preimage = [7u8; 32];
    let randomness_hash = blake2b_256(&preimage);

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deliver_timestamp = 1_701_000_000u64;
    let current_deposits = 1_000_000u64;
    let reward_count = 2u64;

    // No preimage in instruction args at all
    let script_args = vec![2u8];

    let header_hash = insert_header(&mut context, deliver_timestamp);
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, current_deposits,
        CampaignStatus::Active,
        reward_count,
        randomness_hash,
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
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, 0,
        CampaignStatus::Active,
        reward_count, randomness_hash,
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
    assert!(result.is_err(), "missing randomness args must be rejected");
    println!(
        "test_batch_deliver_missing_randomness_args correctly rejected: {:?}",
        result.err()
    );
}

/// FAILURE – batch_deliver called before the campaign deadline passes → InvalidOperation.
#[test]
fn test_batch_deliver_deadline_not_passed() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    // till = 1_700_691_200; use timestamp well inside the window
    let early_timestamp = created_at + 100;

    let script_args = vec![2u8];
    let header_hash = insert_header(&mut context, early_timestamp);
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        1_000_000, 1_000_000,
        CampaignStatus::Active,
        0, [0u8; 32],
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
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        1_000_000, 0,
        CampaignStatus::Active,
        0, [0u8; 32],
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
    assert!(result.is_err(), "batch_deliver before deadline must be rejected");
    println!(
        "test_batch_deliver_deadline_not_passed correctly rejected: {:?}",
        result.err()
    );
}

/// FAILURE – participant input has Pending status instead of Verified → InvalidOperation.
#[test]
fn test_batch_deliver_participant_wrong_status() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deliver_timestamp = 1_701_000_000u64;
    let current_deposits = 500_000u64;

    let script_args = vec![2u8];
    let header_hash = insert_header(&mut context, deliver_timestamp);
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let campaign_capacity = 200_000u64;
    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, current_deposits,
        CampaignStatus::Active,
        0, [0u8; 32],
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&campaign_capacity))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );
    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index =
        u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    let p_address = address_from(11u8);
    let p_lock = context
        .build_script(&always_success_out_point, Bytes::from(p_address.to_vec()))
        .expect("participant lock");
    let participant_capacity = 100_000u64;

    // Participant with Pending status – not eligible for rewards
    let p_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&participant_capacity))
            .lock(p_lock.clone())
            .build(),
        build_participant_bytes(
            &campaign_tx_hash, campaign_index, &p_address, created_at,
            ParticipantStatus::Pending,
        ),
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, 0,
        CampaignStatus::Active,
        0, [0u8; 32],
    );

    let tx = TransactionBuilder::default()
        .inputs(vec![
            CellInput::new_builder().previous_output(campaign_out_point).build(),
            CellInput::new_builder().previous_output(p_out_point).build(),
        ])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&campaign_capacity))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(participant_capacity + current_deposits)))
                .lock(p_lock)
                .build(),
        ])
        .outputs_data(
            vec![
                campaign_output_data,
                build_participant_bytes(
                    &campaign_tx_hash, campaign_index, &p_address, created_at,
                    ParticipantStatus::Rewarded,
                ),
            ]
            .pack(),
        )
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "Pending participant must be rejected");
    println!(
        "test_batch_deliver_participant_wrong_status correctly rejected: {:?}",
        result.err()
    );
}

/// FAILURE – participant output capacity not increased by reward → AmountMismatch.
#[test]
fn test_batch_deliver_wrong_output_capacity() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let created_at = 1_700_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let deliver_timestamp = 1_701_000_000u64;
    let current_deposits = 500_000u64;

    let script_args = vec![2u8];
    let header_hash = insert_header(&mut context, deliver_timestamp);
    let campaign_type_script = context
        .build_script(&freight_out_point, Bytes::from(script_args))
        .expect("build type script");
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(address_from(CREATOR).to_vec()))
        .expect("build creator lock");

    let campaign_capacity = 200_000u64;
    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, current_deposits,
        CampaignStatus::Active,
        0, [0u8; 32],
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&campaign_capacity))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );
    let campaign_tx_hash: [u8; 32] = campaign_out_point.tx_hash().as_slice().try_into().unwrap();
    let campaign_index =
        u32::from_le_bytes(campaign_out_point.index().as_slice().try_into().unwrap());

    let p_address = address_from(11u8);
    let p_lock = context
        .build_script(&always_success_out_point, Bytes::from(p_address.to_vec()))
        .expect("participant lock");
    let participant_capacity = 100_000u64;

    let p_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&participant_capacity))
            .lock(p_lock.clone())
            .build(),
        build_participant_bytes(
            &campaign_tx_hash, campaign_index, &p_address, created_at,
            ParticipantStatus::Verified,
        ),
    );

    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &address_from(CREATOR),
        CampaignType::SimpleTask,
        current_deposits, 0,
        CampaignStatus::Active,
        0, [0u8; 32],
    );

    // Reward should be 500_000 (current_deposits / 1 participant) but we give 0 extra
    let wrong_output_capacity = participant_capacity; // missing reward

    let tx = TransactionBuilder::default()
        .inputs(vec![
            CellInput::new_builder().previous_output(campaign_out_point).build(),
            CellInput::new_builder().previous_output(p_out_point).build(),
        ])
        .header_dep(header_hash)
        .outputs(vec![
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&campaign_capacity))
                .lock(creator_lock.clone())
                .type_(Some(campaign_type_script.clone()).pack())
                .build(),
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&wrong_output_capacity))
                .lock(p_lock)
                .build(),
        ])
        .outputs_data(
            vec![
                campaign_output_data,
                build_participant_bytes(
                    &campaign_tx_hash, campaign_index, &p_address, created_at,
                    ParticipantStatus::Rewarded,
                ),
            ]
            .pack(),
        )
        .build();
    let tx = context.complete_tx(tx);

    let result = context.verify_tx(&tx, 10_000_000);
    assert!(result.is_err(), "wrong output capacity must be rejected");
    println!(
        "test_batch_deliver_wrong_output_capacity correctly rejected: {:?}",
        result.err()
    );
}

// ───────────────────────── submit_randomness_hash ────────────────────────────

/// SUCCESS – creator commits reward_count and randomness_hash before delivery.
#[test]
fn test_submit_randomness_hash_success() {
    let preimage = [5u8; 32];
    let randomness_hash = blake2b_256(&preimage);
    let reward_count = 3u64;

    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    // Script args: [selector=5][reward_count(8)][randomness_hash(32)]
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

    // Campaign input: distribution parameters not yet set
    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &creator_address,
        CampaignType::SimpleTask,
        1_000_000, 500_000,
        CampaignStatus::Active,
        0, [0u8; 32],
    );
    let campaign_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        campaign_input_data,
    );

    // Campaign output: distribution parameters now committed
    let campaign_output_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &creator_address,
        CampaignType::SimpleTask,
        1_000_000, 500_000,
        CampaignStatus::Active,
        reward_count,
        randomness_hash,
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

    let cycles = context
        .verify_tx(&tx, 10_000_000)
        .expect("submit_randomness_hash must succeed");
    println!("test_submit_randomness_hash_success cycles: {}", cycles);
}

/// FAILURE – randomness_hash already set (idempotency guard) → InvalidOperation.
#[test]
fn test_submit_randomness_hash_already_set() {
    let existing_hash = blake2b_256(&[1u8; 32]);
    let new_hash = blake2b_256(&[5u8; 32]);
    let reward_count = 3u64;

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

    // Campaign input: randomness already committed (non-zero hash)
    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &creator_address,
        CampaignType::SimpleTask,
        1_000_000, 500_000,
        CampaignStatus::Active,
        2, existing_hash,
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
        created_at, start_duration, task_duration,
        &creator_address,
        CampaignType::SimpleTask,
        1_000_000, 500_000,
        CampaignStatus::Active,
        reward_count, new_hash,
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
    assert!(
        result.is_err(),
        "second submit_randomness_hash must be rejected (idempotency)"
    );
    println!(
        "test_submit_randomness_hash_already_set correctly rejected: {:?}",
        result.err()
    );
}

/// FAILURE – submit_randomness_hash on a cancelled campaign → InvalidOperation.
#[test]
fn test_submit_randomness_hash_campaign_cancelled() {
    let preimage = [5u8; 32];
    let randomness_hash = blake2b_256(&preimage);
    let reward_count = 3u64;

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

    // Campaign input: status = Cancelled
    let campaign_input_data = build_campaign_bytes(
        created_at, start_duration, task_duration,
        &creator_address,
        CampaignType::SimpleTask,
        1_000_000, 0,
        CampaignStatus::Cancelled,
        0, [0u8; 32],
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
        created_at, start_duration, task_duration,
        &creator_address,
        CampaignType::SimpleTask,
        1_000_000, 0,
        CampaignStatus::Cancelled,
        reward_count, randomness_hash,
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
    assert!(
        result.is_err(),
        "submit_randomness_hash on cancelled campaign must be rejected"
    );
    println!(
        "test_submit_randomness_hash_campaign_cancelled correctly rejected: {:?}",
        result.err()
    );
}
