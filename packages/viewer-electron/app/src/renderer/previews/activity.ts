import { createContext } from 'react';

/** Whether the plane holding a folder's embedded previews (Gallery, Columns) is on screen and
 * taking input, as a preview plane's own are told: passed neither, their media and animation ran
 * offscreen (2026-10-20). */
export const PreviewActivity = createContext({ active: true, interactive: true });
