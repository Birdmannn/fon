use ckb_std::error::SysError;

#[repr(i8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    IndexOutOfBound = 1,
    ItemMissing,
    LengthNotEnough,
    Encoding,
    Unauthorized,
    InvalidCampaignArgs,
    NoTimeStampAvailable,
    InvalidCampaignType,
    InvalidCellData,
    LoadScriptFailed,
    DepositorNotFound,
    EmptyScriptArgs,
    UnknownScriptArgs,
    InvalidDepositArgs,
    DepositNotCompleted,
    AmountMismatch,
    InsufficientBalance,
    InvalidVerificationArgs,
    VerificationNotCompleted,
    InvalidTypeScriptArgs,
    InvalidParticipantArgs,
    CampaignDataMismatch,
    InvalidOperation,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        match err {
            SysError::IndexOutOfBound => Self::IndexOutOfBound,
            SysError::ItemMissing => Self::ItemMissing,
            SysError::LengthNotEnough(_) => Self::LengthNotEnough,
            SysError::Encoding => Self::Encoding,
            SysError::Unknown(err_code) => panic!("unexpected sys error {}", err_code),
            _ => panic!("unexpected sys error {:?}", err),
        }
    }
}
