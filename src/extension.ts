// Copyright (c) 2025 tailot@gmail.com
// SPDX-License-Identifier: MIT

import { exec } from 'child_process';
import * as vscode from 'vscode';
import * as FsWithPath from 'path';
import parseDiffFunction, { File as ParsedDiffFile, Chunk as ParsedDiffHunk, Change as ParsedDiffChange } from 'parse-diff';

async function isTayloredToolAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        exec('taylored --help', (error, stdout, stderr) => {
            if (error) {
                console.warn("Taylored tool not found or error during execution:", error);
                resolve(false);
            } else {
                console.log("Taylored tool found.");
                resolve(true);
            }
        });
    });
}

let addedLineDecorationType: vscode.TextEditorDecorationType;
let removedLineUnderlineDecorationType: vscode.TextEditorDecorationType;

const activeDecorations = new Map<string, { add: vscode.DecorationOptions[], remove: vscode.DecorationOptions[] }>();
let tayloredFileWatcher: vscode.FileSystemWatcher | undefined;
let extensionContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
    extensionContext = context;

    const tayloredAvailable = await isTayloredToolAvailable();
    vscode.commands.executeCommand('setContext', 'taylored:isAvailable', tayloredAvailable);

    if (tayloredAvailable) {
        context.subscriptions.push(vscode.commands.registerCommand('taylored.showContextMenu', async () => {
            const workspaceRootCheck = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRootCheck) {
                vscode.window.showErrorMessage("No workspace folder open. Cannot access .taylored files.");
                return; // Exit early
            }

            const tayloredFiles = await getTayloredFilesList(); // ensure await is used
            if (tayloredFiles === undefined) { // Explicitly check for undefined in case of error
                // Error message already shown by getTayloredFilesList
                return;
            }
            if (tayloredFiles.length === 0) {
                vscode.window.showInformationMessage("No .taylored files found in the .taylored directory.");
                return;
            }

            const selectedFile = await vscode.window.showQuickPick(tayloredFiles, {
                placeHolder: "Select a .taylored file to apply"
            });

            if (selectedFile) {
                // Re-check workspaceRoot just before usage, though it's unlikely to change mid-command.
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspaceRoot) {
                    vscode.window.showErrorMessage("No workspace folder open. Cannot apply .taylored file.");
                    return;
                }

                // selectedFile is the base name from getTayloredFilesList
                const fileNameForTool = selectedFile; // taylored tool handles names with/without .taylored

                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Taylored: Applying ${fileNameForTool}...`,
                    cancellable: false
                }, async (progress) => {
                    exec(`taylored --add ${fileNameForTool}`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Error applying ${fileNameForTool}:`, stderr);
                            vscode.window.showErrorMessage(`Failed to apply ${fileNameForTool}.taylored: ${stderr || error.message}`);
                        } else {
                            vscode.window.showInformationMessage(`${fileNameForTool}.taylored applied successfully.`);
                            // Optionally, trigger a refresh of highlights if your extension manages them.
                            vscode.commands.executeCommand('taylored-highlighter.refreshAllHighlights');
                        }
                    });
                });
            }
        }));
        console.log("Taylored tool is available. Context menu registered.");
    } else {
        console.log("Taylored tool not found. Context menu will not be available.");
    }

    loadConfiguration();

    context.subscriptions.push(vscode.commands.registerCommand('taylored-highlighter.refreshAllHighlights', async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Taylored: Processing files...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: "Scanning .taylored files..." });
            await scanAndProcessAllTayloredFiles();
            progress.report({ increment: 100, message: "Processing complete." });
        });
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('tayloredHighlighter')) {
            disposeDecorations();
            loadConfiguration();
            if (activeDecorations.size > 0) {
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Taylored: Configuration changed, reprocessing...",
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0, message: "Updating highlights..." });
                    await scanAndProcessAllTayloredFiles();
                    progress.report({ increment: 100, message: "Update complete." });
                });
            }
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;

        const tayloredDir = FsWithPath.join(workspaceRoot, '.taylored');
        if (document.fileName.startsWith(tayloredDir) && document.fileName.endsWith('.taylored')) {
            await scanAndProcessAllTayloredFiles();
        } else if (activeDecorations.has(document.uri.toString())) {
            const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
            if (editor) {
                applyDecorationsToEditor(editor);
            }
        }
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && activeDecorations.has(editor.document.uri.toString())) {
            applyDecorationsToEditor(editor);
        }
    }));

    setupFileWatcher();

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Taylored: Initializing...",
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 0, message: "Scanning .taylored files..." });
        await scanAndProcessAllTayloredFiles();
        progress.report({ increment: 100, message: "Initialization complete." });
    });
}

