export function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CodeGraph Server</title>
  <link rel="stylesheet" href="/assets/app.css">
  <script src="/assets/app.js" defer></script>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">CodeGraph</p>
        <h1>Project Index Server</h1>
      </div>
      <div class="top-actions">
        <div id="health" class="status-pill">Checking</div>
        <button id="refreshBtn" class="icon-button" type="button" aria-label="Refresh projects" title="Refresh"></button>
      </div>
    </header>

    <section id="tokenPanel" class="auth-panel hidden" aria-live="polite">
      <label for="tokenInput">Access token</label>
      <input id="tokenInput" type="password" autocomplete="current-password" placeholder="Bearer token">
      <button id="saveTokenBtn" type="button">Apply</button>
    </section>

    <main class="layout">
      <aside class="sidebar" aria-label="Projects">
        <form id="addProjectForm" class="project-form">
          <div class="field">
            <label for="sourceType">Source</label>
            <select id="sourceType" name="sourceType">
              <option value="path">Mounted path</option>
              <option value="git">Git remote</option>
            </select>
          </div>
          <div class="field git-field hidden">
            <label for="provider">Provider</label>
            <select id="provider" name="provider">
              <option value="gitlab">GitLab</option>
              <option value="github">GitHub</option>
              <option value="generic">Generic Git</option>
            </select>
          </div>
          <div class="field git-field hidden">
            <label for="remoteUrl">Remote URL</label>
            <input id="remoteUrl" name="remoteUrl" placeholder="git@gitlab.internal:team/service.git">
          </div>
          <div class="field">
            <label id="projectPathLabel" for="projectPath">Project path</label>
            <input id="projectPath" name="path" placeholder="/projects/service-a">
          </div>
          <div class="field">
            <label for="projectName">Display name</label>
            <input id="projectName" name="name" placeholder="service-a">
          </div>
          <div class="field git-field hidden">
            <label for="branch">Branch</label>
            <input id="branch" name="branch" placeholder="main">
          </div>
          <div class="field git-field hidden">
            <label for="credentialEnv">Token env var</label>
            <input id="credentialEnv" name="credentialEnv" placeholder="GITLAB_TOKEN">
          </div>
          <div class="field git-field hidden">
            <label for="credentialUsername">Token username</label>
            <input id="credentialUsername" name="credentialUsername" placeholder="oauth2">
          </div>
          <div class="schedule-row">
            <label><input id="addScheduleEnabled" type="checkbox"> Scheduled sync</label>
            <input id="addScheduleInterval" type="number" min="1" value="60" aria-label="Sync interval minutes">
          </div>
          <button type="submit" class="primary-action" id="addProjectBtn"></button>
        </form>
        <div class="sidebar-heading">
          <span>Registered Projects</span>
          <span id="projectCount">0</span>
        </div>
        <div id="projectList" class="project-list"></div>
      </aside>

      <section class="workspace" aria-live="polite">
        <div id="emptyState" class="empty-state">
          <h2>No project selected</h2>
          <p>Add a mounted repository path, then index it.</p>
        </div>

        <div id="projectDetail" class="detail hidden">
          <div class="detail-header">
            <div>
              <p id="selectedPath" class="path-label"></p>
              <h2 id="selectedName"></h2>
            </div>
            <div class="action-row">
              <button id="initBtn" type="button"></button>
              <button id="indexBtn" type="button"></button>
              <button id="syncBtn" type="button"></button>
              <button id="defaultBtn" type="button"></button>
              <button id="removeBtn" class="danger" type="button"></button>
            </div>
          </div>

          <div id="statusBanner" class="status-banner"></div>

          <div class="metric-grid">
            <div class="metric"><span>Files</span><strong id="metricFiles">0</strong></div>
            <div class="metric"><span>Nodes</span><strong id="metricNodes">0</strong></div>
            <div class="metric"><span>Edges</span><strong id="metricEdges">0</strong></div>
            <div class="metric"><span>Database</span><strong id="metricDb">0 MB</strong></div>
          </div>

          <div class="split">
            <section class="panel">
              <div class="panel-title">MCP Endpoint</div>
              <div class="copy-row">
                <input id="mcpEndpoint" readonly>
                <button id="copyMcpBtn" class="icon-button" type="button" aria-label="Copy MCP endpoint" title="Copy endpoint"></button>
              </div>
              <dl class="facts">
                <div><dt>Last indexed</dt><dd id="lastIndexed">Never</dd></div>
                <div><dt>Journal</dt><dd id="journalMode">Unknown</dd></div>
                <div><dt>Pending</dt><dd id="pendingChanges">0</dd></div>
              </dl>
            </section>

            <section class="panel">
              <div class="panel-title">Languages</div>
              <div id="languageList" class="tag-list"></div>
            </section>

            <section class="panel">
              <div class="panel-title">Source & Schedule</div>
              <dl class="facts compact-facts">
                <div><dt>Source</dt><dd id="sourceKind">Path</dd></div>
                <div><dt>Remote</dt><dd id="remoteDetail">-</dd></div>
                <div><dt>Branch</dt><dd id="branchDetail">-</dd></div>
                <div><dt>Credential</dt><dd id="credentialDetail">-</dd></div>
                <div><dt>Next sync</dt><dd id="nextRunAt">Manual</dd></div>
              </dl>
              <div class="schedule-editor">
                <label><input id="scheduleEnabled" type="checkbox"> Scheduled sync</label>
                <input id="scheduleInterval" type="number" min="1" aria-label="Sync interval minutes">
                <button id="scheduleSaveBtn" class="icon-button" type="button" aria-label="Save schedule" title="Save schedule"></button>
              </div>
            </section>
          </div>

          <section class="panel log-panel">
            <div class="panel-title">Operation Log</div>
            <pre id="operationLog"></pre>
          </section>
        </div>
      </section>
    </main>
  </div>
