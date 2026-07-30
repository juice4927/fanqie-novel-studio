import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const MAGIC = Buffer.from("NOVELSTUDIO1");

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
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(archive), cipher.final()]);
  const tag = cipher.getAuthTag();
  await writeFile(destination, Buffer.concat([MAGIC, salt, iv, tag, encrypted]));
}

export async function restoreEncryptedBackup(source: string, workspaceRoot: string, password: string) {
  const payload = await readFile(source);
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("不是有效的工作台加密备份");
  let offset = MAGIC.length;
  const salt = payload.subarray(offset, offset += 16);
  const iv = payload.subarray(offset, offset += 12);
  const tag = payload.subarray(offset, offset += 16);
  const encrypted = payload.subarray(offset);
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(password, salt, 32), iv);
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
  const destination = path.join(workspaceRoot, "restored", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(destination, { recursive: true });
  for (const item of manifest.files) {
    const normalized = path.normalize(item.path);
    if (path.isAbsolute(normalized) || normalized.startsWith("..")) throw new Error("备份包含不安全路径");
    const entry = zip.file(item.path);
    if (!entry) throw new Error(`备份缺少文件：${item.path}`);
    const data = await entry.async("nodebuffer");
    if (data.byteLength !== item.bytes) throw new Error(`文件校验失败：${item.path}`);
    const target = path.join(destination, normalized);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return destination;
}
