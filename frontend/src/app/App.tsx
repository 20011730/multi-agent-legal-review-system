import { RouterProvider } from 'react-router';
import { router } from './routes.tsx';
import { Toaster } from './components/ui/sonner';
import { AssistantWidget } from './components/assistant/AssistantWidget';

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
      {/* 전역 floating 비서 위젯 (Phase 1 정적 FAQ only) */}
      <AssistantWidget />
    </>
  );
}
