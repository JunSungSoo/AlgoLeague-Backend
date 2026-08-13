import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const derived = (await scrypt(password, salt, keyLength)) as Buffer;
    return `scrypt:${salt}:${derived.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string | null) {
    if (!stored) return false;
    const [algorithm, salt, expectedHex] = stored.split(":");
    if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, "hex");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
