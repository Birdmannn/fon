#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

use ckb_std::debug;
use ckb_std::high_level::load_script;
use freight::errors::Error;
use freight::instructions::*;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
// By default, the following heap configuration is used:
// * 16KB fixed heap
// * 1.2MB(rounded up to be 16-byte aligned) dynamic heap
// * Minimal memory block in dynamic heap is 64 bytes
// For more details, please refer to ckb-std's default_alloc macro
// and the buddy-alloc alloc implementation.
ckb_std::default_alloc!(16384, 1258306, 64);

/// Deploy this program with typescript (constructor) args: [admin address], [admin pubkey]
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

    // First byte of args the function selector
    let instruction = args[0];
    debug!("Instruction selector: {}", instruction);

    let instruction_args = &args[1..];
    match instruction {
        0 => create_campaign(instruction_args),
        1 => deposit(instruction_args),
        2 => distribute(instruction_args),
        3 => verify_participant(instruction_args),
        4 => update_campaign_status(instruction_args),
        _ => {
            debug!("Invalid instruction selector: {}", instruction);
            Err(Error::UnknownScriptArgs)
        }
    }
}
