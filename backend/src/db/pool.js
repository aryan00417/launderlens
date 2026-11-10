import pg from "pg";

// Return plain values instead of surprising JS objects/strings.
pg.types.setTypeParser(1082, (v) => v);          // DATE -> "2022-09-09" (no timezone shifting)
pg.types.setTypeParser(1114, (v) => v);          // TIMESTAMP -> "2022-09-09 12:34:00"
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC -> number
pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT -> number

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
