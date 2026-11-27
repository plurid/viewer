// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusFiles, focusPlane } from '../src/renderer/workspace/sessions';

function mountPlane(id: string, innerClass: string) {
  const plane = document.createElement('div');
  plane.setAttribute('data-plurid-plane', id);
  const marker = document.createElement('div');
  marker.setAttribute('data-viewer-pane', id);
  const inner = document.createElement('div');
  inner.className = innerClass;
  inner.tabIndex = -1;
  marker.append(inner);
  plane.append(marker);
  document.body.append(plane);
  return inner;
}

describe('focusFiles drops focus on non-folder planes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.body.focus();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('focusFiles focuses .folder-explorer and focusPlane focuses .preview-plane', () => {
    const folder = mountPlane('folder-1', 'folder-explorer');
    const preview = mountPlane('preview-1', 'preview-plane');
    focusFiles('folder-1');
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(folder);

    focusPlane('preview-1');
    vi.advanceTimersByTime(50);
    expect(document.activeElement).toBe(preview);
  });

  it('WorkspaceSurface onNavigate/minimap focus call focuses a preview plane instead of leaving focus on document.body', () => {
    const preview = mountPlane('preview-2', 'preview-plane');
    focusFiles('preview-2');
    vi.advanceTimersByTime(1600);
    expect(document.activeElement).toBe(preview);
  });
});
