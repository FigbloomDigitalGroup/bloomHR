/** Starting chat channels (and so choosing their names) is the "Create chat channels" module; everyone else uses
 *  what exists. Administrators hold every module. The database checks the same module. */
export const CHANNEL_CREATOR_MODULE = 'chat-channels';

export const canCreateChannels = (hasPermission: (module: string) => boolean): boolean => hasPermission(CHANNEL_CREATOR_MODULE);
