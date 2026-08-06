import {
  CalendarDays,
  CheckSquare,
  Clock,
  Inbox,
  Lightbulb,
  Mic,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar. Space is limited to five. */
  primary?: boolean;
  description: string;
};

/**
 * The eleven application routes.
 *
 * Order is deliberate: it follows the rhythm of a day — orient, talk, then the
 * domains, then oversight, then configuration.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/today',
    label: 'Today',
    icon: Sun,
    primary: true,
    description: 'Your day at a glance',
  },
  {
    href: '/talk',
    label: 'Talk',
    icon: Mic,
    primary: true,
    description: 'Speak with Atlas',
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: CalendarDays,
    primary: true,
    description: 'Agenda and meeting preparation',
  },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: Inbox,
    description: 'Important and action-required email',
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: CheckSquare,
    primary: true,
    description: 'What needs doing',
  },
  {
    href: '/memory',
    label: 'Memory',
    icon: Sparkles,
    description: 'What Atlas remembers',
  },
  {
    href: '/ideas',
    label: 'Ideas',
    icon: Lightbulb,
    description: 'Captured thinking',
  },
  {
    href: '/approvals',
    label: 'Approvals',
    icon: ShieldCheck,
    primary: true,
    description: 'Actions awaiting your decision',
  },
  {
    href: '/history',
    label: 'History',
    icon: Clock,
    description: 'What Atlas has done',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    description: 'Profile, privacy and connections',
  },
] as const;

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.primary);

/** Match a pathname to its nav item, tolerating nested routes. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