function setupFileWatcher() {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const watchPatternPath = FsWithPath.join('.taylored', '*.taylored');
        const pattern = new vscode.RelativePattern(workspaceFolder, watchPatternPath);

        tayloredFileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        const reprocessAll = async (uri: vscode.Uri, eventType: string) => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Taylored: .taylored file ${eventType === 'delete' ? 'deleted' : eventType === 'create' ? 'created' : 'modified'}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: "Updating highlights..." });
                await scanAndProcessAllTayloredFiles();
                progress.report({ increment: 100, message: "Update complete." });
            });
        };

        tayloredFileWatcher.onDidChange(uri => reprocessAll(uri, 'change'));
        tayloredFileWatcher.onDidCreate(uri => reprocessAll(uri, 'create'));
        tayloredFileWatcher.onDidDelete(uri => reprocessAll(uri, 'delete'));

        extensionContext.subscriptions.push(tayloredFileWatcher);
    } else {
        vscode.window.showWarningMessage("No workspace folder found. FileSystemWatcher for .taylored directory will not be activated.");
    }
}

function loadConfiguration() {
    const config = vscode.workspace.getConfiguration('tayloredHighlighter');

    disposeDecorations();

    const addedUnderlineStyle = config.get<string>('addedLineUnderlineStyle', 'dotted');
    const commonAddedUnderlineClr = config.get<string>('addedLineUnderlineColor', 'green');
    const lightAddedUnderlineClr = config.get<string>('addedLineUnderlineColorLight', 'darkgreen');
    const darkAddedUnderlineClr = config.get<string>('addedLineUnderlineColorDark', 'lightgreen');

    addedLineDecorationType = vscode.window.createTextEditorDecorationType({
        textDecoration: `underline ${addedUnderlineStyle}`,
        light: { color: lightAddedUnderlineClr, textDecoration: `underline ${addedUnderlineStyle} ${lightAddedUnderlineClr}` },
        dark: { color: darkAddedUnderlineClr, textDecoration: `underline ${addedUnderlineStyle} ${darkAddedUnderlineClr}` },
        color: commonAddedUnderlineClr,
        isWholeLine: true,
    });

    const removedUnderlineStyle = config.get<string>('removedLineUnderlineStyle', 'dashed');
    const commonRemovedUnderlineClr = config.get<string>('removedLineUnderlineColor', 'red');
    const lightRemovedUnderlineClr = config.get<string>('removedLineUnderlineColorLight', '#990000');
    const darkRemovedUnderlineClr = config.get<string>('removedLineUnderlineColorDark', '#ff7f7f');

    removedLineUnderlineDecorationType = vscode.window.createTextEditorDecorationType({
        textDecoration: `underline ${removedUnderlineStyle}`,
        light: { color: lightRemovedUnderlineClr, textDecoration: `underline ${removedUnderlineStyle} ${lightRemovedUnderlineClr}` },
        dark: { color: darkRemovedUnderlineClr, textDecoration: `underline ${removedUnderlineStyle} ${darkRemovedUnderlineClr}` },
        color: commonRemovedUnderlineClr,
        isWholeLine: true,
    });
}

function disposeDecorations() {
    addedLineDecorationType?.dispose();
    removedLineUnderlineDecorationType?.dispose();
}

