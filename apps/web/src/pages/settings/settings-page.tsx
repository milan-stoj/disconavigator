import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsAdmin } from '@/lib/auth';
import { BusinessSettings } from './business-settings';
import { SquareSettings } from './square-settings';
import { StaffSettings } from './staff-settings';
import { UsersSettings } from './users-settings';

export function SettingsPage() {
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab =
    isAdmin && (requested === 'users' || requested === 'staff' || requested === 'square')
      ? requested
      : 'business';
  return (
    <>
      <PageHeader
        title="Settings"
        description="Business rules, terms, staff, payments, and who can sign in."
      />
      <Tabs
        value={tab}
        onValueChange={(t) => setParams(t === 'business' ? {} : { tab: t }, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="business">Business</TabsTrigger>
          {isAdmin && <TabsTrigger value="staff">Staff</TabsTrigger>}
          {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="square">Square</TabsTrigger>}
        </TabsList>
        <TabsContent value="business" className="mt-4">
          <BusinessSettings />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="staff" className="mt-4">
            <StaffSettings />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="users" className="mt-4">
            <UsersSettings />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="square" className="mt-4">
            <SquareSettings />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
