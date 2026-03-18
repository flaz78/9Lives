// Copyright (c) 2026 Flavio Cerato
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { iconStyles, msi } from '../icons.js';

interface Connector {
  id: string;
  name: string;
  icon: string;
  type: 'token' | 'oauth' | 'device' | 'apppassword' | 'whatsapp' | 'googledrive' | 'spotify' | 'webhooks' | 'tavily' | 'printer';
  credKey: string;
  placeholder: string;
  hint: string;
}

const ICONS = {
  telegram: 'telegram',
  gmail: 'mail',
  whatsapp: 'chat',
  drive: 'cloud',
  spotify: 'music_note',
  webhook: 'webhook',
  search: 'search',
  printer: 'print',
  check: 'check_circle',
  cross: 'cancel',
  hourglass: 'hourglass_empty',
  plug: 'electrical_services',
  save: 'save',
  key: 'key',
  warning: 'warning',
  menu: 'menu',
  caret: 'chevron_right',
};

const CONNECTORS: Connector[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    icon: ICONS.telegram,
    type: 'token',
    credKey: 'telegram.bots',
    placeholder: '123456:ABC-DEF...',
    hint: 'Create a bot on @BotFather and paste the token here.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    icon: ICONS.gmail,
    type: 'apppassword',
    credKey: 'google.email',
    placeholder: '',
    hint: 'Connect Gmail via SMTP/IMAP with App Password (no Cloud Console required).',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: ICONS.whatsapp,
    type: 'whatsapp',
    credKey: 'whatsapp.session',
    placeholder: '',
    hint: 'Scan the QR with WhatsApp &rarr; Linked Devices &rarr; Link a device.',
  },
  {
    id: 'googledrive',
    name: 'Google Drive',
    icon: ICONS.drive,
    type: 'googledrive',
    credKey: 'google.drive_refresh_token',
    placeholder: '',
    hint: 'Connect Google Drive via OAuth 2.0 to read and write files.',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    icon: ICONS.spotify,
    type: 'spotify',
    credKey: 'spotify.client_id',
    placeholder: '',
    hint: 'Configure Client ID and Client Secret from your Spotify app to use the public catalog.',
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    icon: ICONS.webhook,
    type: 'webhooks',
    credKey: 'webhooks.configs',
    placeholder: '',
    hint: 'Configure one or more webhooks with URL, HTTP method, and API key.',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    icon: ICONS.search,
    type: 'tavily',
    credKey: 'tavily.api_key',
    placeholder: 'tvly-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    hint: 'AI-powered web search. Get the API key at app.tavily.com.',
  },
  {
    id: 'printer',
    name: 'Printer',
    icon: ICONS.printer,
    type: 'printer',
    credKey: 'printer.default_name',
    placeholder: 'Printer name (optional)',
    hint: 'Configure the preferred printer to use as default for print tools.',
  },
];

@customElement('connectors-view')
export class ConnectorsView extends LitElement {
  @property({ type: Object }) ws: any;
  @state() private savedKeys: string[] = [];
  @state() private tokens: Record<string, string> = {};
  @state() private saving: Record<string, boolean> = {};
  @state() private saved: Record<string, boolean> = {};
  @state() private testing: Record<string, boolean> = {};
  @state() private testResult: Record<string, { ok: boolean; message: string }> = {};
  @state() private error: Record<string, string> = {};
  @state() private gmailEmail = '';
  @state() private gmailAppPassword = '';
  @state() private whatsAppStatus: 'disconnected' | 'connecting' | 'qr' | 'connected' = 'disconnected';
  @state() private whatsAppQR: string | null = null;
  @state() private whatsAppUser: string | null = null;
  @state() private whatsAppWhitelist = '';
  @state() private whatsAppWhitelistSaving = false;
  @state() private whatsAppWhitelistSaved = false;
  @state() private driveClientId = '';
  @state() private driveClientSecret = '';
  @state() private driveAuthorized = false;
  @state() private driveAuthUrl: string | null = null;
  @state() private driveAuthWaiting = false;
  @state() private driveAuthError = '';
  @state() private spotifyClientId = '';
  @state() private spotifyClientSecret = '';
  @state() private tavilyApiKey = '';
  @state() private printerDefaultName = '';
  @state() private webhookConfigs: any[] = [];
  @state() private showNewWebhookForm = false;
  @state() private newWebhook = { id: '', name: '', url: '', method: 'POST', apiKey: '', bodyTemplate: '' };
  @state() private telegramBots: any[] = [];
  @state() private showNewBotForm = false;
  @state() private newBot = { id: '', name: '', token: '', whitelist: '' };
  @state() private editingBotIndex: number | null = null;
  @state() private editingBotData: any = null;

