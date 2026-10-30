import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import type { TokenProvider } from './github/client';

const run = promisify(execFile);

const SCOPES = ['repo', 'read:org'];

// VS Code started from the Dock or Finder may not inherit the shell PATH.
const GH_LOCATIONS = [
  'gh',
  '/opt/homebrew/bin/gh',
  '/usr/local/bin/gh',
  '/usr/bin/gh',
  '/snap/bin/gh',
  'C:\\Program Files\\GitHub CLI\\gh.exe',
];

export type AuthState =
  | { status: 'checking' }
  | { status: 'signedOut'; ghPath: string | undefined }
  | { status: 'signedIn'; token: string; source: 'gh' | 'vscode' };

async function findGh(configuredPath: string): Promise<string | undefined> {
  for (const candidate of configuredPath ? [configuredPath] : GH_LOCATIONS) {
    try {
      await run(candidate, ['--version'], { timeout: 5_000 });
      return candidate;
    } catch {
      // Not at this location.
    }
  }
  return undefined;
}

async function readGhToken(gh: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(gh, ['auth', 'token', '--hostname', 'github.com'], { timeout: 10_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export class AuthManager implements TokenProvider, vscode.Disposable {
  private state: AuthState = { status: 'checking' };
  private checking: Promise<void> | undefined;
  private loginTerminal: vscode.Terminal | undefined;
  private readonly rejectedTokens = new Set<string>();
  private readonly changed = new vscode.EventEmitter<AuthState>();
  private readonly disposables: vscode.Disposable[] = [this.changed];

  readonly onDidChange = this.changed.event;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.disposables.push(
      vscode.authentication.onDidChangeSessions((event) => {
        if (event.provider.id === 'github') {
          void this.check();
        }
      }),
      // Catches a login finished in a terminal outside VS Code.
      vscode.window.onDidChangeWindowState((event) => {
        if (event.focused && this.state.status === 'signedOut') {
          void this.check();
        }
      }),
    );
  }

  get current(): AuthState {
    return this.state;
  }

  get token(): string | undefined {
    return this.state.status === 'signedIn' ? this.state.token : undefined;
  }

  tokenRejected(token: string): void {
    this.log.warn('GitHub rejected the current token.');
    this.rejectedTokens.add(token);
    void this.check();
  }

  check(): Promise<void> {
    this.checking ??= this.detect().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  async loginWithGh(): Promise<void> {
    const state = this.state;
    const gh = state.status === 'signedOut' ? state.ghPath : undefined;
    if (!gh) {
      return;
    }
    if (this.loginTerminal) {
      this.loginTerminal.show();
      return;
    }
    // Running gh as the terminal process avoids shell quoting, and the
    // terminal closing tells us the login flow has ended.
    const terminal = vscode.window.createTerminal({
      name: 'GitHub Login',
      shellPath: gh,
      shellArgs: ['auth', 'login', '--hostname', 'github.com', '--web'],
    });
    this.loginTerminal = terminal;
    terminal.show();
    const closed = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
      if (closedTerminal !== terminal) {
        return;
      }
      closed.dispose();
      this.loginTerminal = undefined;
      await this.check();
      if (this.state.status !== 'signedIn') {
        void vscode.window.showWarningMessage('GitHub CLI login did not finish.');
      }
    });
  }

  async loginWithVSCode(): Promise<void> {
    await vscode.authentication.getSession('github', SCOPES, { createIfNone: true });
    await this.check();
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async detect(): Promise<void> {
    const configuredPath = vscode.workspace.getConfiguration('ghIssues').get<string>('ghPath', '');
    const gh = await findGh(configuredPath);
    const ghToken = gh ? await readGhToken(gh) : undefined;
    if (ghToken && !this.rejectedTokens.has(ghToken)) {
      this.log.info(`Using GitHub CLI credentials (${gh}).`);
      this.update({ status: 'signedIn', token: ghToken, source: 'gh' });
      return;
    }

    const session = await vscode.authentication.getSession('github', SCOPES, { silent: true });
    if (session && !this.rejectedTokens.has(session.accessToken)) {
      this.log.info('Using the VS Code GitHub session.');
      this.update({ status: 'signedIn', token: session.accessToken, source: 'vscode' });
      return;
    }

    this.log.info(gh ? `GitHub CLI found (${gh}) but not logged in.` : 'GitHub CLI not found.');
    this.update({ status: 'signedOut', ghPath: gh });
  }

  private update(next: AuthState): void {
    const previous = this.state;
    this.state = next;
    void vscode.commands.executeCommand('setContext', 'ghIssues.authState', next.status);
    void vscode.commands.executeCommand(
      'setContext',
      'ghIssues.ghInstalled',
      next.status === 'signedOut' && next.ghPath !== undefined,
    );
    const sameToken = previous.status === 'signedIn' && next.status === 'signedIn' && previous.token === next.token;
    if (previous.status !== next.status || (next.status === 'signedIn' && !sameToken)) {
      this.changed.fire(next);
    }
  }
}
