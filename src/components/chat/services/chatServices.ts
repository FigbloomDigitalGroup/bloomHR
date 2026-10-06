// services/chatServices.ts
import { supabase } from "../../../lib/supabase";
import { databaseService } from "./databaseService";
import type { Channel, Message, Employee, DirectMessage } from "../types/types";
import { AvatarService } from './avatar';
import { chatDisplayName, directMessageId, initialsOf, isDirectMessageId, realChannelId } from '../lib/names';

class ChatService {
  private isInitialized = false;

  async initialize() {
    if (this.isInitialized) return;

    try {
      await databaseService.initializeDatabase();
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize database:', error);
    }
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

      const regularChannels = await this.getRegularChannels(userId);
      const directMessages = await this.getDirectMessageChannels(userId);
      const allChannels = [...regularChannels, ...directMessages];

      console.log(`✅ Loaded ${allChannels.length} channels`);
      return allChannels;

    } catch (error) {
      console.error('❌ Error fetching user channels:', error);
      return this.getDefaultChannels();
    }
  }

  /** My direct messages, as chat entries ("dm-<conversation id>") that remember who is on the other end. */
  private async getDirectMessageChannels(userId: string): Promise<Channel[]> {
    try {
      const { data, error } = await supabase.rpc('my_direct_messages');
      if (error || !data) return [];
      const rows = data as { channel_id: string; other_user_id: string; other_email: string }[];
      const unread = await this.getUnreadCountsByChannel(userId, rows.map((r) => r.channel_id));
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
      })) as Channel[];
    } catch (error) {
      console.error('Error loading direct messages:', error);
      return [];
    }
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

  private async getRegularChannels(userId: string): Promise<Channel[]> {
    const { data: userData } = await supabase.auth.getUser();
    const userEmail = userData.user?.email;

    const { data: employeeData } = await supabase
      .from('employees')
      .select('"Job Title"')
      .eq('Work Email', userEmail)
      .single();

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

    const unreadCounts = await this.getUnreadCountsByChannel(userId, data.map(c => c.id));

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

  // Real per-channel unread counts via `user_channel_states.last_read_at`
  // (the same table `markMessagesAsRead` already writes to, but until now
  // nothing ever read it back - every channel's `unread_count` was a
  // hardcoded 0, since `channels` itself has no such column). A channel
  // with no read-state row yet counts as fully unread.
  private async getUnreadCountsByChannel(userId: string, channelIds: string[]): Promise<Record<string, number>> {
    if (channelIds.length === 0) return {};

    try {
      const { data: readStates } = await supabase
        .from('user_channel_states')
        .select('channel_id, last_read_at')
        .eq('user_id', userId);

      const lastReadMap = new Map((readStates || []).map((r: any) => [r.channel_id, r.last_read_at]));

      const entries = await Promise.all(channelIds.map(async (channelId) => {
        const lastRead = lastReadMap.get(channelId);
        let query = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('channel_id', channelId);
        if (lastRead) query = query.gt('created_at', lastRead);
        const { count } = await query;
        return [channelId, count || 0] as const;
      }));

      return Object.fromEntries(entries);
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

      // a direct message is a real conversation, stored like any channel under its own id
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', realChannelId(channelId))
        .order('created_at', { ascending: true });

      if (error) {
        console.error('❌ Error fetching messages:', error);
        return this.getWelcomeMessage(channelId);
      }

      if (!data || data.length === 0) {
        return this.getWelcomeMessage(channelId);
      }

      const messages: Message[] = data.map(msg => ({
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
      }));

      return messages;

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
          email: userEmail,
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
            console.log('📨 New real-time message:', payload);

            try {
              const { data: messageData } = await supabase
                .from('messages')
                .select(`*`)
                .eq('id', payload.new.id)
                .single();

              if (messageData) {
                const newMessage: Message = {
                  id: messageData.id,
                  content: messageData.content,
                  author: {
                    id: messageData.author_id,
                    name: messageData.author_name || 'Unknown User',
                    avatar: messageData.author_avatar || '',
                    initials: messageData.author_initials || 'UU',
                    email: '',
                    status: 'online',
                    town: messageData.author_town || 'Unknown'
                  },
                  timestamp: messageData.created_at,
                  reactions: messageData.reactions || []
                };

                callback(newMessage);
              }
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