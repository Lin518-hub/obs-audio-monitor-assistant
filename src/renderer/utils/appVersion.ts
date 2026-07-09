/**
 * 应用版本号 - 由 vite.config.ts 从 package.json 注入到全局 __APP_VERSION__
 * (避免在多处硬编码版本号,发版时只改 package.json 即可)
 *
 * 兜底:万一 vite 注入失败(极少见),fallback 到 package.json 同名
 * (注意:此 fallback 仅在 build 阶段由 vite 解析,运行时不存在分支)
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
