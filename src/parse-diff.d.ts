// Copyright (c) 2025 tailot@gmail.com
// SPDX-License-Identifier: MIT

declare module 'parse-diff' {
    export interface Change {
        type: 'add' | 'del' | 'normal';
        add?: boolean;
        del?: boolean;
        normal?: boolean;
        content: string;
        ln1?: number; // Line number in old file
        ln2?: number; // Line number in new file
    }

    export interface Hunk {
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        content: string;
        changes: Change[];
        linedelimiters?: string[];
    }

    export interface File {
        from?: string;
        to?: string;
        new?: boolean; // True if the file was added
        deleted?: boolean; // True if the file was deleted
        renamed?: boolean; // True if the file was renamed
        copied?: boolean; // True if the file was copied
        additions: number;
        deletions: number;
        chunks?: Hunk[]; // parse-diff usa 'chunks'
        hunks?: Hunk[];   // A volte ci si riferisce a questi come 'hunks'
        binary?: boolean; // If the diff indicates a binary file
        index?: string[]; // Git index lines
        header?: string; // Raw header for the file diff
    }

    function parse(diffString: string): File[];
    export default parse;
}
