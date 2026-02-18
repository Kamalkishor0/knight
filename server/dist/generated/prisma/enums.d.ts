export declare const FriendshipStatus: {
    readonly PENDING: "PENDING";
    readonly ACCEPTED: "ACCEPTED";
    readonly REJECTED: "REJECTED";
};
export type FriendshipStatus = (typeof FriendshipStatus)[keyof typeof FriendshipStatus];
