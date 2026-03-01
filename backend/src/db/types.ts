export interface ProjectRow {
  id: number;
  name: string;
  path: string;
  created_at: string;
  provider: string | null;
  model_variant: string | null;
}

export interface ProviderRow {
  id: number;
  name: string;
  runner_script: string | null;
  is_configured: number;
  config: string | null;
}
