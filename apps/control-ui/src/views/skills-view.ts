// Copyright (c) 2026 Flavio Cerato
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('skills-view')
export class SkillsView extends LitElement {
    @property({ type: Object }) ws: any;
    @state() private skills: any[] = [];

    static styles = css`
    .skills-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; }
    .skill-card { background: #222; padding: 1rem; border: 1px solid #333; border-radius: 8px; }
    .skill-header { display: flex; justify-content: space-between; align-items: start; }
    .version { color: #666; font-size: 0.8rem; }
  `;

    async firstUpdated() {
        await this.loadSkills();
    }

    async loadSkills() {
        try {
            this.skills = await this.ws.request('skills.list');
        } catch (err) {
            console.error('Failed to list skills', err);
        }
    }

    render() {
        return html`
      <div>
        <h2>Skills Registry</h2>
        <button @click=${() => this.reloadSkills()}>Reload Skills</button>
        <hr>
        <div class="skills-grid">
          ${this.skills.map(skill => html`
            <div class="skill-card">
              <div class="skill-header">
                <h3>${skill.name}</h3>
                <span class="version">v${skill.version}</span>
              </div>
              <p>${skill.description}</p>
            </div>
          `)}
        </div>
      </div>
    `;
    }

    async reloadSkills() {
        await this.ws.request('skills.reload');
        await this.loadSkills();
    }
}
