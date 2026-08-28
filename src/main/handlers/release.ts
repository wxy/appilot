import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import type { StoreSubmissionDraft } from "../../engine/store-submission";
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
import { inferAppVersion } from "../../engine/store-submission";
import { githubSyncCacheEntry } from "../scheduler";
import { getStore } from "../store";
import {
  generateStoreSubmissionDraft,
  synthesizeReleaseFromDraft,
} from "../release-service";
import { assertNonEmptyString, assertStringArray } from "../util";
import { notifyDataChanged } from "../data-sync";
import { log } from "../../engine/logger";
import type { GitHubRepoCapabilities } from "../../engine/github-api";
import { cancelAiRequest, withAiOperation } from "../ai-cancel";

export function registerReleaseHandlers(): void {
  ipcMain.handle("ai:cancel", (_event, operationId: string) => {
    if (!operationId) return false;
    return cancelAiRequest(operationId);
  });

  async function githubReleaseCandidates(
    project: any,
    token: string | null | undefined,
    cached?: any,
    force = false,
  ): Promise<any[]> {
    const { listGitHubReleases } = await import("../../engine/github-api");
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

    const { checkForRelease } = await import("../../engine/release-watcher");
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
      const { fetchRepoCapabilities } = await import("../../engine/github-api");
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
        submissionDrafts: (project.storeProducts || []).map((product: any) =>
          findStoreSubmissionDraft(project, product.id, release.tag) ||
          findDraftByVersion(project, product.id, inferAppVersion(release)),
        ),
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

      const { checkForRelease } = await import("../../engine/release-watcher");
      const { readFullReadme, readRepoDescription } = await import("../../engine/app-store-discovery");
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
        const saved = findStoreSubmissionDraft(project, productId, releaseTag);
        if (saved) release = synthesizeReleaseFromDraft(saved);
      }
      if (!release) return null;

      const draftSummaries = getStoreSubmissionDrafts(project)
        .filter((item) => item.productId === productId)
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
          masterConfirmedAt: draft.masterConfirmedAt || "",
          batchConfirmedAt: draft.batchConfirmedAt || "",
          ascSyncedAt: draft.ascSyncedAt || "",
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

    const { checkForRelease } = await import("../../engine/release-watcher");
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
      const saved = findStoreSubmissionDraft(project, productId, releaseTag);
      if (saved) release = synthesizeReleaseFromDraft(saved);
    }
    _event.sender.send("release:generateProgress", {
      kind: "phase",
      phase: "read_draft",
      status: "completed",
      bytes: release?.body?.length || 0,
    });
    if (!release) return { release: null, draft: null, actionable: false };

    let existing = findStoreSubmissionDraft(project, productId, releaseTag);
    if (!existing) {
      // Identity by appVersion: a copy prepared under an older release for the
      // same target version belongs to this release's workbench too.
      const targetVersion = String(
        appVersion || inferAppVersion(release) || "",
      ).trim();
      existing = findDraftByVersion(project, productId, targetVersion);
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
          const { filterMaterial, materialToBody } = await import("../../engine/release-watcher");
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
          ),
        );
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
      const draft = findStoreSubmissionDraft(project, productId, releaseTag);
      if (!draft) throw new Error("Submission draft not found");
      // 已按商店上架冻结的文案完全只读：翻译也不允许（UI 已禁用，这里兜底）。
      if (draft.ascSyncedAt) {
        throw new Error("该文案已按商店上架状态冻结，不可修改");
      }

      const { translateStoreSubmissionContent } = await import("../../engine/ai/release-reviewer");

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
        ),
      );

      const latestProjects: any[] = s.get("projects") || [];
      const latestProject = latestProjects.find((item: any) => item.id === projectId);
      const latestDraft = latestProject
        ? findStoreSubmissionDraft(latestProject, productId, releaseTag)
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
      return existing;
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
    if (context) {
      ensureProjectKeywordPool(context.project).submissionKeywords = (draft.localizations || []).map((item) => ({
        language: item.language,
        text: item.keywords,
      }));
    }
    s.set("projects", projects);
    notifyDataChanged("releases");
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
        findStoreSubmissionDraft(project, productId, releaseTag) ||
        findDraftByVersion(project, productId, inferAppVersion({ tag: releaseTag, name: null })) ||
        null;
      const targetVersion = existing?.appVersion ||
        inferAppVersion({ tag: releaseTag, name: null });
      if (!targetVersion) throw new Error("无法确定目标版本，请先生成文案后再重建");

      const fs = await import("fs");
      const { createAscClient } = await import("../../engine/asc-api");
      const { buildStoreRebuildDraft } = await import("../../engine/store-submission");
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
