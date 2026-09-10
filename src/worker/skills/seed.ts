import type { Env } from '../env';
import { SkillCatalog, GLOBAL_OWNER } from './catalog';
import { BUNDLED_SKILLS } from './bundled';

/**
 * Seeds the bundled packages into the global tier.
 *
 * Seeding is idempotent and keyed on the content hash, so a redeploy that
 * changed nothing writes nothing, and a package whose text changed becomes a
 * new revision rather than mutating the one already installed.
 *
 * Bundling reserves the name. Once a package is here, a user- or session-scoped
 * package cannot take that name, which is what stops a staged package shadowing
 * a trusted one.
 */

let seededForHash: string | null = null;

export async function ensureBundledSkills(env: Env): Promise<void> {
  const fingerprint = BUNDLED_SKILLS.map((s) => `${s.qualifiedName}@${s.revision}`).join(',');
  // Per-isolate memo. It saves the query on a warm isolate; correctness still
  // comes from the idempotent write below, because isolates are recycled.
  if (seededForHash === fingerprint) return;

  for (const skill of BUNDLED_SKILLS) {
    const existing = await env.DB.prepare(
      `SELECT revision FROM skill_catalog
       WHERE owner_scope = 'global' AND qualified_name = ? AND revision = ?`,
    )
      .bind(skill.qualifiedName, skill.revision)
      .first<{ revision: string }>();
    if (existing) continue;

    const catalog = new SkillCatalog(env);
    await catalog.stage({
      owner: GLOBAL_OWNER,
      qualifiedName: skill.qualifiedName,
      origin: skill.origin,
      source: skill.source,
      trust: 'bundled',
      resources: skill.resources,
    });
  }

  seededForHash = fingerprint;
}

/** Names the deployment reserves, whether or not seeding has run yet. */
export function bundledNames(): string[] {
  return BUNDLED_SKILLS.map((s) => s.qualifiedName);
}
