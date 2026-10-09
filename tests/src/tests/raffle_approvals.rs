use super::*;
use freight::approvals::{RaffleApproval, check_transition, parse_approval};
use freight::errors::Error;

const CREATED: u64 = 1_700_000_000_000;
const DEADLINE: u64 = CREATED + 60_000;

fn gate(
    stage: u8,
    required: u8,
    approved: &[bool],
    confirmed: bool,
    hashes: &[[u8; 32]],
) -> Vec<u8> {
    let mut bytes = b"APV1".to_vec();
    bytes.extend_from_slice(&[stage, required, approved.len() as u8, confirmed as u8]);
    for (hash, flag) in hashes.iter().zip(approved) {
        bytes.extend_from_slice(hash);
        bytes.push(*flag as u8);
    }
    bytes
}

fn campaign_bytes(approval: &[u8], status: CampaignStatus) -> Bytes {
    let mut bytes = build_campaign_bytes(
        CREATED,
        60,
        60,
        &address_from(CREATOR),
        if approval.get(4) == Some(&3) {
            CampaignType::FundedTask
        } else {
            CampaignType::Raffle
        },
        1000,
        0,
        status,
        1,
        [0; 32],
        &default_summary(),
        100,
    )
    .to_vec();
    bytes.extend_from_slice(approval);
    Bytes::from(bytes)
}

// Runs the real RISC-V type script. Inclusion time and caller-supplied tip time
// deliberately differ to exercise attempts to use stale header dependencies.
fn run_transition(
    stage: u8,
    flags: &[bool],
    confirmed: bool,
    instruction: Vec<u8>,
    tip_time: u64,
    inclusion_time: Option<u64>,
    caller: u8,
    output_flags: &[bool],
    output_confirmed: bool,
    output_status: CampaignStatus,
) -> Result<(), String> {
    run_transition_with_clone(
        stage,
        flags,
        confirmed,
        instruction,
        tip_time,
        inclusion_time,
        caller,
        output_flags,
        output_confirmed,
        output_status,
        false,
    )
}

fn run_transition_with_clone(
    stage: u8,
    flags: &[bool],
    confirmed: bool,
    instruction: Vec<u8>,
    tip_time: u64,
    inclusion_time: Option<u64>,
    caller: u8,
    output_flags: &[bool],
    output_confirmed: bool,
    output_status: CampaignStatus,
    extra_output: bool,
) -> Result<(), String> {
    let mut context = Context::default();
    let freight = context.deploy_cell_by_name("freight");
    let success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let approver = context
        .build_script(&success, Bytes::from(address_from(DEPOSITOR).to_vec()))
        .unwrap();
    let other = context
        .build_script(&success, Bytes::from(address_from(55).to_vec()))
        .unwrap();
    let creator = context
        .build_script(&success, Bytes::from(address_from(CREATOR).to_vec()))
        .unwrap();
    let wallet = context
        .build_script(&success, Bytes::from(address_from(caller).to_vec()))
        .unwrap();
    let hashes = [
        approver.calc_script_hash().unpack(),
        other.calc_script_hash().unpack(),
    ];
    let input_gate = gate(stage, flags.len() as u8, flags, confirmed, &hashes);
    let output_gate = gate(
        stage,
        flags.len() as u8,
        output_flags,
        output_confirmed,
        &hashes,
    );
    let type_script = context
        .build_script(&freight, Bytes::from(vec![0]))
        .unwrap();
    let output = CellOutput::new_builder()
        .capacity(DEFAULT_CAPACITY)
        .lock(creator.clone())
        .type_(Some(type_script).pack())
        .build();
    let campaign = context.create_cell(
        output.clone(),
        campaign_bytes(&input_gate, CampaignStatus::Created),
    );
    let fee = context.create_cell(
        CellOutput::new_builder()
            .capacity(DEFAULT_CAPACITY)
            .lock(wallet)
            .build(),
        Bytes::new(),
    );
    let tip = insert_header(&mut context, tip_time);
    let mut header_deps = vec![tip];
    if let Some(time) = inclusion_time {
        let inclusion = insert_header(&mut context, time);
        context.link_cell_with_block(campaign.clone(), inclusion.clone(), 0);
        if !header_deps.contains(&inclusion) {
            header_deps.push(inclusion);
        }
    } else {
        let inclusion = insert_header(&mut context, CREATED);
        context.link_cell_with_block(campaign.clone(), inclusion, 0);
    }
    let witness = WitnessArgs::new_builder()
        .output_type(Some(Bytes::from(instruction)).pack())
        .build();
    let mut outputs = vec![output.clone()];
    let mut outputs_data = vec![campaign_bytes(&output_gate, output_status)];
    if extra_output {
        outputs.push(output);
        outputs_data.push(campaign_bytes(
            &gate(
                stage,
                flags.len() as u8,
                &vec![true; flags.len()],
                true,
                &hashes,
            ),
            output_status,
        ));
    }
    let tx = TransactionBuilder::default()
        .inputs(vec![
            CellInput::new_builder().previous_output(campaign).build(),
            CellInput::new_builder().previous_output(fee).build(),
        ])
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .header_deps(header_deps)
        .witnesses(vec![witness.as_bytes().pack(), Bytes::new().pack()])
        .build();
    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, 20_000_000)
        .map(|_| ())
        .map_err(|error| format!("{error:?}"))
}

