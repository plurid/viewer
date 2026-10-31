// @vitest-environment jsdom
/**
 * A PANEL: its title collapses it to the title bar and a short status, saying so to the panel's
 * holder through `data-collapsed`; its actions and Close sit in the title bar; its parts carry
 * the caller's name. It never places itself. A section is named by its heading, or by its label.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Panel, PanelSection } from '../src/renderer/ui/Panel';
import { Button } from '../src/renderer/ui/primitives';

afterEach(cleanup);

function Collapsible({ onClose }: { onClose(): void }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Panel
      className="job-panel"
      label="Check Job 7"
      title="Check Job 7"
      status="2 findings"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      actions={<Button variant="quiet">Share</Button>}
      onClose={onClose}
      closeLabel="Close the check"
      footer={<Button variant="primary">Run again</Button>}
    >
      <PanelSection title="Findings" meta="2">
        <p>Hole pitch differs.</p>
      </PanelSection>
      <PanelSection label="Summary">
        <p>Two parts.</p>
      </PanelSection>
    </Panel>
  );
}

it('collapses to its title and status from its title, and marks itself collapsed', () => {
  render(<Collapsible onClose={vi.fn()} />);
  const panel = screen.getByRole('complementary', { name: 'Check Job 7' });
  const toggle = document.querySelector<HTMLButtonElement>('.job-panel-toggle')!;
  const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(toggle.classList.contains('panel-toggle')).toBe(true);
  expect(body.classList.contains('job-panel-body')).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(panel.hasAttribute('data-collapsed')).toBe(false);
  // open, the status is not repeated in the title bar
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Check Job 7');
  expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();

  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(panel.getAttribute('data-collapsed')).toBe('true');
  expect(body.hidden).toBe(true);
  expect(screen.getByRole('heading').textContent).toBe('Check Job 7 · 2 findings');
  // collapsed, the footer goes with the body; the title bar keeps its actions
  expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();

  fireEvent.click(toggle);
  expect(panel.hasAttribute('data-collapsed')).toBe(false);
  expect(body.hidden).toBe(false);
});

it('puts its actions and Close in the title bar', () => {
  const onClose = vi.fn();
  render(<Collapsible onClose={onClose} />);
  const header = document.querySelector('.panel-header')!;
  const share = screen.getByRole('button', { name: 'Share' });
  const close = screen.getByRole('button', { name: 'Close the check' });
  expect(header.contains(share) && header.contains(close)).toBe(true);
  expect(share.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(share.className).toBe('button-quiet');
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('names its sections by their headings or labels, the meta beside the heading', () => {
  render(<Collapsible onClose={vi.fn()} />);
  const findings = screen.getByRole('region', { name: 'Findings' });
  expect(findings.querySelector('.panel-section-meta')?.textContent).toBe('2');
  expect(screen.getByRole('heading', { name: 'Findings' }).tagName).toBe('H3');
  expect(screen.getByRole('region', { name: 'Summary' }).querySelector('h3')).toBeNull();
});

it('without a collapse, shows its title and status as plain text, and places nothing', () => {
  render(
    <Panel label="File operations" title="File operations" status="1 running">
      <p>Copy</p>
    </Panel>,
  );
  const panel = screen.getByRole('complementary', { name: 'File operations' });
  expect(panel.querySelector('button')).toBeNull();
  expect(screen.getByRole('heading').textContent).toBe('File operations · 1 running');
  expect(panel.hasAttribute('data-collapsed')).toBe(false);
  // what holds the panel places it: no inline position of its own
  expect(panel.getAttribute('style')).toBeNull();
});
