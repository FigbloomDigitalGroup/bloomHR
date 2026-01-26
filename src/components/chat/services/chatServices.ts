// services/chatServices.ts
import { supabase } from "../../../lib/supabase";
import { databaseService } from "./databaseService";
import type { Channel, Message, User, Employee, DirectMessage } from "../types/types";
import { AvatarService } from './avatar';

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
        .from('employees')
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
      const allChannels = [...regularChannels];
      
      console.log(`✅ Loaded ${allChannels.length} channels`);
      return allChannels;

    } catch (error) {
      console.error('❌ Error fetching user channels:', error);
      return this.getDefaultChannels();
    }
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
      return await this.createDefaultChannels();
    }
    
    const channels: Channel[] = data.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: 'channel',
      description: channel.description || `Channel for ${channel.name}`,
      isPrivate: channel.is_private || false,
      memberCount: channel.member_count || 1,
      unread_count: channel.unread_count || 0,
      createdBy: channel.created_by || userId,
      createdAt: channel.created_at || new Date().toISOString()
    }));

    return channels;
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

  private async createDefaultChannels(): Promise<Channel[]> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id;
      
      if (!currentUserId) {
        return this.getDefaultChannels();
      }

      const defaultChannels = [
        { name: 'general', description: 'Company-wide announcements and chat', is_private: false },
        { name: 'engineering', description: 'Engineering team discussions', is_private: false, job_title: 'Software Engineer' },
        { name: 'design', description: 'Design team collaboration', is_private: false, job_title: 'Designer' },
        { name: 'product', description: 'Product management discussions', is_private: false, job_title: 'Product Manager' }
      ];

      const channels: Channel[] = [];

      for (const channelData of defaultChannels) {
        const channel = await this.createChannel(
          channelData.name, 
          currentUserId,
          channelData.is_private, 
          channelData.job_title
        );
        if (channel) {
          channels.push(channel);
        }
      }

      return channels;
    } catch (error) {
      console.error('Error creating default channels:', error);
      return this.getDefaultChannels();
    }
  }

  async getChannelMessages(channelId: string): Promise<Message[]> {
    try {
      console.log("📨 Fetching messages for:", channelId);

      // For DM channels, return welcome message
      if (channelId.startsWith('dm-')) {
        return this.getWelcomeMessage(channelId);
      }

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', channelId)
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
        content: `Welcome to the channel! This is the beginning of the conversation. 👋`,
        author: {
          id: 'system',
          name: 'ZiraTeams',
          avatar: '',
          initials: 'ZT',
          email: 'system@zirateams.com',
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
      
      // For DM channels, create mock message
      if (channelId.startsWith('dm-')) {
        console.log('💬 DM message - creating local message');
        
        const { data: userData } = await supabase.auth.getUser();
        const userEmail = userData.user?.email;
        
        const { data: employeeData } = await supabase
          .from('employees')
          .select('"First Name", "Last Name", "Profile Image"')
          .eq('Work Email', userEmail)
          .single();

        const firstName = employeeData?.["First Name"] || '';
        const lastName = employeeData?.["Last Name"] || '';
        const fullName = `${firstName} ${lastName}`.trim() || userData.user?.user_metadata?.name || 'User';
        const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || 'U';

        const mockMessage: Message = {
          id: `dm-msg-${Date.now()}`,
          content: content,
          author: {
            id: userId,
            name: fullName,
            avatar: employeeData?.["Profile Image"] || '',
            initials: initials,
            email: userEmail || '',
            status: 'online',
            town: 'Unknown'
          },
          timestamp: new Date().toISOString(),
          reactions: []
        };

        console.log('✅ DM message created (local)');
        return mockMessage;
      }
      
      // Regular channel message
      const { data: userData } = await supabase.auth.getUser();
      const userEmail = userData.user?.email;

      const { data: employeeData } = await supabase
        .from('employees')
        .select('"First Name", "Last Name", "Profile Image", "Town", "City", "Branch", "Employee Number"')
        .eq('Work Email', userEmail)
        .single();

      const firstName = employeeData?.["First Name"] || '';
      const lastName = employeeData?.["Last Name"] || '';
      const fullName = `${firstName} ${lastName}`.trim() || userData.user?.user_metadata?.name || 'User';
      const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || 'U';
      const town = employeeData?.["Town"] || employeeData?.["City"] || employeeData?.["Branch"] || 'Unknown';

      let userAvatar = employeeData?.["Profile Image"] || '';
      if (!userAvatar) {
        const avatarSeed = employeeData?.["Employee Number"] || userEmail || fullName || userId;
        userAvatar = AvatarService.generateAvatar(avatarSeed, 'adventurer');
      }

      const { data, error } = await supabase
        .from('messages')
        .insert({
          channel_id: channelId,
          topic: 'general',
          author_id: userId,
          content: content,
          extension: 'text',
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
      const { data: userData } = await supabase.auth.getUser();
      const userName = userData.user?.user_metadata?.name || 'User';
      
      return this.createMockMessage(userId, userName, 'U', content, 'Unknown', '');
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
      if (channelId.startsWith('dm-')) {
        return;
      }

      console.log(`📖 Marking messages as read for channel ${channelId}`);
      
      const { error } = await supabase
        .from('user_channel_states')
        .upsert({
          user_id: userId,
          channel_id: channelId,
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
      
      // Skip real-time for DM channels
      if (channelId.startsWith('dm-')) {
        return null;
      }

      const subscription = supabase
        .channel(`messages:${channelId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `channel_id=eq.${channelId}`
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