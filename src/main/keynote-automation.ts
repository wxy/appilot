import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const KEYNOTE_SCREENSHOT_LAYOUT = "appilot.screenshot.v1";

export interface KeynoteScreenshotPage {
  language: string;
  screenshotId: string;
  screenshotName: string;
  title: string;
  description: string;
  imagePath: string;
}

function appleScriptString(value: string): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;
}

export function buildKeynoteFillScript(input: {
  documentPath: string;
  layoutName?: string;
  pages: KeynoteScreenshotPage[];
  exportPngDirectory?: string;
}): string {
  const layoutName = input.layoutName || KEYNOTE_SCREENSHOT_LAYOUT;
  const pageBlocks = input.pages.map((page) => `
      set generatedSlide to make new slide at end of slides with properties {base layout:targetLayout}
      delay 0.1
      set titleItem to missing value
      set descriptionItem to missing value
      set editableTextItemCount to 0
      repeat with currentTextItem in text items of generatedSlide
        set itemPosition to position of currentTextItem
        if (width of currentTextItem) > 0 and (height of currentTextItem) > 0 then
          set editableTextItemCount to editableTextItemCount + 1
          if (item 2 of itemPosition) < (height of targetDocument) / 2 then
            set titleItem to currentTextItem
          else
            set descriptionItem to currentTextItem
          end if
        end if
      end repeat
      if editableTextItemCount is not 2 then error "Template must create exactly two editable text placeholders: appilot.title and appilot.description"
      if titleItem is missing value then error "Template is missing appilot.title"
      if descriptionItem is missing value then error "Template is missing appilot.description"
      set titlePosition to position of titleItem
      set titleCenterX to (item 1 of titlePosition) + ((width of titleItem) / 2)
      set titleCenterY to (item 2 of titlePosition) + ((height of titleItem) / 2)
      set descriptionPosition to position of descriptionItem
      set descriptionCenterX to (item 1 of descriptionPosition) + ((width of descriptionItem) / 2)
      set descriptionCenterY to (item 2 of descriptionPosition) + ((height of descriptionItem) / 2)
      set object text of titleItem to ${appleScriptString(page.title)}
      set object text of descriptionItem to ${appleScriptString(page.description)}
      set textMaxWidth to (width of targetDocument) * 0.8
      set width of titleItem to textMaxWidth
      set width of descriptionItem to textMaxWidth
      set position of titleItem to {titleCenterX - (textMaxWidth / 2), titleCenterY - ((height of titleItem) / 2)}
      set position of descriptionItem to {descriptionCenterX - (textMaxWidth / 2), descriptionCenterY - ((height of descriptionItem) / 2)}
      if (count of images of generatedSlide) is not 1 then error "Template must create exactly one editable appilot.image"
      set file name of image 1 of generatedSlide to POSIX file ${appleScriptString(page.imagePath)}
      set presenter notes of generatedSlide to ${appleScriptString(`appilot:${page.language}:${page.screenshotId}`)}
  `).join("\n");

  const exportBlock = input.exportPngDirectory
    ? `export targetDocument to POSIX file ${appleScriptString(input.exportPngDirectory)} as slide images with properties {image format:PNG}`
    : "";

  return `
set documentPath to ${appleScriptString(input.documentPath)}
set documentName to ${appleScriptString(path.basename(input.documentPath))}
set layoutName to ${appleScriptString(layoutName)}
set targetDocument to missing value
tell application id "com.apple.Keynote"
  try
    repeat 120 times
      set matchingDocuments to every document whose name is documentName
      if (count of matchingDocuments) is 1 then
        set targetDocument to item 1 of matchingDocuments
        exit repeat
      end if
      delay 0.25
    end repeat
    if targetDocument is missing value then error "Keynote did not open the copied template"
    tell targetDocument
      set matchingLayouts to every slide layout whose name is layoutName
      if (count of matchingLayouts) is not 1 then error "Template must contain exactly one layout named: " & layoutName
      set targetLayout to item 1 of matchingLayouts
      set originalSlideCount to count of slides
      ${pageBlocks}
      repeat originalSlideCount times
        delete slide 1
      end repeat
    end tell
    save targetDocument
    delay 2
    ${exportBlock}
    close targetDocument saving no
  on error errorMessage number errorNumber
    if targetDocument is not missing value then
      try
        close targetDocument saving no
      end try
    end if
    error errorMessage number errorNumber
  end try
end tell
return "OK"
`.trim();
}

