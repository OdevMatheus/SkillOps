import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	BenchmarkReportSchema,
	EvalAssertionSchema,
	EvalCaseSchema,
	EvalSuiteSchema,
	ExitCode,
	isSafeLockRelativePath,
	loadSkillOpsConfig,
	ScriptEntrypointSchema,
	ScriptOutputSchema,
	SkillDirectorySchema,
	SKILLOPS_VERSION,
	SyncLockfileSchema,
	trimTrailingSlashes,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MCP_ARCHITECT_EVALS_DIR = path.join(
	REPO_ROOT,
	"catalog",
	"ai-engineering",
	"mcp-architect",
	"evals",
);

const VALID_SHA256 = "a".repeat(64);

describe("Contract Alignment & Hardened Models (v1.5.2)", () => {
	it("exposes ExitCode.SECURITY_BOUNDARY_ERROR === 5", () => {
		expect(ExitCode.SECURITY_BOUNDARY_ERROR).toBe(5);
		expect(ExitCode.SUCCESS).toBe(0);
		expect(SKILLOPS_VERSION).toBe("1.5.2");
	});

	it("trims trailing slashes deterministically in linear time via trimTrailingSlashes and SkillDirectorySchema", () => {
		expect(trimTrailingSlashes("catalog/ai-engineering/mcp-architect///")).toBe(
			"catalog/ai-engineering/mcp-architect",
		);
		expect(trimTrailingSlashes("no-trailing-slash")).toBe("no-trailing-slash");
		expect(trimTrailingSlashes("////")).toBe("");
		expect(trimTrailingSlashes("")).toBe("");

		const manySlashes = `catalog/arch-quality/env-secrets-guard${"/".repeat(50_000)}`;
		const startMs = performance.now();
		const normalized = SkillDirectorySchema.parse(manySlashes);
		const elapsedMs = performance.now() - startMs;

		expect(normalized).toBe("catalog/arch-quality/env-secrets-guard");
		expect(elapsedMs).toBeLessThan(100);

		expect(
			ScriptEntrypointSchema.parse({
				path: "///scripts\\validate_mcp_server.py///",
				description: "Deterministic AST auditor for MCP server transports.",
			}).path,
		).toBe("scripts/validate_mcp_server.py");

		expect(() => SkillDirectorySchema.parse("///")).toThrow();
		expect(() => SkillDirectorySchema.parse("catalog/bad\0dir")).toThrow();
	});

	it("rejects __proto__, constructor, prototype, leading /, NUL, and .. keys in SyncLockfileSchema", () => {
		const validEntry = {
			target: "claude" as const,
			skill_name: "mcp-architect",
			relative_path: ".claude/skills/mcp-architect/SKILL.md",
			sha256: VALID_SHA256,
		};

		const validLock = SyncLockfileSchema.parse({
			skillops_version: "1.5.2",
			targets: ["claude"],
			selected_skills: ["mcp-architect"],
			artifacts: {
				".claude/skills/mcp-architect/SKILL.md": validEntry,
			},
		});
		expect(
			validLock.artifacts[".claude/skills/mcp-architect/SKILL.md"]?.skill_name,
		).toBe("mcp-architect");

		const unsafeKeys = [
			"__proto__",
			"constructor",
			"prototype",
			".claude/__proto__/SKILL.md",
			".claude/constructor/SKILL.md",
			".claude/prototype/SKILL.md",
			"/.claude/skills/mcp-architect/SKILL.md",
			"../outside/SKILL.md",
			".claude/../outside/SKILL.md",
			".claude/skills/\0bad/SKILL.md",
		];

		for (const badKey of unsafeKeys) {
			expect(isSafeLockRelativePath(badKey)).toBe(false);

			const rawJson = JSON.stringify({
				skillops_version: "1.5.2",
				artifacts: {
					[badKey]: validEntry,
				},
			});
			const parsedJson: unknown = JSON.parse(rawJson);
			expect(() => SyncLockfileSchema.parse(parsedJson)).toThrow();
		}

		// Also reject prototype-mutated non-plain artifact objects
		const mutatedProtoArtifacts = Object.create({ polluted: validEntry });
		expect(() =>
			SyncLockfileSchema.parse({
				skillops_version: "1.5.2",
				artifacts: mutatedProtoArtifacts,
			}),
		).toThrow();
	});

	it("validates workspace .skillops.yml cleanly with SkillOpsConfigSchema", () => {
		const loaded = loadSkillOpsConfig(`${REPO_ROOT}///`);
		expect(loaded.exists).toBe(true);
		expect(loaded.error).toBeNull();
		expect(loaded.config?.catalog_dir).toBe("catalog");
		expect(loaded.config?.targets).toContain("claude");
	});

	it("validates EvalSuiteSchema, BenchmarkReportSchema, and ScriptOutputSchema against mcp-architect fixtures", () => {
		const rawEvals = JSON.parse(
			fs.readFileSync(path.join(MCP_ARCHITECT_EVALS_DIR, "evals.json"), "utf-8"),
		) as unknown;
		const parsedSuite = EvalSuiteSchema.parse(rawEvals);
		expect(parsedSuite.skill_name).toBe("mcp-architect");
		expect(parsedSuite.evals.length).toBeGreaterThanOrEqual(3);

		const firstCase = EvalCaseSchema.parse(parsedSuite.evals[0]);
		const firstAssertion = EvalAssertionSchema.parse(firstCase.assertions[0]);
		expect(firstAssertion.type).toBe("tool_call_contains");

		const rawBenchmark = JSON.parse(
			fs.readFileSync(
				path.join(MCP_ARCHITECT_EVALS_DIR, "benchmark.json"),
				"utf-8",
			),
		) as unknown;
		const parsedBenchmark = BenchmarkReportSchema.parse(rawBenchmark);
		expect(parsedBenchmark.skill_name).toBe("mcp-architect");
		expect(parsedBenchmark.delta.verdict).toBe("CERTIFIED_IMPROVEMENT");
		expect(parsedBenchmark.delta.pass_rate_gain).toBeGreaterThan(0);

		const sampleScriptOutput = ScriptOutputSchema.parse({
			skill: "mcp-architect",
			script: "validate_mcp_server.py",
			status: "ok",
			target: "server.py",
			summary: {
				files_scanned: 1,
				findings_count: 0,
			},
			findings: [],
		});
		expect(sampleScriptOutput.status).toBe("ok");

		expect(() =>
			ScriptOutputSchema.parse({
				skill: "Invalid Uppercase",
				script: "validate_mcp_server.py",
				status: "ok",
				target: "server.py",
				summary: {},
			}),
		).toThrow();
	});
});
