import * as vscode from 'vscode';
import { parseRemoteUrl, parseRepo } from './github/repoRef';
import { repoKey, type RepoRef } from './types';

// The parts of the built-in git extension's API this extension uses.
interface GitExtension {
  getAPI(version: 1): GitApi;
}

interface GitApi {
  state: 'uninitialized' | 'initialized';
  onDidChangeState: vscode.Event<string>;
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitRepository {
  state: {
    remotes: { name: string; fetchUrl?: string; pushUrl?: string }[];
    onDidChange: vscode.Event<void>;
  };
}

export interface WorkspaceRepo {
  ref: RepoRef;
  /** Added through settings, so the user can also remove it. */
  manual: boolean;
}

function githubRemote(repository: GitRepository): RepoRef | undefined {
  // Forks keep their issues on upstream, so it wins over origin.
  const priority = (name: string) => (name === 'upstream' ? 0 : name === 'origin' ? 1 : 2);
  const remotes = [...repository.state.remotes].sort((a, b) => priority(a.name) - priority(b.name));
  for (const remote of remotes) {
    const parsed = parseRemoteUrl(remote.fetchUrl ?? remote.pushUrl ?? '');
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

export class RepositoryService implements vscode.Disposable {
  private gitApi: GitApi | undefined;
  private detected: RepoRef[] = [];
  private lastKeys = '';
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private readonly watched = new Map<GitRepository, vscode.Disposable>();

  readonly onDidChange = this.changed.event;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('ghIssues.repositories')) {
          this.publish();
        }
      }),
    );
    void this.connectToGit();
  }

  get repositories(): WorkspaceRepo[] {
    const seen = new Set<string>();
    const manual = this.manualRepos().map((ref) => ({ ref, manual: true }));
    const detected = this.detected.map((ref) => ({ ref, manual: false }));
    return [...detected, ...manual].filter(({ ref }) => {
      const key = repoKey(ref).toLowerCase();
      return seen.has(key) ? false : Boolean(seen.add(key));
    });
  }

  async add(repo: RepoRef): Promise<void> {
    const config = vscode.workspace.getConfiguration('ghIssues');
    const existing = config.get<string[]>('repositories', []);
    await config.update('repositories', [...existing, repoKey(repo)], vscode.ConfigurationTarget.Global);
  }

  async remove(repo: RepoRef): Promise<void> {
    const config = vscode.workspace.getConfiguration('ghIssues');
    const key = repoKey(repo).toLowerCase();
    const remaining = config.get<string[]>('repositories', []).filter((entry) => entry.toLowerCase() !== key);
    await config.update('repositories', remaining, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {
    vscode.Disposable.from(...this.watched.values(), ...this.disposables).dispose();
  }

  private manualRepos(): RepoRef[] {
    return vscode.workspace
      .getConfiguration('ghIssues')
      .get<string[]>('repositories', [])
      .flatMap((entry) => parseRepo(entry) ?? []);
  }

  private async connectToGit(): Promise<void> {
    try {
      const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      this.gitApi = (await extension?.activate())?.getAPI(1);
    } catch {
      // git.enabled is off. Repositories from settings still work.
    }
    const api = this.gitApi;
    if (!api) {
      this.publish();
      return;
    }

    this.disposables.push(
      api.onDidOpenRepository((repository) => this.watch(repository)),
      api.onDidCloseRepository((repository) => {
        this.watched.get(repository)?.dispose();
        this.watched.delete(repository);
        this.refreshDetected();
      }),
      api.onDidChangeState(() => this.refreshDetected()),
    );
    api.repositories.forEach((repository) => this.watch(repository));
    this.refreshDetected();
  }

  private watch(repository: GitRepository): void {
    if (!this.watched.has(repository)) {
      this.watched.set(
        repository,
        repository.state.onDidChange(() => this.refreshDetected()),
      );
    }
    this.refreshDetected();
  }

  private refreshDetected(): void {
    const api = this.gitApi;
    this.detected = api?.repositories.flatMap((repository) => githubRemote(repository) ?? []) ?? [];
    // Hold the "no repository" prompt until git has finished scanning.
    if (api?.state === 'initialized') {
      this.publish();
    }
  }

  private publish(): void {
    const repositories = this.repositories;
    void vscode.commands.executeCommand('setContext', 'ghIssues.noRepositories', repositories.length === 0);
    const keys = repositories.map(({ ref, manual }) => `${repoKey(ref)}:${manual}`).join(',');
    // git fires state changes on every file edit; only real changes matter.
    if (keys !== this.lastKeys) {
      this.lastKeys = keys;
      this.changed.fire();
    }
  }
}
