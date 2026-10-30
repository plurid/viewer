import { fileName, tourFileName } from '../../../domain/tours/tour';
import {
  openedTour,
  playableTour,
  playTour,
  tourActive,
  tourControls,
  tourPlayback,
} from '../../workspace/tour';
import { editTour, recordStop, tourDraft } from '../../workspace/tours/recorder';
import type { CommandDefinition } from '../registry';
import type { WindowScopes } from './scope';

/**
 * TOURS: play the tour file opened last, step through a running tour, and record one: the active
 * file plane, where its preview is now, becomes the next stop. "Tour the views" is in views.ts.
 */
export function tourCommands({
  actions,
  state,
  space,
  windowScope,
}: WindowScopes): CommandDefinition[] {
  const workspace = actions.workspace;
  const opened = openedTour();
  const playback = tourActive() ? tourPlayback() : null;
  const draft = tourDraft();
  const pane = space.panes.find((item) => item.id === state.activePane);
  const file = pane?.type === 'preview' ? pane.path : undefined;
  const commands: CommandDefinition[] = [];
  if (opened && !playback) {
    const name = opened.definition.name || tourFileName(opened.file);
    commands.push(
      {
        id: 'tour-play',
        label: `Play tour “${name}”`,
        group: 'Space',
        icon: 'play',
        aliases: ['tour', 'present', 'presentation', 'stops'],
        when: (context) => windowScope(context) && actions.ready,
        run: () => playTour(workspace, playableTour(opened)),
      },
      {
        id: 'tour-edit',
        label: `Edit tour “${name}”`,
        group: 'Space',
        icon: 'rename',
        aliases: ['tour', 'stops', 'captions'],
        when: (context) => windowScope(context) && !draft,
        run: () => editTour(opened),
      },
    );
  }
  if (playback)
    commands.push(
      {
        id: 'tour-next',
        label: 'Next tour stop',
        group: 'Space',
        icon: 'right',
        aliases: ['tour', 'next stop'],
        when: windowScope,
        run: tourControls.next,
      },
      {
        id: 'tour-previous',
        label: 'Previous tour stop',
        group: 'Space',
        icon: 'left',
        aliases: ['tour', 'previous stop', 'back'],
        when: (context) => windowScope(context) && playback.index > 0,
        run: tourControls.previous,
      },
      {
        id: 'tour-pause',
        label: playback.paused ? 'Resume tour' : 'Pause tour',
        group: 'Space',
        icon: playback.paused ? 'play' : 'pause',
        aliases: ['tour', 'pause', 'resume'],
        when: windowScope,
        run: tourControls.toggle,
      },
    );
  commands.push(
    draft
      ? {
          id: 'tour-add-stop',
          label: file ? `Add “${fileName(file)}” to the tour` : 'Add a file plane to the tour',
          group: 'Space',
          icon: 'plus',
          aliases: ['tour', 'stop', 'record'],
          when: (context) => windowScope(context) && !!file && draft.stops.length < 200,
          run: () => recordStop(workspace),
        }
      : {
          id: 'tour-record',
          label: 'Record a tour',
          group: 'Space',
          icon: 'plus',
          aliases: ['tour', 'record tour', 'stops', 'captions', 'present'],
          when: (context) => windowScope(context) && actions.ready,
          run: () => editTour(),
        },
  );
  return commands;
}
