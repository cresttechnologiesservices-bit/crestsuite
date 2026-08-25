import crypto from "node:crypto";
import bcrypt from "bcrypt";

export const generateOtp = () => crypto.randomInt(100000, 999999).toString();
export const hashOtp = (code: string) => bcrypt.hash(code, 10);
export const verifyOtp = (code: string, hash: string) => bcrypt.compare(code, hash);