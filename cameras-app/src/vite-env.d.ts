/// <reference types="vite/client" />

// vite-plugin-qiankun 无类型声明, 这里手动声明以通过 TS 编译
declare module 'vite-plugin-qiankun/dist/helper';

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_AMAP_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 供 .vue 单文件组件在 TS 下被正确识别
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
