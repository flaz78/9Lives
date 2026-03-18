// Copyright (c) 2026 Flavio Cerato
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { iconStyles, iconEdit, iconDelete } from '../icons.js';

interface LLMConfig {
  id: string;
  name: string;
  provider: string;
  base_url: string | null;
  updated_at: string;
}

interface SystemGuardrailSettings {
  enabled: boolean;
  content: string;
}

@customElement('settings-view')
export class SettingsView extends LitElement {
  @property({ type: Object }) ws: any;
  @state() private configs: LLMConfig[] = [];
  @state() private editingConfig: Partial<LLMConfig & { api_key: string }> | null = null;
  @state() private systemGuardrail: SystemGuardrailSettings = { enabled: true, content: '' };
  @state() private saving = false;
  @state() private savingGuardrail = false;
  @state() private loading = true;
  @state() private error = '';
  @state() private guardrailError = '';

  static styles = [iconStyles, css`
    :host { display: block; }
    h2 { color: #fff; margin-top: 0; }
    .card {
      background: #1e1e2e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .config-list { display: flex; flex-direction: column; gap: 1rem; }
    .config-item {
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .config-info { display: flex; flex-direction: column; gap: 0.2rem; }
    .config-name { font-weight: 600; color: #fff; }
    .config-provider { font-size: 0.8rem; color: #6366f1; font-weight: 700; text-transform: uppercase; }
    .config-url { font-size: 0.8rem; color: #777; font-family: monospace; }

    .btn {
      border: none;
      border-radius: 6px;
      color: #fff;
      padding: 0.6rem 1.2rem;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .btn-primary { background: #6366f1; }
    .btn-danger { background: #f87171; }
    .btn-secondary { background: transparent; border: 1px solid #333; color: #aaa; }
    .btn-icon { background: transparent; border: none; cursor: pointer; color: #aaa; display: inline-flex; align-items: center; }
    .btn-icon:hover { color: #fff; }

    .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 100; display: flex; align-items: center; justify-content: center; }
    .modal { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 16px; padding: 2rem; width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: 1.25rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.4rem; }
    label { font-size: 0.85rem; color: #aaa; }
    input, select, textarea { background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; padding: 0.75rem; font-size: 0.95rem; }
    textarea { min-height: 260px; resize: vertical; font-family: monospace; }
    .hint { font-size: 0.8rem; color: #666; font-style: italic; }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .toggle-row input[type="checkbox"] { width: 18px; height: 18px; }
  `];

  async firstUpdated() {
    await Promise.all([this.loadConfigs(), this.loadSystemGuardrail()]);
  }

  async loadConfigs() {
    this.loading = true;
    try {
      this.configs = await this.ws.request('llm_config.list');
    } catch (e) {
      console.error('Failed to load configs', e);
    } finally {
      this.loading = false;
    }
  }

  async loadSystemGuardrail() {
    try {
      const res = await this.ws.request('creds.get', { key: 'system.guardrail' });
      const value = res?.value;
      if (value && typeof value === 'object') {
        this.systemGuardrail = {
          enabled: value.enabled !== false,
          content: typeof value.content === 'string' ? value.content : '',
        };
        return;
      }
    } catch {
      // Fallback to bundled bootstrap file.
    }

    try {
      const source = await fetch('/bootstrap/GUARDRAIL.md');
      const content = source.ok ? await source.text() : '';
      this.systemGuardrail = { enabled: true, content };
    } catch {
      this.systemGuardrail = { enabled: true, content: '' };
    }
  }

  async saveConfig() {
    this.saving = true;
    this.error = '';
    try {
      await this.ws.request('llm_config.create', this.editingConfig);
      this.editingConfig = null;
      await this.loadConfigs();
    } catch (e: any) {
      this.error = e.message || 'Error saving.';
    } finally {
      this.saving = false;
    }
  }

  async saveSystemGuardrail() {
    this.savingGuardrail = true;
    this.guardrailError = '';
    try {
      await this.ws.request('creds.set', {
        key: 'system.guardrail',
        value: {
          enabled: this.systemGuardrail.enabled,
          content: this.systemGuardrail.content,
        }
      });
    } catch (e: any) {
      this.guardrailError = e.message || 'Error saving system guardrail.';
    } finally {
      this.savingGuardrail = false;
    }
  }

  async deleteConfig(id: string) {
    if (!confirm('Delete this connection?')) return;
    try {
      await this.ws.request('llm_config.delete', { id });
      await this.loadConfigs();
    } catch (e) {
      alert('Error deleting');
    }
  }

