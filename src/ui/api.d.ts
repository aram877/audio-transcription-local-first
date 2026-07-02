// The renderer's view of the preload bridge. The Api type comes from the IPC
// contract, so renderer code compiles against the same shapes as main.

import type { Api } from '../app/ipc/contract';

declare global {
  interface Window {
    api: Api;
  }
}

export {};
