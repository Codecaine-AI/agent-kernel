/**
 * skill.ts — Registry-backed skill loader.
 *
 * Resolves `decl.name` against an app-provided skill registry. Rendering
 * branches on `decl.mode`:
 *   - "force": wraps the full SKILL.md body in `<skill name="...">…</skill>`.
 *   - "dynamic" (default): wraps the skill description + a `skill_read` pointer
 *     in `<skill name="..." mode="dynamic">…</skill>`; the body is NOT baked in.
 *
 * Unknown skill id ⇒ status='error'. Empty SKILL.md in force mode ⇒ status='empty'.
 */

import { hashContent } from "./catalog";
import type { Loader, SkillLoaderDeclaration } from "./types";

export interface SkillRegistryLike {
	getSkill(name: string): {
		description: string;
		files: Record<string, string | undefined>;
	} | undefined;
}

export function createSkillLoader(
	skillRegistry: SkillRegistryLike,
): Loader<SkillLoaderDeclaration> {
	return {
	kind: "skill",
	resolve: async (decl, _ctx) => {
		const skill = skillRegistry.getSkill(decl.name);
		if (!skill) {
			return {
				status: "error",
				content: "",
				bytes: 0,
				hash: "",
				error: `skill not found: ${decl.name}`,
			};
		}

		const mode = decl.mode ?? "dynamic";

		if (mode === "force") {
			const body = skill.files["SKILL.md"] ?? "";
			if (body.trim().length === 0) {
				return { status: "empty", content: "", bytes: 0, hash: hashContent("") };
			}
			const wrapped = `<skill name="${decl.name}">\n${body}\n</skill>`;
			return {
				status: "ok",
				content: wrapped,
				bytes: Buffer.byteLength(wrapped, "utf8"),
				hash: hashContent(wrapped),
			};
		}

		const wrapped = `<skill name="${decl.name}" mode="dynamic">\n${skill.description}\n\nFetch full content via skill_read({ skill: "${decl.name}" }).\n</skill>`;
		return {
			status: "ok",
			content: wrapped,
			bytes: Buffer.byteLength(wrapped, "utf8"),
			hash: hashContent(wrapped),
		};
	},
	};
}
