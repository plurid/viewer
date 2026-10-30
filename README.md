# Viewer

Viewer is a file explorer that opens any file beside its folder, and keeps the tools you use on
those files in the same window.

![Quick Preview of a PDF over its folder in Viewer](docs/media/files.png)

For Macs with Apple Silicon and macOS 14 or later. Windows and Linux are in progress; see
[platform status](docs/reference/platforms.md).

## Run it

1. Download the Viewer disk image from the [Viewer website](https://plurid.com/viewer).
2. Open it and drag **Viewer** onto **Applications**.
3. Open Viewer from Applications. macOS asks once before opening an app from the internet; choose
   **Open**.

Viewer opens your Home folder. No account or model is needed to browse, preview or use the built-in
tools. It checks for a newer version once a day, and **Viewer → Check for Updates…** checks at once.
[Install and update Viewer](docs/guides/install.md) covers folder access, updates and removal.

To run Viewer from source, you need macOS with the Xcode command-line tools, Node 22.22 or later,
and pnpm 11:

```sh
git clone https://github.com/plurid/viewer.git
cd viewer
pnpm install
pnpm start
```

[Build and run Viewer](docs/development/builds.md) covers local app bundles.

## The first keys

| Key         | What it does                                              |
| ----------- | --------------------------------------------------------- |
| **⌘⇧O**     | Open a folder                                             |
| **Space**   | Look inside the selected file; **Escape** closes the look |
| **⌘F**      | Find files by name; type `ext:pdf` to show only PDFs      |
| **⌘K**      | Find any command by typing what you want to do            |
| **⌘1–⌘5**   | List, Grid, Columns, Gallery or Map view                  |
| **⌘Return** | Switch between one plane and all of them                  |

A **plane** is one open view: a folder, a file, a terminal, a browser or a tool. Planes sit side by
side, and a plane opened from another stays linked to it.
[All shortcuts](docs/reference/shortcuts.md)

## Three things to try

**Read a file without leaving its folder.** Select a PDF and press **Space**. Choose **Open linked
plane** to keep it open while you go on browsing. Press **⌘0** to bring every plane into view.

<details>
<summary>Watch: find a file and look inside</summary>

![Finding and previewing a document in Viewer](docs/media/files.gif)

[Watch or download the recording](docs/media/files.mp4).

</details>

**Convert a photograph.** Select an image, press **⌘K** and choose **Images for web…**. Check the
format, size and filename, then choose **Export image**. The original stays as it was.

<details>
<summary>Watch: convert an image and inspect the result</summary>

![Converting an image with Viewer's image tools](docs/media/create.gif)

[Watch or download the recording](docs/media/create.mp4).

</details>

**Start work on a branch.** In a Git repository, press **⌘K** and choose **New task from branch…**.
Name the task and branch, then choose **Create task**. Viewer opens the new worktree with a note, a
terminal and its Git changes.

<details>
<summary>Watch: turn a branch into a task</summary>

![Creating a branch task and opening its linked tools](docs/media/develop.gif)

[Watch or download the recording](docs/media/develop.mp4).

</details>

## Learn more

| To                                           | Read                                                      |
| -------------------------------------------- | --------------------------------------------------------- |
| Get comfortable in five minutes              | [Your first five minutes](docs/guides/getting-started.md) |
| Search, sort, rename and move files          | [Browse and organize](docs/guides/files.md)               |
| Convert, trim, shrink or rearrange files     | [Make a quick change](docs/guides/create.md)              |
| Keep a folder, a document and tools together | [Keep your work together](docs/guides/workspaces.md)      |
| Edit, run and review a code project          | [Work on a project](docs/guides/develop.md)               |
| Turn repeated work into a command            | [Make repeated work a command](docs/guides/automate.md)   |

Models and agents are optional. Add one in **Settings → Models** when you want help naming,
organizing or summarizing, and choose exactly what it may read.

To work on Viewer itself, start with [contributing](CONTRIBUTING.md). The
[sample playground](docs/development/playground.md) has files and projects to explore.

Part of [Plurid](https://plurid.com). Licensed under [DEL](LICENSE).
