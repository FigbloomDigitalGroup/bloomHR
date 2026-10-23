import { useEffect, useState } from 'react';
import { TabBar, type TabBarItem } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import EmailDashboard from './EmailDashboard';
import SendEmail from './SendEmail';
import MyMailbox from './Mailbox/MyMailbox';

type Tab = 'mailbox' | 'compose' | 'logs';

/**
 * The Email Portal. "My mailbox" (the mailbox module: your own mailbox, read here) comes first and opens by default for
 * people who have it; Compose and Email logs are the company's sending tools (the email-portal module).
 */
export default function EmailPortal() {
  const { hasAnyPermission, loading } = usePermissions();
  const canMailbox = !loading && hasAnyPermission(['mailbox']);
  const canSend = !loading && hasAnyPermission(['email-portal']);

  const tabs: TabBarItem[] = [
    ...(canMailbox ? [{ id: 'mailbox', label: 'My mailbox' }] : []),
    ...(canSend ? [{ id: 'compose', label: 'Compose & Send' }, { id: 'logs', label: 'Email Logs' }] : []),
  ];
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  // once the permissions are known: the first tab they have, unless they already picked one
  useEffect(() => {
    if (loading) return;
    setActiveTab((t) => (t && tabs.some((x) => x.id === t) ? t : ((tabs[0]?.id as Tab | undefined) ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canMailbox, canSend]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Email Portal</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Read your own mailbox, send email to staff and see what was sent</p>
      </div>

      {tabs.length > 1 && <TabBar items={tabs} activeId={activeTab ?? ''} onChange={(id) => setActiveTab(id as Tab)} />}

      <div>
        {activeTab === 'mailbox' && <MyMailbox />}
        {activeTab === 'compose' && <SendEmail />}
        {activeTab === 'logs' && <EmailDashboard />}
      </div>
    </div>
  );
}
