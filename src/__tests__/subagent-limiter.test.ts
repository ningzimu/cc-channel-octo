import { describe, expect, it } from 'vitest';
import type {
  HookCallback,
  PreToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { createSubagentHooks } from '../subagent-limiter.js';

const hookOptions = { signal: new AbortController().signal };

function getHook(
  hooks: ReturnType<typeof createSubagentHooks>,
  event: 'PreToolUse' | 'SubagentStart' | 'SubagentStop',
): HookCallback {
  const hook = hooks[event]?.[0]?.hooks[0];
  if (!hook) throw new Error(`Missing ${event} hook`);
  return hook;
}

function preToolUse(
  toolUseId: string,
  toolName = 'Agent',
  agentId?: string,
): PreToolUseHookInput {
  return {
    session_id: 'session-1',
    transcript_path: '/tmp/session.jsonl',
    cwd: '/tmp/workspace',
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: {},
    tool_use_id: toolUseId,
    ...(agentId ? { agent_id: agentId } : {}),
  };
}

function subagentStart(agentId: string): SubagentStartHookInput {
  return {
    session_id: 'session-1',
    transcript_path: '/tmp/session.jsonl',
    cwd: '/tmp/workspace',
    hook_event_name: 'SubagentStart',
    agent_id: agentId,
    agent_type: 'general-purpose',
  };
}

function subagentStop(agentId: string): SubagentStopHookInput {
  return {
    session_id: 'session-1',
    transcript_path: '/tmp/session.jsonl',
    cwd: '/tmp/workspace',
    hook_event_name: 'SubagentStop',
    stop_hook_active: false,
    agent_id: agentId,
    agent_type: 'general-purpose',
    agent_transcript_path: `/tmp/${agentId}.jsonl`,
  };
}

function decision(output: Awaited<ReturnType<HookCallback>>): string | undefined {
  const specific = output.hookSpecificOutput;
  return specific?.hookEventName === 'PreToolUse'
    ? specific.permissionDecision
    : undefined;
}

describe('createSubagentHooks', () => {
  it('denies Agent calls made by a subagent', async () => {
    const hooks = createSubagentHooks(6);
    const output = await getHook(hooks, 'PreToolUse')(
      preToolUse('nested', 'Agent', 'parent-agent'),
      'nested',
      hookOptions,
    );

    expect(decision(output)).toBe('deny');
    expect(output.hookSpecificOutput).toMatchObject({
      permissionDecisionReason: 'Nested subagents are not supported by cc-channel-octo.',
    });
  });

  it('caps concurrent root subagents and frees a slot on stop', async () => {
    const hooks = createSubagentHooks(2);
    const before = getHook(hooks, 'PreToolUse');
    const start = getHook(hooks, 'SubagentStart');
    const stop = getHook(hooks, 'SubagentStop');

    expect(decision(await before(preToolUse('tool-1'), 'tool-1', hookOptions))).toBeUndefined();
    expect(decision(await before(preToolUse('tool-2'), 'tool-2', hookOptions))).toBeUndefined();
    expect(decision(await before(preToolUse('tool-3'), 'tool-3', hookOptions))).toBe('deny');

    await start(subagentStart('agent-1'), undefined, hookOptions);
    await stop(subagentStop('agent-1'), undefined, hookOptions);

    expect(decision(await before(preToolUse('tool-4'), 'tool-4', hookOptions))).toBeUndefined();
  });

  it('supports zero as a hard disable for root Agent calls', async () => {
    const hooks = createSubagentHooks(0);
    const output = await getHook(hooks, 'PreToolUse')(
      preToolUse('tool-1'),
      'tool-1',
      hookOptions,
    );

    expect(decision(output)).toBe('deny');
    expect(output.hookSpecificOutput).toMatchObject({
      permissionDecisionReason: 'Subagent concurrency limit of 0 reached for this root turn.',
    });
  });

  it('does not count non-Agent tools against the limit', async () => {
    const hooks = createSubagentHooks(1);
    const before = getHook(hooks, 'PreToolUse');

    await before(preToolUse('read-1', 'Read'), 'read-1', hookOptions);
    expect(decision(await before(preToolUse('agent-1'), 'agent-1', hookOptions))).toBeUndefined();
    expect(decision(await before(preToolUse('agent-2'), 'agent-2', hookOptions))).toBe('deny');
  });

  it('keeps limits isolated between root turns', async () => {
    const firstRoot = createSubagentHooks(1);
    const secondRoot = createSubagentHooks(1);

    await getHook(firstRoot, 'PreToolUse')(preToolUse('first'), 'first', hookOptions);
    const output = await getHook(secondRoot, 'PreToolUse')(
      preToolUse('second'),
      'second',
      hookOptions,
    );

    expect(decision(output)).toBeUndefined();
  });

  it('rejects invalid programmatic limits', () => {
    expect(() => createSubagentHooks(-1)).toThrow(/non-negative integer/);
    expect(() => createSubagentHooks(1.5)).toThrow(/non-negative integer/);
  });
});
