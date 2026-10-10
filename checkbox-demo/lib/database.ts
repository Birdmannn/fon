import { MongoClient, type Collection, type Document } from "mongodb";

declare global {
  var __fonCheckboxDemoMongoClient: Promise<MongoClient> | undefined;
}

async function client() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is required for persistent checkbox demo storage");
  if (!globalThis.__fonCheckboxDemoMongoClient) {
    globalThis.__fonCheckboxDemoMongoClient = new MongoClient(uri).connect().catch((error) => {
      globalThis.__fonCheckboxDemoMongoClient = undefined;
      throw error;
    });
  }
  return globalThis.__fonCheckboxDemoMongoClient;
}

export function usesDatabase() {
  return Boolean(process.env.MONGODB_URI?.trim());
}

export async function collection<T extends Document>(name: string): Promise<Collection<T>> {
  const connection = await client();
  return connection.db(process.env.MONGODB_DB_NAME?.trim() || "fon-checkbox-demo").collection<T>(name);
}