</body>
</html>`;
}

export const APP_CSS = `
:root {
  color-scheme: light;
  --bg: #f7f8fb;
  --surface: #ffffff;
  --surface-strong: #f0f4f8;
  --line: #d6dee8;
  --line-strong: #b9c5d3;
  --text: #111827;
  --muted: #5b6675;
  --primary: #1769aa;
  --primary-strong: #0f4f86;
  --green: #1f8a4c;
  --amber: #a26312;
  --red: #b42318;
  --shadow: 0 10px 28px rgba(15, 23, 42, .08);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  min-width: 320px;
}

button, input, select { font: inherit; }
button {
  min-height: 44px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
  border-radius: 8px;
  padding: 0 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: border-color 180ms ease, background 180ms ease, color 180ms ease;
}
button:hover { border-color: var(--primary); }
button:focus-visible, input:focus-visible {
  outline: 3px solid rgba(23, 105, 170, .24);
  outline-offset: 2px;
}
button:disabled {
  opacity: .55;
  cursor: not-allowed;
}
button svg { width: 18px; height: 18px; flex: 0 0 18px; }

.shell { min-height: 100vh; }
.topbar {
  min-height: 76px;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, .92);
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(10px);
}
.eyebrow {
  margin: 0 0 2px;
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: 24px; line-height: 1.2; }
h2 { margin-bottom: 0; font-size: 22px; line-height: 1.25; }
.top-actions, .action-row, .copy-row { display: flex; align-items: center; gap: 10px; }
.status-pill {
  min-height: 36px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--surface-strong);
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 14px;
}
.status-pill.ok { color: var(--green); border-color: rgba(31, 138, 76, .35); background: #eef8f1; }
.status-pill.bad { color: var(--red); border-color: rgba(180, 35, 24, .35); background: #fff2f0; }
.icon-button { width: 44px; padding: 0; }

.auth-panel {
  margin: 16px 24px 0;
  padding: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  display: grid;
  grid-template-columns: auto minmax(160px, 360px) 120px;
  align-items: center;
  gap: 12px;
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.layout {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 20px;
  padding: 20px 24px 28px;
}
.sidebar, .workspace {
  min-width: 0;
}
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.project-form, .panel, .empty-state {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
}
.project-form { padding: 16px; display: grid; gap: 12px; }
.field { display: grid; gap: 6px; }
label, .panel-title, .sidebar-heading {
  font-size: 13px;
  font-weight: 700;
  color: #344054;
}
input {
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 12px;
  color: var(--text);
  background: #fff;
  width: 100%;
}
select {
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 36px 0 12px;
  color: var(--text);
  background: #fff;
  width: 100%;
  cursor: pointer;
}
input[type="checkbox"] {
  width: 18px;
  min-height: 18px;
  height: 18px;
  accent-color: var(--primary);
}
.primary-action {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.primary-action:hover { background: var(--primary-strong); border-color: var(--primary-strong); }
.danger { color: var(--red); border-color: rgba(180, 35, 24, .35); }
.sidebar-heading {
  display: flex;
  justify-content: space-between;
  padding: 0 2px;
}
.project-list {
  display: grid;
  gap: 8px;
}
.project-item {
  min-height: 72px;
  width: 100%;
  text-align: left;
  justify-content: flex-start;
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
}
.project-item.active {
  border-color: var(--primary);
  background: #edf6ff;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 6px;
  background: var(--line-strong);
}
.dot.ready { background: var(--green); }
.dot.running { background: var(--amber); }
.dot.error { background: var(--red); }
.project-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.project-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.default-mark {
  font-size: 12px;
  color: var(--primary);
  border: 1px solid rgba(23,105,170,.25);
  border-radius: 999px;
  padding: 2px 6px;
}
.project-path {
  color: var(--muted);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.workspace { display: block; }
.empty-state { min-height: 280px; display: grid; place-content: center; text-align: center; padding: 24px; }
.empty-state p { color: var(--muted); margin: 8px 0 0; }
.detail { display: grid; gap: 16px; }
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.path-label {
  color: var(--muted);
  margin-bottom: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  word-break: break-all;
}
.action-row { flex-wrap: wrap; justify-content: flex-end; }
.status-banner {
  min-height: 46px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--muted);
}
.status-banner.ready { color: var(--green); background: #eef8f1; border-color: rgba(31,138,76,.28); }
.status-banner.running { color: var(--amber); background: #fff7eb; border-color: rgba(162,99,18,.32); }
.status-banner.error { color: var(--red); background: #fff2f0; border-color: rgba(180,35,24,.28); }
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 12px;
}
.metric {
  min-height: 92px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px;
  display: grid;
  align-content: space-between;
}
.metric span { color: var(--muted); font-size: 13px; }
.metric strong { font-size: 26px; line-height: 1.1; }
.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
.panel { padding: 16px; min-width: 0; }
.panel-title { margin-bottom: 12px; }
.copy-row input {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}
.facts {
  margin: 14px 0 0;
  display: grid;
  gap: 10px;
}
.facts div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
}
.compact-facts div { grid-template-columns: 92px minmax(0, 1fr); }
dt { color: var(--muted); }
dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.schedule-row, .schedule-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 86px;
  gap: 10px;
  align-items: center;
}
.schedule-row label, .schedule-editor label {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}
.schedule-editor {
  grid-template-columns: minmax(0, 1fr) 86px 44px;
  margin-top: 14px;
}
.schedule-row input[type="number"], .schedule-editor input[type="number"] {
  text-align: right;
}
.tag-list { display: flex; gap: 8px; flex-wrap: wrap; min-height: 32px; }
.tag {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line);
  background: var(--surface-strong);
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 13px;
}
.log-panel pre {
  margin: 0;
  min-height: 180px;
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  background: #101828;
  color: #e6edf3;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.hidden { display: none !important; }

@media (max-width: 980px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { order: 2; }
  .workspace { order: 1; }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .split { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .topbar { padding: 14px 16px; align-items: flex-start; }
  .layout { padding: 16px; }
  .top-actions { flex-wrap: wrap; justify-content: flex-end; }
  h1 { font-size: 21px; }
  .auth-panel { margin: 12px 16px 0; grid-template-columns: 1fr; }
  .detail-header { display: grid; }
  .action-row { justify-content: stretch; }
  .action-row button { flex: 1 1 136px; }
  .metric-grid { grid-template-columns: 1fr; }
  .schedule-row, .schedule-editor { grid-template-columns: 1fr; }
  .facts div { grid-template-columns: 1fr; gap: 2px; }
}
`;

export const APP_JS = `
(function () {
  var state = { config: null, projects: [], selectedId: null, token: localStorage.getItem('codegraphToken') || '' };

  var els = {};
  document.addEventListener('DOMContentLoaded', function () {
    [
      'health','refreshBtn','tokenPanel','tokenInput','saveTokenBtn','addProjectForm','sourceType','provider',
      'remoteUrl','projectPath','projectPathLabel','projectName','branch','credentialEnv','credentialUsername',
      'addScheduleEnabled','addScheduleInterval',
      'addProjectBtn','projectCount','projectList','emptyState','projectDetail','selectedPath','selectedName',
      'initBtn','indexBtn','syncBtn','defaultBtn','removeBtn','statusBanner','metricFiles','metricNodes',
      'metricEdges','metricDb','mcpEndpoint','copyMcpBtn','lastIndexed','journalMode','pendingChanges',
      'languageList','sourceKind','remoteDetail','branchDetail','credentialDetail','nextRunAt',
      'scheduleEnabled','scheduleInterval','scheduleSaveBtn','operationLog'
    ].forEach(function (id) { els[id] = document.getElementById(id); });

    setButton(els.refreshBtn, 'refresh', '');
    setButton(els.addProjectBtn, 'plus', 'Add Project');
    setButton(els.initBtn, 'circle', 'Init');
    setButton(els.indexBtn, 'play', 'Index');
    setButton(els.syncBtn, 'refresh', 'Sync');
    setButton(els.defaultBtn, 'pin', 'Default');
    setButton(els.removeBtn, 'trash', 'Remove');
    setButton(els.copyMcpBtn, 'copy', '');
    setButton(els.scheduleSaveBtn, 'save', '');

    els.tokenInput.value = state.token;
    els.sourceType.addEventListener('change', updateSourceFields);
    els.provider.addEventListener('change', updateCredentialPlaceholder);
    els.refreshBtn.addEventListener('click', loadProjects);
    els.saveTokenBtn.addEventListener('click', saveToken);
    els.addProjectForm.addEventListener('submit', addProject);
    els.initBtn.addEventListener('click', function () { runOperation('init'); });
    els.indexBtn.addEventListener('click', function () { runOperation('index'); });
    els.syncBtn.addEventListener('click', function () { runOperation('sync'); });
    els.defaultBtn.addEventListener('click', setDefaultProject);
    els.removeBtn.addEventListener('click', removeProject);
    els.copyMcpBtn.addEventListener('click', copyMcpEndpoint);
    els.scheduleSaveBtn.addEventListener('click', saveSchedule);

    updateSourceFields();
    updateCredentialPlaceholder();
    boot();
    window.setInterval(function () {
      if (state.projects.some(function (p) { return p.operation && p.operation.status === 'running'; })) {
        loadProjects(true);
      }
    }, 3500);
  });

  function icon(name) {
    var paths = {
      refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 3v4h4"/><path d="M6 21v-4H2"/>',
      plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
      play: '<path d="M8 5v14l11-7z"/>',
      circle: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/><path d="M8 12h8"/>',
      pin: '<path d="M12 17v5"/><path d="M5 17h14"/><path d="m7 17 2-9h6l2 9"/><path d="M9 4h6"/>',
      trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/>',
      save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>'
    };
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || '') + '</svg>';
  }

  function setButton(button, iconName, text) {
    button.innerHTML = icon(iconName) + (text ? '<span>' + text + '</span>' : '');
  }

  async function boot() {
    try {
      state.config = await request('/api/config', { skipAuth: true });
      if (state.config.adminAuthRequired) {
        els.tokenPanel.classList.remove('hidden');
      }
      if (state.config.projectsRoot) {
        els.projectPath.placeholder = state.config.projectsRoot + '/service-a';
      }
      await loadProjects();
      setHealth(true);
    } catch (err) {
      setHealth(false, err.message);
    }
  }

  function updateSourceFields() {
    var isGit = els.sourceType.value === 'git';
    document.querySelectorAll('.git-field').forEach(function (node) {
      node.classList.toggle('hidden', !isGit);
    });
    els.projectPathLabel.textContent = isGit ? 'Checkout path' : 'Project path';
    els.projectPath.required = !isGit;
    els.remoteUrl.required = isGit;
    if (isGit) {
      els.projectPath.placeholder = '_repos/service-a';
    } else if (state.config && state.config.projectsRoot) {
      els.projectPath.placeholder = state.config.projectsRoot + '/service-a';
    }
  }

  function updateCredentialPlaceholder() {
    if (els.provider.value === 'github') {
      els.credentialEnv.placeholder = 'GITHUB_TOKEN';
      els.credentialUsername.placeholder = 'x-access-token';
    } else if (els.provider.value === 'gitlab') {
      els.credentialEnv.placeholder = 'GITLAB_TOKEN';
      els.credentialUsername.placeholder = 'oauth2';
    } else {
      els.credentialEnv.placeholder = 'CODEGRAPH_GIT_TOKEN';
      els.credentialUsername.placeholder = 'git';
    }
  }

  function saveToken() {
    state.token = els.tokenInput.value.trim();
    localStorage.setItem('codegraphToken', state.token);
    loadProjects();
  }

  async function loadProjects(quiet) {
    try {
      var data = await request('/api/projects');
      state.projects = data.projects || [];
      if (!state.selectedId && state.projects[0]) state.selectedId = state.projects[0].id;
      if (state.selectedId && !state.projects.some(function (p) { return p.id === state.selectedId; })) {
        state.selectedId = state.projects[0] ? state.projects[0].id : null;
      }
      render();
      setHealth(true);
    } catch (err) {
      if (!quiet) setHealth(false, err.message);
      render();
    }
  }

  async function addProject(event) {
    event.preventDefault();
    var sourceType = els.sourceType.value === 'git' ? 'git' : 'path';
    var body = {
      sourceType: sourceType,
      path: els.projectPath.value.trim(),
      name: els.projectName.value.trim(),
      scheduleEnabled: els.addScheduleEnabled.checked,
      scheduleIntervalMinutes: Number(els.addScheduleInterval.value || 60)
    };
    if (sourceType === 'git') {
      body.provider = els.provider.value;
      body.remoteUrl = els.remoteUrl.value.trim();
      body.branch = els.branch.value.trim();
      body.credentialEnv = els.credentialEnv.value.trim();
      body.credentialUsername = els.credentialUsername.value.trim();
      if (!body.remoteUrl) return;
      if (!body.path) delete body.path;
    } else if (!body.path) {
      return;
    }
    await request('/api/projects', { method: 'POST', body: body });
    els.projectPath.value = '';
    els.projectName.value = '';
    els.remoteUrl.value = '';
    els.branch.value = '';
    els.credentialEnv.value = '';
    els.credentialUsername.value = '';
    await loadProjects();
  }

  async function runOperation(kind) {
    var selected = getSelected();
    if (!selected) return;
    await request('/api/projects/' + encodeURIComponent(selected.id) + '/' + kind, { method: 'POST' });
    await loadProjects();
  }

  async function setDefaultProject() {
    var selected = getSelected();
    if (!selected) return;
    await request('/api/projects/' + encodeURIComponent(selected.id) + '/default', { method: 'POST' });
    await loadProjects();
  }

  async function removeProject() {
    var selected = getSelected();
    if (!selected) return;
    if (!window.confirm('Remove ' + selected.name + ' from this server registry?')) return;
    await request('/api/projects/' + encodeURIComponent(selected.id), { method: 'DELETE' });
    state.selectedId = null;
    await loadProjects();
  }

  async function copyMcpEndpoint() {
    var value = els.mcpEndpoint.value;
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  async function saveSchedule() {
    var selected = getSelected();
    if (!selected) return;
    await request('/api/projects/' + encodeURIComponent(selected.id) + '/schedule', {
      method: 'POST',
      body: {
        enabled: els.scheduleEnabled.checked,
        intervalMinutes: Number(els.scheduleInterval.value || 60)
      }
    });
    await loadProjects();
  }

  function render() {
    els.projectCount.textContent = String(state.projects.length);
    els.projectList.innerHTML = '';
    state.projects.forEach(function (project) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'project-item' + (project.id === state.selectedId ? ' active' : '');
      button.innerHTML =
        '<span class="dot ' + projectClass(project) + '"></span>' +
        '<span>' +
          '<span class="project-title"><strong>' + escapeHtml(project.name) + '</strong>' +
          (project.isDefault ? '<span class="default-mark">default</span>' : '') + '</span>' +
          '<span class="project-path">' + escapeHtml(projectListSubtitle(project)) + '</span>' +
        '</span>';
      button.addEventListener('click', function () {
        state.selectedId = project.id;
        render();
      });
      els.projectList.appendChild(button);
    });
    renderSelected();
  }

  function renderSelected() {
    var project = getSelected();
    els.emptyState.classList.toggle('hidden', !!project);
    els.projectDetail.classList.toggle('hidden', !project);
    if (!project) return;

    var status = project.status || {};
    var source = project.source || { type: 'path' };
    var op = project.operation;
    var running = op && op.status === 'running';
    els.selectedName.textContent = project.name;
    els.selectedPath.textContent = project.path;
    els.metricFiles.textContent = formatNumber(status.fileCount || 0);
    els.metricNodes.textContent = formatNumber(status.nodeCount || 0);
    els.metricEdges.textContent = formatNumber(status.edgeCount || 0);
    els.metricDb.textContent = formatBytes(status.dbSizeBytes || 0);
    els.mcpEndpoint.value = window.location.origin + project.mcpPath;
    els.lastIndexed.textContent = status.lastIndexed ? new Date(status.lastIndexed).toLocaleString() : 'Never';
    els.journalMode.textContent = status.journalMode || 'Unknown';
    els.pendingChanges.textContent = String((status.pendingChanges ? status.pendingChanges.added + status.pendingChanges.modified + status.pendingChanges.removed : 0));
    renderSourceDetails(project);
    els.languageList.innerHTML = '';
    (status.languages || []).forEach(function (language) {
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = language;
      els.languageList.appendChild(tag);
    });
    if (!status.languages || status.languages.length === 0) {
      els.languageList.innerHTML = '<span class="tag">No indexed files</span>';
    }

    els.initBtn.disabled = running || status.initialized;
    els.indexBtn.disabled = running || (!status.exists && source.type !== 'git');
    els.syncBtn.disabled = running || (!status.initialized && source.type !== 'git');
    els.defaultBtn.disabled = running || project.isDefault;
    els.removeBtn.disabled = running;
    els.scheduleSaveBtn.disabled = running;

    var bannerClass = '';
    var bannerText = '';
    if (running) {
      bannerClass = 'running';
      bannerText = op.kind + ' is running';
    } else if (status.error) {
      bannerClass = 'error';
      bannerText = status.error;
    } else if (status.initialized) {
      bannerClass = 'ready';
      bannerText = status.reindexRecommended ? 'Indexed; full rebuild recommended for this engine version' : 'Indexed and ready';
    } else {
      bannerText = 'Registered but not indexed';
    }
    els.statusBanner.className = 'status-banner ' + bannerClass;
    els.statusBanner.textContent = bannerText;
    els.operationLog.textContent = op && op.logs && op.logs.length ? op.logs.join('\\n') : 'No operation has run for this project.';
  }

  function renderSourceDetails(project) {
    var source = project.source || { type: 'path' };
    var schedule = project.syncSchedule || { enabled: false, intervalMinutes: 60 };
    if (source.type === 'git') {
      els.sourceKind.textContent = source.provider || 'git';
      els.remoteDetail.textContent = source.remoteUrl || '-';
      els.branchDetail.textContent = source.branch || 'default';
      els.credentialDetail.textContent = source.credentialEnv || 'server git config';
    } else {
      els.sourceKind.textContent = 'path';
      els.remoteDetail.textContent = project.path;
      els.branchDetail.textContent = '-';
      els.credentialDetail.textContent = '-';
    }
    els.scheduleEnabled.checked = !!schedule.enabled;
    els.scheduleInterval.value = String(schedule.intervalMinutes || 60);
    els.nextRunAt.textContent = schedule.enabled && schedule.nextRunAt
      ? new Date(schedule.nextRunAt).toLocaleString()
      : 'Manual';
  }

  function getSelected() {
    return state.projects.find(function (project) { return project.id === state.selectedId; }) || null;
  }

  async function request(path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!options.skipAuth && state.token) headers['Authorization'] = 'Bearer ' + state.token;
    var response = await fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    var text = await response.text();
    var data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(data.error || response.statusText);
    }
    return data;
  }

  function setHealth(ok, message) {
    els.health.className = 'status-pill ' + (ok ? 'ok' : 'bad');
    els.health.textContent = ok ? 'Online' : (message || 'Offline');
  }

  function projectClass(project) {
    if (project.operation && project.operation.status === 'running') return 'running';
    if (project.status && project.status.error) return 'error';
    if (project.status && project.status.initialized) return 'ready';
    return '';
  }

  function projectListSubtitle(project) {
    var source = project.source || { type: 'path' };
    if (source.type === 'git') {
      return (source.branch ? source.branch + ' · ' : '') + source.remoteUrl;
    }
    return project.path;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
})();
`;
