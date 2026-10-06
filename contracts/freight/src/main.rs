#![cfg_attr(target_arch = "riscv64", no_std)]
#![cfg_attr(target_arch = "riscv64", no_main)]
#[cfg(not(target_arch = "riscv64"))]
extern crate alloc;

use ckb_std::debug;
use ckb_std::ckb_constants::Source;
// use ckb_std::ckb_types::prelude::Entity;
use ckb_std::error::SysError;
use ckb_std::high_level::{load_cell_data, load_cell_type, load_input, load_script, load_witness_args};
use freight::errors::Error;
use freight::instructions::*;

#[cfg(target_arch = "riscv64")]
ckb_std::entry!(program_entry);
#[cfg(target_arch = "riscv64")]
// By default, the following heap configuration is used:
// * 16KB fixed heap
// * 1.2MB(rounded up to be 16-byte aligned) dynamic heap
// * Minimal memory block in dynamic heap is 64 bytes
// For more details, please refer to ckb-std's default_alloc macro
// and the buddy-alloc alloc implementation.
ckb_std::default_alloc!(16384, 1258306, 64);

#[cfg(not(target_arch = "riscv64"))]
fn main() {}

pub fn program_entry() -> i8 {
    match run() {
        Ok(()) => 0,
        Err(e) => {
            debug!("Error occurred: {:?}", e);
            e as i8
        }
    }
}

fn run() -> Result<(), Error> {
    let script = load_script().map_err(|_| Error::LoadScriptFailed)?;
    let args = script.args().raw_data();
    if args.is_empty() {
        debug!("Script args are empty");
        return Err(Error::EmptyScriptArgs);
    }

    let instruction = args[0];

    // Selector 255 is the permissive state-cell lock used by new freight and
    // participant cells. It is only valid when this same binary is also
    // executing as a type script in the transaction, so the type transition
    // remains the authority over all state and funds.
    if instruction == 255 {
        let own_code_hash = script.code_hash();
        if args.len() != 21 && args.len() != 49 {
            return Err(Error::Unauthorized);
        }
        let mut index = 0;
        loop {
            match load_cell_type(index, Source::Input) {
                Ok(Some(type_script)) if type_script.code_hash() == own_code_hash => {
                    if args.len() == 21 {
                        return Ok(());
                    }
                    let data = load_cell_data(index, Source::Input)
                        .map_err(|_| Error::InvalidCellData)?;
                    if data.len() >= 44
                        && data[0..8] == args[21..29]
                        && data[24..44] == args[1..21]
                    {
                        return Ok(());
                    }
                    index += 1;
                }
                Ok(_) => index += 1,
                Err(SysError::IndexOutOfBound) => return Err(Error::Unauthorized),
                Err(err) => return Err(err.into()),
            }
        }
    }

    // Stable campaign cells keep selector 0 in the type args forever.
    // When such a cell is being spent, the real state-transition action is
    // passed in WitnessArgs.output_type of GroupInput[0].
    if instruction == 0 && has_group_input()? {
        let witness = load_witness_args(0, Source::GroupInput)
            .map_err(|_| Error::UnknownScriptArgs)?;
        let action = witness.output_type().to_opt().ok_or(Error::UnknownScriptArgs)?;
        let action_bytes = action.raw_data();
        if action_bytes.is_empty() {
            debug!("Witness output_type is empty for stable campaign transition");
            return Err(Error::UnknownScriptArgs);
        }

        let witness_instruction = action_bytes[0];
        debug!("Witness instruction selector: {}", witness_instruction);
        return dispatch_instruction(witness_instruction, &action_bytes[1..]);
    }

    debug!("Instruction selector: {}", instruction);
    dispatch_instruction(instruction, &args[1..])
}

fn has_group_input() -> Result<bool, Error> {
    match load_input(0, Source::GroupInput) {
        Ok(_) => Ok(true),
        Err(SysError::IndexOutOfBound) => Ok(false),
        Err(err) => Err(err.into()),
    }
}

fn dispatch_instruction(instruction: u8, instruction_args: &[u8]) -> Result<(), Error> {
    match instruction {
        0 => create_campaign(instruction_args),
        1 => deposit(instruction_args),
        2 => batch_deliver(instruction_args),
        3 => verify_participant(instruction_args),
        4 => update_campaign_status(instruction_args),
        5 => submit_randomness_hash(instruction_args),
        6 => cancel_campaign(instruction_args),
        7 => refund(instruction_args),
        8 => creator_withdraw(instruction_args),
        9 => draw_recurring_raffle(instruction_args),
        10 => claim_recurring_raffle(instruction_args),
        11 => rollover_recurring_raffle(instruction_args),
        12 => reclaim_recurring_participant(instruction_args),
        _ => {
            debug!("Invalid instruction selector: {}", instruction);
            Err(Error::UnknownScriptArgs)
        }
    }
}
