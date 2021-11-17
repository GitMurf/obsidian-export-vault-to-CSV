import { appendFile } from 'fs';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder } from 'obsidian';
declare module "obsidian" {
    interface WorkspaceLeaf {
        containerEl: HTMLElement;
    }
}
type RowUid = number;
interface CsvRow {
    uid: RowUid;
    title: string;
    parent: RowUid;
    block: string;
    order: number;
    created: Date;
    modified: Date;
    folderParent: string;
    folderPath: string;
    fileName: string;
    fileExt: string;
    rowType: string;
    blockType: string;
}
const pluginName = 'Export Vault to CSV';
const CsvHeadersCore = "uid,title,parent,string,order,create-time";
const CsvHeadersAdd = "edit-time,folder,folder-path,filename,file-ext,row-type,block-type";
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
let csvUid: RowUid;
let csvFileExport: CsvRow[][];

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
        console.log("loading plugin: " + pluginName);
        await this.loadSettings();

        // Trigger the export to CSV with command palette
        this.addCommand({
            id: 'export-vault-to-csv',
            name: 'Export the current Vault to CSV',
            callback: () => {
                exportToCsv(this.app, this);
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new SampleSettingTab(this.app, this));
    }

    onunload() {
        console.log("Unloading plugin: " + pluginName);
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

async function exportToCsv(thisApp: App, thisPlugin: MyPlugin) {
    csvUid = 1;
    csvFileExport = [];
    const rootFolder: TFolder = thisApp.vault.getRoot();
    console.log(`starting the looping for the export`);
    await getFilesFromFolder(thisApp, rootFolder, 0);
    console.log(`DONE with the looping for the export`);
    await writeCsvFile(thisApp, csvFileExport);
    console.log(`FINISHED the export and writing to file`);
}

async function getFilesFromFolder(thisApp: App, thisFolder: TFolder, parentFolderId: number) {
    //console.log(`    Looping through FOLDER: "${thisFolder.path}"`);
    const thisFolderId = await outputFolderToCsv(thisApp, thisFolder, parentFolderId);
    const fileExtToExport: string[] = ["md"];
    const childrenFilesAndFolders: TAbstractFile[] = thisFolder.children;
    for (const eachFileOrFolder of childrenFilesAndFolders) {
        if (eachFileOrFolder instanceof TFolder) {
            //TFolder - recursive call to getFilesFromFolder() function
            await getFilesFromFolder(thisApp, eachFileOrFolder, thisFolderId);
        } else if (eachFileOrFolder instanceof TFile) {
            //TFile
            const thisFile: TFile = eachFileOrFolder;
            if (fileExtToExport.includes(thisFile.extension)) {
                await outputFileToCsv(thisApp, thisFile, thisFolderId);
            }
        }
    }
}

async function outputFolderToCsv(thisApp: App, thisFolder: TFolder, parentFolderId: number) {
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
        uid: csvUid,
        title: foldName,
        parent: parentFolderId,
        block: "",
        order: -1,
        created: null,
        modified: null,
        folderParent: foldPar,
        folderPath: foldPath,
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

async function outputFileToCsv(thisApp: App, thisFile: TFile, parentFolderId: number) {
    //console.log(`        Looping through FILE: "${thisFile.basename}"`);
    let foldPar = thisFile.parent.name;
    if (foldPar === "" || !foldPar) { foldPar = "/" }
    foldPar = cleanString(foldPar);
    const foldPath = cleanString(thisFile.parent.path);
    const fileNm = cleanString(thisFile.basename);
    const fileEx = cleanString(thisFile.extension);
    let csvFile: CsvRow[] = [];
    const fileRow: CsvRow = {
        uid: csvUid,
        title: cleanString(thisFile.basename),
        parent: parentFolderId,
        block: "",
        order: 0,
        created: new Date(thisFile.stat.ctime),
        modified: new Date(thisFile.stat.mtime),
        folderParent: foldPar,
        folderPath: foldPath,
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
            const thisRow: CsvRow = {
                uid: csvUid,
                title: "",
                parent: fileRow.uid,
                block: cleanString(eachLine),
                order: lnCtr,
                created: new Date(thisFile.stat.ctime),
                modified: new Date(thisFile.stat.mtime),
                folderParent: foldPar,
                folderPath: foldPath,
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
    theString = theString.replace(/"/g, `""`);
    theString = `"${theString}"`;
    return theString;
}