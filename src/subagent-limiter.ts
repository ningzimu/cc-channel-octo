import type {
  HookCallback,
  HookJSONOutput,
  Options,
} from '@anthropic-ai/claude-agent-sdk';

type SdkHooks = NonNullable<Options['hooks']>;

function denyAgent(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Build root-turn-local hooks that prevent recursive Agent fan-out and cap
 * concurrent root subagents. A slot is reserved before Agent runs and released
 * only after the SDK reports that the admitted subagent stopped. If the SDK
 * never emits a matching lifecycle, the slot stays conservatively reserved for
 * the remainder of this root turn rather than risking an over-limit launch.
 */
export function createSubagentHooks(maxConcurrentAgents: number): SdkHooks {
  if (!Number.isInteger(maxConcurrentAgents) || maxConcurrentAgents < 0) {
    throw new Error('maxConcurrentAgents must be a non-negative integer');
  }

  let admittedCount = 0;
  let pendingStarts = 0;
  const activeAgentIds = new Set<string>();

  const beforeAgent: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Agent') return {};

    if (input.agent_id) {
      return denyAgent('Nested subagents are not supported by cc-channel-octo.');
    }

    if (admittedCount >= maxConcurrentAgents) {
      return denyAgent(
        `Subagent concurrency limit of ${maxConcurrentAgents} reached for this root turn.`,
      );
    }

    admittedCount += 1;
    pendingStarts += 1;
    return {};
  };

  const onSubagentStart: HookCallback = async (input) => {
    if (input.hook_event_name !== 'SubagentStart') return {};
    if (pendingStarts === 0 || activeAgentIds.has(input.agent_id)) return {};

    pendingStarts -= 1;
    activeAgentIds.add(input.agent_id);
    return {};
  };

  const onSubagentStop: HookCallback = async (input) => {
    if (input.hook_event_name !== 'SubagentStop') return {};
    if (activeAgentIds.delete(input.agent_id)) admittedCount -= 1;
    return {};
  };

  return {
    PreToolUse: [{ matcher: 'Agent', hooks: [beforeAgent] }],
    SubagentStart: [{ hooks: [onSubagentStart] }],
    SubagentStop: [{ hooks: [onSubagentStop] }],
  };
}
