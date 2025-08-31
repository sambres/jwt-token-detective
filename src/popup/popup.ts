import { ExtensionStorage, JWTTokenGroup, RequestInfo } from "../types/jwt";
import { SettingsManager } from "./settings-manager";

export class JWTPopup {
  private tokensContainer: HTMLElement | null;
  private emptyState: HTMLElement | null;
  private loading: HTMLElement | null;
  private statsText: HTMLElement | null;
  private refreshBtn: HTMLElement | null;
  private settingsBtn: HTMLElement | null;

  private settingsManager: SettingsManager;

  constructor() {
    this.tokensContainer = document.getElementById("tokens-container");
    this.emptyState = document.getElementById("empty-state");
    this.loading = document.getElementById("loading");
    this.statsText = document.getElementById("stats-text");
    this.refreshBtn = document.getElementById("refresh-btn");
    this.settingsBtn = document.getElementById("settings-btn");

    this.settingsManager = new SettingsManager(() => this.loadTokens());

    this.init();
  }

  async init() {
    this.refreshBtn?.addEventListener("click", () => this.loadTokens());
    this.settingsBtn?.addEventListener("click", () =>
      this.settingsManager.show()
    );

    await this.loadTokens();
  }

  async loadTokens() {
    try {
      this.showLoading();
      await this.settingsManager.loadSettings();
      const storage = await this.getStorage();
      const allTokenGroups = storage.tokenGroups || [];
      let filteredTokenGroups = allTokenGroups;

      if (this.settingsManager.settings.domainFilters.length > 0) {
        const regexes = this.settingsManager.settings.domainFilters.map(
          (f) => new RegExp(f, "i")
        );
        filteredTokenGroups = allTokenGroups.filter((group) => {
          const domain = this.getDomain(group);
          return domain && regexes.some((r) => r.test(domain));
        });
      }

      this.renderTokens(filteredTokenGroups, allTokenGroups);
    } catch (error) {
      console.error("Error loading tokens:", error);
      this.showError();
    }
  }

  async getStorage(): Promise<ExtensionStorage> {
    return new Promise((resolve) => {
      chrome.storage.local.get(["jwt_detector_data"], (result) => {
        const data = result.jwt_detector_data as any; // Treat as any to handle serialized types

        if (data && data.tokenGroups && Array.isArray(data.tokenGroups)) {
          try {
            const parsedData: ExtensionStorage = {
              ...data,
              tokenGroups: data.tokenGroups.map((group: any) => {
                const parsedExpiryDate = this.parseDate(group.expiryDate);

                let isExpired = group.isExpired;
                if (parsedExpiryDate) {
                  isExpired = parsedExpiryDate.getTime() < Date.now();
                } else if (
                  group.payload &&
                  typeof group.payload.exp === "number"
                ) {
                  isExpired = group.payload.exp * 1000 < Date.now();
                }

                const finalGroup: JWTTokenGroup = {
                  ...group,
                  expiryDate: parsedExpiryDate,
                  isExpired,
                  firstSeen: this.parseDate(group.firstSeen) || new Date(),
                  lastSeen: this.parseDate(group.lastSeen) || new Date(),
                  requests: Array.isArray(group.requests)
                    ? group.requests
                        .map((req: any) => ({
                          ...req,
                          timestamp:
                            this.parseDate(req.timestamp) || new Date(),
                        }))
                        .filter((req: any) => req && req.timestamp)
                        .sort(
                          (a: any, b: any) =>
                            b.timestamp.getTime() - a.timestamp.getTime()
                        )
                    : [],
                };
                return finalGroup;
              }),
            };

            resolve(parsedData);
          } catch (error) {
            console.error("Error parsing storage data:", error);
            resolve({ tokenGroups: [] });
          }
        } else {
          resolve({ tokenGroups: [] });
        }
      });
    });
  }

