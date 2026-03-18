// Copyright (c) 2026 Flavio Cerato
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { iconStyles } from '../icons.js';

interface PendingFile {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

@customElement('chat-view')
export class ChatView extends LitElement {
  @property({ type: Object }) ws: any;
  @state() private messages: Array<{ role: string, text: string, sessionKey?: string, attachments?: PendingFile[] }> = [];
  @state() private userInput = '';
  @state() private lives: any[] = [];
  @state() private selectedLiveId = '';
  @state() private loading = false;
  @state() private pendingFiles: PendingFile[] = [];
  private sessionKeys = new Map<string, string>();

  static styles = [iconStyles, css`
    :host { display: flex; flex-direction: column; height: 100%; gap: 1rem; }

    .header { display: flex; align-items: center; gap: 1rem; }
    select {
      background: #1e1e2e;
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      color: #eee;
      padding: 0.5rem;
      font-size: 0.9rem;
      outline: none;
    }

    .chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      overflow: hidden;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .message {
      max-width: 80%;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      font-size: 0.95rem;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .user {
      align-self: flex-end;
      background: #6366f1;
      color: #fff;
      border-bottom-right-radius: 2px;
    }

    .assistant {
      align-self: flex-start;
      background: #2a2a4a;
      color: #eee;
      border-bottom-left-radius: 2px;
    }

    .msg-attachments {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }
    .msg-attachments img {
      max-width: 200px;
      max-height: 150px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.15);
    }
    .msg-attachment-file {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      background: rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 0.3rem 0.6rem;
      font-size: 0.8rem;
      color: #ccc;
    }

    .input-area {
      padding: 1rem;
      background: #13132a;
      border-top: 1px solid #2a2a4a;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .input-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    input[type="text"] {
      flex: 1;
      background: #0d0d17;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fff;
      padding: 0.75rem 1rem;
      font-size: 0.95rem;
      outline: none;
    }
    input[type="text"]:focus { border-color: #6366f1; }

    input[type="file"] { display: none; }

    .btn-attach {
      background: #2a2a4a;
      border: 1px solid #3a3a5a;
      border-radius: 8px;
      color: #ccc;
      padding: 0.65rem 0.75rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.85rem;
      transition: background 0.2s;
    }
    .btn-attach:hover { background: #3a3a5a; color: #fff; }

    .btn-send {
      background: #6366f1;
      border: none;
      border-radius: 8px;
      color: #fff;
      padding: 0.75rem 1.25rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-send:disabled { opacity: 0.5; }

    button.secondary {
      background: #2a2a4a;
      border: 1px solid #3a3a5a;
      border-radius: 8px;
      color: #fff;
      padding: 0.75rem 1.25rem;
      font-weight: 600;
      cursor: pointer;
    }

    .pending-files {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding: 0 0.25rem;
    }
    .pending-file {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      background: #2a2a4a;
      border: 1px solid #3a3a5a;
      border-radius: 8px;
      padding: 0.3rem 0.5rem 0.3rem 0.3rem;
      font-size: 0.8rem;
      color: #ccc;
    }
    .pending-file img {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      object-fit: cover;
    }
    .pending-file .file-icon {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      background: #3a3a5a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      color: #999;
    }
    .pending-file .remove-file {
      cursor: pointer;
      color: #f87171;
      font-size: 1rem;
      line-height: 1;
      padding: 0 0.2rem;
    }
    .pending-file .remove-file:hover { color: #ff4444; }
  `];

  async firstUpdated() {
    await this.loadLives();

    this.ws.on('chat.delta', (data: any) => {
      this.handleDelta(data);
    });

    this.ws.on('chat.final', (data: any) => {
      this.loading = false;
      this.requestUpdate();
    });

    this.ws.on('chat.error', (data: any) => {
      this.messages = [...this.messages, { role: 'assistant', text: `Error: ${data.message}` }];
      this.loading = false;
    });

    if (this.selectedLiveId) {
      await this.loadHistory(this.selectedLiveId);
    }
  }

  async loadLives() {
    try {
      this.lives = await this.ws.request('live.list');
      if (this.lives.length > 0) {
        this.selectedLiveId = this.lives[0].id;
      }
    } catch (e) {
      console.error(e);
    }
  }

  private getSessionKey(liveId: string) {
    let sessionKey = this.sessionKeys.get(liveId);
    if (!sessionKey) {
      const storageKey = `9lives:chat-session:${liveId}`;
      sessionKey = localStorage.getItem(storageKey) || `ui:${liveId}:${crypto.randomUUID()}`;
      localStorage.setItem(storageKey, sessionKey);
      this.sessionKeys.set(liveId, sessionKey);
    }
    return sessionKey;
  }

  private async loadHistory(liveId: string) {
    const sessionKey = this.getSessionKey(liveId);
    try {
      const history = await this.ws.request('chat.history', {
        liveId,
        sessionKey,
        limit: 20
      });
      this.messages = (history || []).map((item: any) => ({
        role: item.role,
        text: item.content,
        sessionKey: item.sessionKey
      }));
    } catch (e) {
      console.error(e);
      this.messages = [];
    }
  }

  private async onLiveChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    this.selectedLiveId = target.value;
    this.loading = false;
    await this.loadHistory(this.selectedLiveId);
  }

