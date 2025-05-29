// Copyright (c) 2025 tailot@gmail.com
// SPDX-License-Identifier: MIT

import * as vscode from 'vscode';
import * as FsWithPath from 'path';
import parseDiffFunction, { File as ParsedDiffFile, Hunk as ParsedDiffHunk, Change as ParsedDiffChange } from 'parse-diff';

let addedLineDecorationType: vscode.TextEditorDecorationType;
let removedLineGutterDecorationType: vscode.TextEditorDecorationType;

const activeDecorations = new Map<string, { add: vscode.DecorationOptions[], remove: vscode.DecorationOptions[] }>();
let tayloredFileWatcher: vscode.FileSystemWatcher | undefined;
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
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
                applyAllDecorationsToVisibleEditors();
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
                title: `Taylored: .taylored file ${eventType === 'delete' ? 'deleted' : 'modified'}`,
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
    
    const underlineStyle = config.get<string>('addedLineUnderlineStyle', 'dotted');
    const commonUnderlineClr = config.get<string>('addedLineUnderlineColor', 'green');
    const lightUnderlineClr = config.get<string>('addedLineUnderlineColorLight', 'darkgreen');
    const darkUnderlineClr = config.get<string>('addedLineUnderlineColorDark', 'lightgreen');

    disposeDecorations();

    addedLineDecorationType = vscode.window.createTextEditorDecorationType({
        textDecoration: `underline ${underlineStyle}`, 
        light: { color: lightUnderlineClr, textDecoration: `underline ${underlineStyle} ${lightUnderlineClr}` },
        dark: { color: darkUnderlineClr, textDecoration: `underline ${underlineStyle} ${darkUnderlineClr}`  },
        color: commonUnderlineClr, 
    });

    let gutterIconPathConfig = config.get<string>('removedLineGutterIconPath', '');
    let gutterIconOptions: { dark?: vscode.Uri; light?: vscode.Uri } = {};

    if (gutterIconPathConfig && extensionContext) {
        try {
            const iconPath = FsWithPath.isAbsolute(gutterIconPathConfig) ? gutterIconPathConfig : FsWithPath.join(extensionContext.extensionPath, gutterIconPathConfig);
            const iconUri = vscode.Uri.file(iconPath);
            gutterIconOptions.dark = iconUri;
            gutterIconOptions.light = iconUri;
        } catch (e) {
            // Fail silently or show minimal warning if icon path is bad, default will be used.
            console.warn(`Could not resolve custom gutter icon path: ${gutterIconPathConfig}. Using default. Error: ${e}`);
            gutterIconPathConfig = ''; 
        }
    }
    
    if (!gutterIconPathConfig) { 
        const defaultIconSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><text x='0' y='12' fill='%23C74E39'>➖</text></svg>`;
        gutterIconOptions.dark = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(defaultIconSvg)}`);
        gutterIconOptions.light = vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(defaultIconSvg)}`);
    }

    removedLineGutterDecorationType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        gutterIconPath: gutterIconOptions.dark, 
        gutterIconSize: 'contain',
    });
}

function disposeDecorations() {
    addedLineDecorationType?.dispose();
    removedLineGutterDecorationType?.dispose();
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
        // Silently fail if .taylored dir doesn't exist, or show minimal warning.
        // console.warn(`.taylored directory not found or unreadable at ${tayloredDirUri.fsPath}: ${error}`);
        return;
    }

    const allFileDecorations = new Map<string, { adds: Map<number, vscode.DecorationOptions>, removes: Map<number, vscode.DecorationOptions> }>();
    let processedFileCount = 0;

    for (const [fileName, fileType] of tayloredFileUris) {
        if (fileType === vscode.FileType.File && fileName.endsWith('.taylored')) {
            processedFileCount++;
            const tayloredFileUri = vscode.Uri.joinPath(tayloredDirUri, fileName);
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
                        console.warn(`Source file not found in workspace: ${cleanedFilePath} (referenced in ${fileName})`);
                        continue;
                    }

                    const targetUriString = targetFileUri.toString();
                    if (!allFileDecorations.has(targetUriString)) {
                        allFileDecorations.set(targetUriString, { adds: new Map(), removes: new Map() });
                    }
                    const decorationsForThisTarget = allFileDecorations.get(targetUriString)!;
                    
                    (diffFile.chunks || diffFile.hunks || []).forEach((chunk: ParsedDiffHunk) => {
                        let actualNewLineCounter = chunk.newStart; 
                        let actualOldLineCounter = chunk.oldStart; 

                        chunk.changes.forEach((change: ParsedDiffChange) => {
                            if (change.type === 'add') {
                                const lineForDecoration = actualNewLineCounter - 1; 
                                if (lineForDecoration >=0) { 
                                    if (!decorationsForThisTarget.adds.has(lineForDecoration)) { 
                                        const range = new vscode.Range(lineForDecoration, 0, lineForDecoration, Number.MAX_SAFE_INTEGER); 
                                        decorationsForThisTarget.adds.set(lineForDecoration, { range, hoverMessage: `Added (from ${fileName}): ${change.content.substring(1)}` });
                                    }
                                }
                                actualNewLineCounter++; 
                            } else if (change.type === 'del') {
                                const gutterLineForDeletion = actualNewLineCounter - 1; 
                                if (gutterLineForDeletion >=0) { 
                                    if (!decorationsForThisTarget.removes.has(gutterLineForDeletion)) { 
                                        const range = new vscode.Range(gutterLineForDeletion, 0, gutterLineForDeletion, 0);
                                        decorationsForThisTarget.removes.set(gutterLineForDeletion, { range, hoverMessage: `Removed (from ${fileName}): ${change.content.substring(1)}` });
                                    }
                                }
                                actualOldLineCounter++; 
                            } else if (change.type === 'normal') {
                                actualOldLineCounter++;
                                actualNewLineCounter++;
                            }
                        });
                    });
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Error processing ${fileName}: ${error.message || error}`);
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
    } else if (processedFileCount === 0 && tayloredFileUris.length > 0){
         vscode.window.showInformationMessage("No .taylored files found to process in the .taylored directory.");
    }
}

function applyDecorationsToEditor(editor: vscode.TextEditor) {
    const editorUriString = editor.document.uri.toString();
    const decorationsForFile = activeDecorations.get(editorUriString);

    if (!addedLineDecorationType || !removedLineGutterDecorationType) {
        return;
    }

    if (decorationsForFile) {
        editor.setDecorations(addedLineDecorationType, decorationsForFile.add);
        editor.setDecorations(removedLineGutterDecorationType, decorationsForFile.remove);
    } else {
        editor.setDecorations(addedLineDecorationType, []);
        editor.setDecorations(removedLineGutterDecorationType, []);
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
        if (removedLineGutterDecorationType) {
            editor.setDecorations(removedLineGutterDecorationType, []);
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
