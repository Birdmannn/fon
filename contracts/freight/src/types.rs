// Campaign types that determine behavior
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CampaignType {
    SimpleTask = 0,     // No deposit required
    FundedTask = 1,     // Requires deposits to start
    Crowdfunding = 2,   // Deposit-based with funding goal
    TimedChallenge = 3, // Time-sensitive with deposits
    Raffle = 4,         // Ticket-based raffle; ticket_price stored in aux_amount
}

impl TryFrom<u8> for CampaignType {
    type Error = u8;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(CampaignType::SimpleTask),
            1 => Ok(CampaignType::FundedTask),
            2 => Ok(CampaignType::Crowdfunding),
            3 => Ok(CampaignType::TimedChallenge),
            4 => Ok(CampaignType::Raffle),
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

// Enum for key, for extracting address from lock args.
// Admin(index) carries the byte offset into the type script args where the
// admin address starts (e.g. AddressKey::Admin(1) → args[1..21]).
#[derive(Debug, Clone, PartialEq)]
pub enum AddressKey {
    Creator,
    Depositor,
    Admin(usize),
}

// Campaign data structure (stored in cell data)
// Layout: [8][8][8][20][1][8][8][1][8][32][64][8] = 174 bytes
#[derive(Debug, Clone, PartialEq)]
pub struct Campaign {
    pub created_at: u64,                // Unix timestamp in ms (8 bytes)
    pub start_duration_in_seconds: u64, // Time until campaign starts (8 bytes)
    pub task_duration_in_seconds: u64,  // How long campaign runs (8 bytes)
    pub created_by: [u8; 20],           // Creator's address (20 bytes)
    pub campaign_type: CampaignType,    // Type of campaign (1 byte)
    pub maximum_amount: u64,            // Max deposit allowed in shannons (8 bytes)
    pub current_deposits: u64,          // Total deposits so far in shannons (8 bytes)
    pub status: CampaignStatus,         // Current status (1 byte)
    pub reward_count: u64,              // How many participants to reward (8 bytes)
    pub randomness_hash: [u8; 32],      // blake2b_256(randomness); [0;32] = sequential mode (32 bytes)
    pub summary: [u8; 64],              // Campaign summary, UTF-8 zero-padded (64 bytes)
    pub aux_amount: u64,                // Auxiliary amount: ticket_price for Raffle, 0 otherwise (8 bytes)
}

// Participant data, we use one cell per participant.
// Layout: [20][8][1][20][8][1][8] = 66 bytes
#[derive(Debug, Clone)]
pub struct ParticipantData {
    pub campaign_created_by: [u8; 20],   // stable campaign creator identity (20 bytes)
    pub campaign_created_at: u64,        // stable campaign creation timestamp in ms (8 bytes)
    pub campaign_type: CampaignType,     // stable campaign type (1 byte)
    pub participant_address: [u8; 20],   // participant's address (20 bytes)
    pub joined_at: u64,                  // timestamp in ms (8 bytes)
    pub status: ParticipantStatus,       // current status (1 byte)
    pub deposited_amount: u64,           // amount deposited by this participant in shannons (8 bytes)
}

pub const PARTICIPANT_DATA_LEN: usize = 66;

#[repr(u8)]
#[derive(Debug, Clone, PartialEq)]
pub enum ParticipantStatus {
    Pending = 0,
    Verified = 1,
    Rewarded = 2,
    Refunded = 3,
}

impl TryFrom<u8> for ParticipantStatus {
    type Error = u8;

    fn try_from(val: u8) -> Result<Self, Self::Error> {
        match val {
            0 => Ok(ParticipantStatus::Pending),
            1 => Ok(ParticipantStatus::Verified),
            2 => Ok(ParticipantStatus::Rewarded),
            3 => Ok(ParticipantStatus::Refunded),
            _ => Err(val),
        }
    }
}

// Campaign cell data format (total: 174 bytes)
// Layout: [8][8][8][20][1][8][8][1][8][32][64][8]
pub const CAMPAIGN_DATA_LEN: usize = 174;

impl Campaign {
    pub fn accepts_deposits(&self) -> bool {
        // All campaign types may accept support/funding while still in Created.
        // SimpleTask tips are creator-directed, while other campaign types remain escrow-backed.
        self.status == CampaignStatus::Created
    }

    pub fn is_raffle(&self) -> bool {
        self.campaign_type == CampaignType::Raffle
    }

    pub fn ticket_price(&self) -> u64 {
        self.aux_amount
    }
}

pub const TOKEN_DATA_LEN: usize = 8;
