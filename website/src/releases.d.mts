export const REPOSITORY: string;
export const RELEASES: string;
export const RELEASE_API: string;
export interface ReleaseAsset {
    name: string;
    url: string;
    platform: string;
    format: string;
    architecture: string;
    size: string;
}
export interface Release {
    version: string;
    date: string;
    assets: ReleaseAsset[];
}
export function parseRelease(data: unknown): Release;
export function fetchRelease(options?: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
}): Promise<Release>;
