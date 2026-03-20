// Copyright (c) 2026 Flavio Cerato
import https from 'https';
import { query } from '../storage/pg/pool.js';
import { decrypt } from '../util/crypto.js';
import { logger } from '../util/logger.js';
import { toolRegistry } from './toolRegistry.js';

logger.info('spotifyTools module loaded');

type SpotifyTokenCache = {
    accessToken: string;
    expiresAt: number;
} | null;

let tokenCache: SpotifyTokenCache = null;

async function getSecret(key: string): Promise<string> {
    const res = await query('SELECT ciphertext FROM secrets WHERE key=$1', [key]);
    if (!res.rows.length) {
        throw new Error(`Missing credential: ${key}. Configure it in secrets.`);
    }
    return JSON.parse(decrypt(res.rows[0].ciphertext as string));
}

function requestJson(
    method: 'GET' | 'POST',
    url: string,
    options?: {
        headers?: Record<string, string>;
        body?: string;
    }
): Promise<any> {
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method,
            headers: options?.headers,
            timeout: 15000
        }, (res) => {
            let raw = '';
            res.on('data', (chunk) => raw += chunk.toString());
            res.on('end', () => {
                if (!raw) {
                    resolve({});
                    return;
                }

                let parsed: any;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    reject(new Error(`Non-JSON response from Spotify (${res.statusCode}): ${raw.slice(0, 200)}`));
                    return;
                }

                if ((res.statusCode || 500) >= 400) {
                    const message = parsed?.error?.message || parsed?.error_description || `HTTP ${res.statusCode}`;
                    reject(new Error(`Spotify API error: ${message}`));
                    return;
                }

                resolve(parsed);
            });
        });

        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('Spotify request timed out'));
        });

        if (options?.body) {
            request.write(options.body);
        }

        request.end();
    });
}

async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 10_000) {
        return tokenCache.accessToken;
    }

    const clientId = await getSecret('spotify.client_id');
    const clientSecret = await getSecret('spotify.client_secret');
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenResponse = await requestJson('POST', 'https://accounts.spotify.com/api/token', {
        headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    tokenCache = {
        accessToken: tokenResponse.access_token,
        expiresAt: now + ((tokenResponse.expires_in || 3600) * 1000)
    };

    return tokenCache.accessToken;
}

async function spotifyGet(path: string, params?: Record<string, string | number | undefined>) {
    const token = await getAccessToken();
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null) {
            searchParams.set(key, String(value));
        }
    }

    const queryString = searchParams.toString();
    const url = `https://api.spotify.com/v1${path}${queryString ? `?${queryString}` : ''}`;
    return requestJson('GET', url, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });
}

function simplifyTrack(track: any) {
    if (!track) return null;

    return {
        id: track.id,
        name: track.name,
        uri: track.uri,
        url: track.external_urls?.spotify,
        duration_ms: track.duration_ms,
        explicit: track.explicit,
        popularity: track.popularity,
        preview_url: track.preview_url,
        artists: (track.artists || [])
            .filter((artist: any) => Boolean(artist))
            .map((artist: any) => ({
                id: artist.id,
                name: artist.name,
                uri: artist.uri
            })),
        album: track.album ? {
            id: track.album.id,
            name: track.album.name,
            release_date: track.album.release_date,
            total_tracks: track.album.total_tracks
        } : null
    };
}

function simplifyArtist(artist: any) {
    if (!artist) return null;

    return {
        id: artist.id,
        name: artist.name,
        uri: artist.uri,
        url: artist.external_urls?.spotify,
        popularity: artist.popularity,
        followers: artist.followers?.total,
        genres: artist.genres || []
    };
}

function simplifyAlbum(album: any) {
    if (!album) return null;

    return {
        id: album.id,
        name: album.name,
        uri: album.uri,
        url: album.external_urls?.spotify,
        release_date: album.release_date,
        total_tracks: album.total_tracks,
        album_type: album.album_type,
        artists: (album.artists || [])
            .filter((artist: any) => Boolean(artist))
            .map((artist: any) => ({
                id: artist.id,
                name: artist.name,
                uri: artist.uri
            }))
    };
}

toolRegistry.register({
    name: 'spotify.search',
    description: 'Search the public Spotify catalog (tracks, artists, albums, playlists)',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: "Text to search on Spotify" },
            type: {
                type: 'string',
                description: "Type of entity to search for",
                enum: ['track', 'artist', 'album', 'playlist'],
                default: 'track'
            },
            limit: {
                type: 'number',
                description: 'Maximum number of results (1-20)',
                default: 5
            }
        },
        required: ['query']
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const type = input.type || 'track';
        const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20);

        logger.info(`Spotify search: "${input.query}" (${type}, ${limit})`);
        const result = await spotifyGet('/search', {
            q: input.query,
            type,
            limit
        });

        const bucketKey = `${type}s`;
        const items = (result?.[bucketKey]?.items || []).filter((item: any) => Boolean(item));

        if (type === 'track') {
            return { type, results: items.map(simplifyTrack).filter((item: any) => Boolean(item)) };
        }
        if (type === 'artist') {
            return { type, results: items.map(simplifyArtist).filter((item: any) => Boolean(item)) };
        }
        if (type === 'album') {
            return { type, results: items.map(simplifyAlbum).filter((item: any) => Boolean(item)) };
        }

        return {
            type,
            results: items
                .filter((playlist: any) => Boolean(playlist))
                .map((playlist: any) => ({
                id: playlist.id,
                name: playlist.name,
                uri: playlist.uri,
                url: playlist.external_urls?.spotify,
                owner: playlist.owner?.display_name,
                tracks_total: playlist.tracks?.total
            }))
        };
    }
});

toolRegistry.register({
    name: 'spotify.getTrack',
    description: 'Retrieve details of a Spotify track by ID',
    inputSchema: {
        type: 'object',
        properties: {
            trackId: { type: 'string', description: 'Spotify track ID' }
        },
        required: ['trackId']
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const track = await spotifyGet(`/tracks/${encodeURIComponent(input.trackId)}`);
        return simplifyTrack(track);
    }
});

toolRegistry.register({
    name: 'spotify.getArtist',
    description: 'Retrieve details of a Spotify artist by ID',
    inputSchema: {
        type: 'object',
        properties: {
            artistId: { type: 'string', description: "Spotify artist ID" }
        },
        required: ['artistId']
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const artist = await spotifyGet(`/artists/${encodeURIComponent(input.artistId)}`);
        return simplifyArtist(artist);
    }
});

toolRegistry.register({
    name: 'spotify.getAlbum',
    description: 'Retrieve details of a Spotify album by ID',
    inputSchema: {
        type: 'object',
        properties: {
            albumId: { type: 'string', description: "Spotify album ID" }
        },
        required: ['albumId']
    },
    sideEffecting: false,
    handler: async (_ctx, input) => {
        const album = await spotifyGet(`/albums/${encodeURIComponent(input.albumId)}`);
        return simplifyAlbum(album);
    }
});
