import { App, FileSystemAdapter, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder } from 'obsidian';
import { readFile, writeFile, readFileSync } from 'fs';
declare module "obsidian" {
    interface WorkspaceLeaf {
        containerEl: HTMLElement;
    }
}
// Roam blocks for export from CSV to JSON
type RoamUser = {
    ":user/uid": string
}
interface RoamBlock {
    uid: string;
    "create-time": number;
    "edit-time": number;
    ":create/user": RoamUser
    ":edit/user": RoamUser
    children?: RoamBlock[]
}
interface RoamBlockPage extends RoamBlock {
    title: string;
}
interface RoamBlockBlock extends RoamBlock {
    string: string;
}
type HashUid = string; // Now using the getStringHash function to create a unique ID for each block
interface CsvRow {
    uid: HashUid;
    //title: string;
    block: string;
    parent: HashUid;
    order: number;
    created: Date;
    modified: Date;
    //folderParent: string;
    //folderPathRel: string;
    folderPathAbs: string;
    //fileName: string;
    fileExt: string;
    rowType: string;
    blockType: string;
}
type CsvRowKey = keyof CsvRow;
const pluginName = 'Export Vault to CSV';
const CsvHeadersCore: string[] = ["uid","string","parent","order","create-time","edit-time"];
const CsvHeadersAdd: string[] = ["path-absolute", "file-ext", "row-type", "block-type"];
const CsvHeaderToFieldMapping = {
    "uid": "uid",
    "string": "block",
    "parent": "parent",
    "order": "order",
    "create-time": "created",
    "edit-time": "modified",
    "path-absolute": "folderPathAbs",
    "file-ext": "fileExt",
    "row-type": "rowType",
    "block-type": "blockType"
}
type HeaderFieldKey = keyof typeof CsvHeaderToFieldMapping;
const exportBlankLines: boolean = true;
const rowTypes = {
    folder: "folder",
    file: "file",
    block: "block"
}
const blockTypes = {
    file: "file",
    folder: "folder",
    line: "line",
    multi: "multi",
    header: "header",
    list: "list",
    code: "code",
    quote: "quote"
}
let csvUid: number; // This is no longer used as UID, but instead just a global counter of all blocks (lines)
let csvFileExport: CsvRow[][];
let vaultFullPath = "";
const myRoamUser = { ":user/uid": "R1S40rNV4ANUNdGed7VaElqiO783" }

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
    markdownBlocks: boolean;
    markdownTables: boolean;
    codeBlocks: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    markdownBlocks: false,
    markdownTables: true,
    codeBlocks: true
}

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;

    async onload() {
        console.log("loading plugin: " + pluginName);
        await this.loadSettings();

        // Trigger the export to CSV with command palette
        this.addCommand({
            id: 'export-vault-to-csv',
            name: 'Export the current Vault to CSV',
            callback: () => {
                exportToCsv(this.app, this);
            }
        });

        // Trigger the conversion from CSV to JSON
        this.addCommand({
            id: 'convert-csv-to-json',
            name: 'Convert CSV to JSON',
            callback: () => {
                csvToJson();
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new SampleSettingTab(this.app, this));
    }

    onunload() {
        console.log("Unloading plugin: " + pluginName);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class SampleSettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Nolocron Export to CSV' });

        new Setting(containerEl)
            .setName(createFragment((innerFrag) => {
                innerFrag.createEl('h3', { text: `Markdown Blocks: Treat consecutive lines as a single block in Nolocron`, cls: 'v2csv-setting' });
            }))
            .setDesc(createFragment((innerFrag) => {
                innerFrag.createEl('span', { text: `Strict markdown specs ignore single line breaks` });
                innerFrag.createEl('br');
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Enabled:' });
                innerFrag.createEl('span', { text: ` Consecutive lines with single lines breaks will be exported together as a single block` });
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Disabled (default):' });
                innerFrag.createEl('span', { text: ` Single line breaks will be exported separately as their own blocks` });
            }))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.markdownBlocks)
                .onChange(async (value) => {
                    this.plugin.settings.markdownBlocks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(createFragment((innerFrag) => {
                innerFrag.createEl('strong', { text: 'Markdown Tables' });
                innerFrag.createEl('span', { text: `: Store entire table as a single block in Nolocron` });
                innerFrag.createEl('br');
            }))
            .setDesc(createFragment((innerFrag) => {
                innerFrag.createEl('span', { text: `Markdown Tables are made up of a line for the header row as well as lines for each row in the table` });
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Note:' });
                innerFrag.createEl('span', { text: ` If you disable this setting Nolocron can still render all blocks together as a single table` });
                innerFrag.createEl('br');
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Enabled (default):' });
                innerFrag.createEl('span', { text: ` All lines for a markdown table will be exported together as a single block` });
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Disabled:' });
                innerFrag.createEl('span', { text: ` Each line in a markdown table will be exported separately as their own blocks` });
            }))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.markdownTables)
                .onChange(async (value) => {
                    this.plugin.settings.markdownTables = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(`Code Blocks: Store entire code block as a single block in Nolocron`)
            .setDesc(createFragment((innerFrag) => {
                innerFrag.createEl('span', { text: `Code blocks are comprised of multiple lines fenced between a pair of triple backticks (\`\`\`)` });
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Note:' });
                innerFrag.createEl('span', { text: ` If you disable this setting Nolocron can still render all blocks together as a single code block` });
                innerFrag.createEl('br');
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Enabled (default):' });
                innerFrag.createEl('span', { text: ` All lines within the fenced code block will be exported together as a single block` });
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Disabled:' });
                innerFrag.createEl('span', { text: ` Each line within the fenced code block will be exported separately as their own blocks` });
            }))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.codeBlocks)
                .onChange(async (value) => {
                    this.plugin.settings.codeBlocks = value;
                    await this.plugin.saveSettings();
                }));
    }
}

async function csvToJson() {
    let filePath = `C:\\Users\\ShawnMurphy\\OneDrive - SAM Dynamics\\1_Docs\\Tools\\NoloCron\\TheForce.csv`;
    const fileCont: string = readFileSync(filePath).toString();
    console.log(fileCont);
}

async function exportToCsv(thisApp: App, thisPlugin: MyPlugin) {
    csvUid = 1;
    csvFileExport = [];
    if (app.vault.adapter instanceof FileSystemAdapter) {
        // Example: 'C:\Users\ShawnMurphy\...\Obsidian\Vaults\VAULT_NAME'
        vaultFullPath = app.vault.adapter.getBasePath();
    }
    console.log("vaultFullPath:", vaultFullPath);
    const rootFolder: TFolder = thisApp.vault.getRoot(); // Example: "/"
    console.log(`starting the looping for the export`);
    await getFilesFromFolder(thisPlugin, thisApp, rootFolder, "");
    console.log(`DONE with the looping for the export`);
    await writeCsvFile(thisApp, csvFileExport);
    console.log(`FINISHED the export and writing to file`);
}

async function getFilesFromFolder(thisPlugin: MyPlugin, thisApp: App, thisFolder: TFolder, parentFolderId: HashUid) {
    console.log(`    Looping through FOLDER: "${thisFolder.path}"`);
    const thisFolderId: HashUid = outputFolderToCsv(thisFolder, parentFolderId);
    const fileExtToExport: string[] = ["md"];
    const fileExcludeTerms: string[] = [".excalidraw"];
    const childrenFilesAndFolders: TAbstractFile[] = thisFolder.children;
    for (const eachFileOrFolder of childrenFilesAndFolders) {
        if (eachFileOrFolder instanceof TFolder) {
            //TFolder - recursive call to getFilesFromFolder() function
            await getFilesFromFolder(thisPlugin, thisApp, eachFileOrFolder, thisFolderId);
        } else if (eachFileOrFolder instanceof TFile) {
            //TFile
            const thisFile: TFile = eachFileOrFolder;
            if (fileExtToExport.includes(thisFile.extension)) {
                let excludeFile: boolean = false;
                fileExcludeTerms.forEach(term => {
                    if(excludeFile) { return; }
                    if (thisFile.basename.indexOf(term) > -1) {
                        excludeFile = true;
                    }
                });
                if (!excludeFile) {
                    await outputFileToCsv(thisPlugin, thisApp, thisFile, thisFolderId);
                }
            }
        }
    }
}

function outputFolderToCsv(thisFolder: TFolder, parentFolderId: HashUid) {
    const fullPath = `${vaultFullPath}` + "\\" + `${thisFolder.path}`;
    console.log(fullPath);
    const foldPathAbs = cleanString(fullPath);
    const folderHash: HashUid = getStringHash(fullPath);
    console.log(`    folderHash: ${folderHash}`);
    let foldName = thisFolder.name;
    if (foldName === "") { foldName = "/" }
    foldName = cleanString(foldName);
    let foldPar: string;
    let foldPath: string;
    if (thisFolder.parent) {
        foldPar = thisFolder.parent.name;
        if (foldPar === "") { foldPar = "/" }
        foldPath = thisFolder.parent.path;
    } else {
        foldPar = "vault";
        foldPath = "vault";
    }
    foldPar = cleanString(foldPar);
    foldPath = cleanString(foldPath);
    let csvFolder: CsvRow[] = [];
    const folderRow: CsvRow = {
        uid: folderHash,
        //title: foldName,
        block: foldName,
        parent: parentFolderId,
        order: -1,
        created: null,
        modified: null,
        //folderParent: foldPar,
        //folderPathRel: foldPath,
        folderPathAbs: foldPathAbs,
        //fileName: null,
        fileExt: "",
        rowType: rowTypes.folder,
        blockType: blockTypes.folder
    }
    csvFolder.push(folderRow);
    csvUid++;
    csvFileExport.push(csvFolder);
    return folderRow.uid;
}

async function outputFileToCsv(thisPlugin: MyPlugin, thisApp: App, thisFile: TFile, parentFolderId: HashUid) {
    //console.log(`        Looping through FILE: "${thisFile.basename}"`);
    const fileHash: HashUid = `${parentFolderId}-${getStringHash(thisFile.basename)}`;
    //console.log(`        fileHash: ${fileHash}`);
    let foldPar = thisFile.parent.name;
    if (foldPar === "" || !foldPar) { foldPar = "/" }
    foldPar = cleanString(foldPar);
    const foldPath = cleanString(thisFile.parent.path);
    const foldPathAbs = cleanString(`${vaultFullPath}` + "\\" + `${thisFile.parent.path}`);
    const fileNm = cleanString(thisFile.basename);
    const fileEx = cleanString(thisFile.extension);
    let csvFile: CsvRow[] = [];
    const fileRow: CsvRow = {
        uid: fileHash,
        //title: cleanString(thisFile.basename),
        block: cleanString(thisFile.basename),
        parent: parentFolderId,
        order: 0,
        created: new Date(thisFile.stat.ctime),
        modified: new Date(thisFile.stat.mtime),
        //folderParent: foldPar,
        //folderPathRel: foldPath,
        folderPathAbs: null,
        //fileName: fileNm,
        fileExt: fileEx,
        rowType: rowTypes.file,
        blockType: blockTypes.file
    }
    csvFile.push(fileRow);
    csvUid++;
    const fileCont = await thisApp.vault.read(thisFile);
    const allLines = fileCont.split("\n");
    for (let i = 0; i < allLines.length; i++) {
        const eachLine = allLines[i];
        let lnCtr: number = i + 1;
        if (exportBlankLines || eachLine !== "") {
            let blockString: string = eachLine;
            // Find next blank line
            let nextBlankLine: number = i + 1;
            while (nextBlankLine < allLines.length && allLines[nextBlankLine] !== "") {
                nextBlankLine++;
                if(nextBlankLine >= allLines.length) { break; }
            }

            if (eachLine === "") {

            } else if(eachLine === "---" && i === 0) { // YAML front matter
                let endOfYaml: number = i + 1;
                const lookFor = "---";
                while (endOfYaml < allLines.length && !allLines[endOfYaml].startsWith(lookFor)) {
                    endOfYaml++;
                }
                if (endOfYaml >= allLines.length) { endOfYaml = allLines.length - 1; }
                // Get YAML full string
                const yamlStr = getStringStartEnd(allLines, i, endOfYaml);
                blockString = yamlStr;
                i = endOfYaml;
            } else if (eachLine.startsWith("|")) { // Check if markdown table
                let endOfTable: number = findEndOfMdSection(allLines, i, "|");
                // Get markdown table full string
                const tableStr = getStringStartEnd(allLines, i, endOfTable);
                blockString = tableStr;
                i = endOfTable;
            } else if (eachLine.startsWith("```")) { // Check if code block
                let endOfCode: number = i + 1;
                const lookFor = "```";
                while (endOfCode < allLines.length && !allLines[endOfCode].startsWith(lookFor)) {
                    endOfCode++;
                }
                if (endOfCode >= allLines.length) { endOfCode = allLines.length - 1; }
                // Get code block full string
                const codeBlockStr = getStringStartEnd(allLines, i, endOfCode);
                blockString = codeBlockStr;
                i = endOfCode;
            } else if (eachLine.startsWith(">")) { // Check if quote
                // Each line does NOT have to have a > in front so just look for next blank line (or another md syntax)
                let endOfQuote: number = findEndOfMdSection(allLines, i, ">");
                const quoteStr = getStringStartEnd(allLines, i, endOfQuote);
                blockString = quoteStr;
                i = endOfQuote;
            } else if (eachLine.startsWith("#")) { // Check if heading
                
            } else if (eachLine.trim().match(/^(- |\* |[1-9]\. |[1-9]\) )/)) { // Check if list
                
            } else if (i + 1 < nextBlankLine) { // Check if markdown block with consecutive non-blank lines
                if (thisPlugin.settings.markdownBlocks === true) {
                    // Get next line that is not blank, header, table, code, quote, list etc.
                    let endOfMdBlock: number = findEndOfMdSection(allLines, i);
                    if (i < endOfMdBlock) {
                        const markdownStr = getStringStartEnd(allLines, i, endOfMdBlock);
                        blockString = markdownStr;
                        i = endOfMdBlock;
                    }
                } else {
                    // Markdown blocks should be split into their own lines so leave as is
                }
            }
            const blockHash: HashUid = `${fileHash}-${lnCtr}-${getStringHash(blockString)}`;
            const thisRow: CsvRow = {
                uid: blockHash,
                //title: "",
                block: cleanString(blockString),
                parent: fileRow.uid,
                order: lnCtr,
                created: new Date(thisFile.stat.ctime),
                modified: new Date(thisFile.stat.mtime),
                //folderParent: foldPar,
                //folderPathRel: foldPath,
                folderPathAbs: null,
                //fileName: fileNm,
                fileExt: null,
                rowType: rowTypes.block,
                blockType: blockTypes.line
            }
            csvFile.push(thisRow);
            csvUid++;
            lnCtr++;
        }
    }
    csvFileExport.push(csvFile);
}

