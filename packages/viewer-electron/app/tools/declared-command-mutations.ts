export interface DeclaredCommandMutationEdit {
  file: string;
  before: string;
  after: string;
}

export const declaredCommandMutationProbes: Record<string, DeclaredCommandMutationEdit[]> = {
  nameCheck: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '      !declaredCommandName(name) ||\n',
      after: '',
    },
  ],
  lineCheck: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '      !validTerminalCommand(line) ||\n',
      after: '',
    },
  ],
  bodyCheck: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '(body !== undefined && !validTerminalCommand(body))',
      after: 'false',
    },
  ],
  byteCap: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (new TextEncoder().encode(text).length > declaredCommandLimits.bytes) return [];',
      after: '',
    },
  ],
  entryCap: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'commands.length >= declaredCommandLimits.entries ||',
      after: '',
    },
  ],
  prePost: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'const hooked = /^(?:pre|post)(.+)$/.exec(name)?.[1];',
      after: 'const hooked = undefined as string | undefined;',
    },
  ],
  lifecycle: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '          lifecycleScripts.has(name) ||',
      after: '          false ||',
    },
  ],
  hookSibling: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '(Object.hasOwn(entries!, hooked) ||',
      after: '(false ||',
    },
  ],
  hookLifecycle: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '              lifecycleScripts.has(hooked) ||',
      after: '              false ||',
    },
  ],
  hookManual: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'manualLifecycleScripts.has(hooked)))',
      after: 'false))',
    },
  ],
  procfileDetail: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (match) add(match[1]!, match[2]!, match[1]!);',
      after: 'if (match) add(match[1]!, match[2]!, match[2]!);',
    },
  ],
  justPrivateAttr: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'privateRecipe ||= /^(?:private|confirm)(?:\\b|\\()/.test(attribute);',
      after: 'privateRecipe ||= /^private\\b/.test(attribute);',
    },
  ],
  justPlatform: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (Object.hasOwn(recipePlatforms, attribute)) platforms.add(attribute);',
      after: '',
    },
  ],
  justAttrComment: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '/^\\s*(?:#.*)?$/',
      after: '/^\\s*$/',
    },
  ],
  makeTargetVar: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '/^\\s*(?:(?:private|override|export|unexport)\\s+)*[^ \\t:=]+[ \\t]*[:+?!]*=/.test(',
      after: 'false && /x/.test(',
    },
  ],
  makeStripAll: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before:
        "const body = lines[next]!.replace(/^[ \\t]+/, '');\n      if (body.trim()) bodies.push(body);\n    }\n    if (bodies.some((body) => !validTerminalCommand(body))) continue;\n    const comment",
      after:
        'const body = lines[next]!.slice(1);\n      if (body.trim()) bodies.push(body);\n    }\n    if (bodies.some((body) => !validTerminalCommand(body))) continue;\n    const comment',
    },
  ],
  validatorDI: [
    {
      file: '/src/domain/terminals/command-text.ts',
      before: '\\p{Cf}\\p{Default_Ignorable_Code_Point}',
      after: '\\p{Cf}',
    },
  ],
  detailClip: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'const clipped = value.slice(0, declaredCommandLimits.detail);',
      after: 'const clipped = value;',
    },
  ],
  surrogateClip: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'return /[\\uD800-\\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;',
      after: 'return clipped;',
    },
  ],
  denoErrors: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (errors.length) return [];',
      after: '',
    },
  ],
  scriptString: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: "if (file === 'package.json' && typeof body !== 'string') continue;",
      after: '',
    },
  ],
  justPrivate: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (!header || hidden || !validTerminalCommand(line)) continue;',
      after: 'if (!header || !validTerminalCommand(line)) continue;',
    },
  ],
  justHeaderValid: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (!header || hidden || !validTerminalCommand(line)) continue;',
      after: 'if (!header || hidden) continue;',
    },
  ],
  justRequired: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: "(part) => part.startsWith('+') || (!part.includes('=') && !part.startsWith('*')),",
      after: '(part) => false,',
    },
  ],
  justBodies: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before:
        'if (bodies.some((body) => !validTerminalCommand(body))) continue;\n      const detail',
      after: 'const detail',
    },
  ],
  justAssignment: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: "if (line[index + 1] === '=' || line[index + 1] === ':') return;",
      after: '',
    },
  ],
  justQuotes: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: "} else if (character === \"'\" || character === '\"' || character === '`') {",
      after: '} else if (false) {',
    },
  ],
  makeDefine: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '      defineDepth ||\n',
      after: '',
    },
  ],
  makeInclude: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '-?include|sinclude|',
      after: '',
    },
  ],
  makeVarChars: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (!match || /[=$%\\\\]/.test(match[1]!)) continue;',
      after: 'if (!match) continue;',
    },
  ],
  makeColon: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '/^([^:]+)(?:::(?![:=])|:(?![=:]))/',
      after: '/^([^:]+)(?:::(?!=)|:(?![=:]))/',
    },
  ],
  makeBodies: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before:
        'if (bodies.some((body) => !validTerminalCommand(body))) continue;\n    const comment',
      after: 'const comment',
    },
  ],
  makePhony: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'return (phony.get(a.name) ?? Infinity) - (phony.get(b.name) ?? Infinity);',
      after: 'return 0;',
    },
  ],
  makeSpecial: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (!line || /^[\\s.#]/.test(line)) continue;',
      after: 'if (!line) continue;',
    },
  ],
  pmField: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (match) return match[1] as PackageManager;',
      after: '',
    },
  ],
  pmPnpmLock: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: "if (lock === 'pnpm-lock.yaml') return 'pnpm';",
      after: "if (lock === 'pnpm-lock.yaml') return 'npm';",
    },
  ],
  pmStrict: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: '/^(pnpm|yarn|bun|npm)(?:@[^\\s\\p{Cc}\\p{Cf}\\p{Cs}]+)?$/u',
      after: '/^(pnpm|yarn|bun|npm)/u',
    },
  ],
  sixLevels: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '(root || folders.length < 6)',
      after: '(root || folders.length < 60)',
    },
  ],
  rootBound: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: ' || (root && !containsPath(root, parent)))',
      after: ')',
    },
  ],
  includedFilter: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before:
        '(folder) => containsPath(root!, folder.path) && containsPath(folder.path, first.path),',
      after: '(folder) => true,',
    },
  ],
  homeWalk: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'parent === current || containsPath(parent, home) ||',
      after: 'parent === current ||',
    },
  ],
  homeDirectory: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (containsPath(directory, home)) return { commands: [] };',
      after: '',
    },
  ],
  homeFirst: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (containsPath(first.path, home)) return { commands: [] };',
      after: '',
    },
  ],
  homeDefinitions: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '.filter((root) => !containsPath(root, home))',
      after: '',
    },
  ],
  homeAlias: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '!containsPath(value.path, home) &&',
      after: '',
    },
  ],
  makeDashC: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before:
        'const line = make && relative ? `make -C ${relative} ${command.name}` : command.line;',
      after: 'const line = command.line;',
    },
  ],
  parentProcfile: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: "if (file === 'Procfile' && index !== 0) continue;",
      after: '',
    },
  ],
  nearestKind: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (kinds.has(kind)) continue;',
      after: '',
    },
  ],
  makeOne: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (make && file !== makefile) continue;',
      after: '',
    },
  ],
  managerAncestor: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '{ packageManager: manager, platform: process.platform }',
      after: '{ platform: process.platform }',
    },
  ],
  recordCachedSkip: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '!this.visible(await cached.value, directory).some((item) => item.line === line)',
      after: 'false',
    },
  ],
  gitStop: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (value.git) git ??= current;',
      after: '',
    },
  ],
  firstGit: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'let git = first.git ? first.path : undefined;',
      after: 'let git: string | undefined = undefined;',
    },
  ],
  aliasDeeper: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '(!root || containsPath(root, value.path))',
      after: 'true',
    },
  ],
  cacheExpiry: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before:
        'if (!fresh && cached?.roots === roots && cached.at + 10_000 > this.now()) return cached.value;',
      after: 'if (!fresh && cached?.roots === roots) return cached.value;',
    },
  ],
  recordCacheAge: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'cached.at + 10_000 > this.now() &&',
      after: 'true &&',
    },
  ],
  cacheRoots: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'cached?.roots === roots &&',
      after: '',
    },
  ],
  freshRecord: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'const value = await this.read(directory, true);',
      after: 'const value = await this.read(directory);',
    },
  ],
  recordMatch: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '.find((item) => item.line === line);',
      after: '.find(() => true);',
    },
  ],
  recordEpochStart: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (revision !== this.epoch) return;\n    if (this.ports.access',
      after: 'if (this.ports.access',
    },
  ],
  recordEpochAfterRead: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (!value.root || !matched || revision !== this.epoch) return;',
      after: 'if (!value.root || !matched) return;',
    },
  ],
  recordEpochInWrite: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before:
        'if (revision !== this.epoch || !this.visible(value, directory).includes(matched)) return;',
      after: 'if (!this.visible(value, directory).includes(matched)) return;',
    },
  ],
  recordAccess: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (this.ports.access && !this.ports.access(directory)) return;\n    const cached',
      after: 'const cached',
    },
  ],
  clearEpoch: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '    this.epoch++;\n',
      after: '',
    },
  ],
  clearCache: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '    this.cache.clear();\n',
      after: '',
    },
  ],
  clearSave: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (existed) await this.save();',
      after: '',
    },
  ],
  rootCap: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'while (this.references.size > 200)',
      after: 'while (this.references.size > 2000)',
    },
  ],
  lruOrder: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'this.references.delete(root);\n',
      after: '',
    },
  ],
  retainedNonFile: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (!(await lstat(this.store.file)).isFile()) {',
      after: 'if (false) {',
    },
  ],
  moveAside: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: "await rename(this.store.file, this.store.file + '.unreadable-' + randomUUID());",
      after: '',
    },
  ],
  retainedSave: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (this.retained) return;',
      after: '',
    },
  ],
  listAccess: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (this.ports.access && !this.ports.access(directory)) return { commands: [] };',
      after: '',
    },
  ],
  visibleFolder: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (!scope || !value.folder || !scope.allows(value.folder)) return [];',
      after: '',
    },
  ],
  visibleFile: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'return !!file && !!this.ports.access?.(file)?.allows(file);',
      after: 'return true;',
    },
  ],
  dedupeLines: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'if (!validTerminalCommand(line) || seen.has(line)) continue;',
      after: 'if (!validTerminalCommand(line)) continue;',
    },
  ],
  lockSlice: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: '.slice(index)\n',
      after: '\n',
    },
  ],
  lastRunSource: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'item.source === last.source && item.name === last.name',
      after: 'item.name === last.name',
    },
  ],
  budget: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: "if (task.pass.exhausted) return refuse('budget');",
      after: '',
    },
  ],
  quarantineCheck: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: "else if (containsPath(blocked, requested)) return refuse('quarantined');",
      after: "else if (false) return refuse('quarantined');",
    },
  ],
  quarantineWholeDisk: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: 'const volume = folderVolume(requested) ?? folder;',
      after: "const volume = folderVolume(requested) ?? '/';",
    },
  ],
  quarantineReadFolder: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: "const folder = task.request.kind === 'read' ? path.dirname(requested) : requested;",
      after: 'const folder = requested;',
    },
  ],
  stuckBusy: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: "if (this.stuck(mount) >= folderFactsLimits.stuckThreads) return refuse('busy');",
      after: '',
    },
  ],
  retireRelease: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: '() => this.retiring.delete(worker),',
      after: '() => {},',
    },
  ],
  quarantineSet: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: '+ folderFactsLimits.quarantine,',
      after: '+ 0,',
    },
  ],
  scopeRefuse: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: "if (this.options.access && !scope) return refuse('scope');",
      after: '',
    },
  ],
  checkAllowed: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: '!!current.scope?.allows(reply.check)',
      after: 'true',
    },
  ],
  filesFilter: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: '(file) => !this.options.access || !!this.options.access(file)?.allows(file),',
      after: '(file) => true,',
    },
  ],
  replyRecheck: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: '!current.scope.allows(value.path) ||',
      after: '',
    },
  ],
  replyRevoked: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: '(!this.options.access?.(current.request.path) ||',
      after: '(false ||',
    },
  ],
  priority: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: 'const task = this.reads.shift() ?? this.probes.shift();',
      after: 'const task = this.probes.shift() ?? this.reads.shift();',
    },
  ],
  relaunchCap: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before:
        'if (task.pass.relaunches >= folderFactsLimits.relaunches) task.pass.exhausted = true;',
      after: 'if (false) task.pass.exhausted = true;',
    },
  ],
  terminate: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: "this.retire(worker, mount);\n        this.finish({ ok: false, reason: 'timeout' });",
      after: "this.finish({ ok: false, reason: 'timeout' });",
    },
  ],
  staleReply: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: 'if (this.worker !== worker || current?.request.id !== reply.id) return;',
      after: 'if (this.worker !== worker) return;',
    },
  ],
  closedRefuse: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: "if (this.closed) return refuse('closed');",
      after: '',
    },
  ],
  containment: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: "if (!containsPath(folder, actual)) return { ok: false, reason: 'outside-folder' };",
      after: '',
    },
  ],
  regular: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: "if (!observed.isFile()) return { ok: false, reason: 'not-regular' };",
      after: '',
    },
  ],
  regularFd: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: "if (!before.isFile()) return { ok: false, reason: 'not-regular' };",
      after: '',
    },
  ],
  sizeLstat: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: "if (observed.size > BigInt(maxBytes)) return { ok: false, reason: 'too-large' };",
      after: '',
    },
  ],
  lengthCheck: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: "if (length > maxBytes) return { ok: false, reason: 'too-large' };",
      after: '',
    },
  ],
  maxBytesBound: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: 'maxBytes > folderFactsLimits.bytes',
      after: 'false',
    },
  ],
  approvedRead: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before:
        "if (approvedPath !== undefined && actual !== approvedPath)\n      return { ok: false, reason: 'changed' };\n    if (!containsPath",
      after: 'if (!containsPath',
    },
  ],
  cappedFallback: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: 'if (capped)\n',
      after: 'if (false)\n',
    },
  ],
  entriesCap: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: 'while (count < folderFactsLimits.entries) {',
      after: 'while (true) {',
    },
  ],
  gitWorktree: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: '/\\/worktrees\\//.test(text)',
      after: 'false',
    },
  ],
  permittedFiles: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before:
        "if (permittedFiles && !permittedFiles.has(resolved)) return { ok: false, reason: 'scope' };",
      after: '',
    },
  ],
  nonblock: [
    {
      file: '/src/desktop/workspaces/folder-facts-io.ts',
      before: 'constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK',
      after: 'constants.O_RDONLY',
    },
  ],
  listBefore: [
    {
      file: '/src/desktop/ipc/terminal-handlers.ts',
      before: 'declaredCommands: async ([directory], owner) => {\n      requirePerson(owner);',
      after: 'declaredCommands: async ([directory], owner) => {',
    },
  ],
  listAfter: [
    {
      file: '/src/desktop/ipc/terminal-handlers.ts',
      before:
        'const value = await ports.declaredCommands.list(directory);\n      requirePerson(owner);',
      after: 'const value = await ports.declaredCommands.list(directory);',
    },
  ],
  requireAgent: [
    {
      file: '/src/desktop/ipc/terminal-handlers.ts',
      before: 'if (ports.isAgent(owner) || !ports.isViewer(owner))\n      throw',
      after: 'if (!ports.isViewer(owner))\n      throw',
    },
  ],
  recordRevision: [
    {
      file: '/src/desktop/ipc/terminal-handlers.ts',
      before: 'const revision = ports.declaredCommands.revision;',
      after: 'const revision = undefined;',
    },
  ],
  recordCatch: [
    {
      file: '/src/desktop/ipc/terminal-handlers.ts',
      before: '.record(target.directory, script, revision).catch(() => {});',
      after: '.record(target.directory, script, revision);',
    },
  ],
  rowsCap: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: 'ordered.slice(0, declaredCommandLimits.rows)',
      after: 'ordered',
    },
  ],
  lastRunSort: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: '.sort((a, b) => Number(!!b.lastRun) - Number(!!a.lastRun))',
      after: '',
    },
  ],
  agentBlocked: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: 'const blocked = !!definitionRunReason([]);',
      after: 'const blocked = false;',
    },
  ],
  deadline: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: '      current = false;\n    }, 300);',
      after: '    }, 300);',
    },
  ],
  pickLine: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: 'onClick={() => onPick(item.line)}',
      after: 'onClick={() => onPick(item.name)}',
    },
  ],
  lastRunLabel: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: '{item.lastRun ? <span className="muted">Last run</span> : null}',
      after: '{null}',
    },
  ],
  detailShown: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: '{item.detail ? <span className="muted">{item.detail}</span> : null}',
      after: '{null}',
    },
  ],
  groupByFile: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: 'const label = command.relativeSource ?? command.file;',
      after: 'const label = command.file;',
    },
  ],
  contextShown: [
    {
      file: '/src/renderer/terminals/DeclaredCommandList.tsx',
      before: '{item.context ? <span className="muted">{item.context}</span> : null}',
      after: '{null}',
    },
  ],
  backgroundRecord: [
    {
      file: '/src/desktop/ipc/terminal-handlers.ts',
      before: 'void ports.declaredCommands.record(',
      after: 'await ports.declaredCommands.record(',
    },
  ],
  dialogFocus: [
    {
      file: '/src/renderer/terminals/RunCommandDialog.tsx',
      before: 'input.current?.focus();\n            }}',
      after: '}}',
    },
  ],
  dialogClearsError: [
    {
      file: '/src/renderer/terminals/RunCommandDialog.tsx',
      before: "setScript(line);\n              setError('');",
      after: 'setScript(line);',
    },
  ],
  quickFocus: [
    {
      file: '/src/renderer/terminals/QuickCommand.tsx',
      before: 'editQuickCommand(line);\n            input.current?.focus();',
      after: 'editQuickCommand(line);',
    },
  ],
  quickEmptyOnly: [
    {
      file: '/src/renderer/terminals/QuickCommand.tsx',
      before: '{!current.draft && !busy && (',
      after: '{!busy && (',
    },
  ],
  dialogHiddenWhileSaving: [
    {
      file: '/src/renderer/terminals/RunCommandDialog.tsx',
      before: '{!saving && (\n          <DeclaredCommandList',
      after: '{(\n          <DeclaredCommandList',
    },
  ],
  clearWire: [
    {
      file: '/src/desktop/bridge.ts',
      before: 'Promise.resolve().then(() => this.declaredCommands.clearHistory()),',
      after: 'Promise.resolve(),',
    },
  ],
  clearSettled: [
    {
      file: '/src/desktop/bridge.ts',
      before:
        'const results = await Promise.allSettled([\n        Promise.resolve().then(() => this.declaredCommands.clearHistory()),',
      after:
        'const results = (await Promise.all([\n        Promise.resolve().then(() => this.declaredCommands.clearHistory()),',
    },
    {
      file: '/src/desktop/bridge.ts',
      before: '      ]);\n      for (const result of results)',
      after:
        "      ])).map((value) => ({ status: 'fulfilled', value }));\n      for (const result of results)",
    },
  ],
  clearFoundAfterFailure: [
    {
      file: '/src/desktop/bridge.ts',
      before: 'Promise.resolve().then(() => this.foundWorkspaces?.clearHistory()),',
      after: 'Promise.resolve(),',
    },
  ],
  staleRecord: [
    {
      file: '/src/desktop/terminals/declared-commands.ts',
      before: 'const value = await this.read(directory, true);',
      after:
        'if (!cached || cached.at + 10_000 <= this.now()) return;\n    const value = await this.read(directory, true);',
    },
  ],
  commaAttributes: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: "character === ',' || character === ']'",
      after: "character === ']'",
    },
  ],
  quotedAttributeComma: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: 'if (quote) {\n      if (character === quote) quote = undefined;',
      after: "if (quote && character !== ',') {\n      if (character === quote) quote = undefined;",
    },
  ],
  inlineRecipe: [
    {
      file: '/src/domain/terminals/declared-commands.ts',
      before: "if (tail[index] === ';')",
      after: 'if (false)',
    },
  ],
  emojiSelector: [
    {
      file: '/src/domain/terminals/command-text.ts',
      before: 'if (selector(character) && emoji(characters[index - 1])) return false;',
      after: '',
    },
  ],
  emojiSelectorContext: [
    {
      file: '/src/domain/terminals/command-text.ts',
      before: 'selector(character) && emoji(characters[index - 1])',
      after: 'selector(character)',
    },
  ],
  emojiJoin: [
    {
      file: '/src/domain/terminals/command-text.ts',
      before:
        'if (pictographic(characters[previous]) && pictographic(characters[index + 1])) return false;',
      after: '',
    },
  ],
  emojiJoinContext: [
    {
      file: '/src/domain/terminals/command-text.ts',
      before: 'pictographic(characters[previous]) && pictographic(characters[index + 1])',
      after: 'true',
    },
  ],
  globalStuck: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: 'return [...this.retiring.values()].filter((value) => value === mount).length;',
      after: 'return this.retiring.size;',
    },
  ],
  ignoreKnownMounts: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: '...(this.options.mounts?.() ?? []),',
      after: '',
    },
  ],
  liveWorkerBypass: [
    {
      file: '/src/desktop/workspaces/folder-facts.ts',
      before: 'if (this.stuck(mount) >= folderFactsLimits.stuckThreads)',
      after: 'if (!this.worker && this.stuck(mount) >= folderFactsLimits.stuckThreads)',
    },
  ],
};
