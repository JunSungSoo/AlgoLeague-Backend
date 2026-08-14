import { db, pool } from "./index";
import {
    problems,
    solvedProblems,
    submissionComments,
    submissionRecommendations,
    submissions,
    testCases,
    users,
} from "./schema";
import { hashPassword } from "../services/password";
import { eq } from "drizzle-orm";
import { dayjs } from "../lib/dayjs-config";

const defaultAdminUserId = "00000000-0000-0000-0000-000000000001";
const defaultJunfredUserId = "00000000-0000-0000-0000-000000000002";
const problemId = "10000000-0000-0000-0000-000000000001";
const gradeNineProblemId = "10000000-0000-0000-0000-000000000009";
const adminSubmissionId = "20000000-0000-0000-0000-000000000001";
const junfredSubmissionId = "20000000-0000-0000-0000-000000000002";
const acceptedAt = dayjs("2026-08-12T00:00:00.000Z").toDate();
const javascriptAnswer = `const sumNumbers = (a, b) => {
    return a + b;
};`;
const gradeNineFunctionSpec = {
    name: "sumNumbers",
    parameters: [
        { name: "a", type: "integer" as const },
        { name: "b", type: "integer" as const },
    ],
    returnType: "integer" as const,
};
const gradeNineSamples = [
    { input: "sumNumbers(3, 5)", output: "8", arguments: [3, 5], expected: 8 },
    { input: "sumNumbers(-2, 7)", output: "5", arguments: [-2, 7], expected: 5 },
    { input: "sumNumbers(0, 0)", output: "0", arguments: [0, 0], expected: 0 },
];
const gradeNineHiddenTests = [
    {
        input: "sumNumbers(1000000, 1000000)",
        output: "2000000",
        arguments: [1000000, 1000000],
        expected: 2000000,
    },
    {
        input: "sumNumbers(-1000000, -1000000)",
        output: "-2000000",
        arguments: [-1000000, -1000000],
        expected: -2000000,
    },
    { input: "sumNumbers(-9, 9)", output: "0", arguments: [-9, 9], expected: 0 },
    { input: "sumNumbers(1, 0)", output: "1", arguments: [1, 0], expected: 1 },
    {
        input: "sumNumbers(123456, 654321)",
        output: "777777",
        arguments: [123456, 654321],
        expected: 777777,
    },
];
const sharedPasswordHash = await hashPassword("admin123!!");
const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "admin"))
    .limit(1);
const userId = existingAdmin?.id ?? defaultAdminUserId;
if (existingAdmin) {
    await db
        .update(users)
        .set({ passwordHash: sharedPasswordHash, role: "ADMIN", updatedAt: dayjs().toDate() })
        .where(eq(users.id, userId));
} else {
    await db.insert(users).values({
        id: defaultAdminUserId,
        username: "admin",
        email: "demo@algorithm-champions.local",
        passwordHash: sharedPasswordHash,
        name: "데모 관리자",
        phone: "+821000000000",
        phoneVerifiedAt: dayjs().toDate(),
        nickname: "알고리즘러",
        preferredLanguage: "python",
        role: "ADMIN",
        grade: 6,
        verifiedSolves: 12,
        gradeCheckpoint: 9,
    });
}
const [existingJunfred] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "junfred2"))
    .limit(1);
const junfredUserId = existingJunfred?.id ?? defaultJunfredUserId;
if (existingJunfred) {
    await db
        .update(users)
        .set({
            preferredLanguage: "javascript",
            updatedAt: dayjs().toDate(),
        })
        .where(eq(users.id, junfredUserId));
} else {
    await db.insert(users).values({
        id: defaultJunfredUserId,
        username: "junfred2",
        email: "junfred2@algorithm-champions.local",
        passwordHash: sharedPasswordHash,
        name: "준프레드",
        phone: "+821000000002",
        phoneVerifiedAt: dayjs().toDate(),
        nickname: "junfred2",
        preferredLanguage: "javascript",
        role: "LEARNER",
        grade: 9,
        verifiedSolves: 1,
        gradeCheckpoint: 0,
    });
}
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
        publishedAt: dayjs().toDate(),
    })
    .onConflictDoNothing();
await db
    .insert(problems)
    .values({
        id: gradeNineProblemId,
        slug: "sum-of-two-numbers",
        status: "PUBLISHED",
        title: "두 수의 합",
        statement: "두 정수 A와 B가 주어질 때 두 값을 더한 결과를 반환하는 함수를 완성하세요.",
        inputDescription: "함수 인자 a와 b로 두 정수가 전달됩니다.",
        outputDescription: "a와 b의 합을 정수로 반환합니다.",
        constraints: ["-1,000,000 ≤ A, B ≤ 1,000,000"],
        samples: gradeNineSamples,
        executionMode: "function",
        functionSpec: gradeNineFunctionSpec,
        explanation: "입력받은 두 정수를 더해 출력합니다.",
        grade: 9,
        primaryTag: "구현",
        secondaryTags: ["입출력", "사칙연산"],
        timeLimitMs: 1000,
        publishedAt: dayjs("2026-08-01T00:00:00.000Z").toDate(),
    })
    .onConflictDoNothing();
