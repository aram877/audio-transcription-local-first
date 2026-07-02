// Top-level tab navigation between the three views.

import { el } from './shared/dom';
import { loadLibrary } from './library';
import { refreshModelList } from './settings';

export function initTabs(): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      el(`view-${tab.dataset.view}`).classList.add('active');
      // Re-check model cache status whenever settings tab is opened.
      if (tab.dataset.view === 'settings') void refreshModelList();
      // Refresh the saved-recordings list when the Library tab opens.
      if (tab.dataset.view === 'library') void loadLibrary();
    });
  });
}