function getStringStartEnd(allLines: string[], startLn: number, endLn: number): string {
    if (startLn === endLn) {
        return allLines[startLn];
    }
    // Loop through start and end lines concatenating the string
    let newString: string = "";
    for (let i = startLn; i <= endLn; i++) {
        newString += allLines[i] + "\n";
    }
    // Remove last newline
    newString = newString.slice(0, -1);
    return newString;
}

// This looks for the next blank line and/or a line that starts with a special md character for a new section
function findEndOfMdSection(allLines: string[], currentLn: number, curMdChar: string = null): number {
    // Get next line that is not blank, header, table, code, quote, list etc.
    let nextLine: number = currentLn + 1;
    if (nextLine >= allLines.length) { return allLines.length - 1; }
    let nextLineStr = allLines[nextLine].trim();
    while (nextLineStr !== "" && (!nextLineStr.match(/^(#+ |\||```|>|- |\* |[1-9]\. |[1-9]\) )/) || nextLineStr.startsWith(curMdChar))) {
        nextLine++;
        if (nextLine >= allLines.length) {
            break;
        }
        nextLineStr = allLines[nextLine].trim();
    }
    nextLine--;
    return nextLine;
}

async function writeCsvFile(thisApp: App, theCsvFile: CsvRow[][]) {
    /*Resources on BOM:
        https://stackoverflow.com/a/32002335
        https://csv.js.org/parse/options/bom/
        https://stackoverflow.com/questions/17879198/adding-utf-8-bom-to-string-blob
    */
    const utfBOM = `\ufeff`;
    let csvOutputFileName = 'VaultToCsv';
    csvOutputFileName += `_${window.moment().format('YYYY_MM_DD_HHmmss')}`;
    let csvData: string = `${CsvHeadersCore.join(",")},${CsvHeadersAdd.join(",")}`;
    theCsvFile.forEach(eachFile => {
        eachFile.forEach(eachRow => {
            let rowString = "";
            CsvHeadersCore.forEach(eachHeader => {
                const headerName = eachHeader as HeaderFieldKey;
                const objFieldName = CsvHeaderToFieldMapping[headerName] as CsvRowKey;
                const valueString = eachRow[objFieldName] ? eachRow[objFieldName] : "";
                rowString += `${valueString},`;
            });
            CsvHeadersAdd.forEach(eachHeader => {
                const headerName = eachHeader as HeaderFieldKey;
                const objFieldName = CsvHeaderToFieldMapping[headerName] as CsvRowKey;
                const valueString = eachRow[objFieldName] ? eachRow[objFieldName] : "";
                rowString += `${valueString},`;
            });
            //remove the trailing leftover comma
            rowString = rowString.substring(0, rowString.length - 1);
            //const rowString = Object.values(eachRow).join(",");
            csvData += `\n${rowString}`;
        })
    })
    const csvFile = new Blob([`${utfBOM}${csvData}`], { type: 'text/csv;charset=utf-8;' });
    const csvUrl = URL.createObjectURL(csvFile);
    let hiddenElement = document.createElement('a');
    hiddenElement.href = csvUrl;
    hiddenElement.target = '_blank';
    hiddenElement.download = csvOutputFileName + '.csv';
    hiddenElement.click();
}

function cleanString(theString: string) {
    let needToEscape = false;
    if (theString.includes(",")) {
        needToEscape = true;
    } else if (theString.includes("\n")) {
        needToEscape = true;
    } else if (theString.includes("\r")) {
        needToEscape = true;
    }

    if (theString.includes('"')) {
        needToEscape = true;
        theString = theString.replace(/"/g, `""`);
    }

    if (needToEscape) {
        theString = `"${theString}"`;
    }

    return theString;
}

function getStringHash(inputString: string) {
    let hash: number = 0;
    let strLen: number = inputString.length;
    const origStrLen: number = strLen;
    // Based on testing this was deemed a good point to cut off strings above this length in combination with the low likelihood of strings being greater than 10k that often (corner case protection)
    const maxLength: number = 10000;
    if (origStrLen > maxLength) {
        const maxHalf: number = maxLength / 2;
        const firstHalf: string = inputString.substring(0, maxHalf);
        const lastHalf: string = inputString.substring(strLen - maxHalf);
        inputString = `${firstHalf}${lastHalf}`;
        strLen = inputString.length;
    }
    // Iterating backwards is technically faster
    for (let i = strLen - 1; i >= 0; i--) {
        const eachChar: number = inputString.charCodeAt(i);
        // " | 0" at end makes it 32-bit int, optimizing for speed in JS engines.
        hash = (hash << 5) - hash + eachChar | 0;
        //hash = hash & hash; // Convert to 32bit int (dont need w/ optimization above)
    }
    //hash = new Uint32Array([hash])[0].toString(36); // This is slower than keeping as int
    let finalHash: string = "";
    if (origStrLen > maxLength) {
        // Adding original string length to hash incase longer than max and something changed in the text in the middle part of the string that was not used for the hash
        finalHash = `${hash}-${origStrLen}`;
    } else {
        finalHash = `${hash}`;
    }
    return finalHash;
}
