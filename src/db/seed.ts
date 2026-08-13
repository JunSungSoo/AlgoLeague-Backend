import { db, pool } from "./index";
import { problems, testCases, users } from "./schema";
import { hashPassword } from "../services/password";

const userId = "00000000-0000-0000-0000-000000000001";
const problemId = "10000000-0000-0000-0000-000000000001";
await db
    .insert(users)
    .values({
        id: userId,
        username: "admin",
        email: "demo@algorithm-champions.local",
        passwordHash: await hashPassword("ChangeMe123!"),
        name: "데모 관리자",
        phone: "+821000000000",
        phoneVerifiedAt: new Date(),
        nickname: "알고리즘러",
        preferredLanguage: "python",
        role: "ADMIN",
        grade: 6,
        verifiedSolves: 12,
        gradeCheckpoint: 9,
    })
    .onConflictDoNothing();
await db
    .insert(problems)
    .values({
        id: problemId,
        slug: "minimum-route",
        status: "PUBLISHED",
        title: "별빛 정거장의 최소 비용",
        statement: "정거장 사이의 최소 이동 비용을 구하세요.",
        inputDescription: "N, M과 간선 목록",
        outputDescription: "최소 비용",
        constraints: ["2 ≤ N ≤ 100,000"],
        samples: [{ input: "5 6\n", output: "6\n" }],
        explanation: "다익스트라 알고리즘을 사용합니다.",
        grade: 6,
        primaryTag: "그래프",
        secondaryTags: ["다익스트라"],
        publishedAt: new Date(),
    })
    .onConflictDoNothing();
await db
    .insert(testCases)
    .values({
        problemId,
        input: "2 1\n1 2 7\n1 2\n",
        expectedOutput: "7\n",
        ordinal: 1,
        isPublic: true,
    })
    .onConflictDoNothing();
await pool.end();
console.log("database seed complete");
