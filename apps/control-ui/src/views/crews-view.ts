// Copyright (c) 2026 Flavio Cerato
﻿import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { iconStyles, iconEdit, iconDelete, iconPlayArrow } from '../icons.js';

interface Crew {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  channels: string[];
  member_live_ids: string[];
  routing_default: boolean;
  orchestration_mode: 'router_only' | 'pipeline' | 'supervisor_llm';
  llm_config_id?: string;
  model_name?: string;
}

interface LiveOption {
  id: string;
  name: string;
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

@customElement('crews-view')
export class CrewsView extends LitElement {
  @property({ type: Object }) ws: any;
  @state() private crews: Crew[] = [];
  @state() private lives: LiveOption[] = [];
  @state() private llmConfigs: LLMConfig[] = [];
  @state() private telegramBots: any[] = [];
  @state() private loading = true;
  @state() private editingCrew: Partial<Crew> | null = null;
  @state() private showCreateModal = false;
  @state() private runningCrew: string | null = null;
  @state() private runPrompt = 'Route and complete this task.';
  @state() private runResponse = '';
  @state() private runSessionKey = '';
  @state() private jobs: any[] = [];
  @state() private newJob: JobDraft = { name: '', cronExpr: '0 9 * * *', prompt: '', startDate: '', endDate: '' };
  @state() private editingJobId: string | null = null;

  static styles = [iconStyles, css`
    :host { display: block; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    h2 { color: #fff; margin: 0; }
    .btn-primary { background: #6366f1; border: none; border-radius: 6px; color: #fff; padding: 0.6rem 1.2rem; cursor: pointer; font-weight: 600; }
    .btn-secondary { background: transparent; border: 1px solid #333; color: #aaa; border-radius: 8px; padding: 0.75rem 1.25rem; cursor: pointer; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }
    .card { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.8rem; }
    .card-title { font-size: 1.05rem; font-weight: 700; color: #fff; }
    .card-meta { font-size: 0.82rem; color: #94a3b8; }
    .card-desc { font-size: 0.85rem; color: #aaa; line-height: 1.45; min-height: 3.6em; }
    .card-footer { display: flex; gap: 0.5rem; }
    .btn-icon { background: #2a2a4a; border: none; border-radius: 6px; color: #ccc; padding: 0.5rem; cursor: pointer; }
    .btn-icon:hover { color: #fff; background: #3a3a5a; }
    .badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; background: #1e3a8a; color: #bfdbfe; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 100; display: flex; align-items: center; justify-content: center; }
    .modal { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 16px; padding: 2rem; width: 100%; max-width: 720px; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .modal-title { font-size: 1.3rem; font-weight: 700; color: #fff; }
    .form-group { display: flex; flex-direction: column; gap: 0.45rem; }
    label { font-size: 0.85rem; color: #aaa; }
    input, textarea, select { background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; padding: 0.75rem; font-size: 0.95rem; }
    textarea { min-height: 90px; resize: vertical; font-family: inherit; }
    .toggle-list { display: flex; flex-wrap: wrap; gap: 0.5rem; background: #111; padding: 0.65rem; border-radius: 8px; border: 1px solid #333; }
    .toggle { font-size: 0.8rem; padding: 0.35rem 0.65rem; border-radius: 6px; border: 1px solid #444; cursor: pointer; background: #222; color: #888; }
    .toggle.selected { background: #6366f1; color: #fff; border-color: #6366f1; }
    .empty { font-size: 0.8rem; color: #555; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem; }
    .run-box { background: #070710; border-radius: 8px; padding: 1rem; font-family: monospace; font-size: 0.85rem; color: #34d399; white-space: pre-wrap; min-height: 120px; border: 1px solid #1a3a2e; }
  `];

  async firstUpdated() {
    await Promise.all([
      this.loadCrews(),
      this.loadLives(),
      this.loadLLMConfigs(),
      this.loadTelegramBots(),
    ]);

    this.ws.on('chat.delta', (data: any) => {
      if (this.runSessionKey && data.sessionKey === this.runSessionKey) {
        this.runResponse += data.delta;
        this.requestUpdate();
      }
    });

    this.ws.on('chat.final', (data: any) => {
      if (this.runSessionKey && data.sessionKey === this.runSessionKey) {
        this.runResponse = data.text;
        this.requestUpdate();
      }
    });

    this.ws.on('chat.error', (data: any) => {
      if (this.runSessionKey && data.sessionKey === this.runSessionKey) {
        this.runResponse += `\n[ERROR]: ${data.message}`;
        this.requestUpdate();
      }
    });
  }

