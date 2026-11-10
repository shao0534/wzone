/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_CAMERAS_ENTRY?: string;
  readonly VITE_ADMIN_ENTRY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
