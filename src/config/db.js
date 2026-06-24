import mongoose from "mongoose";

export async function connectDB(uri) {
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("[db] connected to MongoDB");
}
