use super::*;
use core::cmp::Ordering;

#[derive(Clone, Debug)]
struct RaffleParticipant {
    address: [u8; 20],
    joined_at: u64,
    input_capacity: u64,
    cell_out_point: OutPoint,
}

fn build_full_create_campaign_script_args(
    start_duration: u64,
    task_duration: u64,
    campaign_type: CampaignType,
    maximum_amount: u64,
    aux_amount: u64,
    randomness_hash: [u8; 32],
    reward_count: u64,
) -> Bytes {
    let mut args = Vec::with_capacity(73);
    args.push(0u8);
    args.extend_from_slice(&start_duration.to_le_bytes());
    args.extend_from_slice(&task_duration.to_le_bytes());
    args.push(campaign_type as u8);
    args.extend_from_slice(&maximum_amount.to_le_bytes());
    args.extend_from_slice(&aux_amount.to_le_bytes());
    args.extend_from_slice(&randomness_hash);
    args.extend_from_slice(&reward_count.to_le_bytes());
    Bytes::from(args)
}

fn witness_with_output_type(bytes: Vec<u8>) -> WitnessArgs {
    WitnessArgsBuilder::default()
        .output_type(Some(Bytes::from(bytes)).pack())
        .build()
}

fn compare_participants(
    left: &RaffleParticipant,
    right: &RaffleParticipant,
    _campaign_tx_hash: &[u8; 32],
    _campaign_index: u32,
) -> Ordering {
    left.joined_at
        .cmp(&right.joined_at)
        .then_with(|| left.address.cmp(&right.address))
}

