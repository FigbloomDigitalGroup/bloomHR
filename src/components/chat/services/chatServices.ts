// services/chatServices.ts
import { supabase } from "../../../lib/supabase";
import type { Channel, Message, Employee, DirectMessage } from "../types/types";
import { AvatarService } from './avatar';
import type { DirectoryPerson, Member } from '../lib/groups';
import { chatDisplayName, directMessageId, initialsOf, isDirectMessageId, realChannelId } from '../lib/names';
import { toUnreadCounts, type UnreadCounts } from '../lib/unread';

/** How many of a channel's latest messages the chat loads. */
const CHANNEL_HISTORY_LIMIT = 500;

interface MessageRow {
  id: string;
  content: string;
  author_id: string;
  author_name?: string | null;
  author_avatar?: string | null;
  author_initials?: string | null;
  author_town?: string | null;
  created_at: string;
  reactions?: Message['reactions'] | null;
}

const toMessage = (msg: MessageRow): Message => ({
  id: msg.id,
  content: msg.content,
  author: {
    id: msg.author_id,
    name: msg.author_name || 'Unknown User',
    avatar: msg.author_avatar || '',
    initials: msg.author_initials || 'UU',
    email: '',
    status: 'online',
    town: msg.author_town || 'Unknown'
  },
  timestamp: msg.created_at,
  reactions: msg.reactions || []
});

class ChatService {
  private isInitialized = false;

  async initialize() {
    if (this.isInitialized) return;

    // the chat tables come from migrations; the old "create the tables from the browser" calls only failed (404s)
    this.isInitialized = true;
  }

