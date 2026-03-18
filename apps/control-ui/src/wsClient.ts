// Copyright (c) 2026 Flavio Cerato
import type { Frame } from '@9lives/shared';

export class WsClient {
    private ws: WebSocket | null = null;
    private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
    private eventListeners = new Map<string, Set<(data: any) => void>>();
    private connectResolve: (() => void) | null = null;
    private connectReject: ((e: any) => void) | null = null;

    constructor(private url: string) { }

    connect(token: string, deviceName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.connectResolve = resolve;
            this.connectReject = reject;

            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                // Send the connect frame — wait for server's 'res id=init' to resolve
                this.ws!.send(JSON.stringify({
                    type: 'connect',
                    params: {
                        auth: { token },
                        device: { id: crypto.randomUUID(), name: deviceName },
                    },
                }));
            };

            this.ws.onmessage = (ev) => {
                try {
                    const frame = JSON.parse(ev.data as string) as Frame;
                    this.handleFrame(frame);
                } catch (_) { }
            };

            this.ws.onerror = () => {
                this.connectReject?.('WebSocket connection error');
                this.connectReject = null;
            };

            this.ws.onclose = (ev) => {
                // If we haven't resolved/rejected yet, this is an auth failure
                if (this.connectReject) {
                    this.connectReject(`Connection closed (code ${ev.code}): ${ev.reason || 'Auth failed or server unreachable'}`);
                    this.connectReject = null;
                }
                // Reject all pending requests
                this.pendingRequests.forEach(({ reject }) => reject('Connection closed'));
                this.pendingRequests.clear();
            };
        });
    }

    private handleFrame(frame: Frame) {
        if (frame.type === 'res' && frame.id === 'init') {
            // Auth response
            if (frame.ok) {
                this.connectResolve?.();
            } else {
                this.connectReject?.(`Auth failed: ${frame.error?.message ?? 'unknown'}`);
            }
            this.connectResolve = null;
            this.connectReject = null;
            return;
        }

        if (frame.type === 'res') {
            const pending = this.pendingRequests.get(frame.id);
            if (pending) {
                if (frame.ok) pending.resolve(frame.payload);
                else pending.reject(frame.error);
                this.pendingRequests.delete(frame.id);
            }
            return;
        }

        if (frame.type === 'event') {
            const listeners = this.eventListeners.get(frame.event);
            listeners?.forEach(cb => cb(frame.payload));
        }
    }

    request(method: string, params: any = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject('WebSocket not connected');
                return;
            }
            const id = crypto.randomUUID();
            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
        });
    }

    on(event: string, callback: (data: any) => void) {
        if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
        this.eventListeners.get(event)!.add(callback);
    }

    off(event: string, callback: (data: any) => void) {
        this.eventListeners.get(event)?.delete(callback);
    }
}
