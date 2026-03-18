// Copyright (c) 2026 Flavio Cerato
export type FrameType = 'connect' | 'req' | 'res' | 'event';

export interface ConnectFrame {
    type: 'connect';
    params: {
        auth: { token: string };
        device: { id: string; name: string };
    };
}

export interface RequestFrame {
    type: 'req';
    id: string;
    method: string;
    params: Record<string, any>;
}

export interface ResponseFrame {
    type: 'res';
    id: string;
    ok: boolean;
    payload?: any;
    error?: {
        code: string;
        message: string;
    };
}

export interface ServerEventFrame {
    type: 'event';
    event: string;
    payload: any;
}

export type Frame = ConnectFrame | RequestFrame | ResponseFrame | ServerEventFrame;
