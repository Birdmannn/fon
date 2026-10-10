use super::*;
use freight::gifts::{parse_policy, GiftPolicy, GiftSlot};

const CREATED: u64 = 1_700_000_000_000;
const CKB: u64 = 100_000_000;

fn policy_bytes(policy: &GiftPolicy) -> Vec<u8> {
    let mut bytes = b"GFT1".to_vec();
    bytes.extend_from_slice(&[policy.open as u8, policy.slots.len() as u8]);
    bytes.extend_from_slice(&policy.creator);
    for slot in &policy.slots {
        bytes.extend_from_slice(&slot.claimant);
        bytes.extend_from_slice(&slot.amount.to_le_bytes());
        bytes.push(slot.claimed as u8);
    }
    bytes
}

fn campaign_bytes(
    policy: &GiftPolicy,
    balance: u64,
    status: CampaignStatus,
    approval: bool,
) -> Bytes {
    let mut data = build_campaign_bytes(
        CREATED,
        60,
        60,
        &address_from(CREATOR),
        CampaignType::FundedTask,
        300 * CKB,
        balance,
        status,
        2,
        [0; 32],
        &default_summary(),
        0,
    )
    .to_vec();
    if approval {
        data.extend_from_slice(b"APV1");
        data.extend_from_slice(&[3, 1, 1, 0]);
        data.extend_from_slice(&policy.creator);
        data.push(0);
    }
    data.extend_from_slice(&policy_bytes(policy));
    Bytes::from(data)
}

#[derive(Default)]
struct Scenario {
    open: bool,
    outsider: bool,
    replay: bool,
    wrong_recipient: bool,
    tamper_amount: bool,
    clone_output: bool,
    cross_campaign: bool,
    forge_state_signer: bool,
    no_marker: bool,
    recycled_payout: bool,
    data_input: bool,
    pending_approval: bool,
    underfunded: bool,
    early: bool,
    wrong_slot: bool,
    cancelled: bool,
    excess_fee: bool,
    with_fee: bool,
    action: Option<u8>,
    final_claim: bool,
}

