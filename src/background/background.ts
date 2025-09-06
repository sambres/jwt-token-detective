import { JWTUtils } from "@/utils/jwt";
import { ExtensionStorage, JWTTokenGroup, RequestInfo, TokenSource } from "@/types/jwt";

class JWTDetectorBackground {
  private static readonly STORAGE_KEY = "jwt_detector_data";
  private static readonly MAX_TOKEN_GROUPS = 100;
  private static readonly RETENTION_HOURS = 2;
  private static readonly CLEAN_UP_INTERVAL_MINUTES = 15; // 15 minutes

  private isCookieInspectionEnabled: boolean = false;
  private cookieNameFilters: RegExp[] = [];

  constructor() {
    this.loadSettings();
    this.setupWebRequestListener();
    this.setupStorageCleanup();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        this.handleSettingsChange(changes);
      }
    });
  }

  private handleSettingsChange(changes: { [key: string]: chrome.storage.StorageChange }) {
    let settingsChanged = false;
    if (changes.jwt_cookie_inspection_enabled) {
      this.isCookieInspectionEnabled = changes.jwt_cookie_inspection_enabled.newValue;
      settingsChanged = true;
    }
    if (changes.jwt_cookie_name_filters) {
      this.cookieNameFilters = (changes.jwt_cookie_name_filters.newValue || []).map(
        (pattern: string) => new RegExp(pattern, "i")
      );
      settingsChanged = true;
    }

    if (settingsChanged) {
      console.log("JWT Detector settings updated", {
        isCookieInspectionEnabled: this.isCookieInspectionEnabled,
        cookieNameFilters: this.cookieNameFilters,
      });
    }
  }

  private async loadSettings() {
    chrome.storage.local.get(
      ["jwt_cookie_inspection_enabled", "jwt_cookie_name_filters"],
      (result) => {
        this.isCookieInspectionEnabled = result.jwt_cookie_inspection_enabled || false;
        this.cookieNameFilters = (result.jwt_cookie_name_filters || []).map(
          (pattern: string) => new RegExp(pattern, "i")
        );
        console.log("JWT Detector settings loaded", {
          isCookieInspectionEnabled: this.isCookieInspectionEnabled,
          cookieNameFilters: this.cookieNameFilters,
        });
      }
    );
  }

  /**
   * Set up chrome.webRequest listener to monitor HTTP requests
   */
  private setupWebRequestListener(): void {
    chrome.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        this.handleRequest(details);
      },
      { urls: ["<all_urls>"] },
      ["requestHeaders"]
    );
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(
    details: chrome.webRequest.WebRequestHeadersDetails
  ): Promise<void> {
    try {
      const tokens = new Map<string, TokenSource>();

      // 1. Look for Authorization header with Bearer token
      const authHeader = details.requestHeaders?.find(
        (header) => header.name.toLowerCase() === "authorization"
      );

      if (authHeader?.value) {
        const bearerToken = JWTUtils.extractBearerToken(authHeader.value);
        if (bearerToken) {
          if (!tokens.has(bearerToken)) {
            tokens.set(bearerToken, { type: "header" });
          }
        }
      }

      // 2. Look for JWTs in cookies
      if (this.isCookieInspectionEnabled) {
        const cookieHeader = details.requestHeaders?.find(
          (header) => header.name.toLowerCase() === "cookie"
        );

        if (cookieHeader?.value) {
          const cookies = cookieHeader.value.split(";");
          for (const cookie of cookies) {
            const [name, ...valueParts] = cookie.trim().split("=");
            if (name && valueParts.length > 0) {
              // Apply cookie name filters if they exist
              if (this.cookieNameFilters.length > 0) {
                if (!this.cookieNameFilters.some((r) => r.test(name))) {
                  continue; // Skip if no filter matches
                }
              }

              const value = valueParts.join("=");
              // Basic check for JWT format. Full validation is done later.
              if (value.split(".").length === 3) {
                if (!tokens.has(value)) {
                  tokens.set(value, { type: "cookie", name });
                }
              }
            }
          }
        }
      }

      if (tokens.size === 0) {
        return;
      }

      // Create request info for all found tokens in this request
      const requestInfo: RequestInfo = {
        id: JWTUtils.generateRequestId(),
        url: details.url,
        method: details.method,
        abbreviatedPath: JWTUtils.getAbbreviatedPath(details.url),
        timestamp: new Date().getTime(),
      };

      // Store each unique token
      for (const [token, source] of tokens.entries()) {
        await this.storeTokenData(token, requestInfo, source);
      }
    } catch (error) {
      console.error("Error handling request:", error);
    }
  }

  /**
   * Store or update token data in chrome storage
   */
  private async storeTokenData(
    token: string,
    requestInfo: RequestInfo,
    source: TokenSource
  ): Promise<void> {
    try {
      const storage = await this.getStorage();
      const tokenId = await JWTUtils.generateTokenId(token);

      console.log("Storing token data:", {
        tokenId,
        url: requestInfo.url,
        method: requestInfo.method,
        timeStamp: requestInfo.timestamp,
        existingGroups: storage.tokenGroups.length,
      });

      // Find existing token group
      const existingGroupIndex = storage.tokenGroups.findIndex(
        (group) => group.tokenId === tokenId
      );

      console.log(
        "Looking for existing group with tokenId:",
        tokenId,
        "found at index:",
        existingGroupIndex
      );

      if (existingGroupIndex >= 0) {
        // Update existing group
        const existingGroup = storage.tokenGroups[existingGroupIndex];
        existingGroup.requests.push(requestInfo);
        existingGroup.lastSeen = requestInfo.timestamp;
        existingGroup.domain = JWTUtils.getDomainFromUrl(requestInfo.url);

        console.log("Updated existing group:", {
          tokenId,
          requestCount: existingGroup.requests.length,
        });

        // Recalculate expiry status in case time has passed
        const parsed = JWTUtils.parseJWT(token);
        if (parsed) {
          existingGroup.isExpired = JWTUtils.isTokenExpired(parsed.payload);
        }

        // Keep only recent requests (last 50 per token)
        if (existingGroup.requests.length > 50) {
          existingGroup.requests = existingGroup.requests
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 50);
        }
      } else {
        // Create new token group
        const newGroup = await JWTUtils.createTokenGroup(token, requestInfo, source);
        if (newGroup) {
          console.log("Created new token group:", {
            tokenId: newGroup.tokenId,
            expiryDate: newGroup.expiryDate,
            isExpired: newGroup.isExpired,
          });

          storage.tokenGroups.unshift(newGroup); // Add to beginning
        } else {
          console.error("Failed to create token group for token");
        }
      }

      // Limit total number of token groups
      if (storage.tokenGroups.length > JWTDetectorBackground.MAX_TOKEN_GROUPS) {
        storage.tokenGroups = storage.tokenGroups.slice(
          0,
          JWTDetectorBackground.MAX_TOKEN_GROUPS
        );
      }

      console.log("Final storage state:", {
        totalGroups: storage.tokenGroups.length,
        groupsWithRequests: storage.tokenGroups.map((g) => ({
          tokenId: g.tokenId,
          requestCount: g.requests.length,
        })),
      });

      await this.saveStorage(storage);
    } catch (error) {
      console.error("Error storing token data:", error);
    }
  }

  /**
   * Get storage data
   */
  private async getStorage(): Promise<ExtensionStorage> {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [JWTDetectorBackground.STORAGE_KEY],
        (result) => {
          const data = result[JWTDetectorBackground.STORAGE_KEY];
          if (data) {
            resolve(data);
          } else {
            resolve({
              tokenGroups: [],
              maxTokenGroups: JWTDetectorBackground.MAX_TOKEN_GROUPS,
              retentionHours: JWTDetectorBackground.RETENTION_HOURS,
            });
          }
        }
      );
    });
  }

  /**
   * Save storage data
   */
  private async saveStorage(data: ExtensionStorage): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [JWTDetectorBackground.STORAGE_KEY]: data,
        },
        () => {
          resolve();
        }
      );
    });
  }

  /**
   * Set up periodic cleanup of old data
   */
  private setupStorageCleanup(): void {
    // Clean up every 15 minutes
    setInterval(() => {
      this.cleanupOldData();
    }, JWTDetectorBackground.CLEAN_UP_INTERVAL_MINUTES * 60 * 1000);

    // Also clean up on startup
    this.cleanupOldData();
  }

  /**
   * Remove old token groups and requests
   */
  private async cleanupOldData(): Promise<void> {
    try {
      const storage = await this.getStorage();
      const cutoffTime =
        Date.now() - JWTDetectorBackground.RETENTION_HOURS * 60 * 60 * 1000;
      const now = Date.now();

      console.log("Running cleanup at:", new Date().toISOString());
      console.log("Current time (ms):", now);
      console.log("Cutoff time:", new Date(cutoffTime).toISOString());
      console.log("Before cleanup - Total groups:", storage.tokenGroups.length);

      // More aggressive cleanup: remove expired tokens that are old
      storage.tokenGroups = storage.tokenGroups
        .map((group) => {
          // Recalculate expiry status based on current time
          const updatedGroup = {
            ...group,
            isExpired: JWTUtils.isTokenExpired(group.payload),
            // Remove old requests within each group
            requests: group.requests.filter(
              (req) => req.timestamp > cutoffTime
            ),
          };

          return updatedGroup;
        })
        .filter((group) => {
          // Calculate if token expired more than 1 hour ago
          let expiredMoreThanAnHour = false;
          let expiryTime = null;

          try {
            // Check using expiryDate if available
            if (group.expiryDate) {
              expiryTime = group.expiryDate;
            }

            // Fallback: check using payload.exp
            if (
              !expiryTime &&
              group.payload &&
              typeof group.payload.exp === "number"
            ) {
              expiryTime = group.payload.exp * 1000; // Convert to milliseconds
            }

            if (expiryTime) {
              const hoursExpired = (now - expiryTime) / (60 * 60 * 1000);
              expiredMoreThanAnHour = hoursExpired > 1;

              console.log("Token analysis:", {
                tokenId: group.tokenId,
                expiryTime: new Date(expiryTime).toISOString(),
                currentTime: new Date(now).toISOString(),
                hoursExpired: hoursExpired.toFixed(2),
                expiredMoreThanAnHour,
              });
            } else {
              console.log("Token analysis - no valid expiry found:", {
                tokenId: group.tokenId,
                expiryDate: group.expiryDate,
                payloadExp: group.payload?.exp,
              });
            }
          } catch (error) {
            console.error("Error processing token expiry:", {
              tokenId: group.tokenId,
              error: error instanceof Error ? error.message : String(error),
              expiryDate: group.expiryDate,
              payloadExp: group.payload?.exp,
            });
            // If we can't process expiry, keep the token to be safe
            return true;
          }

          const isCurrentlyExpired = JWTUtils.isTokenExpired(group.payload);

          // SIMPLIFIED LOGIC: Remove if expired more than 1 hour ago
          const shouldKeep = !isCurrentlyExpired || !expiredMoreThanAnHour;

          if (!shouldKeep) {
            console.log("🗑️ REMOVING expired token group:", {
              tokenId: group.tokenId,
              reason: "Expired more than 1 hour ago",
              isCurrentlyExpired,
              expiredMoreThanAnHour,
            });
          } else {
            console.log("✅ KEEPING token group:", {
              tokenId: group.tokenId,
              isCurrentlyExpired,
              expiredMoreThanAnHour,
              reason: isCurrentlyExpired
                ? "Expired but <1 hour ago"
                : "Still valid",
            });
          }

          return shouldKeep;
        });

      console.log("After cleanup - Total groups:", storage.tokenGroups.length);
      await this.saveStorage(storage);
    } catch (error) {
      console.error("Error cleaning up old data:", error);
    }
  }
}

// Initialize the background script
new JWTDetectorBackground();
