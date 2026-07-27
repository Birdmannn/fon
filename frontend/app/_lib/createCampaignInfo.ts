export const CREATE_INFO_CONSTRAINT_HEADING = "Creation constraints:";

export const CREATE_INFO_CONSTRAINT_ITEMS = [
  { key: "titlePassed", text: "1. Title is required." },
  { key: "bodyPassed", text: "2. Body must be at least 120 characters (Well, ofcourse, we can keep it 15 if it's a Raffle)" },
  {
    key: "firstHashtagPassed",
    text: "3. The first hashtag (there must be a first hashtag) must be exactly one of #SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle.",
  },
] as const;

export const CREATE_INFO_NOTE_HEADING = "Note:";

export const CREATE_INFO_NOTE_ITEMS = [
  "1. Additional hashtags may follow after the first compulsory hashtag.",
  "2. Use #mounted to trigger mountables.",
] as const;

export const CREATE_INFO_TYPING_HEADING = "Typing:";

export const CREATE_INFO_TYPING_ITEMS = [
  "Start with 1. then press Enter to continue numbered lists.",
  "Start with -, *, or • then press Enter to continue bullet lists.",
  "Start with [ ] or [x] to continue checkbox items.",
  "Type ## at the start of a line for a larger heading line.",
  "Use # for hashtags and @ for mentions.",
] as const;

export const CREATE_INFO_PREVIEW_HEADING = "Preview:";

export const CREATE_INFO_PREVIEW_ITEMS = [
  "The generated summary is the short on-chain version of the post.",
  "It is required because on-chain summary storage is limited to 64 UTF-8 bytes.",
  "You can edit the summary before publishing if you want a clearer on-chain description.",
  "Review and set the campaign args here, especially duration and max deposit.",
  "If the first hashtag is #Raffle, a ticket price is also required.",
  "The full title, description, mentions, and review snapshot are saved off-chain.",
] as const;
