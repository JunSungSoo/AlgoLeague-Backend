import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
    it("stores a salted hash and verifies only the correct password", async () => {
        const first = await hashPassword("Password123");
        const second = await hashPassword("Password123");
        expect(first).not.toBe("Password123");
        expect(first).not.toBe(second);
        expect(await verifyPassword("Password123", first)).toBe(true);
        expect(await verifyPassword("wrong", first)).toBe(false);
    });
});
