/// <reference types="vite/client" />

// 由 vite.config.ts 通过 define 注入(从 package.json 读取,避免硬编码)
declare const __APP_VERSION__: string;
