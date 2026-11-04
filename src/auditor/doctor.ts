/**
 * Repository Environment Diagnostics & Lockfile Drift Auditor (`npx skillops-cli@latest doctor` / `status`).
 *
 * Implements Issue #104:
 * - Verifies Node.js runtime (`>= 20.0.0`) and Python runtime availability (`>= 3.12`) for Level 3 scripts.
 * - Validates `.skillops.yml` declarative configuration via `loadSkillOpsConfig()`.
 * - Audits `.skillops-lock.json` tracked artifacts and verifies their on-disk SHA-256 hash (`healthy`, `drifted`, `missing`).
 * - Audits Startup Token Tax status via `analyzeRepoTokenEconomy()`.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	ALL_RUNTIME_TARGETS,
	RUNTIME_HARNESS_SPECS,
	type RuntimeHarnessSpec,
	type RuntimeTarget,
	SyncLockfileSchema,
	detectInstalledHarnesses,
	loadSkillOpsConfig,
} from "../models.js";
import { analyzeRepoTokenEconomy } from "./token_economy.js";

export interface LockfileArtifactDiagnostic {
	readonly relative_path: string;
	readonly target: RuntimeTarget;
	readonly item_name: string;
	readonly expected_sha256: string;
	readonly actual_sha256: string | null;
	readonly status: "healthy" | "drifted" | "missing";
}

export interface DoctorCheckItem {
	readonly id:
		| "node_runtime"
		| "python_runtime"
		| "detected_harnesses"
		| "skillops_config"
		| "lockfile_integrity"
		| "startup_token_tax";
	readonly title: string;
	readonly status: "pass" | "warn" | "fail";
	readonly summary: string;
}

export interface DoctorReport {
	readonly status: "pass" | "warn" | "fail";
	readonly repo_path: string;
	readonly node_version: string;
	readonly python_version: string | null;
	readonly detected_harnesses: readonly RuntimeTarget[];
	readonly config_present: boolean;
	readonly config_valid: boolean;
	readonly config_error?: string;
	readonly lockfile_present: boolean;
	readonly lockfile_valid: boolean;
	readonly tracked_artifacts_count: number;
	readonly healthy_artifacts_count: number;
	readonly drifted_artifacts_count: number;
	readonly missing_artifacts_count: number;
	readonly artifacts: readonly LockfileArtifactDiagnostic[];
	readonly startup_tax_tokens: number;
	readonly startup_tax_budget: number;
	readonly startup_tax_within_budget: boolean;
	readonly checks: readonly DoctorCheckItem[];
	readonly remediation: readonly string[];
}

export interface HarnessInspectionEntry extends RuntimeHarnessSpec {
	readonly detected: boolean;
}

export interface HarnessInspectionReport {
	readonly repo_path: string;
	readonly total_supported: number;
	readonly detected_count: number;
	readonly detected_harnesses: readonly RuntimeTarget[];
	readonly harnesses: readonly HarnessInspectionEntry[];
}

export interface DiagnoseRepositoryOptions {
	readonly catalogDir?: string;
	readonly startupTaxBudget?: number;
}

function computeFileSha256(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function detectPythonVersion(): string | null {
	for (const cmd of ["python3", "python"]) {
		try {
			const res = spawnSync(cmd, ["--version"], {
				encoding: "utf-8",
				timeout: 3000,
			});
			if (res.status === 0) {
				const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
				const match = /Python\s+(\d+\.\d+(?:\.\d+)?)/i.exec(out);
				if (match?.[1]) {
					return match[1];
				}
			}
		} catch {
			// Ignore missing binary and try next candidate
		}
	}
	return null;
}

function isVersionAtLeast(
	versionStr: string,
	minMajor: number,
	minMinor = 0,
): boolean {
	const cleaned = versionStr.replace(/^v/i, "").trim();
	const parts = cleaned.split(".").map((p) => Number.parseInt(p, 10));
	const major = parts[0] ?? 0;
	const minor = parts[1] ?? 0;
	if (major > minMajor) {
		return true;
	}
	if (major === minMajor && minor >= minMinor) {
		return true;
	}
	return false;
}

/**
 * Run comprehensive environment, configuration, lockfile drift, and token economy diagnostics.
 */
