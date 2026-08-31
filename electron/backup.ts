import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { AutoBackupFrequency } from "../src/shared/types";
import { injectFault } from "./fault-injection";

const MAGIC_V1 = Buffer.from("NOVELSTUDIO1");
const MAGIC = Buffer.from("NOVELSTUDIO2");
const AUTO_BACKUP_PATTERN = /^auto-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.novelbak$/;
const SCRYPT_OPTIONS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
const MAX_RESTORE_FILES = 50_000;
const MAX_RESTORE_BYTES = 2 * 1024 * 1024 * 1024;

export function nextAutoBackupAt(frequency: AutoBackupFrequency, from = new Date()) {
  const interval = frequency === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(from.getTime() + interval).toISOString();
}

export function autoBackupFileName(at = new Date()) {
  return `auto-${at.toISOString().replace(/[:.]/g, "-")}.novelbak`;
}

export async function pruneAutoBackups(backupRoot: string, retentionCount: number) {
  const entries = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && AUTO_BACKUP_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of entries.slice(Math.max(1, retentionCount)))
    await unlink(path.join(backupRoot, name)).catch(() => {});
  return entries.slice(0, Math.max(1, retentionCount));
}

async function walk(root: string, current = root): Promise<Array<{ absolute: string; relative: string }>> {
  const result: Array<{ absolute: string; relative: string }> = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === "backups" || entry.name === "restored") continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await walk(root, absolute));
    else if (!entry.name.endsWith("-wal") && !entry.name.endsWith("-shm")) result.push({ absolute, relative: path.relative(root, absolute).replace(/\\/g, "/") });
  }
  return result;
}

export async function createEncryptedBackup(workspaceRoot: string, destination: string, password: string) {
  if (password.length < 8) throw new Error("备份密码至少需要 8 个字符");
  const zip = new JSZip();
  const files = await walk(workspaceRoot);
  const manifest: Array<{ path: string; bytes: number }> = [];
  for (const file of files) {
    const data = await readFile(file.absolute);
    zip.file(file.relative, data);
    manifest.push({ path: file.relative, bytes: data.byteLength });
  }
  zip.file("backup-manifest.json", JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files: manifest }, null, 2));
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32, SCRYPT_OPTIONS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(archive), cipher.final()]);
  const tag = cipher.getAuthTag();
  const suffix = randomBytes(8).toString("hex");
  const temporary = `${destination}.${suffix}.tmp`;
  const previous = `${destination}.${suffix}.previous`;
  let previousMoved = false;
  try {
    injectFault("disk-full");
    await writeFile(temporary, Buffer.concat([MAGIC, salt, iv, tag, encrypted]));
    await verifyEncryptedBackup(temporary, password);
    const destinationExists = await access(destination).then(() => true, () => false);
    if (destinationExists) {
      await rename(destination, previous);
      previousMoved = true;
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (previousMoved) await rename(previous, destination);
      previousMoved = false;
      throw error;
    }
    if (previousMoved) await unlink(previous).catch(() => {});
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if (previousMoved) await rename(previous, destination).catch(() => {});
    throw error;
  }
}

async function readVerifiedArchive(source: string, password: string) {
  const payload = await readFile(source);
  const header = payload.subarray(0, MAGIC.length);
  const legacy = header.equals(MAGIC_V1);
  if (!legacy && !header.equals(MAGIC)) throw new Error("不是有效的工作台加密备份");
  let offset = MAGIC.length;
  const salt = payload.subarray(offset, offset += 16);
  const iv = payload.subarray(offset, offset += 12);
  const tag = payload.subarray(offset, offset += 16);
  const encrypted = payload.subarray(offset);
  const decipher = createDecipheriv("aes-256-gcm", legacy ? scryptSync(password, salt, 32) : scryptSync(password, salt, 32, SCRYPT_OPTIONS), iv);
  decipher.setAuthTag(tag);
  let archive: Buffer;
  try {
    archive = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new Error("备份密码错误或文件已损坏");
  }
  const zip = await JSZip.loadAsync(archive);
  const manifestEntry = zip.file("backup-manifest.json");
  if (!manifestEntry) throw new Error("备份缺少完整性清单");
  const manifest = JSON.parse(await manifestEntry.async("text")) as { files: Array<{ path: string; bytes: number }> };
  if (!Array.isArray(manifest.files)) throw new Error("备份完整性清单格式无效");
  if (manifest.files.length > MAX_RESTORE_FILES) throw new Error("备份文件数量超过安全限制");
  const declaredBytes = manifest.files.reduce((sum, item) => sum + (Number.isSafeInteger(item.bytes) && item.bytes >= 0 ? item.bytes : Number.POSITIVE_INFINITY), 0);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_RESTORE_BYTES) throw new Error("备份解压总量超过 2GB 安全限制");
  for (const item of manifest.files) {
    const normalized = path.normalize(item.path);
    if (path.isAbsolute(normalized) || normalized.startsWith("..")) throw new Error("备份包含不安全路径");
    const entry = zip.file(item.path);
    if (!entry) throw new Error(`备份缺少文件：${item.path}`);
    const data = await entry.async("nodebuffer");
    if (data.byteLength !== item.bytes) throw new Error(`文件校验失败：${item.path}`);
  }
  return { zip, manifest };
}

export async function verifyEncryptedBackup(source: string, password: string) {
  const { manifest } = await readVerifiedArchive(source, password);
  return { fileCount: manifest.files.length };
}

export async function restoreEncryptedBackup(source: string, workspaceRoot: string, password: string) {
  const { zip, manifest } = await readVerifiedArchive(source, password);
  const destination = path.join(workspaceRoot, "restored", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(destination, { recursive: true });
  for (const item of manifest.files) {
    const normalized = path.normalize(item.path);
    const entry = zip.file(item.path);
    const data = await entry!.async("nodebuffer");
    const target = path.join(destination, normalized);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return destination;
}
