/**
 * Appilot 工具结果卡片（tool.call.toolview，key = 工具 wire 名）。
 * 数据来自工具结果 block（`content` 里的 JSON 文本）。
 */
import { jsx, jsxs } from 'react/jsx-runtime';
import { resultOf, chip, statusTone } from './helpers';

interface ToolCardProps {
  toolName: string;
  block: any;
  cwd?: string;
  home?: string;
  openFile?: (path: string) => void;
  inspect?: (callId: string) => void;
}

/** resolve_current_project 卡片：仓库/平台/语言/分支/脏状态。 */
export function ProjectCard(props: ToolCardProps) {
  const res = resultOf(props.block && props.block.content);
  const v = res.value;
  if (!v) return <pre className="ap-tool-card">{res.text || '(运行中…)'}</pre>;
  const repo = v.repo || {};
  return (
    <div className="ap-tool-card">
      <div className="ap-tool-title">项目：{v.name || '(未知)'}</div>
      {v.path ? <div className="ap-tool-meta">{v.path}</div> : null}
      <div className="ap-tool-row">
        {v.platform ? chip(v.platform, '') : null}
        {repo.branch ? chip('分支 ' + repo.branch, '') : null}
        {v.languages && v.languages.length ? chip(v.languages.join(' · '), '') : null}
        {repo.dirty ? chip('有未提交改动', 'warn') : null}
        {repo.remoteUrl ? chip(repo.remoteUrl, '') : null}
      </div>
    </div>
  );
}

/** check_release_readiness 卡片：版本 tag、语言、清单通过/警告/失败。 */
export function ReadinessCard(props: ToolCardProps) {
  const res = resultOf(props.block && props.block.content);
  const v = res.value;
  if (!v) return <pre className="ap-tool-card">{res.text || '(运行中…)'}</pre>;
  const checks = v.checks || [];
  const pass = checks.filter((c: any) => statusTone(c.status) === 'pass').length;
  const warn = checks.filter((c: any) => statusTone(c.status) === 'warn').length;
  const fail = checks.filter((c: any) => statusTone(c.status) === 'fail').length;
  return (
    <div className="ap-tool-card">
      <div className="ap-tool-title">发布准备度{v.versionTag ? ' · ' + v.versionTag : ''}</div>
      <div className="ap-tool-row">
        {chip('通过 ' + pass, 'pass')}
        {warn > 0 ? chip('警告 ' + warn, 'warn') : null}
        {fail > 0 ? chip('失败 ' + fail, 'fail') : null}
        {v.supportedLanguages && v.supportedLanguages.length
          ? chip(v.supportedLanguages.join(', '), '')
          : null}
      </div>
      {checks.length > 0 ? (
        <div className="ap-tool-row">
          {checks.slice(0, 10).map((c: any, index: number) =>
            chip((c.label || c.id || '检查项') + ' · ' + (c.status || ''), statusTone(c.status)),
          )}
        </div>
      ) : null}
    </div>
  );
}

/** sync_release_status 卡片：最新 tag、GitHub 发布与草稿数。 */
export function ReleaseStatusCard(props: ToolCardProps) {
  const res = resultOf(props.block && props.block.content);
  const v = res.value;
  if (!v) return <pre className="ap-tool-card">{res.text || '(运行中…)'}</pre>;
  const releases = v.githubReleases || [];
  const drafts = releases.filter((r: any) => r && r.draft).length;
  const latest = v.latestTag ? v.latestTag.name : null;
  return (
    <div className="ap-tool-card">
      <div className="ap-tool-title">发布状态{latest ? ' · ' + latest : ''}</div>
      <div className="ap-tool-row">
        {chip('GitHub 发布 ' + releases.length, '')}
        {drafts > 0 ? chip('草稿 ' + drafts, 'warn') : null}
      </div>
      {v.note ? <div className="ap-tool-meta">{v.note}</div> : null}
    </div>
  );
}

/** appilot_overview 卡片：聚合总览（项目/发布/readiness/活动）。 */
export function OverviewCard(props: ToolCardProps) {
  const res = resultOf(props.block && props.block.content);
  const v = res.value;
  if (!v) return <pre className="ap-tool-card">{res.text || '(运行中…)'}</pre>;
  const repo = v.repo || {};
  const rel = v.release || {};
  const readiness = rel.readiness || {};
  const checks = readiness.checks || [];
  const pass = checks.filter((c: any) => statusTone(c.status) === 'pass').length;
  const warn = checks.filter((c: any) => statusTone(c.status) === 'warn').length;
  const fail = checks.filter((c: any) => statusTone(c.status) === 'fail').length;
  const releases = rel.githubReleases || [];
  const drafts = releases.filter((r: any) => r && r.draft).length;
  const act = v.activity;
  return (
    <div className="ap-tool-card">
      <div className="ap-tool-title">总览{v.name ? ' · ' + v.name : ''}</div>
      {v.path ? <div className="ap-tool-meta">{v.path}</div> : null}
      <div className="ap-tool-row">
        {v.platform ? chip(v.platform, '') : null}
        {repo.branch ? chip('分支 ' + repo.branch, '') : null}
        {v.languages && v.languages.length ? chip(v.languages.length + ' 语言', '') : null}
        {repo.dirty ? chip('有未提交改动', 'warn') : null}
        {rel.latestTag ? chip('tag ' + rel.latestTag.name, '') : null}
        {chip('发布 ' + releases.length, '')}
        {drafts > 0 ? chip('草稿 ' + drafts, 'warn') : null}
      </div>
      <div className="ap-tool-row">
        {chip('准备度 通过 ' + pass, 'pass')}
        {warn > 0 ? chip('警告 ' + warn, 'warn') : null}
        {fail > 0 ? chip('失败 ' + fail, 'fail') : null}
        {act ? chip('今日流量 ' + (act.views ?? 0) + ' 次浏览', '') : null}
      </div>
    </div>
  );
}
