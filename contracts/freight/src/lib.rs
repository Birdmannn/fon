#![cfg_attr(not(feature = "library"), no_std)]
#![allow(special_module_name)]
#![allow(unused_attributes)]
#[cfg(feature = "library")]
mod main;
#[cfg(feature = "library")]
pub use main::program_entry;

pub mod errors;
pub mod instructions;
pub mod types;
pub mod utils;
pub mod validations;

extern crate alloc;
