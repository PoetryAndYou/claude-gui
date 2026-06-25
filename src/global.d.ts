import type { ClaudeAPI } from '../electron/preload';

declare global {
  interface Window {
    claude: ClaudeAPI;
  }
}

export {};