  parseDate(dateValue: Date | string | number | null): Date | null {
    if (!dateValue) {
      return null;
    }

    if (typeof dateValue === "object" && dateValue instanceof Date) {
      return isNaN(dateValue.getTime()) ? null : dateValue;
    }

    try {
      const parsed = new Date(dateValue);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch (error) {
      console.error("Failed to parse date:", dateValue, error);
      return null;
    }
  }

  renderTokens(tokenGroups: JWTTokenGroup[], allTokenGroups: JWTTokenGroup[]) {
    this.hideLoading();

    if (allTokenGroups.length === 0) {
      this.showEmptyState();
      return;
    }

    this.hideEmptyState();
    if (!this.tokensContainer) {
      console.error("Tokens container not found");
      return;
    }
    this.tokensContainer.innerHTML = "";

    if (tokenGroups.length === 0) {
      this.tokensContainer.innerHTML = `<div class="empty-state" style="display: block;"><div class="icon">🧐</div><h3>No matching tokens</h3><p>Adjust your filter or make new requests.</p></div>`;
      this.updateStats(tokenGroups, allTokenGroups);
      return;
    }

    const fragment = document.createDocumentFragment();

    if (this.settingsManager.settings.groupByDomain) {
      const groupedByDomain = tokenGroups.reduce((acc, group) => {
        const domain = this.getDomain(group) || "Unknown";
        if (!acc[domain]) {
          acc[domain] = [];
        }
        acc[domain].push(group);
        return acc;
      }, {} as Record<string, JWTTokenGroup[]>);

      const sortedDomains = Object.keys(groupedByDomain).sort();

      sortedDomains.forEach((domain) => {
        const groupContainer = this.createDomainGroupElement(
          domain,
          groupedByDomain[domain]
        );
        fragment.appendChild(groupContainer);
      });
    } else {
      const sortedGroups = tokenGroups.sort(
        (a, b) =>
          new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
      );

      sortedGroups.forEach((group) => {
        const tokenElement = this.createTokenElement(group);
        fragment.appendChild(tokenElement);
      });
    }

    this.tokensContainer.appendChild(fragment);
    this.updateStats(tokenGroups, allTokenGroups);
  }

  createDomainGroupElement(
    domain: string,
    groups: JWTTokenGroup[]
  ): HTMLElement {
    const element = document.createElement("div");
    element.className = "domain-group";

    const sortedGroups = groups.sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );

    element.innerHTML = `
      <div class="domain-header">
        <div class="domain-name">${domain}</div>
        <div class="domain-token-count">${groups.length} token(s)</div>
        <button class="toggle-btn">▼</button>
      </div>
      <div class="token-list-container">
        ${sortedGroups
          .map((g) => this.createTokenElement(g).outerHTML)
          .join("")}
      </div>
    `;

    const header = element.querySelector(".domain-header");
    header?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = element.classList.toggle("expanded");
      const toggleBtn = element.querySelector(".toggle-btn");
      if (toggleBtn) {
        toggleBtn.textContent = isExpanded ? "▲" : "▼";
      }
    });

    element.querySelectorAll(".token-group").forEach((tokenEl, index) => {
      this.setupTokenEvents(tokenEl as HTMLElement, sortedGroups[index]);
    });

    return element;
  }

  getDomain(group: JWTTokenGroup): string {
    if (group.domain) {
      return group.domain;
    }
    if (group.requests && group.requests.length > 0) {
      const lastRequest = group.requests[0];
      try {
        return new URL(lastRequest.url).hostname;
      } catch (e) {
        return lastRequest.url;
      }
    }
    return group.tokenId || "Unknown";
  }

  createTokenElement(group: JWTTokenGroup): HTMLElement {
    const element = document.createElement("div");
    element.className = "token-group";

    if (!group || !Array.isArray(group.requests)) {
      group = { ...group, requests: [] };
    }

    let expiryText = "No expiry";
    if (group.expiryDate) {
      expiryText = this.formatDate(group.expiryDate);
    }

    const statusClass = group.isExpired ? "expired" : "valid";
    const statusText = group.isExpired ? "Expired" : "Valid";
    const tokenId = group.tokenId || "unknown";
    const title = this.getDomain(group);

    element.innerHTML = `
      <div class="token-header" data-token-id="${tokenId}">
        <div class="token-info">
          <div class="token-id">${title}</div>
          <div class="token-id-secondary">${tokenId}</div>
          <div class="token-status">
            <span class="status-badge ${statusClass}">${statusText}</span>
            <span class="expiry-date">Expires: ${expiryText}</span>
          </div>
        </div>
        <div class="token-actions">
          <button class="primary-btn copy-btn" data-token="${
            group.raw || ""
          }">Copy</button>
          <button class="toggle-btn" data-token-id="${tokenId}">▼</button>
        </div>
      </div>
      <div class="requests-list" id="requests-${tokenId}">
        ${this.renderRequests(group.requests || [])}
      </div>
    `;

    if (!element.closest(".domain-group")) {
      this.setupTokenEvents(element, group);
    }

    return element;
  }

  renderRequests(requests: RequestInfo[]): string {
    if (!requests || requests.length === 0) {
      return '<div style="text-align: center; padding: 8px; color: #6b7280;">No requests</div>';
    }

    return requests
      .map(
        (request) => `
          <div class="request-item">
            <div class="request-line">
              <span class="request-method ${request.method}">${
          request.method
        }</span>
              <span class="request-path">${
                request.abbreviatedPath || request.url
              }</span>
            </div>
            <div class="request-time">${this.formatDateTime(
              request.timestamp
            )}</div>
          </div>
        `
      )
      .join("");
  }

  setupTokenEvents(element: HTMLElement, group: JWTTokenGroup) {
    if (!element || !group) return;

    const copyBtn = element.querySelector(".copy-btn") as HTMLElement;
    copyBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.copyToClipboard(group.raw, copyBtn);
    });

    const header = element.querySelector(".token-header");
    header?.addEventListener("click", (e) => {
      e.stopPropagation();
      const requestsList = element.querySelector(".requests-list");
      const toggleBtn = element.querySelector(".toggle-btn");
      const isExpanded = requestsList?.classList.toggle("expanded");
      if (toggleBtn) {
        toggleBtn.textContent = isExpanded ? "▲" : "▼";
      }
    });
  }

  async copyToClipboard(text: string, button: HTMLElement) {
    try {
      await navigator.clipboard.writeText(text);
      const originalText = button.textContent;
      button.textContent = "Copied!";
      button.classList.add("copied");

      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove("copied");
      }, 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  }

  formatDate(date: string | number | Date | null): string {
    if (!date) return "Unknown";

    let dateObj: Date;
    if (typeof date === "object" && date instanceof Date) {
      dateObj = date;
    } else {
      dateObj = new Date(date);
    }

    if (isNaN(dateObj.getTime())) {
      return "Invalid date";
    }

    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(dateObj);
    } catch (error) {
      console.error("Error formatting date:", error, "Date:", date);
      return "Format error";
    }
  }

  formatDateTime(date: string | number | Date | null): string {
    if (!date) return "Unknown";

    let dateObj: Date;
    if (typeof date === "object" && date instanceof Date) {
      dateObj = date;
    } else {
      dateObj = new Date(date);
    }

    if (isNaN(dateObj.getTime())) {
      return "Invalid date";
    }

    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(dateObj);
    } catch (error) {
      console.error("Error formatting datetime:", error, "Date:", date);
      return "Format error";
    }
  }

  updateStats(tokenGroups: JWTTokenGroup[], allTokenGroups: JWTTokenGroup[]) {
    const count = tokenGroups.length;
    const totalCount = allTokenGroups.length;
    const expiredCount = tokenGroups.filter((g) => g.isExpired).length;

    let text = `${totalCount} token${totalCount !== 1 ? "s" : ""}`;

    if (this.settingsManager.settings.domainFilters.length > 0) {
      text = `${count} of ${totalCount} tokens`;
    }

    if (expiredCount > 0) {
      text += ` (${expiredCount} expired)`;
    }

    if (this.statsText) {
      this.statsText.textContent = text;
    }
  }

  showLoading() {
    if (this.loading) this.loading.style.display = "block";
    if (this.emptyState) this.emptyState.style.display = "none";
    if (this.tokensContainer) this.tokensContainer.style.display = "none";
  }

  hideLoading() {
    if (this.loading) this.loading.style.display = "none";
  }

  showEmptyState() {
    if (this.emptyState) this.emptyState.style.display = "block";
    if (this.tokensContainer) this.tokensContainer.style.display = "none";
    if (this.statsText) this.statsText.textContent = "0 tokens detected";
  }

  hideEmptyState() {
    if (this.emptyState) this.emptyState.style.display = "none";
    if (this.tokensContainer) this.tokensContainer.style.display = "block";
  }

  showError() {
    this.hideLoading();
    if (this.tokensContainer) {
      this.tokensContainer.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #dc2626;">
          <div style="font-size: 24px; margin-bottom: 8px;">⚠️</div>
          <div>Error loading tokens</div>
        </div>
      `;
    }
  }
}
