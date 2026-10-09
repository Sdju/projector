import type { SecretKey } from "../../contract.ts";
import { runPowerShell } from "./ps.ts";

const HELPER = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ProjectorVault {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Native {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredWrite(ref Native credential, uint flags);
  [DllImport("advapi32", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int reserved, out IntPtr credential);
  [DllImport("advapi32", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32")]
  public static extern void CredFree(IntPtr credential);
  public static bool Available() {
    IntPtr credential;
    CredRead("projector/probe-missing", 1, 0, out credential);
    int error = Marshal.GetLastWin32Error();
    if (credential != IntPtr.Zero) CredFree(credential);
    return error == 1168 || error == 0;
  }
  public static string Read(string target) {
    IntPtr credential;
    if (!CredRead(target, 1, 0, out credential)) return "";
    try {
      var native = Marshal.PtrToStructure<Native>(credential);
      if (native.CredentialBlob == IntPtr.Zero || native.CredentialBlobSize <= 0) return "";
      var bytes = new byte[native.CredentialBlobSize];
      Marshal.Copy(native.CredentialBlob, bytes, 0, bytes.Length);
      return Convert.ToBase64String(bytes);
    } finally { CredFree(credential); }
  }
  public static void Write(string target, string user, string comment, string value) {
    var bytes = Encoding.UTF8.GetBytes(value);
    var native = new Native();
    native.Type = 1;
    native.TargetName = target;
    native.UserName = user;
    native.Comment = comment;
    native.Persist = 2;
    native.CredentialBlobSize = bytes.Length;
    native.CredentialBlob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, native.CredentialBlob, bytes.Length);
      if (!CredWrite(ref native, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(native.CredentialBlob); }
  }
  public static void Remove(string target) { CredDelete(target, 1, 0); }
}
"@
switch ($env:PROJECTOR_SECRET_OP) {
  'available' { if ([ProjectorVault]::Available()) { 'yes' } else { 'no' } }
  'get' { [ProjectorVault]::Read($env:PROJECTOR_SECRET_TARGET) }
  'set' {
    $value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim()))
    [ProjectorVault]::Write($env:PROJECTOR_SECRET_TARGET, $env:PROJECTOR_SECRET_ACCOUNT, $env:PROJECTOR_SECRET_LABEL, $value)
  }
  'delete' { [ProjectorVault]::Remove($env:PROJECTOR_SECRET_TARGET) }
}
`;

function target({ service, account }: SecretKey) {
  const clean = (value: string) => value.replace(/[\r\n\0]/g, "").slice(0, 200);
  return `projector:${clean(service)}:${clean(account)}`;
}

let availableCache: Promise<boolean> | undefined;

export function secretsAvailable(): Promise<boolean> {
  availableCache ??= runPowerShell(HELPER, { env: { PROJECTOR_SECRET_OP: "available" } }).then(
    ({ stdout }) => stdout.trim() === "yes",
    () => false,
  );
  return availableCache;
}

export async function getSecret(key: SecretKey): Promise<string | undefined> {
  const { stdout } = await runPowerShell(HELPER, {
    env: { PROJECTOR_SECRET_OP: "get", PROJECTOR_SECRET_TARGET: target(key) },
  });
  const encoded = stdout.trim();
  if (!encoded) return undefined;
  return Buffer.from(encoded, "base64").toString("utf8");
}

export async function setSecret(key: SecretKey, label: string, value: string): Promise<void> {
  await runPowerShell(HELPER, {
    env: {
      PROJECTOR_SECRET_OP: "set",
      PROJECTOR_SECRET_TARGET: target(key),
      PROJECTOR_SECRET_ACCOUNT: key.account,
      PROJECTOR_SECRET_LABEL: label,
    },
    input: Buffer.from(value, "utf8").toString("base64"),
  });
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  await runPowerShell(HELPER, {
    env: { PROJECTOR_SECRET_OP: "delete", PROJECTOR_SECRET_TARGET: target(key) },
  });
}
