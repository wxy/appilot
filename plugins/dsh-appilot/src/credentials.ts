import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

/**
 * 凭据读取器：按环境变量名解析密钥。
 *
 * Phase 4：优先走宿主 `ctx.credentials` 服务（分层：进程环境 + 凭据存储 +
 * .env），回退到直接读 process.env（单元测试/无宿主场景）。
 */
export type CredentialReader = (name: string) => Promise<string | null>;

/** 直接读环境变量（测试与无宿主场景的默认实现）。 */
export function envCredentialReader(name: string): Promise<string | null> {
  return Promise.resolve(process.env[name] ?? null);
}

/** 基于宿主 ctx.credentials 的读取器；服务不可用或为空时回退 env。 */
export function ctxCredentialReader(ctx: Context): CredentialReader {
  return async (name: string): Promise<string | null> => {
    try {
      const resolved = await ctx.credentials?.resolve(credentialRef(name));
      if (resolved?.value) return resolved.value;
    } catch {
      // 服务缺失/读取失败 → 回退 env
    }
    return envCredentialReader(name);
  };
}
