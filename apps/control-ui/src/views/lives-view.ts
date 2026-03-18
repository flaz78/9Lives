// Copyright (c) 2026 Flavio Cerato
﻿import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { iconStyles, iconEdit, iconDelete, iconPlayArrow, iconSend, iconChat2 } from '../icons.js';

interface LiveGuardrail {
  skills?: { allow?: string[]; deny?: string[] };
  limits?: { max_iterations?: number; max_tool_calls?: number };
  confirmation_required?: string[];
}

interface Live {
  id: string;
  name: string;
  system_prompt: string;
  model_provider: string;
  model_name: string;
  routing_default: boolean;
  channels: string[];
  skills: string[];
  webhook_ids?: string[];
  llm_config_id?: string;
  guardrail?: LiveGuardrail | null;
}

interface LLMConfig {
  id: string;
  name: string;
  provider: string;
}

interface JobDraft {
  name: string;
  cronExpr: string;
  prompt: string;
  startDate: string;
  endDate: string;
}

@customElement('lives-view')
export class LivesView extends LitElement {
  @property({ type: Object }) ws: any;
  @state() private lives: Live[] = [];
  @state() private allSkills: any[] = [];
  @state() private loading = true;
  @state() private editingLive: Partial<Live> | null = null;
  @state() private llmConfigs: LLMConfig[] = [];
  @state() private showCreateModal = false;
  @state() private runningLive: string | null = null;
  @state() private runPrompt = 'Hello! Who are you?';
  @state() private skillSearch = '';
  @state() private runResponse = '';
  @state() private jobs: any[] = [];
  @state() private telegramBots: any[] = [];
  @state() private webhookConfigs: any[] = [];
  @state() private newJob: JobDraft = { name: '', cronExpr: '0 9 * * *', prompt: '', startDate: '', endDate: '' };
  @state() private editingJobId: string | null = null;
  @state() private showGuardrail = false;
  @state() private guardrailDeniedSkills = '';
  @state() private guardrailMaxIter = '';
  @state() private guardrailMaxTools = '';
  @state() private guardrailConfirmation = '';

  static styles = [iconStyles, css`
    :host { display: block; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    h2 { color: #fff; margin: 0; }
    .btn-primary { background: #6366f1; border: none; border-radius: 6px; color: #fff; padding: 0.6rem 1.2rem; cursor: pointer; font-weight: 600; }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
    .card { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; position: relative; }
    .card-title { font-size: 1.1rem; font-weight: 600; color: #fff; }
    .card-model { font-size: 0.8rem; color: #6366f1; font-weight: 600; }
    .card-prompt { font-size: 0.85rem; color: #aaa; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; line-height: 1.4; }
    .card-footer { margin-top: 0.5rem; display: flex; gap: 0.5rem; }
    
    .btn-icon { background: #2a2a4a; border: none; border-radius: 6px; color: #ccc; padding: 0.5rem; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .btn-icon:hover { color: #fff; background: #3a3a5a; }
    .badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; background: #333; color: #eee; }
    .badge.default { background: #1e3a8a; color: #bfdbfe; }

    /* Modal styles */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 100; display: flex; align-items: center; justify-content: center; }
    .modal { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 16px; padding: 2rem; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .modal-title { font-size: 1.3rem; font-weight: 700; color: #fff; }
    .form-group { display: flex; flex-direction: column; gap: 0.4rem; }
    label { font-size: 0.85rem; color: #aaa; }
    input, textarea, select { background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; padding: 0.75rem; font-size: 0.95rem; }
    textarea { min-height: 120px; resize: vertical; font-family: inherit; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }
    .btn-secondary { background: transparent; border: 1px solid #333; color: #aaa; border-radius: 8px; padding: 0.75rem 1.25rem; cursor: pointer; }
    
    .skills-selection { display: flex; flex-wrap: wrap; gap: 0.5rem; background: #111; padding: 0.5rem; border-radius: 8px; border: 1px solid #333; }
    .skill-toggle { font-size: 0.8rem; padding: 0.3rem 0.6rem; border-radius: 4px; border: 1px solid #444; cursor: pointer; background: #222; color: #888; }
    .skill-toggle.selected { background: #6366f1; color: #fff; border-color: #6366f1; }

    .run-box { background: #070710; border-radius: 8px; padding: 1rem; font-family: monospace; font-size: 0.85rem; color: #34d399; margin-top: 0.5rem; white-space: pre-wrap; min-height: 100px; max-height: 300px; overflow-y: auto; border: 1px solid #1a3a2e; }
  `];