#[test]
fn raffle_approval_requires_the_tagged_wallet_and_preserves_other_votes() {
    assert!(
        run_transition(
            1,
            &[false, false],
            false,
            vec![13, 0],
            CREATED + 1000,
            None,
            DEPOSITOR,
            &[true, false],
            false,
            CampaignStatus::Created
        )
        .is_ok()
    );
    assert!(
        run_transition(
            1,
            &[false, false],
            false,
            vec![13, 0],
            CREATED + 1000,
            None,
            CREATOR,
            &[true, false],
            false,
            CampaignStatus::Created
        )
        .is_err()
    );
    assert!(
        run_transition(
            1,
            &[false, false],
            false,
            vec![13, 0],
            CREATED + 1000,
            None,
            DEPOSITOR,
            &[true, true],
            false,
            CampaignStatus::Created
        )
        .is_err()
    );
    assert!(
        run_transition(
            1,
            &[true, false],
            false,
            vec![13, 0],
            CREATED + 1000,
            None,
            DEPOSITOR,
            &[true, false],
            false,
            CampaignStatus::Created
        )
        .is_err()
    );
}

#[test]
fn commencement_uses_actual_vote_inclusion_time_not_a_stale_tip() {
    // Quorum recorded before the deadline can be proven later.
    assert!(
        run_transition(
            1,
            &[true],
            false,
            vec![14],
            DEADLINE + 1000,
            Some(DEADLINE - 1),
            CREATOR,
            &[true],
            true,
            CampaignStatus::Created
        )
        .is_ok()
    );
    // A late quorum cannot be enabled, including at the exact deadline.
    for inclusion in [DEADLINE, DEADLINE + 1000] {
        assert!(
            run_transition(
                1,
                &[true],
                false,
                vec![14],
                CREATED + 1,
                Some(inclusion),
                CREATOR,
                &[true],
                true,
                CampaignStatus::Created
            )
            .is_err()
        );
    }
    assert!(
        run_transition(
            1,
            &[true],
            false,
            vec![14],
            CREATED + 1,
            None,
            CREATOR,
            &[true],
            true,
            CampaignStatus::Created
        )
        .is_err()
    );
    assert!(
        run_transition(
            1,
            &[false],
            false,
            vec![13, 0],
            DEADLINE,
            None,
            DEPOSITOR,
            &[true],
            false,
            CampaignStatus::Created
        )
        .is_err()
    );
}

