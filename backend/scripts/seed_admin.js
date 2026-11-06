import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool.js";

const email = process.argv[2] || "admin@launderlens.local";
const password = process.argv[3] || "admin123";
const hash = await bcrypt.hash(password, 10);
await pool.query(
  `INSERT INTO users (email, name, password_hash, role) VALUES ($1,'Admin',$2,'admin')
   ON CONFLICT (email) DO NOTHING`,
  [email, hash]
);
console.log("admin ready:", email);
await pool.end();
