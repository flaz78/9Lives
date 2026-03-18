// Copyright (c) 2026 Flavio Cerato
import { html, css } from 'lit';
import { TemplateResult } from 'lit';

export const iconStyles = css`
  .icon-svg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }
  .icon-svg svg {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }
`;

// ── Navigation ───────────────────────────────────────────────────────────────
export const iconChat = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></span>`;
export const iconBolt = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M7 2v11h3v9l7-12h-4l4-9z"/></svg></span>`;
export const iconGroup = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg></span>`;
export const iconBuild = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg></span>`;
export const iconHub = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg></span>`;
export const iconSettings = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></span>`;

// ── Actions ──────────────────────────────────────────────────────────────────
export const iconEdit = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></span>`;
export const iconDelete = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></span>`;
export const iconPlayArrow = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7z"/></svg></span>`;
export const iconSave = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg></span>`;
export const iconKey = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg></span>`;
export const iconCheckCircle = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></span>`;
export const iconCancel = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg></span>`;
export const iconHourglass = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6 2v6l2 2-2 2v6h12v-6l-2-2 2-2V2H6zm10 14.5V18H8v-1.5l2-2V12h4v2.5l2 2zm-2-9.5H8V3h6v4z"/></svg></span>`;
export const iconPower = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z"/></svg></span>`;
export const iconWarning = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg></span>`;
export const iconSearch = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></span>`;
export const iconPrint = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg></span>`;
export const iconSend = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></span>`;
export const iconChat2 = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></span>`;
export const iconMenu = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg></span>`;
export const iconChevronRight = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></span>`;
export const iconMail = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg></span>`;
export const iconCloud = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg></span>`;
export const iconMusicNote = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></span>`;
export const iconWebhook = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z"/></svg></span>`;
export const iconTelegram = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.68 7.93c-.12.56-.48.7-.96.44l-2.67-1.97-1.29 1.24c-.14.14-.26.26-.54.26l.19-2.71 4.94-4.47c.22-.19-.05-.29-.33-.1L7.5 14.03l-2.6-.81c-.56-.18-.58-.56.12-.83l10.15-3.91c.47-.17.88.11.47 1.32z"/></svg></span>`;
export const iconElectricalServices = (): TemplateResult => html`<span class="icon-svg"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 1L6 13h5.5L10 23l8.5-12H13l.5-10z"/></svg></span>`;

// ── Named lookup map ─────────────────────────────────────────────────────────
const ICON_MAP: Record<string, () => TemplateResult> = {
  telegram: iconTelegram,
  mail: iconMail,
  chat: iconChat,
  cloud: iconCloud,
  music_note: iconMusicNote,
  webhook: iconWebhook,
  search: iconSearch,
  print: iconPrint,
  check_circle: iconCheckCircle,
  cancel: iconCancel,
  hourglass_empty: iconHourglass,
  electrical_services: iconElectricalServices,
  save: iconSave,
  key: iconKey,
  warning: iconWarning,
  menu: iconMenu,
  chevron_right: iconChevronRight,
  edit: iconEdit,
  delete: iconDelete,
  play_arrow: iconPlayArrow,
  send: iconSend,
  chat2: iconChat2,
};

export const msi = (name: string): TemplateResult =>
  ICON_MAP[name]?.() ?? html`<span style="font-size:10px;opacity:0.4">${name}</span>`;