fn derive_shuffle_seed(
    revealed: &[u8; 32],
    participants_len: usize,
    campaign_tx_hash: &[u8; 32],
    campaign_index: u32,
) -> [u8; 32] {
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

fn deterministic_winners(
    participants: &[RaffleParticipant],
    reward_count: usize,
    revealed: [u8; 32],
    campaign_tx_hash: [u8; 32],
    campaign_index: u32,
) -> Vec<RaffleParticipant> {
    let mut ordered = participants.to_vec();
    ordered.sort_by(|left, right| {
        compare_participants(left, right, &campaign_tx_hash, campaign_index)
    });

    if reward_count >= ordered.len() {
        return ordered;
    }

    let seed = derive_shuffle_seed(&revealed, ordered.len(), &campaign_tx_hash, campaign_index);
    let mut round = 0u64;
    let mut i = ordered.len();
    while i > 1 {
        i -= 1;
        let j = draw_uniform_index(&seed, &mut round, i + 1);
        ordered.swap(i, j);
    }

    ordered.into_iter().take(reward_count).collect()
}

#[test]
fn test_raffle_full_lifecycle_e2e() {
    let mut context = Context::default();
    let freight_out_point = context.deploy_cell_by_name("freight");
    let always_success_out_point = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let creator_address = address_from(CREATOR);
    let creator_lock = context
        .build_script(&always_success_out_point, Bytes::from(creator_address.to_vec()))
        .expect("build creator lock");

    let created_at = 1_700_000_000_000u64;
    let start_duration = 86_400u64;
    let task_duration = 604_800u64;
    let maximum_amount = 1_000u64;
    let ticket_price = 100u64;
    let reward_count = 2u64;
    let summary = default_summary();
    let randomness_preimage = [7u8; 32];
    let randomness_hash = blake2b_256(&randomness_preimage);
    let zero_randomness_hash = [0u8; 32];

    let campaign_type_script = context
        .build_script(
            &freight_out_point,
            build_full_create_campaign_script_args(
                start_duration,
                task_duration,
                CampaignType::Raffle,
                maximum_amount,
                ticket_price,
                zero_randomness_hash,
                0,
            ),
        )
        .expect("build raffle campaign type script");

    // 1. Create raffle campaign.
    let create_header_hash = insert_header(&mut context, created_at);
    let creator_input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(creator_lock.clone())
            .build(),
        Bytes::new(),
    );
    let creator_input = CellInput::new_builder()
        .previous_output(creator_input_out_point)
        .build();

    let initial_campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::Raffle,
        maximum_amount,
        0,
        CampaignStatus::Created,
        0,
        zero_randomness_hash,
        &summary,
        ticket_price,
    );
    let initial_campaign_output = CellOutput::new_builder()
        .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
        .lock(creator_lock.clone())
        .type_(Some(campaign_type_script.clone()).pack())
        .build();

    let create_tx = TransactionBuilder::default()
        .input(creator_input)
        .header_dep(create_header_hash)
        .outputs(vec![initial_campaign_output.clone()])
        .outputs_data(vec![initial_campaign_data.clone()].pack())
        .build();
    let create_tx = context.complete_tx(create_tx);
    context
        .verify_tx(&create_tx, 10_000_000)
        .expect("raffle campaign creation should pass");

    let campaign_out_point = OutPoint::new_builder()
        .tx_hash(create_tx.hash())
        .index(0u32)
        .build();
    context.create_cell_with_out_point(
        campaign_out_point.clone(),
        initial_campaign_output.clone(),
        initial_campaign_data.clone(),
    );

    // 2. Submit randomness commitment.
    let committed_campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::Raffle,
        maximum_amount,
        0,
        CampaignStatus::Created,
        reward_count,
        randomness_hash,
        &summary,
        ticket_price,
    );
    let submit_randomness_tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(campaign_out_point.clone())
                .build(),
        )
        .outputs(vec![initial_campaign_output.clone()])
        .outputs_data(vec![committed_campaign_data.clone()].pack())
        .witness(witness_with_output_type({
            let mut bytes = vec![5u8];
            bytes.extend_from_slice(&reward_count.to_le_bytes());
            bytes.extend_from_slice(&randomness_hash);
            bytes
        }).as_bytes().pack())
        .build();
    let submit_randomness_tx = context.complete_tx(submit_randomness_tx);
    context
        .verify_tx(&submit_randomness_tx, 10_000_000)
        .expect("submit randomness hash should pass");
    context.create_cell_with_out_point(
        campaign_out_point.clone(),
        initial_campaign_output.clone(),
        committed_campaign_data.clone(),
    );

    // 3. Advance status to Active (start_duration has elapsed, ticket sales open).
    let active_timestamp = created_at + start_duration * 1_000;
    let pre_sales_header_hash = insert_header(&mut context, active_timestamp);
    let active_committed_campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::Raffle,
        maximum_amount,
        0,
        CampaignStatus::Active,
        reward_count,
        randomness_hash,
        &summary,
        ticket_price,
    );
    let active_campaign_output_pre = CellOutput::new_builder()
        .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
        .lock(creator_lock.clone())
        .type_(Some(campaign_type_script.clone()).pack())
        .build();
    let advance_status_tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(campaign_out_point.clone())
                .build(),
        )
        .header_dep(pre_sales_header_hash)
        .outputs(vec![active_campaign_output_pre.clone()])
        .outputs_data(vec![active_committed_campaign_data.clone()].pack())
        .witness(witness_with_output_type(vec![4u8]).as_bytes().pack())
        .build();
    let advance_status_tx = context.complete_tx(advance_status_tx);
    context
        .verify_tx(&advance_status_tx, 10_000_000)
        .expect("advance status to Active should pass");
    context.create_cell_with_out_point(
        campaign_out_point.clone(),
        active_campaign_output_pre,
        active_committed_campaign_data,
    );

    // 4. Add raffle participants after start time (during Active window).
    // Timestamps must be after created_at + start_duration * 1_000 and before
    // created_at + start_duration * 1_000 + task_duration * 1_000.
    let sales_open = created_at + start_duration * 1_000;
    let participant_seeds = [DEPOSITOR, DEPOSITOR.wrapping_add(1), DEPOSITOR.wrapping_add(2)];
    let participant_joined_at = [sales_open + 1_000, sales_open + 2_000, sales_open + 3_000];
    let mut participants = Vec::new();
    let mut current_deposits = 0u64;

    for (index, (&seed, &joined_at)) in participant_seeds
        .iter()
        .zip(participant_joined_at.iter())
        .enumerate()
    {
        let participant_address = address_from(seed);
        let participant_lock = context
            .build_script(&always_success_out_point, Bytes::from(participant_address.to_vec()))
            .expect("build participant lock");
        let depositor_funding_out_point = context.create_cell(
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
                .lock(participant_lock.clone())
                .build(),
            Bytes::new(),
        );

        let header_hash = insert_header(&mut context, joined_at);
        let updated_deposits = current_deposits + ticket_price;
        let updated_campaign_data = build_campaign_bytes(
            created_at,
            start_duration,
            task_duration,
            &creator_address,
            CampaignType::Raffle,
            maximum_amount,
            updated_deposits,
            CampaignStatus::Active, // campaign is Active during ticket sales
            reward_count,
            randomness_hash,
            &summary,
            ticket_price,
        );
        let updated_campaign_output = CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + updated_deposits)))
            .lock(creator_lock.clone())
            .type_(Some(campaign_type_script.clone()).pack())
            .build();
        let depositor_change_output = CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY - ticket_price)))
            .lock(participant_lock.clone())
            .build();

        let campaign_tx_hash: [u8; 32] = campaign_out_point
            .tx_hash()
            .as_slice()
            .try_into()
            .expect("campaign tx hash bytes");
        let campaign_index = u32::from_le_bytes(
            campaign_out_point
                .index()
                .as_slice()
                .try_into()
                .expect("campaign index bytes"),
        );
        let participant_data = build_participant_bytes(
            &creator_address,
            created_at,
            CampaignType::Raffle,
            &participant_address,
            joined_at,
            ParticipantStatus::Verified,
            ticket_price,
        );
        let participant_output = CellOutput::new_builder()
            .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
            .lock(participant_lock.clone())
            .build();

        let entry_tx = TransactionBuilder::default()
            .inputs(vec![
                CellInput::new_builder()
                    .previous_output(campaign_out_point.clone())
                    .build(),
                CellInput::new_builder()
                    .previous_output(depositor_funding_out_point)
                    .build(),
            ])
            .header_dep(header_hash)
            .outputs(vec![
                updated_campaign_output.clone(),
                depositor_change_output,
                participant_output.clone(),
            ])
            .outputs_data(vec![updated_campaign_data.clone(), Bytes::new(), participant_data.clone()].pack())
            .witnesses(vec![
                witness_with_output_type(vec![3u8]).as_bytes().pack(),
                Bytes::new().pack(),
            ])
            .build();
        let entry_tx = context.complete_tx(entry_tx);
        context
            .verify_tx(&entry_tx, 10_000_000)
            .unwrap_or_else(|err| panic!("raffle entry {} should pass: {:?}", index + 1, err));

        context.create_cell_with_out_point(
            campaign_out_point.clone(),
            updated_campaign_output,
            updated_campaign_data,
        );

        let participant_out_point = OutPoint::new_builder()
            .tx_hash(entry_tx.hash())
            .index(2u32)
            .build();
        context.create_cell_with_out_point(
            participant_out_point.clone(),
            participant_output,
            participant_data,
        );
        participants.push(RaffleParticipant {
            address: participant_address,
            joined_at,
            input_capacity: DEFAULT_CAPACITY,
            cell_out_point: participant_out_point,
        });
        current_deposits = updated_deposits;
    }

    assert_eq!(current_deposits, 300, "expected three ticket purchases");

    // 5. Advance status to Completed.
    let completed_timestamp = created_at + (start_duration + task_duration) * 1_000 + 1_000;
    let completed_header_hash = insert_header(&mut context, completed_timestamp);
    let completed_campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::Raffle,
        maximum_amount,
        current_deposits,
        CampaignStatus::Completed,
        reward_count,
        randomness_hash,
        &summary,
        ticket_price,
    );
    let completed_campaign_output = CellOutput::new_builder()
        .capacity(Pack::<Uint64>::pack(&(DEFAULT_CAPACITY + current_deposits)))
        .lock(creator_lock.clone())
        .type_(Some(campaign_type_script.clone()).pack())
        .build();
    let complete_tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(campaign_out_point.clone())
                .build(),
        )
        .header_dep(completed_header_hash)
        .outputs(vec![completed_campaign_output.clone()])
        .outputs_data(vec![completed_campaign_data.clone()].pack())
        .witness(witness_with_output_type(vec![4u8]).as_bytes().pack())
        .build();
    let complete_tx = context.complete_tx(complete_tx);
    context
        .verify_tx(&complete_tx, 10_000_000)
        .expect("update to completed should pass");
    context.create_cell_with_out_point(
        campaign_out_point.clone(),
        completed_campaign_output,
        completed_campaign_data,
    );

    // 6. Batch deliver deterministic raffle winners.
    let campaign_tx_hash: [u8; 32] = campaign_out_point
        .tx_hash()
        .as_slice()
        .try_into()
        .expect("campaign tx hash bytes");
    let campaign_index = u32::from_le_bytes(
        campaign_out_point
            .index()
            .as_slice()
            .try_into()
            .expect("campaign index bytes"),
    );
    let winners = deterministic_winners(
        &participants,
        reward_count as usize,
        randomness_preimage,
        campaign_tx_hash,
        campaign_index,
    );
    assert_eq!(winners.len(), reward_count as usize, "winner count should match reward count");

    let reward_per_winner = current_deposits / reward_count;
    let delivered_campaign_data = build_campaign_bytes(
        created_at,
        start_duration,
        task_duration,
        &creator_address,
        CampaignType::Raffle,
        maximum_amount,
        0,
        CampaignStatus::Completed,
        reward_count,
        randomness_hash,
        &summary,
        ticket_price,
    );
    let delivered_campaign_output = CellOutput::new_builder()
        .capacity(Pack::<Uint64>::pack(&DEFAULT_CAPACITY))
        .lock(creator_lock.clone())
        .type_(Some(campaign_type_script.clone()).pack())
        .build();

    let mut deliver_inputs = vec![
        CellInput::new_builder()
            .previous_output(campaign_out_point.clone())
            .build(),
    ];
    for participant in &participants {
        deliver_inputs.push(
            CellInput::new_builder()
                .previous_output(participant.cell_out_point.clone())
                .build(),
        );
    }

    let mut deliver_outputs = vec![delivered_campaign_output.clone()];
    let mut deliver_outputs_data = vec![delivered_campaign_data.clone()];
    for winner in &winners {
        let winner_lock = context
            .build_script(&always_success_out_point, Bytes::from(winner.address.to_vec()))
            .expect("build winner lock");
        deliver_outputs.push(
            CellOutput::new_builder()
                .capacity(Pack::<Uint64>::pack(&(winner.input_capacity + reward_per_winner)))
                .lock(winner_lock)
                .build(),
        );
        deliver_outputs_data.push(build_participant_bytes(
            &creator_address,
            created_at,
            CampaignType::Raffle,
            &winner.address,
            winner.joined_at,
            ParticipantStatus::Rewarded,
            ticket_price,
        ));
    }

    let deliver_header_hash = insert_header(&mut context, completed_timestamp + 1_000);
    let deliver_tx = TransactionBuilder::default()
        .inputs(deliver_inputs)
        .header_dep(deliver_header_hash)
        .outputs(deliver_outputs)
        .outputs_data(deliver_outputs_data.pack())
        .witness(witness_with_output_type({
            let mut bytes = vec![2u8];
            bytes.extend_from_slice(&randomness_preimage);
            bytes
        }).as_bytes().pack())
        .build();
    let deliver_tx = context.complete_tx(deliver_tx);
    context
        .verify_tx(&deliver_tx, 10_000_000)
        .expect("raffle batch deliver should pass");
}
