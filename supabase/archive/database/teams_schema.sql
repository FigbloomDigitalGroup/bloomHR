-- ZiraTeams Database Schema
-- Complete database setup for the Teams module
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. CHANNELS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'channel' CHECK (type IN ('channel', 'direct_message')),
  is_private BOOLEAN DEFAULT false,
  job_title TEXT, -- For role-specific channels
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for channels
CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);
CREATE INDEX IF NOT EXISTS idx_channels_created_by ON channels(created_by);
CREATE INDEX IF NOT EXISTS idx_channels_job_title ON channels(job_title) WHERE job_title IS NOT NULL;

-- Comments
COMMENT ON TABLE channels IS 'Team channels and direct message containers';
COMMENT ON COLUMN channels.type IS 'Type of channel: channel or direct_message';
COMMENT ON COLUMN channels.is_private IS 'Whether channel is private (invite-only)';
COMMENT ON COLUMN channels.job_title IS 'Job title restriction for role-specific channels';

-- ============================================
-- 2. CHANNEL MEMBERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS channel_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_read_at TIMESTAMP WITH TIME ZONE,
  is_muted BOOLEAN DEFAULT false,
  UNIQUE(channel_id, user_id)
);

-- Indexes for channel_members
CREATE INDEX IF NOT EXISTS idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

-- Comments
COMMENT ON TABLE channel_members IS 'Channel membership and user-specific settings';
COMMENT ON COLUMN channel_members.role IS 'User role in channel: owner, admin, or member';
COMMENT ON COLUMN channel_members.last_read_at IS 'Last time user read messages in this channel';
COMMENT ON COLUMN channel_members.is_muted IS 'Whether user has muted notifications for this channel';

-- ============================================
-- 3. MESSAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_avatar TEXT,
  author_initials TEXT,
  author_town TEXT,
  content TEXT NOT NULL,
  reactions JSONB DEFAULT '[]',
  mentions JSONB DEFAULT '[]',
  attachments JSONB DEFAULT '[]',
  reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
  is_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to) WHERE reply_to IS NOT NULL;

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_messages_content_search ON messages USING gin(to_tsvector('english', content));

-- Comments
COMMENT ON TABLE messages IS 'Team messages with rich content support';
COMMENT ON COLUMN messages.reactions IS 'Array of emoji reactions: [{emoji: string, users: string[]}]';
COMMENT ON COLUMN messages.mentions IS 'Array of mentioned user IDs';
COMMENT ON COLUMN messages.attachments IS 'Array of file attachments: [{url, name, type, size}]';
COMMENT ON COLUMN messages.reply_to IS 'ID of message being replied to (for threading)';

-- ============================================
-- 4. MESSAGE REACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- Indexes for message_reactions
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON message_reactions(user_id);

-- Comments
COMMENT ON TABLE message_reactions IS 'Individual emoji reactions to messages';

-- ============================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Channels Policies
CREATE POLICY "Users can view channels they are members of"
  ON channels FOR SELECT
  USING (
    auth.role() = 'authenticated' AND (
      is_private = false OR
      id IN (SELECT channel_id FROM channel_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Authenticated users can create channels"
  ON channels FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND created_by = auth.uid());

CREATE POLICY "Channel owners can update channels"
  ON channels FOR UPDATE
  USING (
    id IN (
      SELECT channel_id FROM channel_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Channel owners can delete channels"
  ON channels FOR DELETE
  USING (
    id IN (
      SELECT channel_id FROM channel_members 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Channel Members Policies
CREATE POLICY "Users can view channel members"
  ON channel_members FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    channel_id IN (SELECT channel_id FROM channel_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can join public channels"
  ON channel_members FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    user_id = auth.uid() AND
    (
      channel_id IN (SELECT id FROM channels WHERE is_private = false) OR
      channel_id IN (SELECT channel_id FROM channel_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update their own membership"
  ON channel_members FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can leave channels"
  ON channel_members FOR DELETE
  USING (user_id = auth.uid());

-- Messages Policies
CREATE POLICY "Users can view messages in their channels"
  ON messages FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    channel_id IN (SELECT channel_id FROM channel_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can send messages to their channels"
  ON messages FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    author_id = auth.uid() AND
    channel_id IN (SELECT channel_id FROM channel_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update their own messages"
  ON messages FOR UPDATE
  USING (author_id = auth.uid());

CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE
  USING (author_id = auth.uid());

-- Message Reactions Policies
CREATE POLICY "Users can view reactions"
  ON message_reactions FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    message_id IN (
      SELECT id FROM messages WHERE channel_id IN (
        SELECT channel_id FROM channel_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can add reactions"
  ON message_reactions FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());

CREATE POLICY "Users can remove their own reactions"
  ON message_reactions FOR DELETE
  USING (user_id = auth.uid());

-- ============================================
-- 6. FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-add creator as channel owner
CREATE OR REPLACE FUNCTION add_creator_as_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO channel_members (channel_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_add_channel_owner
  AFTER INSERT ON channels
  FOR EACH ROW
  EXECUTE FUNCTION add_creator_as_owner();

-- Function to update unread count
CREATE OR REPLACE FUNCTION get_unread_count(p_channel_id UUID, p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_last_read TIMESTAMP WITH TIME ZONE;
  v_count INTEGER;
BEGIN
  -- Try to get last_read_at, handle if column doesn't exist
  BEGIN
    SELECT last_read_at INTO v_last_read
    FROM channel_members
    WHERE channel_id = p_channel_id AND user_id = p_user_id;
  EXCEPTION
    WHEN undefined_column THEN
      v_last_read := NULL;
  END;
  
  IF v_last_read IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM messages
    WHERE channel_id = p_channel_id;
  ELSE
    SELECT COUNT(*) INTO v_count
    FROM messages
    WHERE channel_id = p_channel_id AND created_at > v_last_read;
  END IF;
  
  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. DEFAULT CHANNELS
-- ============================================

-- Insert default public channels (only if they don't exist)
INSERT INTO channels (id, name, description, type, is_private, created_by)
SELECT 
  gen_random_uuid(),
  'general',
  'Company-wide announcements and general discussion',
  'channel',
  false,
  (SELECT id FROM auth.users LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'general');

INSERT INTO channels (id, name, description, type, is_private, created_by)
SELECT 
  gen_random_uuid(),
  'random',
  'Non-work banter and water cooler conversation',
  'channel',
  false,
  (SELECT id FROM auth.users LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'random');

INSERT INTO channels (id, name, description, type, is_private, created_by)
SELECT 
  gen_random_uuid(),
  'announcements',
  'Important company announcements',
  'channel',
  false,
  (SELECT id FROM auth.users LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE name = 'announcements');

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Run these to verify setup:
-- SELECT * FROM channels;
-- SELECT * FROM channel_members;
-- SELECT * FROM messages LIMIT 10;
-- SELECT * FROM message_reactions;

-- Check RLS policies:
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