  async firstUpdated() {
    await this.loadLives();
    await this.loadSkills();
    await this.loadTelegramBots();
    await this.loadWebhookConfigs();
    await this.loadLLMConfigs();
    this.ws.on('chat.delta', (data: any) => {
      if (data.sessionKey.startsWith('ws-trigger:')) {
        this.runResponse += data.delta;
        this.requestUpdate();
      }
    });
    this.ws.on('chat.error', (data: any) => {
      if (data.sessionKey.startsWith('ws-trigger:')) {
        this.runResponse += `\n[ERROR]: ${data.message}`;
        this.requestUpdate();
      }
    });
  }

  async loadTelegramBots() {
    try {
      const res = await this.ws.request('creds.get', { key: 'telegram.bots' });
      if (res && res.value) {
        this.telegramBots = typeof res.value === 'string' ? JSON.parse(res.value) : res.value;
      }
    } catch {
      this.telegramBots = [];
    }
  }

  async loadWebhookConfigs() {
    try {
      const res = await this.ws.request('creds.get', { key: 'webhooks.configs' });
      const value = res?.value;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      this.webhookConfigs = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.webhookConfigs = [];
    }
  }

  async loadLLMConfigs() {
    try {
      this.llmConfigs = await this.ws.request('llm_config.list');
    } catch {
      this.llmConfigs = [];
    }
  }

  async loadJobs(liveId: string) {
    try {
      this.jobs = await this.ws.request('job.list', { liveId });
    } catch { }
  }

  private resetJobForm() {
    this.newJob = { name: '', cronExpr: '0 9 * * *', prompt: '', startDate: '', endDate: '' };
    this.editingJobId = null;
  }