  async loadCrews() {
    this.loading = true;
    try {
      this.crews = await this.ws.request('crew.list');
    } catch (e) {
      console.error('Failed to load crews', e);
      this.crews = [];
    } finally {
      this.loading = false;
    }
  }

  async loadLives() {
    try {
      const lives = await this.ws.request('live.list');
      this.lives = lives.map((live: any) => ({ id: live.id, name: live.name }));
    } catch (e) {
      console.error('Failed to load lives', e);
      this.lives = [];
    }
  }

  async loadLLMConfigs() {
    try {
      this.llmConfigs = await this.ws.request('llm_config.list');
    } catch {
      this.llmConfigs = [];
    }
  }

  async loadTelegramBots() {
    try {
      const res = await this.ws.request('creds.get', { key: 'telegram.bots' });
      this.telegramBots = Array.isArray(res?.value)
        ? res.value
        : (res?.value ? JSON.parse(res.value) : []);
    } catch {
      this.telegramBots = [];
    }
  }

  async loadJobs(crewId: string) {
    try {
      this.jobs = await this.ws.request('job.list', { crewId });
    } catch {
      this.jobs = [];
    }
  }

  openCreate() {
    this.editingCrew = {
      id: '',
      name: '',
      description: '',
      system_prompt: '',
      channels: [],
      member_live_ids: [],
      routing_default: false,
      orchestration_mode: 'router_only',
      llm_config_id: '',
      model_name: 'gpt-5-mini',
    };
    this.jobs = [];
    this.resetJobForm();
    this.showCreateModal = true;
  }
  openEdit(crew: Crew) {
    this.editingCrew = {
      ...crew,
      channels: [...(crew.channels || [])],
      member_live_ids: [...(crew.member_live_ids || [])],
      orchestration_mode: crew.orchestration_mode || 'router_only',
      llm_config_id: crew.llm_config_id || '',
      model_name: crew.model_name || 'gpt-5-mini',
    };
    this.jobs = [];
    this.resetJobForm();
    this.loadJobs(crew.id);
    this.showCreateModal = false;
  }
  closeModal() {
    this.editingCrew = null;
    this.showCreateModal = false;
    this.runningCrew = null;
    this.jobs = [];
    this.resetJobForm();
  }
  toggleChannel(channel: string) {
    if (!this.editingCrew) return;
    const current = this.editingCrew.channels || [];
    this.editingCrew.channels = current.includes(channel)
      ? current.filter((item) => item !== channel)
      : [...current, channel];
    this.requestUpdate();
  }

  toggleMember(liveId: string) {
    if (!this.editingCrew) return;
    const current = this.editingCrew.member_live_ids || [];
    this.editingCrew.member_live_ids = current.includes(liveId)
      ? current.filter((item) => item !== liveId)
      : [...current, liveId];
    this.requestUpdate();
  }