export function diagnoseRepository(
	repoPath: string,
	options: DiagnoseRepositoryOptions = {},
): DoctorReport {
	const resolvedRepo = path.resolve(repoPath);
	const repoLabel = path.basename(resolvedRepo) || ".";
	const checks: DoctorCheckItem[] = [];
	const remediation: string[] = [];

	// 1. Node.js Runtime Check (>= 20.0.0)
	const nodeVersion = process.version;
	const nodeOk = isVersionAtLeast(nodeVersion, 20, 0);
	checks.push({
		id: "node_runtime",
		title: "Node.js Runtime (>= 20.0.0)",
		status: nodeOk ? "pass" : "fail",
		summary: nodeOk
			? `Node.js ${nodeVersion} satisfies engine requirement (>= 20.0.0).`
			: `Node.js ${nodeVersion} is below minimum required version 20.0.0.`,
	});
	if (!nodeOk) {
		remediation.push("Upgrade Node.js to v20 LTS or newer.");
	}

	// 2. Python Runtime Check (>= 3.12 for Level 3 scripts)
	const pythonVersion = detectPythonVersion();
	const pythonOk =
		pythonVersion !== null && isVersionAtLeast(pythonVersion, 3, 12);
	checks.push({
		id: "python_runtime",
		title: "Python Runtime (>= 3.12 for Level 3 Scripts)",
		status: pythonOk ? "pass" : "warn",
		summary:
			pythonVersion === null
				? "Python runtime not detected on PATH (optional unless executing Python Level 3 scripts)."
				: pythonOk
					? `Python ${pythonVersion} detected and ready for Level 3 zero-token scripts.`
					: `Python ${pythonVersion} detected, but >= 3.12 is recommended for Level 3 scripts.`,
	});
	if (!pythonOk) {
		remediation.push(
			"Install Python 3.12+ on PATH to execute Python-based Level 3 deterministic scripts.",
		);
	}

	// 2.5. Detected AI Coding Agent Harnesses (Top 28)
	const detectedHarnesses = detectInstalledHarnesses(resolvedRepo);
	checks.push({
		id: "detected_harnesses",
		title: "Detected AI Coding Harnesses (Top 28)",
		status: "pass",
		summary:
			detectedHarnesses.length > 0
				? `Detected ${detectedHarnesses.length} AI coding harness(es): ${detectedHarnesses.join(", ")}.`
				: "No repo-local AI harness folders detected yet (ready to sync all 28 agents).",
	});

	// 3. Declarative Config (.skillops.yml) Check
	const loadedCfg = loadSkillOpsConfig(resolvedRepo);
	const configPresent = loadedCfg.exists;
	let configValid = true;
	let configError: string | undefined;
	let configuredStartupBudget = options.startupTaxBudget;

	if (configPresent) {
		if (loadedCfg.error) {
			configValid = false;
			configError = loadedCfg.error;
			checks.push({
				id: "skillops_config",
				title: "Declarative Config (.skillops.yml)",
				status: "fail",
				summary: `Invalid .skillops.yml: ${configError}`,
			});
			remediation.push(
				"Fix schema errors in .skillops.yml or run 'npx skillops-cli@latest init' to regenerate it.",
			);
		} else {
			if (
				configuredStartupBudget === undefined &&
				loadedCfg.config?.token_economy.startup_tax_budget !== undefined
			) {
				configuredStartupBudget =
					loadedCfg.config.token_economy.startup_tax_budget;
			}
			checks.push({
				id: "skillops_config",
				title: "Declarative Config (.skillops.yml)",
				status: "pass",
				summary: ".skillops.yml present and conforms to SkillOpsConfigSchema.",
			});
		}
	} else {
		checks.push({
			id: "skillops_config",
			title: "Declarative Config (.skillops.yml)",
			status: "pass",
			summary: "No .skillops.yml found (using built-in SkillOps defaults).",
		});
	}

	// 4. Lockfile (.skillops-lock.json) Integrity & SHA-256 Drift Check
	const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
	const lockfilePresent =
		fs.existsSync(lockfilePath) && fs.statSync(lockfilePath).isFile();
	let lockfileValid = true;
	const artifacts: LockfileArtifactDiagnostic[] = [];

	if (lockfilePresent) {
		try {
			const raw = JSON.parse(fs.readFileSync(lockfilePath, "utf-8")) as unknown;
			const lockfile = SyncLockfileSchema.parse(raw);
			for (const entry of Object.values(lockfile.artifacts)) {
				const absPath = path.join(resolvedRepo, entry.relative_path);
				if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
					artifacts.push({
						relative_path: entry.relative_path,
						target: entry.target,
						item_name: entry.skill_name,
						expected_sha256: entry.sha256,
						actual_sha256: null,
						status: "missing",
					});
				} else {
					const content = fs.readFileSync(absPath, "utf-8");
					const actualSha = computeFileSha256(content);
					artifacts.push({
						relative_path: entry.relative_path,
						target: entry.target,
						item_name: entry.skill_name,
						expected_sha256: entry.sha256,
						actual_sha256: actualSha,
						status: actualSha === entry.sha256 ? "healthy" : "drifted",
					});
				}
			}
		} catch (err) {
			lockfileValid = false;
			const msg = err instanceof Error ? err.message : String(err);
			checks.push({
				id: "lockfile_integrity",
				title: "Lockfile SHA-256 Integrity (.skillops-lock.json)",
				status: "fail",
				summary: `Corrupted .skillops-lock.json: ${msg}`,
			});
			remediation.push(
				"Run 'npx skillops-cli@latest sync --force' to rebuild .skillops-lock.json.",
			);
		}
	}

	const healthyCount = artifacts.filter((a) => a.status === "healthy").length;
	const driftedCount = artifacts.filter((a) => a.status === "drifted").length;
	const missingCount = artifacts.filter((a) => a.status === "missing").length;

	if (lockfilePresent && lockfileValid) {
		if (driftedCount > 0 || missingCount > 0) {
			checks.push({
				id: "lockfile_integrity",
				title: "Lockfile SHA-256 Integrity (.skillops-lock.json)",
				status: "fail",
				summary: `${healthyCount}/${artifacts.length} healthy, ${driftedCount} drifted, ${missingCount} missing artifact(s).`,
			});
			remediation.push(
				"Run 'npx skillops-cli@latest sync --force' to restore drifted/missing artifacts or update .skillops-lock.json.",
			);
		} else {
			checks.push({
				id: "lockfile_integrity",
				title: "Lockfile SHA-256 Integrity (.skillops-lock.json)",
				status: "pass",
				summary: `All ${artifacts.length} tracked artifact(s) match their SHA-256 lockfile signatures.`,
			});
		}
	} else if (!lockfilePresent) {
		checks.push({
			id: "lockfile_integrity",
			title: "Lockfile SHA-256 Integrity (.skillops-lock.json)",
			status: "pass",
			summary:
				"No .skillops-lock.json present (no synced runtime artifacts tracked yet).",
		});
	}

	// 5. Startup Token Tax Check
	const effectiveBudget = configuredStartupBudget ?? 2500;
	const tokenReport = analyzeRepoTokenEconomy(resolvedRepo, {
		catalogDir: options.catalogDir,
		startupTaxBudget: effectiveBudget,
	});
	checks.push({
		id: "startup_token_tax",
		title: "Startup Token Tax Budget",
		status: tokenReport.passed_budget ? "pass" : "warn",
		summary: `${tokenReport.startup_token_tax}/${tokenReport.startup_tax_budget} tokens (${
			tokenReport.passed_budget ? "within budget" : "exceeds budget"
		}, ${tokenReport.token_savings_pct}% saved via Progressive Disclosure).`,
	});
	if (!tokenReport.passed_budget) {
		remediation.push(
			`Reduce always-on startup context (${tokenReport.startup_token_tax} > ${tokenReport.startup_tax_budget} tokens) by moving instructions into on-demand SKILL.md bodies.`,
		);
	}

	const hasFail = checks.some((c) => c.status === "fail");
	const hasWarn = checks.some((c) => c.status === "warn");
	const overallStatus: "pass" | "warn" | "fail" = hasFail
		? "fail"
		: hasWarn
			? "warn"
			: "pass";

	return {
		status: overallStatus,
		repo_path: repoLabel,
		node_version: nodeVersion,
		python_version: pythonVersion,
		detected_harnesses: detectedHarnesses,
		config_present: configPresent,
		config_valid: configValid,
		...(configError ? { config_error: configError } : {}),
		lockfile_present: lockfilePresent,
		lockfile_valid: lockfileValid,
		tracked_artifacts_count: artifacts.length,
		healthy_artifacts_count: healthyCount,
		drifted_artifacts_count: driftedCount,
		missing_artifacts_count: missingCount,
		artifacts,
		startup_tax_tokens: tokenReport.startup_token_tax,
		startup_tax_budget: tokenReport.startup_tax_budget,
		startup_tax_within_budget: tokenReport.passed_budget,
		checks,
		remediation,
	};
}