  static styles = [iconStyles, css`
    :host { display: block; }
    h2 { color: #fff; margin-top: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.5rem; }
    .card {
      background: #1e1e2e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .card-header { display: flex; align-items: center; gap: 0.75rem; }
    .icon { color: #6366f1; display: flex; align-items: center; width: 24px; height: 24px; }
    .icon .icon-svg { width: 24px; height: 24px; }
    .card-title { font-size: 1.1rem; font-weight: 600; color: #fff; }
    .status-badge {
      display: inline-block;
      padding: 0.15rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 600;
    }
    .connected { background: #0d3d2e; color: #34d399; }
    .disconnected { background: #3d1515; color: #f87171; }
    .hint { font-size: 0.82rem; color: #888; }
    .row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    input {
      flex: 1;
      min-width: 0;
      background: #111;
      border: 1px solid #444;
      border-radius: 6px;
      color: #eee;
      padding: 0.5rem 0.75rem;
      font-size: 0.9rem;
      outline: none;
    }
    input:focus { border-color: #6366f1; }
    button {
      background: #6366f1;
      border: none;
      border-radius: 6px;
      color: #fff;
      padding: 0.5rem 1rem;
      cursor: pointer;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    button:disabled { opacity: 0.45; cursor: default; }
    button.secondary {
      background: transparent;
      border: 1px solid #444;
      color: #aaa;
    }
    button.secondary:hover { border-color: #6366f1; color: #818cf8; }
    .test-result {
      font-size: 0.82rem;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      line-height: 1.4;
    }
    .test-ok { background: #0d2e1e; color: #34d399; border: 1px solid #0a4d2c; }
    .test-fail { background: #2e0d0d; color: #f87171; border: 1px solid #4d0a0a; }
    .success { color: #34d399; font-size: 0.82rem; }
    .err { color: #f87171; font-size: 0.82rem; }
    .divider { border: none; border-top: 1px solid #2a2a4a; }
  `];

  async firstUpdated() {
    await this.loadSavedKeys();

    // Subscribe to WhatsApp real-time events
    this.ws.on('whatsapp.qr', (data: any) => {
      this.whatsAppQR = data.qr;
      this.whatsAppStatus = 'qr';
      this.requestUpdate();
    });
    this.ws.on('whatsapp.status', (data: any) => {
      this.whatsAppStatus = data.status;
      if (data.status === 'connected') {
        this.whatsAppUser = data.user ?? null;
        this.whatsAppQR = null;
      } else {
        this.whatsAppQR = null;
      }
      this.requestUpdate();
    });

    // Fetch current WhatsApp status on load
    try {
      const res = await this.ws.request('whatsapp.getStatus');
      this.whatsAppStatus = res.status;
      this.whatsAppQR = res.qr ?? null;
      if (res.status === 'connected') this.whatsAppUser = res.user ?? null;
    } catch { /* WhatsApp adapter may not be running */ }

    // Load whitelist
    try {
      const res = await this.ws.request('creds.get', { key: 'whatsapp.whitelist' });
      if (res?.value) {
        const v = res.value;
        this.whatsAppWhitelist = Array.isArray(v) ? v.join('\n') : String(v).replace(/,/g, '\n');
      }
    } catch { /* not set yet */ }

    // Load Google Drive status
    try {
      const res = await this.ws.request('googledrive.getStatus');
      this.driveAuthorized = res.authorized;
    } catch { /* not available */ }

    // Listen for OAuth completion event (the HTTP callback emits it)
    this.ws.on('googledrive.auth_complete', () => {
      this.driveAuthorized  = true;
      this.driveAuthWaiting = false;
      this.driveAuthUrl     = null;
      this.driveAuthError   = '';
      this.requestUpdate();
    });
  }

  async loadSavedKeys() {
    try {
      const rows: any[] = await this.ws.request('creds.list');
      this.savedKeys = rows.map(r => r.key);
      const botsRow = rows.find(r => r.key === 'telegram.bots');
      if (botsRow && botsRow.valueDecrypted) {
        try {
          const val = botsRow.valueDecrypted;
          // If it was double-serialized as string, parse it again. Otherwise use it.
          const parsed = typeof val === 'string' ? JSON.parse(val) : val;
          this.telegramBots = Array.isArray(parsed) ? parsed : [];
        } catch {
          this.telegramBots = [];
        }
      } else {
        this.telegramBots = [];
      }

      const webhookRow = rows.find(r => r.key === 'webhooks.configs');
      if (webhookRow && webhookRow.valueDecrypted) {
        try {
          const val = webhookRow.valueDecrypted;
          const parsed = typeof val === 'string' ? JSON.parse(val) : val;
          this.webhookConfigs = Array.isArray(parsed) ? parsed : [];
        } catch {
          this.webhookConfigs = [];
        }
      } else {
        this.webhookConfigs = [];
      }

      const printerRow = rows.find(r => r.key === 'printer.default_name');
      if (printerRow && printerRow.valueDecrypted !== undefined && printerRow.valueDecrypted !== null) {
        this.printerDefaultName = String(printerRow.valueDecrypted);
      } else {
        this.printerDefaultName = '';
      }
    } catch { /* ok */ }
  }

  async saveToken(connector: Connector) {
    this.saving = { ...this.saving, [connector.id]: true };
    this.error = { ...this.error, [connector.id]: '' };
    this.saved = { ...this.saved, [connector.id]: false };
    try {
      const value = this.tokens[connector.id]?.trim();
      if (!value) { this.error = { ...this.error, [connector.id]: 'Enter a value.' }; return; }
      await this.ws.request('creds.set', { key: connector.credKey, value });
      this.saved = { ...this.saved, [connector.id]: true };
      await this.loadSavedKeys();
      setTimeout(() => { this.saved = { ...this.saved, [connector.id]: false }; }, 3000);
    } catch (e: any) {
      this.error = { ...this.error, [connector.id]: e?.message ?? 'Error saving.' };
    } finally {
      this.saving = { ...this.saving, [connector.id]: false };
    }
  }

