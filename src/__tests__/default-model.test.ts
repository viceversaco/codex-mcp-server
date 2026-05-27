import { CodexToolHandler } from '../tools/handlers.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { executeCommand } from '../utils/command.js';
import { DEFAULT_CODEX_MODEL, DEFAULT_REASONING_EFFORT } from '../types.js';

// Mock the command execution
jest.mock('../utils/command.js', () => ({
  executeCommand: jest.fn(),
}));

const mockedExecuteCommand = executeCommand as jest.MockedFunction<
  typeof executeCommand
>;

describe('Default Model Configuration', () => {
  let handler: CodexToolHandler;
  let sessionStorage: InMemorySessionStorage;
  let originalStructuredContent: string | undefined;

  beforeAll(() => {
    originalStructuredContent = process.env.STRUCTURED_CONTENT_ENABLED;
  });

  afterAll(() => {
    if (originalStructuredContent) {
      process.env.STRUCTURED_CONTENT_ENABLED = originalStructuredContent;
    } else {
      delete process.env.STRUCTURED_CONTENT_ENABLED;
    }
  });

  beforeEach(() => {
    sessionStorage = new InMemorySessionStorage();
    handler = new CodexToolHandler(sessionStorage);
    mockedExecuteCommand.mockClear();
    mockedExecuteCommand.mockResolvedValue({
      stdout: 'Test response',
      stderr: '',
    });
    process.env.STRUCTURED_CONTENT_ENABLED = '1';
    delete process.env.CODEX_MCP_CALLBACK_URI;
    delete process.env.CODEX_DEFAULT_REASONING_EFFORT;
  });

  test('should use default model when no model specified', async () => {
    const sessionId = sessionStorage.createSession();
    await handler.execute({ prompt: 'Test prompt', sessionId });

    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining([
        'exec',
        '--model',
        DEFAULT_CODEX_MODEL,
        '--skip-git-repo-check',
        'Test prompt',
      ]),
      expect.any(Object)
    );
  });

  test('should include default model in response metadata', async () => {
    const sessionId = sessionStorage.createSession();
    const result = await handler.execute({ prompt: 'Test prompt', sessionId });

    expect(result.content[0]._meta?.model).toBe(DEFAULT_CODEX_MODEL);
    expect(result.structuredContent?.model).toBe(DEFAULT_CODEX_MODEL);
    expect(result._meta?.callbackUri).toBeUndefined();
  });

  test('should include default reasoning effort in response metadata', async () => {
    const sessionId = sessionStorage.createSession();
    const result = await handler.execute({ prompt: 'Test prompt', sessionId });

    expect(result.content[0]._meta?.reasoningEffort).toBe(
      DEFAULT_REASONING_EFFORT
    );
  });

  test('should override default model when explicit model provided', async () => {
    const sessionId = sessionStorage.createSession();
    await handler.execute({
      prompt: 'Test prompt',
      sessionId,
      model: 'gpt-4',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining([
        'exec',
        '--model',
        'gpt-4',
        '--skip-git-repo-check',
        'Test prompt',
      ]),
      expect.any(Object)
    );
  });

  test('should use default model with sessions', async () => {
    const sessionId = sessionStorage.createSession();

    await handler.execute({
      prompt: 'Test prompt',
      sessionId,
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining([
        'exec',
        '--model',
        DEFAULT_CODEX_MODEL,
        '--skip-git-repo-check',
        'Test prompt',
      ]),
      expect.any(Object)
    );
  });

  test('should use default model with resume functionality', async () => {
    const sessionId = sessionStorage.createSession();
    sessionStorage.setCodexConversationId(sessionId, 'existing-conv-id');

    await handler.execute({
      prompt: 'Resume with default model',
      sessionId,
    });

    // Resume mode: all exec options must come BEFORE 'resume' subcommand
    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--skip-git-repo-check',
        '-c',
        `model="${DEFAULT_CODEX_MODEL}"`,
        '-c',
        `model_reasoning_effort="${DEFAULT_REASONING_EFFORT}"`,
        'resume',
        'existing-conv-id',
        'Resume with default model',
      ],
      expect.any(Object)
    );
  });

  test('should combine default model with reasoning effort', async () => {
    const sessionId = sessionStorage.createSession();
    await handler.execute({
      prompt: 'Complex task',
      sessionId,
      reasoningEffort: 'high',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--model',
        DEFAULT_CODEX_MODEL,
        '-c',
        'model_reasoning_effort="high"',
        '--skip-git-repo-check',
        'Complex task',
      ],
      expect.any(Object)
    );
  });

  test('should use CODEX_DEFAULT_MODEL environment variable when set', async () => {
    const originalEnv = process.env.CODEX_DEFAULT_MODEL;
    process.env.CODEX_DEFAULT_MODEL = 'gpt-4';

    try {
      const sessionId = sessionStorage.createSession();
      await handler.execute({ prompt: 'Test with env var', sessionId });

      expect(mockedExecuteCommand).toHaveBeenCalledWith(
        'codex',
        expect.arrayContaining([
          'exec',
          '--model',
          'gpt-4',
          '--skip-git-repo-check',
          'Test with env var',
        ]),
        expect.any(Object)
      );
    } finally {
      if (originalEnv) {
        process.env.CODEX_DEFAULT_MODEL = originalEnv;
      } else {
        delete process.env.CODEX_DEFAULT_MODEL;
      }
    }
  });

  test('should prioritize explicit model over environment variable', async () => {
    const originalEnv = process.env.CODEX_DEFAULT_MODEL;
    process.env.CODEX_DEFAULT_MODEL = 'gpt-4';

    try {
      const sessionId = sessionStorage.createSession();
      await handler.execute({
        prompt: 'Test priority',
        sessionId,
        model: 'gpt-3.5-turbo',
      });

      expect(mockedExecuteCommand).toHaveBeenCalledWith(
        'codex',
        expect.arrayContaining([
          'exec',
          '--model',
          'gpt-3.5-turbo',
          '--skip-git-repo-check',
          'Test priority',
        ]),
        expect.any(Object)
      );
    } finally {
      if (originalEnv) {
        process.env.CODEX_DEFAULT_MODEL = originalEnv;
      } else {
        delete process.env.CODEX_DEFAULT_MODEL;
      }
    }
  });
});
