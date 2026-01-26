-- Chat Messages Table
-- This table stores all chat messages for the staff portal chat component

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  sender_id UUID NOT NULL,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  channel TEXT NOT NULL DEFAULT 'general',
  type TEXT DEFAULT 'text' CHECK (type IN ('text', 'system')),
  reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel, created_at DESC);

-- Comments
COMMENT ON TABLE messages IS 'Chat messages for staff portal team communication';
COMMENT ON COLUMN messages.channel IS 'Channel name: general, support, engineering, random';
COMMENT ON COLUMN messages.type IS 'Message type: text or system';
COMMENT ON COLUMN messages.reply_to IS 'ID of message being replied to (for threading)';

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated users can read messages
CREATE POLICY "Authenticated users can read messages"
  ON messages FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy: Authenticated users can insert messages
CREATE POLICY "Authenticated users can insert messages"
  ON messages FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    sender_id = auth.uid()
  );

-- Policy: Users can update their own messages (for editing)
CREATE POLICY "Users can update own messages"
  ON messages FOR UPDATE
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- Policy: Users can delete their own messages
CREATE POLICY "Users can delete own messages"
  ON messages FOR DELETE
  USING (sender_id = auth.uid());

-- Trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_messages_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_messages_timestamp
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_messages_timestamp();