  render() {
    return html`
      <header>
        <h2>Connections</h2>
      </header>
      <div class="grid">
        ${CONNECTORS.map(c => html`
          <div class="card">
            <div class="card-header">
              <span class="icon">${msi(c.icon)}</span>
              <span class="card-title">${c.name}</span>
              <span class="status-badge ${this._isConfigured(c) ? 'connected' : 'disconnected'}">
                ${this._isConfigured(c) ? 'CONFIGURED' : 'MISSING'}
              </span>
            </div>
            <div class="hint">${c.hint}</div>
            <hr class="divider" />
            
            ${c.type === 'token'       ? this.renderTokenForm(c)       : ''}
            ${c.type === 'apppassword' ? this.renderAppPasswordForm(c) : ''}
            ${c.type === 'oauth'       ? this.renderOAuthButton(c)     : ''}
            ${c.type === 'device'      ? this.renderDeviceButton(c)    : ''}
            ${c.type === 'whatsapp'    ? this.renderWhatsAppForm(c)    : ''}
            ${c.type === 'googledrive' ? this.renderGoogleDriveForm(c) : ''}
            ${c.type === 'spotify'     ? this.renderSpotifyForm(c)     : ''}
            ${c.type === 'webhooks'    ? this.renderWebhookForm(c)     : ''}
            ${c.type === 'tavily'     ? this.renderTavilyForm(c)     : ''}
            ${c.type === 'printer'    ? this.renderPrinterForm(c)    : ''}
            
            ${this.saved[c.id] ? html`<div class="success">${msi(ICONS.check)} Saved successfully</div>` : ''}
            ${this.error[c.id] ? html`<div class="err">${msi(ICONS.cross)} ${this.error[c.id]}</div>` : ''}
          </div>
        `)}
      </div>
    `;
  }

  private renderTokenForm(c: Connector) {
    if (c.id === 'telegram') {
      return html`
         <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
            ${this.telegramBots.map((b: any, index: number) => {
        if (this.editingBotIndex === index) {
          return html`
                <div style="background: #222; padding: 0.75rem; border-radius: 6px; border: 1px solid #6366f1; display: flex; flex-direction: column; gap: 0.5rem;">
                  <input type="text" placeholder="ID" .value=${this.editingBotData.id} @input=${(e: any) => this.editingBotData.id = e.target.value} />
                  <input type="text" placeholder="Name" .value=${this.editingBotData.name} @input=${(e: any) => this.editingBotData.name = e.target.value} />
                  <input type="password" placeholder="Token" .value=${this.editingBotData.token} @input=${(e: any) => this.editingBotData.token = e.target.value} />
                  <input type="text" placeholder="Whitelist" .value=${this.editingBotData.whitelist} @input=${(e: any) => this.editingBotData.whitelist = e.target.value} />
                  <div class="row">
                    <button @click=${() => {
              const next = [...this.telegramBots];
              next[index] = { ...this.editingBotData };
              this.saveTelegramBots(next);
              this.editingBotIndex = null;
              this.editingBotData = null;
            }}>Save Changes</button>
                    <button class="secondary" @click=${() => { this.editingBotIndex = null; this.editingBotData = null; }}>Cancel</button>
                  </div>
                </div>
              `;
        }
        return html`
              <div style="background: #111; padding: 0.75rem; border-radius: 6px; border: 1px solid #333; display: flex; flex-direction: column; gap: 0.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <strong>${b.name}</strong> <span style="font-size: 0.8rem; color: #888;">ID: ${b.id}</span>
                </div>
                <div style="font-size: 0.8rem; color: #aaa;">
                  Whitelist: ${b.whitelist || 'None (All allowed)'}
                </div>
                <div class="row">
                  <button class="secondary" @click=${() => this.testConnector(c, b.id)} ?disabled=${this.testing[c.id + b.id]}>
                    ${this.testing[c.id + b.id] ? html`${msi(ICONS.hourglass)}...` : html`${msi(ICONS.plug)} Test`}
                  </button>
                  <button class="secondary" @click=${() => {
            this.editingBotIndex = index;
            this.editingBotData = { ...b };
          }}>Edit</button>
                  <button class="secondary" @click=${() => {
            const next = [...this.telegramBots];
            next.splice(index, 1);
            this.saveTelegramBots(next);
          }} style="color: #f87171; border-color: #4d0a0a;">Remove</button>
                </div>
                ${this.testResult[c.id + b.id]?.message ? html`
                  <div class="test-result ${this.testResult[c.id + b.id].ok ? 'test-ok' : 'test-fail'}">
                    ${this.testResult[c.id + b.id].message}
                  </div>
                ` : ''}
              </div>
            `;
      })}
           
           ${!this.showNewBotForm ? html`
             <button class="secondary" @click=${() => this.showNewBotForm = true}>+ Add Telegram Bot</button>
           ` : html`
             <div style="background: #222; padding: 0.75rem; border-radius: 6px; border: 1px dashed #444; display: flex; flex-direction: column; gap: 0.5rem;">
               <input type="text" placeholder="ID (e.g.: my_bot_1)" .value=${this.newBot.id} @input=${(e: any) => this.newBot.id = e.target.value} />
               <input type="text" placeholder="Bot Name (e.g.: Assistant)" .value=${this.newBot.name} @input=${(e: any) => this.newBot.name = e.target.value} />
               <input type="password" placeholder="Token from @BotFather" .value=${this.newBot.token} @input=${(e: any) => this.newBot.token = e.target.value} />
               <input type="text" placeholder="Whitelist USER IDs (comma-separated, empty=all)" .value=${this.newBot.whitelist} @input=${(e: any) => this.newBot.whitelist = e.target.value} />
               <div class="row">
                 <button @click=${() => {
            if (!this.newBot.id || !this.newBot.token) { alert('ID and Token are required'); return; }
            const next = [...this.telegramBots, { ...this.newBot }];
            this.saveTelegramBots(next);
            this.showNewBotForm = false;
            this.newBot = { id: '', name: '', token: '', whitelist: '' };
          }}>Save Bot</button>
                 <button class="secondary" @click=${() => this.showNewBotForm = false}>Cancel</button>
               </div>
             </div>
           `}
         </div>
       `;
    }

    return html`
      <div class="row">
        <input
          type="password"
          placeholder="${c.placeholder}"
          .value=${this.tokens[c.id] ?? ''}
          @input=${(e: any) => { this.tokens = { ...this.tokens, [c.id]: e.target.value }; }}
          @keydown=${(e: any) => e.key === 'Enter' && this.saveToken(c)}
        />
        <button @click=${() => this.saveToken(c)} ?disabled=${this.saving[c.id]}>
          ${this.saving[c.id] ? html`${msi(ICONS.save)} Saving...` : 'Save'}
        </button>
      </div>
    `;
  }

