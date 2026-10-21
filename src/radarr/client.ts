import { createLogger } from '../logger';
import type {
  RadarrSearchResult,
  RadarrQualityProfile,
  RadarrRootFolder,
  RadarrMovie,
  AddMoviePayload,
} from './types';

const log = createLogger('radarr');

export class RadarrClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('Arr URL must use HTTP(S) without credentials, query or fragment');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/api/v3${path}`;
    const method = options?.method ?? 'GET';
    const safePath = path.split('?')[0] ?? path;
    const startTime = performance.now();

    log.debug('HTTP request', { method, path: safePath });

    const response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const responseText = await response.text();
    const elapsed = `${Math.round(performance.now() - startTime)}ms`;

    if (!response.ok) {
      log.error('Radarr API error', { method, path: safePath, status: response.status, elapsed });
      throw new Error(`Radarr API error ${response.status}: ${responseText}`);
    }

    const bodyPreview =
      responseText.length > 512 ? responseText.slice(0, 512) + '...(truncated)' : responseText;
    log.debug('HTTP response', {
      method,
      path: safePath,
      status: response.status,
      elapsed,
      bodyPreview,
    });

    return JSON.parse(responseText) as T;
  }

  async searchMovies(query: string): Promise<RadarrSearchResult[]> {
    return this.request<RadarrSearchResult[]>(`/movie/lookup?term=${encodeURIComponent(query)}`);
  }

  async addMovie(
    movie: RadarrSearchResult,
    qualityProfileId: number,
    rootFolderPath: string,
  ): Promise<RadarrMovie> {
    const payload: AddMoviePayload = {
      ...movie,
      qualityProfileId,
      rootFolderPath,
      monitored: true,
      minimumAvailability: 'released',
      addOptions: {
        searchForMovie: true,
      },
    };
    return this.request<RadarrMovie>('/movie', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async movieExists(tmdbId: number): Promise<boolean> {
    const movies = await this.request<RadarrMovie[]>('/movie');
    return movies.some((m) => m.tmdbId === tmdbId);
  }

  async getQualityProfiles(): Promise<RadarrQualityProfile[]> {
    return this.request<RadarrQualityProfile[]>('/qualityProfile');
  }

  async getRootFolders(): Promise<RadarrRootFolder[]> {
    return this.request<RadarrRootFolder[]>('/rootFolder');
  }

  async getMovieByTmdbId(tmdbId: number): Promise<RadarrMovie | null> {
    const movies = await this.request<RadarrMovie[]>(`/movie?tmdbId=${tmdbId}`);
    return movies[0] ?? null;
  }
}