#[test]
fn missing_quorum_blocks_economic_actions_and_allows_creator_cancellation() {
    for instruction in [1, 2, 3, 4, 5, 8, 9, 10, 11, 12] {
        assert!(
            run_transition(
                1,
                &[false],
                false,
                vec![instruction],
                CREATED + 1,
                None,
                CREATOR,
                &[false],
                false,
                CampaignStatus::Created
            )
            .is_err()
        );
    }
    assert!(
        run_transition(
            1,
            &[false],
            false,
            vec![6],
            DEADLINE,
            None,
            CREATOR,
            &[false],
            false,
            CampaignStatus::Cancelled
        )
        .is_ok()
    );
    assert!(
        run_transition(
            1,
            &[false],
            false,
            vec![6],
            DEADLINE,
            None,
            DEPOSITOR,
            &[false],
            false,
            CampaignStatus::Cancelled
        )
        .is_err()
    );
}

#[test]
fn delivery_gate_blocks_distribution_and_escrow_withdrawal() {
    for instruction in [2, 8] {
        assert!(
            run_transition(
                2,
                &[true, false],
                false,
                vec![instruction],
                DEADLINE + 1000,
                None,
                CREATOR,
                &[true, false],
                false,
                CampaignStatus::Created
            )
            .is_err()
        );
    }
    assert!(
        run_transition(
            2,
            &[true, false],
            false,
            vec![13, 1],
            DEADLINE + 1000,
            None,
            55,
            &[true, true],
            false,
            CampaignStatus::Created
        )
        .is_ok()
    );
}

#[test]
fn approval_configuration_and_recurring_round_rules() {
    let mut approval = RaffleApproval {
        stage: 1,
        required: 1,
        confirmed: false,
        approvers: vec![([1; 32], false)],
    };
    assert!(approval.validate(CampaignType::Raffle, 0).is_err());
    assert!(approval.validate(CampaignType::RecurringRaffle, 60).is_ok());
    approval.stage = 2;
    assert!(
        approval
            .validate(CampaignType::RecurringRaffle, 60)
            .is_err()
    );
    assert!(approval.validate(CampaignType::Raffle, 0).is_ok());
    approval.approvers.push(([2; 32], false));
    assert!(approval.validate(CampaignType::Raffle, 0).is_err());
    approval.stage = 1;
    approval.approvers[0].1 = true;
    approval.confirmed = true;
    let mut campaign = freight::utils::parse_campaign_data(&campaign_bytes(
        &gate(1, 1, &[true], true, &[[1; 32]]),
        CampaignStatus::Active,
    ))
    .unwrap();
    campaign.campaign_type = CampaignType::RecurringRaffle;
    campaign.approval = Some(approval);
    for action in [3, 4, 9, 10, 11] {
        assert!(check_transition(&campaign, action, DEADLINE + 1_000_000).is_ok());
    }
    campaign.approval.as_mut().unwrap().confirmed = false;
    assert_eq!(
        check_transition(&campaign, 9, DEADLINE),
        Err(Error::ApprovalDeadlineMissed)
    );
    campaign.status = CampaignStatus::Cancelled;
    for action in [7, 8] {
        assert!(check_transition(&campaign, action, DEADLINE).is_ok());
    }
    for action in [1, 2, 3, 4, 9, 10, 11, 13, 14] {
        assert_eq!(
            check_transition(&campaign, action, DEADLINE),
            Err(Error::InvalidOperation)
        );
    }
    campaign.status = CampaignStatus::Completed;
    campaign.campaign_type = CampaignType::Raffle;
    campaign.approval = Some(RaffleApproval {
        stage: 2,
        required: 2,
        confirmed: false,
        approvers: vec![([1; 32], true), ([2; 32], true)],
    });
    assert!(check_transition(&campaign, 2, DEADLINE + 1_000_000).is_ok());
    campaign.approval.as_mut().unwrap().approvers[1].1 = false;
    assert_eq!(
        check_transition(&campaign, 2, DEADLINE + 1_000_000),
        Err(Error::ApprovalRequired)
    );
    assert!(parse_approval(b"APV1").is_err());
}

