import { dialog, ipcMain, nativeImage, shell } from "electron";
import fs from "fs";
import path from "path";
import type { StoreSubmissionDraft } from "@appilot-labs/appilot-core/store-submission";
import { createAiProvider } from "../ai-service";
import { resolveEffectiveCredentials } from "../credentials";
import {
  ensureProjectKeywordPool,
  findProductContext,
  findDraftByVersion,
  findStoreSubmissionDraft,
  getStoreSubmissionDrafts,
  upsertStoreSubmissionDraft,
} from "../project-state";
import { inferAppVersion, submissionDraftId } from "@appilot-labs/appilot-core/store-submission";
import { githubSyncCacheEntry } from "../scheduler";
import { getStore } from "../store";
import {
  generateStoreSubmissionDraft,
  synthesizeReleaseFromDraft,
} from "../release-service";
import { assertNonEmptyString, assertStringArray } from "../util";
import { notifyDataChanged } from "../data-sync";
import { log } from "@appilot-labs/appilot-core/logger";
import type { GitHubRepoCapabilities } from "@appilot-labs/appilot-core/github-api";
import { cancelAiRequest, withAiOperation } from "../ai-cancel";
import {
  copyPlansForProduct,
  copyPlanDuplicateKey,
  createCopyPlanItem,
  deleteCopyPlan,
  markCopyPlansUsed,
  normalizeCopyPlanInput,
  upsertCopyPlan,
} from "@appilot-labs/appilot-core/copy-plan";
import {
  generateScreenshotMaterialMaster,
  normalizeScreenshotCopySet,
  screenshotImageForLanguage,
  screenshotMaterialsForProduct,
  translateScreenshotMaterialMaster,
} from "@appilot-labs/appilot-core/screenshot-material";
import { buildProjectProfileFor } from "../release-service";
import { fillKeynoteFromTemplate } from "../keynote-automation";

function migrateLegacyScreenshotCopy(
  draft: StoreSubmissionDraft,
  project: any,
  product: any,
): boolean {
  const supported = (product.supportedLanguages || [])
    .map((item: any) => String(item.code || "").trim())
    .filter(Boolean);
  const legacy = draft.screenshotCopy || screenshotMaterialsForProduct(project, product.id);
  if (!legacy?.items?.length) return false;
  const sourceLanguage = legacy.sourceLanguage || draft.localizations[0]?.language || supported[0] || "en";
  const normalized = normalizeScreenshotCopySet(legacy, sourceLanguage, supported);
  if (JSON.stringify(draft.screenshotCopy) === JSON.stringify(normalized)) return false;
  draft.screenshotCopy = normalized;
  return true;
}

