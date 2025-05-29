# Taylored Highlighter for VS Code

The "Taylored Highlighter" extension for Visual Studio Code helps you visualize changes defined in `.taylored` patch files directly within your editor. It processes all `.taylored` files found in a `.taylored/` directory at the root of your workspace and applies highlights to the corresponding source files.

## Features

* **Highlights Added Lines**: Added lines (indicated by `+` in the diff) are underlined in the source files.
    * Underline style and color are configurable.
* **Indicates Removed Lines**: Removed lines (indicated by `-` in the diff) are marked with a gutter icon.
    * The gutter icon can be customized.
* **Real-time Updates**:
    * Highlights are automatically updated when `.taylored` files are saved, created, modified, or deleted within the `.taylored/` directory.
    * Decorations persist when saving decorated source files or switching between editors.
* **Processes All Patches**: All `.taylored` files in the `.taylored/` directory are processed, and their changes are aggregated for highlighting.
* **Command for Manual Refresh**: A command `Taylored: Refresh Highlights from All .taylored Files` is available to manually re-scan and apply highlights.

## Prerequisites

* Your project should have a `.taylored/` directory in its root, containing your `.taylored` patch files.
* The source files referenced within the `.taylored` patch files must be present in your VS Code workspace.

## Configuration

You can customize the appearance of highlights via VS Code settings (File > Preferences > Settings, then search for "Taylored Highlighter"):

* **`tayloredHighlighter.addedLineUnderlineStyle`**:
    * Description: Underline style for added lines.
    * Default: `dotted`
    * Options: `solid`, `dotted`, `dashed`, `double`, `wavy`
* **`tayloredHighlighter.addedLineUnderlineColor`**:
    * Description: Generic underline color for added lines (fallback).
    * Default: `green`
* **`tayloredHighlighter.addedLineUnderlineColorLight`**:
    * Description: Underline color for added lines when using a light theme.
    * Default: `darkgreen`
* **`tayloredHighlighter.addedLineUnderlineColorDark`**:
    * Description: Underline color for added lines when using a dark theme.
    * Default: `lightgreen`
* **`tayloredHighlighter.removedLineGutterIconPath`**:
    * Description: Path (absolute or relative to the extension's installation directory) to an SVG/PNG icon for removed lines. Leave empty to use a default indicator (`➖`).

## Usage

1.  **Ensure Correct Project Structure**: Have your `.taylored` files in a `.taylored/` directory at the root of your workspace.
2.  **Activation**: The extension activates automatically when VS Code starts up if a `.taylored/` directory is detected or when you run its command.
3.  **View Highlights**: Open the source code files that are modified by your `.taylored` patches. You should see added lines underlined and gutter icons for removed lines.
4.  **Manual Refresh**: Use the command `Taylored: Refresh Highlights from All .taylored Files` (Ctrl+Shift+P or Cmd+Shift+P, then type the command) to force a re-scan at any time.

## Installation

### From VS Code Marketplace (Recommended)

*(Once the extension is published, it will be available here.)*
Search for "Taylored Highlighter" in the VS Code Extensions view (Ctrl+Shift+X or Cmd+Shift+X) and click Install.

### Manual Installation (from `.vsix` file)

If you have a `.vsix` package file for the extension (e.g., `taylored-highlighter-0.0.3.vsix`):

1.  **Package the Extension (for developers)**:
    * If you are developing the extension, you first need to create the `.vsix` file.
    * Install `@vscode/vsce` (the VS Code Extension manager) globally if you haven't already:
        ```bash
        npm install -g @vscode/vsce
        ```
    * Navigate to the root directory of the extension's source code in your terminal.
    * Run the packaging command:
        ```bash
        vsce package
        ```
    * This will create a `.vsix` file (e.g., `taylored-highlighter-x.y.z.vsix`).

2.  **Install the `.vsix` File in VS Code**:
    * Open VS Code.
    * Go to the Extensions view (Ctrl+Shift+X or Cmd+Shift+X).
    * Click on the "..." (More Actions) menu at the top of the Extensions view.
    * Select "Install from VSIX..."
    * Browse to and select the `.vsix` file you want to install.
    * VS Code will install the extension. You may need to reload VS Code for the changes to take effect.

## Development

If you want to contribute or modify the extension:

1.  Clone the repository (if applicable, or use your local source code).
2.  Install dependencies: `npm install`
3.  Compile TypeScript: `npm run compile` (or `npm run watch` for automatic compilation on changes).
4.  Open the extension project folder in VS Code.
5.  Press `F5` to start a new VS Code window (the Extension Development Host) with your extension loaded.
6.  Open a test project in the Extension Development Host window to test your changes.

---

This README assumes the extension's source code is available. If you are distributing it, you'd typically provide the `.vsix` or publish to the marketplace.