fn run_create(
    kind: CampaignType,
    stage: u8,
    delay: u64,
    required: u8,
    approved: &[bool],
    confirmed: bool,
) -> Result<(), String> {
    let mut context = Context::default();
    let freight = context.deploy_cell_by_name("freight");
    let success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let creator_address = address_from(CREATOR);
    let creator = context
        .build_script(&success, Bytes::from(creator_address.to_vec()))
        .unwrap();
    let approver = context
        .build_script(&success, Bytes::from(address_from(DEPOSITOR).to_vec()))
        .unwrap();
    let other = context
        .build_script(&success, Bytes::from(address_from(55).to_vec()))
        .unwrap();
    let hashes = [
        approver.calc_script_hash().unpack(),
        other.calc_script_hash().unpack(),
    ];
    let approval = gate(stage, required, approved, confirmed, &hashes);
    let mut args = build_create_campaign_script_args(delay, 60, kind, 1000, 100).to_vec();
    args.extend_from_slice(
        &(if kind == CampaignType::FundedTask {
            0u64
        } else {
            1u64
        })
        .to_le_bytes(),
    );
    if kind == CampaignType::RecurringRaffle {
        args.extend_from_slice(&60u64.to_le_bytes());
        args.extend_from_slice(&5000u64.to_le_bytes());
    }
    args.extend_from_slice(&approval);
    let type_script = context.build_script(&freight, Bytes::from(args)).unwrap();
    let mut lock_args = vec![255];
    lock_args.extend_from_slice(&creator_address);
    let state_lock = context
        .build_script(&freight, Bytes::from(lock_args))
        .unwrap();
    let mut bytes = build_campaign_bytes(
        CREATED,
        delay,
        60,
        &creator_address,
        kind,
        1000,
        0,
        CampaignStatus::Created,
        0,
        [0; 32],
        &default_summary(),
        100,
    )
    .to_vec();
    if kind == CampaignType::RecurringRaffle {
        for value in [60u64, 5000, 1, CREATED + delay * 1000, 0, 0, 0] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    bytes.extend_from_slice(&approval);
    let input = context.create_cell(
        CellOutput::new_builder()
            .capacity(DEFAULT_CAPACITY * 2)
            .lock(creator)
            .build(),
        Bytes::new(),
    );
    let header = insert_header(&mut context, CREATED);
    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(input).build())
        .output(
            CellOutput::new_builder()
                .capacity(DEFAULT_CAPACITY)
                .lock(state_lock)
                .type_(Some(type_script).pack())
                .build(),
        )
        .output_data(Bytes::from(bytes).pack())
        .header_dep(header)
        .build();
    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, 20_000_000)
        .map(|_| ())
        .map_err(|error| format!("{error:?}"))
}

#[test]
fn gated_raffle_creation_validates_stage_delay_threshold_and_initial_votes() {
    assert!(run_create(CampaignType::Raffle, 1, u64::MAX, 1, &[false], false).is_err());
    assert!(run_create(CampaignType::Raffle, 1, 60, 1, &[false, false], false).is_ok());
    assert!(
        run_create(
            CampaignType::RecurringRaffle,
            1,
            60,
            1,
            &[false, false],
            false
        )
        .is_ok()
    );
    assert!(run_create(CampaignType::Raffle, 2, 0, 2, &[false, false], false).is_ok());
    assert!(run_create(CampaignType::Raffle, 1, 0, 1, &[false], false).is_err());
    assert!(run_create(CampaignType::RecurringRaffle, 2, 60, 1, &[false], false).is_err());
    assert!(run_create(CampaignType::Raffle, 2, 0, 1, &[false, false], false).is_err());
    assert!(run_create(CampaignType::Raffle, 1, 60, 1, &[true], false).is_err());
    assert!(run_create(CampaignType::Raffle, 1, 60, 1, &[false], true).is_err());
}

#[test]
fn approval_transition_cannot_create_a_clone_with_forged_votes() {
    assert!(
        run_transition_with_clone(
            1,
            &[false],
            false,
            vec![13, 0],
            CREATED + 1,
            None,
            DEPOSITOR,
            &[true],
            false,
            CampaignStatus::Created,
            true
        )
        .is_err()
    );
}