  async saveTelegramBots(bots: any[]) {
    try {
      // Don't JSON.stringify here, the backend handles it.
      await this.ws.request('creds.set', { key: 'telegram.bots', value: bots });
      await this.loadSavedKeys();
    } catch (e) {
      alert('Error saving bots: ' + e);
    }
  }

  async testConnector(connector: Connector, botId?: string) {
    const testKey = botId ? connector.id + botId : connector.id;
    this.testing = { ...this.testing, [testKey]: true };
    this.testResult = { ...this.testResult, [testKey]: { ok: false, message: '' } };
    try {
      const payload: any = { connector: connector.id };
      if (botId) payload.botId = botId;
      const res = await this.ws.request('creds.test', payload);
      if (res.ok) {
        let msg = 'Connection successful!';
        if (res.bot) msg += `\nBot: @${res.bot.username} - ${res.bot.first_name}`;
        else if (res.message) msg += `\n${res.message}`;
        this.testResult = { ...this.testResult, [testKey]: { ok: true, message: msg } };
      } else {
        this.testResult = { ...this.testResult, [testKey]: { ok: false, message: res.message ?? 'Test failed' } };
      }
    } catch (e: any) {
      const msg = e?.message ?? JSON.stringify(e) ?? 'Unknown error';
      this.testResult = { ...this.testResult, [testKey]: { ok: false, message: msg } };
    } finally {
      this.testing = { ...this.testing, [testKey]: false };
    }
  }

  private _isConfigured(c: Connector): boolean {
    if (c.id === 'gmail') {
      return this.savedKeys.includes('google.email') && this.savedKeys.includes('google.app_password');
    }
    if (c.id === 'whatsapp') {
      return this.whatsAppStatus === 'connected';
    }
    if (c.id === 'googledrive') {
      return this.driveAuthorized;
    }
    if (c.id === 'spotify') {
      return this.savedKeys.includes('spotify.client_id') && this.savedKeys.includes('spotify.client_secret');
    }
    if (c.id === 'webhooks') {
      return this.webhookConfigs.length > 0;
    }
    if (c.id === 'printer') {
      return this.savedKeys.includes('printer.default_name');
    }
    return this.savedKeys.some(k => k === c.credKey || k.startsWith(c.credKey));
  }

  private renderWebhookForm(_c: Connector) {
    return html`
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        ${this.webhookConfigs.map((hook: any, index: number) => html`
          <div style="background: #111; padding: 0.75rem; border-radius: 6px; border: 1px solid #333; display: flex; flex-direction: column; gap: 0.4rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>${hook.name || hook.id}</strong>
              <span style="font-size: 0.75rem; color: #888;">${hook.method}</span>
            </div>
            <div style="font-size: 0.78rem; color: #aaa; word-break: break-all;">${hook.url}</div>
            <div style="font-size: 0.75rem; color: #666;">ID: ${hook.id}</div>
            ${hook.bodyTemplate !== undefined ? html`<div style="font-size: 0.75rem; color: #8b9bb5;">Body template: configured</div>` : ''}
            <div class="row">
              <button class="secondary" @click=${() => this.removeWebhook(index)}>Remove</button>
            </div>
          </div>
        `)}

        ${!this.showNewWebhookForm ? html`
          <button class="secondary" @click=${() => this.showNewWebhookForm = true}>+ Add Webhook</button>
        ` : html`
          <div style="background: #222; padding: 0.75rem; border-radius: 6px; border: 1px dashed #444; display: flex; flex-direction: column; gap: 0.5rem;">
            <input type="text" placeholder="ID (e.g.: crm_create_lead)" .value=${this.newWebhook.id} @input=${(e: any) => this.newWebhook.id = e.target.value} />
            <input type="text" placeholder="Name (e.g.: CRM Create Lead)" .value=${this.newWebhook.name} @input=${(e: any) => this.newWebhook.name = e.target.value} />
            <input type="text" placeholder="URL (e.g.: https://example.com/webhook)" .value=${this.newWebhook.url} @input=${(e: any) => this.newWebhook.url = e.target.value} />
            <select style="background:#111; border:1px solid #444; border-radius:6px; color:#eee; padding:0.5rem 0.75rem;" .value=${this.newWebhook.method} @change=${(e: any) => this.newWebhook.method = e.target.value}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <input type="password" placeholder="API Key" .value=${this.newWebhook.apiKey} @input=${(e: any) => this.newWebhook.apiKey = e.target.value} />
            <textarea
              rows="5"
              placeholder='Body JSON template (optional) e.g.: {"type":"lead","source":"9lives"}'
              style="background:#111; border:1px solid #444; border-radius:6px; color:#eee; padding:0.5rem 0.75rem; font-size:0.82rem; font-family:monospace; resize:vertical; width:100%; box-sizing:border-box;"
              .value=${this.newWebhook.bodyTemplate}
              @input=${(e: any) => this.newWebhook.bodyTemplate = e.target.value}
            ></textarea>
            <div class="row">
              <button @click=${() => this.addWebhook()}>Save Webhook</button>
              <button class="secondary" @click=${() => this.showNewWebhookForm = false}>Cancel</button>
            </div>
          </div>
        `}
      </div>
    `;
  }