fn run(s: Scenario) -> Result<(), String> {
    let mut context = Context::default();
    let freight = context.deploy_cell_by_name("freight");
    let success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let creator = context
        .build_script(&success, Bytes::from(address_from(CREATOR).to_vec()))
        .unwrap();
    let alice = context
        .build_script(&success, Bytes::from(address_from(DEPOSITOR).to_vec()))
        .unwrap();
    let bob = context
        .build_script(&success, Bytes::from(address_from(55).to_vec()))
        .unwrap();
    let state = context
        .build_script(
            &freight,
            Bytes::from([vec![255], address_from(CREATOR).to_vec()].concat()),
        )
        .unwrap();
    let actor = if s.action == Some(6) || s.action == Some(8) {
        creator.clone()
    } else if s.forge_state_signer {
        state.clone()
    } else if s.outsider {
        bob.clone()
    } else {
        alice.clone()
    };
    let alice_hash: [u8; 32] = if s.forge_state_signer {
        state.calc_script_hash().as_slice().try_into().unwrap()
    } else {
        alice.calc_script_hash().as_slice().try_into().unwrap()
    };
    let actor_hash: [u8; 32] = actor.calc_script_hash().as_slice().try_into().unwrap();
    let mut initial = GiftPolicy {
        creator: creator.calc_script_hash().as_slice().try_into().unwrap(),
        open: s.open,
        slots: vec![
            GiftSlot {
                claimant: if s.open { [0; 32] } else { alice_hash },
                amount: 100 * CKB,
                claimed: false,
            },
            GiftSlot {
                claimant: if s.open {
                    [0; 32]
                } else {
                    bob.calc_script_hash().as_slice().try_into().unwrap()
                },
                amount: 200 * CKB,
                claimed: false,
            },
        ],
    };
    if s.open {
        initial.slots[0].amount = 150 * CKB;
        initial.slots[1].amount = 150 * CKB;
    }
    let mut args = vec![0];
    args.extend_from_slice(&60u64.to_le_bytes());
    args.extend_from_slice(&60u64.to_le_bytes());
    args.push(CampaignType::FundedTask as u8);
    args.extend_from_slice(&(300 * CKB).to_le_bytes());
    args.extend_from_slice(&0u64.to_le_bytes());
    args.extend_from_slice(&[0; 32]);
    args.extend_from_slice(&2u64.to_le_bytes());
    args.extend_from_slice(&0u64.to_le_bytes());
    args.extend_from_slice(&0u64.to_le_bytes());
    if s.pending_approval {
        args.extend_from_slice(b"APV1");
        args.extend_from_slice(&[3, 1, 1, 0]);
        args.extend_from_slice(&initial.creator);
        args.push(0);
    }
    args.extend_from_slice(&policy_bytes(&initial));
    let type_script = context
        .build_script(&freight, Bytes::from(args.clone()))
        .unwrap();
    if s.replay || s.final_claim {
        let old_index = if s.final_claim { 1 } else { 0 };
        initial.slots[old_index].claimed = true;
        if s.open {
            initial.slots[old_index].claimant = if s.final_claim {
                bob.calc_script_hash().as_slice().try_into().unwrap()
            } else {
                actor_hash
            };
        }
    }
    let action = s.action.unwrap_or(15);
    let slot = if s.wrong_slot { 1 } else { 0 };
    let amount = if action == 8 {
        300 * CKB
    } else {
        initial.slots[slot].amount
    };
    let balance = if s.underfunded {
        250 * CKB
    } else if s.final_claim {
        100 * CKB
    } else {
        300 * CKB
    };
    let status = if s.cancelled {
        CampaignStatus::Cancelled
    } else {
        CampaignStatus::Created
    };
    let input = context.create_cell(
        CellOutput::new_builder()
            .capacity::<Uint64>((2000 * CKB + balance).pack())
            .lock(state.clone())
            .type_(Some(type_script.clone()).pack())
            .build(),
        campaign_bytes(&initial, balance, status, s.pending_approval),
    );
    let wallet_capacity = 1000 * CKB;
    let wallet = context.create_cell(
        CellOutput::new_builder()
            .capacity::<Uint64>(wallet_capacity.pack())
            .lock(actor.clone())
            .build(),
        if s.data_input {
            Bytes::from(vec![1; 64])
        } else {
            Bytes::new()
        },
    );
    let mut out = initial.clone();
    if action == 15 && !s.no_marker {
        out.slots[slot].claimed = true;
        out.slots[slot].claimant = actor_hash;
    }
    if s.tamper_amount {
        out.slots[0].amount += CKB;
        out.slots[1].amount -= CKB;
    }
    let paid = if action == 15 || action == 8 {
        amount
    } else {
        0
    };
    let output_status = if action == 6 {
        CampaignStatus::Cancelled
    } else if action == 15 {
        if out.slots.iter().all(|slot| slot.claimed) {
            CampaignStatus::Completed
        } else {
            CampaignStatus::Active
        }
    } else {
        status
    };
    let campaign_output = CellOutput::new_builder()
        .capacity::<Uint64>((2000 * CKB + balance - paid).pack())
        .lock(state.clone())
        .type_(Some(type_script.clone()).pack())
        .build();
    let campaign_data = campaign_bytes(&out, balance - paid, output_status, s.pending_approval);
    let fee = if s.excess_fee {
        2_000_000
    } else if s.with_fee {
        1000
    } else {
        0
    };
    let recipient = if s.wrong_recipient {
        bob.clone()
    } else {
        actor.clone()
    };
    let recipient_capacity = if s.recycled_payout {
        wallet_capacity
    } else {
        wallet_capacity + paid - fee
    };
    let mut outputs = vec![
        campaign_output.clone(),
        CellOutput::new_builder()
            .capacity::<Uint64>(recipient_capacity.pack())
            .lock(recipient)
            .build(),
    ];
    let mut data = vec![campaign_data.clone(), Bytes::new()];
    if s.recycled_payout {
        outputs.push(
            CellOutput::new_builder()
                .capacity::<Uint64>(paid.pack())
                .lock(bob.clone())
                .build(),
        );
        data.push(Bytes::new());
    }
    if s.clone_output {
        outputs.push(campaign_output.clone());
        data.push(campaign_data.clone());
    }
    if s.cross_campaign {
        let mut other_args = args;
        other_args[1] = 61;
        let other_type = context
            .build_script(&freight, Bytes::from(other_args))
            .unwrap();
        outputs.push(
            campaign_output
                .as_builder()
                .type_(Some(other_type).pack())
                .build(),
        );
        data.push(campaign_data);
    }
    let header = HeaderBuilder::default()
        .timestamp::<Uint64>((CREATED + if s.early { 59_999 } else { 120_001 }).pack())
        .build();
    context.insert_header(header.clone());
    let mut action_bytes = vec![action];
    if action == 15 {
        action_bytes.push(slot as u8);
        action_bytes.extend_from_slice(&actor_hash);
    }
    let witness = WitnessArgs::new_builder()
        .output_type(Some(Bytes::from(action_bytes)).pack())
        .build();
    let tx = TransactionBuilder::default()
        .inputs(vec![
            CellInput::new_builder().previous_output(input).build(),
            CellInput::new_builder().previous_output(wallet).build(),
        ])
        .outputs(outputs)
        .outputs_data(data.pack())
        .header_dep(header.hash())
        .witness(witness.as_bytes().pack())
        .build();
    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, 100_000_000)
        .map(|_| ())
        .map_err(|error| format!("{error:?}"))
}

