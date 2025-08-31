export class SettingsManager {
  private settingsPage: HTMLElement | null;
  private mainPage: HTMLElement | null;
  private closeSettingsBtn: HTMLElement | null;
  private addFilterBtn: HTMLElement | null;
  private domainFilterInput: HTMLInputElement | null;
  private regexError: HTMLElement | null;
  private filterList: HTMLElement | null;

  public domainFilters: string[] = [];
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

    this.init();
  }

  private async init() {
    this.closeSettingsBtn?.addEventListener("click", () => this.hide());
    this.addFilterBtn?.addEventListener("click", () => this.addFilter());
    await this.loadSettings();
  }

  public show() {
    this.mainPage?.style.setProperty("display", "none");
    this.settingsPage?.style.setProperty("display", "block");
    this.renderFilterList();
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
      chrome.storage.local.get(["jwt_domain_filters"], (result) => {
        this.domainFilters = result.jwt_domain_filters || [];
        resolve();
      });
    });
  }
}
