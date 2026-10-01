import { createBrowserRouter } from 'react-router-dom';
import { Layout } from './layout';
import { AuthPage } from '../pages/auth-page';
import { BillingPage } from '../pages/billing-page';
import { CalendarPage } from '../pages/calendar-page';
import { ClaimsPage } from '../pages/claims-page';
import { PatientsPage } from '../pages/patients-page';
import { PublicBookingPage } from '../pages/public-booking-page';
import { RequestsPage } from '../pages/requests-page';
import { SettingsPage } from '../pages/settings-page';
import { TodayPage } from '../pages/today-page';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TodayPage /> },
      { path: '/auth', element: <AuthPage /> },
      { path: '/today', element: <TodayPage /> },
      { path: '/calendar', element: <CalendarPage /> },
      { path: '/requests', element: <RequestsPage /> },
      { path: '/patients', element: <PatientsPage /> },
      { path: '/billing', element: <BillingPage /> },
      { path: '/claims', element: <ClaimsPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  { path: '/book', element: <PublicBookingPage /> },
]);
