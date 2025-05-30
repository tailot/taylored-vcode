# Taylored Highlighter

## Overview

Taylored Highlighter is a VS Code extension that highlights changes in your files based on `.taylored` files. These `.taylored` files should be located in a `.taylored` directory in the root of your workspace. The extension helps you visualize additions and deletions specified in these `.taylored` files directly within your editor.

## Features

*   **.taylored File Processing:** Reads and processes `.taylored` files from the `.taylored` directory at your workspace root.
*   **Added Line Highlighting:** Highlights lines that have been added to a file. The style and color of the underline are configurable.
*   **Removed Line Highlighting:** Highlights lines that have been removed from a file. The underline appears on the line *preceding* the actual deletion in the original file, but is displayed in the context of the new file's line numbering. The style and color of the underline are configurable.
*   **Automatic Refresh:** Highlights are automatically updated whenever a `.taylored` file is saved, created, or deleted within the `.taylored` directory.
*   **Manual Refresh Command:** A command is available to manually trigger a re-scan of all `.taylored` files and refresh the highlights.
*   **Configurable Styles:** Offers configuration options for underline styles and colors, with separate settings for light and dark themes.

## Usage

Once the Taylored Highlighter extension is active, it automatically looks for a `.taylored` directory in the root of your workspace. It then processes any `.taylored` files found within this directory to visualize the specified changes (additions or deletions) directly in the corresponding source files.

## Commands

The following command is available via the VS Code command palette (Ctrl+Shift+P or Cmd+Shift+P):

*   **`taylored-highlighter.refreshAllHighlights`**
    *   **Title:** "Taylored: Refresh Highlights from All .taylored Files"
    *   **Description:** Manually triggers a re-scan of all `.taylored` files in the `.taylored` directory and updates the highlights in the relevant files.

## Configuration Options

You can configure the extension's behavior through your VS Code settings (`settings.json`). All options are available under the `tayloredHighlighter` prefix:

*   **`tayloredHighlighter.addedLineUnderlineStyle`**
    *   Description: The CSS style for the underline on added lines (e.g., `solid`, `dashed`, `dotted`, `double`, `wavy`).
    *   Type: `string`
    *   Default: `dotted`
*   **`tayloredHighlighter.addedLineUnderlineColor`**
    *   Description: The color of the underline for added lines. This is used if no theme-specific color is set.
    *   Type: `string`
    *   Default: `green`
*   **`tayloredHighlighter.addedLineUnderlineColorLight`**
    *   Description: The color of the underline for added lines when a light theme is active.
    *   Type: `string`
    *   Default: `darkgreen`
*   **`tayloredHighlighter.addedLineUnderlineColorDark`**
    *   Description: The color of the underline for added lines when a dark theme is active.
    *   Type: `string`
    *   Default: `lightgreen`
*   **`tayloredHighlighter.removedLineUnderlineStyle`**
    *   Description: The CSS style for the underline on removed lines (e.g., `solid`, `dashed`, `dotted`, `double`, `wavy`).
    *   Type: `string`
    *   Default: `dashed`
*   **`tayloredHighlighter.removedLineUnderlineColor`**
    *   Description: The color of the underline for removed lines. This is used if no theme-specific color is set.
    *   Type: `string`
    *   Default: `red`
*   **`tayloredHighlighter.removedLineUnderlineColorLight`**
    *   Description: The color of the underline for removed lines when a light theme is active.
    *   Type: `string`
    *   Default: `#990000`
*   **`tayloredHighlighter.removedLineUnderlineColorDark`**
    *   Description: The color of the underline for removed lines when a dark theme is active.
    *   Type: `string`
    *   Default: `#ff7f7f`
*   **`tayloredHighlighter.removedLineGutterIconPath`**
    *   Description: Path to an icon to display in the gutter for removed lines. Note: Gutter icons for removed lines are not currently implemented; underlines are used instead.
    *   Type: `string`
    *   Default: `""`

## License

This extension is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
