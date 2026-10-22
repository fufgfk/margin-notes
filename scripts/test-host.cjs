const {runTests}=require('@vscode/test-electron');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
runTests({
  vscodeExecutablePath:process.env.VSCODE_EXECUTABLE||'/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  extensionDevelopmentPath:root,
  extensionTestsPath:path.join(root,'out/test/host/index.js'),
  launchArgs:['--user-data-dir',path.join(root,'.test-vscode/user'),'--extensions-dir',path.join(root,'.test-vscode/extensions'),'--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates','--disable-telemetry']
}).catch(error=>{console.error(error);process.exitCode=1;});
