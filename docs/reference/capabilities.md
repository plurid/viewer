# What Viewer does

The [guides](../README.md) teach these tools. This table distinguishes current capabilities from
deeper work still proposed.

| Area           | Current behavior                                                                 | Relevant limits                                                                        |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Files          | List, Grid, Columns, Gallery, Map; selection, transfers, rename, Trash, archives | Jobs and Undo use identity checks; platform access applies                             |
| Search         | Names/metadata, query filters, saved searches and opt-in document text           | Bounded readers and index scope; fuzzy discovery differs from literal filtering        |
| Previews       | Documents, media, code/data, archives, supported models/CAD                      | Format and codec coverage vary; layout and semantic extraction differ                  |
| Creative tools | PDF page tools, image conversion/crop/resize, clip editing and Optimize          | Focused tools, new outputs, supported processor/input limits                           |
| Workspaces     | Linked/root views, docking, tiling, named arrangements and portable projects     | Views, persistent documents and live runtimes have different lifetimes                 |
| Notes          | Private notes/checklists, scratch buffers and exports                            | Closing a view keeps the saved document                                                |
| Development    | Text editing, Git review/hunks, worktrees, tasks, terminal and browser planes    | Direct/native features require platform qualification; Git has its normal side effects |
| Local web      | Interactive browser and static loopback server with request logs                 | Static server does not build a framework; browser compatibility is site-dependent      |
| Commands       | Contextual palette, command language, custom actions, parameters and sequences   | Captured context; exact first-run process trust and bounded output                     |
| Automation     | Workflows, watch-triggered reviews, optional model recipes and scoped agents     | Reviews and separate permissions; no opaque agent shell or input authority             |
| Diagnostics    | Journal, operation receipts and command receipts                                 | Bounded evidence, not inferred task success or action-replay authority                 |

Public links, automatic external CLI transcript import, robotics control and additional professional
preview ecosystems remain [research](../research/README.md). See [platform status](platforms.md) for
native and distribution qualification.