#[test]
fn gift_claim_pays_fixed_allocation_and_final_claim_completes() {
    assert!(run(Scenario::default()).is_ok());
    assert!(run(Scenario {
        final_claim: true,
        ..Default::default()
    })
    .is_ok());
    assert!(run(Scenario {
        with_fee: true,
        ..Default::default()
    })
    .is_ok());
}
#[test]
fn gift_claim_requires_tagged_signed_wallet_and_cannot_repeat() {
    for s in [
        Scenario {
            outsider: true,
            ..Default::default()
        },
        Scenario {
            wrong_slot: true,
            ..Default::default()
        },
        Scenario {
            replay: true,
            ..Default::default()
        },
        Scenario {
            forge_state_signer: true,
            ..Default::default()
        },
    ] {
        assert!(run(s).is_err());
    }
}
#[test]
fn gift_open_claim_records_wallet_and_prevents_second_slot_claim() {
    assert!(run(Scenario {
        open: true,
        outsider: true,
        ..Default::default()
    })
    .is_ok());
    assert!(run(Scenario {
        open: true,
        replay: true,
        wrong_slot: true,
        ..Default::default()
    })
    .is_err());
}
#[test]
fn gift_claim_rejects_redirected_recycled_or_mutated_payouts() {
    for s in [
        Scenario {
            wrong_recipient: true,
            ..Default::default()
        },
        Scenario {
            recycled_payout: true,
            ..Default::default()
        },
        Scenario {
            recycled_payout: true,
            data_input: true,
            ..Default::default()
        },
        Scenario {
            tamper_amount: true,
            ..Default::default()
        },
        Scenario {
            no_marker: true,
            ..Default::default()
        },
        Scenario {
            excess_fee: true,
            ..Default::default()
        },
    ] {
        assert!(run(s).is_err());
    }
}
#[test]
fn gift_claim_requires_start_time_funding_approval_and_live_status() {
    for s in [
        Scenario {
            early: true,
            ..Default::default()
        },
        Scenario {
            underfunded: true,
            ..Default::default()
        },
        Scenario {
            pending_approval: true,
            ..Default::default()
        },
        Scenario {
            cancelled: true,
            ..Default::default()
        },
    ] {
        assert!(run(s).is_err());
    }
}
#[test]
fn gift_claim_rejects_clones_and_multiple_campaign_groups() {
    assert!(run(Scenario {
        clone_output: true,
        ..Default::default()
    })
    .is_err());
    assert!(run(Scenario {
        cross_campaign: true,
        ..Default::default()
    })
    .is_err());
}
#[test]
fn gift_blocks_legacy_distribution_and_withdrawal_before_cancel() {
    for action in [2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14] {
        assert!(run(Scenario {
            action: Some(action),
            ..Default::default()
        })
        .is_err());
    }
    assert!(run(Scenario {
        action: Some(6),
        ..Default::default()
    })
    .is_ok());
    assert!(run(Scenario {
        action: Some(8),
        cancelled: true,
        ..Default::default()
    })
    .is_ok());
}
#[test]
fn gift_policy_creation_rejects_invalid_totals_duplicates_and_preclaims() {
    let policy = GiftPolicy {
        creator: [1; 32],
        open: false,
        slots: vec![
            GiftSlot {
                claimant: [2; 32],
                amount: 10,
                claimed: false,
            },
            GiftSlot {
                claimant: [3; 32],
                amount: 20,
                claimed: false,
            },
        ],
    };
    assert!(policy
        .validate(CampaignType::FundedTask, 30, 2, true)
        .is_ok());
    assert_eq!(
        parse_policy(&policy_bytes(&policy)).unwrap(),
        Some(policy.clone())
    );
    assert!(policy.validate(CampaignType::Raffle, 30, 2, true).is_err());
    assert!(policy
        .validate(CampaignType::FundedTask, 29, 2, true)
        .is_err());
    let mut bad = policy.clone();
    bad.slots[1].claimant = bad.slots[0].claimant;
    assert!(bad.validate(CampaignType::FundedTask, 30, 2, true).is_err());
    bad = policy.clone();
    bad.slots[0].claimed = true;
    assert!(bad.validate(CampaignType::FundedTask, 30, 2, true).is_err());
    bad = policy;
    bad.open = true;
    assert!(bad.validate(CampaignType::FundedTask, 30, 2, true).is_err());
}

