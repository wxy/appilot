import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const KEYNOTE_SCREENSHOT_LAYOUT = "appilot.screenshot.v1";
export const KEYNOTE_TITLE_MARKER = "{{appilot.title}}";
export const KEYNOTE_DESCRIPTION_MARKER = "{{appilot.description}}";

export interface KeynoteTemplateLayout {
  name: string;
  detection: "native" | "sample" | "native-and-sample";
  sampleSlideNumber?: number;
}

export interface KeynoteTemplateInspection {
  templatePath: string;
  layouts: KeynoteTemplateLayout[];
  inspectedAt: string;
}

export interface KeynoteScreenshotPage {
  language: string;
  screenshotId: string;
  screenshotName: string;
  title: string;
  description: string;
  imagePath: string;
  layoutName?: string;
  nativePlaceholders?: boolean;
  sampleSlideNumber?: number;
}

function appleScriptString(value: string): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;
}

export function buildKeynoteValidationScript(input: {
  documentPath: string;
  layoutName?: string;
}): string {
  const layoutName = input.layoutName || KEYNOTE_SCREENSHOT_LAYOUT;
  return `
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
    if targetDocument is missing value then error "Keynote 未能打开模板验证副本"
    tell targetDocument
      set matchingLayouts to every slide layout whose name is layoutName
      if (count of matchingLayouts) is not 1 then error "模板必须且只能包含一个名为 " & layoutName & " 的母板"
      set validationSlide to make new slide at end of slides with properties {base layout:item 1 of matchingLayouts}
      delay 0.1
      set editableTextItemCount to 0
      repeat with currentTextItem in text items of validationSlide
        if (width of currentTextItem) > 0 and (height of currentTextItem) > 0 then
          set editableTextItemCount to editableTextItemCount + 1
        end if
      end repeat
      if editableTextItemCount is not 2 then error "模板母板必须包含 appilot.title 和 appilot.description 两个可编辑文本占位符"
      if (count of images of validationSlide) is not 1 then error "模板母板必须包含一个 appilot.image 图片占位符"
      delete validationSlide
    end tell
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

export function buildKeynoteInspectionScript(input: { documentPath: string }): string {
  return `
set documentName to ${appleScriptString(path.basename(input.documentPath))}
set outputText to ""
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
    if targetDocument is missing value then error "Keynote 未能打开模板检测副本"
    tell targetDocument
      set originalSlideCount to count of slides
      repeat with currentLayout in slide layouts
        set layoutName to name of currentLayout
        set validationSlide to make new slide at end of slides with properties {base layout:currentLayout}
        delay 0.1
        set nativeCompatible to false
        try
          set titleItem to default title item of validationSlide
          set bodyItem to default body item of validationSlide
          if (title showing of validationSlide) and (body showing of validationSlide) and (width of titleItem) > 0 and (height of titleItem) > 0 and (width of bodyItem) > 0 and (height of bodyItem) > 0 and (count of images of validationSlide) is 1 then
            set nativeCompatible to true
          end if
        end try
        if nativeCompatible then set outputText to outputText & "NATIVE" & tab & layoutName & linefeed
        delete validationSlide
      end repeat
      repeat with slideIndex from 1 to originalSlideCount
        set currentSlide to slide slideIndex
        set foundTitle to false
        set foundDescription to false
        try
          set titleValue to object text of default title item of currentSlide as text
          if titleValue is "${KEYNOTE_TITLE_MARKER}" or titleValue is "appilot.title" then set foundTitle to true
        end try
        try
          set bodyValue to object text of default body item of currentSlide as text
          if bodyValue is "${KEYNOTE_DESCRIPTION_MARKER}" or bodyValue is "appilot.description" then set foundDescription to true
        end try
        repeat with currentTextItem in text items of currentSlide
          try
            set textValue to object text of currentTextItem as text
            if textValue is "${KEYNOTE_TITLE_MARKER}" or textValue is "appilot.title" then set foundTitle to true
            if textValue is "${KEYNOTE_DESCRIPTION_MARKER}" or textValue is "appilot.description" then set foundDescription to true
          end try
        end repeat
        if foundTitle and foundDescription and (count of images of currentSlide) is 1 then
          set outputText to outputText & "SAMPLE" & tab & (name of base layout of currentSlide) & tab & slideIndex & linefeed
        end if
      end repeat
    end tell
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
return outputText
`.trim();
}

function parseKeynoteInspection(output: string, templatePath: string): KeynoteTemplateInspection {
  const native = new Set<string>();
  const samples = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const [kind, rawName, rawSlide] = line.split("\t");
    const name = String(rawName || "").trim();
    if (!name) continue;
    if (kind === "NATIVE") native.add(name);
    if (kind === "SAMPLE") {
      if (samples.has(name)) throw new Error(`母版“${name}”存在多张 Appilot 示例页`);
      samples.set(name, Number(rawSlide) || 0);
    }
  }
  const names = Array.from(new Set([...native, ...samples.keys()]));
  if (names.length === 0) {
    throw new Error("模板中没有可用母版：请使用内置标题/正文和一个媒体占位符，或为母版创建包含 Appilot 标记的示例页");
  }
  return {
    templatePath,
    layouts: names.map((name) => ({
      name,
      detection: native.has(name) && samples.has(name)
        ? "native-and-sample"
        : native.has(name) ? "native" : "sample",
      ...(samples.has(name) ? { sampleSlideNumber: samples.get(name) } : {}),
    })),
    inspectedAt: new Date().toISOString(),
  };
}

export async function inspectKeynoteTemplate(templatePath: string): Promise<KeynoteTemplateInspection> {
  if (process.platform !== "darwin") throw new Error("Keynote 模板检测仅支持 macOS");
  if (!fs.existsSync(templatePath) || path.extname(templatePath).toLowerCase() !== ".key") {
    throw new Error("请选择有效的 Keynote 模板");
  }
  const stagingPath = path.join(os.tmpdir(), `appilot-keynote-template-${crypto.randomUUID()}.key`);
  const scriptPath = path.join(os.tmpdir(), `appilot-keynote-inspect-${process.pid}-${Date.now()}.applescript`);
  fs.copyFileSync(templatePath, stagingPath);
  fs.writeFileSync(scriptPath, buildKeynoteInspectionScript({ documentPath: stagingPath }), "utf8");
  try {
    await execFileAsync("/usr/bin/open", ["-b", "com.apple.Keynote", stagingPath], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    const { stdout } = await execFileAsync("/usr/bin/osascript", [scriptPath], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return parseKeynoteInspection(stdout, templatePath);
  } catch (error: any) {
    throw new Error(`Keynote 模板不符合要求：${String(error?.stderr || error?.message || error).trim()}`);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    try { fs.unlinkSync(stagingPath); } catch { /* ignore */ }
  }
}

export async function validateKeynoteTemplate(templatePath: string): Promise<void> {
  await inspectKeynoteTemplate(templatePath);
}

export function buildKeynoteFillScript(input: {
  documentPath: string;
  layoutName?: string;
  pages: KeynoteScreenshotPage[];
  exportPngDirectory?: string;
}): string {
  const fallbackLayoutName = input.layoutName || KEYNOTE_SCREENSHOT_LAYOUT;
  const pageBlocks = input.pages.map((page) => {
    const layoutName = page.layoutName || fallbackLayoutName;
    const createSlide = page.sampleSlideNumber
      ? `duplicate slide ${page.sampleSlideNumber} to after last slide
      set generatedSlide to last slide`
      : `
      set matchingLayouts to every slide layout whose name is ${appleScriptString(layoutName)}
      if (count of matchingLayouts) is not 1 then error ${appleScriptString(`Template must contain exactly one layout named: ${layoutName}`)}
      set generatedSlide to make new slide at end of slides with properties {base layout:item 1 of matchingLayouts}`;
    const fillText = page.nativePlaceholders
      ? `
      set title showing of generatedSlide to true
      set body showing of generatedSlide to true
      set object text of default title item of generatedSlide to ${appleScriptString(page.title)}
      set object text of default body item of generatedSlide to ${appleScriptString(page.description)}`
      : `
      set titleItem to missing value
      set descriptionItem to missing value
      repeat with currentTextItem in text items of generatedSlide
        try
          set markerText to object text of currentTextItem as text
          if markerText is "${KEYNOTE_TITLE_MARKER}" or markerText is "appilot.title" then set titleItem to currentTextItem
          if markerText is "${KEYNOTE_DESCRIPTION_MARKER}" or markerText is "appilot.description" then set descriptionItem to currentTextItem
        end try
      end repeat
      if titleItem is missing value then error "Sample slide is missing ${KEYNOTE_TITLE_MARKER}"
      if descriptionItem is missing value then error "Sample slide is missing ${KEYNOTE_DESCRIPTION_MARKER}"
      set object text of titleItem to ${appleScriptString(page.title)}
      set object text of descriptionItem to ${appleScriptString(page.description)}`;
    return `
      ${createSlide}
      delay 0.1
      ${fillText}
      if (count of images of generatedSlide) is not 1 then error "Template must create exactly one editable appilot.image"
      set file name of image 1 of generatedSlide to POSIX file ${appleScriptString(page.imagePath)}
      set presenter notes of generatedSlide to ${appleScriptString(`appilot:${page.language}:${page.screenshotId}`)}
  `;
  }).join("\n");

  const exportBlock = input.exportPngDirectory
    ? `export targetDocument to POSIX file ${appleScriptString(input.exportPngDirectory)} as slide images with properties {image format:PNG}`
    : "";

  return `
set documentPath to ${appleScriptString(input.documentPath)}
set documentName to ${appleScriptString(path.basename(input.documentPath))}
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