export async function fillKeynoteFromTemplate(input: {
  templatePath: string;
  outputPath: string;
  pages: KeynoteScreenshotPage[];
  exportPngDirectory?: string;
}): Promise<{ pngPaths: string[] }> {
  if (process.platform !== "darwin") throw new Error("Keynote 生成功能仅支持 macOS");
  if (!fs.existsSync(input.templatePath)) throw new Error("Keynote 模板不存在");
  if (input.pages.length === 0) throw new Error("没有可生成的截图页面");
  for (const page of input.pages) {
    if (!fs.existsSync(page.imagePath)) throw new Error(`截图文件不存在：${page.imagePath}`);
  }

  if (path.resolve(input.templatePath) === path.resolve(input.outputPath)) {
    throw new Error("输出文件不能覆盖 Keynote 模板");
  }
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  if (input.exportPngDirectory) fs.mkdirSync(input.exportPngDirectory, { recursive: true });
  const outputParent = path.dirname(input.outputPath);
  const stagingParent = input.exportPngDirectory
    && path.resolve(input.exportPngDirectory) === path.resolve(outputParent)
    ? path.dirname(outputParent)
    : outputParent;
  const stagingPath = path.join(
    stagingParent,
    `${path.basename(input.outputPath, path.extname(input.outputPath))}-appilot-${crypto.randomUUID()}.key`,
  );
  // Do not carry the template's iWork document UUID into the generated copy.
  // Launch Services gives Keynote access to this exact new file before the
  // AppleScript binds to it by its unique name.
  fs.copyFileSync(input.templatePath, stagingPath);
  const scriptPath = path.join(os.tmpdir(), `appilot-keynote-${process.pid}-${Date.now()}.applescript`);
  fs.writeFileSync(scriptPath, buildKeynoteFillScript({
    documentPath: stagingPath,
    pages: input.pages,
    exportPngDirectory: input.exportPngDirectory,
  }), "utf8");
  let pngPaths: string[] = [];
  try {
    await execFileAsync("/usr/bin/open", ["-b", "com.apple.Keynote", stagingPath], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    await execFileAsync("/usr/bin/osascript", [scriptPath], { timeout: 180_000, maxBuffer: 1024 * 1024 });
    if (input.exportPngDirectory) {
      const exported = fs.readdirSync(input.exportPngDirectory)
        .filter((name) => name.toLowerCase().endsWith(".png"))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      if (exported.length !== input.pages.length) {
        throw new Error(`Keynote 导出了 ${exported.length} 张图片，预期 ${input.pages.length} 张`);
      }
      pngPaths = exported.map((name, index) => {
        const page = input.pages[index];
        const target = path.join(
          input.exportPngDirectory!,
          screenshotPngFileName(page, index),
        );
        fs.renameSync(path.join(input.exportPngDirectory!, name), target);
        return target;
      });
    }
    try {
      fs.renameSync(stagingPath, input.outputPath);
    } catch (moveError: any) {
      if (moveError?.code !== "EXDEV") throw moveError;
      await execFileAsync("/usr/bin/ditto", [stagingPath, input.outputPath], {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      });
      fs.unlinkSync(stagingPath);
    }
  } catch (error: any) {
    throw new Error(`Keynote 填充失败：${String(error?.stderr || error?.message || error).trim()}`);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    try { fs.unlinkSync(stagingPath); } catch { /* ignore */ }
  }
  return { pngPaths };
}

function safeFilePart(value: string): string {
  return String(value || "screenshot")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "")
    .slice(0, 80) || "screenshot";
}

export function screenshotPngFileName(page: KeynoteScreenshotPage, index: number): string {
  return `${String(index + 1).padStart(2, "0")}-${safeFilePart(page.language)}-${safeFilePart(page.screenshotName || page.screenshotId)}.png`;
}