function preferredLegacyScreenshotTarget(project: any, productId: string): StoreSubmissionDraft | null {
  return getStoreSubmissionDrafts(project)
    .filter((draft) => draft.productId === productId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || null;
}

function screenshotArtifactContext(project: any, draft: StoreSubmissionDraft) {
  const product = (project.storeProducts || []).find((item: any) => item.id === draft.productId);
  if (!product) throw new Error("Store product not found");
  const supported = (product.supportedLanguages || [])
    .map((item: any) => String(item.code || "").trim())
    .filter(Boolean);
  if (!draft.screenshotCopy) throw new Error("请先创建截图文案");
  const screenshotCopy = normalizeScreenshotCopySet(
    draft.screenshotCopy,
    draft.screenshotCopy.sourceLanguage,
    supported,
  );
  if (!screenshotCopy.batchConfirmedAt) throw new Error("请先确定整批截图文案");

  const pages = screenshotCopy.selectedLanguages.flatMap((language) =>
    screenshotCopy.items.map((item) => {
      const copy = item.copies[language];
      if (!copy?.title || !copy?.description) {
        throw new Error(`${language} 的“${item.name}”文案不完整`);
      }
      if (language !== screenshotCopy.sourceLanguage && copy.sourceUpdatedAt !== screenshotCopy.masterUpdatedAt) {
        throw new Error(`${language} 的“${item.name}”仍需按当前母本重新翻译`);
      }
      const image = screenshotImageForLanguage(item, language, screenshotCopy.sourceLanguage);
      if (!image?.path || !fs.existsSync(image.path)) {
        throw new Error(`${language} 的“${item.name}”尚未选择可用图片`);
      }
      return {
        language,
        screenshotId: item.id,
        screenshotName: item.name,
        title: copy.title,
        description: copy.description,
        imagePath: image.path,
      };
    }),
  );
  const productName = String(product.trackName || project.name || "App").replace(/[\\/:*?"<>|]+/g, "-");
  const version = String(draft.appVersion || draft.releaseTag || "release").replace(/^v/i, "");
  return { pages, productName, version };
}

function availableDirectory(parent: string, baseName: string): string {
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = path.join(parent, suffix === 1 ? baseName : `${baseName}-${suffix}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("无法创建新的 PNG 输出目录");
}

export function registerReleaseHandlers(): void {
  ipcMain.handle("ai:cancel", (_event, operationId: string) => {
    if (!operationId) return false;
    return cancelAiRequest(operationId);
  });

  ipcMain.handle("release:selectScreenshotImage", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择截图图片",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "heic"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const imagePath = result.filePaths[0];
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) throw new Error("无法读取所选图片");
    const size = image.getSize();
    return {
      path: imagePath,
      fileName: path.basename(imagePath),
      width: size.width,
      height: size.height,
      selectedAt: new Date().toISOString(),
    };
  });

  ipcMain.handle("release:screenshotImagePreview", (_event, imagePath: string) => {
    imagePath = assertNonEmptyString(imagePath, "imagePath");
    if (!fs.existsSync(imagePath)) return null;
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const preview = size.width > 520 ? image.resize({ width: 520, quality: "good" }) : image;
    return preview.toDataURL();
  });

  ipcMain.handle("release:selectKeynoteTemplate", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 Keynote 截图模板",
      properties: ["openFile"],
      filters: [{ name: "Keynote", extensions: ["key"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    "release:generateKeynote",
    async (_event, projectId: string, draftId: string, templatePath: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      draftId = assertNonEmptyString(draftId, "draftId");
      templatePath = assertNonEmptyString(templatePath, "templatePath");
      if (!fs.existsSync(templatePath) || path.extname(templatePath).toLowerCase() !== ".key") {
        throw new Error("请选择有效的 Keynote 模板");
      }
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const draft = getStoreSubmissionDrafts(project).find((item) => item.id === draftId);
      if (!draft) throw new Error("Submission draft not found");
      const { pages, productName, version } = screenshotArtifactContext(project, draft);
      const saveResult = await dialog.showSaveDialog({
        title: "生成 Keynote 截图文稿",
        defaultPath: path.join(path.dirname(templatePath), `${productName}-${version}-screenshots.key`),
        filters: [{ name: "Keynote", extensions: ["key"] }],
      });
      if (saveResult.canceled || !saveResult.filePath) return null;
      const outputPath = saveResult.filePath.toLowerCase().endsWith(".key")
        ? saveResult.filePath
        : `${saveResult.filePath}.key`;
      if (path.resolve(outputPath) === path.resolve(templatePath)) {
        throw new Error("输出文件不能覆盖模板，请选择新的文件名");
      }
      await fillKeynoteFromTemplate({ templatePath, outputPath, pages });
      shell.showItemInFolder(outputPath);
      return { outputPath, pageCount: pages.length };
    },
  );

  ipcMain.handle(
    "release:exportScreenshotPngs",
    async (_event, projectId: string, draftId: string, templatePath: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      draftId = assertNonEmptyString(draftId, "draftId");
      templatePath = assertNonEmptyString(templatePath, "templatePath");
      if (!fs.existsSync(templatePath) || path.extname(templatePath).toLowerCase() !== ".key") {
        throw new Error("请选择有效的 Keynote 模板");
      }
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const draft = getStoreSubmissionDrafts(project).find((item) => item.id === draftId);
      if (!draft) throw new Error("Submission draft not found");
      const { pages, productName, version } = screenshotArtifactContext(project, draft);

      const folderResult = await dialog.showOpenDialog({
        title: "选择 PNG 输出位置",
        defaultPath: path.dirname(templatePath),
        buttonLabel: "选择",
        properties: ["openDirectory", "createDirectory"],
      });
      if (folderResult.canceled || folderResult.filePaths.length === 0) return null;
      const outputDirectory = availableDirectory(
        folderResult.filePaths[0],
        `${productName}-${version}-screenshots`,
      );
      const temporaryKeynotePath = path.join(outputDirectory, `${productName}-${version}-screenshots.key`);
      const result = await fillKeynoteFromTemplate({
        templatePath,
        outputPath: temporaryKeynotePath,
        pages,
        exportPngDirectory: outputDirectory,
      });
      fs.unlinkSync(temporaryKeynotePath);
      shell.showItemInFolder(result.pngPaths[0] || outputDirectory);
      return { outputDirectory, files: result.pngPaths, pageCount: result.pngPaths.length };
    },
  );

  ipcMain.handle("release:listCopyPlans", async (_event, projectId: string, productId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const context = findProductContext(s.get("projects") || [], productId);
    if (!context || context.project.id !== projectId) throw new Error("Store product does not belong to project");
    return copyPlansForProduct(context.project, productId);
  });

  ipcMain.handle("release:saveCopyPlan", async (_event, projectId: string, productId: string, value: any) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context || context.project.id !== projectId) throw new Error("Store product does not belong to project");
    const supported = (context.product.supportedLanguages || []).map((item: any) => String(item.code || ""));
    const input = normalizeCopyPlanInput(value, supported);
    if (!input) throw new Error("请填写标题、改进内容并至少选择一个目标字段");
    const existing = copyPlansForProduct(context.project, productId)
      .find((item) => item.id === String(value?.id || ""));
    const duplicate = copyPlansForProduct(context.project, productId).find(
      (item) => item.id !== existing?.id && copyPlanDuplicateKey(item) === copyPlanDuplicateKey(input),
    );
    if (duplicate) throw new Error("相同的文案计划已经存在");
    const item = existing
      ? {
          ...existing,
          ...input,
          updatedAt: new Date().toISOString(),
        }
      : createCopyPlanItem({
          projectId,
          productId,
          input,
          source: "manual",
        });
    upsertCopyPlan(context.project, item);
    s.set("projects", projects);
    notifyDataChanged("releases");
    return item;
  });

  ipcMain.handle("release:deleteCopyPlan", async (_event, projectId: string, productId: string, itemId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    itemId = assertNonEmptyString(itemId, "itemId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const context = findProductContext(projects, productId);
    if (!context || context.project.id !== projectId) throw new Error("Store product does not belong to project");
    if (!deleteCopyPlan(context.project, productId, itemId)) return false;
    s.set("projects", projects);
    notifyDataChanged("releases");
    return true;
  });

  ipcMain.handle(
    "release:createScreenshotDraft",
    async (
      _event,
      projectId: string,
      productId: string,
      releaseTag: string,
      appVersion: string,
      sourceLanguage: string,
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const product = (project.storeProducts || []).find((item: any) => item.id === productId);
      if (!product) throw new Error("Store product not found");
      const supported = (product.supportedLanguages || [])
        .map((item: any) => String(item.code || "").trim())
        .filter(Boolean);
      const source = supported.includes(String(sourceLanguage || "").trim())
        ? String(sourceLanguage).trim()
        : supported[0] || "en";
      const now = new Date().toISOString();
      const existing = findStoreSubmissionDraft(project, releaseTag)
        || findDraftByVersion(project, appVersion);
      const draft: StoreSubmissionDraft = existing || {
        id: submissionDraftId(projectId, releaseTag),
        projectId,
        productId,
        releaseTag,
        sourceHash: "",
        appVersion: String(appVersion || "").trim().replace(/^v/i, ""),
        buildNumber: "",
        githubDraftStatus: "draft",
        storeStatus: "prepared",
        reviewFeedback: "",
        summary: "",
        localizations: [],
        promotionalText: "",
        whatsNew: "",
        description: "",
        submissionKeywords: [],
        promotionAngles: [],
        createdAt: now,
        updatedAt: now,
      };
      if (!draft.screenshotCopy) {
        const legacy = screenshotMaterialsForProduct(project, productId);
        draft.screenshotCopy = legacy?.items?.length
          ? normalizeScreenshotCopySet(legacy, legacy.sourceLanguage || source, supported)
          : {
              sourceLanguage: source,
              selectedLanguages: supported.length > 0 ? supported : [source],
              masterUpdatedAt: "",
              items: [],
              updatedAt: now,
            };
      }
      draft.updatedAt = now;
      upsertStoreSubmissionDraft(project, draft);
      s.set("projects", projects);
      notifyDataChanged("release-drafts");
      return draft;
    },
  );

  ipcMain.handle(
    "release:generateScreenshotMaster",
    async (
      event,
      projectId: string,
      draftId: string,
      value: any,
      operationId = "",
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      draftId = assertNonEmptyString(draftId, "draftId");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const releaseDraft = getStoreSubmissionDrafts(project).find((item) => item.id === draftId);
      if (!releaseDraft) throw new Error("Submission draft not found");
      const product = (project.storeProducts || []).find((item: any) => item.id === releaseDraft.productId);
      if (!product) throw new Error("Store product not found");
      const supported = (product.supportedLanguages || [])
        .map((item: any) => String(item.code || "").trim())
        .filter(Boolean);
      const requestedSource = String(value?.sourceLanguage || "").trim();
      const screenshotCopy = normalizeScreenshotCopySet(
        value,
        requestedSource || supported[0] || "en",
        supported,
      );
      if (screenshotCopy.batchConfirmedAt) throw new Error("截图文案已整批确定，不可重新生成");
      const sourceLanguage = screenshotCopy.sourceLanguage;
      if (screenshotCopy.items.length === 0) throw new Error("请先添加截图类型");
      const unnamed = screenshotCopy.items.find((item) => !item.name.trim());
      if (unnamed) throw new Error("请填写每个截图类型的名称");

      const provider = await createAiProvider(s);
      const profile = await buildProjectProfileFor(project, product);
      const existing: Record<string, any> = {};
      for (const item of screenshotCopy.items) {
        const copy = item.copies[sourceLanguage];
        if (copy?.title || copy?.description) {
          existing[item.id] = { title: copy.title, description: copy.description };
        }
      }
      const storeMaster = releaseDraft.localizations.find((item) => item.language === sourceLanguage);
      const generated = await withAiOperation(operationId, (signal) =>
        generateScreenshotMaterialMaster(
          provider,
          {
            productName: product.trackName || project.name,
            profile,
            language: sourceLanguage,
            screenshots: screenshotCopy.items.map((item) => ({ id: item.id, name: item.name })),
            existing,
            storeMaster,
          },
          {
            signal,
            onProgress: (progress) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send("release:generateProgress", { kind: "chars", ...progress });
              }
            },
            onRetry: () => {
              if (!event.sender.isDestroyed()) {
                event.sender.send("release:generateProgress", { kind: "retry" });
              }
            },
          },
        ),
      );
      for (const item of screenshotCopy.items) {
        item.copies[sourceLanguage] = generated[item.id];
      }
      screenshotCopy.masterUpdatedAt = new Date().toISOString();
      screenshotCopy.updatedAt = screenshotCopy.masterUpdatedAt;
      // Generating or regenerating a master produces an editable draft. It must
      // be explicitly confirmed again before translations are available.
      delete screenshotCopy.masterConfirmedAt;
      delete screenshotCopy.batchConfirmedAt;

      // AI 调用期间项目数据可能被其它 handler 更新；写回前重新读取，避免覆盖。
      const latestProjects: any[] = s.get("projects") || [];
      const latestProject = latestProjects.find((item: any) => item.id === projectId);
      const latestDraft = latestProject
        ? getStoreSubmissionDrafts(latestProject).find((item) => item.id === draftId)
        : null;
      if (!latestDraft) throw new Error("Submission draft not found");
      latestDraft.screenshotCopy = screenshotCopy;
      latestDraft.updatedAt = screenshotCopy.updatedAt;
      upsertStoreSubmissionDraft(latestProject, latestDraft);
      s.set("projects", latestProjects);
      notifyDataChanged("release-drafts");
      return latestDraft;
    },
  );

  ipcMain.handle(
    "release:translateScreenshotCopy",
    async (
      event,
      projectId: string,
      draftId: string,
      targetLanguages: string[],
      operationId = "",
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      draftId = assertNonEmptyString(draftId, "draftId");
      targetLanguages = assertStringArray(targetLanguages, "targetLanguages");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const releaseDraft = getStoreSubmissionDrafts(project).find((item) => item.id === draftId);
      if (!releaseDraft?.screenshotCopy) throw new Error("请先创建截图文案");
      const product = (project.storeProducts || []).find((item: any) => item.id === releaseDraft.productId);
      if (!product) throw new Error("Store product not found");
      const supported = (product.supportedLanguages || [])
        .map((item: any) => String(item.code || "").trim())
        .filter(Boolean);
      const screenshotCopy = normalizeScreenshotCopySet(
        releaseDraft.screenshotCopy,
        releaseDraft.screenshotCopy.sourceLanguage,
        supported,
      );
      if (!screenshotCopy.masterConfirmedAt) throw new Error("请先确定截图母本");
      if (screenshotCopy.batchConfirmedAt) throw new Error("截图文案已整批确定");
      const targets = targetLanguages.filter(
        (language) => screenshotCopy.selectedLanguages.includes(language) && language !== screenshotCopy.sourceLanguage,
      );
      if (targets.length === 0) throw new Error("没有需要翻译的目标语言");
      const source: Record<string, any> = {};
      for (const item of screenshotCopy.items) {
        const copy = item.copies[screenshotCopy.sourceLanguage];
        if (!copy?.title || !copy?.description) throw new Error("请先完整生成截图母本");
        source[item.id] = { title: copy.title, description: copy.description };
      }

      const provider = await createAiProvider(s);
      const translated = await withAiOperation(operationId, (signal) =>
        translateScreenshotMaterialMaster(
          provider,
          {
            productName: product.trackName || project.name,
            sourceLanguage: screenshotCopy.sourceLanguage,
            targetLanguages: targets,
            screenshots: screenshotCopy.items.map((item) => ({ id: item.id, name: item.name })),
            source,
          },
          {
            signal,
            onProgress: (received) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send("release:generateProgress", { kind: "chars", ...received });
              }
            },
            onRetry: () => {
              if (!event.sender.isDestroyed()) event.sender.send("release:generateProgress", { kind: "retry" });
            },
          },
        ),
      );

      const latestProjects: any[] = s.get("projects") || [];
      const latestProject = latestProjects.find((item: any) => item.id === projectId);
      const latestDraft = latestProject
        ? getStoreSubmissionDrafts(latestProject).find((item) => item.id === draftId)
        : null;
      if (!latestDraft?.screenshotCopy) throw new Error("截图文案不存在");
      const latestCopy = normalizeScreenshotCopySet(
        latestDraft.screenshotCopy,
        latestDraft.screenshotCopy.sourceLanguage,
        supported,
      );
      if (latestCopy.masterUpdatedAt !== screenshotCopy.masterUpdatedAt) {
        throw new Error("截图母本在翻译期间发生变化，请重新翻译");
      }
      for (const item of latestCopy.items) {
        for (const language of targets) {
          item.copies[language] = {
            ...translated[language][item.id],
            sourceUpdatedAt: latestCopy.masterUpdatedAt,
          };
        }
      }
      latestCopy.updatedAt = new Date().toISOString();
      latestDraft.screenshotCopy = latestCopy;
      latestDraft.updatedAt = latestCopy.updatedAt;
      upsertStoreSubmissionDraft(latestProject, latestDraft);
      s.set("projects", latestProjects);
      notifyDataChanged("release-drafts");
      return latestDraft;
    },
  );

  async function githubReleaseCandidates(
    project: any,
    token: string | null | undefined,
    cached?: any,
    force = false,
  ): Promise<any[]> {
    const { listGitHubReleases } = await import("@appilot-labs/appilot-core/github-api");
    // 非强制刷新时优先用小时级同步缓存，避免每次打开工作台都打 GitHub API；
    // 缓存新鲜度（1 小时内 + lastSeenSha 一致）由 githubSyncCacheEntry 保证。
    if (!force && Array.isArray(cached?.releases) && cached.releases.length > 0) {
      return cached.releases;
    }
    const fresh = await listGitHubReleases(project.localPath, token);
    if (fresh.length > 0) return fresh;
    return Array.isArray(cached?.releases) ? cached.releases : [];
  }

  ipcMain.handle("release:list", async (_event, projectId: string, force?: boolean) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");

    const { checkForRelease } = await import("@appilot-labs/appilot-core/release-watcher");
    const token = resolveEffectiveCredentials(s, project.id).githubToken;
    const githubReleases = await githubReleaseCandidates(
      project,
      token,
      githubSyncCacheEntry(s, project),
      Boolean(force),
    );
    const result = await checkForRelease(
      project.localPath,
      project.lastReleaseSha || null,
      token,
      {
        sync: true,
        force: Boolean(force),
        githubReleases,
        githubCache: githubSyncCacheEntry(s, project) ?? undefined,
      },
    );
    // Draft-release visibility depends on the token's write access to
    // releases. Live-check on an explicit force refresh; otherwise reuse the
    // last hourly sync's result so the workbench can warn when drafts are
    // invisible instead of silently missing them.
    let githubCapabilities: GitHubRepoCapabilities | null = null;
    if (force) {
      const { fetchRepoCapabilities } = await import("@appilot-labs/appilot-core/github-api");
      githubCapabilities = await fetchRepoCapabilities(project.localPath, token);
    } else {
      githubCapabilities = githubSyncCacheEntry(s, project)?.capabilities ?? null;
    }
    log.debug(
      `release:list ${project.name} force=${Boolean(force)} ` +
        `githubCapabilities=${JSON.stringify(githubCapabilities)} ` +
        `releases=${result.releases.length} latest=${result.releases[0]?.tag || ""}`,
    );
    return {
      releases: result.releases.map((release) => ({
        ...release,
        // Copy is bound to the software, not to (software, platform): one
        // submission draft per release/version across all store products.
        submissionDrafts: (() => {
          const draft =
            findStoreSubmissionDraft(project, release.tag) ||
            findDraftByVersion(project, inferAppVersion(release));
          return draft ? [draft] : [];
        })(),
      })),
      latestDraft: result.releases.find((release) => release.draft) || null,
      githubCapabilities,
    };
  });

  ipcMain.handle(
    "release:context",
    async (_event, projectId: string, productId: string, releaseTag: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) return null;
      const product = (project.storeProducts || []).find((item: any) => item.id === productId);
      // Navigation can race project/product switches; a missing product is a
      // transient state, not an error worth surfacing in the handler.
      if (!product) return null;

      const { checkForRelease } = await import("@appilot-labs/appilot-core/release-watcher");
      const { readFullReadme, readRepoDescription } = await import("@appilot-labs/appilot-core/app-store-discovery");
      const token = resolveEffectiveCredentials(s, project.id).githubToken;
      const githubReleases = await githubReleaseCandidates(
        project,
        token,
        githubSyncCacheEntry(s, project),
        false,
      );
      const result = await checkForRelease(
        project.localPath,
        project.lastReleaseSha || null,
        token,
        {
          sync: true,
          githubReleases,
          githubCache: githubSyncCacheEntry(s, project) ?? undefined,
        },
      );
      let release = result.releases.find((item) => item.tag === releaseTag) || null;
      if (!release) {
        const saved = findStoreSubmissionDraft(project, releaseTag);
        if (saved) release = synthesizeReleaseFromDraft(saved);
      }
      if (!release) return null;

      const migrationTarget = preferredLegacyScreenshotTarget(project, productId);
      if (migrationTarget && migrateLegacyScreenshotCopy(migrationTarget, project, product)) {
        upsertStoreSubmissionDraft(project, migrationTarget);
        s.set("projects", projects);
      }

      const draftSummaries = getStoreSubmissionDrafts(project)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((draft) => ({
          id: draft.id,
          releaseTag: draft.releaseTag,
          updatedAt: draft.updatedAt,
          appVersion: draft.appVersion || "",
          summary: draft.summary || "",
          localizations: draft.localizations || [],
          promotionalText: draft.promotionalText || "",
          description: draft.description || "",
          whatsNew: draft.whatsNew || "",
          submissionKeywords: draft.submissionKeywords || [],
          githubDraftStatus: draft.githubDraftStatus || "",
          storeStatus: draft.storeStatus || "",
          storeCopyCreatedAt: draft.storeCopyCreatedAt || "",
          masterConfirmedAt: draft.masterConfirmedAt || "",
          batchConfirmedAt: draft.batchConfirmedAt || "",
          ascSyncedAt: draft.ascSyncedAt || "",
          screenshotCopy: draft.screenshotCopy,
        }))
        // Identity by appVersion: one entry per target version, newest first.
        .filter((draft, index, all) => {
          if (!draft.appVersion) return true;
          const version = String(draft.appVersion).replace(/^v/i, "");
          return all.findIndex((item) => {
            if (!item.appVersion) return false;
            return (
              String(item.appVersion).replace(/^v/i, "") === version
            );
          }) === index;
        });
      const previous = draftSummaries.find((item) => item.releaseTag !== releaseTag) || null;
      const readme = readFullReadme(project.localPath);
      let readmeModifiedAt = "";
      try {
        readmeModifiedAt = fs.statSync(path.join(project.localPath, "README.md")).mtime.toISOString();
      } catch {
        readmeModifiedAt = release.publishedAt || "";
      }

      return {
        readme,
        description: readRepoDescription(project.localPath),
        readmeModifiedAt,
        drafts: draftSummaries,
        previousDescription: previous?.description || "",
        previousUpdatedAt: previous?.updatedAt || "",
        copyGapKeywords: project.copyGapKeywords || [],
        copyPlans: copyPlansForProduct(project, productId),
        release,
      };
    },
  );

  ipcMain.handle(
    "release:get",
    async (
      _event,
      projectId: string,
      productId: string,
      releaseTag: string,
      force = false,
      language?: string,
      includeShas?: string[],
      appVersion?: string,
      includedChanges?: string[],
      operationId = "",
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      if (language !== undefined) {
        language = assertNonEmptyString(language, "language");
      }
      const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    const product = (project.storeProducts || []).find((item: any) => item.id === productId);
    if (!product) throw new Error("Store product not found");

    const { checkForRelease } = await import("@appilot-labs/appilot-core/release-watcher");
    const token = resolveEffectiveCredentials(s, project.id).githubToken;
    const githubReleases = await githubReleaseCandidates(
      project,
      token,
      githubSyncCacheEntry(s, project),
      Boolean(force),
    );
    _event.sender.send("release:generateProgress", {
      kind: "phase",
      phase: "read_draft",
      status: "started",
    });
    const result = await checkForRelease(
      project.localPath,
      project.lastReleaseSha || null,
      token,
      {
        sync: true,
        githubReleases,
        githubCache: githubSyncCacheEntry(s, project) ?? undefined,
      },
    );
    let release = result.releases.find((item) => item.tag === releaseTag) || null;
    if (!release) {
      const saved = findStoreSubmissionDraft(project, releaseTag);
      if (saved) release = synthesizeReleaseFromDraft(saved);
    }
    _event.sender.send("release:generateProgress", {
      kind: "phase",
      phase: "read_draft",
      status: "completed",
      bytes: release?.body?.length || 0,
    });
    if (!release) return { release: null, draft: null, actionable: false };

    let existing = findStoreSubmissionDraft(project, releaseTag);
    if (!existing) {
      // Identity by appVersion: a copy prepared under an older release for the
      // same target version belongs to this release's workbench too.
      const targetVersion = String(
        appVersion || inferAppVersion(release) || "",
      ).trim();
      existing = findDraftByVersion(project, targetVersion);
    }
    const migrationTarget = preferredLegacyScreenshotTarget(project, productId);
    if (existing && migrationTarget?.id === existing.id && migrateLegacyScreenshotCopy(existing, project, product)) {
      // 一次性兼容旧版产品级截图文案。旧 blob 暂时保留作回退，之后所有
      // 编辑只随这份发布草案保存。
      upsertStoreSubmissionDraft(project, existing);
      s.set("projects", projects);
    }
    if (release.draft) {
      if (force) {
        // 已按商店上架冻结的文案完全只读：不允许强制重新生成覆盖。
        if (existing?.ascSyncedAt) {
          throw new Error("该文案已按商店上架状态冻结，不可重新生成");
        }
        // Respect the user's include/exclude checklist: only the checked
        // commits are fed to the AI as release material.
        let generationRelease = release;
        if (Array.isArray(includeShas) && release.material) {
          const { filterMaterial, materialToBody } = await import("@appilot-labs/appilot-core/release-watcher");
          const filtered = filterMaterial(release.material, includeShas);
          generationRelease = { ...release, material: filtered, body: materialToBody(filtered) };
        }
        const draft = await withAiOperation(operationId, (signal) =>
          generateStoreSubmissionDraft(
            s,
            project,
            product,
            generationRelease,
            existing,
            (progress) => {
              if (!_event.sender.isDestroyed()) {
                _event.sender.send("release:generateProgress", progress);
              }
            },
            language,
            appVersion,
            (received) => {
              if (!_event.sender.isDestroyed()) {
                _event.sender.send("release:generateProgress", { kind: "chars", ...received });
              }
            },
            includedChanges,
            signal,
            () => {
              if (!_event.sender.isDestroyed()) {
                _event.sender.send("release:generateProgress", { kind: "retry" });
              }
            },
          ),
        );
        migrateLegacyScreenshotCopy(draft, project, product);
        // Re-read before writing: AI generation awaited for seconds, during
        // which concurrent handlers may have replaced the projects array.
        const latestProjects: any[] = s.get("projects") || [];
        const latestProject = latestProjects.find((item: any) => item.id === projectId);
        if (latestProject) {
          // 生成本身不推进「上次生成点」：草案可能被删除后重新生成同一版本，
          // 提前推进会让「自上次文案以来」的素材为空。边界在整批确定时推进
          // （见 release:saveDraft），这里只把 release 的 commit 记到草案上。
          draft.releaseCommitSha = release.commitSha || undefined;
          upsertStoreSubmissionDraft(latestProject, draft);
          markCopyPlansUsed(latestProject, productId, draft.id, [language || draft.localizations[0]?.language].filter(Boolean) as string[]);
          s.set("projects", latestProjects);
        }
        return { release, draft, actionable: true };
      }
      return { release, draft: existing, actionable: Boolean(existing) };
    }

    // 只读查看：读操作不写回草稿（版本/GitHub 状态一律派生），也不应
    // 改动 updatedAt —— 否则会污染草稿历史排序和“当前文案”的选择。
    return { release, draft: existing || null, actionable: false };
    },
  );

  ipcMain.handle(
    "release:translate",
    async (
      _event,
      projectId: string,
      productId: string,
      releaseTag: string,
      targetLanguages: string[],
      sourceLanguage?: string,
      operationId = "",
    ) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      targetLanguages = assertStringArray(targetLanguages, "targetLanguages");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const product = (project.storeProducts || []).find((item: any) => item.id === productId);
      if (!product) throw new Error("Store product not found");
      const draft = findStoreSubmissionDraft(project, releaseTag);
      if (!draft) throw new Error("Submission draft not found");
      // 已按商店上架冻结的文案完全只读：翻译也不允许（UI 已禁用，这里兜底）。
      if (draft.ascSyncedAt) {
        throw new Error("该文案已按商店上架状态冻结，不可修改");
      }

      const { translateStoreSubmissionContent } = await import("@appilot-labs/appilot-core/ai/release-reviewer");

      const provider = await createAiProvider(s);
      const source = draft.localizations.find((item: any) => item.language === sourceLanguage)
        || draft.localizations[0];
      if (!source) throw new Error("Source localization not found");

      // 各语言的关键词/文案缺口按语言分组，翻译时只注入目标语言自己的词。
      const trackedKeywordsByLanguage: Record<string, string[]> = {};
      for (const k of project.trackedKeywords || []) {
        const lang = String(k.language || "");
        if (!lang) continue;
        (trackedKeywordsByLanguage[lang] =
          trackedKeywordsByLanguage[lang] || []).push(String(k.keyword || ""));
      }
      const copyGapKeywordsByLanguage: Record<string, string[]> = {};
      for (const g of project.copyGapKeywords || []) {
        const lang = String(g.language || "");
        if (!lang) continue;
        (copyGapKeywordsByLanguage[lang] =
          copyGapKeywordsByLanguage[lang] || []).push(String(g.keyword || ""));
      }
      const copyPlanItems = copyPlansForProduct(project, productId);
      const translations = await withAiOperation(operationId, (signal) =>
        translateStoreSubmissionContent(
          provider,
          {
            name: product.trackName || project.name,
            // 翻译不需要整个项目档案（含大段 README/中文上下文）——那会显著
            // 增加模型回显母本语言的概率。源文与目标语言都在 user 消息里。
            profile: undefined,
            trackedKeywordsByLanguage,
            copyGapKeywordsByLanguage,
            copyPlanItems,
          },
          source,
          targetLanguages,
          (progress) => {
            if (!_event.sender.isDestroyed()) {
              _event.sender.send("release:generateProgress", progress);
            }
          },
          (received) => {
            if (!_event.sender.isDestroyed()) {
              _event.sender.send("release:generateProgress", { kind: "chars", ...received });
            }
          },
          signal,
          () => {
            if (!_event.sender.isDestroyed()) {
              _event.sender.send("release:generateProgress", { kind: "retry" });
            }
          },
        ),
      );

      const latestProjects: any[] = s.get("projects") || [];
      const latestProject = latestProjects.find((item: any) => item.id === projectId);
      const latestDraft = latestProject
        ? findStoreSubmissionDraft(latestProject, releaseTag)
        : null;
      if (!latestDraft) throw new Error("Submission draft not found");

      const localizationMap = new Map(
        latestDraft.localizations.map((item: any) => [item.language, item]),
      );
      for (const translation of translations) {
        localizationMap.set(translation.language, translation);
      }
      latestDraft.localizations = [...localizationMap.values()];
      latestDraft.submissionKeywords = latestDraft.localizations.map((item: any) => ({
        language: item.language,
        text: item.keywords,
      }));
      latestDraft.updatedAt = new Date().toISOString();
      upsertStoreSubmissionDraft(latestProject, latestDraft);
      markCopyPlansUsed(latestProject, productId, latestDraft.id, targetLanguages);
      s.set("projects", latestProjects);
      return latestDraft;
    },
  );

  ipcMain.handle("release:saveDraft", async (_event, projectId: string, draft: StoreSubmissionDraft) => {
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    if (!draft?.id || draft.projectId !== projectId) throw new Error("Invalid submission draft");
    const existing = getStoreSubmissionDrafts(project).find(
      (item: any) => item.id === draft.id,
    );
    if (existing?.ascSyncedAt) {
      // 冻结文案完全只读：内容未变时视为无操作（UI 的失焦保存等会触发），
      // 不报错也不改写 updatedAt；内容确实变化时才拒绝。
      const frozenFields = {
        appVersion: existing.appVersion,
        reviewFeedback: existing.reviewFeedback,
        localizations: existing.localizations,
        promotionalText: existing.promotionalText,
        whatsNew: existing.whatsNew,
        description: existing.description,
        submissionKeywords: existing.submissionKeywords,
      };
      const incomingFields = {
        appVersion: draft.appVersion,
        reviewFeedback: draft.reviewFeedback,
        localizations: draft.localizations,
        promotionalText: draft.promotionalText,
        whatsNew: draft.whatsNew,
        description: draft.description,
        submissionKeywords: draft.submissionKeywords,
      };
      if (JSON.stringify(frozenFields) !== JSON.stringify(incomingFields)) {
        throw new Error("该文案已按商店上架状态冻结，不可修改");
      }
      if (JSON.stringify(existing.screenshotCopy) !== JSON.stringify(draft.screenshotCopy)) {
        const product = (project.storeProducts || []).find((item: any) => item.id === draft.productId);
        const supported = (product?.supportedLanguages || [])
          .map((item: any) => String(item.code || "").trim())
          .filter(Boolean);
        existing.screenshotCopy = draft.screenshotCopy
          ? normalizeScreenshotCopySet(
              draft.screenshotCopy,
              draft.screenshotCopy.sourceLanguage || supported[0] || "en",
              supported,
            )
          : undefined;
        existing.updatedAt = new Date().toISOString();
        upsertStoreSubmissionDraft(project, existing);
        s.set("projects", projects);
        notifyDataChanged("release-drafts");
      }
      return existing;
    }

    const draftProduct = (project.storeProducts || []).find((item: any) => item.id === draft.productId);
    if (draft.screenshotCopy && draftProduct) {
      const supported = (draftProduct.supportedLanguages || [])
        .map((item: any) => String(item.code || "").trim())
        .filter(Boolean);
      draft.screenshotCopy = normalizeScreenshotCopySet(
        draft.screenshotCopy,
        draft.screenshotCopy.sourceLanguage || supported[0] || "en",
        supported,
      );
    }
    draft.updatedAt = new Date().toISOString();
    // 整批确定是「上次生成点」真正推进的时刻：该版本文案从此冻结，
    // 下一个版本文案的素材从这条 commit 之后开始收集。仅在新确认时推进，
    // 避免反复保存已确认草案把边界回退。
    if (draft.batchConfirmedAt && !existing?.batchConfirmedAt) {
      const latestProjects: any[] = s.get("projects") || [];
      const latestProject = latestProjects.find((item: any) => item.id === projectId);
      if (latestProject) {
        latestProject.lastReleaseSha = draft.releaseCommitSha || latestProject.lastReleaseSha || null;
      }
    }
    upsertStoreSubmissionDraft(project, draft);
    const context = findProductContext(projects, draft.productId);
    const storeCopyExists = Boolean(
      draft.storeCopyCreatedAt || (draft.localizations || []).length > 0,
    );
    if (context && storeCopyExists) {
      ensureProjectKeywordPool(context.project).submissionKeywords = (draft.localizations || []).map((item) => ({
        language: item.language,
        text: item.keywords,
      }));
    }
    s.set("projects", projects);
    // Draft content/status changed, but the GitHub release list did not.
    // Keeping this scope separate prevents the renderer from replacing a
    // freshly checked GitHub draft with an older hourly release cache.
    notifyDataChanged("release-drafts");
    return draft;
  });

  ipcMain.handle("release:deleteDraft", async (_event, projectId: string, draftId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    draftId = assertNonEmptyString(draftId, "draftId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    const drafts = getStoreSubmissionDrafts(project);
    const next = drafts.filter((item) => item.id !== draftId);
    if (next.length === drafts.length) return false;
    project.storeSubmissionDrafts = next;
    s.set("projects", projects);
    notifyDataChanged("releases");
    return true;
  });

  // Rebuild a complete local copy draft from the actual store copy after local
  // drafts were lost (e.g. cleared and re-generated after the version went
  // live). Requires App Store Connect credentials.
  ipcMain.handle(
    "release:rebuildFromStore",
    async (_event, projectId: string, productId: string, releaseTag: string) => {
      projectId = assertNonEmptyString(projectId, "projectId");
      productId = assertNonEmptyString(productId, "productId");
      releaseTag = assertNonEmptyString(releaseTag, "releaseTag");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) throw new Error("Project not found");
      const product = (project.storeProducts || []).find((item: any) => item.id === productId);
      if (!product) throw new Error("Store product not found");
      const creds = resolveEffectiveCredentials(s, projectId);
      if (!creds.ascIssuerId || !creds.ascKeyId || !creds.ascPrivateKeyPath) {
        throw new Error("需要 App Store Connect 凭证才能重建文案");
      }
      const existing =
        findStoreSubmissionDraft(project, releaseTag) ||
        findDraftByVersion(project, inferAppVersion({ tag: releaseTag, name: null })) ||
        null;
      const targetVersion = existing?.appVersion ||
        inferAppVersion({ tag: releaseTag, name: null });
      if (!targetVersion) throw new Error("无法确定目标版本，请先生成文案后再重建");

      const fs = await import("fs");
      const { createAscClient } = await import("@appilot-labs/appilot-core/asc-api");
      const { buildStoreRebuildDraft } = await import("@appilot-labs/appilot-core/store-submission");
      const client = createAscClient({
        issuerId: creds.ascIssuerId,
        keyId: creds.ascKeyId,
        privateKeyPem: fs.readFileSync(creds.ascPrivateKeyPath, "utf8"),
      });
      const appId = await client.getAppIdByBundleId(product.bundleId);
      if (!appId) throw new Error("App Store 中未找到该应用");
      const versions = await client.listAppStoreVersions(appId);
      const version = versions.find((v: any) => v.versionString === targetVersion) || null;
      if (!version) throw new Error(`App Store 中未找到版本 ${targetVersion}`);
      const [versionLocalizations, appInfoLocalizations] = await Promise.all([
        client.listVersionLocalizations(version.id),
        client.listAppInfoLocalizations(appId),
      ]);
      const draft = buildStoreRebuildDraft({
        projectId,
        productId,
        releaseTag,
        appVersion: targetVersion,
        supportedLanguages: (product.supportedLanguages || []).map((l: any) => l.code),
        versionLocalizations,
        appInfoLocalizations,
        githubDraftStatus: "published",
      });
      upsertStoreSubmissionDraft(project, draft);
      s.set("projects", projects);
      notifyDataChanged("releases");
      return draft;
    },
  );

}
