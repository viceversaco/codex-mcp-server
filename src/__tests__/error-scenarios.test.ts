import { CodexToolHandler, ReviewToolHandler } from '../tools/handlers.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { executeCommand } from '../utils/command.js';
import { ToolExecutionError, ValidationError } from '../errors.js';
import { DEFAULT_CODEX_MODEL } from '../types.js';

// Mock the command execution
jest.mock('../utils/command.js', () => ({
  executeCommand: jest.fn(),
}));

const mockedExecuteCommand = executeCommand as jest.MockedFunction<
  typeof executeCommand
>;

describe('Error Handling Scenarios', () => {
  let handler: CodexToolHandler;
  let sessionStorage: InMemorySessionStorage;

  beforeEach(() => {
    sessionStorage = new InMemorySessionStorage();
    handler = new CodexToolHandler(sessionStorage);
    mockedExecuteCommand.mockClear();
  });

  test('should handle codex CLI authentication errors', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('Authentication failed: Please run `codex login`')
    );

    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({ prompt: 'Test prompt', sessionId })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle codex CLI not found errors', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('command not found: codex')
    );

    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({ prompt: 'Test prompt', sessionId })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle invalid model parameters', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('Invalid model: invalid-model')
    );

    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({
        prompt: 'Test prompt',
        sessionId,
        model: 'invalid-model',
      })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle codex CLI timeout errors', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('Timeout: Command took too long to execute')
    );

    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({ prompt: 'Complex analysis task', sessionId })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle network errors during codex execution', async () => {
    mockedExecuteCommand.mockRejectedValue(
      new Error('Network error: Unable to reach OpenAI API')
    );

    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({ prompt: 'Test prompt', sessionId })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle non-existent session IDs gracefully', async () => {
    // Passing a sessionId that doesn't yet exist in storage is fine —
    // ensureSession() lazily creates it for valid IDs.
    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    const result = await handler.execute({
      prompt: 'Test prompt',
      sessionId: 'non-existent-session-id',
    });

    expect(result.content[0].text).toBe('Response');
  });

  test('should reject review prompt with uncommitted', async () => {
    const reviewHandler = new ReviewToolHandler();

    await expect(
      reviewHandler.execute({
        prompt: 'Review instructions',
        uncommitted: true,
      })
    ).rejects.toThrow(ValidationError);

    expect(mockedExecuteCommand).not.toHaveBeenCalled();
  });

  test('should reject invalid sessionId values', async () => {
    await expect(
      handler.execute({
        prompt: 'Test prompt',
        sessionId: 'bad id',
      })
    ).rejects.toThrow(ValidationError);

    expect(mockedExecuteCommand).not.toHaveBeenCalled();
  });

  test('should handle corrupted session data', async () => {
    const sessionId = sessionStorage.createSession();

    // Manually corrupt session data
    const session = sessionStorage.getSession(sessionId);
    if (session) {
      (session.turns as unknown) = null; // Corrupt the turns array
    }

    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    // Should not crash, should handle gracefully
    const result = await handler.execute({
      prompt: 'Test prompt',
      sessionId,
    });

    expect(result.content[0].text).toBe('Response');
  });

  test('should handle malformed resume conversation IDs', async () => {
    const sessionId = sessionStorage.createSession();
    sessionStorage.setCodexConversationId(sessionId, 'invalid-conv-id-format');

    mockedExecuteCommand.mockRejectedValue(
      new Error('Invalid conversation ID format')
    );

    await expect(
      handler.execute({
        prompt: 'Resume test',
        sessionId,
      })
    ).rejects.toThrow(ToolExecutionError);
  });

  test('should handle very long prompts', async () => {
    const longPrompt = 'A'.repeat(100000); // 100k character prompt

    mockedExecuteCommand.mockResolvedValue({ stdout: 'Response', stderr: '' });

    const sessionId = sessionStorage.createSession();
    const result = await handler.execute({ prompt: longPrompt, sessionId });

    expect(result.content[0].text).toBe('Response');
    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining([
        'exec',
        '--model',
        DEFAULT_CODEX_MODEL,
        '--skip-git-repo-check',
        longPrompt,
      ]),
      expect.any(Object)
    );
  });
});