fn create_gift(
    preclaimed: bool,
    cloned: bool,
    with_approval: bool,
    wrong_lock: bool,
) -> Result<(), String> {
    let mut context = Context::default();
    let freight = context.deploy_cell_by_name("freight");
    let success = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let creator = context
        .build_script(&success, Bytes::from(address_from(CREATOR).to_vec()))
        .unwrap();
    let claimant = context
        .build_script(&success, Bytes::from(address_from(DEPOSITOR).to_vec()))
        .unwrap();
    let other = context
        .build_script(&success, Bytes::from(address_from(55).to_vec()))
        .unwrap();
    let policy = GiftPolicy {
        creator: creator.calc_script_hash().as_slice().try_into().unwrap(),
        open: false,
        slots: vec![
            GiftSlot {
                claimant: claimant.calc_script_hash().as_slice().try_into().unwrap(),
                amount: 100 * CKB,
                claimed: preclaimed,
            },
            GiftSlot {
                claimant: other.calc_script_hash().as_slice().try_into().unwrap(),
                amount: 200 * CKB,
                claimed: false,
            },
        ],
    };
    let mut args = vec![0];
    args.extend_from_slice(&60u64.to_le_bytes());
    args.extend_from_slice(&60u64.to_le_bytes());
    args.push(CampaignType::FundedTask as u8);
    args.extend_from_slice(&(300 * CKB).to_le_bytes());
    args.extend_from_slice(&0u64.to_le_bytes());
    args.extend_from_slice(&[0; 32]);
    args.extend_from_slice(&2u64.to_le_bytes());
    args.extend_from_slice(&0u64.to_le_bytes());
    args.extend_from_slice(&0u64.to_le_bytes());
    if with_approval {
        args.extend_from_slice(b"APV1");
        args.extend_from_slice(&[3, 1, 1, 0]);
        args.extend_from_slice(&policy.creator);
        args.push(0);
    }
    args.extend_from_slice(&policy_bytes(&policy));
    let type_script = context.build_script(&freight, Bytes::from(args)).unwrap();
    let state = context
        .build_script(
            &freight,
            Bytes::from([vec![255], address_from(CREATOR).to_vec()].concat()),
        )
        .unwrap();
    let input = context.create_cell(
        CellOutput::new_builder()
            .capacity::<Uint64>((10_000 * CKB).pack())
            .lock(creator.clone())
            .build(),
        Bytes::new(),
    );
    let output = CellOutput::new_builder()
        .capacity::<Uint64>((5000 * CKB).pack())
        .lock(if wrong_lock { creator } else { state })
        .type_(Some(type_script).pack())
        .build();
    let data = campaign_bytes(&policy, 0, CampaignStatus::Created, with_approval);
    let mut outputs = vec![output.clone()];
    let mut datas = vec![data.clone()];
    if cloned {
        outputs.push(output);
        datas.push(data);
    }
    let header = HeaderBuilder::default()
        .timestamp::<Uint64>(CREATED.pack())
        .build();
    context.insert_header(header.clone());
    let tx = TransactionBuilder::default()
        .input(CellInput::new_builder().previous_output(input).build())
        .outputs(outputs)
        .outputs_data(datas.pack())
        .header_dep(header.hash())
        .build();
    let tx = context.complete_tx(tx);
    context
        .verify_tx(&tx, 100_000_000)
        .map(|_| ())
        .map_err(|error| format!("{error:?}"))
}

#[test]
fn gift_creation_enforces_immutable_policy_initial_state_and_state_lock() {
    assert!(create_gift(false, false, false, false).is_ok());
    assert!(create_gift(false, false, true, false).is_ok());
    assert!(create_gift(true, false, false, false).is_err());
    assert!(create_gift(false, true, false, false).is_err());
    assert!(create_gift(false, false, false, true).is_err());
}
