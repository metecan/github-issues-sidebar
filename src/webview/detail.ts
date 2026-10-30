declare function acquireVsCodeApi(): { postMessage(message: { type: string }): void };

const CONFIRMATION_MS = 1500;

const vscode = acquireVsCodeApi();

document.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (button?.dataset.action) {
    vscode.postMessage({ type: button.dataset.action });
  }
});

window.addEventListener('message', ({ data }: MessageEvent<{ type: string; action: string }>) => {
  if (data.type !== 'done') {
    return;
  }
  const button = document.querySelector(`[data-action="${data.action}"]`);
  button?.classList.add('done');
  setTimeout(() => button?.classList.remove('done'), CONFIRMATION_MS);
});
