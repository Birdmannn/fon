use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{
    bytes::Bytes, core::EpochNumberWithFraction, core::HeaderBuilder, core::TransactionBuilder,
    packed::*, prelude::*,
};
use ckb_testtool::context::Context;

// Include your tests here
// See https://github.com/xxuejie/ckb-native-build-sample/blob/main/tests/src/tests.rs for more examples

const CREATOR: u8 = 11;
const DEFAULT_CAPACITY: u64 = 100_000;

fn address_from(seed: u8) -> [u8; 20] {
    let mut address = [0u8; 20];
    for i in 0..20 {
        address[i] = seed.wrapping_add(i as u8);
    }
    address
}

#[test]
fn test_create_campaign_success() {
    let mut context = Context::default();
    let out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);

    let current_timestamp = 1_700_000_000u64; // Example timestamp
    let timestamp: Uint64 = current_timestamp.pack(); // Example timestamp
    let block_number: Uint64 = 100u64.pack();

    let block_header = HeaderBuilder::default()
        .timestamp(timestamp)
        .number(block_number)
        .epoch(EpochNumberWithFraction::new(1, 0, 1))
        .build();
    let block_header_hash = block_header.hash();

    // Try inserting the header into the context sso it can be referenced
    context.insert_header(block_header);

    // PREPARE: Campaign parameters
    let start_duration_in_seconds = 86400u64; // 1 day
    let task_duration_in_seconds = 604800u64; // 7 days
    let campaign_type = 1u8; // FundedTask
    let maximum_amount = 1000u64;

    // Build type script args: [function selector][function args]
    let mut type_script_args = Vec::new();
    type_script_args.push(0); // function selector for create_campaign
    type_script_args.extend_from_slice(&start_duration_in_seconds.to_le_bytes());
    type_script_args.extend_from_slice(&task_duration_in_seconds.to_le_bytes());
    type_script_args.push(campaign_type);
    type_script_args.extend_from_slice(&maximum_amount.to_le_bytes());

    // Create type script with the above args
    let campaign_type_script = context
        .build_script(&out_point, Bytes::from(type_script_args))
        .expect("campaign build type script");

    // Create lock script for the creator
    let creator_lock_script = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("creator build creator lock script");

    // PREPARE INPUT: Creator's CKB cell
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

    // Encode campaign data for the output cell
    let mut campaign = vec![];
    campaign.extend_from_slice(&current_timestamp.to_le_bytes()); // created_at - 8 bytes
    campaign.extend_from_slice(&start_duration_in_seconds.to_le_bytes()); // start_duration - 8 bytes
    campaign.extend_from_slice(&task_duration_in_seconds.to_le_bytes()); // task_duration - 8 bytes
    campaign.extend_from_slice(&creator_address); // created_by - 20 bytes
    campaign.push(campaign_type); // campaign_type - 1 byte
    campaign.extend_from_slice(&maximum_amount.to_le_bytes()); // maximum_amount - 8 bytes
    campaign.extend_from_slice(&0u64.to_le_bytes()); // current_deposits - 8 bytes
    campaign.push(0); // status: Created - 1 byte

    // Assert total is 62 bytes
    assert_eq!(campaign.len(), 62, "Campaign data should be 62 bytes");

    // PREPARE OUTPUTS:
    let outputs = vec![
        // Output 0, new campaign cell
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY / 2)))
            .lock(creator_lock_script.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build(),
        // Output 1, creator's change cell
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY / 2)))
            .lock(creator_lock_script.clone())
            .build(),
    ];

    let outputs_data = vec![Bytes::from(campaign), Bytes::new()];

    // BUILD TRANSACTION
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

// generated unit test for contract freight
// #[test]
// fn test_freight() {
//     // deploy contract
//     let mut context = Context::default();
//     let out_point = context.deploy_cell_by_name("freight");

//     // prepare scripts
//     let lock_script = context
//         .build_script(&out_point, Bytes::from(vec![42]))
//         .expect("script");

//     // prepare cells
//     let input_out_point = context.create_cell(
//         CellOutput::new_builder()
//             .capacity(1000)
//             .lock(lock_script.clone())
//             .build(),
//         Bytes::new(),
//     );
//     let input = CellInput::new_builder()
//         .previous_output(input_out_point)
//         .build();
//     let outputs = vec![
//         CellOutput::new_builder()
//             .capacity(500)
//             .lock(lock_script.clone())
//             .build(),
//         CellOutput::new_builder()
//             .capacity(500)
//             .lock(lock_script)
//             .build(),
//     ];

//     let outputs_data = vec![Bytes::new(); 2];

//     // build transaction
//     let tx = TransactionBuilder::default()
//         .input(input)
//         .outputs(outputs)
//         .outputs_data(outputs_data.pack())
//         .build();
//     let tx = context.complete_tx(tx);

//     // run
//     let cycles = context
//         .verify_tx(&tx, 10_000_000)
//         .expect("pass verification");
//     println!("consume cycles: {}", cycles);
// }
