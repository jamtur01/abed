import { createLogger } from "../logger";
import type {
  SonarrSearchResult,
  SonarrQualityProfile,
  SonarrRootFolder,
  SonarrSeries,
  AddSeriesPayload,
} from "./types";

const log = createLogger("sonarr");

export class SonarrClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Arr URL must use HTTP(S) without credentials, query or fragment");
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/api/v3${path}`;
    const method = options?.method ?? "GET";
    const safePath = path.split("?")[0] ?? path;
    const startTime = performance.now();

    log.debug("HTTP request", { method, path: safePath });

    const response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    const responseText = await response.text();
    const elapsed = `${Math.round(performance.now() - startTime)}ms`;

    if (!response.ok) {
      log.error("Sonarr API error", { method, path: safePath, status: response.status, elapsed });
      throw new Error(`Sonarr API error ${response.status}: ${responseText}`);
    }

    const bodyPreview =
      responseText.length > 512 ? responseText.slice(0, 512) + "...(truncated)" : responseText;
    log.debug("HTTP response", {
      method,
      path: safePath,
      status: response.status,
      elapsed,
      bodyPreview,
    });

    return JSON.parse(responseText) as T;
  }

  async searchSeries(query: string): Promise<SonarrSearchResult[]> {
    return this.request<SonarrSearchResult[]>(`/series/lookup?term=${encodeURIComponent(query)}`);
  }

  async addSeries(
    series: SonarrSearchResult,
    qualityProfileId: number,
    rootFolderPath: string,
  ): Promise<SonarrSeries> {
    const payload: AddSeriesPayload = {
      ...series,
      qualityProfileId,
      rootFolderPath,
      monitored: true,
      seasonFolder: true,
      addOptions: {
        monitor: "all",
        searchForMissingEpisodes: true,
        searchForCutoffUnmetEpisodes: false,
      },
    };
    return this.request<SonarrSeries>("/series", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async seriesExists(tvdbId: number): Promise<boolean> {
    const series = await this.request<SonarrSeries[]>(`/series?tvdbId=${tvdbId}`);
    return series.length > 0;
  }

  async getQualityProfiles(): Promise<SonarrQualityProfile[]> {
    return this.request<SonarrQualityProfile[]>("/qualityprofile");
  }

  async getRootFolders(): Promise<SonarrRootFolder[]> {
    return this.request<SonarrRootFolder[]>("/rootfolder");
  }

  async getSeriesByTvdbId(tvdbId: number): Promise<SonarrSeries | null> {
    const series = await this.request<SonarrSeries[]>(`/series?tvdbId=${tvdbId}`);
    return series[0] ?? null;
  }
}
