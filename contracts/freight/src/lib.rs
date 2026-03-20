#![cfg_attr(not(feature = "library"), no_std)]
#![allow(special_module_name)]
#![allow(unused_attributes)]

pub mod errors;
pub mod instructions;
pub mod types;
pub mod utils;
pub mod validations;

extern crate alloc;