  handleDelta(data: any) {
    const { sessionKey, delta } = data;
    const lastMsg = this.messages[this.messages.length - 1];

    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.sessionKey === sessionKey) {
      lastMsg.text += delta;
      this.requestUpdate();
    } else {
      this.messages = [...this.messages, { role: 'assistant', text: delta, sessionKey }];
    }

    // Auto-scroll
    setTimeout(() => {
      const el = this.shadowRoot?.querySelector('.messages');
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  private onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      // Max 10MB per file
      if (file.size > 10 * 1024 * 1024) {
        alert(`File "${file.name}" exceeds the 10MB limit`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        this.pendingFiles = [...this.pendingFiles, {
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: reader.result as string
        }];
      };
      reader.readAsDataURL(file);
    }
    // Reset input
    input.value = '';
  }

  private removePendingFile(index: number) {
    this.pendingFiles = this.pendingFiles.filter((_, i) => i !== index);
  }

  private triggerFileInput() {
    const input = this.shadowRoot?.querySelector('#file-input') as HTMLInputElement;
    if (input) input.click();
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  render() {
    return html`
      <div class="header">
        <label>Agent:</label>
        <select .value=${this.selectedLiveId} @change=${(e: Event) => this.onLiveChange(e)}>
          ${this.lives.map(l => html`<option value=${l.id}>${l.name}</option>`)}
        </select>
        <button class="secondary" @click=${() => this.clearMemory()} ?disabled=${this.loading || !this.selectedLiveId}>
          Clear Memory
        </button>
      </div>

      <div class="chat-container">
        <div class="messages">
          ${this.messages.map(m => html`
            <div class="message ${m.role}">
              ${m.text}
              ${m.attachments && m.attachments.length > 0 ? html`
                <div class="msg-attachments">
                  ${m.attachments.map(a =>
                    a.type.startsWith('image/')
                      ? html`<img src="${a.dataUrl}" alt="${a.name}" />`
                      : html`<span class="msg-attachment-file">${a.name} (${this.formatFileSize(a.size)})</span>`
                  )}
                </div>
              ` : ''}
            </div>
          `)}
        </div>

        <div class="input-area">
          ${this.pendingFiles.length > 0 ? html`
            <div class="pending-files">
              ${this.pendingFiles.map((f, i) => html`
                <div class="pending-file">
                  ${f.type.startsWith('image/')
                    ? html`<img src="${f.dataUrl}" />`
                    : html`<div class="file-icon">${f.name.split('.').pop()?.toUpperCase() || 'FILE'}</div>`
                  }
                  <span>${f.name} (${this.formatFileSize(f.size)})</span>
                  <span class="remove-file" @click=${() => this.removePendingFile(i)}>&times;</span>
                </div>
              `)}
            </div>
          ` : ''}

          <div class="input-row">
            <input type="file" id="file-input" multiple accept="image/*,.pdf,.txt,.csv,.json,.md,.doc,.docx,.xls,.xlsx,.tsv" @change=${(e: Event) => this.onFileSelect(e)} />
            <button class="btn-attach" @click=${() => this.triggerFileInput()} ?disabled=${this.loading} title="Attach file">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <input
              type="text"
              placeholder="Type a message..."
              .value=${this.userInput}
              @input=${(e: any) => this.userInput = e.target.value}
              @keydown=${(e: any) => e.key === 'Enter' && this.sendMessage()}
              ?disabled=${this.loading}
            />
            <button class="btn-send" @click=${() => this.sendMessage()} ?disabled=${this.loading || !this.selectedLiveId}>
              ${this.loading ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async sendMessage() {
    const hasText = this.userInput.trim().length > 0;
    const hasFiles = this.pendingFiles.length > 0;
    if ((!hasText && !hasFiles) || !this.selectedLiveId) return;

    const text = this.userInput;
    const files = [...this.pendingFiles];

    // Add user message to UI (with attachment previews)
    this.messages = [...this.messages, { role: 'user', text: text || `[${files.length} files attached]`, attachments: files.length > 0 ? files : undefined }];
    this.userInput = '';
    this.pendingFiles = [];
    this.loading = true;

    try {
      const sessionKey = this.getSessionKey(this.selectedLiveId);

      // Build attachments array for the gateway
      const attachments = files.map(f => ({
        fileName: f.name,
        mimeType: f.type,
        dataUrl: f.dataUrl,
        fileSize: f.size
      }));

      await this.ws.request('chat.send', {
        message: text,
        liveId: this.selectedLiveId,
        sessionKey,
        ...(attachments.length > 0 ? { attachments } : {})
      });
    } catch (err: any) {
      this.messages = [...this.messages, { role: 'assistant', text: `Error: ${err.message || err}` }];
      this.loading = false;
    }
  }

  async clearMemory() {
    if (!this.selectedLiveId || this.loading) return;

    try {
      const sessionKey = this.getSessionKey(this.selectedLiveId);
      await this.ws.request('chat.clear', {
        liveId: this.selectedLiveId,
        sessionKey
      });
      this.messages = [];
    } catch (err: any) {
      this.messages = [...this.messages, { role: 'assistant', text: `Error: ${err.message || err}` }];
    }
  }
}
