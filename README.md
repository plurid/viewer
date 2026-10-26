# Viewer

**Start with a folder. Keep everything you need beside it.**

Viewer is a file explorer with room to do more. Browse your files, look inside them, make a quick
edit, or keep a whole project open in one workspace. A folder, a photograph, a browser and a
terminal can live beside each other as linked views.

![Reading a document in Viewer without leaving its folder](docs/media/files.png)

[Start here](docs/guides/getting-started.md) · [Explore the guides](docs/README.md) ·
[Build Viewer](docs/development/builds.md)

Developer preview for macOS, currently qualified on Apple Silicon. Windows and Linux work is in
progress; see [platform status](docs/reference/platforms.md).

## Open a folder. Get to work.

Use familiar lists, thumbnails and columns. Press Space to preview a file. Search by name, add a
filter, or find a passage inside a document. Keep a useful preview open beside its folder while you
continue browsing.

Viewer reads documents, spreadsheets, images, audio, video, code, archives and 3D models. Each
format gets controls suited to its contents: worksheet tabs, PDF pages, a structured-data tree or an
interactive model. The [format reference](docs/reference/formats.md) explains the coverage.

<details>
<summary>Watch: find a file and look inside</summary>

![Finding and previewing a document in Viewer](docs/media/files.gif)

[Watch or download the short recording](docs/media/files.mp4).

</details>

## Make a quick change

Convert a photograph to WebP, crop or resize a batch of images, trim a video, extract audio,
rearrange PDF pages or make a file smaller. Built-in tools process files locally and create new
outputs for you to inspect.

Optimize shows the actual size savings. Media drafts let you adjust segments and audio before
exporting. Notes and checklists give you somewhere to keep the thoughts that belong with the files.

<details>
<summary>Watch: convert an image and inspect the result</summary>

![Converting an image with Viewer's image tools](docs/media/create.gif)

[Watch or download the short recording](docs/media/create.mp4).

</details>

## Keep a project together

Open a browser beside your source, run a terminal in the project folder, and review Git changes
without losing the surrounding work. Create a task from a branch to bring its worktree, notes,
terminal and Git tools together.

Dock a view when you want to focus. Spread views out when their relationships help you think. Saved
workspaces bring you back to the files and tools you left open.

<details>
<summary>Watch: turn a branch into a task workspace</summary>

![Creating a branch task and opening its linked tools](docs/media/develop.gif)

[Watch or download the short recording](docs/media/develop.mp4).

</details>

## Go as deep as you like

| You want to…                          | Start with…                                 |
| ------------------------------------- | ------------------------------------------- |
| Find and organize your files          | [Everyday file work](docs/guides/files.md)  |
| Edit, convert or reduce a file        | [Creative tools](docs/guides/create.md)     |
| Keep several things open together     | [Workspaces](docs/guides/workspaces.md)     |
| Work on a code project                | [Development tools](docs/guides/develop.md) |
| Build your own commands and workflows | [Automation](docs/guides/automate.md)       |

Models and agents are optional. Connect them when you want help with naming, organization, summaries
or a task, and choose what data they may access. You can browse, preview and use the built-in tools
without configuring a model.

To try the developer build, follow [the build guide](docs/development/builds.md). The
[sample playground](docs/development/playground.md) provides files and projects to explore. To work
on Viewer itself, start with [contributing](CONTRIBUTING.md).

Part of [Plurid](https://plurid.com). Licensed under [DEL](LICENSE).
