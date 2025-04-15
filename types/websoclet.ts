import { WebSocket } from 'ws';
import {UserList} from "./user";

export interface CustomWebSocket extends WebSocket {
    user_uuid?: string;
    message_timestamps?: number[];
}

export interface UserPublicData {
    level: number;
    name: string;
    avatar: string | null;
}

export interface StartData {
    type: string;
    data?: UserList;
    users?: Record<string, UserList>;
}

export interface DataSend {
    type: string;
    u_uuid: string;
    data?: string;
    user?: UserPublicData
}

export interface DataSendPersonal {
    type: string;
    u_uuid: string;
    data?: string;
    user?: UserPublicData
}