  moveMember(liveId: string, direction: -1 | 1) {
    if (!this.editingCrew) return;
    const current = [...(this.editingCrew.member_live_ids || [])];
    const index = current.indexOf(liveId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
    this.editingCrew.member_live_ids = current;
    this.requestUpdate();
  }

  async saveCrew() {
    const crew = this.editingCrew;
    if (!crew?.id || !crew?.name) return;

    try {
      if (this.showCreateModal) {
        await this.ws.request('crew.create', crew);
      } else {
        await this.ws.request('crew.update', crew);
      }
      this.closeModal();
      await this.loadCrews();
    } catch (e: any) {
      alert(`Error saving crew: ${e.message}`);
    }
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
    if (!this.editingCrew?.id) return;
    if (!this.newJob.cronExpr || !this.newJob.prompt) {
      alert('Cron and Prompt are required');
      return;
    }

    try {
      if (this.editingJobId) {
        await this.ws.request('job.update', {
          id: this.editingJobId,
          name: this.newJob.name,
          cronExpr: this.newJob.cronExpr,
          prompt: this.newJob.prompt,
          startDate: this.newJob.startDate,
          endDate: this.newJob.endDate,
        });
      } else {
        await this.ws.request('job.create', {
          crewId: this.editingCrew.id,
          name: this.newJob.name,
          cronExpr: this.newJob.cronExpr,
          prompt: this.newJob.prompt,
          startDate: this.newJob.startDate || undefined,
          endDate: this.newJob.endDate || undefined,
        });
      }
      this.resetJobForm();
      await this.loadJobs(this.editingCrew.id);
    } catch (e: any) {
      alert(this.editingJobId ? `Error updating crew job: ${e.message}` : `Error creating crew job: ${e.message}`);
    }
  }

  async deleteJob(id: string) {
    if (!this.editingCrew?.id) return;
    try {
      await this.ws.request('job.delete', { id });
      if (this.editingJobId === id) {
        this.resetJobForm();
      }
      await this.loadJobs(this.editingCrew.id);
    } catch {
      alert('Error removing job');
    }
  }

  async setJobEnabled(jobId: string, enabled: boolean) {
    if (!this.editingCrew?.id) return;
    try {
      await this.ws.request('job.update', { id: jobId, enabled });
      await this.loadJobs(this.editingCrew.id);
    } catch (e: any) {
      alert(`Error updating crew job status: ${e.message}`);
    }
  }

  async deleteCrew(id: string) {
    if (!confirm(`Delete crew ${id}?`)) return;
    try {
      await this.ws.request('crew.delete', { id });
      await this.loadCrews();
    } catch {
      alert('Error deleting crew');
    }
  }

  async triggerCrew(id: string) {
    this.runningCrew = id;
    const sessionKey = this.getCrewSessionKey(id);
    this.runSessionKey = sessionKey;
    try {
      await this.ws.request('crew.trigger', { id, prompt: this.runPrompt, sessionKey });
    } catch (e: any) {
      this.runResponse = `Error: ${e.message}`;
    }
  }

  getCrewSessionKey(crewId: string) {
    const key = `crew-session:${crewId}`;
    let value = localStorage.getItem(key);
    if (!value) {
      value = `ws:crew:${crewId}:${crypto.randomUUID()}`;
      localStorage.setItem(key, value);
    }
    return value;
  }

  async openRunModal(crewId: string) {
    this.runningCrew = crewId;
    this.runSessionKey = this.getCrewSessionKey(crewId);
    this.runResponse = '';
    try {
      const result = await this.ws.request('crew.history', { id: crewId, sessionKey: this.runSessionKey, limit: 20 });
      const items = Array.isArray(result?.items) ? result.items : [];
      this.runResponse = items.map((item: any) => `${item.role === 'assistant' ? 'Crew' : 'User'}: ${item.content}`).join('\n\n');
    } catch {
      this.runResponse = '';
    }
  }

  async clearCrewMemory() {
    if (!this.runningCrew) return;
    const sessionKey = this.runSessionKey || this.getCrewSessionKey(this.runningCrew);
    try {
      await this.ws.request('crew.clear', { id: this.runningCrew, sessionKey });
      this.runResponse = '';
    } catch (e: any) {
      this.runResponse = `Error resetting memory: ${e.message}`;
    }
  }

  render() {
    if (this.loading) return html`<div>Loading crews...</div>`;

    return html`
      <header>
        <h2>Crews</h2>
        <button class="btn-primary" @click=${this.openCreate}>+ New Crew</button>
      </header>

      <div class="grid">
        ${this.crews.map((crew) => html`
          <div class="card">
            <div class="card-title">${crew.name} ${crew.routing_default ? html`<span class="badge">DEFAULT</span>` : ''}</div>
            <div class="card-meta">${crew.id} Â· ${crew.member_live_ids?.length || 0} members</div>
            <div class="card-desc">${crew.description || crew.system_prompt || 'No description set.'}</div>
            <div class="card-footer">
              <button class="btn-icon" title="Edit" @click=${() => this.openEdit(crew)}>${iconEdit()}</button>
              <button class="btn-icon" title="Run" @click=${() => this.openRunModal(crew.id)}>${iconPlayArrow()}</button>
              <button class="btn-icon" title="Delete" @click=${() => this.deleteCrew(crew.id)}>${iconDelete()}</button>
            </div>
          </div>
        `)}
      </div>

      ${(this.showCreateModal || this.editingCrew) && !this.runningCrew ? this.renderModal() : ''}
      ${this.runningCrew ? this.renderRunModal() : ''}
    `;
  }

  private renderModal() {
    const crew = this.editingCrew!;
    const selectedChannels = crew.channels || [];
    const selectedMembers = crew.member_live_ids || [];

    return html`
      <div class="modal-overlay">
        <div class="modal">
          <div class="modal-title">${this.showCreateModal ? 'Create New Crew' : `Edit ${crew.name}`}</div>

          <div class="form-group">
            <label>Crew ID</label>
            <input
              type="text"
              .value=${crew.id || ''}
              @input=${(e: any) => crew.id = e.target.value}
              ?disabled=${!this.showCreateModal}
            />
          </div>

          <div class="form-group">
            <label>Display Name</label>
            <input
              type="text"
              .value=${crew.name || ''}
              @input=${(e: any) => crew.name = e.target.value}
            />
          </div>

          <div class="form-group">
            <label>Description</label>
            <textarea
              .value=${crew.description || ''}
              @input=${(e: any) => crew.description = e.target.value}
            ></textarea>
          </div>

          <div class="form-group">
            <label>Crew Instructions (optional)</label>
            <textarea
              .value=${crew.system_prompt || ''}
              @input=${(e: any) => crew.system_prompt = e.target.value}
            ></textarea>
          </div>

          <div class="form-group">
            <label>Orchestration Mode</label>
            <select @change=${(e: any) => { crew.orchestration_mode = e.target.value; this.requestUpdate(); }}>
              <option value="router_only" ?selected=${(crew.orchestration_mode || 'router_only') === 'router_only'}>Router + Fallback</option>
              <option value="pipeline" ?selected=${crew.orchestration_mode === 'pipeline'}>Ordered Pipeline</option>
              <option value="supervisor_llm" ?selected=${crew.orchestration_mode === 'supervisor_llm'}>LLM Supervisor</option>
            </select>
          </div>

          ${crew.orchestration_mode === 'supervisor_llm' ? html`
            <div class="form-group">
              <label>Crew AI Connection</label>
              <select @change=${(e: any) => { crew.llm_config_id = e.target.value; this.requestUpdate(); }}>
                <option value="" ?selected=${!crew.llm_config_id}>Default (OpenAI Cloud)</option>
                ${this.llmConfigs.map(c => html`<option value=${c.id} ?selected=${crew.llm_config_id === c.id}>${c.name} (${c.provider})</option>`)}
              </select>
            </div>

            <div class="form-group">
              <label>Crew LLM Model</label>
              <select @change=${(e: any) => { crew.model_name = e.target.value; this.requestUpdate(); }}>
                <option value="gpt-5.4" ?selected=${crew.model_name === 'gpt-5.4'}>gpt-5.4</option>
                <option value="gpt-5.4-mini" ?selected=${crew.model_name === 'gpt-5.4-mini'}>gpt-5.4-mini</option>
                <option value="gpt-5.4-nano" ?selected=${crew.model_name === 'gpt-5.4-nano'}>gpt-5.4-nano</option>
                <option value="gpt-5.2" ?selected=${crew.model_name === 'gpt-5.2'}>gpt-5.2</option>
                <option value="gpt-5-mini" ?selected=${crew.model_name === 'gpt-5-mini' || !crew.model_name}>gpt-5-mini</option>
                <option value="gpt-5-nano" ?selected=${crew.model_name === 'gpt-5-nano'}>gpt-5-nano</option>
                <option value="gpt-4o-mini" ?selected=${crew.model_name === 'gpt-4o-mini'}>gpt-4o-mini</option>
                <option value="gpt-4o" ?selected=${crew.model_name === 'gpt-4o'}>gpt-4o</option>
                <option value="gemini-flash-latest" ?selected=${crew.model_name === 'gemini-flash-latest'}>gemini-flash-latest</option>
                <option value="gemini-pro-latest" ?selected=${crew.model_name === 'gemini-pro-latest'}>gemini-pro-latest</option>
              </select>
            </div>
          ` : ''}

          <div class="form-group">
            <label>Connected Channels</label>
            <div class="toggle-list">
              ${this.telegramBots.map((bot) => {
                const channelId = `telegram:${bot.id}`;
                return html`
                  <div
                    class="toggle ${selectedChannels.includes(channelId) ? 'selected' : ''}"
                    @click=${() => this.toggleChannel(channelId)}
                  >
                    Telegram: ${bot.name} (${bot.id})
                  </div>
                `;
              })}
              <div
                class="toggle ${selectedChannels.includes('whatsapp') ? 'selected' : ''}"
                @click=${() => this.toggleChannel('whatsapp')}
              >
                WhatsApp
              </div>
              ${this.telegramBots.length === 0 ? html`<span class="empty">No Telegram bots configured</span>` : ''}
            </div>
          </div>

          <div class="form-group">
            <label>Crew Members</label>
            <div class="toggle-list">
              ${this.lives.map((live) => html`
                <div
                  class="toggle ${selectedMembers.includes(live.id) ? 'selected' : ''}"
                  @click=${() => this.toggleMember(live.id)}
                >
                  ${live.name} (${live.id})
                </div>
              `)}
              ${this.lives.length === 0 ? html`<span class="empty">No lives available</span>` : ''}
            </div>
          </div>

          ${selectedMembers.length > 0 ? html`
            <div class="form-group">
              <label>Member order ${crew.orchestration_mode === 'pipeline' ? '(used in pipeline)' : '(manual priority)'}</label>
              <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                ${selectedMembers.map((memberId, index) => {
                  const member = this.lives.find((live) => live.id === memberId);
                  return html`
                    <div style="background: #111; border: 1px solid #333; border-radius: 8px; padding: 0.5rem 0.75rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                      <span style="color: #ddd;">${index + 1}. ${member?.name || memberId} (${memberId})</span>
                      <span style="display: flex; gap: 0.35rem;">
                        <button class="btn-secondary" style="padding: 0.25rem 0.55rem;" @click=${() => this.moveMember(memberId, -1)} ?disabled=${index === 0}>Up</button>
                        <button class="btn-secondary" style="padding: 0.25rem 0.55rem;" @click=${() => this.moveMember(memberId, 1)} ?disabled=${index === selectedMembers.length - 1}>Down</button>
                      </span>
                    </div>
                  `;
                })}
              </div>
            </div>
          ` : ''}

          <div class="form-group">
            <label>
              <input type="checkbox" .checked=${!!crew.routing_default} @change=${(e: any) => crew.routing_default = e.target.checked} />
              Default crew for orphan channels
            </label>
          </div>

          ${!this.showCreateModal ? html`
            <hr style="border: none; border-top: 1px solid #333; margin: 1rem 0;" />
            <h3 style="margin: 0; color: #fff; font-size: 1.1rem;">Crew Cron Jobs</h3>
            <div class="form-group" style="background: #111; padding: 1rem; border-radius: 8px; border: 1px solid #333;">
              <div style="font-size: 0.8rem; color: #94a3b8;">${this.editingJobId ? `Edit job: ${this.editingJobId}` : 'New job'}</div>
              <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                <input type="text" placeholder="Job Name" .value=${this.newJob.name} @input=${(e: any) => this.newJob.name = e.target.value} />
                <input type="text" placeholder="Cron Expr (e.g.: 0 9 * * *)" .value=${this.newJob.cronExpr} @input=${(e: any) => this.newJob.cronExpr = e.target.value} />
              </div>
              <textarea placeholder="Prompt to execute" .value=${this.newJob.prompt} @input=${(e: any) => this.newJob.prompt = e.target.value} style="min-height: 60px;"></textarea>
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
                    <div style="font-size: 0.8rem; color: #888; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 320px;">
                      ${j.prompt}
                    </div>
                    ${j.start_date || j.end_date ? html`
                      <div style="font-size: 0.75rem; color: #6366f1;">
                        ${j.start_date ? 'From: ' + new Date(j.start_date).toLocaleDateString() : ''}
                        ${j.end_date ? ' To: ' + new Date(j.end_date).toLocaleDateString() : ''}
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
            <button class="btn-primary" @click=${this.saveCrew}>${this.showCreateModal ? 'Create Crew' : 'Save Changes'}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderRunModal() {
    return html`
      <div class="modal-overlay">
        <div class="modal">
          <div class="modal-title">Test Crew: ${this.runningCrew}</div>
          <div class="form-group">
            <label>Input Message</label>
            <input type="text" .value=${this.runPrompt} @input=${(e: any) => this.runPrompt = e.target.value} />
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-primary" @click=${() => this.triggerCrew(this.runningCrew!)}>Run</button>
            <button class="btn-secondary" @click=${this.clearCrewMemory}>Clear Memory</button>
          </div>
          <div class="run-box">${this.runResponse || 'Waiting for response...'}</div>
          <div class="modal-actions">
            <button class="btn-secondary" @click=${this.closeModal}>Close</button>
          </div>
        </div>
      </div>
    `;
  }
}