  async getEmployees(): Promise<Employee[]> {
    try {
      console.log("📊 Fetching employees from database...");

      const { data, error } = await supabase
        .from('employee_directory')
        .select('*')
        .order('First Name', { ascending: true });

      if (error) {
        console.error('Error fetching employees:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        console.warn('No employees found in database');
        return [];
      }

      const employees: Employee[] = data.map(emp => {
        const firstName = emp["First Name"] || '';
        const lastName = emp["Last Name"] || '';
        const fullName = `${firstName} ${lastName}`.trim();
        const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();

        const avatarSeed = emp["Employee Number"] || emp["Work Email"] || fullName || `employee-${Math.random()}`;

        const profileImage = emp["Profile Image"] || 
          AvatarService.generateAvatar(avatarSeed, 'adventurer');

        return {
          id: emp["Employee Number"] || emp["Employee Id"]?.toString() || `emp-${Math.random()}`,
          employeeNumber: emp["Employee Number"] || '',
          firstName: firstName,
          middleName: emp["Middle Name"],
          lastName: lastName,
          fullName: fullName,
          workEmail: emp["Work Email"] || '',
          personalEmail: emp["Personal Email"],
          mobileNumber: emp["Mobile Number"] || emp["Personal Mobile"],
          workMobile: emp["Work Mobile"],
          jobTitle: emp["Job Title"] || emp["Job Group"] || 'Employee',
          jobGroup: emp["Job Group"],
          department: emp["Office"] || emp["Branch"] || 'General',
          entity: emp["Entity"] || 'Company',
          branch: emp["Branch"],
          manager: emp["Manager"],
          profileImage: profileImage,
          status: this.getEmployeeStatus(emp),
          initials: initials || 'E',
          startDate: emp["Start Date"]
        };
      });

      console.log(`✅ Successfully loaded ${employees.length} employees`);
      return employees;

    } catch (error) {
      console.error('❌ Error in getEmployees:', error);
      throw error;
    }
  }

  private getEmployeeStatus(emp: any): 'online' | 'away' | 'offline' {
    const workStatus = emp["Employee Type"] || emp["Status"];
    if (workStatus === 'Active' || workStatus === 'Full-time') return 'online';
    if (workStatus === 'Part-time' || workStatus === 'Away') return 'away';
    return 'offline';
  }

  async getUserChannels(userId: string): Promise<(Channel | DirectMessage)[]> {
    try {
      console.log("📡 Fetching channels for user:", userId);

      // one query for every channel's unread count, shared by the channels and the direct messages
      const unread = await this.getUnreadCounts();
      const [regularChannels, directMessages] = await Promise.all([
        this.getRegularChannels(userId, unread),
        this.getDirectMessageChannels(userId, unread),
      ]);
      const allChannels = [...regularChannels, ...directMessages];

      console.log(`✅ Loaded ${allChannels.length} channels`);
      return allChannels;

    } catch (error) {
      console.error('❌ Error fetching user channels:', error);
      return this.getDefaultChannels();
    }
  }

  /** My direct messages, as chat entries ("dm-<conversation id>") that remember who is on the other end. */
  private async getDirectMessageChannels(userId: string, unread: UnreadCounts): Promise<Channel[]> {
    try {
      const { data, error } = await supabase.rpc('my_direct_messages');
      if (error || !data) return [];
      const rows = data as { channel_id: string; other_user_id: string; other_email: string }[];
      const partners = await this.getPartnerIdentities(rows);
      return rows.map((row) => ({
        id: directMessageId(row.channel_id),
        name: `DM with ${row.other_email}`,
        type: 'channel' as const,
        isPrivate: true,
        memberCount: 2,
        unread_count: unread[row.channel_id] || 0,
        createdBy: userId,
        createdAt: new Date().toISOString(),
        partnerEmail: (row.other_email || '').toLowerCase(),
        partnerName: partners[row.channel_id]?.name,
        partnerAvatar: partners[row.channel_id]?.avatar,
      })) as Channel[];
    } catch (error) {
      console.error('Error loading direct messages:', error);
      return [];
    }
  }

  /**
   * For people with no employee record: the name and picture their own messages carry (what they see as their name),
   * falling back to the profile picture on their login. Keyed by conversation id.
   */
  private async getPartnerIdentities(
    rows: { channel_id: string; other_user_id: string; other_email: string }[]
  ): Promise<Record<string, { name?: string; avatar?: string }>> {
    const result: Record<string, { name?: string; avatar?: string }> = {};
    if (rows.length === 0) return result;
    const [messagesResult, membersResult] = await Promise.all([
      supabase
        .from('messages')
        .select('channel_id, author_id, author_name, author_avatar, created_at')
        .in('channel_id', rows.map((r) => r.channel_id))
        .in('author_id', rows.map((r) => r.other_user_id))
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.rpc('company_members'),
    ]);
    const avatars = new Map(
      ((membersResult.data || []) as { user_id: string; avatar_url?: string | null }[]).map((m) => [m.user_id, m.avatar_url || undefined])
    );
    for (const row of rows) {
      const latest = (messagesResult.data || []).find(
        (m: { channel_id: string; author_id: string }) => m.channel_id === row.channel_id && m.author_id === row.other_user_id
      ) as { author_name?: string; author_avatar?: string } | undefined;
      result[row.channel_id] = {
        name: latest?.author_name || undefined,
        avatar: avatars.get(row.other_user_id) || latest?.author_avatar || undefined,
      };
    }
    return result;
  }

  /**
   * Starts (or reopens) the private conversation with a colleague and returns its chat id. The colleague must have
   * joined the company: a message needs a login at the other end, an employee record alone is not enough.
   */
  async startDirectMessage(colleagueEmail: string): Promise<string> {
    const wanted = (colleagueEmail || '').trim().toLowerCase();
    const { data: members, error: membersError } = await supabase.rpc('company_members');
    if (membersError) throw new Error(membersError.message || 'Could not look up your colleagues');
    const person = ((members || []) as { user_id: string; email: string }[]).find((m) => (m.email || '').toLowerCase() === wanted);
    if (!person) {
      throw new Error("They haven't joined yet, so they have no login to receive messages. Invite them first (Settings > Invite people).");
    }
    const { data: conversation, error } = await supabase.rpc('start_direct_message', { p_other: person.user_id });
    if (error || !conversation) throw new Error(error?.message || 'Could not start the conversation');
    return directMessageId(conversation as string);
  }

  /** Who can be invited to a channel: the colleagues who have joined, and the employee directory the groups come from. */
  async getInviteOptions(): Promise<{ members: Member[]; people: DirectoryPerson[] }> {
    const [membersResult, peopleResult] = await Promise.all([
      supabase.rpc('company_members'),
      supabase.from('employee_directory').select('"Work Email", "First Name", "Last Name", "Job Level", "Job Title", "Town"'),
    ]);
    if (membersResult.error) throw new Error(membersResult.error.message || 'Could not load your colleagues');
    return {
      members: (membersResult.data || []) as Member[],
      people: (peopleResult.error ? [] : peopleResult.data || []) as unknown as DirectoryPerson[],
    };
  }

  /** Adds colleagues to a channel (its creator or an administrator only). Returns how many were added. */
  async addChannelMembers(channelId: string, userIds: string[]): Promise<number> {
    if (userIds.length === 0) return 0;
    const { data, error } = await supabase.rpc('add_channel_members', { p_channel: channelId, p_users: userIds });
    if (error) throw new Error(error.message || 'Could not add people to the channel');
    return Number(data) || 0;
  }

  private async getRegularChannels(userId: string, unreadCounts: UnreadCounts): Promise<Channel[]> {
    const { data: userData } = await supabase.auth.getUser();
    const userEmail = userData.user?.email;

    const { data: employeeData } = await supabase
      .from('employees')
      .select('"Job Title"')
      .eq('Work Email', userEmail)
      .maybeSingle();

    const userJobTitle = employeeData?.["Job Title"];

    let query = supabase
      .from('channels')
      .select('*')
      .order('created_at', { ascending: true });

    if (userJobTitle) {
      query = query.or(`is_private.eq.false,job_title.eq.${userJobTitle}`);
    } else {
      query = query.eq('is_private', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching channels:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return [];
    }

    const channels: Channel[] = data.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: 'channel',
      description: channel.description || `Channel for ${channel.name}`,
      isPrivate: channel.is_private || false,
      memberCount: channel.member_count || 1,
      unread_count: unreadCounts[channel.id] || 0,
      createdBy: channel.created_by || userId,
      createdAt: channel.created_at || new Date().toISOString()
    }));