/**
 * Inspect all 20 supported AI coding agent harnesses and report which ones are detected in `repoPath`.
 */
export function inspectHarnesses(repoPath: string): HarnessInspectionReport {
	const resolvedRepo = path.resolve(repoPath);
	const repoLabel = path.basename(resolvedRepo) || ".";
	const detectedHarnesses = detectInstalledHarnesses(resolvedRepo);
	const detectedSet = new Set<RuntimeTarget>(detectedHarnesses);

	const harnesses: HarnessInspectionEntry[] = ALL_RUNTIME_TARGETS.map(
		(target) => ({
			...RUNTIME_HARNESS_SPECS[target],
			detected: detectedSet.has(target),
		}),
	);

	return {
		repo_path: repoLabel,
		total_supported: harnesses.length,
		detected_count: detectedHarnesses.length,
		detected_harnesses: detectedHarnesses,
		harnesses,
	};
}

/**
 * Format a `HarnessInspectionReport` as a terminal table, Markdown table, or JSON string.
 */
export function formatHarnessInspectionReport(
	report: HarnessInspectionReport,
	format: "table" | "json" | "markdown" = "table",
): string {
	if (format === "json") {
		return `${JSON.stringify(report, null, 2)}\n`;
	}

	if (format === "markdown") {
		const lines: string[] = [
			`## SkillOps Universal Top-28 AI Coding Agent Harnesses (\`${report.repo_path}\`)`,
			"",
			`- **Supported AI Coding Harnesses:** \`${report.total_supported}\``,
			`- **Detected in Repository:** \`${report.detected_count}\` (${
				report.detected_harnesses.length > 0
					? report.detected_harnesses.join(", ")
					: "none"
			})`,
			"",
			"| Target ID | AI Coding Agent / IDE | Vendor | Category | Skills Path | Subagents Path | MCP Config | Detected |",
			"| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: |",
			...report.harnesses.map(
				(h) =>
					`| \`${h.id}\` | **${h.displayName}** | ${h.vendor} | \`${h.category}\` | \`${h.skillsDir}\` | \`${h.subagentsDir}\` | ${
						h.mcpConfigPath ? `\`${h.mcpConfigPath}\`` : "—"
					} | ${h.detected ? "YES" : "NO"} |`,
			),
			"",
		];
		return lines.join("\n");
	}

	const lines: string[] = [
		`=== SkillOps Universal Top-28 AI Coding Harnesses (${report.repo_path}) ===`,
		`Supported Harnesses : ${report.total_supported}`,
		`Detected in Repo    : ${report.detected_count} (${
			report.detected_harnesses.length > 0
				? report.detected_harnesses.join(", ")
				: "none"
		})`,
		"-".repeat(92),
		...report.harnesses.map(
			(h) =>
				`  [${h.detected ? "DETECTED" : "READY   "}] ${h.id.padEnd(11)} | ${h.displayName.padEnd(32)} | skills=${h.skillsDir} | mcp=${
					h.mcpConfigPath ?? "n/a"
				}`,
		),
		"",
	];
	return lines.join("\n");
}

/**
 * Format a `DoctorReport` as a terminal table, Markdown report, or JSON string.
 */
export function formatDoctorReport(
	report: DoctorReport,
	format: "table" | "json" | "markdown" | "github" = "table",
): string {
	if (format === "json") {
		return JSON.stringify(report, null, 2);
	}

	if (format === "github") {
		const lines: string[] = [];
		for (const art of report.artifacts) {
			if (art.status !== "healthy") {
				lines.push(
					`::error file=${art.relative_path},title=SkillOps Lockfile ${art.status.toUpperCase()}::Artifact '${art.relative_path}' (${art.target} :: ${art.item_name}) is ${art.status}.`,
				);
			}
		}
		for (const check of report.checks) {
			if (check.status === "fail") {
				lines.push(
					`::error title=SkillOps Doctor (${check.title})::${check.summary}`,
				);
			} else if (check.status === "warn") {
				lines.push(
					`::warning title=SkillOps Doctor (${check.title})::${check.summary}`,
				);
			}
		}
		lines.push(
			`::notice title=SkillOps Doctor::Overall status ${report.status.toUpperCase()} (${report.healthy_artifacts_count}/${report.tracked_artifacts_count} artifacts healthy, Startup Tax ${report.startup_tax_tokens}/${report.startup_tax_budget}t).`,
		);
		return lines.join("\n");
	}

	if (format === "markdown") {
		const lines: string[] = [
			`# SkillOps Doctor & Lockfile Status Report (\`${report.repo_path}\`)`,
			"",
			`- **Overall Status:** \`${report.status.toUpperCase()}\``,
			`- **Node.js Runtime:** \`${report.node_version}\``,
			`- **Python Runtime:** \`${report.python_version ?? "not detected"}\``,
			`- **Detected AI Harnesses:** \`${
				report.detected_harnesses.length > 0
					? report.detected_harnesses.join(", ")
					: "none"
			}\``,
			`- **Tracked Artifacts:** \`${report.healthy_artifacts_count}/${report.tracked_artifacts_count}\` healthy (\`${report.drifted_artifacts_count}\` drifted, \`${report.missing_artifacts_count}\` missing)`,
			`- **Startup Token Tax:** \`${report.startup_tax_tokens} / ${report.startup_tax_budget}\` tokens`,
			"",
			"## Diagnostic Checks",
			"",
			"| Check | Status | Summary |",
			"| :--- | :---: | :--- |",
			...report.checks.map(
				(c) =>
					`| **${c.title}** | \`${c.status.toUpperCase()}\` | ${c.summary} |`,
			),
		];

		if (report.artifacts.length > 0) {
			lines.push(
				"",
				"## Lockfile Artifact Status (`.skillops-lock.json`)",
				"",
				"| Path | Runtime | Item | Status |",
				"| :--- | :--- | :--- | :---: |",
				...report.artifacts.map(
					(a) =>
						`| \`${a.relative_path}\` | \`${a.target}\` | \`${a.item_name}\` | \`${a.status.toUpperCase()}\` |`,
				),
			);
		}

		if (report.remediation.length > 0) {
			lines.push(
				"",
				"## Recommended Remediation",
				"",
				...report.remediation.map((r) => `- ${r}`),
			);
		}

		return lines.join("\n");
	}

	const lines: string[] = [
		`SkillOps Doctor & Lockfile Diagnostics (${report.repo_path})`,
		"=".repeat(64),
		`Overall Status     : ${report.status.toUpperCase()}`,
		`Node.js Runtime    : ${report.node_version}`,
		`Python Runtime     : ${report.python_version ?? "not detected"}`,
		`Detected Harnesses : ${
			report.detected_harnesses.length > 0
				? report.detected_harnesses.join(", ")
				: "none"
		}`,
		`Declarative Config : ${
			!report.config_present
				? "not present (defaults)"
				: report.config_valid
					? "valid (.skillops.yml)"
					: "INVALID (.skillops.yml)"
		}`,
		`Lockfile Status    : ${
			!report.lockfile_present
				? "not present (0 tracked artifacts)"
				: !report.lockfile_valid
					? "CORRUPTED (.skillops-lock.json)"
					: `${report.healthy_artifacts_count}/${report.tracked_artifacts_count} healthy, ${report.drifted_artifacts_count} drifted, ${report.missing_artifacts_count} missing`
		}`,
		`Startup Token Tax  : ${report.startup_tax_tokens}/${report.startup_tax_budget} tokens (${
			report.startup_tax_within_budget ? "PASS" : "WARN"
		})`,
		"-".repeat(64),
		"Diagnostic Checks:",
	];

	for (const check of report.checks) {
		const badge =
			check.status === "pass"
				? "[PASS]"
				: check.status === "warn"
					? "[WARN]"
					: "[FAIL]";
		lines.push(`  ${badge} ${check.title}: ${check.summary}`);
	}

	if (report.artifacts.length > 0) {
		lines.push("-".repeat(64), "Tracked Lockfile Artifacts:");
		for (const art of report.artifacts) {
			const badge =
				art.status === "healthy"
					? "[HEALTHY]"
					: art.status === "drifted"
						? "[DRIFTED]"
						: "[MISSING]";
			lines.push(
				`  ${badge} ${art.relative_path} (${art.target} :: ${art.item_name})`,
			);
		}
	}

	if (report.remediation.length > 0) {
		lines.push("-".repeat(64), "Remediation:");
		for (const rem of report.remediation) {
			lines.push(`  - ${rem}`);
		}
	}

	return lines.join("\n");
}
