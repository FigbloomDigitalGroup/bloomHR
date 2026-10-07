-- ZiraTeams Database Schema - Clean Install
-- This will DROP existing tables and recreate them
-- WARNING: This will delete all existing Teams data!
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- DROP EXISTING TABLES (if they exist)
-- ============================================
DROP TABLE IF EXISTS message_reactions CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS channel_members CASCADE;
DROP TABLE IF EXISTS channels CASCADE;

-- ============================================
-- 1. CHANNELS TABLE
-- ============================================
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'channel' CHECK (type IN ('channel', 'direct_message')),
  is_private BOOLEAN DEFAULT false,
  job_title TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_channels_type ON channels(type);
CREATE INDEX idx_channels_created_by ON channels(created_by);
CREATE INDEX idx_channels_job_title ON channels(job_title) WHERE job_title IS NOT NULL;

COMMENT ON TABLE channels IS 'Team channels and direct message containers';

-- ============================================
-- 2. CHANNEL MEMBERS TABLE
-- ============================================
CREATE TABLE channel_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_read_at TIMESTAMP WITH TIME ZONE,
  is_muted BOOLEAN DEFAULT false,
  UNIQUE(channel_id, user_id)
);

CREATE INDEX idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX idx_channel_members_user ON channel_members(user_id);

COMMENT ON TABLE channel_members IS 'Channel membership and user-specific settings';

-- ============================================
-- 3. MESSAGES TABLE
-- ============================================
CREATE TABLE messages (
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

CREATE INDEX idx_messages_channel ON messages(channel_id);
CREATE INDEX idx_messages_author ON messages(author_id);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_messages_channel_created ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_reply_to ON messages(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX idx_messages_content_search ON messages USING gin(to_tsvector('english', content));

COMMENT ON TABLE messages IS 'Team messages with rich content support';

-- ============================================
-- 4. MESSAGE REACTIONS TABLE
-- ============================================
CREATE TABLE message_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_reactions_user ON message_reactions(user_id);

-- ============================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================

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

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

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

CREATE OR REPLACE FUNCTION get_unread_count(p_channel_id UUID, p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_last_read TIMESTAMP WITH TIME ZONE;
  v_count INTEGER;
BEGIN
  SELECT last_read_at INTO v_last_read
  FROM channel_members
  WHERE channel_id = p_channel_id AND user_id = p_user_id;
  
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

INSERT INTO channels (name, description, type, is_private, created_by)
SELECT 
  'general',
  'Company-wide announcements and general discussion',
  'channel',
  false,
  (SELECT id FROM auth.users LIMIT 1)
WHERE EXISTS (SELECT 1 FROM auth.users LIMIT 1);

INSERT INTO channels (name, description, type, is_private, created_by)
SELECT 
  'random',
  'Non-work banter and water cooler conversation',
  'channel',
  false,
  (SELECT id FROM auth.users LIMIT 1)
WHERE EXISTS (SELECT 1 FROM auth.users LIMIT 1);

INSERT INTO channels (name, description, type, is_private, created_by)
SELECT 
  'announcements',
  'Important company announcements',
  'channel',
  false,
  (SELECT id FROM auth.users LIMIT 1)
WHERE EXISTS (SELECT 1 FROM auth.users LIMIT 1);

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '✅ ZiraTeams database schema created successfully!';
  RAISE NOTICE '📊 Tables created: channels, channel_members, messages, message_reactions';
  RAISE NOTICE '🔒 RLS policies enabled';
  RAISE NOTICE '🎯 Default channels created: general, random, announcements';
END $$;
