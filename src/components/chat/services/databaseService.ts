// services/databaseService.ts
import { supabase } from "../../../lib/supabase";

export class DatabaseService {
  async initializeDatabase() {
    try {
      console.log("🔄 Initializing database tables...");
      
      // First, run the SQL functions to set up tables safely
      await this.runTableSetupFunctions();
      
      // Then verify the tables are properly set up
      await this.verifyTableStructure();
      
      console.log("✅ Database initialization completed");
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      // Don't throw error - we want the app to work even if tables aren't perfect
    }
  }

  private async runTableSetupFunctions() {
    try {
      // Execute each setup function
      const functions = [
        'create_channels_table',
        'create_messages_table', 
        'create_user_channel_states_table',
        'update_tables_schema'
      ];

      for (const funcName of functions) {
        try {
          const { error } = await supabase.rpc(funcName);
          if (error) {
            console.warn(`Function ${funcName} failed:`, error.message);
          } else {
            console.log(`✅ ${funcName} executed successfully`);
          }
        } catch (funcError) {
          console.warn(`Could not execute ${funcName}:`, funcError);
        }
      }
    } catch (error) {
      console.error('Error running setup functions:', error);
    }
  }

  private async verifyTableStructure() {
    const tables = [
      {
        name: 'channels',
        requiredColumns: ['id', 'name', 'created_at']
      },
      {
        name: 'messages', 
        requiredColumns: ['id', 'channel_id', 'author_id', 'content', 'created_at']
      },
      {
        name: 'user_channel_states',
        requiredColumns: ['user_id', 'channel_id', 'last_read_at']
      }
    ];

    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from('information_schema.columns')
          .select('column_name')
          .eq('table_name', table.name)
          .eq('table_schema', 'public');

        if (error) {
          console.warn(`Could not verify ${table.name} table:`, error.message);
          continue;
        }

        if (!data || data.length === 0) {
          console.warn(`Table ${table.name} does not exist or has no columns`);
          continue;
        }

        const existingColumns = data.map(col => col.column_name);
        const missingColumns = table.requiredColumns.filter(col => !existingColumns.includes(col));
        
        if (missingColumns.length > 0) {
          console.warn(`Table ${table.name} is missing columns:`, missingColumns);
        } else {
          console.log(`✅ Table ${table.name} has all required columns`);
        }
      } catch (error) {
        console.warn(`Error verifying ${table.name}:`, error);
      }
    }
  }

  async getTableStatus() {
    const tables = ['channels', 'messages', 'user_channel_states', 'employees'];
    const status: Record<string, { exists: boolean; columns?: string[]; rowCount?: number }> = {};

    for (const table of tables) {
      try {
        // Check if table exists and get its columns
        const { data: columnsData, error: columnsError } = await supabase
          .from('information_schema.columns')
          .select('column_name')
          .eq('table_name', table)
          .eq('table_schema', 'public');

        if (columnsError || !columnsData) {
          status[table] = { exists: false };
          continue;
        }

        // Try to get row count
        const { count, error: countError } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        status[table] = {
          exists: true,
          columns: columnsData.map(col => col.column_name),
          rowCount: countError ? 0 : count
        };

      } catch (error) {
        status[table] = { exists: false };
      }
    }

    return status;
  }

  // Method to check if a specific column exists in a table
  async checkColumnExists(table: string, column: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', table)
        .eq('column_name', column)
        .eq('table_schema', 'public')
        .single();

      return !error && !!data;
    } catch (error) {
      return false;
    }
  }

  // Method to get detailed table information
  async getTableDetails() {
    const status = await this.getTableStatus();
    const details: any = {};

    for (const [tableName, tableStatus] of Object.entries(status)) {
      details[tableName] = tableStatus;
      
      if (tableStatus.exists && tableStatus.columns) {
        // Check for critical columns
        const criticalColumns: Record<string, boolean> = {};
        
        if (tableName === 'messages') {
          criticalColumns['author_id'] = tableStatus.columns.includes('author_id');
          criticalColumns['channel_id'] = tableStatus.columns.includes('channel_id');
          criticalColumns['content'] = tableStatus.columns.includes('content');
        } else if (tableName === 'channels') {
          criticalColumns['name'] = tableStatus.columns.includes('name');
          criticalColumns['created_at'] = tableStatus.columns.includes('created_at');
        } else if (tableName === 'user_channel_states') {
          criticalColumns['user_id'] = tableStatus.columns.includes('user_id');
          criticalColumns['channel_id'] = tableStatus.columns.includes('channel_id');
        }

        details[tableName].criticalColumns = criticalColumns;
        details[tableName].isUsable = Object.values(criticalColumns).every(Boolean);
      }
    }

    return details;
  }

  // Method to check if we can use real-time subscriptions
  async canUseRealtime(): Promise<boolean> {
    try {
      // Check if messages table has replica identity set
      const { data, error } = await supabase
        .from('messages')
        .select('id')
        .limit(1);

      if (error) return false;

      // Try to set replica identity if not already set
      try {
        await supabase.rpc('set_replica_identity', { table_name: 'messages' });
      } catch (e) {
        // Ignore errors - replica identity might already be set
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}

export const databaseService = new DatabaseService();