async function scanAndProcessAllTayloredFiles() {
    clearAllDecorationsGlobally();
    activeDecorations.clear();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage("No workspace folder open. Cannot find .taylored directory.");
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri;
    const tayloredDirUri = vscode.Uri.joinPath(workspaceRoot, '.taylored');

    let tayloredFileUris: [string, vscode.FileType][] = [];
    try {
        tayloredFileUris = await vscode.workspace.fs.readDirectory(tayloredDirUri);
    } catch (error) {
        return;
    }

    const allFileDecorations = new Map<string, { adds: Map<number, vscode.DecorationOptions>, removes: Map<number, vscode.DecorationOptions> }>();
    let processedFileCount = 0;

    for (const [fileNameOuter, fileType] of tayloredFileUris) {
        if (fileType === vscode.FileType.File && fileNameOuter.endsWith('.taylored')) {
            processedFileCount++;
            const tayloredFileUri = vscode.Uri.joinPath(tayloredDirUri, fileNameOuter);
            try {
                const fileContentBytes = await vscode.workspace.fs.readFile(tayloredFileUri);
                const diffContent = Buffer.from(fileContentBytes).toString('utf8');
                if (!diffContent.trim()) continue;

                const parsedDiffs: ParsedDiffFile[] = parseDiffFunction(diffContent);

                for (const diffFile of parsedDiffs) {
                    const targetFilePathRaw = diffFile.to || diffFile.from;
                    if (!targetFilePathRaw || targetFilePathRaw === '/dev/null') continue;

                    const cleanedFilePath = targetFilePathRaw.replace(/^[ab]\//, '');
                    const targetFileUri = await findFileInWorkspace(cleanedFilePath, workspaceRoot);

                    if (!targetFileUri) {
                        console.warn(`Source file not found in workspace: ${cleanedFilePath} (referenced in ${fileNameOuter})`);
                        continue;
                    }

                    const targetUriString = targetFileUri.toString();
                    if (!allFileDecorations.has(targetUriString)) {
                        allFileDecorations.set(targetUriString, { adds: new Map(), removes: new Map() });
                    }
                    const decorationsForThisTarget = allFileDecorations.get(targetUriString)!;

                    (diffFile.chunks || []).forEach((chunk: ParsedDiffHunk) => {
                        let actualNewLineCounter = chunk.newStart;
                        let actualOldLineCounter = chunk.oldStart;

                        let changeIndex = 0;
                        while (changeIndex < chunk.changes.length) {
                            const change = chunk.changes[changeIndex];
                            const currentIterationNewLineCounter = actualNewLineCounter;

                            if (change.type === 'add') {
                                let addBlockLineCount = 0;
                                let tempChangeIndex = changeIndex;
                                const firstAddedLineNumberInNewFile = currentIterationNewLineCounter - 1;

                                // Conta le righe 'add' consecutive e avanza actualNewLineCounter per ognuna
                                while (tempChangeIndex < chunk.changes.length && chunk.changes[tempChangeIndex].type === 'add') {
                                    addBlockLineCount++;
                                    actualNewLineCounter++; // Avanza per ogni riga 'add' nel blocco
                                    tempChangeIndex++;
                                }

                                if (firstAddedLineNumberInNewFile >= 0 && addBlockLineCount > 0) {
                                    // Applica una decorazione per l'intero blocco, sulla prima riga del blocco
                                    if (!decorationsForThisTarget.adds.has(firstAddedLineNumberInNewFile)) {
                                        const range = new vscode.Range(firstAddedLineNumberInNewFile, 0, firstAddedLineNumberInNewFile, Number.MAX_SAFE_INTEGER);
                                        const pluralSuffix = addBlockLineCount > 1 ? 's' : '';
                                        const hoverMessage = `Added (from ${fileNameOuter}): ${addBlockLineCount} line${pluralSuffix} involved.`;
                                        decorationsForThisTarget.adds.set(firstAddedLineNumberInNewFile, { range, hoverMessage: hoverMessage });
                                    }
                                }
                                // actualOldLineCounter NON cambia per le aggiunte
                                changeIndex = tempChangeIndex; // Muovi l'indice principale oltre questo blocco di aggiunte

                            } else if (change.type === 'del') {
                                let delBlockLineCount = 0;
                                let tempChangeIndex = changeIndex;

                                while (tempChangeIndex < chunk.changes.length && chunk.changes[tempChangeIndex].type === 'del') {
                                    delBlockLineCount++;
                                    actualOldLineCounter++;
                                    tempChangeIndex++;
                                }

                                const lineToUnderlineForDeletionBlock = currentIterationNewLineCounter - 1;

                                if (lineToUnderlineForDeletionBlock >= 0 && delBlockLineCount > 0) {
                                    if (!decorationsForThisTarget.removes.has(lineToUnderlineForDeletionBlock)) {
                                        const range = new vscode.Range(lineToUnderlineForDeletionBlock, 0, lineToUnderlineForDeletionBlock, Number.MAX_SAFE_INTEGER);
                                        const pluralSuffix = delBlockLineCount > 1 ? 's' : '';
                                        const hoverMessage = `Removed (from ${fileNameOuter}): ${delBlockLineCount} line${pluralSuffix} involved.`;
                                        decorationsForThisTarget.removes.set(lineToUnderlineForDeletionBlock, { range, hoverMessage: hoverMessage });
                                    }
                                }
                                changeIndex = tempChangeIndex;
                            } else if (change.type === 'normal') {
                                actualOldLineCounter++;
                                actualNewLineCounter++;
                                changeIndex++;
                            } else {
                                changeIndex++;
                            }
                        }
                    });
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Error processing ${fileNameOuter}: ${error.message || error}`);
            }
        }
    }

    allFileDecorations.forEach((decs, uriString) => {
        activeDecorations.set(uriString, {
            add: Array.from(decs.adds.values()),
            remove: Array.from(decs.removes.values())
        });
    });

    applyAllDecorationsToVisibleEditors();

    if (processedFileCount > 0 && activeDecorations.size === 0) {
        vscode.window.showInformationMessage("No applicable changes found in .taylored files to highlight.");
    } else if (processedFileCount === 0 && tayloredFileUris.length > 0) {
        vscode.window.showInformationMessage("No .taylored files found to process in the .taylored directory.");
    }
}

async function getTayloredFilesList(): Promise<string[] | undefined> {
    return new Promise((resolve) => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            // This case is already handled by the caller or should be.
            // vscode.window.showErrorMessage("No workspace folder open. Cannot determine .taylored directory.");
            resolve(undefined);
            return;
        }
        exec('taylored --list', { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                // Check if error is because .taylored directory doesn't exist
                if (stderr && stderr.toLowerCase().includes("'.taylored' directory not found") || stderr.toLowerCase().includes("no such file or directory")) {
                    console.log("'.taylored' directory does not exist or no files found. This is not necessarily an error for listing.");
                    resolve([]); // Resolve with empty list, command handler will inform user
                } else {
                    console.error("Error listing taylored files:", stderr || stdout);
                    vscode.window.showErrorMessage(`Error listing .taylored files: ${stderr || stdout || error.message}`);
                    resolve(undefined);
                }
            } else {
                const files = stdout.trim().split('\n')
                                  .map(f => f.replace(/\.taylored$/, '').trim())
                                  .filter(f => f.length > 0); // Ensure non-empty strings
                resolve(files);
            }
        });
    });
}

function applyDecorationsToEditor(editor: vscode.TextEditor) {
    const editorUriString = editor.document.uri.toString();
    const decorationsForFile = activeDecorations.get(editorUriString);

    if (!addedLineDecorationType || !removedLineUnderlineDecorationType) {
        return;
    }

    if (decorationsForFile) {
        editor.setDecorations(addedLineDecorationType, decorationsForFile.add);
        editor.setDecorations(removedLineUnderlineDecorationType, decorationsForFile.remove);
    } else {
        editor.setDecorations(addedLineDecorationType, []);
        editor.setDecorations(removedLineUnderlineDecorationType, []);
    }
}

function applyAllDecorationsToVisibleEditors() {
    vscode.window.visibleTextEditors.forEach(editor => {
        applyDecorationsToEditor(editor);
    });
}

function clearAllDecorationsGlobally() {
    vscode.window.visibleTextEditors.forEach(editor => {
        if (addedLineDecorationType) {
            editor.setDecorations(addedLineDecorationType, []);
        }
        if (removedLineUnderlineDecorationType) {
            editor.setDecorations(removedLineUnderlineDecorationType, []);
        }
    });
}

async function findFileInWorkspace(filePath: string, workspaceRoot: vscode.Uri): Promise<vscode.Uri | undefined> {
    const possiblePathInWorkspace = vscode.Uri.joinPath(workspaceRoot, filePath);
    try {
        await vscode.workspace.fs.stat(possiblePathInWorkspace);
        return possiblePathInWorkspace;
    } catch { /* continue */ }

    if (FsWithPath.isAbsolute(filePath)) {
        try {
            const absoluteUri = vscode.Uri.file(filePath);
            await vscode.workspace.fs.stat(absoluteUri);
            return absoluteUri;
        } catch { /* continue */ }
    }

    const searchPattern = `**/${filePath.startsWith('/') ? filePath.substring(1) : filePath}`;
    const files = await vscode.workspace.findFiles(searchPattern, '**/node_modules/**', 1);
    if (files.length > 0) return files[0];

    console.warn(`File not found: ${filePath} (relative to ${workspaceRoot.fsPath})`);
    return undefined;
}

export function deactivate() {
    disposeDecorations();
    if (tayloredFileWatcher) {
        tayloredFileWatcher.dispose();
    }
    activeDecorations.clear();
}