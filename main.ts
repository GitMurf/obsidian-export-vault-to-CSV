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
    title: string;
    parent: HashUid;
    block: string;
    order: number;
    created: Date;
    modified: Date;
    folderParent: string;
    folderPathRel: string;
    folderPathAbs: string;
    fileName: string;
    fileExt: string;
    rowType: string;
    blockType: string;
}
const pluginName = 'Export Vault to CSV';
const CsvHeadersCore = "uid,title,parent,string,order,create-time";
const CsvHeadersAdd = "edit-time,folder,folder-path-rel,folder-path-abs,filename,file-ext,row-type,block-type";
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
    mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    mySetting: 'default'
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

        containerEl.createEl('h2', { text: 'Settings for my awesome plugin.' });

        new Setting(containerEl)
            .setName('Setting #1')
            .setDesc('It\'s a secret')
            .addText(text => text
                .setPlaceholder('Enter your secret')
                .setValue(this.plugin.settings.mySetting)
                .onChange(async (value) => {
                    console.log('Secret: ' + value);
                    this.plugin.settings.mySetting = value;
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
    await getFilesFromFolder(thisApp, rootFolder, "");
    console.log(`DONE with the looping for the export`);
    await writeCsvFile(thisApp, csvFileExport);
    console.log(`FINISHED the export and writing to file`);
}

async function getFilesFromFolder(thisApp: App, thisFolder: TFolder, parentFolderId: HashUid) {
    console.log(`    Looping through FOLDER: "${thisFolder.path}"`);
    const thisFolderId: HashUid = await outputFolderToCsv(thisApp, thisFolder, parentFolderId);
    const fileExtToExport: string[] = ["md"];
    const fileExcludeTerms: string[] = [".excalidraw"];
    const childrenFilesAndFolders: TAbstractFile[] = thisFolder.children;
    for (const eachFileOrFolder of childrenFilesAndFolders) {
        if (eachFileOrFolder instanceof TFolder) {
            //TFolder - recursive call to getFilesFromFolder() function
            await getFilesFromFolder(thisApp, eachFileOrFolder, thisFolderId);
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
                    await outputFileToCsv(thisApp, thisFile, thisFolderId);
                }
            }
        }
    }
}

async function outputFolderToCsv(thisApp: App, thisFolder: TFolder, parentFolderId: HashUid) {
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
        title: foldName,
        parent: parentFolderId,
        block: "",
        order: -1,
        created: null,
        modified: null,
        folderParent: foldPar,
        folderPathRel: foldPath,
        folderPathAbs: foldPathAbs,
        fileName: null,
        fileExt: null,
        rowType: rowTypes.folder,
        blockType: blockTypes.folder
    }
    csvFolder.push(folderRow);
    csvUid++;
    csvFileExport.push(csvFolder);
    return folderRow.uid;
}

async function outputFileToCsv(thisApp: App, thisFile: TFile, parentFolderId: HashUid) {
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
        title: cleanString(thisFile.basename),
        parent: parentFolderId,
        block: "",
        order: 0,
        created: new Date(thisFile.stat.ctime),
        modified: new Date(thisFile.stat.mtime),
        folderParent: foldPar,
        folderPathRel: foldPath,
        folderPathAbs: foldPathAbs,
        fileName: fileNm,
        fileExt: fileEx,
        rowType: rowTypes.file,
        blockType: blockTypes.file
    }
    csvFile.push(fileRow);
    csvUid++;
    const fileCont = await thisApp.vault.read(thisFile);
    const allLines = fileCont.split("\n");
    let lnCtr: number = 1;
    allLines.forEach(eachLine => {
        if (exportBlankLines || eachLine !== "") {
            const lineHash: HashUid = `${fileHash}-${lnCtr}-${getStringHash(eachLine)}`;
            const thisRow: CsvRow = {
                uid: lineHash,
                title: "",
                parent: fileRow.uid,
                block: cleanString(eachLine),
                order: lnCtr,
                created: new Date(thisFile.stat.ctime),
                modified: new Date(thisFile.stat.mtime),
                folderParent: foldPar,
                folderPathRel: foldPath,
                folderPathAbs: foldPathAbs,
                fileName: fileNm,
                fileExt: fileEx,
                rowType: rowTypes.block,
                blockType: blockTypes.line
            }
            csvFile.push(thisRow);
            csvUid++;
            lnCtr++;
        }
    })
    csvFileExport.push(csvFile);
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
    let csvData: string = `${CsvHeadersCore},${CsvHeadersAdd}`;
    theCsvFile.forEach(eachFile => {
        eachFile.forEach(eachRow => {
            const rowString = Object.values(eachRow).join(",");
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