    return channels;
  }

  /**
   * Unread messages in every channel I can see (direct messages included), by channel id, from one query:
   * my_unread_counts() reads `user_channel_states.last_read_at` (a channel I never opened counts as fully unread) and
   * stops each count at 100 (the badges show 99+). The open chat keeps them current from realtime after that.
   */
  async getUnreadCounts(): Promise<UnreadCounts> {
    try {
      const { data, error } = await supabase.rpc('my_unread_counts');
      if (error) throw error;
      return toUnreadCounts(data as { channel_id: string; unread: number }[]);
    } catch (error) {
      console.error('Error computing unread counts:', error);
      return {};
    }
  }

  private getDefaultChannels(): Channel[] {
    return [
      {
        id: 'general',
        name: 'general',
        type: 'channel',
        description: 'Company-wide announcements and chat',
        isPrivate: false,
        memberCount: 1,
        unread_count: 0,
        createdBy: 'system',
        createdAt: new Date().toISOString()
      }
    ];
  }

  async getChannelMessages(channelId: string): Promise<Message[]> {
    try {
      console.log("📨 Fetching messages for:", channelId);

      // a direct message is a real conversation, stored like any channel under its own id. The latest messages,
      // newest first then put back in order: oldest first, the API stops at 1000 rows, so a busy channel (every
      // company's general) showed its first 1000 messages and never the new ones.
      const { data: latest, error } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', realChannelId(channelId))
        .order('created_at', { ascending: false })
        .limit(CHANNEL_HISTORY_LIMIT);
      const data = latest ? [...latest].reverse() : latest;

      if (error) {
        console.error('❌ Error fetching messages:', error);
        return this.getWelcomeMessage(channelId);
      }

      if (!data || data.length === 0) {
        return this.getWelcomeMessage(channelId);
      }

      return data.map(toMessage);

    } catch (error) {
      console.error('❌ Error fetching messages:', error);
      return this.getWelcomeMessage(channelId);
    }
  }

  private getWelcomeMessage(channelId: string): Message[] {
    return [
      {
        id: 'welcome-' + channelId,
        content: isDirectMessageId(channelId)
          ? 'This is the start of your private conversation. Say hello! 👋'
          : `Welcome to the channel! This is the beginning of the conversation. 👋`,
        author: {
          id: 'system',
          name: 'Figbloom Teams',
          avatar: '',
          initials: 'FT',
          email: 'system@figbloomteams.com',
          status: 'online'
        },
        timestamp: new Date().toISOString(),
        reactions: []
      }
    ];
  }

  async sendMessage(channelId: string, userId: string, content: string): Promise<Message | null> {
    try {
      console.log("💬 Sending message to channel:", channelId);

      // channels and direct messages are stored the same way
      const isDirect = isDirectMessageId(channelId);
      const { data: userData } = await supabase.auth.getUser();
      const userEmail = userData.user?.email;

      const { data: employeeData } = await supabase
        .from('employees')
        .select('"First Name", "Last Name", "Profile Image", "Town", "City", "Branch", "Employee Number"')
        .eq('Work Email', userEmail)
        .single();

      const firstName = employeeData?.["First Name"] || '';
      const lastName = employeeData?.["Last Name"] || '';
      // an administrator with no employee record is shown by the name they gave, or their email, never as "User"
      const fullName = chatDisplayName({ firstName, lastName, metadata: userData.user?.user_metadata, email: userEmail });
      const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || initialsOf(fullName);
      const town = employeeData?.["Town"] || employeeData?.["City"] || employeeData?.["Branch"] || 'Unknown';

      let userAvatar = employeeData?.["Profile Image"] || '';
      if (!userAvatar) {
        const avatarSeed = employeeData?.["Employee Number"] || userEmail || fullName || userId;
        userAvatar = AvatarService.generateAvatar(avatarSeed, 'adventurer');
      }

      // `topic`/`extension` were never real columns on `messages` (see
      // master_schema.sql) - this insert always errored and silently fell
      // back to createMockMessage below, so channel messages looked sent
      // but were never actually persisted (FIG-577).
      const { data, error } = await supabase
        .from('messages')
        .insert({
          channel_id: realChannelId(channelId),
          author_id: userId,
          content: content,
          created_at: new Date().toISOString(),
          author_name: fullName,
          author_initials: initials,
          author_town: town,
          author_avatar: userAvatar
        })
        .select()
        .single();

      if (error) {
        console.error('Error sending message:', error);
        // a private conversation must never pretend a message was delivered
        if (isDirect) throw new Error(error.message || 'The message could not be sent');
        return this.createMockMessage(userId, fullName, initials, content, town, userAvatar);
      }

      const newMessage: Message = {
        id: data.id,
        content: data.content,
        author: {
          id: userId,
          name: fullName,
          avatar: userAvatar,
          initials: initials,
          email: userEmail || '',
          status: 'online',
          town: town
        },
        timestamp: data.created_at,
        reactions: []
      };

      console.log("✅ Message sent successfully:", newMessage.id);
      return newMessage;

    } catch (error) {
      console.error('Error sending message:', error);
      if (isDirectMessageId(channelId)) throw error instanceof Error ? error : new Error('The message could not be sent');
      const { data: userData } = await supabase.auth.getUser();
      const userName = chatDisplayName({ metadata: userData.user?.user_metadata, email: userData.user?.email });

      return this.createMockMessage(userId, userName, initialsOf(userName), content, 'Unknown', '');
    }
  }

  private createMockMessage(
    userId: string, 
    userName: string, 
    initials: string, 
    content: string, 
    town?: string, 
    avatar?: string
  ): Message {
    return {
      id: `mock-${Date.now()}`,
      content,
      author: {
        id: userId,
        name: userName,
        avatar: avatar || '',
        initials: initials,
        email: '',
        status: 'online',
        town: town || 'Unknown'
      },
      timestamp: new Date().toISOString(),
      reactions: []
    };
  }

  async createChannel(name: string, userId: string, isPrivate: boolean = false, jobTitle?: string): Promise<Channel> {
    try {
      console.log("🆕 Creating channel:", name);

      const channelId = crypto.randomUUID();

      const { data, error } = await supabase
        .from('channels')
        .insert({
          id: channelId,
          name: name,
          type: 'channel',
          is_private: isPrivate,
          job_title: jobTitle,
          created_by: userId,
          created_at: new Date().toISOString(),
          member_count: 1
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Database error creating channel:', error);
        throw error;
      }

      console.log("✅ Channel created in DATABASE:", data.id);

      const newChannel: Channel = {
        id: data.id,
        name: data.name,
        type: 'channel',
        isPrivate: data.is_private,
        memberCount: data.member_count,
        createdBy: data.created_by,
        createdAt: data.created_at
      };

      return newChannel;

    } catch (error) {
      console.error('❌ Error creating channel:', error);
      throw error;
    }
  }

  async markMessagesAsRead(channelId: string, userId: string): Promise<void> {
    try {
      console.log(`📖 Marking messages as read for channel ${channelId}`);

      const { error } = await supabase
        .from('user_channel_states')
        .upsert({
          user_id: userId,
          channel_id: realChannelId(channelId),
          last_read_at: new Date().toISOString()
        });

      if (error) {
        console.warn('Error marking messages as read:', error);
      }

    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }

  subscribeToMessages(channelId: string, callback: (message: Message) => void): any {
    try {
      console.log(`🔔 Setting up real-time subscription for channel: ${channelId}`);

      const conversationId = realChannelId(channelId);

      const subscription = supabase
        .channel(`messages:${conversationId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `channel_id=eq.${conversationId}`
          },
          async (payload) => {
            // the inserted row comes with the event: reading it back again was one more query per person watching
            // the channel for every message
            if (payload.new?.id && payload.new.content !== undefined) {
              callback(toMessage(payload.new as MessageRow));
              return;
            }
            try {
              const { data: messageData } = await supabase
                .from('messages')
                .select(`*`)
                .eq('id', payload.new.id)
                .single();
              if (messageData) callback(toMessage(messageData));
            } catch (fetchError) {
              console.error('Error fetching message details:', fetchError);
            }
          }
        )
        .subscribe();

      return subscription;

    } catch (error) {
      console.error('Error setting up real-time subscription:', error);
      return null;
    }
  }

  unsubscribe(subscription: any): void {
    try {
      if (subscription) {
        supabase.removeChannel(subscription);
        console.log('🔕 Unsubscribed from real-time updates');
      }
    } catch (error) {
      console.error('Error unsubscribing:', error);
    }
  }
}

export const chatService = new ChatService();