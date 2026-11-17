import type { StateType } from '@/components/ui/badge';

export interface SampleAsset {
  id: string;
  tag: string;
  name: string;
  model: string;
  state: StateType;
  /** Admin-chosen status label (the colour comes from the state type). */
  statusLabel: string;
  location: string;
}

/**
 * Placeholder rows for the assets list until the registry API exists (M1-REG-07). Not real data;
 * the page shows a banner saying so. Remove with M1-WEB-07.
 */
export const SAMPLE_ASSETS: SampleAsset[] = [
  {
    id: '0190a6b2-7c3e-7a10-9d2f-4f5e6a7b8c9d',
    tag: 'AT-00124',
    name: 'Chromebook 3100',
    model: 'Dell 3100',
    state: 'deployed',
    statusLabel: 'Assigned',
    location: 'Room 204',
  },
  {
    id: '0190a6b2-7c3e-7a10-9d2f-4f5e6a7b8c9e',
    tag: 'AT-00123',
    name: 'Chromebook 3100',
    model: 'Dell 3100',
    state: 'deployable',
    statusLabel: 'Ready',
    location: 'Room 101',
  },
  {
    id: '0190a6b2-7c3e-7a10-9d2f-4f5e6a7b8c9f',
    tag: 'AT-00125',
    name: 'iPad 9th gen',
    model: 'Apple A2602',
    state: 'undeployable',
    statusLabel: 'Out for fix',
    location: 'Repairs',
  },
  {
    id: '0190a6b2-7c3e-7a10-9d2f-4f5e6a7b8ca0',
    tag: 'AT-00126',
    name: 'Projector EB-X49',
    model: 'Epson EB-X49',
    state: 'overdue',
    statusLabel: 'Overdue',
    location: 'Gym',
  },
  {
    id: '0190a6b2-7c3e-7a10-9d2f-4f5e6a7b8ca1',
    tag: 'AT-00090',
    name: 'Label printer',
    model: 'Brother QL-820',
    state: 'archived',
    statusLabel: 'Disposed',
    location: 'Storage',
  },
];
