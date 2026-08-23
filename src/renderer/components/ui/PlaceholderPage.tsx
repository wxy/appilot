import { useProject } from "../../stores/project";
import { CredentialBadge } from "./CredentialBadge";
import { EmptyState } from "./EmptyState";

export function PlaceholderPage({
  title,
  desc,
  credentialBadges = [],
}: {
  title: string;
  desc: string;
  credentialBadges?: ("github" | "asc")[];
}) {
  const { projects, currentProjectId } = useProject();
  const project = projects.find((p) => p.id === currentProjectId) || null;
  if (!projects.some((p) => p.id === currentProjectId)) {
    return <EmptyState title="还没有项目" desc="添加一个项目后，这里会展示数据。" />;
  }
  return (
    <div className="p-10 max-w-6xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{title}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">{desc}</p>
      {project && credentialBadges.length > 0 && (
        <div className="flex items-center gap-1.5 -mt-4 mb-8">
          {credentialBadges.map((kind) => (
            <CredentialBadge
              key={kind}
              kind={kind}
              enabled={
                kind === "github"
                  ? Boolean(project.hasGithubToken)
                  : Boolean(project.hasAscKey)
              }
              projectId={project.id}
            />
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center text-sm text-zinc-400 dark:text-zinc-500">
        该界面将在 Phase A 后续步骤实现
      </div>
    </div>
  );
}
