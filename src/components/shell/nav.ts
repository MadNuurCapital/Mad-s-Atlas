import {
  BellRing,
  CalendarDays,
  CheckSquare,
  Clock,
  Lightbulb,
  Mic,
  Settings,
  ShieldCheck,
  Search,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  group: 'primary' | 'secondary';
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
    group: 'primary',
    description: 'Your day at a glance',
  },
  {
    href: '/talk',
    label: 'Talk',
    icon: Mic,
    group: 'primary',
    description: 'Speak with Atlas',
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: CheckSquare,
    group: 'primary',
    description: 'What needs doing',
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: CalendarDays,
    group: 'primary',
    description: 'Agenda and meeting preparation',
  },
  {
    href: '/memory',
    label: 'Memory',
    icon: Sparkles,
    group: 'primary',
    description: 'What Atlas remembers',
  },
  {
    href: '/research',
    label: 'Research',
    icon: Search,
    group: 'secondary',
    description: 'Grounded reports with real sources',
  },
  {
    href: '/reminders',
    label: 'Reminders',
    icon: BellRing,
    group: 'secondary',
    description: 'One-off and recurring',
  },
  {
    href: '/ideas',
    label: 'Ideas',
    icon: Lightbulb,
    group: 'secondary',
    description: 'Captured thinking',
  },
  {
    href: '/approvals',
    label: 'Approvals',
    icon: ShieldCheck,
    group: 'secondary',
    description: 'Actions awaiting your decision',
  },
  {
    href: '/history',
    label: 'History',
    icon: Clock,
    group: 'secondary',
    description: 'What Atlas has done',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    group: 'secondary',
    description: 'Profile, privacy and connections',
  },
] as const;

/** The four shown directly in the mobile bar. The fifth slot is "More". */
export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.group === 'primary');

/**
 * Everything else, reachable on mobile through the More sheet.
 *
 * Six routes — Settings among them — had no mobile entry point at all before
 * this existed. A bottom bar holds five items; that is a layout limit, not a
 * reason to make Google connection unreachable from a phone.
 */
export const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.group === 'secondary');

/** Mobile keeps Talk centred and leaves Memory in the fully accessible More sheet. */
export const MOBILE_NAV_ITEMS = [
  '/today',
  '/tasks',
  '/talk',
  '/calendar',
].flatMap((href) => NAV_ITEMS.filter((item) => item.href === href));

export const MOBILE_MORE_ITEMS = [
  ...NAV_ITEMS.filter((item) => item.href === '/memory'),
  ...SECONDARY_NAV_ITEMS,
];

/** Match a pathname to its nav item, tolerating nested routes. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
