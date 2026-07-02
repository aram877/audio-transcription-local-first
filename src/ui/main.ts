// Renderer entry point: initialize every feature slice.

import './styles.css';
import { initTabs } from './tabs';
import { initRecordView } from './record';
import { initLibraryView } from './library';
import { initSettingsView, loadSettings } from './settings';
import { initSetupWizard } from './setup';

initTabs();
initRecordView();
initLibraryView();
initSettingsView();
initSetupWizard();
void loadSettings();
