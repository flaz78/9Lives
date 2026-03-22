export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelListResponse {
  provider: string;
  models: ModelOption[];
  defaultModel: string;
  source: 'remote' | 'fallback';
}

export function withSelectedModel(
  options: ModelOption[],
  selectedModel: string | undefined,
): ModelOption[] {
  if (!selectedModel) {
    return options;
  }

  if (options.some((option) => option.id === selectedModel)) {
    return options;
  }

  return [{ id: selectedModel, label: `${selectedModel} (custom)` }, ...options];
}