  async savePrinterConfig(c: Connector) {
    this.saving = { ...this.saving, [c.id]: true };
    this.error = { ...this.error, [c.id]: '' };
    this.saved = { ...this.saved, [c.id]: false };
    try {
      await this.ws.request('creds.set', { key: 'printer.default_name', value: this.printerDefaultName.trim() });
      this.saved = { ...this.saved, [c.id]: true };
      await this.loadSavedKeys();
      setTimeout(() => { this.saved = { ...this.saved, [c.id]: false }; }, 3000);
    } catch (e: any) {
      this.error = { ...this.error, [c.id]: e?.message ?? 'Error saving.' };
    } finally {
      this.saving = { ...this.saving, [c.id]: false };
    }
  }

  private renderPrinterForm(c: Connector) {
    return html`
      <div style="display: flex; flex-direction: column; gap: 0.6rem;">
        <input
          type="text"
          placeholder="Default printer name (optional)"
          .value=${this.printerDefaultName}
          @input=${(e: any) => { this.printerDefaultName = e.target.value; }}
          @keydown=${(e: any) => e.key === 'Enter' && this.savePrinterConfig(c)}
        />
        <div class="row">
          <button @click=${() => this.savePrinterConfig(c)} ?disabled=${this.saving[c.id]}>
            ${this.saving[c.id] ? html`${msi(ICONS.save)} Saving...` : 'Save'}
          </button>
          <button class="secondary" @click=${() => this.testConnector(c)} ?disabled=${this.testing[c.id]}>
            ${this.testing[c.id] ? html`${msi(ICONS.hourglass)}...` : html`${msi(ICONS.plug)} Test Printer`}
          </button>
        </div>
        ${this.testResult[c.id]?.message ? html`
          <div class="test-result ${this.testResult[c.id].ok ? 'test-ok' : 'test-fail'}">
            ${this.testResult[c.id].message}
          </div>
        ` : ''}
        <div class="hint">
          If you leave it empty, the default system printer will be used.
        </div>
      </div>
    `;
  }

  async saveWebhookConfigs(next: any[]) {
    try {
      await this.ws.request('creds.set', { key: 'webhooks.configs', value: next });
      this.webhookConfigs = next;
      await this.loadSavedKeys();
    } catch (e) {
      alert('Error saving webhooks: ' + e);
    }
  }

  async addWebhook() {
    const hook = {
      id: this.newWebhook.id.trim(),
      name: this.newWebhook.name.trim(),
      url: this.newWebhook.url.trim(),
      method: this.newWebhook.method,
      apiKey: this.newWebhook.apiKey.trim(),
      bodyTemplate: this.newWebhook.bodyTemplate.trim()
    };

    if (!hook.id || !hook.url || !hook.method || !hook.apiKey) {
      alert('ID, URL, method and API key are required');
      return;
    }

    let parsedBodyTemplate: any = undefined;
    if (hook.bodyTemplate) {
      try {
        parsedBodyTemplate = JSON.parse(hook.bodyTemplate);
      } catch {
        alert('Body JSON is not valid. Please correct the JSON template.');
        return;
      }
    }

    const normalizedHook = {
      id: hook.id,
      name: hook.name,
      url: hook.url,
      method: hook.method,
      apiKey: hook.apiKey,
      ...(parsedBodyTemplate !== undefined ? { bodyTemplate: parsedBodyTemplate } : {})
    };

    const next = [...this.webhookConfigs.filter((item: any) => item.id !== normalizedHook.id), normalizedHook];
    await this.saveWebhookConfigs(next);
    this.showNewWebhookForm = false;
    this.newWebhook = { id: '', name: '', url: '', method: 'POST', apiKey: '', bodyTemplate: '' };
  }
  async removeWebhook(index: number) {
    const next = [...this.webhookConfigs];
    next.splice(index, 1);
    await this.saveWebhookConfigs(next);
  }

  private renderSpotifyForm(c: Connector) {
    return html`
      <div style="display: flex; flex-direction: column; gap: 0.6rem;">
        <input
          type="text"
          placeholder="Spotify Client ID"
          .value=${this.spotifyClientId}
          @input=${(e: any) => { this.spotifyClientId = e.target.value; }}
        />
        <input
          type="password"
          placeholder="Spotify Client Secret"
          .value=${this.spotifyClientSecret}
          @input=${(e: any) => { this.spotifyClientSecret = e.target.value; }}
          @keydown=${(e: any) => e.key === 'Enter' && this.saveSpotifyCreds(c)}
        />
        <div class="row">
          <button @click=${() => this.saveSpotifyCreds(c)} ?disabled=${this.saving[c.id]}>
            ${this.saving[c.id] ? 'Saving...' : 'Save'}
          </button>
          <button class="secondary" @click=${() => this.testConnector(c)} ?disabled=${this.testing[c.id]}>
            ${this.testing[c.id] ? '...' : 'Test Connection'}
          </button>
        </div>
        <div class="hint" style="margin-top: 0.25rem;">
          Create an app on Spotify Developer Dashboard and copy the Client ID and Client Secret.
        </div>
      </div>
    `;
  }