await db
    .update(problems)
    .set({
        statement: "두 정수 A와 B가 주어질 때 두 값을 더한 결과를 반환하는 함수를 완성하세요.",
        inputDescription: "함수 인자 a와 b로 두 정수가 전달됩니다.",
        outputDescription: "a와 b의 합을 정수로 반환합니다.",
        samples: gradeNineSamples,
        executionMode: "function",
        functionSpec: gradeNineFunctionSpec,
        updatedAt: dayjs().toDate(),
    })
    .where(eq(problems.id, gradeNineProblemId));
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
for (const [index, sample] of gradeNineSamples.entries()) {
    await db
        .insert(testCases)
        .values({
            problemId: gradeNineProblemId,
            input: sample.input,
            expectedOutput: sample.output,
            argumentsJson: sample.arguments,
            expectedValue: sample.expected,
            groupName: "sample",
            ordinal: index + 1,
            isPublic: true,
        })
        .onConflictDoUpdate({
            target: [testCases.problemId, testCases.ordinal],
            set: {
                input: sample.input,
                expectedOutput: sample.output,
                argumentsJson: sample.arguments,
                expectedValue: sample.expected,
                groupName: "sample",
                isPublic: true,
            },
        });
}
for (const [index, test] of gradeNineHiddenTests.entries()) {
    await db
        .insert(testCases)
        .values({
            problemId: gradeNineProblemId,
            input: test.input,
            expectedOutput: test.output,
            argumentsJson: test.arguments,
            expectedValue: test.expected,
            groupName: "hidden",
            ordinal: gradeNineSamples.length + index + 1,
            isPublic: false,
        })
        .onConflictDoUpdate({
            target: [testCases.problemId, testCases.ordinal],
            set: {
                input: test.input,
                expectedOutput: test.output,
                argumentsJson: test.arguments,
                expectedValue: test.expected,
                groupName: "hidden",
                isPublic: false,
            },
        });
}
await db
    .insert(submissions)
    .values([
        {
            id: adminSubmissionId,
            userId,
            problemId: gradeNineProblemId,
            language: "javascript",
            sourceCode: javascriptAnswer,
            verdict: "AC",
            runtimeMs: 31,
            memoryKb: 18_432,
            attemptNumber: 1,
            countsForGrade: true,
            firstAccepted: true,
            traceId: "seed-admin-grade-9-answer",
            judgedAt: acceptedAt,
            createdAt: acceptedAt,
        },
        {
            id: junfredSubmissionId,
            userId: junfredUserId,
            problemId: gradeNineProblemId,
            language: "javascript",
            sourceCode: `${javascriptAnswer}\n`,
            verdict: "AC",
            runtimeMs: 28,
            memoryKb: 17_920,
            attemptNumber: 1,
            countsForGrade: true,
            firstAccepted: true,
            traceId: "seed-junfred2-grade-9-answer",
            judgedAt: dayjs(acceptedAt).add(1, "minute").toDate(),
            createdAt: dayjs(acceptedAt).add(1, "minute").toDate(),
        },
    ])
    .onConflictDoNothing();
await db
    .update(submissions)
    .set({ sourceCode: javascriptAnswer, language: "javascript" })
    .where(eq(submissions.id, adminSubmissionId));
await db
    .update(submissions)
    .set({ sourceCode: javascriptAnswer, language: "javascript" })
    .where(eq(submissions.id, junfredSubmissionId));
await db
    .insert(solvedProblems)
    .values([
        {
            userId,
            problemId: gradeNineProblemId,
            submissionId: adminSubmissionId,
            acceptedAt,
        },
        {
            userId: junfredUserId,
            problemId: gradeNineProblemId,
            submissionId: junfredSubmissionId,
            acceptedAt: dayjs(acceptedAt).add(1, "minute").toDate(),
        },
    ])
    .onConflictDoNothing();
await db
    .insert(submissionRecommendations)
    .values([
        { submissionId: adminSubmissionId, userId: junfredUserId },
        { submissionId: junfredSubmissionId, userId },
    ])
    .onConflictDoNothing();
await db
    .insert(submissionComments)
    .values([
        {
            id: "30000000-0000-0000-0000-000000000001",
            submissionId: adminSubmissionId,
            userId: junfredUserId,
            body: "입력 처리와 출력이 간결해서 이해하기 좋습니다.",
        },
        {
            id: "30000000-0000-0000-0000-000000000002",
            submissionId: junfredSubmissionId,
            userId,
            body: "정답 풀이를 확인했습니다.",
        },
    ])
    .onConflictDoNothing();
await pool.end();
console.log("database seed complete");
