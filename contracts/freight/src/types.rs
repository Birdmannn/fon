// Campaign types that determine behavior
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CampaignType {
    SimpleTask = 0,     // No deposit required
    FundedTask = 1,     // Requires deposits to start
    Crowdfunding = 2,   // Deposit-based with funding goal
    TimedChallenge = 3, // Time-sensitive with deposits
}

impl TryFrom<u8> for CampaignType {
    type Error = u8;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(CampaignType::SimpleTask),
            1 => Ok(CampaignType::FundedTask),
            2 => Ok(CampaignType::Crowdfunding),
            3 => Ok(CampaignType::TimedChallenge),
            _ => Err(value),
        }
    }
}

// Campaign status tracking
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CampaignStatus {
    Created = 0,   // Just created, waiting for deposits/start time
    Active = 1,    // Started and running
    Completed = 2, // Duration elapsed
    Cancelled = 3, // Cancelled by creator
}

impl TryFrom<u8> for CampaignStatus {
    type Error = u8;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(CampaignStatus::Created),
            1 => Ok(CampaignStatus::Active),
            2 => Ok(CampaignStatus::Completed),
            3 => Ok(CampaignStatus::Cancelled),
            _ => Err(value),
        }
    }
}

// Enum for key, for extracting address from lock args
#[repr(u8)]
#[derive(Debug, Clone, PartialEq)]
pub enum AddressKey {
    Creator = 0,   // Address Key of the campaign creator
    Depositor = 1, // Address Key of the depositor
    Admin = 2,     // Address Key of the admin (for distribution)
}

// Campaign data structure (stored in cell data)
#[derive(Debug, Clone, PartialEq)]
pub struct Campaign {
    pub created_at: u64,                // Unix timestamp (8 bytes)
    pub start_duration_in_seconds: u64, // Time until campaign starts (8 bytes)
    pub task_duration_in_seconds: u64,  // How long campaign runs (8 bytes)
    pub created_by: [u8; 20],           // Creator's address (20 bytes)
    pub campaign_type: CampaignType,    // Type of campaign (1 byte)
    pub maximum_amount: u64,            // Max deposit allowed (8 bytes)
    pub current_deposits: u64,          // Total deposits so far (8 bytes)
    pub status: CampaignStatus,         // Current status (1 byte)
}

// Participant data, we use one cell per participant.
#[derive(Debug)]
pub struct ParticipantData {
    pub campaign_tx_hash: [u8; 32], // which campaign
    pub campaign_index: u32,        // which campaign output
    pub participant_address: [u8; 20],
    pub joined_at: u64,
    pub status: ParticipantStatus,
}

pub const PARTICIPANT_DATA_LEN: usize = 65; // outpoint + address + timestamp + status.

#[repr(u8)]
#[derive(Debug, Clone, PartialEq)]
pub enum ParticipantStatus {
    Pending = 0,
    Verified,
    Rewarded,
}

impl TryFrom<u8> for ParticipantStatus {
    type Error = u8;

    fn try_from(val: u8) -> Result<Self, Self::Error> {
        match val {
            0 => Ok(ParticipantStatus::Pending),
            1 => Ok(ParticipantStatus::Verified),
            2 => Ok(ParticipantStatus::Rewarded),
            _ => Err(val),
        }
    }
}

// Campaign cell data format (total: 62 bytes)
pub const CAMPAIGN_DATA_LEN: usize = 62;

impl Campaign {
    pub fn accepts_deposits(&self) -> bool {
        // Campaign must not be active
        self.status == CampaignStatus::Created && self.campaign_type == CampaignType::SimpleTask
    }
}

pub const TOKEN_DATA_LEN: usize = 8;
