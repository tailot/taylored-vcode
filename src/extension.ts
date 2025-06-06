import { exec } from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';
import * as FsWithPath from 'path';
import parseDiffFunction, { File as ParsedDiffFile, Chunk as ParsedDiffHunk } from 'parse-diff';

async function isTayloredToolAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const command = os.platform() === 'win32' ? 'where taylored' : 'which taylored';
        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve(false);
            } else {
                if (stdout && stdout.trim().length > 0) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            }
        });
    });
}

function sanitizeFilenameForTayloredCli(filename: string): string {
    let result = filename.replace(/"/g, '');
    result = result.replace(/-/g, '');
    result = result.replace(/ /g, '');
    return result;
}

async function runTayloredCommand(args: string[], options: { cwd: string, successMessage?: string, showOutput?: boolean }): Promise<{ success: boolean, stdout?: string, stderr?: string }> {
    return new Promise((resolve) => {
        const escapeArgForShell = (arg: string): string => {
            if (typeof arg !== 'string') {
                arg = String(arg);
            }

            if ((/^--?[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(arg) && !/[\s"'\\]/.test(arg)) || arg === "-" || arg === "--") {
                return arg;
            }

            if (arg === "" || /[\s"'\\]/.test(arg) ) {
                return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
            }
            
            if (arg.startsWith('-')) {
                 return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
            }

            return arg;
        };
        const command = `taylored ${args.map(escapeArgForShell).join(' ')}`;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Taylored: Executing '${command}'...`,
            cancellable: false
        }, async (_progress) => {
            const shellToUse = os.platform() === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
            exec(command, { cwd: options.cwd, shell: shellToUse }, (error, stdout, stderr) => {
                if (error) {
                    vscode.window.showErrorMessage(`Taylored command failed: ${command}\nError: ${stderr || error.message}`, { modal: true });
                    resolve({ success: false, stderr: stderr || error.message, stdout });
                } else {
                    if (options.successMessage) {
                        vscode.window.showInformationMessage(options.successMessage);
                    }
                    if (options.showOutput && stdout && stdout.trim().length > 0) {
                         vscode.window.showInformationMessage(`Command: ${command}\nOutput:\n${stdout}`, { modal: true });
                    } else if (options.showOutput && stdout && stdout.trim().length === 0) {
                         vscode.window.showInformationMessage(`Command: ${command}\nExecuted successfully, no specific output produced.`, { modal: true });
                    }
                    if (args[0] === '--add' || args[0] === '--remove' || args[0] === '--save' || args[0] === '--offset') {
                        vscode.commands.executeCommand('taylored-highlighter.refreshAllHighlights');
                    }
                    resolve({ success: true, stdout, stderr });
                }
            });
        });
    });
}

async function getTayloredFilesList(workspaceRoot: string): Promise<string[] | undefined> {
    return new Promise((resolve) => {
        exec('taylored --list', { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                if (stderr && (stderr.toLowerCase().includes("'.taylored' directory not found") || stderr.toLowerCase().includes("no such file or directory"))) {
                    resolve([]);
                } else {
                    vscode.window.showErrorMessage(`Error listing .taylored files: ${stderr || stdout || error.message}`);
                    resolve(undefined);
                }
            } else {
                const files = stdout.trim().split('\n')
                                  .map(line => line.trim())
                                  .filter(line => line.length > 0)
                                  .map(fileNameFromList => {
                                      let processedName = fileNameFromList.replace(/\.taylored$/, '');
                                      while (
                                          processedName.length >= 2 &&
                                          processedName.startsWith('"') &&
                                          processedName.endsWith('"')
                                      ) {
                                          processedName = processedName.substring(1, processedName.length - 1);
                                      }
                                      return processedName.trim();
                                  })
                                  .filter(f => f.length > 0);
                resolve(files);
            }
        });
    });
}

async function getGitBranches(workspaceRoot: string): Promise<string[] | undefined> {
    return new Promise((resolve) => {
        exec('git branch --list --no-color', { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Error listing Git branches: ${stderr || stdout || error.message}`);
                resolve(undefined);
            } else {
                const branches = stdout.trim().split('\n')
                                   .map(branch => branch.replace(/^\*/, '').trim())
                                   .filter(branch => branch.length > 0 && !branch.startsWith('HEAD detached at'));
                resolve(branches);
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
        context.subscriptions.push(vscode.commands.registerCommand('taylored.showMainMenu', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage("No workspace folder open.");
                return;
            }

            const actionItems: (vscode.QuickPickItem & { actionKey: string })[] = [
                { label: "--add", description: "Apply a selected .taylored file (taylored --add)", actionKey: "add" },
                { label: "--remove", description: "Remove changes from a .taylored file (taylored --remove)", actionKey: "remove" },
                { label: "--save", description: "Create a .taylored file from branch changes (taylored --save)", actionKey: "save" },
                { label: "--offset", description: "Update offsets in a .taylored file (taylored --offset)", actionKey: "offset" },
            ];

            const selectedAction = await vscode.window.showQuickPick(actionItems, {
                placeHolder: "Select a Taylored action to perform"
            });

            if (!selectedAction) return;

            const tayloredFiles = await getTayloredFilesList(workspaceRoot);
            if (tayloredFiles === undefined && ['add', 'remove', 'offset'].includes(selectedAction.actionKey)) {
                 vscode.window.showErrorMessage("Could not get the list of .taylored files.");
                return;
            }

            let originalSelectedFile: string | undefined;
            if (['add', 'remove', 'offset'].includes(selectedAction.actionKey)) {
                if (!tayloredFiles || tayloredFiles.length === 0) {
                    vscode.window.showInformationMessage("No .taylored files found in the .taylored directory.");
                    return;
                }
                originalSelectedFile = await vscode.window.showQuickPick(tayloredFiles, {
                    placeHolder: `Select a .taylored file for '${selectedAction.label}'`
                });
                if (!originalSelectedFile) return;
            }

            let commandFileArg: string | undefined;
            if (originalSelectedFile) {
                commandFileArg = sanitizeFilenameForTayloredCli(originalSelectedFile);
            }


            switch (selectedAction.actionKey) {
                case 'add':
                    if (originalSelectedFile && commandFileArg !== undefined) {
                        await runTayloredCommand(['--add', commandFileArg], { cwd: workspaceRoot, successMessage: `${originalSelectedFile}.taylored applied successfully.`, showOutput: true });
                    }
                    break;
                case 'remove':
                    if (originalSelectedFile && commandFileArg !== undefined) {
                        await runTayloredCommand(['--remove', commandFileArg], { cwd: workspaceRoot, successMessage: `Changes from ${originalSelectedFile}.taylored removed successfully.`, showOutput: true });
                    }
                    break;
                case 'save':
                    const branches = await getGitBranches(workspaceRoot);
                    if (!branches || branches.length === 0) {
                        vscode.window.showInformationMessage("No Git branches found or error listing them.");
                        return;
                    }
                    const selectedBranch = await vscode.window.showQuickPick(branches, {
                        placeHolder: "Select a branch to save the .taylored file from"
                    });
                    if (selectedBranch) {
                        await runTayloredCommand(['--save', selectedBranch], { cwd: workspaceRoot, successMessage: `.taylored file for branch '${selectedBranch}' saved successfully (if changes were pure).`, showOutput: true });
                    }
                    break;
                case 'offset':
                    if (originalSelectedFile && commandFileArg !== undefined) {
                        const commitMessage = await vscode.window.showInputBox({
                            prompt: "Enter an optional commit message for the offset operation",
                            placeHolder: "Commit message (optional)"
                        });
                        const offsetArgs = ['--offset', commandFileArg];
                        if (commitMessage !== undefined && commitMessage !== null && commitMessage.trim() !== '') {
                            offsetArgs.push('--message', commitMessage);
                        }
                        await runTayloredCommand(offsetArgs, { cwd: workspaceRoot, successMessage: `Offset update for ${originalSelectedFile}.taylored completed.`, showOutput: true });
                    }
                    break;
            }
        }));
    } else {
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

        if (extensionContext) {
            extensionContext.subscriptions.push(tayloredFileWatcher);
        } else {
            tayloredFileWatcher.dispose();
        }
    } else {
        vscode.window.showWarningMessage("No workspace folder found. FileSystemWatcher for the .taylored directory will not be activated.");
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

                if (!diffContent.trim()) {
                    continue;
                }

                const parsedDiffs: ParsedDiffFile[] = parseDiffFunction(diffContent);

                for (const diffFile of parsedDiffs) {
                    const targetFilePathRaw = diffFile.to || diffFile.from;
                    if (!targetFilePathRaw || targetFilePathRaw === '/dev/null') continue;

                    const cleanedFilePath = targetFilePathRaw.replace(/^[ab]\//, '');
                    const targetFileUri = await findFileInWorkspace(cleanedFilePath, workspaceRoot);


                    if (!targetFileUri) {
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
                                const firstAddedLineNumberInNewFile_0_indexed = currentIterationNewLineCounter - 1;

                                while (tempChangeIndex < chunk.changes.length && chunk.changes[tempChangeIndex].type === 'add') {
                                    addBlockLineCount++;
                                    actualNewLineCounter++;
                                    tempChangeIndex++;
                                }

                                if (firstAddedLineNumberInNewFile_0_indexed >= 0 && addBlockLineCount > 0) {
                                    if (!decorationsForThisTarget.adds.has(firstAddedLineNumberInNewFile_0_indexed)) {
                                        const lineToDecorate = firstAddedLineNumberInNewFile_0_indexed;
                                        const range = new vscode.Range(lineToDecorate, 0, lineToDecorate, Number.MAX_SAFE_INTEGER);
                                        const pluralSuffix = addBlockLineCount > 1 ? 's' : '';
                                        const hoverMessageContent = `Block of ${addBlockLineCount} added line${pluralSuffix} (from ${fileNameOuter}). Starts here.`;
                                        const hoverMessage = new vscode.MarkdownString(hoverMessageContent);
                                        decorationsForThisTarget.adds.set(lineToDecorate, { range, hoverMessage });
                                    }
                                }
                                changeIndex = tempChangeIndex;

                            } else if (change.type === 'del') {
                                let delBlockLineCount = 0;
                                let tempChangeIndex = changeIndex;

                                while (tempChangeIndex < chunk.changes.length && chunk.changes[tempChangeIndex].type === 'del') {
                                    delBlockLineCount++;
                                    actualOldLineCounter++;
                                    tempChangeIndex++;
                                }

                                const lineToUnderlineForDeletionBlock_0_indexed = currentIterationNewLineCounter -1;

                                if (lineToUnderlineForDeletionBlock_0_indexed >= 0 && delBlockLineCount > 0) {
                                    if (!decorationsForThisTarget.removes.has(lineToUnderlineForDeletionBlock_0_indexed)) {
                                        const range = new vscode.Range(lineToUnderlineForDeletionBlock_0_indexed, 0, lineToUnderlineForDeletionBlock_0_indexed, Number.MAX_SAFE_INTEGER);
                                        const pluralSuffix = delBlockLineCount > 1 ? 's' : '';
                                        const hoverMessageContent = `Block of ${delBlockLineCount} removed line${pluralSuffix} after this (from ${fileNameOuter}).`;
                                        const hoverMessage = new vscode.MarkdownString(hoverMessageContent);
                                        decorationsForThisTarget.removes.set(lineToUnderlineForDeletionBlock_0_indexed, { range, hoverMessage });
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
    } else if (processedFileCount === 0 && tayloredFileUris.length > 0) {
    }
}


function applyDecorationsToEditor(editor: vscode.TextEditor) {
    const editorUriString = editor.document.uri.toString();
    const decorationsForFile = activeDecorations.get(editorUriString);

    if (!addedLineDecorationType || !removedLineUnderlineDecorationType) {
        loadConfiguration();
        if (!addedLineDecorationType || !removedLineUnderlineDecorationType) {
            return;
        }
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
    const normalizedFilePath = FsWithPath.normalize(filePath);

    const possiblePathInWorkspace = vscode.Uri.joinPath(workspaceRoot, normalizedFilePath);
    try {
        await vscode.workspace.fs.stat(possiblePathInWorkspace);
        return possiblePathInWorkspace;
    } catch {  }

    if (FsWithPath.isAbsolute(normalizedFilePath)) {
        const absoluteUri = vscode.Uri.file(normalizedFilePath);
        if (absoluteUri.fsPath.startsWith(workspaceRoot.fsPath)) {
            try {
                await vscode.workspace.fs.stat(absoluteUri);
                return absoluteUri;
            } catch {  }
        }
    }

    const searchPatternRelative = `**/${normalizedFilePath.startsWith(FsWithPath.sep) ? normalizedFilePath.substring(1) : normalizedFilePath}`;
    try {
        const filesByRelativePath = await vscode.workspace.findFiles(searchPatternRelative, '**/node_modules/**', 1);
        if (filesByRelativePath.length > 0) {
            return filesByRelativePath[0];
        }
    } catch (findError) {
    }
    
    return undefined;
}


export function deactivate() {
    disposeDecorations();
    if (tayloredFileWatcher) {
        tayloredFileWatcher.dispose();
    }
    activeDecorations.clear();
}
