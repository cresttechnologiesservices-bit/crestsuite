import { Request, Response, NextFunction } from "express";

/**
 * Strip characters PostgreSQL cannot store in text columns from incoming JSON.
 *
 * A NUL byte (code 0) — common when a UTF-16 or binary file is read as text
 * and uploaded, e.g. during a CSV import — makes Postgres reject the query
 * with `22021 invalid byte sequence for encoding "UTF8"`. Removing them at the
 * edge stops one malformed value from failing (previously: crashing) the API.
 *
 * The other C0 control characters are dropped too; tab, newline and carriage
 * return are kept because they are legitimate in descriptions and notes.
 */
function isIllegalControlChar(code: number): boolean {
  return code < 32 && code !== 9 && code !== 10 && code !== 13;
}

export function stripIllegalChars(value: string): string {
  // Fast path: most values contain nothing to remove
  let needsCleaning = false;
  for (let i = 0; i < value.length; i++) {
    if (isIllegalControlChar(value.charCodeAt(i))) {
      needsCleaning = true;
      break;
    }
  }
  if (!needsCleaning) return value;

  let cleaned = "";
  for (let i = 0; i < value.length; i++) {
    if (!isIllegalControlChar(value.charCodeAt(i))) cleaned += value[i];
  }
  return cleaned;
}

function clean(value: any, depth = 0): any {
  if (depth > 20) return value; // guard against pathological nesting
  if (typeof value === "string") return stripIllegalChars(value);
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  if (value && typeof value === "object" && value.constructor === Object) {
    for (const key of Object.keys(value)) value[key] = clean(value[key], depth + 1);
  }
  return value;
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = clean(req.body);
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      const value = (req.query as any)[key];
      if (typeof value === "string") (req.query as any)[key] = stripIllegalChars(value);
    }
  }
  next();
}
