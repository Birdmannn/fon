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
// Layout: [8][8][8][20][1][8][8][1][8][32][64][8][8][8][8] = 198 bytes
#[derive(Debug, Clone, PartialEq)]
pub struct Campaign {
    pub created_at: u64,                // Unix timestamp in ms (8 bytes)
    pub start_duration_in_seconds: u64, // Time until campaign starts (8 bytes)
    pub task_duration_in_seconds: u64,  // How long campaign runs (8 bytes)
    pub created_by: [u8; 20],           // Creator's address (20 bytes)
    pub campaign_type: CampaignType,    // Type of campaign (1 byte)
    pub maximum_amount: u64,            // Funding target / raffle ticket capacity basis in shannons (8 bytes)
    pub current_deposits: u64,          // Current campaign escrow balance in shannons (8 bytes)
    pub status: CampaignStatus,         // Current status (1 byte)
    pub reward_count: u64,              // How many participants to reward (8 bytes)
    pub randomness_hash: [u8; 32],      // blake2b_256(randomness); [0;32] = sequential mode (32 bytes)
    pub summary: [u8; 64],              // Campaign summary, UTF-8 zero-padded (64 bytes)
    pub aux_amount: u64,                // Auxiliary amount: ticket_price for Raffle, 0 otherwise (8 bytes)
    pub ticket_sales_total: u64,        // Raffle ticket money still held in escrow (8 bytes)
    pub creator_support_total: u64,     // Creator-attributable support still held in escrow (8 bytes)
    pub support_pool_bps: u64,          // Basis points of creator support that join the raffle pool (8 bytes)
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

// Campaign cell data format (total: 198 bytes)
// Layout: [8][8][8][20][1][8][8][1][8][32][64][8][8][8][8]
pub const CAMPAIGN_DATA_LEN: usize = 198;

impl Campaign {
    pub fn accepts_deposits(&self) -> bool {
        // Support/tips may continue while a freight is live, but not after it has
        // completed or been cancelled.
        self.status == CampaignStatus::Created || self.status == CampaignStatus::Active
    }

    pub fn is_raffle(&self) -> bool {
        self.campaign_type == CampaignType::Raffle
    }

    pub fn ticket_price(&self) -> u64 {
        self.aux_amount
    }

    pub fn ends_at(&self) -> Option<u64> {
        let start_delay_ms = self.start_duration_in_seconds.checked_mul(1_000)?;
        let task_duration_ms = self.task_duration_in_seconds.checked_mul(1_000)?;
        self.created_at
            .checked_add(start_delay_ms)?
            .checked_add(task_duration_ms)
    }

    pub fn creator_withdrawable_amount(&self) -> Option<u64> {
        if !self.is_raffle() || self.current_deposits == 0 {
            return Some(0);
        }

        if self.ticket_sales_total != 0 || self.creator_support_total != self.current_deposits {
            return Some(0);
        }

        Some(self.creator_support_total)
    }

    pub fn can_creator_withdraw(&self, timestamp: u64) -> Option<bool> {
        let withdrawable_amount = self.creator_withdrawable_amount()?;
        if withdrawable_amount == 0 {
            return Some(false);
        }

        if self.status == CampaignStatus::Cancelled {
            return Some(true);
        }

        let ends_at = self.ends_at()?;
        if timestamp < ends_at {
            return Some(false);
        }

        Some(self.support_pool_bps == 0)
    }

    pub fn support_pool_contribution(&self) -> Option<u64> {
        if !self.is_raffle() || self.creator_support_total == 0 || self.support_pool_bps == 0 {
            return Some(0);
        }

        self.creator_support_total
            .checked_mul(self.support_pool_bps)
            .map(|value| value / 10_000)
    }

    pub fn reward_pool_amount(&self) -> Option<u64> {
        if !self.is_raffle() {
            return Some(self.current_deposits);
        }

        let support_contribution = self.support_pool_contribution()?;
        self.ticket_sales_total.checked_add(support_contribution)
    }
}

pub const TOKEN_DATA_LEN: usize = 8;
