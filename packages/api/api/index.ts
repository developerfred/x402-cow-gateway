// Vercel entry — deploys the Hono gateway as a Node serverless function.
// Set the project root to packages/api in Vercel, and configure the env vars
// from .env.example in the Vercel dashboard.
import { handle } from "hono/vercel";
import app from "../src/server.js";

export const config = { runtime: "nodejs" };

export default handle(app);
