import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { parseDocument } from "../electron/worker";

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function tempRoot() { const root = mkdtempSync(path.join(os.tmpdir(), "novel-import-test-")); roots.push(root); return root; }

describe("research document importers", () => {
  it("previews UTF-8 TXT chapters", async () => {
    const root = tempRoot();
    const file = path.join(root, "sample.txt");
    writeFileSync(file, "第一段前言\n\n第一章 开端\n\n正文甲".replace("第一章", "第1章") + "。".repeat(30) + "\n\n第2章 变化\n\n正文乙" + "。".repeat(30), "utf8");
    const result = await parseDocument(file);
    expect(result.sourceType).toBe("TXT");
    expect(result.chapters).toHaveLength(2);
  });

  it("previews DOCX chapters", async () => {
    const root = tempRoot();
    const file = path.join(root, "sample.docx");
    const document = new Document({ sections: [{ children: [new Paragraph("第1章 开端"), new Paragraph("文档正文".repeat(20)), new Paragraph("第2章 继续"), new Paragraph("后续正文".repeat(20))] }] });
    writeFileSync(file, await Packer.toBuffer(document));
    const result = await parseDocument(file);
    expect(result.sourceType).toBe("DOCX");
    expect(result.chapters.length).toBeGreaterThanOrEqual(2);
  });

  it("previews EPUB content in spine order", async () => {
    const root = tempRoot();
    const file = path.join(root, "sample.epub");
    const zip = new JSZip();
    zip.file("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`);
    zip.file("OEBPS/content.opf", `<package><manifest><item id="c1" href="c1.xhtml"/><item id="c2" href="c2.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
    zip.file("OEBPS/c1.xhtml", `<html><head><title>第一章</title></head><body><h1>第一章</h1><p>${"正文一".repeat(20)}</p></body></html>`);
    zip.file("OEBPS/c2.xhtml", `<html><head><title>第二章</title></head><body><h1>第二章</h1><p>${"正文二".repeat(20)}</p></body></html>`);
    writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
    const result = await parseDocument(file);
    expect(result.sourceType).toBe("EPUB");
    expect(result.chapters.map((item) => item.title)).toEqual(["第一章", "第二章"]);
  });
});