  private toDateInput(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  startEditJob(job: any) {
    this.editingJobId = job.id;
    this.newJob = {
      name: job.name || '',
      cronExpr: job.cron_expr || '0 9 * * *',
      prompt: job.prompt || '',
      startDate: this.toDateInput(job.start_date),
      endDate: this.toDateInput(job.end_date)
    };
  }

  async createJob() {
    if (!this.newJob.cronExpr || !this.newJob.prompt) { alert('Cron and Prompt are required'); return; }
    if (!this.editingLive?.id) return;
    try {
      if (this.editingJobId) {
        await this.ws.request('job.update', {
          id: this.editingJobId,
          name: this.newJob.name,
          cronExpr: this.newJob.cronExpr,
          prompt: this.newJob.prompt,
          startDate: this.newJob.startDate,
          endDate: this.newJob.endDate
        });
      } else {
        await this.ws.request('job.create', {
          liveId: this.editingLive.id,
          name: this.newJob.name,
          cronExpr: this.newJob.cronExpr,
          prompt: this.newJob.prompt,
          startDate: this.newJob.startDate || undefined,
          endDate: this.newJob.endDate || undefined
        });
      }
      this.resetJobForm();
      await this.loadJobs(this.editingLive.id);
    } catch (e: any) {
      alert(this.editingJobId ? `Error updating job: ${e.message}` : 'Error creating job');
    }
  }

  async deleteJob(id: string) {
    if (!this.editingLive?.id) return;
    try {
      await this.ws.request('job.delete', { id });
      if (this.editingJobId === id) {
        this.resetJobForm();
      }
      await this.loadJobs(this.editingLive.id);
    } catch (e) { }
  }

  async setJobEnabled(jobId: string, enabled: boolean) {
    if (!this.editingLive?.id) return;
    try {
      await this.ws.request('job.update', { id: jobId, enabled });
      await this.loadJobs(this.editingLive.id);
    } catch (e: any) {
      alert(`Error updating job status: ${e.message}`);
    }
  }
  async loadLives() {
    this.loading = true;
    try {
      this.lives = await this.ws.request('live.list');
    } catch (e) {
      console.error(e);
    } finally {
      this.loading = false;
    }
  }

  async loadSkills() {
    try {
      this.allSkills = await this.ws.request('skills.list');
    } catch (e) {
      console.error('Failed to load skills', e);
    }
  }

  async saveLive() {
    const live = this.editingLive;
    if (!live || !live.id || !live.name) return;

    // Build guardrail object from form fields (if enabled)
    if (this.showGuardrail) {
      const guardrail: LiveGuardrail = {};
      const denied = this.guardrailDeniedSkills.split(',').map(s => s.trim()).filter(Boolean);
      if (denied.length > 0) guardrail.skills = { deny: denied };
      const maxIter = parseInt(this.guardrailMaxIter);
      const maxTools = parseInt(this.guardrailMaxTools);
      if (!isNaN(maxIter) || !isNaN(maxTools)) {
        guardrail.limits = {};
        if (!isNaN(maxIter)) guardrail.limits.max_iterations = maxIter;
        if (!isNaN(maxTools)) guardrail.limits.max_tool_calls = maxTools;
      }
      const confirm = this.guardrailConfirmation.split(',').map(s => s.trim()).filter(Boolean);
      if (confirm.length > 0) guardrail.confirmation_required = confirm;
      live.guardrail = Object.keys(guardrail).length > 0 ? guardrail : null;
    } else {
      live.guardrail = null;
    }

    console.log('Saving live:', live);
    try {
      if (this.showCreateModal) {
        await this.ws.request('live.create', live);
      } else {
        await this.ws.request('live.update', live);
      }
      this.closeModal();
      await this.loadLives();
    } catch (e: any) {
      console.error('Save failed:', e);
      alert('Error saving Live: ' + e.message);
    }
  }

  toggleSkill(skillName: string) {
    if (!this.editingLive) return;
    const skills = this.editingLive.skills || [];
    if (skills.includes(skillName)) {
      this.editingLive.skills = skills.filter(s => s !== skillName);
    } else {
      this.editingLive.skills = [...skills, skillName];
    }
    this.requestUpdate();
  }

  toggleChannel(channel: string) {
    if (!this.editingLive) return;
    const channels = this.editingLive.channels || [];
    if (channels.includes(channel)) {
      this.editingLive.channels = channels.filter(c => c !== channel);
    } else {
      this.editingLive.channels = [...channels, channel];
    }
    this.requestUpdate();
  }


  toggleWebhookCall(hookId: string) {
    if (!this.editingLive) return;
    const selected = this.editingLive.webhook_ids || [];
    this.editingLive.webhook_ids = selected.includes(hookId)
      ? selected.filter(id => id !== hookId)
      : [...selected, hookId];
    this.requestUpdate();
  }
  async deleteLive(id: string) {
    if (!confirm(`Are you sure you want to delete agent ${id}?`)) return;
    try {
      await this.ws.request('live.delete', { id });
      await this.loadLives();
    } catch (e) {
      alert('Error deleting agent');
    }
  }

  async triggerLive(id: string) {
    this.runResponse = '';
    this.runningLive = id;
    try {
      await this.ws.request('live.trigger', { id, prompt: this.runPrompt });
    } catch (e: any) {
      this.runResponse = `Error: ${e.message}`;
    }
  }

  openCreate() {
    this.editingLive = {
      id: '',
      name: '',
      system_prompt: '',
      model_provider: 'openai',
      model_name: 'gpt-4o-mini',
      routing_default: false,
      channels: [],
      skills: [],
      webhook_ids: [],
      llm_config_id: '',
      guardrail: null
    };
    this.showGuardrail = false;
    this.guardrailDeniedSkills = '';
    this.guardrailMaxIter = '';
    this.guardrailMaxTools = '';
    this.guardrailConfirmation = '';
    this.jobs = [];
    this.resetJobForm();
    this.showCreateModal = true;
  }

  openEdit(live: Live) {
    this.editingLive = { ...live, skills: live.skills || [], channels: live.channels || [], webhook_ids: live.webhook_ids || [] };
    const g = live.guardrail;
    this.showGuardrail = !!g;
    this.guardrailDeniedSkills = g?.skills?.deny?.join(', ') ?? '';
    this.guardrailMaxIter = g?.limits?.max_iterations?.toString() ?? '';
    this.guardrailMaxTools = g?.limits?.max_tool_calls?.toString() ?? '';
    this.guardrailConfirmation = g?.confirmation_required?.join(', ') ?? '';
    this.showCreateModal = false;
    this.resetJobForm();
    this.loadJobs(live.id);
  }

  closeModal() {
    this.showCreateModal = false;
    this.editingLive = null;
    this.runningLive = null;
    this.jobs = [];
    this.resetJobForm();
  }

  render() {
    if (this.loading) return html`<div>Loading lives...</div>`;

    return html`
      <header>
        <h2>Agents (Lives)</h2>
        <button class="btn-primary" @click=${this.openCreate}>+ New Agent</button>
      </header>

      <div class="grid">
        ${this.lives.map(live => html`
          <div class="card">
            <div class="card-title">${live.name}</div>
            <div class="card-model">${live.model_name} ${live.routing_default ? html`<span class="badge default">DEFAULT</span>` : ''}</div>
            <div class="card-prompt">${live.system_prompt || 'No system prompt configured.'}</div>
            <div class="card-footer">
              <button class="btn-icon" title="Edit" @click=${() => this.openEdit(live)}>${iconEdit()}</button>
              <button class="btn-icon" title="Run Now" @click=${() => this.triggerLive(live.id)}>${iconPlayArrow()}</button>
              <button class="btn-icon" title="Delete" @click=${() => this.deleteLive(live.id)}>${iconDelete()}</button>
            </div>
          </div>
        `)}
      </div>

      ${(this.showCreateModal || this.editingLive) && !this.runningLive ? this.renderModal() : ''}
      ${this.runningLive ? this.renderRunModal() : ''}
    `;
  }

  private renderModal() {
    const live = this.editingLive!;
    const selectedSkills = live.skills || [];
    const selectedChannels = live.channels || [];

    return html`
      <div class="modal-overlay">
        <div class="modal">
          <div class="modal-title">${this.showCreateModal ? 'Create New Agent' : `Edit ${live.name}`}</div>
          
          <div class="form-group">
            <label>Unique ID (slug)</label>
            <input 
                type="text" 
                placeholder="e.g.: personal_assistant" 
                .value=${live.id || ''} 
                @input=${(e: any) => live.id = e.target.value}
                ?disabled=${!this.showCreateModal}
            />
          </div>

          <div class="form-group">
            <label>Display Name</label>
            <input 
                type="text" 
                placeholder="e.g.: My Assistant" 
                .value=${live.name || ''} 
                @input=${(e: any) => live.name = e.target.value}
            />
          </div>

          <div class="form-group">
            <label>Associated Skills (Agent Tools)</label>
            <input 
              type="text" 
              placeholder="Search skills..." 
              style="margin-bottom: 0.5rem;"
              .value=${this.skillSearch}
              @input=${(e: any) => this.skillSearch = e.target.value}
            />
            <div class="skills-selection">
              ${this.allSkills
        .filter(s => s.name.toLowerCase().includes(this.skillSearch.toLowerCase()) || s.description.toLowerCase().includes(this.skillSearch.toLowerCase()))
        .map(s => html`
                <div 
                  class="skill-toggle ${selectedSkills.includes(s.name) ? 'selected' : ''}"
                  title="${s.description}"
                  @click=${() => this.toggleSkill(s.name)}
                >
                  ${s.name}
                </div>
              `)}
              ${this.allSkills.length === 0 ? html`<span style="font-size: 0.8rem; color: #555;">No skills loaded</span>` : ''}
              ${this.allSkills.length > 0 && this.allSkills.filter(s => s.name.toLowerCase().includes(this.skillSearch.toLowerCase())).length === 0 ? html`<span style="font-size: 0.8rem; color: #555;">No skills found</span>` : ''}
            </div>
          </div>

          ${selectedSkills.includes('webhook') ? html`
            <div class="form-group">
              <label>Allowed Webhooks for this Live</label>
              <div class="skills-selection">
                ${this.webhookConfigs.map((hook: any) => html`
                  <div
                    class="skill-toggle ${(live.webhook_ids || []).includes(hook.id) ? 'selected' : ''}"
                    @click=${() => this.toggleWebhookCall(hook.id)}
                  >
                    ${hook.name || hook.id}
                  </div>
                `)}
                ${this.webhookConfigs.length === 0 ? html`<span style="font-size: 0.8rem; color: #555;">No webhooks configured in Connectors</span>` : ''}
              </div>
              <div style="font-size: 0.75rem; color: #8b9bb5;">
                If no webhook is selected, the Live can use all configured webhooks.
              </div>
            </div>
          ` : ''}
          <div class="form-group">
            <label>System Prompt (Personality and Rules)</label>
            <textarea 
                placeholder="You are an assistant specialized in..." 
                .value=${live.system_prompt || ''} 
                @input=${(e: any) => live.system_prompt = e.target.value}
            ></textarea>
          </div>

          <div class="form-group">
            <label>AI Connection (Provider)</label>
            <select @change=${(e: any) => { live.llm_config_id = e.target.value; this.requestUpdate(); }}>
              <option value="" ?selected=${!live.llm_config_id}>Default (OpenAI Cloud)</option>
              ${this.llmConfigs.map(c => html`<option value=${c.id} ?selected=${live.llm_config_id === c.id}>${c.name} (${c.provider})</option>`)}
            </select>
          </div>

          <div class="form-group">
            <label>LLM Model (Model ID)</label>
            <select @change=${(e: any) => { live.model_name = e.target.value; this.requestUpdate(); }}>
                <option value="gpt-5.4" ?selected=${live.model_name === 'gpt-5.4'}>gpt-5.4</option>
                <option value="gpt-5.4-mini" ?selected=${live.model_name === 'gpt-5.4-mini'}>gpt-5.4-mini</option>
                <option value="gpt-5.4-nano" ?selected=${live.model_name === 'gpt-5.4-nano'}>gpt-5.4-nano</option>
                <option value="gpt-5.2" ?selected=${live.model_name === 'gpt-5.2'}>gpt-5.2</option>
                <option value="gpt-5-mini" ?selected=${live.model_name === 'gpt-5-mini'}>gpt-5-mini</option>
                <option value="gpt-5-nano" ?selected=${live.model_name === 'gpt-5-nano'}>gpt-5-nano</option>    
                <option value="gpt-4o-mini" ?selected=${live.model_name === 'gpt-4o-mini' || !live.model_name}>gpt-4o-mini</option>
                <option value="gpt-4o" ?selected=${live.model_name === 'gpt-4o'}>gpt-4o</option>
                <option value="o1-preview" ?selected=${live.model_name === 'o1-preview'}>o1-preview</option>
                <option value="gemini-flash-latest" ?selected=${live.model_name === 'gemini-flash-latest'}>gemini-flash-latest (Stable)</option>
                <option value="gemini-pro-latest" ?selected=${live.model_name === 'gemini-pro-latest'}>gemini-pro-latest (Stable)</option>
                <option value="openai/gpt-oss-20b" ?selected=${live.model_name === 'openai/gpt-oss-20b'}>openai/gpt-oss-20b</option>
                <option value="openai/gpt-oss-120b" ?selected=${live.model_name === 'openai/gpt-oss-120b'}>openai/gpt-oss-120b</option>
                <option value="qwen/qwen3-32b" ?selected=${live.model_name === 'qwen/qwen3-32b'}>qwen/qwen3-32b</option>
                <option value="moonshotai/kimi-k2-instruct-0905" ?selected=${live.model_name === 'moonshotai/kimi-k2-instruct-0905'}>moonshotai/kimi-k2-instruct-0905</option>
                <option value="gemma-3-27b-it" ?selected=${live.model_name === 'gemma-3-27b-it'}>gemma-3-27b-it</option>
            </select>
          </div>

          <div class="form-group">
            <label>Connected Channels (message sources)</label>
            <div class="skills-selection">
              ${this.telegramBots.map(bot => {
          const channelId = `telegram:${bot.id}`;
          return html`
                <div
                  class="skill-toggle ${selectedChannels.includes(channelId) ? 'selected' : ''}"
                  @click=${() => this.toggleChannel(channelId)}
                >
                  ${iconSend()} Telegram: ${bot.name} (${bot.id})
                </div>
              `;
        })}
              <div
                class="skill-toggle ${selectedChannels.includes('whatsapp') ? 'selected' : ''}"
                @click=${() => this.toggleChannel('whatsapp')}
              >
                ${iconChat2()} WhatsApp
              </div>
              ${this.telegramBots.length === 0 ? html`<span style="font-size: 0.8rem; color: #555;">No Telegram bots configured in settings</span>` : ''}
            </div>
          </div>

          <div class="form-group">
            <label>
                <input type="checkbox" .checked=${!!live.routing_default} @change=${(e: any) => live.routing_default = e.target.checked} />
                Default Agent (receives messages on orphan channels)
            </label>
          </div>

          <hr style="border: none; border-top: 1px solid #333; margin: 1rem 0;" />
          <div class="form-group">
            <label>
                <input type="checkbox" .checked=${this.showGuardrail} @change=${(e: any) => { this.showGuardrail = e.target.checked; this.requestUpdate(); }} />
                Enable Guardrail (Safety Constraints)
            </label>
          </div>

          ${this.showGuardrail ? html`
            <div style="background: #111; padding: 1rem; border-radius: 8px; border: 1px solid #4a3520; display: flex; flex-direction: column; gap: 0.75rem;">
              <div style="font-size: 0.85rem; color: #f59e0b; font-weight: 600;">Agent Guardrail</div>

              <div class="form-group">
                <label>Blocked Skills (comma-separated names)</label>
                <input
                  type="text"
                  placeholder="e.g.: gmail, filesystem, browser_automation"
                  .value=${this.guardrailDeniedSkills}
                  @input=${(e: any) => this.guardrailDeniedSkills = e.target.value}
                />
                <div style="font-size: 0.72rem; color: #666;">The agent will not be able to use these skills, even if assigned.</div>
              </div>

              <div style="display: flex; gap: 0.75rem;">
                <div class="form-group" style="flex:1">
                  <label>Max Iterations</label>
                  <input
                    type="number"
                    placeholder="10 (default)"
                    min="1" max="50"
                    .value=${this.guardrailMaxIter}
                    @input=${(e: any) => this.guardrailMaxIter = e.target.value}
                  />
                </div>
                <div class="form-group" style="flex:1">
                  <label>Max Tool Calls</label>
                  <input
                    type="number"
                    placeholder="30 (default)"
                    min="1" max="100"
                    .value=${this.guardrailMaxTools}
                    @input=${(e: any) => this.guardrailMaxTools = e.target.value}
                  />
                </div>
              </div>

              <div class="form-group">
                <label>Tools Requiring Confirmation (comma-separated names)</label>
                <input
                  type="text"
                  placeholder="e.g.: gmail.sendEmail, filesystem.deleteFile"
                  .value=${this.guardrailConfirmation}
                  @input=${(e: any) => this.guardrailConfirmation = e.target.value}
                />
                <div style="font-size: 0.72rem; color: #666;">The agent will ask for confirmation before using these tools.</div>
              </div>
            </div>
          ` : ''}

          ${!this.showCreateModal ? html`
            <hr style="border: none; border-top: 1px solid #333; margin: 1rem 0;" />
            <h3 style="margin: 0; color: #fff; font-size: 1.1rem;">Cron Jobs (Scheduled Actions)</h3>
            <div class="form-group" style="background: #111; padding: 1rem; border-radius: 8px; border: 1px solid #333;">
              <div style="font-size: 0.8rem; color: #94a3b8;">${this.editingJobId ? `Edit job: ${this.editingJobId}` : 'New job'}</div>
              <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
               <input type="text" placeholder="Job Name" .value=${this.newJob.name} @input=${(e: any) => this.newJob.name = e.target.value} />
               <input type="text" placeholder="Cron Expr (e.g.: 0 9 * * *)" .value=${this.newJob.cronExpr} @input=${(e: any) => this.newJob.cronExpr = e.target.value} />
              </div>
              <textarea placeholder="Prompt to run (e.g. Send me the daily report)" .value=${this.newJob.prompt} @input=${(e: any) => this.newJob.prompt = e.target.value} style="min-height: 60px;"></textarea>
              <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; align-items: center;">
                <label>From:</label>
                <input type="date" .value=${this.newJob.startDate} @input=${(e: any) => this.newJob.startDate = e.target.value} />
                <label>To:</label>
                <input type="date" .value=${this.newJob.endDate} @input=${(e: any) => this.newJob.endDate = e.target.value} />
              </div>
              <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                <button class="btn-primary" style="width: fit-content;" @click=${this.createJob}>${this.editingJobId ? 'Save Job' : '+ Add Job'}</button>
                ${this.editingJobId ? html`<button class="btn-secondary" style="padding: 0.5rem 0.8rem;" @click=${this.resetJobForm}>Cancel Edit</button>` : ''}
              </div>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              ${this.jobs.map(j => html`
                <div style="background: #222; padding: 0.5rem 1rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <strong style="color: #fff;">${j.name || 'Unnamed'}</strong> <span style="color: #aaa; font-size: 0.85rem;">[${j.cron_expr}]</span>
                    <span style="margin-left: 0.5rem; font-size: 0.75rem; color: ${j.enabled ? '#34d399' : '#f87171'};">
                      ${j.enabled ? 'ACTIVE' : 'DISABLED'}
                    </span>
                    <div style="font-size: 0.8rem; color: #888; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 300px;">
                      ${j.prompt}
                    </div>
                    ${j.start_date || j.end_date ? html`
                      <div style="font-size: 0.75rem; color: #6366f1;">
                        ${j.start_date ? 'From: ' + new Date(j.start_date).toLocaleDateString() : ''} 
                        ${j.end_date ? 'To: ' + new Date(j.end_date).toLocaleDateString() : ''}
                      </div>
                    ` : ''}
                  </div>
                  <div style="display: flex; gap: 0.4rem;">
                    <label style="display:flex; align-items:center; gap:0.3rem; color:#ccc; font-size:0.8rem;">
                      <input type="checkbox" .checked=${!!j.enabled} @change=${(e: any) => this.setJobEnabled(j.id, e.target.checked)} />
                      On
                    </label>
                    <button class="btn-secondary" style="padding: 0.3rem 0.6rem;" @click=${() => this.startEditJob(j)}>Edit</button>
                    <button class="btn-secondary" style="color: #f87171; border-color: #4d0a0a; padding: 0.3rem 0.6rem;" @click=${() => this.deleteJob(j.id)}>Remove</button>
                  </div>
                </div>
              `)}
            </div>
          ` : ''}

          <div class="modal-actions">
            <button class="btn-secondary" @click=${this.closeModal}>Cancel</button>
            <button class="btn-primary" @click=${this.saveLive}>${this.showCreateModal ? 'Create Live' : 'Save Changes'}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderRunModal() {
    return html`
      <div class="modal-overlay">
        <div class="modal">
          <div class="modal-title">Run Test: ${this.runningLive}</div>
          <div class="form-group">
            <label>Messaggio di input</label>
            <input type="text" .value=${this.runPrompt} @input=${(e: any) => this.runPrompt = e.target.value} />
          </div>
          <button class="btn-primary" @click=${() => this.triggerLive(this.runningLive!)}>Lancia</button>

          <div class="run-box">${this.runResponse || 'In attesa di risposta...'}</div>

          <div class="modal-actions">
            <button class="btn-secondary" @click=${this.closeModal}>Chiudi</button>
          </div>
        </div>
      </div>
    `;
  }
}
















