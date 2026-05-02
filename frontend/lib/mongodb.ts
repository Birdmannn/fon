import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("Missing MONGODB_URI environment variable");
}

const globalForMongo = globalThis as typeof globalThis & {
  __freightMongoClientPromise?: Promise<MongoClient>;
};

const mongoClientPromise =
  globalForMongo.__freightMongoClientPromise ??
  new MongoClient(uri).connect();

if (process.env.NODE_ENV !== "production") {
  globalForMongo.__freightMongoClientPromise = mongoClientPromise;
}

export const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "freightonnervos";
export const CAMPAIGN_RECORDS_COLLECTION = "campaignRecords";

export async function getMongoCollection() {
  const client = await mongoClientPromise;
  return client.db(MONGODB_DB_NAME).collection(CAMPAIGN_RECORDS_COLLECTION);
}
