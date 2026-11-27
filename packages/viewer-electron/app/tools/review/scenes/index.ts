/** Every review area, in the order the sheet shows them. Add a scene to its area's module. */
import type { ReviewArea } from '../types';
import { checklists } from './checklists';
import { dialogScenes } from './dialogs';
import { exports } from './exports';
import { files } from './files';
import { mainWindow } from './main-window';
import { navigation } from './navigation';
import { kinds } from './kinds';
import { previews } from './previews';
import { settings } from './settings';

import { runtimeScenes } from './wave4-runtimes';

import { wave4Explorer } from './wave4-explorer';

export const reviewAreas: readonly ReviewArea[] = [
  mainWindow,
  previews,
  exports,
  navigation,
  wave4Explorer,
  files,
  settings,
  checklists,
  dialogScenes,
  runtimeScenes,
  kinds,
];
