# Taylored VS Code Extension

## Overview

This VS Code extension integrates the `taylored` CLI to provide seamless interaction with `.taylored` files. It enhances the development workflow by highlighting added or removed lines, offering hover information, and automatically updating highlights based on file changes.

## Features

- **Integration with `taylored` CLI**: Directly use `taylored` commands from within VS Code.
- **Line Highlighting**: Visually distinguish added and removed lines as defined in `.taylored` files located in the `.taylored/` directory.
- **Hover Information**: Get contextual information when hovering over highlighted lines.
- **Customizable Highlighting Styles**: Customize the appearance of highlights, including styles and colors.
- **Automatic Updates**: Highlights refresh automatically when relevant files are changed or after specific `taylored` commands are executed.
- **File Watcher**: Monitors `.taylored` files for changes and updates highlights accordingly.

## Prerequisites

- **`taylored` CLI**: The `taylored` command-line interface must be installed and accessible in your system's PATH.

## Getting Started / Usage

1.  **Installation**: Install the extension from the VS Code Marketplace.
2.  **Ensure `taylored` CLI is installed**: Follow the `taylored` CLI installation instructions if you haven't already. Verify it's in your PATH by running `taylored --version` in your terminal.
3.  **Open your project**: Open a project containing a `.taylored/` directory with `.taylored` files.
4.  **Using `taylored` commands**: The extension provides a VS Code command palette menu (Quick Pick) to run `taylored` commands. Access this by opening the command palette (Ctrl+Shift+P or Cmd+Shift+P) and typing "Taylored:". The available commands are:
    *   `--add`: Apply a selected .taylored file. (You'll be prompted to choose a `.taylored` file from your workspace).
    *   `--remove`: Remove changes from a selected .taylored file. (You'll be prompted to choose a `.taylored` file).
    *   `--verify-add`: Check if a selected .taylored patch can be applied. (You'll be prompted to choose a `.taylored` file).
    *   `--verify-remove`: Check if a selected .taylored patch can be removed. (You'll be prompted to choose a `.taylored` file).
    *   `--save`: Create a .taylored file from a selected branch's changes. (You'll be prompted to select a branch).
    *   `--upgrade`: Attempt to upgrade all existing .taylored files in the workspace.
    *   `--offset`: Update offsets in a selected .taylored file (optionally with a message). (You'll be prompted to choose a `.taylored` file).
    *   `--data`: Extract and display metadata from a selected .taylored file. (You'll be prompted to choose a `.taylored` file).

## Line Highlighting

The extension reads `.taylored` files from the `.taylored/` directory in your workspace.
-   **Added Lines**: Lines marked for addition are highlighted (default: green underline).
-   **Removed Lines**: The line *before* a block of removed lines is underlined (default: red underline) to indicate the deletion.
-   **Hover Information**: Hovering over a highlighted line will display information provided by the `taylored` CLI, such as the reason for the change or metadata.

## Configuration

You can customize the appearance of the highlights via VS Code settings. These settings allow specifying different colors for light and dark themes.

-   `tayloredHighlighter.addedLineUnderlineStyle`: Defines the style for added line highlights (e.g., `solid`, `dashed`, `dotted`).
-   `tayloredHighlighter.addedLineUnderlineColor`: Sets the default color for added line highlights.
-   `tayloredHighlighter.addedLineUnderlineColorLight`: Sets the color for added line highlights when a light theme is active.
-   `tayloredHighlighter.addedLineUnderlineColorDark`: Sets the color for added line highlights when a dark theme is active.
-   `tayloredHighlighter.removedLineUnderlineStyle`: Defines the style for removed line highlights.
-   `tayloredHighlighter.removedLineUnderlineColor`: Sets the default color for removed line highlights.
-   `tayloredHighlighter.removedLineUnderlineColorLight`: Sets the color for removed line highlights when a light theme is active.
-   `tayloredHighlighter.removedLineUnderlineColorDark`: Sets the color for removed line highlights when a dark theme is active.

Access these settings via `File > Preferences > Settings` and search for "tayloredHighlighter".

## File Watcher & Automatic Updates

-   The extension monitors files within the `.taylored/` directory. Changes to these files will trigger an automatic refresh of the highlights in the corresponding source files.
-   Highlights are also automatically refreshed after certain `taylored` commands (like `--save`, `--add`, `--remove`) are executed, assuming these commands modify the `.taylored` files.

## Troubleshooting

-   **Highlights not appearing**:
    *   Ensure the `taylored` CLI is installed and in your PATH.
    *   Verify that your project has a `.taylored/` directory at the root with valid `.taylored` files.
    *   Check the VS Code Output panel (select "Taylored" or "Log (Window)" from the dropdown for general extension messages, or specific "Taylored" task outputs if commands are run) for any error messages.
-   **Incorrect highlights**:
    *   Ensure your `.taylored` files are correctly formatted and up-to-date.
    *   Try running `taylored --save` to ensure the latest changes are written.
-   **Performance issues**:
    *   For very large projects or numerous `.taylored` files, performance might be affected. Consider if all files need active monitoring. (Future enhancements may address this).

For further issues, please report them on the extension's GitHub repository.
