import { execSync } from 'child_process'

/** Live fake-claude processes on this machine, i.e. sessions that outlived their app. */
export function fakeClaudeProcessCount(): number {
  const cmd =
    process.platform === 'win32'
      ? `powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*fake-claude.mjs*' }).Count"`
      : `pgrep -fc fake-claude.mjs || true`
  return Number(execSync(cmd).toString().trim() || 0)
}
