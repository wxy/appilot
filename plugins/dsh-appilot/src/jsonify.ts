import type { JsonValue } from '@deepseek-ai/dsh-session';

/**
 * 把返回值规范化为无损 JSON（JsonValue）。
 * @appilot/core 的领域类型是 TS interface，直接赋值给 JsonValue 会因
 * 隐式索引签名规则失败；运行时数据本身都是纯 JSON，序列化一次即可。
 */
export function jsonify<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
