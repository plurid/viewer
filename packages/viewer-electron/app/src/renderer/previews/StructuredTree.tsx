import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PreviewContext } from './contracts';
import { usePreviewState } from './state';
import {
  copyDataValue,
  copyXMLValue,
  visibleDataRows,
  type StructuredData,
  type TreeExpansion,
} from '../../domain/previews/data/structured';
import { copyText, report } from '../state/store';
import { MenuButton } from '../ui/ChoiceMenu';
import { PreviewToolbar, usePreviewCommands } from './controls';
import { headerItem } from '../workspace/header-overflow';

export function StructuredTree({
  context,
  data,
  viewControls,
}: {
  context: PreviewContext;
  data: StructuredData;
  viewControls?: ReactNode;
}) {
  const [expansion, setExpansion] = usePreviewState<TreeExpansion>(context, 'tree.expansion', {
    all: false,
    open: data.roots,
    closed: [],
  });
  const [scrollTop, setScrollTop] = usePreviewState(context, 'tree.scroll', 0);
  const [query, setQuery] = usePreviewState(context, 'tree.query', '');
  const [selected, setSelected] = useState<string>();
  const scroll = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const focus = useRef<string | undefined>(undefined);
  const rows = useMemo(() => visibleDataRows(data, expansion, query), [data, expansion, query]);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    getItemKey: (index) => rows[index]!.path,
    estimateSize: () => 26,
    overscan: 12,
    initialOffset: scrollTop,
  });
  const node = data.nodes.find((node) => node.path === selected);
  useEffect(() => {
    if (focus.current === undefined) return;
    const element = elements.current.get(focus.current);
    if (element) {
      focus.current = undefined;
      element.focus({ preventScroll: true });
    }
  });
  const move = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    focus.current = row.path;
    setSelected(row.path);
    virtual.scrollToIndex(index, { align: 'auto' });
  };
  const copy = (value: string) => void copyText(value).catch(report);
  const expand = useCallback(
    (all: boolean) => setExpansion({ all, open: [], closed: [] }),
    [setExpansion],
  );
  usePreviewCommands(
    context,
    useMemo(
      () => [
        { id: 'tree-expand', label: 'Expand All', aliases: ['open all'], run: () => expand(true) },
        {
          id: 'tree-collapse',
          label: 'Collapse All',
          aliases: ['close all'],
          run: () => expand(false),
        },
      ],
      [expand],
    ),
  );
  const copyValue = () => {
    if (!node) return;
    try {
      copy(data.format === 'xml' ? copyXMLValue(node.value) : copyDataValue(node.value));
    } catch (error) {
      report(error);
    }
  };
  return (
    <div className="structured-viewer">
      {/* the one toolbar every preview has: in a plane's header, or measured where it stands, its
          buttons giving way into "…" rather than hiding by width */}
      <PreviewToolbar context={context}>
        {viewControls}
        <button {...headerItem('expand', 7, ['preview.tree-expand'])} onClick={() => expand(true)}>
          Expand All
        </button>
        <button
          {...headerItem('collapse', 7, ['preview.tree-collapse'])}
          onClick={() => expand(false)}
        >
          Collapse All
        </button>
        <input
          type="search"
          aria-label="Search data"
          placeholder="Search keys and values"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="toolbar-spacer" />
        {/* always here, so choosing a row moves no control; it copies the row chosen */}
        <MenuButton
          label="Copy"
          disabled={!node}
          items={[
            { value: 'path', label: 'Copy Path' },
            { value: 'value', label: 'Copy Value' },
          ]}
          onChoose={(action) => {
            if (action === 'path' && node) copy(node.path || '/');
            else if (action === 'value') copyValue();
          }}
        />
      </PreviewToolbar>
      {data.limited && (
        <p className="inline-warning">
          Tree limit reached. The complete readable text remains in Source.
        </p>
      )}
      <div
        className="json-scroll structured-scroll"
        ref={scroll}
        role="tree"
        aria-label="Data tree"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          style={{
            height: virtual.getTotalSize(),
            position: 'relative',
            minWidth: '100%',
            width: 'max-content',
          }}
        >
          {virtual.getVirtualItems().map((item) => {
            const node = rows[item.index]!;
            const open =
              query.trim() ||
              (expansion.all
                ? !expansion.closed.includes(node.path)
                : expansion.open.includes(node.path));
            const toggle = () =>
              setExpansion((value) => {
                const key = value.all ? 'closed' : 'open';
                const paths = value[key].includes(node.path)
                  ? value[key].filter((path) => path !== node.path)
                  : [...value[key], node.path].slice(-2000);
                return { ...value, [key]: paths };
              });
            return (
              <div
                key={item.key}
                ref={(element) => {
                  if (element) elements.current.set(node.path, element);
                  else elements.current.delete(node.path);
                }}
                role="treeitem"
                aria-level={node.depth + 1}
                aria-expanded={node.children.length ? !!open : undefined}
                aria-selected={node.path === selected}
                className={`structured-row ${node.path === selected ? 'is-selected' : ''}`}
                tabIndex={
                  node.path === selected ||
                  (item.index === 0 && !rows.some((row) => row.path === selected))
                    ? 0
                    : -1
                }
                style={{
                  position: 'absolute',
                  top: item.start,
                  height: item.size,
                  paddingInlineStart: node.depth * 20,
                }}
                onClick={() => setSelected(node.path)}
                onFocus={() => setSelected(node.path)}
                onKeyDown={(event) => {
                  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    move(
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? rows.length - 1
                          : item.index + (event.key === 'ArrowDown' ? 1 : -1),
                    );
                    return;
                  }
                  if (
                    (event.key === 'ArrowRight' && !open) ||
                    (event.key === 'ArrowLeft' && open)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (node.children.length && !query.trim()) toggle();
                  } else if (event.key === 'ArrowRight' && open && node.children.length) {
                    event.preventDefault();
                    event.stopPropagation();
                    move(item.index + 1);
                  } else if (event.key === 'ArrowLeft' && node.parent !== undefined) {
                    event.preventDefault();
                    event.stopPropagation();
                    move(rows.findIndex((row) => row.path === node.parent));
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    setSelected(node.path);
                  }
                }}
              >
                <button
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
                  tabIndex={-1}
                  disabled={!node.children.length}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle();
                  }}
                >
                  {node.children.length ? (open ? '▾' : '▸') : '·'}
                </button>
                <span className="json-key">{node.name}</span>
                <span className="muted">: </span>
                <span className={node.kind === 'value' ? `json-${typeof node.value}` : 'muted'}>
                  {node.summary}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="structured-status muted">
        {rows.length.toLocaleString()} of {data.nodes.length.toLocaleString()} nodes
        {node ? ` · ${node.path || '/'}` : ''}
      </div>
    </div>
  );
}
