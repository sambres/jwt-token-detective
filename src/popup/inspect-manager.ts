import { JWTUtils } from "../utils/jwt";

export class InspectManager {
  private inspectPage: HTMLElement | null;
  private mainPage: HTMLElement | null;
  private closeInspectBtn: HTMLElement | null;
  private headerContent: HTMLElement | null;
  private payloadContent: HTMLElement | null;
  private inspectTitle: HTMLElement | null;

  constructor() {
    this.mainPage = document.getElementById("main-page");
    this.inspectPage = document.getElementById("inspect-page");
    this.closeInspectBtn = document.getElementById("close-inspect-btn");
    this.headerContent = document.getElementById("inspect-header-content");
    this.payloadContent = document.getElementById("inspect-payload-content");
    this.inspectTitle = document.getElementById("inspect-title");

    this.init();
  }

  private init() {
    this.closeInspectBtn?.addEventListener("click", () => this.hide());
  }

  public show(token: string, tokenId: string, domain: string) {
    const parsedToken = JWTUtils.parseJWT(token);
    if (!parsedToken) {
      // Handle error - maybe show a message
      return;
    }

    if (this.inspectTitle) {
      this.inspectTitle.innerHTML = `<div class="token-id">ID: ${tokenId}</div><div class="token-title">${domain}</div>`;
    }

    if (this.headerContent) {
      this.headerContent.textContent = JSON.stringify(
        parsedToken.header,
        null,
        2
      );
    }
    if (this.payloadContent) {
      this.payloadContent.textContent = JSON.stringify(
        parsedToken.payload,
        null,
        2
      );
    }

    this.mainPage?.style.setProperty("display", "none");
    this.inspectPage?.style.setProperty("display", "block");
  }

  public hide() {
    this.mainPage?.style.setProperty("display", "block");
    this.inspectPage?.style.setProperty("display", "none");
  }
}