  async saveSpotifyCreds(c: Connector) {
    this.saving = { ...this.saving, [c.id]: true };
    this.error  = { ...this.error,  [c.id]: '' };
    this.saved  = { ...this.saved,  [c.id]: false };
    try {
      const clientId = this.spotifyClientId.trim();
      const clientSecret = this.spotifyClientSecret.trim();
      if (!clientId) { this.error = { ...this.error, [c.id]: 'Please enter the Spotify Client ID.' }; return; }
      if (!clientSecret) { this.error = { ...this.error, [c.id]: 'Please enter the Spotify Client Secret.' }; return; }
      await this.ws.request('creds.set', { key: 'spotify.client_id', value: clientId });
      await this.ws.request('creds.set', { key: 'spotify.client_secret', value: clientSecret });
      this.saved = { ...this.saved, [c.id]: true };
      await this.loadSavedKeys();
      setTimeout(() => { this.saved = { ...this.saved, [c.id]: false }; }, 3000);
    } catch (e: any) {
      this.error = { ...this.error, [c.id]: e?.message ?? 'Error saving.' };
    } finally {
      this.saving = { ...this.saving, [c.id]: false };
    }
  }

  private renderTavilyForm(c: Connector) {
    return html`
      <div style="display: flex; flex-direction: column; gap: 0.6rem;">
        <input
          type="password"
          placeholder="${c.placeholder}"
          .value=${this.tavilyApiKey}
          @input=${(e: any) => { this.tavilyApiKey = e.target.value; }}
          @keydown=${(e: any) => e.key === 'Enter' && this.saveTavilyCreds(c)}
        />
        <div class="row">
          <button @click=${() => this.saveTavilyCreds(c)} ?disabled=${this.saving[c.id]}>
            ${this.saving[c.id] ? 'Saving...' : 'Save'}
          </button>
          <button class="secondary" @click=${() => this.testConnector(c)} ?disabled=${this.testing[c.id]}>
            ${this.testing[c.id] ? '...' : 'Test Connection'}
          </button>
        </div>
        ${this.saved[c.id] ? html`<div class="success">${msi(ICONS.check)} API key Tavily saved successfully</div>` : ''}
        ${this.error[c.id] ? html`<div class="err">${msi(ICONS.cross)} ${this.error[c.id]}</div>` : ''}
        ${this.testResult[c.id]?.message ? html`
          <div class="test-result ${this.testResult[c.id].ok ? 'test-ok' : 'test-fail'}">
            ${this.testResult[c.id].message}
          </div>
        ` : ''}
        <div class="hint" style="margin-top: 0.25rem;">
          Obtain the API key from <strong>app.tavily.com</strong> &rarr; API Keys.
        </div>
      </div>
    `;
  }

  async saveTavilyCreds(c: Connector) {
    this.saving = { ...this.saving, [c.id]: true };
    this.error  = { ...this.error,  [c.id]: '' };
    this.saved  = { ...this.saved,  [c.id]: false };
    try {
      const apiKey = this.tavilyApiKey.trim();
      if (!apiKey) { this.error = { ...this.error, [c.id]: 'Please enter the Tavily API key.' }; return; }
      await this.ws.request('creds.set', { key: 'tavily.api_key', value: apiKey });
      this.saved = { ...this.saved, [c.id]: true };
      await this.loadSavedKeys();
      setTimeout(() => { this.saved = { ...this.saved, [c.id]: false }; }, 3000);
    } catch (e: any) {
      this.error = { ...this.error, [c.id]: e?.message ?? 'Error saving.' };
    } finally {
      this.saving = { ...this.saving, [c.id]: false };
    }
  }

  private renderAppPasswordForm(c: Connector) {
    return html`
      <div style="display: flex; flex-direction: column; gap: 0.6rem;">
        <input
          type="email"
          placeholder="Your Gmail address (e.g.: mario@gmail.com)"
          .value=${this.gmailEmail}
          @input=${(e: any) => { this.gmailEmail = e.target.value; }}
        />
        <input
          type="password"
          placeholder="App Password (16 characters, no spaces)"
          .value=${this.gmailAppPassword}
          @input=${(e: any) => { this.gmailAppPassword = e.target.value; }}
          @keydown=${(e: any) => e.key === 'Enter' && this.saveGmailCreds(c)}
        />
        <div class="row">
          <button @click=${() => this.saveGmailCreds(c)} ?disabled=${this.saving[c.id]}>
            ${this.saving[c.id] ? html`${msi(ICONS.save)} Saving...` : 'Save'}
          </button>
          <button class="secondary" @click=${() => this.testConnector(c)} ?disabled=${this.testing[c.id]}>
            ${this.testing[c.id] ? html`${msi(ICONS.hourglass)}...` : html`${msi(ICONS.plug)} Test Connection`}
          </button>
        </div>
        ${this.saved[c.id]  ? html`<div class="success">${msi(ICONS.check)} Gmail credentials saved successfully</div>` : ''}
        ${this.error[c.id]  ? html`<div class="err">${msi(ICONS.cross)} ${this.error[c.id]}</div>` : ''}
        ${this.testResult[c.id]?.message ? html`
          <div class="test-result ${this.testResult[c.id].ok ? 'test-ok' : 'test-fail'}">
            ${this.testResult[c.id].message}
          </div>
        ` : ''}
        <div class="hint" style="margin-top: 0.25rem;">
          How to get the App Password: Google account &rarr; Security &rarr; 2-Step Verification &rarr; App Password
        </div>
      </div>
    `;
  }

