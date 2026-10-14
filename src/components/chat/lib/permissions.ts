/** Who creates channels (and so chooses their names) is the 'create-channels' module, given to roles under Role &
 *  Permissions (administrators always have it). The database enforces the same (20261015300000_company_roles.sql);
 *  everyone else uses the channels that exist. */
export const CREATE_CHANNELS_MODULE = 'create-channels';

export const canCreateChannels = (hasPermission: (module: string) => boolean): boolean => hasPermission(CREATE_CHANNELS_MODULE);
