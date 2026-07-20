import { RouterProvider } from 'react-router';
import { router } from './routes.tsx';
import { Toaster } from './components/ui/sonner';
import { AssistantWidget } from './components/assistant/AssistantWidget';

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
      <AssistantWidget />
    </>
  );
}
