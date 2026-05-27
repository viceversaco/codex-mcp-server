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

describe('Context Building Analysis', () => {
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
  });

  test('should build enhanced prompt correctly', async () => {
    const sessionId = sessionStorage.createSession();

    // Add some conversation history
    sessionStorage.addTurn(sessionId, {
      prompt: 'What is recursion?',
      response:
        'Recursion is a programming technique where a function calls itself.',
      timestamp: new Date(),
    });

    sessionStorage.addTurn(sessionId, {
      prompt: 'Show me an example',
      response: 'def factorial(n): return 1 if n <= 1 else n * factorial(n-1)',
      timestamp: new Date(),
    });

    // Execute with context
    await handler.execute({ prompt: 'Make it more efficient', sessionId });

    // The enhanced prompt is the last arg passed to codex. Locate it by content
    // rather than hardcoded index — args layout shifts as defaults are added.
    const call = mockedExecuteCommand.mock.calls[0];
    const args = (call?.[1] as string[]) || [];
    const sentPrompt = args.find(
      (a) => typeof a === 'string' && a.includes('Task: Make it more efficient')
    );
    expect(sentPrompt).toBeDefined();
    expect(sentPrompt).toContain('Previous code context:');
    expect(sentPrompt).toContain('Task: Make it more efficient');
    expect(sentPrompt).not.toContain('Previous: What is recursion?'); // No conversational format
  });

  test('should not automatically create sessions', async () => {
    const initialSessions = sessionStorage.listSessions().length;

    const sessionId = sessionStorage.createSession();
    // Track sessions after createSession but before handler.execute
    const afterCreateSessions = sessionStorage.listSessions().length;

    await handler.execute({ prompt: 'Simple test', sessionId });

    const newSessions = sessionStorage.listSessions().length;
    // Handler should not create additional sessions beyond the one we explicitly created
    expect(newSessions).toBe(afterCreateSessions);
    expect(afterCreateSessions).toBe(initialSessions + 1);
  });

  test('should work with sessions by default', async () => {
    const sessionId = sessionStorage.createSession();
    const result = await handler.execute({ prompt: 'Simple test', sessionId });

    expect(result.content[0].text).toBe('Test response'); // No session noise
  });

  test('should include session ID in metadata when using sessions', async () => {
    const sessionId = sessionStorage.createSession();
    const result = await handler.execute({ prompt: 'Test prompt', sessionId });

    expect(result.content[0]._meta?.sessionId).toBe(sessionId);
    expect(result.structuredContent?.sessionId).toBe(sessionId);
    expect(result.content[0].text).toBe('Test response'); // Clean response
  });

  test('should not save turn on command failure', async () => {
    mockedExecuteCommand.mockRejectedValue(new Error('Command failed'));

    const sessionId = sessionStorage.createSession();
    const initialTurns =
      sessionStorage.getSession(sessionId)?.turns.length || 0;

    try {
      await handler.execute({ prompt: 'Test prompt', sessionId });
    } catch {
      // Expected to fail
    }

    // Turn should not be saved if command failed
    const finalTurns = sessionStorage.getSession(sessionId)?.turns.length || 0;
    expect(finalTurns).toBe(initialTurns);
  });
});
