import { TOOL_AREAS, type ToolArea } from '../../tools/domain/tool';

/**
 * The assistant's settings per user (F11.14–F11.16) — hand-written domain type. No row = the
 * defaults: the built-in prompt, no chat consent yet, MCP off (all areas preselected for the day
 * it is switched on, write tools off).
 */
export interface AssistantSettings {
  readonly userId: string;
  /** F11.15: the user's own system prompt; null = the built-in default. */
  readonly systemPrompt: string | null;
  /** F5.14 for the chat: the one-time notice was accepted. */
  readonly chatConsentAt: string | null;
  readonly mcpEnabled: boolean;
  readonly mcpAreas: readonly ToolArea[];
  readonly mcpAllowWrite: boolean;
  readonly updatedAt: string | null;
}

export type SaveAssistantSettings = Omit<
  AssistantSettings,
  'userId' | 'updatedAt'
>;

export const MAX_SYSTEM_PROMPT = 8000;

export function defaultAssistantSettings(userId: string): AssistantSettings {
  return {
    userId,
    systemPrompt: null,
    chatConsentAt: null,
    mcpEnabled: false,
    mcpAreas: [...TOOL_AREAS],
    mcpAllowWrite: false,
    updatedAt: null,
  };
}

/** Known areas only, each once, in the canonical order (stored JSON may be stale). */
export function cleanAreas(areas: readonly string[]): ToolArea[] {
  return TOOL_AREAS.filter((area) => areas.includes(area));
}
