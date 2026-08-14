import type { JudgeLanguage } from "./judge";

export type RuntimeVersion = {
    value: string;
    label: string;
    image: string;
    command: string;
    stable?: boolean;
};

export const runtimeVersions: Record<JudgeLanguage, readonly RuntimeVersion[]> = {
    javascript: [
        runtime(
            "node24",
            "Node.js 24 LTS",
            "node:24.18.0-bookworm-slim",
            "node --disable-proto=delete --no-addons /tmp/workspace/main.js",
            true,
        ),
        runtime(
            "node22",
            "Node.js 22 LTS",
            "node:22.22.0-bookworm-slim",
            "node --disable-proto=delete --no-addons /tmp/workspace/main.js",
        ),
        runtime(
            "node20",
            "Node.js 20",
            "node:20.20.0-bookworm-slim",
            "node --disable-proto=delete --no-addons /tmp/workspace/main.js",
        ),
        runtime(
            "node18",
            "Node.js 18",
            "node:18.20.8-bookworm-slim",
            "node --disable-proto=delete --no-addons /tmp/workspace/main.js",
        ),
        runtime(
            "node16",
            "Node.js 16",
            "node:16.20.2-bookworm-slim",
            "node --disable-proto=delete --no-addons /tmp/workspace/main.js",
        ),
        runtime(
            "node14",
            "Node.js 14",
            "node:14.21.3-bullseye-slim",
            "node --disable-proto=delete --no-addons /tmp/workspace/main.js",
        ),
    ],
    python: [
        runtime(
            "python3.14",
            "Python 3.14",
            "python:3.14.6-slim",
            "python3 -I -B /tmp/workspace/main.py",
            true,
        ),
        runtime(
            "python3.13",
            "Python 3.13",
            "python:3.13.14-slim",
            "python3 -I -B /tmp/workspace/main.py",
        ),
        runtime(
            "python3.12",
            "Python 3.12",
            "python:3.12.13-slim",
            "python3 -I -B /tmp/workspace/main.py",
        ),
        runtime(
            "python3.11",
            "Python 3.11",
            "python:3.11.15-slim",
            "python3 -I -B /tmp/workspace/main.py",
        ),
        runtime(
            "python3.10",
            "Python 3.10",
            "python:3.10.20-slim",
            "python3 -I -B /tmp/workspace/main.py",
        ),
        runtime(
            "python3.9",
            "Python 3.9",
            "python:3.9.25-slim",
            "python3 -I -B /tmp/workspace/main.py",
        ),
    ],
    java: [
        java("java25", "Java 25 LTS", "eclipse-temurin:25-jdk", true),
        java("java21", "Java 21 LTS", "eclipse-temurin:21-jdk"),
        java("java17", "Java 17 LTS", "eclipse-temurin:17-jdk"),
        java("java11", "Java 11 LTS", "eclipse-temurin:11-jdk"),
        java("java8", "Java 8 LTS", "eclipse-temurin:8-jdk"),
    ],
    cpp: [
        cpp("cpp23-gcc15", "C++23 · GCC 15.3", "gcc:15.3", "gnu++23", true),
        cpp("cpp20-gcc14", "C++20 · GCC 14.4", "gcc:14.4", "gnu++20"),
        cpp("cpp17-gcc13", "C++17 · GCC 13.4", "gcc:13.4", "gnu++17"),
        cpp("cpp14-gcc12", "C++14 · GCC 12.5", "gcc:12.5", "gnu++14"),
        cpp("cpp11-gcc11", "C++11 · GCC 11.5", "gcc:11.5", "gnu++11"),
    ],
};

export function defaultRuntimeVersion(language: JudgeLanguage) {
    return runtimeVersions[language][0]!.value;
}

export function resolveRuntimeVersion(language: JudgeLanguage, value?: string | null) {
    return (
        runtimeVersions[language].find((version) => version.value === value) ??
        runtimeVersions[language][0]!
    );
}

export function isRuntimeVersion(language: JudgeLanguage, value: string) {
    return runtimeVersions[language].some((version) => version.value === value);
}

function runtime(value: string, label: string, image: string, command: string, stable = false) {
    return { value, label, image, command, stable } satisfies RuntimeVersion;
}
function java(value: string, label: string, image: string, stable = false) {
    return runtime(
        value,
        label,
        image,
        "javac -encoding UTF-8 -d /tmp/classes /tmp/workspace/Main.java && java -cp /tmp/classes Main",
        stable,
    );
}
function cpp(value: string, label: string, image: string, standard: string, stable = false) {
    return runtime(
        value,
        label,
        image,
        `g++ -O2 -std=${standard} -pipe -o /tmp/main /tmp/workspace/main.cpp && /tmp/main`,
        stable,
    );
}