  async saveGmailCreds(c: Connector) {
    this.saving = { ...this.saving, [c.id]: true };
    this.error  = { ...this.error,  [c.id]: '' };
    this.saved  = { ...this.saved,  [c.id]: false };
    try {
      const email    = this.gmailEmail.trim();
      const password = this.gmailAppPassword.replace(/\s/g, ''); // rimuovi eventuali spazi
      if (!email)    { this.error = { ...this.error, [c.id]: 'Please enter your Gmail address.' }; return; }
      if (!password) { this.error = { ...this.error, [c.id]: 'Please enter the App Password.' }; return; }
      await this.ws.request('creds.set', { key: 'google.email',        value: email });
      await this.ws.request('creds.set', { key: 'google.app_password', value: password });
      this.saved = { ...this.saved, [c.id]: true };
      await this.loadSavedKeys();
      setTimeout(() => { this.saved = { ...this.saved, [c.id]: false }; }, 3000);
    } catch (e: any) {
      this.error = { ...this.error, [c.id]: e?.message ?? 'Error saving.' };
    } finally {
      this.saving = { ...this.saving, [c.id]: false };
    }
  }

  private renderOAuthButton(_c: Connector) {
    return html`
      <div class="row">
        <button @click=${() => window.open('/oauth/google/start', '_blank')}>
          Access with Google
        </button>
      </div>
    `;
  }

  private renderDeviceButton(_c: Connector) {
    return html`
      <div class="row">
        <button class="secondary" @click=${() => alert('Use the whatsapp type for QR code configuration.')}>
          Mostra QR
        </button>
      </div>
    `;
  }

  async startDriveAuth() {
    this.driveAuthError   = '';
    this.driveAuthUrl     = null;
    this.driveAuthWaiting = false;
    if (!this.driveClientId.trim() || !this.driveClientSecret.trim()) {
      this.driveAuthError = 'Please enter Client ID and Client Secret.';
      return;
    }
    try {
      const res = await this.ws.request('googledrive.startAuth', {
        clientId:     this.driveClientId.trim(),
        clientSecret: this.driveClientSecret.trim(),
      });
      this.driveAuthUrl     = res.authUrl;
      this.driveAuthWaiting = true;
      window.open(res.authUrl, '_blank');
    } catch (e: any) {
      this.driveAuthError = e?.message ?? 'Errore avvio autorizzazione.';
    }
  }

  async revokeDriveAuth() {
    if (!confirm('Remove Google Drive authorization?')) return;
    try {
      await this.ws.request('googledrive.revokeAuth');
      this.driveAuthorized  = false;
      this.driveAuthUrl     = null;
      this.driveAuthWaiting = false;
    } catch (e: any) {
      alert('Errore: ' + (e?.message ?? e));
    }
  }

  private renderGoogleDriveForm(_c: Connector) {
    return html`
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">

        ${this.driveAuthorized ? html`
          <div style="color: #34d399; font-size: 0.95rem; font-weight: 600; text-align: center;">
            ${msi(ICONS.check)} Google Drive autorizzato
          </div>
          <button class="secondary" style="color: #f87171; border-color: #4d0a0a;"
            @click=${() => this.revokeDriveAuth()}>
            Revoke Authorization
          </button>

        ` : this.driveAuthWaiting ? html`
          <div style="color: #f59e0b; font-size: 0.85rem; text-align: center; line-height: 1.5;">
            ${msi(ICONS.hourglass)} In attesa di autorizzazione nel browser...<br/>
            <span style="font-size: 0.78rem; color: #888;">Dopo aver autorizzato su Google, questa pagina si aggiornerà automaticamente.</span>
          </div>
          <button class="secondary" @click=${() => window.open(this.driveAuthUrl!, '_blank')}>
            Riapri finestra di autorizzazione
          </button>

        ` : html`
          <div style="font-size: 0.82rem; color: #888; line-height: 1.5;">
            Credentials of type <strong style="color:#aaa">App desktop</strong> from Google Cloud Console.
          </div>
          <input
            type="text"
            placeholder="Client ID (es: 123456-abc.apps.googleusercontent.com)"
            .value=${this.driveClientId}
            @input=${(e: any) => { this.driveClientId = e.target.value; }}
          />
          <input
            type="password"
            placeholder="Client Secret"
            .value=${this.driveClientSecret}
            @input=${(e: any) => { this.driveClientSecret = e.target.value; }}
          />
          <button @click=${() => this.startDriveAuth()}>
            ${msi(ICONS.key)} Authorize Google Drive
          </button>
          ${this.driveAuthError ? html`<div class="err">${msi(ICONS.cross)} ${this.driveAuthError}</div>` : ''}

          <details style="margin-top: 0.25rem;">
            <summary style="font-size: 0.78rem; color: #666; cursor: pointer;">How to get Client ID and Secret ${msi(ICONS.caret)}</summary>
            <ol style="font-size: 0.78rem; color: #888; line-height: 1.8; margin: 0.5rem 0 0 1rem; padding: 0;">
              <li>Vai su <a href="https://console.cloud.google.com" target="_blank" style="color:#6366f1">console.cloud.google.com</a></li>
              <li>Crea un nuovo progetto (o selezionane uno esistente)</li>
              <li><strong>API e servizi &rarr; Libreria</strong> &rarr; cerca "Google Drive API" &rarr; Abilita</li>
              <li><strong>APIs & Services &rarr; Credentials</strong> &rarr; Create credentials &rarr; OAuth client ID</li>
              <li>Tipo applicazione: <strong>App desktop</strong> &rarr; copia Client ID e Client Secret</li>
              <li><strong>Schermata consenso OAuth</strong>: aggiungi la tua email come utente di test</li>
              <li>Add <code>http://localhost:18789</code> as authorized redirect URI (if required)</li>
            </ol>
          </details>
        `}
      </div>
    `;
  }

