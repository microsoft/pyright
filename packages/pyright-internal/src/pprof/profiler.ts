/**
 * Functions used for running pyright with pprof.
 * 
 * Steps taken to get this to work:
 * 	- Install VC++ Desktop C++ workload with at least one Windows SDK
	- Git clone DataDog/pprof-nodejs: pprof support for Node.js (github.com)
		○ Going to use this to generate an electron.node file for loading the profiler
	- Switch to packages\vscode-pylance
	- Npm install --save-dev node-abi@latest
		○  this is so electron-rebuild can find the right ABI
	- Npm install --save-dev @electron/rebuild
	- Electron rebuild the git cloned datadog/pprof-nodejs based on the version in VS code
		○ .\node_modules\.bin\electron-rebuild -v <version of electron reported in VS code about> -m <directory to datadog/pprof-nodejs>
	- Npm install --save-dev @datadog/pprof
	- Copy the build output from the electron-rebuild of the datadog git repository to the node_modules datadog
		○ It should be named something like bin\win32-x64-110\pprof-nodejs.node
		○ Copy it to the node_modules\@datadog\pprof\prebuilds\win32-x64
		○ Rename it to electron-110.node (or whatever ABI version it is using)
	- Modify pylance to use pprof around problem location using the pyright\packages\pyright-internal\pprof\profiler.ts
		○ startProfile before
		○ finishProfile after, passing it a file name
	- Rebuild Pylance
	- Make sure to turn off background analysis
	- Launch the CPU profiling profile
	- Reproduce the problem
	- Install Go (Get Started - The Go Programming Language)
	- Install Graphviz
		○ Choco install graphviz
	- Install the pprof cli 
		○ go install github.com/google/pprof@latest
	- Run pprof -http to look at results. 
		○ Profile should be in same directory as vscode-pylance output.
		○ Example pprof -http=: <name of profile>
 */

declare const __webpack_require__: typeof require;
declare const __non_webpack_require__: typeof require;

function getRequire(path: string) {
    const r = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;
    try {
        return r(`../node_modules/${path}`);
    } catch (err) {
        console.log(err);
    }
}

let counter = 1;

export function startProfile(): void {
    const pprof = getRequire('@datadog/pprof');
    pprof?.time.start({});
    console.log(`Starting profile : ${counter}`);
}
export function finishProfile(outputFile: string): void {
    const pprof = getRequire('@datadog/pprof');
    const profile = pprof?.time.stop();
    if (profile) {
        const fs = getRequire('fs-extra') as typeof import('fs-extra');
        const buffer = pprof?.encodeSync(profile);
        fs.writeFileSync(`${counter++}${outputFile}`, buffer);
    }
}