  render() {
    return html`
      <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h2>AI Connections</h2>
        <button class="btn btn-primary" @click=${() => this.editingConfig = { name: '', provider: 'openai', base_url: '', api_key: '' }}>+ Add Connection</button>
      </header>

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <h3 style="margin: 0; color: #fff;">System Guardrail</h3>
            <div class="hint">Applied globally at runtime. Changes affect new requests without restarting Docker.</div>
          </div>
          <button class="btn btn-primary" @click=${this.saveSystemGuardrail} ?disabled=${this.savingGuardrail}>
            ${this.savingGuardrail ? 'Saving...' : 'Save Guardrail'}
          </button>
        </div>

        <div class="form-group">
          <label class="toggle-row">
            <span>Enable system guardrail</span>
            <input
              type="checkbox"
              .checked=${this.systemGuardrail.enabled}
              @change=${(e: any) => this.systemGuardrail = { ...this.systemGuardrail, enabled: e.target.checked }}
            />
          </label>
        </div>

        <div class="form-group">
          <label>GUARDRAIL.md</label>
          <textarea
            .value=${this.systemGuardrail.content}
            ?disabled=${!this.systemGuardrail.enabled}
            @input=${(e: any) => this.systemGuardrail = { ...this.systemGuardrail, content: e.target.value }}
          ></textarea>
          <div class="hint">Use the same markdown file with YAML frontmatter already consumed by the runtime.</div>
        </div>

        ${this.guardrailError ? html`<div style="color: #f87171; font-size: 0.85rem;">${this.guardrailError}</div>` : ''}
      </div>

      <div class="card">
        ${this.loading ? html`<div>Loading...</div>` : ''}
        ${!this.loading && this.configs.length === 0 ? html`<div style="color: #666; text-align: center; padding: 2rem;">No connections configured. Add one to get started.</div>` : ''}

        <div class="config-list">
          ${this.configs.map(c => html`
            <div class="config-item">
              <div class="config-info">
                <div class="config-name">${c.name}</div>
                <div class="config-provider">${c.provider}</div>
                ${c.base_url ? html`<div class="config-url">${c.base_url}</div>` : html`<div class="config-url">Cloud Model (Standard)</div>`}
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button class="btn-icon" title="Edit" @click=${() => this.editingConfig = { ...c, api_key: '' }}>${iconEdit()}</button>
                <button class="btn-icon" title="Delete" @click=${() => this.deleteConfig(c.id)}>${iconDelete()}</button>
              </div>
            </div>
          `)}
        </div>
      </div>

      ${this.editingConfig ? html`
        <div class="modal-overlay">
          <div class="modal">
            <h3 style="margin: 0; color: #fff;">${this.editingConfig.id ? 'Edit Connection' : 'New Connection'}</h3>

            <div class="form-group">
              <label>Connection Name (e.g.: Local Ollama, GPT-4 Cloud)</label>
              <input type="text" .value=${this.editingConfig.name || ''} @input=${(e: any) => this.editingConfig!.name = e.target.value} />
            </div>

            <div class="form-group">
              <label>Provider</label>
              <select .value=${this.editingConfig.provider || 'openai'} @change=${(e: any) => this.editingConfig!.provider = e.target.value}>
                <option value="openai">OpenAI / Compatibile</option>
                <option value="google">Google Gemini</option>
                <option value="anthropic">Anthropic (Coming soon)</option>
              </select>
            </div>

            <div class="form-group">
              <label>Base URL (Optional, e.g.: http://localhost:11434/v1)</label>
              <input type="text" placeholder="https://api.openai.com/v1" .value=${this.editingConfig.base_url || ''} @input=${(e: any) => this.editingConfig!.base_url = e.target.value} />
              <div class="hint">Leave empty for the standard provider.</div>
            </div>

            <div class="form-group">
              <label>API Key</label>
              <input type="password" placeholder=${this.editingConfig.id ? '(Unchanged)' : 'sk-...'} .value=${this.editingConfig.api_key || ''} @input=${(e: any) => this.editingConfig!.api_key = e.target.value} />
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
              <button class="btn btn-secondary" @click=${() => this.editingConfig = null}>Cancel</button>
              <button class="btn btn-primary" @click=${this.saveConfig} ?disabled=${this.saving}>
                ${this.saving ? 'Saving...' : 'Save Connection'}
              </button>
            </div>
            ${this.error ? html`<div style="color: #f87171; font-size: 0.85rem;">${this.error}</div>` : ''}
          </div>
        </div>
      ` : ''}
    `;
  }
}
