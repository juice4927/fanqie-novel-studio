import { spawn } from "node:child_process";
import { injectFault } from "./fault-injection";

const API_TARGET = "cn.local.fanqie.novelstudio/model-api";
const AUTO_BACKUP_TARGET = "cn.local.fanqie.novelstudio/auto-backup";

const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class NovelStudioCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern void CredFree(IntPtr buffer);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, uint type, uint flags);

  public static void Write(string target, string secret) {
    byte[] bytes = Encoding.Unicode.GetBytes(secret);
    GCHandle pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
    try {
      CREDENTIAL credential = new CREDENTIAL {
        Type = 1,
        TargetName = target,
        CredentialBlobSize = (uint)bytes.Length,
        CredentialBlob = pinned.AddrOfPinnedObject(),
        Persist = 2,
        UserName = Environment.UserName
      };
      if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      pinned.Free();
    }
  }

  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return "";
      throw new Win32Exception(error);
    }
    try {
      CREDENTIAL credential = Marshal.PtrToStructure<CREDENTIAL>(pointer);
      if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0) return "";
      byte[] bytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      return Encoding.Unicode.GetString(bytes);
    } finally {
      CredFree(pointer);
    }
  }

  public static void Delete(string target) {
    if (!CredDelete(target, 1, 0)) {
      int error = Marshal.GetLastWin32Error();
      if (error != 1168) throw new Win32Exception(error);
    }
  }
}
'@

if ($env:NOVEL_STUDIO_CREDENTIAL_OPERATION -eq 'write') {
  $encoded = [Console]::In.ReadToEnd()
  $secret = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
  [NovelStudioCredential]::Write($env:NOVEL_STUDIO_CREDENTIAL_TARGET, $secret)
} elseif ($env:NOVEL_STUDIO_CREDENTIAL_OPERATION -eq 'read') {
  $secret = [NovelStudioCredential]::Read($env:NOVEL_STUDIO_CREDENTIAL_TARGET)
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secret)))
} else {
  [NovelStudioCredential]::Delete($env:NOVEL_STUDIO_CREDENTIAL_TARGET)
}
`;

function execute(target: string, operation: "read" | "write" | "delete", value = "") {
  injectFault("credential-unavailable");
  if (process.platform !== "win32") return Promise.resolve("");
  return new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      env: {
        ...process.env,
        NOVEL_STUDIO_CREDENTIAL_OPERATION: operation,
        NOVEL_STUDIO_CREDENTIAL_TARGET: target,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let error = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(error.trim() || `Windows Credential Manager 返回退出码 ${code}`));
      else resolve(output.trim());
    });
    child.stdin.end(operation === "write" ? Buffer.from(value, "utf8").toString("base64") : "");
  });
}

export async function readApiCredential() {
  const encoded = await execute(API_TARGET, "read");
  return encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
}

export async function writeApiCredential(value: string) {
  if (!value) throw new Error("API 密钥不能为空");
  await execute(API_TARGET, "write", value);
}

export async function deleteApiCredential() {
  await execute(API_TARGET, "delete");
}

export async function readAutoBackupCredential() {
  const encoded = await execute(AUTO_BACKUP_TARGET, "read");
  return encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
}

export async function writeAutoBackupCredential(value: string) {
  if (value.length < 8) throw new Error("自动备份密码至少需要 8 个字符");
  await execute(AUTO_BACKUP_TARGET, "write", value);
}

export async function deleteAutoBackupCredential() {
  await execute(AUTO_BACKUP_TARGET, "delete");
}