#[test]
fn gift_approval_creation_preserves_all_and_threshold_rules_without_raffle_deadlines() {
    assert!(run_create(CampaignType::FundedTask, 3, 0, 1, &[false, false], false).is_ok());
    assert!(run_create(CampaignType::FundedTask, 3, 60, 2, &[false, false], false).is_ok());
    assert!(run_create(CampaignType::FundedTask, 1, 60, 1, &[false], false).is_err());
    assert!(run_create(CampaignType::Raffle, 3, 60, 1, &[false], false).is_err());
    assert!(run_create(CampaignType::FundedTask, 3, 60, 1, &[true], false).is_err());
}

#[test]
fn gift_approvals_require_real_approvers_and_can_arrive_after_the_start_delay() {
    assert!(
        run_transition(
            3,
            &[false, false],
            false,
            vec![13, 0],
            DEADLINE + 1,
            None,
            DEPOSITOR,
            &[true, false],
            false,
            CampaignStatus::Created
        )
        .is_ok()
    );
    assert!(
        run_transition(
            3,
            &[true, false],
            false,
            vec![13, 1],
            DEADLINE + 2,
            None,
            55,
            &[true, true],
            false,
            CampaignStatus::Created
        )
        .is_ok()
    );
    assert!(
        run_transition(
            3,
            &[false],
            false,
            vec![13, 0],
            DEADLINE + 1,
            None,
            CREATOR,
            &[true],
            false,
            CampaignStatus::Created
        )
        .is_err()
    );
    assert!(
        run_transition(
            3,
            &[false, false],
            false,
            vec![13, 0],
            DEADLINE + 1,
            None,
            DEPOSITOR,
            &[true, true],
            false,
            CampaignStatus::Created
        )
        .is_err()
    );
    assert!(
        run_transition_with_clone(
            3,
            &[false],
            false,
            vec![13, 0],
            DEADLINE + 1,
            None,
            DEPOSITOR,
            &[true],
            false,
            CampaignStatus::Created,
            true
        )
        .is_err()
    );
}

#[test]
fn gift_commencement_and_payouts_need_quorum_and_cancellation_preserves_recovery() {
    for action in [2, 3, 4, 8] {
        assert!(
            run_transition(
                3,
                &[true, false],
                false,
                vec![action],
                DEADLINE + 1,
                None,
                CREATOR,
                &[true, false],
                false,
                CampaignStatus::Active
            )
            .is_err()
        );
    }
    assert!(
        run_transition(
            3,
            &[true, true],
            false,
            vec![4],
            DEADLINE + 1,
            None,
            CREATOR,
            &[true, true],
            false,
            CampaignStatus::Active
        )
        .is_ok()
    );
    assert!(
        run_transition(
            3,
            &[false],
            false,
            vec![6],
            DEADLINE + 1,
            None,
            CREATOR,
            &[false],
            false,
            CampaignStatus::Cancelled
        )
        .is_ok()
    );
    let mut data = freight::utils::parse_campaign_data(&campaign_bytes(
        &gate(3, 1, &[true, false], false, &[[1; 32], [2; 32]]),
        CampaignStatus::Created,
    ))
    .unwrap();
    assert!(data.approval.as_ref().unwrap().satisfied());
    for action in [1, 2, 3, 4, 8] {
        assert!(check_transition(&data, action, DEADLINE + 1).is_ok());
    }
    data.approval.as_mut().unwrap().approvers[0].1 = false;
    assert!(check_transition(&data, 1, DEADLINE + 1).is_ok()); // Gifts can still be funded.
    for action in [2, 3, 4, 8] {
        assert_eq!(
            check_transition(&data, action, DEADLINE + 1),
            Err(Error::ApprovalRequired)
        );
    }
    data.status = CampaignStatus::Cancelled;
    for action in [7, 8] {
        assert!(check_transition(&data, action, DEADLINE + 1).is_ok());
    }
}
