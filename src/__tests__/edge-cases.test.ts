import { CodexToolHandler } from '../tools/handlers.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { executeCommand } from '../utils/command.js';

// Mock the command execution
jest.mock('../utils/command.js', () => ({
  executeCommand: jest.fn(),
}));

const mockedExecuteCommand = executeCommand as jest.MockedFunction<
  typeof executeCommand
>;

describe('Edge Cases and Integration Issues', () => {
  let handler: CodexToolHandler;
  let sessionStorage: InMemorySessionStorage;

  beforeEach(() => {
    sessionStorage = new InMemorySessionStorage();
    handler = new CodexToolHandler(sessionStorage);
    mockedExecuteCommand.mockClear();
    delete process.env.CODEX_DEFAULT_REASONING_EFFORT;
  });

  test('should handle model parameters with resume', async () => {
    const sessionId = sessionStorage.createSession();
    sessionStorage.setCodexConversationId(sessionId, 'existing-conv-id');

    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    // User wants to change model in existing session
    await handler.execute({
      prompt: 'Use different model',
      sessionId,
      model: 'gpt-4',
      reasoningEffort: 'high',
    });

    // Resume mode: all exec options must come BEFORE 'resume' subcommand
    const call = mockedExecuteCommand.mock.calls[0];
    expect(call[1]).toEqual([
      'exec',
      '--skip-git-repo-check',
      '-c',
      'model="gpt-4"',
      '-c',
      'model_reasoning_effort="high"',
      'resume',
      'existing-conv-id',
      'Use different model',
    ]);
  });

  test('should handle missing session ID gracefully', async () => {
    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Response without session ID',
      stderr: 'Some other output', // No session ID pattern
    });

    const sessionId = sessionStorage.createSession();
    await handler.execute({
      prompt: 'Test prompt',
      sessionId,
    });

    // Should not crash, codex session ID should be undefined
    expect(sessionStorage.getCodexConversationId(sessionId)).toBeUndefined();
  });

  test('should handle various session ID formats', async () => {
    const testCases = [
      'session id: abc-123-def',
      'Session ID: XYZ789',
      'session id:uuid-format-here',
      'Session id:  spaced-format  ',
    ];

    for (const [index, stderr] of testCases.entries()) {
      const sessionId = sessionStorage.createSession();
      mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr });

      await handler.execute({
        prompt: `Test ${index}`,
        sessionId,
      });

      const extractedId = sessionStorage.getCodexConversationId(sessionId);
      expect(extractedId).toBeDefined();
      expect(extractedId).not.toContain('session');
      expect(extractedId).not.toContain(':');
    }
  });

  test('should handle command execution failures', async () => {
    mockedExecuteCommand.mockRejectedValue(new Error('Codex CLI not found'));

    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({ prompt: 'Test prompt', sessionId })
    ).rejects.toThrow('Failed to execute codex command');
  });

  test('should handle empty/malformed CLI responses', async () => {
    mockedExecuteCommand.mockResolvedValue({ stdout: '', stderr: '' });

    const sessionId = sessionStorage.createSession();
    const result = await handler.execute({
      prompt: 'Test prompt',
      sessionId,
    });

    expect(result.content[0].text).toBe('No output from Codex');
  });

  test('should validate prompt parameter exists', async () => {
    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({ sessionId }) // Missing required prompt
    ).rejects.toThrow();
  });

  test('should require sessionId (no longer optional)', async () => {
    // sessionId is now REQUIRED by the schema. Calls without it must reject.
    await expect(handler.execute({ prompt: 'Test prompt' })).rejects.toThrow();
  });

  test('should handle long conversation contexts', async () => {
    const sessionId = sessionStorage.createSession();

    // Add many turns to test context building
    for (let i = 0; i < 10; i++) {
      sessionStorage.addTurn(sessionId, {
        prompt: `Question ${i}`,
        response: `Answer ${i}`.repeat(100), // Long responses
        timestamp: new Date(),
      });
    }

    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    await handler.execute({
      prompt: 'Final question',
      sessionId,
    });

    // Should only use recent turns, not crash with too much context.
    // Locate the prompt argument by content rather than fixed index.
    const call = mockedExecuteCommand.mock.calls[0];
    const args = (call?.[1] as string[]) || [];
    const prompt = args.find(
      (a) => typeof a === 'string' && a.includes('Final question')
    );
    expect(typeof prompt).toBe('string');
    if (prompt) {
      expect(prompt.length).toBeLessThan(5000); // Reasonable limit
    }
  });
});
