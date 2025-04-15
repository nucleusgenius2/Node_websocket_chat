export interface GlobalObjectUser {
    countUserChat: number;
    usersData: Record<string, UserData>;
    usersList: Record<string, UserList>;
}

export interface UserData {
    id: number;
    u_uuid: string;
    name: string;
    level: number;
    avatar: string | null;
    iat: number;
    exp: number;
    game_id?: string;
}

export interface UserList {
    u_uuid: string;
    name: string;
    level: number;
    avatar: string | null;
}

