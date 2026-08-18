const DiagnosticSuiteTabs = {
  bind(root, suiteName, initialTab) {
    const buttons = Array.from(root.querySelectorAll(`[data-${suiteName}-tab]`));
    const panels = Array.from(root.querySelectorAll(`[data-${suiteName}-panel]`));

    const activate = (tabId, focus = false) => {
      buttons.forEach(button => {
        const active = button.dataset[`${suiteName}Tab`] === tabId;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        if (active && focus) button.focus();
      });
      panels.forEach(panel => {
        panel.classList.toggle('d-none', panel.dataset[`${suiteName}Panel`] !== tabId);
      });
    };

    buttons.forEach((button, index) => {
      button.onclick = () => activate(button.dataset[`${suiteName}Tab`]);
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = buttons.length - 1;
        activate(buttons[nextIndex].dataset[`${suiteName}Tab`], true);
      };
    });

    activate(initialTab);
  }
};

const NetworkLinkDiagnosticTool = {
  render(container) {
    container.innerHTML = `
      <div class="diagnostic-suite" id="networkLinkDiagnosticSuite">
        <div class="diagnostic-suite-header">
          <div class="tool-nav-tabs" role="tablist" aria-label="网络链路诊断视图">
            <button class="tool-tab-btn active" role="tab" data-link-tab="ping" aria-controls="linkPanelPing">
              <i data-lucide="activity"></i><span>Ping 质量</span>
            </button>
            <button class="tool-tab-btn" role="tab" data-link-tab="route" aria-controls="linkPanelRoute">
              <i data-lucide="git-branch"></i><span>路由与 Traceroute</span>
            </button>
          </div>
        </div>
        <section class="diagnostic-suite-panel" id="linkPanelPing" role="tabpanel" data-link-panel="ping"></section>
        <section class="diagnostic-suite-panel d-none" id="linkPanelRoute" role="tabpanel" data-link-panel="route"></section>
      </div>`;

    const root = container.querySelector('#networkLinkDiagnosticSuite');
    PingTool.render(root.querySelector('#linkPanelPing'));
    RouteTracerTool.render(root.querySelector('#linkPanelRoute'));
    DiagnosticSuiteTabs.bind(root, 'link', 'ping');
    if (window.lucide) lucide.createIcons({ root });
  }
};

const DomainDiagnosticTool = {
  render(container) {
    container.innerHTML = `
      <div class="diagnostic-suite" id="domainDiagnosticSuite">
        <div class="diagnostic-suite-header">
          <div class="tool-nav-tabs" role="tablist" aria-label="域名诊断视图">
            <button class="tool-tab-btn active" role="tab" data-domain-tab="ssl" aria-controls="domainPanelSsl">
              <i data-lucide="shield-check"></i><span>SSL / TLS</span>
            </button>
            <button class="tool-tab-btn" role="tab" data-domain-tab="dns" aria-controls="domainPanelDns">
              <i data-lucide="scan-line"></i><span>DNS / DoH</span>
            </button>
            <button class="tool-tab-btn" role="tab" data-domain-tab="whois" aria-controls="domainPanelWhois">
              <i data-lucide="map-pinned"></i><span>IP / Whois</span>
            </button>
          </div>
        </div>
        <section class="diagnostic-suite-panel" id="domainPanelSsl" role="tabpanel" data-domain-panel="ssl"></section>
        <section class="diagnostic-suite-panel d-none" id="domainPanelDns" role="tabpanel" data-domain-panel="dns"></section>
        <section class="diagnostic-suite-panel d-none" id="domainPanelWhois" role="tabpanel" data-domain-panel="whois"></section>
      </div>`;

    const root = container.querySelector('#domainDiagnosticSuite');
    SslCheckerTool.render(root.querySelector('#domainPanelSsl'));
    DnsDeepDiagnosticTool.render(root.querySelector('#domainPanelDns'));
    IpWhoisIntelligenceTool.render(root.querySelector('#domainPanelWhois'));
    DiagnosticSuiteTabs.bind(root, 'domain', 'ssl');
    if (window.lucide) lucide.createIcons({ root });
  }
};
