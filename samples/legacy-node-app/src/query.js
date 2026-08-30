import pg from "pg";

export function pool() {
  return new pg.Pool();
}
