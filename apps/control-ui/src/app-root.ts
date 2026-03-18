// Copyright (c) 2026 Flavio Cerato
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { iconStyles, iconChat, iconBolt, iconGroup, iconBuild, iconHub, iconSettings } from './icons.js';
import { WsClient } from './wsClient.js';
import './views/chat-view.js';
import './views/lives-view.js';
import './views/crews-view.js';
import './views/skills-view.js';
import './views/connectors-view.js';
import './views/settings-view.js';

const TOKEN_KEY = '9lives_token';

@customElement('app-root')
export class AppRoot extends LitElement {
  @state() private currentView = 'chat';
  @state() private connected = false;
  @state() private connecting = false;
  @state() private connError = '';
  @state() private tokenInput = '';
  private ws!: WsClient;

  static styles = [iconStyles, css`
    :host { display: flex; flex-direction: column; height: 100vh; background: #0d0d17; color: #eee; font-family: 'Inter', system-ui, sans-serif; }

    .login-wrap { flex: 1; display: flex; align-items: center; justify-content: center; }
    .login-card { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 16px; padding: 2.5rem; width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 1.25rem; }
    .login-title { font-size: 1.6rem; font-weight: 700; text-align: center; }
    .login-title span { color: #6366f1; }
    .login-sub { color: #888; font-size: 0.85rem; text-align: center; }
    .input-group { display: flex; flex-direction: column; gap: 0.4rem; }
    label { font-size: 0.82rem; color: #aaa; }
    input {
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fff;
      padding: 0.65rem 0.85rem;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #6366f1; }
    .btn-connect {
      background: linear-gradient(135deg, #6366f1, #818cf8);
      border: none;
      border-radius: 8px;
      color: #fff;
      padding: 0.75rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-connect:disabled { opacity: 0.5; cursor: default; }
    .err { color: #f87171; font-size: 0.82rem; text-align: center; }

    nav {
      background: #13132a;
      padding: 0 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      border-bottom: 1px solid #2a2a4a;
      min-height: 56px;
    }
    .logo { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; color: #6366f1; margin-right: 1.5rem; font-size: 1.1rem; }
    .logo img { height: 100px; width: auto; object-fit: contain; }
    nav button {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: transparent;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 0.9rem;
      padding: 0.4rem 0.85rem;
      border-radius: 6px;
    }
    nav button:hover { color: #fff; background: #1e1e3a; }
    nav button.active { color: #6366f1; background: #1a1a4a; font-weight: 600; }
    .spacer { flex: 1; }
    .conn-dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; }
    main { flex: 1; overflow: auto; padding: 1.5rem; }
  `];

  connectedCallback() {
    super.connectedCallback();
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      this.tokenInput = saved;
      this.doConnect(saved);
    }
  }

  async doConnect(token: string) {
    const sanitizedToken = token.trim();
    if (!sanitizedToken) {
      this.connError = 'Empty token.';
      return;
    }

    this.connecting = true;
    this.connError = '';
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsProto}://${location.hostname}:${location.port || 18789}`;
    this.ws = new WsClient(wsUrl);
    try {
      await this.ws.connect(sanitizedToken, 'Browser UI');
      localStorage.setItem(TOKEN_KEY, sanitizedToken);
      this.connected = true;
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : 'Connection failed. Check token/network.';
      this.connError = `${msg} (WS: ${wsUrl})`;
      this.connected = false;
    } finally {
      this.connecting = false;
    }
  }

  render() {
    if (!this.connected) return this.renderLogin();
    return this.renderShell();
  }

  renderLogin() {
    return html`
      <div class="login-wrap">
        <div class="login-card">
          <img src="logo.png" alt="9Lives Logo" style="height: 64px; margin: 0 auto; display: block;" />
          <div class="login-title">9<span>Lives</span>.ai</div>
          <div class="login-sub">Enter the gateway access token</div>
          <div class="input-group">
            <label>Gateway Token</label>
            <input
              type="password"
              placeholder="change_me"
              .value=${this.tokenInput}
              @input=${(e: any) => this.tokenInput = e.target.value}
              @keydown=${(e: any) => e.key === 'Enter' && this.doConnect(this.tokenInput)}
            />
          </div>
          ${this.connError ? html`<div class="err">${this.connError}</div>` : ''}
          <button class="btn-connect" @click=${() => this.doConnect(this.tokenInput)} ?disabled=${this.connecting}>
            ${this.connecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    `;
  }

  renderShell() {
    const tabs = [
      { id: 'chat',       label: 'Chat',       icon: iconChat },
      { id: 'lives',      label: 'Lives',      icon: iconBolt },
      { id: 'crews',      label: 'Crews',      icon: iconGroup },
      { id: 'skills',     label: 'Skills',     icon: iconBuild },
      { id: 'connectors', label: 'Connectors', icon: iconHub },
      { id: 'settings',   label: 'Settings',   icon: iconSettings },
    ];
    return html`
      <nav>
        <span class="logo"><img src="logo.png" alt="Logo"/>9Lives</span>
        ${tabs.map(t => html`
          <button class="${this.currentView === t.id ? 'active' : ''}" @click=${() => this.currentView = t.id}>
            ${t.icon()} ${t.label}
          </button>
        `)}
        <div class="spacer"></div>
        <div class="conn-dot" title="Connected"></div>
      </nav>
      <main>${this.renderView()}</main>
    `;
  }

  renderView() {
      switch (this.currentView) {
        case 'chat': return html`<chat-view       .ws=${this.ws}></chat-view>`;
        case 'lives': return html`<lives-view      .ws=${this.ws}></lives-view>`;
        case 'crews': return html`<crews-view      .ws=${this.ws}></crews-view>`;
        case 'skills': return html`<skills-view     .ws=${this.ws}></skills-view>`;
        case 'connectors': return html`<connectors-view .ws=${this.ws}></connectors-view>`;
        case 'settings': return html`<settings-view   .ws=${this.ws}></settings-view>`;
      default: return html``;
    }
  }
}
