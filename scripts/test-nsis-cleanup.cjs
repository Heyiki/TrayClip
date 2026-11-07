const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const config = require("../src-tauri/tauri.conf.json");
const hooks = config.bundle.windows.nsis.installerHooks;
const makensis = process.env.MAKENSIS_PATH ||
    path.join(process.env.LOCALAPPDATA, "tauri", "NSIS", "makensis.exe");

// Compile and run the configured production hook without touching the real
// application's files, registry entries, shortcuts, or running process.
for (const [name, checked, updating, deleted] of [
    ["checked during upgrade/downgrade uninstall", 1, 0, true],
    ["unchecked during uninstall", 0, 0, false],
    ["automatic update with no consent", 0, 1, false],
    ["automatic update preserves data even if checked", 1, 1, false],
]) {
    test(name, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trayclip-nsis-test-"));
        try {
            const installDir = path.join(dir, "app");
            const db = path.join(installDir, "data", "trayclip.db");
            const image = path.join(installDir, "data", "images", "example.png");
            const engine = path.join(installDir, "data", "ocr", "engine.exe");
            const unrelated = path.join(installDir, "keep.txt");
            const sibling = path.join(dir, "data", "keep.txt");
            for (const file of [db, image, engine, unrelated, sibling]) {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, "fixture");
            }
            const script = path.join(dir, "cleanup.nsi");
            const exe = path.join(dir, "cleanup.exe");
            fs.writeFileSync(script, `
Unicode true
!include LogicLib.nsh
${hooks ? `!include "${path.resolve(root, "src-tauri", hooks)}"` : ""}
Name "TrayClip cleanup test"
OutFile "${exe}"
RequestExecutionLevel user
SilentInstall silent
Var DeleteAppDataCheckboxState
Var UpdateMode
Section
  StrCpy $INSTDIR "$EXEDIR\\app"
  StrCpy $DeleteAppDataCheckboxState ${checked}
  StrCpy $UpdateMode ${updating}
  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif
SectionEnd
`);
            const compile = spawnSync(makensis, ["/V2", script], { encoding: "utf8" });
            assert.ifError(compile.error);
            assert.equal(compile.status, 0, compile.stdout + compile.stderr);
            const run = spawnSync(exe, [], { encoding: "utf8", timeout: 30000 });
            assert.ifError(run.error);
            assert.equal(run.status, 0, run.stdout + run.stderr);
            for (const file of [db, image, engine]) {
                assert.equal(fs.existsSync(file), !deleted, `${name}: ${file}`);
            }
            assert.ok(fs.existsSync(unrelated), "must not delete unrelated install files");
            assert.ok(fs.existsSync(sibling), "must not delete outside the install directory");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
}
