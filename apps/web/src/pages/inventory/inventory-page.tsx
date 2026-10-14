import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EquipmentTab } from './equipment-tab';
import { PackagesTab } from './packages-tab';

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'packages' ? 'packages' : 'equipment';
  return (
    <>
      <PageHeader
        title="Inventory"
        description="What you own, what's out of service, and the packages customers rent."
      />
      <Tabs
        value={tab}
        onValueChange={(t) => setParams(t === 'equipment' ? {} : { tab: t }, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="packages">Packages</TabsTrigger>
        </TabsList>
        <TabsContent value="equipment" className="mt-4">
          <EquipmentTab />
        </TabsContent>
        <TabsContent value="packages" className="mt-4">
          <PackagesTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
