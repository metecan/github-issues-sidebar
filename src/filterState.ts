import * as vscode from 'vscode';
import type { IssueFilter, StateFilter } from './types';

const STORAGE_KEY = 'ghIssues.filter';

export const STATE_LABELS: Record<StateFilter, string> = {
  open: 'Open',
  closed: 'Closed',
  all: 'All',
};

export class FilterState implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private filter: IssueFilter;

  readonly onDidChange = this.changed.event;

  constructor(private readonly storage: vscode.Memento) {
    this.filter = storage.get<IssueFilter>(STORAGE_KEY, { state: 'open', query: '' });
    this.syncContext();
  }

  get value(): IssueFilter {
    return this.filter;
  }

  update(change: Partial<IssueFilter>): void {
    this.filter = { ...this.filter, ...change };
    void this.storage.update(STORAGE_KEY, this.filter);
    this.syncContext();
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }

  private syncContext(): void {
    void vscode.commands.executeCommand('setContext', 'ghIssues.searchActive', this.filter.query !== '');
  }
}
