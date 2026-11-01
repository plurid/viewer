/** A presentation edit of retained provider HTML. It never changes executable scripts or values. */
export function presentRobotDocument(document: Document, css: string) {
  const get = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error('Unsupported robot presentation: missing ' + selector);
    return element;
  };
  if (document.querySelector('#viewer-presentation-style'))
    throw new Error('This robot canvas already has a presentation edit.');
  const scripts = [...document.scripts].map((script) => script.outerHTML);
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
  const panel = get('.panel');
  const view = get('#viewBox');
  const joints = get('#joints');
  const model = get('#modelLine').closest('.card')!;
  const calibration = get('#noteLine').closest('.card')!;
  const task = document.querySelector('#targetBox')?.closest('.card');
  const replay = document.querySelector('#scrub')?.closest('.card');
  const cards = [...panel.children];
  const create = (tag: string, className = '') => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  };
  const row = (...children: Element[]) => {
    const element = create('div', 'btnrow');
    element.append(...children);
    return element;
  };
  const section = (title: string, ...children: Element[]) => {
    const element = create('section', 'presentation-section');
    const heading = create('h2');
    heading.textContent = title;
    element.append(heading, ...children);
    return element;
  };
  const details = (title: string, open: boolean, ...children: Element[]) => {
    const element = document.createElement('details');
    element.className = 'presentation-details';
    element.open = open;
    const summary = document.createElement('summary');
    summary.textContent = title;
    const body = create('div', 'presentation-detail-body');
    body.append(...children);
    element.append(summary, body);
    return element;
  };

  const stage = create('main', 'presentation-stage');
  view.replaceWith(stage);
  stage.append(view);
  const hud = get('.hud');
  const heading = get('h1');
  heading.textContent = task ? 'SO-101 target workbench' : 'Explore the SO-101';
  document.title = heading.textContent;
  const source = get('#srcLine');
  const status = get('#statLine');
  const viewTools = row(get('#resetV'));
  viewTools.classList.add('presentation-view-tools');
  hud.append(viewTools);
  const metadata = create('div', 'presentation-model-status');
  metadata.append(get('#assetLine'), status);
  const note = create('p', 'presentation-scope');
  note.textContent = 'Kinematic model. Endpoint checks and joint limits only.';

  const editedPanel = document.createDocumentFragment();
  if (task && replay) {
    const targetBox = get('#targetBox');
    const solve = get('#solveBoth');
    solve.classList.add('presentation-primary');
    const check = get('#checkBtn');
    const solveLine = get('#solveLine');
    solveLine.setAttribute('role', 'status');
    solveLine.setAttribute('aria-live', 'polite');
    solveLine.textContent =
      'Saved candidates are available below. Solve after changing a target or base.';
    const checkLine = get('#checkLine');
    checkLine.textContent = 'The current independent result is in Viewer’s Robot check report.';
    const cancel = get('#cancelSolve');
    const targets = section(
      'Targets in world space',
      targetBox,
      row(solve, check, cancel),
      solveLine,
    );
    editedPanel.append(targets);

    const originalBase = get('#origBase');
    const alternativeBase = get('#altBase');
    originalBase.textContent = 'Original base';
    alternativeBase.textContent = 'Alternative base';
    const baseButtons = row(originalBase, alternativeBase);
    const taskSource = get('#taskSrc');
    const poses = get('#poseTable');
    const individual = row(get('#solveA'), get('#solveB'));
    const previews = row(get('#applyA'), get('#applyB'));
    task.querySelector('h2')?.remove();
    editedPanel.append(
      section('Base placement', baseButtons, details('Coordinates and tolerance', false, task)),
    );
    editedPanel.append(
      details('Saved candidate poses', false, previews, poses, individual, checkLine),
    );

    replay.className = 'presentation-replay';
    replay.querySelector('h2')!.textContent = 'Pose replay';
    replay.querySelector('.row')!.classList.add('presentation-transport');
    for (const child of [...replay.children]) {
      if (child.classList.contains('sub') && !child.id) model.append(child);
    }
    get('#stopBtn').textContent = 'Go to final pose';
    get('#replayLine').setAttribute('role', 'status');
    stage.append(replay);
    model.append(taskSource);
  }

  editedPanel.append(
    details('Joints and limits', !task, row(get('#resetJ'), get('#exportJ')), joints),
  );
  editedPanel.append(metadata, note);
  const description = create('p', 'presentation-credit');
  description.textContent = 'Meta-generated workbench · Layout refined locally';
  const about = details(
    'Model, scope and provenance',
    false,
    source,
    calibration,
    model,
    description,
  );
  editedPanel.append(about);

  // Keep every remaining authored explanation accessible, without orphaning a control or status ID.
  for (const card of cards) {
    if (card === replay || card === task || card === calibration || card === model) continue;
    card.querySelector('h2')?.remove();
    if (card.textContent?.trim() || card.querySelector('[id]'))
      about.querySelector('.presentation-detail-body')!.append(card);
  }
  panel.replaceChildren(editedPanel);
  for (const label of document.querySelectorAll<HTMLLabelElement>('label.small')) {
    const input = label.nextElementSibling?.matches('input')
      ? label.nextElementSibling
      : label.nextElementSibling?.querySelector('input');
    if (input?.id) label.htmlFor = input.id;
  }
  const style = document.createElement('style');
  style.id = 'viewer-presentation-style';
  style.textContent = css;
  document.head.append(style);
  if (
    JSON.stringify([...document.scripts].map((script) => script.outerHTML)) !==
    JSON.stringify(scripts)
  )
    throw new Error('Presentation edits may not change the provider scripts.');
  for (const id of ids)
    if (!document.getElementById(id))
      throw new Error('Presentation lost a generated control: ' + id);
}
