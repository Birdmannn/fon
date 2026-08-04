import { MongoClient, MongoClientOptions } from "mongodb";

const globalForMongo = globalThis as typeof globalThis & {
  __freightMongoClientPromise?: Promise<MongoClient>;
};

function getMongoClientPromise() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("Missing MONGODB_URI environment variable");
  }

  if (!globalForMongo.__freightMongoClientPromise) {
    const options: MongoClientOptions = {
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    };
    const client = new MongoClient(uri, options);

    globalForMongo.__freightMongoClientPromise = client.connect().catch(async (error) => {
      globalForMongo.__freightMongoClientPromise = undefined;
      await client.close().catch(() => undefined);
      throw error;
    });
  }

  return globalForMongo.__freightMongoClientPromise;
}

export const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "freightonnervos";
export const CAMPAIGN_RECORDS_COLLECTION = "campaignRecords";
export const CAMPAIGN_PARTICIPANTS_COLLECTION = "campaignParticipants";
export const CAMPAIGN_DEPOSITS_COLLECTION = "campaignDeposits";
export const USER_PROFILES_COLLECTION = "userProfiles";
export const GOOGLE_LINK_CODES_COLLECTION = "googleLinkCodes";
export const FBAR_EVENTS_COLLECTION = "fbarEvents";

export async function getMongoCollection() {
  const client = await getMongoClientPromise();
  return client.db(MONGODB_DB_NAME).collection(CAMPAIGN_RECORDS_COLLECTION);
}

export async function getCampaignParticipantsCollection() {
  const client = await getMongoClientPromise();
  return client.db(MONGODB_DB_NAME).collection(CAMPAIGN_PARTICIPANTS_COLLECTION);
}

export async function getCampaignDepositsCollection() {
  const client = await getMongoClientPromise();
  return client.db(MONGODB_DB_NAME).collection(CAMPAIGN_DEPOSITS_COLLECTION);
}

export async function getUserProfilesCollection() {
  const client = await getMongoClientPromise();
  return client.db(MONGODB_DB_NAME).collection(USER_PROFILES_COLLECTION);
}

export async function getFbarEventsCollection() {
  const client = await getMongoClientPromise();
  return client.db(MONGODB_DB_NAME).collection(FBAR_EVENTS_COLLECTION);
}
