import { Settings } from "../types/jwt";

export class SettingsManager {
  private settingsPage: HTMLElement | null;
  private mainPage: HTMLElement | null;
  private closeSettingsBtn: HTMLElement | null;
  private addFilterBtn: HTMLElement | null;
  private domainFilterInput: HTMLInputElement | null;
  private regexError: HTMLElement | null;
  private filterList: HTMLElement | null;
  private groupTokensByDomainCheckbox: HTMLInputElement | null;

  public settings: Settings = {
    groupByDomain: false,
    domainFilters: [],
  };
  private onSettingsChanged: () => void;

  constructor(onSettingsChanged: () => void) {
    this.onSettingsChanged = onSettingsChanged;

    this.mainPage = document.getElementById("main-page");
    this.settingsPage = document.getElementById("settings-page");
    this.closeSettingsBtn = document.getElementById("close-settings-btn");
    this.addFilterBtn = document.getElementById("add-filter-btn");
    this.domainFilterInput = document.getElementById(
      "domain-filter-input"
    ) as HTMLInputElement | null;
    this.regexError = document.getElementById("regex-error");
    this.filterList = document.getElementById("filter-list");
    this.groupTokensByDomainCheckbox = document.getElementById(
      "group-by-domain-checkbox"
    ) as HTMLInputElement | null;

    this.init();
  }

  private async init() {
    this.closeSettingsBtn?.addEventListener("click", () => this.hide());
    this.addFilterBtn?.addEventListener("click", () => this.addFilter());
    this.groupTokensByDomainCheckbox?.addEventListener("change", () =>
      this.handleGroupByDomainChange()
    );

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

  private async handleGroupByDomainChange() {
    if (!this.groupTokensByDomainCheckbox) return;

    this.settings.groupByDomain = this.groupTokensByDomainCheckbox.checked;
    await this.saveSettings();
    await this.clearTokens();
    this.onSettingsChanged();
  }

  private async clearTokens(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { jwt_detector_data: { tokenGroups: [] } },
        () => {
          resolve();
        }
      );
    });
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

    if (!this.settings.domainFilters.includes(newFilter)) {
      this.settings.domainFilters.push(newFilter);
      await this.saveSettings();
      this.renderFilterList();
      this.domainFilterInput.value = "";
      this.onSettingsChanged();
    }
  }

  private async removeFilter(index: number) {
    this.settings.domainFilters.splice(index, 1);
    await this.saveSettings();
    this.renderFilterList();
    this.onSettingsChanged();
  }

  private renderFilterList() {
    if (!this.filterList) return;
    this.filterList.innerHTML = "";

    if (this.settings.domainFilters.length === 0) {
      this.filterList.innerHTML = `<div class="no-filters-label" >No filters added.</div>`;
      return;
    }

    this.settings.domainFilters.forEach((filter, index) => {
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

  private async saveSettings(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set({ jwt_settings: this.settings }, () => {
        resolve();
      });
    });
  }

  public async loadSettings(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.get(["jwt_settings"], (result) => {
        if (result.jwt_settings) {
          this.settings = { ...this.settings, ...result.jwt_settings };
        }
        // Update UI elements to reflect loaded settings
        if (this.groupTokensByDomainCheckbox) {
          this.groupTokensByDomainCheckbox.checked =
            this.settings.groupByDomain;
        }
        resolve();
      });
    });
  }
}
