
import { ConsoleWithLogLevel } from 'pyright-internal/common/console';
import { createFromRealFileSystem } from 'pyright-internal/common/realFileSystem';
import { PyrightFileSystem } from 'pyright-internal/pyrightFileSystem';
import { WorkspaceMap } from 'pyright-internal/workspaceMap';
import { createConnection } from 'vscode-languageserver/node';

const workspaceMap = new WorkspaceMap();

const loggedConsole = new ConsoleWithLogLevel(console);
const fileSystem = createFromRealFileSystem(loggedConsole, undefined);
const pyrightFileSystem = new PyrightFileSystem(fileSystem);
console.log(pyrightFileSystem)

const connection = createConnection({});
// const server = PyrightServer
// workspaceMap.getWorkspaceForFile(
