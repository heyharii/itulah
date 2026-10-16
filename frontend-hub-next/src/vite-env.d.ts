interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly VITE_TENANCY?: string
  readonly VITE_HIDE_DOMAINS?: string
  readonly VITE_EDGE_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  readonly glob: <T = unknown>(pattern: string) => Record<string, () => Promise<T>>
}
