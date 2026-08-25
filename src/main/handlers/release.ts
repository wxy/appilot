import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import type { StoreSubmissionDraft } from "../../engine/store-submission";
import { createAiProvider } from "../ai-service";
import { resolveEffectiveCredentials } from "../credentials";
import {
  ensureProjectKeywordPool,
  findProductContext,
  findStoreSubmissionDraft,
  getStoreSubmissionDrafts,
  upsertStoreSubmissionDraft,
} from "../project-state";
import { githubSyncCacheEntry } from "../scheduler";
import { getStore } from "../store";
import {
  buildProjectProfileFor,
  generateStoreSubmissionDraft,
  synthesizeReleaseFromDraft,
} from "../release-service";
import { assertNonEmptyString, assertStringArray } from "../util";

export function registerReleaseHandlers(): void {
  ipcMain.handle("release:list", async (_event, projectId: string, force?: boolean) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const projects: any[] = s.get("projects") || [];
    const project = projects.find((item: any) => item.id === projectId);
    if (!project) throw new Error("Project not found");

    const { checkForRelease } = await import("../../engine/release-watcher");
    const result = await checkForRelease(
      project.localPath,
      project.lastReleaseSha || null,
      resolveEffectiveCredentials(s, project.id).githubToken,
      {
        sync: true,
        force: Boolean(force),
        githubCache: githubSyncCacheEntry(s, project) ?? undefined,
      },
    );
    return {
      releases: result.releases.map((release) => ({
        ...release,
        submissionDrafts: (project.storeProducts || []).map((product: any) =>
          findStoreSubmissionDraft(project, product.id, release.tag),
        ),
      })),
      latestDraft: result.releases.find((release) => release.draft) || null,
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
      const result = await checkForRelease(
        project.localPath,
        project.lastReleaseSha || null,
        resolveEffectiveCredentials(s, project.id).githubToken,
        { sync: true, githubCache: githubSyncCacheEntry(s, project) ?? undefined },
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
        }));
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
    _event.sender.send("release:generateProgress", {
      kind: "phase",
      phase: "read_draft",
      status: "started",
    });
    const result = await checkForRelease(
      project.localPath,
      project.lastReleaseSha || null,
      resolveEffectiveCredentials(s, project.id).githubToken,
      { sync: true, githubCache: githubSyncCacheEntry(s, project) ?? undefined },
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

    const existing = findStoreSubmissionDraft(project, productId, releaseTag);
    if (release.draft) {
      if (force) {
        // Respect the user's include/exclude checklist: only the checked
        // commits are fed to the AI as release material.
        let generationRelease = release;
        if (Array.isArray(includeShas) && release.material) {
          const { filterMaterial, materialToBody } = await import("../../engine/release-watcher");
          const filtered = filterMaterial(release.material, includeShas);
          generationRelease = { ...release, material: filtered, body: materialToBody(filtered) };
        }
        const draft = await generateStoreSubmissionDraft(
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
        );
        // Re-read before writing: AI generation awaited for seconds, during
        // which concurrent handlers may have replaced the projects array.
        const latestProjects: any[] = s.get("projects") || [];
        const latestProject = latestProjects.find((item: any) => item.id === projectId);
        if (latestProject) {
          // Remember the tag (+ its commit) we generated for: name@sha identity
          // so a moved tag redefines the boundary and triggers regeneration.
          // Remember the HEAD we generated from: what's-new always covers
          // everything committed after this point.
          latestProject.lastReleaseSha = release.commitSha || null;
          upsertStoreSubmissionDraft(latestProject, draft);
          s.set("projects", latestProjects);
        }
        return { release, draft, actionable: true };
      }
      return { release, draft: existing, actionable: Boolean(existing) };
    }

    if (existing) {
      existing.githubDraftStatus = "published";
      existing.storeStatus = existing.storeStatus === "released" ? existing.storeStatus : "released";
      existing.updatedAt = new Date().toISOString();
      upsertStoreSubmissionDraft(project, existing);
      s.set("projects", projects);
      return { release, draft: existing, actionable: false };
    }

    return { release, draft: null, actionable: false };
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

      const { translateStoreSubmissionContent } = await import("../../engine/ai/release-reviewer");
      const { readRepoDescription } = await import("../../engine/app-store-discovery");

      const provider = await createAiProvider(s);
      const source = draft.localizations.find((item: any) => item.language === sourceLanguage)
        || draft.localizations[0];
      if (!source) throw new Error("Source localization not found");

      _event.sender.send("release:generateProgress", {
        kind: "phase",
        phase: "read_readme",
        status: "started",
      });
      const description = readRepoDescription(project.localPath);
      _event.sender.send("release:generateProgress", {
        kind: "phase",
        phase: "read_readme",
        status: "completed",
        bytes: description.length || 0,
      });

      const profile = await buildProjectProfileFor(project, product, undefined, description);
      const translations = await translateStoreSubmissionContent(
        provider,
        {
          name: product.trackName || project.name,
          profile,
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

    draft.updatedAt = new Date().toISOString();
    upsertStoreSubmissionDraft(project, draft);
    const context = findProductContext(projects, draft.productId);
    if (context) {
      ensureProjectKeywordPool(context.project).submissionKeywords = (draft.localizations || []).map((item) => ({
        language: item.language,
        text: item.keywords,
      }));
    }
    s.set("projects", projects);
    return draft;
  });

}
