import { COMPILED_STORIES, type CompiledStory } from './compiled';
import { externalNameToCapabilityId } from '../ink/harness';

/**
 * The published story set.
 *
 * Stories are immutable per version. Nothing patches a running story's source
 * in place, because a saved runtime state is only valid against the exact
 * compiled content it was taken from.
 */

export const OPEN_CONVERSATION_ID = 'open-conversation';

/**
 * The story that renders host-supplied reply text. It is not a conversation
 * position, so it is never entered through a checkpoint or offered to a
 * resolver; the host calls it directly for every visible reply.
 */
export const REPLY_SURFACE_ID = 'reply-surface';

const BY_ID = new Map<string, CompiledStory>(COMPILED_STORIES.map((s) => [s.id, s]));

export function getStory(id: string): CompiledStory | null {
  return BY_ID.get(id) ?? null;
}

export function listStories(): CompiledStory[] {
  return [...COMPILED_STORIES];
}

/**
 * Every capability the published stories can reach.
 *
 * Startup checks this against the registry, so a story that references a
 * capability nobody installed is caught before a user can select the branch,
 * not when they select it.
 */
export function requiredCapabilities(): string[] {
  const out = new Set<string>();
  for (const story of COMPILED_STORIES) {
    for (const external of story.externals) {
      const id = externalNameToCapabilityId(external);
      if (id) out.add(id);
    }
  }
  return [...out].sort();
}

/** External names that do not map to a capability id at all. */
export function unmappableExternals(): { storyId: string; external: string }[] {
  const out: { storyId: string; external: string }[] = [];
  for (const story of COMPILED_STORIES) {
    for (const external of story.externals) {
      if (!externalNameToCapabilityId(external)) out.push({ storyId: story.id, external });
    }
  }
  return out;
}
