import { restoreApiErrors } from './api-boundary';

// Browser fixtures already supply ViewerAPI. Native pages install their API
// before application modules subscribe or bootstrap, preserving frozen methods.
if (window.viewerNative)
  Object.defineProperty(window, 'viewer', { value: restoreApiErrors(window.viewerNative) });
