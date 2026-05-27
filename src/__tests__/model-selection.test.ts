import { CodexToolHandler } from '../tools/handlers.js';
import { InMemorySessionStorage } from '../session/storage.js';
import { executeCommand } from '../utils/command.js';
import { DEFAULT_CODEX_MODEL } from '../types.js';

// Mock the command execution
jest.mock('../utils/command.js', () => ({
  executeCommand: jest.fn(),
}));

const mockedExecuteCommand = executeCommand as jest.MockedFunction<
  typeof executeCommand
>;

describe('Model Selection and Reasoning Effort', () => {
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
    delete process.env.CODEX_DEFAULT_REASONING_EFFORT;
  });

  test('should pass model parameter to codex CLI', async () => {
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

  test('should pass reasoning effort to codex CLI', async () => {
    const sessionId = sessionStorage.createSession();
    await handler.execute({
      prompt: 'Complex analysis',
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
        'Complex analysis',
      ],
      expect.any(Object)
    );
  });

  test('should combine model and reasoning effort', async () => {
    const sessionId = sessionStorage.createSession();
    await handler.execute({
      prompt: 'Advanced task',
      sessionId,
      model: 'gpt-4',
      reasoningEffort: 'medium',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--model',
        'gpt-4',
        '-c',
        'model_reasoning_effort="medium"',
        '--skip-git-repo-check',
        'Advanced task',
      ],
      expect.any(Object)
    );
  });

  test('should include model info in response metadata', async () => {
    const sessionId = sessionStorage.createSession();
    const result = await handler.execute({
      prompt: 'Test prompt',
      sessionId,
      model: 'gpt-3.5-turbo',
      reasoningEffort: 'low',
    });

    expect(result.content[0]._meta?.model).toBe('gpt-3.5-turbo');
    expect(result.structuredContent?.model).toBe('gpt-3.5-turbo');
  });

  test('should work with sessions and model selection', async () => {
    const sessionId = sessionStorage.createSession();

    const result = await handler.execute({
      prompt: 'Session test',
      sessionId,
      model: 'gpt-4',
    });

    expect(result.content[0]._meta?.model).toBe('gpt-4');
    expect(result.content[0]._meta?.sessionId).toBe(sessionId);
    expect(result.structuredContent?.model).toBe('gpt-4');
    expect(result.structuredContent?.sessionId).toBe(sessionId);
  });

  test('should validate reasoning effort enum', async () => {
    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({
        prompt: 'Test',
        sessionId,
        reasoningEffort: 'invalid' as 'low',
      })
    ).rejects.toThrow();
  });

  test("should reject 'minimal' reasoning effort (intentionally removed)", async () => {
    // 'minimal' is no longer accepted: Codex's auto-enabled image_gen/web_search
    // tools reject it with a 400. The fork explicitly removed it from the enum.
    const sessionId = sessionStorage.createSession();
    await expect(
      handler.execute({
        prompt: 'Quick task',
        sessionId,
        reasoningEffort: 'minimal' as 'low',
      })
    ).rejects.toThrow();
  });

  test('should pass none reasoning effort to CLI', async () => {
    const sessionId = sessionStorage.createSession();
    await handler.execute({
      prompt: 'Simple task',
      sessionId,
      reasoningEffort: 'none',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--model',
        DEFAULT_CODEX_MODEL,
        '-c',
        'model_reasoning_effort="none"',
        '--skip-git-repo-check',
        'Simple task',
      ],
      expect.any(Object)
    );
  });

  test('should pass xhigh reasoning effort to CLI', async () => {
    const sessionId = sessionStorage.createSession();
    await handler.execute({
      prompt: 'Complex task',
      sessionId,
      reasoningEffort: 'xhigh',
    });

    expect(mockedExecuteCommand).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--model',
        DEFAULT_CODEX_MODEL,
        '-c',
        'model_reasoning_effort="xhigh"',
        '--skip-git-repo-check',
        'Complex task',
      ],
      expect.any(Object)
    );
  });
});
