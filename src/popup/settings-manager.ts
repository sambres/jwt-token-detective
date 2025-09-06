export class SettingsManager {
  private settingsPage: HTMLElement | null;
  private mainPage: HTMLElement | null;
  private closeSettingsBtn: HTMLElement | null;
  private addFilterBtn: HTMLElement | null;
  private domainFilterInput: HTMLInputElement | null;
  private regexError: HTMLElement | null;
  private filterList: HTMLElement | null;

  private cookieInspectionToggle: HTMLInputElement | null;
  private addCookieFilterBtn: HTMLElement | null;
  private cookieFilterInput: HTMLInputElement | null;
  private cookieRegexError: HTMLElement | null;
  private cookieFilterList: HTMLElement | null;

  public domainFilters: string[] = [];
  public isCookieInspectionEnabled: boolean = false;
  public cookieNameFilters: string[] = [];

  private onFiltersChanged: () => void;

  constructor(onFiltersChanged: () => void) {
    this.onFiltersChanged = onFiltersChanged;

    this.mainPage = document.getElementById("main-page");
    this.settingsPage = document.getElementById("settings-page");
    this.closeSettingsBtn = document.getElementById("close-settings-btn");
    this.addFilterBtn = document.getElementById("add-filter-btn");
    this.domainFilterInput = document.getElementById(
      "domain-filter-input"
    ) as HTMLInputElement | null;
    this.regexError = document.getElementById("regex-error");
    this.filterList = document.getElementById("filter-list");

    this.cookieInspectionToggle = document.getElementById(
      "cookie-inspection-toggle"
    ) as HTMLInputElement | null;
    this.addCookieFilterBtn = document.getElementById("add-cookie-filter-btn");
    this.cookieFilterInput = document.getElementById(
      "cookie-filter-input"
    ) as HTMLInputElement | null;
    this.cookieRegexError = document.getElementById("cookie-regex-error");
    this.cookieFilterList = document.getElementById("cookie-filter-list");

    this.init();
  }

  private async init() {
    this.closeSettingsBtn?.addEventListener("click", () => this.hide());
    this.addFilterBtn?.addEventListener("click", () => this.addFilter());

    this.cookieInspectionToggle?.addEventListener("change", () =>
      this.toggleCookieInspection()
    );
    this.addCookieFilterBtn?.addEventListener("click", () =>
      this.addCookieFilter()
    );

    await this.loadSettings();
  }

  public show() {
    this.mainPage?.style.setProperty("display", "none");
    this.settingsPage?.style.setProperty("display", "block");
    this.renderFilterList();
    this.renderCookieFilterList();
  }

  public hide() {
    this.mainPage?.style.setProperty("display", "block");
    this.settingsPage?.style.setProperty("display", "none");
  }

  private async addFilter() {
    if (!this.domainFilterInput) return;
    const newFilter = this.domainFilterInput.value.trim();
    if (!newFilter) return;

    try {
      new RegExp(newFilter);
      if (this.regexError) this.regexError.style.display = "none";
    } catch (e: any) {
      if (this.regexError) {
        this.regexError.textContent = e.message;
        this.regexError.style.display = "block";
      }
      return;
    }

    if (!this.domainFilters.includes(newFilter)) {
      this.domainFilters.push(newFilter);
      await this.saveFilters();
      this.renderFilterList();
      this.domainFilterInput.value = "";
    }
  }

  private async removeFilter(index: number) {
    this.domainFilters.splice(index, 1);
    await this.saveFilters();
    this.renderFilterList();
    this.onFiltersChanged();
  }

  private async toggleCookieInspection() {
    if (!this.cookieInspectionToggle) return;
    this.isCookieInspectionEnabled = this.cookieInspectionToggle.checked;
    await this.saveCookieSettings();
  }

  private async addCookieFilter() {
    if (!this.cookieFilterInput) return;
    const newFilter = this.cookieFilterInput.value.trim();
    if (!newFilter) return;

    try {
      new RegExp(newFilter);
      if (this.cookieRegexError) this.cookieRegexError.style.display = "none";
    } catch (e: any) {
      if (this.cookieRegexError) {
        this.cookieRegexError.textContent = e.message;
        this.cookieRegexError.style.display = "block";
      }
      return;
    }

    if (!this.cookieNameFilters.includes(newFilter)) {
      this.cookieNameFilters.push(newFilter);
      await this.saveCookieSettings();
      this.renderCookieFilterList();
      this.cookieFilterInput.value = "";
    }
  }

  private async removeCookieFilter(index: number) {
    this.cookieNameFilters.splice(index, 1);
    await this.saveCookieSettings();
    this.renderCookieFilterList();
  }

  private renderCookieFilterList() {
    if (!this.cookieFilterList) return;
    this.cookieFilterList.innerHTML = "";

    if (this.cookieNameFilters.length === 0) {
      this.cookieFilterList.innerHTML = `<div style="text-align: center; padding: 8px; color: #6b7280;">No cookie filters added.</div>`;
      return;
    }

    this.cookieNameFilters.forEach((filter, index) => {
      const item = document.createElement("div");
      item.className = "filter-item";
      item.innerHTML = `
        <span>${filter}</span>
        <button class="remove-cookie-filter-btn" data-index="${index}">&times;</button>
      `;
      this.cookieFilterList?.appendChild(item);
    });

    this.cookieFilterList
      .querySelectorAll(".remove-cookie-filter-btn")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const index = parseInt(
            (e.target as HTMLElement).dataset.index || "-1"
          );
          if (index !== -1) {
            this.removeCookieFilter(index);
          }
        });
      });
  }

  private renderFilterList() {
    if (!this.filterList) return;
    this.filterList.innerHTML = "";

    if (this.domainFilters.length === 0) {
      this.filterList.innerHTML = `<div style="text-align: center; padding: 8px; color: #6b7280;">No filters added.</div>`;
      return;
    }

    this.domainFilters.forEach((filter, index) => {
      const item = document.createElement("div");
      item.className = "filter-item";
      item.innerHTML = `
        <span>${filter}</span>
        <button class="remove-filter-btn" data-index="${index}">&times;</button>
      `;
      this.filterList?.appendChild(item);
    });

    this.filterList.querySelectorAll(".remove-filter-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const index = parseInt((e.target as HTMLElement).dataset.index || "-1");
        if (index !== -1) {
          this.removeFilter(index);
        }
      });
    });
  }

  private async saveCookieSettings(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          jwt_cookie_inspection_enabled: this.isCookieInspectionEnabled,
          jwt_cookie_name_filters: this.cookieNameFilters,
        },
        () => {
          resolve();
        }
      );
    });
  }

  private async saveFilters(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { jwt_domain_filters: this.domainFilters },
        () => {
          resolve();
        }
      );
    });
  }

  private async loadSettings(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          "jwt_domain_filters",
          "jwt_cookie_inspection_enabled",
          "jwt_cookie_name_filters",
        ],
        (result) => {
          this.domainFilters = result.jwt_domain_filters || [];
          this.isCookieInspectionEnabled =
            result.jwt_cookie_inspection_enabled || false;
          this.cookieNameFilters = result.jwt_cookie_name_filters || [];

          if (this.cookieInspectionToggle) {
            this.cookieInspectionToggle.checked =
              this.isCookieInspectionEnabled;
          }

          resolve();
        }
      );
    });
  }
}