  async saveWhatsAppWhitelist() {
    this.whatsAppWhitelistSaving = true;
    this.whatsAppWhitelistSaved  = false;
    try {
      // Normalizza: rimuovi righe vuote, salva come stringa separata da virgola
      const nums = this.whatsAppWhitelist
        .split(/[\n,]+/)
        .map(n => n.trim().replace(/\s/g, ''))
        .filter(n => n.length > 0);
      await this.ws.request('creds.set', { key: 'whatsapp.whitelist', value: nums.join(',') });
      this.whatsAppWhitelistSaved = true;
      setTimeout(() => { this.whatsAppWhitelistSaved = false; }, 3000);
    } catch (e: any) {
      alert('Error saving whitelist: ' + (e?.message ?? e));
    } finally {
      this.whatsAppWhitelistSaving = false;
    }
  }

  private renderWhatsAppForm(c: Connector) {
    const whitelistCount = this.whatsAppWhitelist
      .split(/[\n,]+/).map(n => n.trim()).filter(n => n.length > 0).length;

    return html`
      <div style="display: flex; flex-direction: column; gap: 0.75rem; align-items: center; text-align: center;">

        ${this.whatsAppStatus === 'connected' ? html`
          <div style="color: #34d399; font-size: 0.95rem; font-weight: 600;">
            ${msi(ICONS.check)} Connesso${this.whatsAppUser ? html` come <code style="font-size:0.8rem">${this.whatsAppUser}</code>` : ''}
          </div>
          <button class="secondary" @click=${() => this.testConnector(c)} ?disabled=${this.testing[c.id]}>
            ${this.testing[c.id] ? html`${msi(ICONS.hourglass)}...` : html`${msi(ICONS.plug)} Test Connection`}
          </button>

        ` : this.whatsAppStatus === 'qr' && this.whatsAppQR ? html`
          <div style="font-size: 0.82rem; color: #aaa;">
            Apri WhatsApp &rarr; ${msi(ICONS.menu)} &rarr; Dispositivi Collegati &rarr; Collega un dispositivo
          </div>
          <img
            src="${this.whatsAppQR}"
            alt="QR WhatsApp"
            style="width: 200px; height: 200px; border-radius: 8px; background: #fff; padding: 6px;"
          />
          <div style="font-size: 0.75rem; color: #666;">
            The QR code updates automatically every ~20 seconds
          </div>

        ` : this.whatsAppStatus === 'connecting' ? html`
          <div style="color: #f59e0b; font-size: 0.9rem;">${msi(ICONS.hourglass)} Connection in progress...</div>

        ` : html`
          <div style="color: #888; font-size: 0.85rem;">
            WhatsApp not connected.<br/>
            Make sure the gateway is started with <code>WHATSAPP_ENABLED=true</code>.
          </div>
        `}

        ${this.testResult[c.id]?.message ? html`
          <div class="test-result ${this.testResult[c.id].ok ? 'test-ok' : 'test-fail'}" style="width: 100%; box-sizing: border-box;">
            ${this.testResult[c.id].message}
          </div>
        ` : ''}
      </div>

      <hr class="divider" style="margin-top: 0.5rem;" />

      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.85rem; font-weight: 600; color: #ccc;">
            Number Whitelist
          </span>
          ${whitelistCount > 0
            ? html`<span style="font-size: 0.75rem; color: #6366f1;">${whitelistCount} number(s) configured</span>`
            : html`<span style="font-size: 0.75rem; color: #f87171;">${msi(ICONS.warning)} No restrictions - replies to everyone</span>`
          }
        </div>
        <textarea
          rows="4"
          placeholder="Enter one number per line with international prefix:&#10;393312345678&#10;393398765432&#10;&#10;Leave empty = replies to everyone"
          style="background:#111; border:1px solid #444; border-radius:6px; color:#eee; padding:0.5rem 0.75rem; font-size:0.82rem; font-family:monospace; resize:vertical; width:100%; box-sizing:border-box;"
          .value=${this.whatsAppWhitelist}
          @input=${(e: any) => { this.whatsAppWhitelist = e.target.value; }}
        ></textarea>
        <div class="row">
          <button @click=${() => this.saveWhatsAppWhitelist()} ?disabled=${this.whatsAppWhitelistSaving}>
            ${this.whatsAppWhitelistSaving ? html`${msi(ICONS.save)} Saving...` : 'Save Whitelist'}
          </button>
        </div>
        ${this.whatsAppWhitelistSaved ? html`<div class="success">${msi(ICONS.check)} Whitelist saved</div>` : ''}
        <div class="hint">
          Numbers with international prefix without + (es: <code>393312345678</code> per +39 331 234 5678).<br/>
          The numbers not in the list are silently ignored.
        </div>
      </div>
    `;
  }
}




