'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { Badge } from './badge';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex gap-1 overflow-x-auto border-b border-border', className)}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  /** Count badge ("History 14"). */
  count?: number;
}

/** Arrow keys move between tabs (Radix); the active tab has a 2px primary underline. */
export function TabsTrigger({ className, children, count, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex min-h-(--size-control) items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-muted',
        'hover:text-text data-[state=active]:border-primary data-[state=active]:text-text',
        className,
      )}
      {...props}
    >
      {children}
      {count === undefined ? null : <Badge>{count}</Badge>}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4', className)} {...props} />;
}
